import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import AgentSettingsPage from './AgentSettingsPage';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const VIEWER_API_KEY = String(import.meta.env.VITE_API_KEY_VIEWER || import.meta.env.VITE_API_KEY || '').trim();

const POLL_INTERVAL_MS = 8000;
const RECORD_LIMIT = 60;
const NETWORK_LIMIT = 300;
const TRACE_LIMIT = 10;
const EVENT_LIMIT = 18;

const EVENT_META = {
  workflow_started: { label: 'Workflow started', state: 'running' },
  challenge_issued: { label: 'x402 challenge issued', state: 'running' },
  payment_sent: { label: 'Payment sent', state: 'running' },
  proof_submitted: { label: 'Payment proof submitted', state: 'running' },
  unlocked: { label: 'Workflow unlocked', state: 'success' },
  failed: { label: 'Workflow failed', state: 'failed' }
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

function toState(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['paid', 'success', 'ok', 'done', 'unlocked'].includes(raw)) return 'success';
  if (['failed', 'error', 'expired', 'rejected'].includes(raw)) return 'failed';
  return 'running';
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

function formatAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value || '-');
  return String(Number(num.toFixed(6)));
}

function parseEventData(event) {
  if (!event?.data) return {};
  try {
    return JSON.parse(event.data);
  } catch {
    return {};
  }
}

function resolveRecordState(record = {}) {
  return toState(record.workflowState || record.status);
}

function resolveRecordStatusText(record = {}) {
  const workflowText = String(record.workflowState || '').trim();
  const x402Text = String(record.status || '').trim();
  if (workflowText && x402Text && workflowText.toLowerCase() !== x402Text.toLowerCase()) {
    return `${workflowText} / ${x402Text}`;
  }
  return workflowText || x402Text || '-';
}

function normalizeNetworkGraph(payload = {}) {
  const graph = payload?.graph || {};
  return {
    nodeCount: Number(graph?.nodeCount || 0),
    edgeCount: Number(graph?.edgeCount || 0),
    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph?.edges) ? graph.edges : []
  };
}

function buildTraceFromRecord(record) {
  const state = resolveRecordState(record);
  const at = record.workflowUpdatedAt || record.paidAt || record.createdAt || new Date().toISOString();
  const summary =
    state === 'failed' && record.workflowError
      ? record.workflowError
      : record.query || record.action || 'x402 request';
  return {
    traceId: `request:${record.requestId}`,
    requestId: record.requestId,
    flowMode: record.flowMode,
    state,
    updatedAt: at,
    summary,
    steps: [
      {
        name: `x402_${record.status || 'pending'}_${record.workflowState || 'no_workflow'}`,
        label: resolveRecordStatusText(record),
        state,
        at,
        details: {
          requestId: record.requestId,
          amount: record.amount,
          txHash: record.paymentTxHash || '',
          workflowTraceId: record.workflowTraceId || ''
        }
      }
    ]
  };
}

function mergeRecordTraces(previous, records) {
  const next = previous.map((trace) => ({ ...trace, steps: [...trace.steps] }));

  for (const record of records) {
    if (!record.requestId) continue;
    const snapshot = buildTraceFromRecord(record);
    const index = next.findIndex(
      (trace) => String(trace.requestId || '') === record.requestId || trace.traceId === snapshot.traceId
    );
    if (index < 0) {
      next.push(snapshot);
      continue;
    }

    const current = next[index];
    if (String(current.traceId || '').startsWith('request:')) {
      next[index] = snapshot;
      continue;
    }

    const snapshotState = resolveRecordState(record);
    const keepTerminal = (current.state === 'success' || current.state === 'failed') && snapshotState === 'running';
    next[index] = {
      ...current,
      requestId: record.requestId || current.requestId,
      flowMode: record.flowMode || current.flowMode,
      state: keepTerminal ? current.state : snapshotState,
      updatedAt: snapshot.updatedAt
    };
  }

  return next
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, TRACE_LIMIT);
}

