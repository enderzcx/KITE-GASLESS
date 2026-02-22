import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import AgentSettingsPage from './AgentSettingsPage';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const VIEWER_API_KEY = String(import.meta.env.VITE_API_KEY_VIEWER || import.meta.env.VITE_API_KEY || '').trim();
const AGENT_API_KEY = String(import.meta.env.VITE_API_KEY_AGENT || import.meta.env.VITE_API_KEY || '').trim();

const POLL_INTERVAL_MS = 8000;
const RECORD_LIMIT = 80;
const EVENT_LIMIT = 18;
const CHART_POINT_LIMIT = 60;

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
  if (apiKey) headers['x-api-key'] = apiKey;
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

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
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

function readRouteFromPathname() {
  const path = String(window.location.pathname || '/').trim();
  if (path === '/ops') return 'ops';
  return 'demo';
}

function normalizeRoutePath() {
  const path = String(window.location.pathname || '/').trim();
  if (path === '/' || path === '/ops') return;
  try {
    window.history.replaceState({}, '', `/${window.location.search}${window.location.hash}`);
  } catch {
    // ignore history errors
  }
}

function normalizeSeriesPoints(input = []) {
  const dedup = new Map();
  for (const raw of Array.isArray(input) ? input : []) {
    if (!raw || typeof raw !== 'object') continue;
    const requestId = String(raw.requestId || '').trim();
    const provider = String(raw.provider || '').trim().toLowerCase() || 'unknown';
    const priceUsd = Number(raw.priceUsd);
    const tRaw = String(raw.t || raw.fetchedAt || '').trim();
    const tMs = Date.parse(tRaw);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    if (!Number.isFinite(tMs)) continue;
    const row = {
      t: new Date(tMs).toISOString(),
      priceUsd: Number(priceUsd.toFixed(6)),
      provider,
      requestId: requestId || `series_${tMs}_${provider}`,
      traceId: String(raw.traceId || '').trim()
    };
    const prev = dedup.get(row.requestId);
    if (!prev || Date.parse(prev.t) <= tMs) {
      dedup.set(row.requestId, row);
    }
  }
  return [...dedup.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function appendSeriesPoint(series, point, maxSize = 300) {
  const merged = normalizeSeriesPoints([...(Array.isArray(series) ? series : []), point]);
  return merged.slice(-maxSize);
}

function buildChartModel(series = []) {
  const width = 920;
  const height = 360;
  const margin = { top: 26, right: 24, bottom: 34, left: 60 };
  const points = Array.isArray(series) ? series : [];
  if (points.length === 0) {
    return {
      width,
      height,
      margin,
      points: [],
      path: '',
      yTicks: [],
      range: { min: 0, max: 0 }
    };
  }

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const prices = points.map((p) => Number(p.priceUsd));
  let minPrice = Math.min(...prices);
  let maxPrice = Math.max(...prices);
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) {
    minPrice = 0;
    maxPrice = 0;
  }
  const spread = maxPrice - minPrice;
  const pad = spread > 0 ? spread * 0.14 : Math.max(minPrice * 0.002, 0.8);
  const yMin = Math.max(0, minPrice - pad);
  const yMax = maxPrice + pad;

  const mapped = points.map((row, idx) => {
    const x = margin.left + (points.length === 1 ? innerWidth : (idx / (points.length - 1)) * innerWidth);
    const ratio = (Number(row.priceUsd) - yMin) / Math.max(yMax - yMin, 0.000001);
    const y = margin.top + (1 - ratio) * innerHeight;
    return {
      ...row,
      x,
      y
    };
  });

  const path = mapped
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
    .join(' ');

  const yTicks = Array.from({ length: 5 }).map((_, idx) => {
    const ratio = idx / 4;
    const value = yMax - ratio * (yMax - yMin);
    const y = margin.top + ratio * innerHeight;
    return { y, value };
  });

  return {
    width,
    height,
    margin,
    points: mapped,
    path,
    yTicks,
    range: { min: yMin, max: yMax }
  };
}

function App() {
  const [route, setRoute] = useState(() => readRouteFromPathname());
  const [walletState, setWalletState] = useState({ ownerAddress: '', aaAddress: '' });
  const [showSetup, setShowSetup] = useState(false);

  const [records, setRecords] = useState([]);
  const [kpi, setKpi] = useState({ pending: 0, paid: 0, failed: 0, todaySpend: 0 });
  const [series, setSeries] = useState([]);
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
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [flyAnim, setFlyAnim] = useState(null);

  const flowPriceRef = useRef(null);
  const chartPriceRef = useRef(null);

  const isOpsPage = route === 'ops';

  const navigate = useCallback((nextRoute) => {
    const target = nextRoute === 'ops' ? '/ops' : '/';
    try {
      if (window.location.pathname !== target) {
        window.history.pushState({}, '', `${target}${window.location.search}${window.location.hash}`);
      }
    } catch {
      // ignore history errors
    }
    setRoute(nextRoute === 'ops' ? 'ops' : 'demo');
    if (nextRoute !== 'ops') setShowSetup(false);
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

  const triggerPriceFlight = useCallback((quote) => {
    const startEl = flowPriceRef.current;
    const endEl = chartPriceRef.current;
    if (!startEl || !endEl) return;

    const start = startEl.getBoundingClientRect();
    const end = endEl.getBoundingClientRect();
    const text = `$${formatPrice(quote?.priceUsd)}`;
    const id = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    setFlyAnim({
      id,
      text,
      x1: start.left + start.width / 2,
      y1: start.top + start.height / 2,
      x2: end.left + end.width / 2,
      y2: end.top + end.height / 2,
      active: false
    });
  }, []);

  useEffect(() => {
    normalizeRoutePath();
    const onPopState = () => {
      normalizeRoutePath();
      setRoute(readRouteFromPathname());
      setShowSetup(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!flyAnim?.id) return undefined;
    const raf = requestAnimationFrame(() => {
      setFlyAnim((prev) => (prev ? { ...prev, active: true } : prev));
    });
    const timer = setTimeout(() => setFlyAnim(null), 900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [flyAnim?.id]);

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
        const [mappingPayload, identityPayload, seriesPayload] = await Promise.all([
          fetchJson('/api/x402/mapping/latest', { limit: RECORD_LIMIT }),
          fetchJson('/api/demo/identity/latest').catch(() => null),
          fetchJson('/api/demo/price-series', { limit: CHART_POINT_LIMIT }).catch(() => ({ series: [] }))
        ]);

        const items = Array.isArray(mappingPayload?.items) ? mappingPayload.items : [];
        setRecords(items);
        setKpi({
          pending: Number(mappingPayload?.kpi?.pending || 0),
          paid: Number(mappingPayload?.kpi?.paid || 0),
          failed: Number(mappingPayload?.kpi?.failed || 0),
          todaySpend: Number(mappingPayload?.kpi?.todaySpend || 0)
        });

        if (identityPayload?.ok) setIdentityLatest(identityPayload.latest || null);

        const points = normalizeSeriesPoints(seriesPayload?.series || []).slice(-CHART_POINT_LIMIT);
        setSeries(points);

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
    void loadSnapshot();
    const timer = setInterval(() => {
      void loadSnapshot();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadSnapshot]);

  useEffect(() => {
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
        const eventTraceId = String(payload?.traceId || '').trim();

        setEvents((prev) => {
          const next = [
            {
              id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
              name: eventName,
              label: meta.label,
              state: meta.state,
              stepId: meta.stepId,
              traceId: eventTraceId,
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

        if (eventName === 'unlocked' && payload?.quote) {
          const quotePayload = payload.quote;
          const point = normalizeSeriesPoints([
            {
              t: quotePayload?.fetchedAt || new Date().toISOString(),
              priceUsd: quotePayload?.priceUsd,
              provider: quotePayload?.provider,
              requestId: payload?.requestId || '',
              traceId: eventTraceId
            }
          ])[0];
          if (point) {
            setSeries((prev) => appendSeriesPoint(prev, point, 300).slice(-CHART_POINT_LIMIT));
            triggerPriceFlight(quotePayload);
          }
        }

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
  }, [loadSnapshot, loadTrace, streamToken, triggerPriceFlight]);

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

  const chartSeries = useMemo(() => normalizeSeriesPoints(series).slice(-CHART_POINT_LIMIT), [series]);
  const chartModel = useMemo(() => buildChartModel(chartSeries), [chartSeries]);
  const latestPoint = chartSeries.length > 0 ? chartSeries[chartSeries.length - 1] : null;
  const activePoint =
    hoverIndex >= 0 && hoverIndex < chartModel.points.length ? chartModel.points[hoverIndex] : latestPoint;

  const renderTraceList = () => {
    if (records.length === 0) {
      return <p className="empty-text">No x402 records yet.</p>;
    }
    return records.slice(0, 14).map((item, idx) => {
      const traceId = String(item?.workflowTraceId || '').trim();
      const visual = toVisualState(item);
      return (
        <button
          type="button"
          key={`${item.requestId || 'row'}_${idx}`}
          className={`trace-row ${selectedTraceId === traceId ? 'active' : ''}`}
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
          <span className={`status-pill ${visual}`}>{item.workflowState || item.status || '-'}</span>
          <span>{formatTime(item.workflowUpdatedAt || item.paidAt || item.createdAt)}</span>
        </button>
      );
    });
  };

  const renderDemoPage = () => (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="header-kicker">KITE TESTNET</p>
          <h1>BTC Agent Price Demo</h1>
          <p className="header-subtitle">
            Open with one glance: paid BTC price points on chart, and the ERC8004 + x402 workflow beside it.
          </p>
        </div>
        <div className="header-actions">
          <span className={`connection-pill ${streamMode}`}>{statusText(streamMode)}</span>
          <span className="sync-text">Last sync: {formatTime(lastSyncAt)}</span>
          <button type="button" className="ghost-btn" onClick={triggerDemoRun} disabled={triggering}>
            {triggering ? 'Running...' : 'Run Demo'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('ops')}>
            Open Ops
          </button>
          {!VIEWER_API_KEY && streamMode !== 'live' ? (
            <button type="button" className="ghost-btn" onClick={() => setStreamToken((x) => x + 1)}>
              Retry SSE
            </button>
          ) : null}
        </div>
      </header>

      {errorText ? <p className="error-banner">{errorText}</p> : null}

      <main className="demo-layout">
        <section className="panel chart-panel">
          <div className="panel-head">
            <h2>Paid BTC Price Line</h2>
            <span className="panel-note">last {CHART_POINT_LIMIT} unlocked points</span>
          </div>

          <div className="chart-topline">
            <span className="muted-label">Latest</span>
            <strong ref={chartPriceRef} className="latest-price-tag">
              {latestPoint ? `$${formatPrice(latestPoint.priceUsd)}` : '-'}
            </strong>
            <span className="muted-text">
              {latestPoint ? `${latestPoint.provider}  ${formatTime(latestPoint.t)}` : 'waiting for paid BTC points'}
            </span>
          </div>

          <div className="chart-wrap">
            {chartModel.points.length === 0 ? (
              <div className="chart-empty">No paid BTC points yet. Click `Run Demo` to generate the first point.</div>
            ) : (
              <svg
                className="chart-svg"
                viewBox={`0 0 ${chartModel.width} ${chartModel.height}`}
                role="img"
                aria-label="BTC paid price line chart"
              >
                {chartModel.yTicks.map((tick, idx) => (
                  <g key={`grid_${idx}`}>
                    <line
                      x1={chartModel.margin.left}
                      y1={tick.y}
                      x2={chartModel.width - chartModel.margin.right}
                      y2={tick.y}
                      className="chart-grid"
                    />
                    <text x={14} y={tick.y + 4} className="chart-axis-label">
                      {formatPrice(tick.value)}
                    </text>
                  </g>
                ))}

                <path d={chartModel.path} className="chart-line" />

                {chartModel.points.map((pt, idx) => {
                  const isLatest = idx === chartModel.points.length - 1;
                  return (
                    <circle
                      key={`pt_${pt.requestId}_${idx}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={isLatest ? 5.3 : 3.2}
                      className={`chart-point ${isLatest ? 'latest' : ''}`}
                      onMouseEnter={() => setHoverIndex(idx)}
                      onMouseLeave={() => setHoverIndex(-1)}
                    />
                  );
                })}
              </svg>
            )}
          </div>

          <div className="chart-meta">
            <span>{chartSeries.length} points</span>
            <span>
              range: {formatPrice(chartModel.range.min)} - {formatPrice(chartModel.range.max)}
            </span>
            <span>source: x402 unlocked only</span>
          </div>

          {activePoint ? (
            <div className="chart-tooltip">
              <span>{formatTime(activePoint.t)}</span>
              <strong>${formatPrice(activePoint.priceUsd)}</strong>
              <span>{activePoint.provider}</span>
              <span>{shortenMiddle(activePoint.requestId, 10, 8)}</span>
            </div>
          ) : null}
        </section>

        <section className="panel flow-panel">
          <div className="panel-head">
            <h2>ERC8004 + x402 Flow</h2>
            <span className={`status-pill ${traceState}`}>{traceState}</span>
          </div>
          <p className="flow-meta">Trace: {shortenMiddle(selectedTraceId || traceData?.traceId || '-', 14, 8)}</p>
          <p className="flow-meta">Request: {shortenMiddle(currentRequest?.requestId || currentWorkflow?.requestId || '-', 14, 8)}</p>

          <ol className="flow-step-list">
            {timeline.map((step, idx) => (
              <li key={step.id} className={`flow-step-card ${step.state} ${stepFlash === step.id ? 'flash' : ''}`}>
                <div className="flow-step-top">
                  <span className="flow-index">{idx + 1}</span>
                  <strong>{step.label}</strong>
                  <span className={`status-pill mini ${step.state}`}>{step.state}</span>
                </div>
                <p className="flow-step-detail">{step.detail || 'waiting...'}</p>
                {step.id === 'api_result' ? (
                  <div className="flow-price-row">
                    <span className="muted-label">Quote</span>
                    <strong ref={flowPriceRef} className="flow-price-tag">
                      {quote ? `$${formatPrice(quote.priceUsd)}` : '-'}
                    </strong>
                    <span className="muted-text">{quote?.provider || '-'}</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="flow-summary">
            <p className="muted-label">Summary</p>
            <p>
              {currentWorkflow?.error ||
                currentWorkflow?.result?.summary ||
                currentRequest?.result?.summary ||
                (traceLoading ? 'Loading trace details...' : 'Waiting for workflow events...')}
            </p>
          </div>
        </section>
      </main>

      {flyAnim ? (
        <div
          className={`price-fly-token ${flyAnim.active ? 'active' : ''}`}
          style={{
            left: `${flyAnim.active ? flyAnim.x2 : flyAnim.x1}px`,
            top: `${flyAnim.active ? flyAnim.y2 : flyAnim.y1}px`
          }}
        >
          {flyAnim.text}
        </div>
      ) : null}
    </div>
  );

  const renderOpsPage = () => (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="header-kicker">KITE TESTNET / OPS</p>
          <h1>Operations Console</h1>
          <p className="header-subtitle">KPI, traces, live stream events and session setup live here.</p>
        </div>
        <div className="header-actions">
          <span className={`connection-pill ${streamMode}`}>{statusText(streamMode)}</span>
          <span className="sync-text">Last sync: {formatTime(lastSyncAt)}</span>
          <button type="button" className="ghost-btn" onClick={() => void loadSnapshot({ manual: true })} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="ghost-btn" onClick={triggerDemoRun} disabled={triggering}>
            {triggering ? 'Running...' : 'Run Demo'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('demo')}>
            Back to Demo
          </button>
        </div>
      </header>

      {errorText ? <p className="error-banner">{errorText}</p> : null}

      <section className="kpi-grid">
        <article className="kpi-card">
          <span>Pending</span>
          <strong>{kpi.pending}</strong>
        </article>
        <article className="kpi-card">
          <span>Paid</span>
          <strong>{kpi.paid}</strong>
        </article>
        <article className="kpi-card">
          <span>Failed</span>
          <strong>{kpi.failed}</strong>
        </article>
        <article className="kpi-card">
          <span>Today Spend</span>
          <strong>{kpi.todaySpend}</strong>
        </article>
      </section>

      <main className="ops-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Recent Traces</h2>
            <span className="panel-note">click to replay</span>
          </div>
          <div className="trace-list">{renderTraceList()}</div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Live Event Feed</h2>
            <span className="panel-note">SSE events</span>
          </div>
          <ul className="event-list">
            {events.length === 0 ? (
              <li className="empty-text">Waiting for workflow events...</li>
            ) : (
              events.map((item) => (
                <li key={item.id} className={`event-row ${item.state}`}>
                  <span className={`event-dot ${item.state}`} />
                  <span>{item.label}</span>
                  <span>{shortenMiddle(item.traceId, 12, 8)}</span>
                  <span>{formatTime(item.at)}</span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="panel ops-evidence">
          <div className="panel-head">
            <h2>Evidence Drawer</h2>
            <span className="panel-note">x402 + ERC8004</span>
          </div>
          <div className="evidence-grid">
            <article className="evidence-card">
              <h3>Identity</h3>
              <p>agentId: {currentRequest?.identity?.agentId || '-'}</p>
              <p>registry: {shortenMiddle(currentRequest?.identity?.registry || '-', 12, 10)}</p>
              <p>verify: {identityLatest?.status || '-'}</p>
              <p>wallet: {shortenMiddle(identityLatest?.identity?.agentWallet || '-', 12, 10)}</p>
            </article>
            <article className="evidence-card">
              <h3>x402 Payment</h3>
              <p>amount: {currentRequest?.amount || '-'}</p>
              <p>token: {shortenMiddle(currentRequest?.tokenAddress || '-', 12, 10)}</p>
              <p>recipient: {shortenMiddle(currentRequest?.recipient || '-', 12, 10)}</p>
              <p>txHash: {shortenMiddle(currentRequest?.paymentTxHash || currentWorkflow?.txHash || '-', 12, 10)}</p>
            </article>
            <article className="evidence-card">
              <h3>API Result</h3>
              <p>provider: {quote?.provider || '-'}</p>
              <p>price: {quote?.priceUsd ?? '-'}</p>
              <p>pair: {quote?.pair || 'BTCUSDT'}</p>
              <p>at: {formatTime(quote?.fetchedAt || '')}</p>
            </article>
            <article className="evidence-card">
              <h3>Workflow</h3>
              <p>state: {currentWorkflow?.state || '-'}</p>
              <p>updated: {formatTime(currentWorkflow?.updatedAt || '')}</p>
              <p>payer: {shortenMiddle(currentWorkflow?.payer || '-', 12, 10)}</p>
              <p>flow: {currentRequest?.a2a ? 'a2a+x402' : 'agent-to-api+x402'}</p>
            </article>
          </div>
        </section>
      </main>

      <section className="panel session-panel">
        <div className="panel-head">
          <h2>Session Setup</h2>
          <span className="panel-note">ops only</span>
        </div>
        <p className="header-subtitle">Manage session key and policy here. Hidden from the home demo page.</p>
        <div className="session-actions">
          <button type="button" className="ghost-btn" onClick={connectWallet}>
            {walletState.ownerAddress ? `Wallet: ${shortenMiddle(walletState.ownerAddress, 10, 8)}` : 'Connect Wallet'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => setShowSetup((prev) => !prev)}>
            {showSetup ? 'Hide Session Setup' : 'Open Session Setup'}
          </button>
        </div>
        {showSetup ? <AgentSettingsPage onBack={() => setShowSetup(false)} walletState={walletState} /> : null}
      </section>
    </div>
  );

  return isOpsPage ? renderOpsPage() : renderDemoPage();
}

export default App;
