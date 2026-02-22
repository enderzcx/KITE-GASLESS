import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import AgentSettingsPage from './AgentSettingsPage';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const VIEWER_API_KEY = String(import.meta.env.VITE_API_KEY_VIEWER || import.meta.env.VITE_API_KEY || '').trim();
const AGENT_API_KEY = String(import.meta.env.VITE_API_KEY_AGENT || import.meta.env.VITE_API_KEY || '').trim();

const POLL_INTERVAL_MS = 8000;
const RECORD_LIMIT = 80;
const EVENT_LIMIT = 16;

const STEP_ORDER = ['identity', 'challenge', 'payment', 'proof', 'api_result', 'onchain'];
const STEP_LABELS = {
  identity: 'ERC8004 Identity',
  challenge: 'x402 Challenge',
  payment: 'Payment Sent',
  proof: 'Proof Verified',
  api_result: 'API Result',
  onchain: 'On-chain Evidence'
};

const EVENT_META = {
  workflow_started: { label: 'Workflow started', state: 'running', stepId: 'identity' },
  challenge_issued: { label: 'x402 challenge issued', state: 'running', stepId: 'challenge' },
  payment_sent: { label: 'Payment sent', state: 'running', stepId: 'payment' },
  proof_submitted: { label: 'Payment proof submitted', state: 'running', stepId: 'proof' },
  unlocked: { label: 'Workflow unlocked', state: 'success', stepId: 'api_result' },
  failed: { label: 'Workflow failed', state: 'failed', stepId: 'api_result' }
};