function mergeEventTrace(previous, eventName, payload) {
  const traceId = String(payload?.traceId || 'live-untracked').trim();
  const meta = EVENT_META[eventName] || { label: eventName, state: 'running' };
  const at = new Date().toISOString();

  const traceList = previous.map((trace) => ({ ...trace, steps: [...trace.steps] }));
  const index = traceList.findIndex((item) => item.traceId === traceId);

  const nextStep = {
    name: eventName,
    label: meta.label,
    state: meta.state,
    at,
    details: payload || {}
  };

  if (index < 0) {
    traceList.push({
      traceId,
      requestId: String(payload?.requestId || '').trim(),
      flowMode: payload?.sourceAgentId && payload?.targetAgentId ? 'a2a+x402' : 'agent-to-api+x402',
      state: meta.state,
      updatedAt: at,
      summary: payload?.summary || payload?.reason || payload?.symbol || meta.label,
      steps: [nextStep]
    });
  } else {
    const current = traceList[index];
    const nextState = meta.state === 'running' ? current.state || 'running' : meta.state;
    traceList[index] = {
      ...current,
      requestId: String(payload?.requestId || current.requestId || '').trim(),
      flowMode:
        payload?.sourceAgentId && payload?.targetAgentId
          ? 'a2a+x402'
          : current.flowMode || 'agent-to-api+x402',
      state: nextState,
      updatedAt: at,
      summary: payload?.summary || payload?.reason || current.summary,
      steps: [...current.steps.slice(-10), nextStep]
    };
  }

  return traceList
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, TRACE_LIMIT);
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
    return params.get('view') === 'setup' ? 'setup' : 'monitor';
  } catch {
    return 'monitor';
  }
}

async function fetchJson(path, params) {
  const headers = {};
  if (VIEWER_API_KEY) {
    headers['x-api-key'] = VIEWER_API_KEY;
  }
  const response = await fetch(resolveApiUrl(path, params), { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const reason = payload?.reason || payload?.error || `HTTP ${response.status}`;
    throw new Error(reason);
  }
  return payload;
}

function App() {
  const [view, setView] = useState(() => readViewFromUrl());
  const [walletState, setWalletState] = useState({
    ownerAddress: '',
    aaAddress: ''
  });
  const [records, setRecords] = useState([]);
  const [kpi, setKpi] = useState({ pending: 0, paid: 0, failed: 0, todaySpend: 0 });
  const [traces, setTraces] = useState([]);
  const [events, setEvents] = useState([]);
  const [networkGraph, setNetworkGraph] = useState({
    nodeCount: 0,
    edgeCount: 0,
    nodes: [],
    edges: []
  });
  const [lastSyncAt, setLastSyncAt] = useState('');
  const [streamMode, setStreamMode] = useState(VIEWER_API_KEY ? 'polling' : 'connecting');
  const [errorText, setErrorText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [streamToken, setStreamToken] = useState(0);
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
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener('accountsChanged', onAccountsChanged);
      }
    };
  }, []);

  const loadSnapshot = useCallback(async ({ manual = false } = {}) => {
    if (manual) setRefreshing(true);
    try {
      const [mappingPayload, networkPayload] = await Promise.all([
        fetchJson('/api/x402/mapping/latest', { limit: RECORD_LIMIT }),
        fetchJson('/api/a2a/network/graph', { limit: NETWORK_LIMIT, recent: 12 }).catch(() => null)
      ]);
      const items = Array.isArray(mappingPayload?.items) ? mappingPayload.items : [];
      setRecords(items);
      setKpi({
        pending: Number(mappingPayload?.kpi?.pending || 0),
        paid: Number(mappingPayload?.kpi?.paid || 0),
        failed: Number(mappingPayload?.kpi?.failed || 0),
        todaySpend: Number(mappingPayload?.kpi?.todaySpend || 0)
      });
      setTraces((previous) => mergeRecordTraces(previous, items));
      if (networkPayload?.ok) {
        setNetworkGraph(normalizeNetworkGraph(networkPayload));
      }
      setLastSyncAt(new Date().toISOString());
      setErrorText('');
    } catch (error) {
      setErrorText(error.message || 'Failed to fetch monitor snapshot.');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

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

    const source = new EventSource(resolveApiUrl('/api/events/stream'));
    const eventNames = Object.keys(EVENT_META);

    const onOpen = () => {
      setStreamMode('live');
      setErrorText('');
    };

    // If SSE cannot stay open, keep UI data fresh with polling path.
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
      const handler = (event) => {
        const payload = parseEventData(event);
        setEvents((previous) => {
          const next = [
            {
              id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
              name: eventName,
              label: EVENT_META[eventName]?.label || eventName,
              state: EVENT_META[eventName]?.state || 'running',
              traceId: String(payload?.traceId || '').trim(),
              at: new Date().toISOString()
            },
            ...previous
          ];
          return next.slice(0, EVENT_LIMIT);
        });
        setTraces((previous) => mergeEventTrace(previous, eventName, payload));
        if (eventName === 'challenge_issued' || eventName === 'unlocked' || eventName === 'failed') {
          void loadSnapshot();
        }
      };
      source.addEventListener(eventName, handler);
      return { eventName, handler };
    });

    return () => {
      source.removeEventListener('connected', onConnected);
      for (const entry of listeners) {
        source.removeEventListener(entry.eventName, entry.handler);
      }
      source.close();
    };
  }, [isSetupView, loadSnapshot, streamToken]);

  const summary = useMemo(() => {
    let running = 0;
    let success = 0;
    let failed = 0;
    for (const trace of traces) {
      if (trace.state === 'success') success += 1;
      else if (trace.state === 'failed') failed += 1;
      else running += 1;
    }
    return { running, success, failed };
  }, [traces]);

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
            <button type="button" className="ghost-btn" onClick={() => switchView('monitor')}>
              Back to Monitor
            </button>
          </div>
        </header>
        <AgentSettingsPage onBack={() => switchView('monitor')} walletState={walletState} />
      </div>
    );
  }

  return (
    <div className="monitor-root">
      <div className="monitor-glow monitor-glow-left" />
      <div className="monitor-glow monitor-glow-right" />

      <header className="monitor-header">
        <div>
          <p className="header-kicker">Kite Testnet</p>
          <h1>Multi-Agent Collaboration Console</h1>
          <p className="header-subtitle">
            Real-time view for agent-to-agent and agent-to-api execution with x402 settlement.
          </p>
        </div>
        <div className="header-meta">
          <span className={`connection-pill ${streamMode}`}>{statusText(streamMode)}</span>
          <span className="sync-time">Last sync: {formatTime(lastSyncAt)}</span>
          <button type="button" className="ghost-btn" onClick={() => switchView('setup')}>
            Session Setup
          </button>
          {!VIEWER_API_KEY && streamMode !== 'live' ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setStreamToken((token) => token + 1)}
            >
              Retry SSE
            </button>
          ) : null}
        </div>
      </header>

      <section className="kpi-grid">
        <article className="kpi-card">
          <span>Active Traces</span>
          <strong>{summary.running}</strong>
        </article>
        <article className="kpi-card">
          <span>Trace Success</span>
          <strong>{summary.success}</strong>
        </article>
        <article className="kpi-card">
          <span>Trace Failed</span>
          <strong>{summary.failed}</strong>
        </article>
        <article className="kpi-card">
          <span>Today x402 Spend</span>
          <strong>{kpi.todaySpend}</strong>
        </article>
      </section>

      {errorText ? <p className="error-banner">{errorText}</p> : null}

      <main className="monitor-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>1) Agent Live Status & Steps</h2>
            <span className="panel-note">running / success / failed</span>
          </div>

          <div className="network-panel">
            <h3>A2A network snapshot</h3>
            <p className="network-desc">Aggregated by source agent, target agent and capability.</p>
            <div className="network-kpi">
              <span>Nodes: {networkGraph.nodeCount}</span>
              <span>Edges: {networkGraph.edgeCount}</span>
              <span>Sample size: {networkGraph.edges.reduce((sum, edge) => sum + Number(edge.totalCount || 0), 0)}</span>
            </div>

            {networkGraph.edges.length === 0 ? (
              <p className="empty-state compact">No A2A settled edge yet.</p>
            ) : (
              <ul className="network-edge-list">
                {networkGraph.edges.slice(0, 6).map((edge) => (
                  <li key={edge.edgeId}>
                    <div className="network-edge-head">
                      <strong>{edge.sourceAgentId} -&gt; {edge.targetAgentId}</strong>
                      <span className={`status-pill ${toState(edge.lastState)}`}>{edge.lastState || 'running'}</span>
                    </div>
                    <p>{edge.capability || 'unknown capability'}</p>
                    <div className="network-edge-meta">
                      <span>total {edge.totalCount}</span>
                      <span>ok {edge.successCount}</span>
                      <span>fail {edge.failedCount}</span>
                      <span>amount {formatAmount(edge.totalAmount)}</span>
                      <span>latest {formatTime(edge.latestAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="trace-list">
            {traces.length === 0 ? (
              <div className="empty-state">No active trace yet. Trigger a workflow to see live steps.</div>
            ) : (
              traces.map((trace) => (
                <article key={trace.traceId} className="trace-card">
                  <div className="trace-head">
                    <p>{shortenMiddle(trace.traceId, 12, 8)}</p>
                    <span className={`status-pill ${trace.state}`}>{trace.state}</span>
                  </div>
                  <div className="trace-meta">
                    <span>Flow: {trace.flowMode || '-'}</span>
                    <span>Req: {shortenMiddle(trace.requestId, 10, 6)}</span>
                    <span>Updated: {formatTime(trace.updatedAt)}</span>
                  </div>
                  <p className="trace-summary">{trace.summary || '-'}</p>
                  <ul className="step-list">
                    {trace.steps.slice(-6).reverse().map((step, index) => (
                      <li key={`${trace.traceId}_${step.name}_${index}`}>
                        <span className={`step-dot ${step.state}`} />
                        <span className="step-label">{step.label}</span>
                        <span className="step-time">{formatTime(step.at)}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))
            )}
          </div>

          <div className="event-panel">
            <h3>Recent stream events</h3>
            {events.length === 0 ? (
              <p className="empty-state compact">Waiting for workflow events...</p>
            ) : (
              <ul>
                {events.map((item) => (
                  <li key={item.id}>
                    <span className={`event-state ${item.state}`}>{item.state}</span>
                    <span>{item.label}</span>
                    <span>{shortenMiddle(item.traceId, 12, 8)}</span>
                    <span>{formatTime(item.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>2) x402 Transaction Records</h2>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void loadSnapshot({ manual: true })}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : 'Refresh now'}
            </button>
          </div>
          <p className="panel-desc">
            Request, amount, txHash, status and time. Includes both agent-to-agent and agent-to-api flows.
          </p>

          <div className="records-summary">
            <span>Pending: {kpi.pending}</span>
            <span>Paid: {kpi.paid}</span>
            <span>Failed: {kpi.failed}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Flow</th>
                  <th>Amount</th>
                  <th>txHash</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="table-empty">
                      No x402 records yet.
                    </td>
                  </tr>
                ) : (
                  records.map((record, index) => {
                    const visual = resolveRecordState(record);
                    const txHash = record.paymentTxHash || '';
                    const displayTime = record.workflowUpdatedAt || record.paidAt || record.createdAt;
                    return (
                      <tr key={`${record.requestId || 'row'}_${index}`}>
                        <td>
                          <p className="request-id">{shortenMiddle(record.requestId, 13, 8)}</p>
                          <p className="request-action">{record.action || '-'}</p>
                        </td>
                        <td>{record.flowMode || '-'}</td>
                        <td>{record.amount || '-'}</td>
                        <td className="mono">{shortenMiddle(txHash, 12, 10)}</td>
                        <td>
                          <span className={`status-pill ${visual}`}>{resolveRecordStatusText(record)}</span>
                        </td>
                        <td>{formatTime(displayTime)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