function resolveApiUrl(path, params) {
  const base = API_BASE_URL || window.location.origin;
  const url = new URL(path, base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return API_BASE_URL ? url.toString() : `${url.pathname}${url.search}`;
}

function buildHeaders(apiKey = VIEWER_API_KEY) {
  const headers = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

async function fetchJson(path, params) {
  const response = await fetch(resolveApiUrl(path, params), { headers: buildHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const reason = payload?.reason || payload?.error || `HTTP ${response.status}`;
    throw new Error(reason);
  }
  return payload;
}

function formatTime(isoText) {
  if (!isoText) return '-';
  const dt = new Date(isoText);
  if (Number.isNaN(dt.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(dt);
}

function shortenMiddle(text, left = 10, right = 8) {
  const value = String(text || '').trim();
  if (!value) return '-';
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function statusText(mode) {
  if (mode === 'live') return 'SSE live';
  if (mode === 'polling') return 'Polling fallback';
  if (mode === 'connecting') return 'Connecting stream';
  return 'Disconnected';
}

function readViewFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'setup' ? 'setup' : 'demo';
  } catch {
    return 'demo';
  }
}

function normalizeStepState(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'success') return 'success';
  if (raw === 'failed') return 'failed';
  if (raw === 'running') return 'running';
  return 'waiting';
}

function normalizeTimeline(items = []) {
  const index = new Map(
    (Array.isArray(items) ? items : []).map((item) => [
      String(item?.id || '').trim(),
      {
        ...item,
        state: normalizeStepState(item?.state)
      }
    ])
  );
  return STEP_ORDER.map((id) => {
    const existing = index.get(id);
    return {
      id,
      label: STEP_LABELS[id],
      state: normalizeStepState(existing?.state),
      detail: String(existing?.detail || '').trim()
    };
  });
}

function toVisualState(record = {}) {
  const workflow = String(record.workflowState || '').trim().toLowerCase();
  const status = String(record.status || '').trim().toLowerCase();
  const text = workflow || status;
  if (['unlocked', 'success', 'ok', 'paid'].includes(text)) return 'success';
  if (['failed', 'error', 'expired', 'rejected'].includes(text)) return 'failed';
  return 'running';
}

function App() {
  const [view, setView] = useState(() => readViewFromUrl());
  const [walletState, setWalletState] = useState({ ownerAddress: '', aaAddress: '' });
  const [records, setRecords] = useState([]);
  const [kpi, setKpi] = useState({ pending: 0, paid: 0, failed: 0, todaySpend: 0 });
  const [selectedTraceId, setSelectedTraceId] = useState('');
  const [traceData, setTraceData] = useState(null);
  const [identityLatest, setIdentityLatest] = useState(null);
  const [events, setEvents] = useState([]);
  const [lastSyncAt, setLastSyncAt] = useState('');
  const [streamMode, setStreamMode] = useState(VIEWER_API_KEY ? 'polling' : 'connecting');
  const [errorText, setErrorText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [stepFlash, setStepFlash] = useState('');
  const [streamToken, setStreamToken] = useState(0);
  const [triggering, setTriggering] = useState(false);

  const isSetupView = view === 'setup';

  const switchView = useCallback((nextView) => {
    setView(nextView);
    try {
      const url = new URL(window.location.href);
      if (nextView === 'setup') url.searchParams.set('view', 'setup');
      else url.searchParams.delete('view');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // ignore URL sync errors
    }
  }, []);

  const connectWallet = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') {
      setErrorText('Wallet extension not found. Install MetaMask first.');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const ownerAddress = String(accounts?.[0] || '').trim();
      if (!ownerAddress) throw new Error('No wallet account selected.');
      setWalletState((prev) => ({ ...prev, ownerAddress }));
      setErrorText('');
    } catch (error) {
      setErrorText(error?.message || 'Wallet connect failed.');
    }
  }, []);

  useEffect(() => {
    if (typeof window.ethereum === 'undefined' || !window.ethereum.on) return undefined;
    const onAccountsChanged = (accounts) => {
      const ownerAddress = String(accounts?.[0] || '').trim();
      setWalletState((prev) => ({ ...prev, ownerAddress }));
    };
    window.ethereum.on('accountsChanged', onAccountsChanged);
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccountsChanged);
    };
  }, []);

  const loadTrace = useCallback(async (traceId) => {
    const normalized = String(traceId || '').trim();
    if (!normalized) {
      setTraceData(null);
      return;
    }
    setTraceLoading(true);
    try {
      const payload = await fetchJson(`/api/demo/trace/${encodeURIComponent(normalized)}`);
      setTraceData(payload);
      setErrorText('');
    } catch (error) {
      setErrorText(error.message || 'Failed to load demo trace.');
    } finally {
      setTraceLoading(false);
    }
  }, []);

  const loadSnapshot = useCallback(
    async ({ manual = false } = {}) => {
      if (manual) setRefreshing(true);
      try {
        const [mappingPayload, identityPayload] = await Promise.all([
          fetchJson('/api/x402/mapping/latest', { limit: RECORD_LIMIT }),
          fetchJson('/api/demo/identity/latest').catch(() => null)
        ]);
        const items = Array.isArray(mappingPayload?.items) ? mappingPayload.items : [];
        setRecords(items);
        setKpi({
          pending: Number(mappingPayload?.kpi?.pending || 0),
          paid: Number(mappingPayload?.kpi?.paid || 0),
          failed: Number(mappingPayload?.kpi?.failed || 0),
          todaySpend: Number(mappingPayload?.kpi?.todaySpend || 0)
        });
        if (identityPayload?.ok) {
          setIdentityLatest(identityPayload.latest || null);
        }

        const traceInRows = items.find((item) => String(item?.workflowTraceId || '').trim())?.workflowTraceId || '';
        const nextTraceId = String(selectedTraceId || traceInRows || '').trim();
        if (nextTraceId) {
          setSelectedTraceId(nextTraceId);
          await loadTrace(nextTraceId);
        }
        setLastSyncAt(new Date().toISOString());
        setErrorText('');
      } catch (error) {
        setErrorText(error.message || 'Failed to load demo snapshot.');
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [loadTrace, selectedTraceId]
  );

  useEffect(() => {
    if (isSetupView) return undefined;
    void loadSnapshot();
    const timer = setInterval(() => {
      void loadSnapshot();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isSetupView, loadSnapshot]);

  useEffect(() => {
    if (isSetupView) return undefined;
    if (VIEWER_API_KEY) {
      setStreamMode('polling');
      return undefined;
    }

    const source = new EventSource(resolveApiUrl('/api/demo/stream'));
    const eventNames = Object.keys(EVENT_META);

    const onOpen = () => setStreamMode('live');
    const onError = () => {
      source.close();
      setStreamMode('polling');
    };
    const onConnected = () => setStreamMode('live');

    source.addEventListener('connected', onConnected);
    source.addEventListener('ping', () => {});
    source.onopen = onOpen;
    source.onerror = onError;

    const listeners = eventNames.map((eventName) => {
      const handler = async (event) => {
        let payload = {};
        try {
          payload = JSON.parse(event?.data || '{}');
        } catch {
          payload = {};
        }
        const meta = EVENT_META[eventName] || { label: eventName, state: 'running', stepId: '' };

        setEvents((prev) => {
          const next = [
            {
              id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
              name: eventName,
              label: meta.label,
              state: meta.state,
              stepId: meta.stepId,
              traceId: String(payload?.traceId || '').trim(),
              at: new Date().toISOString()
            },
            ...prev
          ];
          return next.slice(0, EVENT_LIMIT);
        });

        if (meta.stepId) {
          setStepFlash(meta.stepId);
          setTimeout(() => setStepFlash(''), 320);
        }

        const eventTraceId = String(payload?.traceId || '').trim();
        if (eventTraceId) {
          setSelectedTraceId(eventTraceId);
          await loadTrace(eventTraceId);
        }

        if (['challenge_issued', 'payment_sent', 'proof_submitted', 'unlocked', 'failed'].includes(eventName)) {
          await loadSnapshot();
        }
      };
      source.addEventListener(eventName, handler);
      return { eventName, handler };
    });

    return () => {
      source.removeEventListener('connected', onConnected);
      for (const item of listeners) {
        source.removeEventListener(item.eventName, item.handler);
      }
      source.close();
    };
  }, [isSetupView, loadSnapshot, loadTrace, streamToken]);

  const triggerDemoRun = useCallback(async () => {
    setTriggering(true);
    try {
      const headers = {
        ...buildHeaders(AGENT_API_KEY || VIEWER_API_KEY),
        'Content-Type': 'application/json'
      };
      const resp = await fetch(resolveApiUrl('/api/workflow/btc-price/run'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ pair: 'BTCUSDT', source: 'hyperliquid' })
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload?.ok === false) {
        throw new Error(payload?.reason || payload?.error || `HTTP ${resp.status}`);
      }
      const traceId = String(payload?.traceId || '').trim();
      if (traceId) {
        setSelectedTraceId(traceId);
        await loadTrace(traceId);
      }
      await loadSnapshot();
    } catch (error) {
      setErrorText(error.message || 'Trigger demo run failed.');
    } finally {
      setTriggering(false);
    }
  }, [loadSnapshot, loadTrace]);

  const timeline = useMemo(() => normalizeTimeline(traceData?.timeline), [traceData?.timeline]);
  const traceState = String(traceData?.state || '').trim().toLowerCase() || 'running';
  const currentWorkflow = traceData?.workflow || null;
  const currentRequest = traceData?.request || null;
  const quote = traceData?.workflow?.result?.quote || traceData?.request?.result?.quote || null;

  if (isSetupView) {
    return (
      <div className="monitor-root">
        <div className="monitor-glow monitor-glow-left" />
        <div className="monitor-glow monitor-glow-right" />
        <header className="monitor-header">
          <div>
            <p className="header-kicker">Kite Testnet</p>
            <h1>Session Setup</h1>
            <p className="header-subtitle">
              Connect owner wallet, create session, then sync runtime for autonomous x402 payments.
            </p>
          </div>
          <div className="header-meta">
            <span className="sync-time">
              Owner: {walletState.ownerAddress ? shortenMiddle(walletState.ownerAddress, 10, 8) : 'not connected'}
            </span>
            <button type="button" className="ghost-btn" onClick={connectWallet}>
              Connect wallet
            </button>
            <button type="button" className="ghost-btn" onClick={() => switchView('demo')}>
              Back to Demo
            </button>
          </div>
        </header>
        <AgentSettingsPage onBack={() => switchView('demo')} walletState={walletState} />
      </div>
    );
  }

  return (
    <div className="demo-root">
      <div className="demo-backdrop demo-backdrop-left" />
      <div className="demo-backdrop demo-backdrop-right" />

      <header className="demo-header">
        <div>
          <p className="header-kicker">KITE TESTNET</p>
          <h1>Agent Payment Flow Stage</h1>
          <p className="demo-subtitle">
            Visual timeline for agent-to-api and agent-to-agent actions with x402 settlement and ERC8004 identity.
          </p>
        </div>
        <div className="demo-actions">
          <span className={`demo-pill ${streamMode}`}>{statusText(streamMode)}</span>
          <span className="demo-sync">Last sync: {formatTime(lastSyncAt)}</span>
          <button type="button" className="ghost-btn" onClick={() => void loadSnapshot({ manual: true })} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="ghost-btn" onClick={triggerDemoRun} disabled={triggering}>
            {triggering ? 'Triggering...' : 'Run Demo'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => switchView('setup')}>
            Session Setup
          </button>
          {!VIEWER_API_KEY && streamMode !== 'live' ? (
            <button type="button" className="ghost-btn" onClick={() => setStreamToken((x) => x + 1)}>
              Retry SSE
            </button>
          ) : null}
        </div>
      </header>

      <section className="demo-kpi-grid">
        <article className="demo-kpi-card">
          <span>Pending</span>
          <strong>{kpi.pending}</strong>
        </article>
        <article className="demo-kpi-card">
          <span>Paid</span>
          <strong>{kpi.paid}</strong>
        </article>
        <article className="demo-kpi-card">
          <span>Failed</span>
          <strong>{kpi.failed}</strong>
        </article>
        <article className="demo-kpi-card">
          <span>Today Spend</span>
          <strong>{kpi.todaySpend}</strong>
        </article>
      </section>

      {errorText ? <p className="error-banner">{errorText}</p> : null}

      <main className="demo-main-grid">
        <section className="demo-panel">
          <div className="demo-panel-head">
            <h2>Execution Timeline</h2>
            <span className={`demo-status ${traceState}`}>{traceState}</span>
          </div>
          <p className="demo-trace-line">
            Trace: {shortenMiddle(selectedTraceId || traceData?.traceId || currentWorkflow?.traceId || '-', 14, 8)}
          </p>
          <p className="demo-trace-line">
            Request: {shortenMiddle(currentRequest?.requestId || currentWorkflow?.requestId || '-', 14, 8)}
          </p>

          <ol className="demo-step-list">
            {timeline.map((step, idx) => (
              <li
                key={step.id}
                className={`demo-step-card ${step.state} ${stepFlash === step.id ? 'flash' : ''}`}
              >
                <div className="demo-step-top">
                  <span className="demo-step-index">{idx + 1}</span>
                  <p>{step.label}</p>
                  <span className={`demo-mini-pill ${step.state}`}>{step.state}</span>
                </div>
                <p className="demo-step-detail">{step.detail || 'waiting...'}</p>
                {idx < timeline.length - 1 ? <span className={`demo-step-link ${step.state}`} /> : null}
              </li>
            ))}
          </ol>

          <div className="demo-summary-box">
            <p className="demo-summary-label">Summary</p>
            <p>
              {currentWorkflow?.error ||
                currentWorkflow?.result?.summary ||
                currentRequest?.result?.summary ||
                (traceLoading ? 'Loading trace details...' : 'Waiting for workflow events...')}
            </p>
          </div>
        </section>

        <section className="demo-panel">
          <div className="demo-panel-head">
            <h2>Evidence Drawer</h2>
            <span className="demo-note">x402 + ERC8004</span>
          </div>
          <div className="demo-evidence-grid">
            <article className="demo-evidence-card">
              <h3>Identity</h3>
              <p>agentId: {currentRequest?.identity?.agentId || '-'}</p>
              <p>registry: {shortenMiddle(currentRequest?.identity?.registry || '-', 14, 10)}</p>
              <p>latest verify: {identityLatest?.status || '-'}</p>
              <p>wallet: {shortenMiddle(identityLatest?.identity?.agentWallet || '-', 14, 10)}</p>
            </article>

            <article className="demo-evidence-card">
              <h3>x402 Payment</h3>
              <p>amount: {currentRequest?.amount || '-'}</p>
              <p>token: {shortenMiddle(currentRequest?.tokenAddress || '-', 12, 10)}</p>
              <p>recipient: {shortenMiddle(currentRequest?.recipient || '-', 12, 10)}</p>
              <p>txHash: {shortenMiddle(currentRequest?.paymentTxHash || currentWorkflow?.txHash || '-', 12, 10)}</p>
            </article>

            <article className="demo-evidence-card">
              <h3>API Result</h3>
              <p>provider: {quote?.provider || '-'}</p>
              <p>price: {quote?.priceUsd ?? '-'}</p>
              <p>pair: {quote?.pair || '-'}</p>
              <p>at: {formatTime(quote?.fetchedAt || '')}</p>
            </article>

            <article className="demo-evidence-card">
              <h3>Workflow</h3>
              <p>state: {currentWorkflow?.state || '-'}</p>
              <p>updated: {formatTime(currentWorkflow?.updatedAt || '')}</p>
              <p>payer: {shortenMiddle(currentWorkflow?.payer || '-', 12, 10)}</p>
              <p>flow: {currentRequest?.a2a ? 'a2a+x402' : 'agent-to-api+x402'}</p>
            </article>
          </div>
        </section>
      </main>

      <section className="demo-bottom-grid">
        <section className="demo-panel">
          <div className="demo-panel-head">
            <h2>Recent Traces</h2>
            <span className="demo-note">click to replay</span>
          </div>
          <div className="demo-trace-table">
            {records.length === 0 ? (
              <p className="demo-empty">No x402 records yet.</p>
            ) : (
              records.slice(0, 12).map((item, idx) => {
                const traceId = String(item?.workflowTraceId || '').trim();
                const visual = toVisualState(item);
                return (
                  <button
                    type="button"
                    key={`${item.requestId || 'row'}_${idx}`}
                    className={`demo-trace-row ${selectedTraceId === traceId ? 'active' : ''}`}
                    onClick={() => {
                      if (!traceId) return;
                      setSelectedTraceId(traceId);
                      void loadTrace(traceId);
                    }}
                    disabled={!traceId}
                  >
                    <span>{shortenMiddle(traceId || item.requestId, 14, 8)}</span>
                    <span>{item.flowMode || '-'}</span>
                    <span>{item.amount || '-'}</span>
                    <span className={`demo-mini-pill ${visual}`}>{item.workflowState || item.status || '-'}</span>
                    <span>{formatTime(item.workflowUpdatedAt || item.paidAt || item.createdAt)}</span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="demo-panel">
          <div className="demo-panel-head">
            <h2>Live Event Feed</h2>
            <span className="demo-note">SSE events</span>
          </div>
          <ul className="demo-event-list">
            {events.length === 0 ? (
              <li className="demo-empty">Waiting for workflow events...</li>
            ) : (
              events.map((item) => (
                <li key={item.id} className={`demo-event-row ${item.state}`}>
                  <span className={`demo-event-dot ${item.state}`} />
                  <span>{item.label}</span>
                  <span>{shortenMiddle(item.traceId, 12, 8)}</span>
                  <span>{formatTime(item.at)}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      </section>
    </div>
  );
}

export default App;
