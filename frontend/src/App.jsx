import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import AgentSettingsPage from './AgentSettingsPage';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const VIEWER_API_KEY = String(import.meta.env.VITE_API_KEY_VIEWER || import.meta.env.VITE_API_KEY || '').trim();
const AGENT_API_KEY = String(import.meta.env.VITE_API_KEY_AGENT || import.meta.env.VITE_API_KEY || '').trim();
const ADMIN_API_KEY = String(import.meta.env.VITE_API_KEY_ADMIN || import.meta.env.VITE_API_KEY || '').trim();

const POLL_INTERVAL_MS = 8000;
const RECORD_LIMIT = 80;
const CHART_POINT_LIMIT = 60;

const STEP_ORDER = ['identity', 'challenge', 'payment', 'proof', 'api_result', 'onchain'];
const STEP_LABELS = {
  identity: 'ERC8004 Identity',
  challenge: 'x402 Challenge',
  payment: 'Payment Sent',
  proof: 'Proof Verified',
  api_result: 'API Result',
  onchain: 'On-chain Confirmation'
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

async function postJson(path, body = {}, apiKey = VIEWER_API_KEY) {
  const response = await fetch(resolveApiUrl(path), {
    method: 'POST',
    headers: {
      ...buildHeaders(apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });
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

function fullText(text) {
  const value = String(text || '').trim();
  return value || '-';
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

function readTraceRequestIdFromPathname() {
  const path = String(window.location.pathname || '/').trim();
  const match = path.match(/^\/trace(?:\/([^/]+))?\/?$/i);
  if (!match) return '';
  const raw = String(match[1] || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw;
  }
}

function readRouteFromPathname() {
  const path = String(window.location.pathname || '/').trim();
  if (path === '/ops') return 'ops';
  if (path === '/market') return 'market';
  if (/^\/trace(?:\/|$)/i.test(path)) return 'trace';
  return 'demo';
}

function normalizeRoutePath() {
  const path = String(window.location.pathname || '/').trim();
  if (path === '/' || path === '/ops' || path === '/market' || /^\/trace(?:\/[^/]+)?\/?$/i.test(path)) return;
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
  const [traceRequestId, setTraceRequestId] = useState(() => readTraceRequestIdFromPathname());
  const [traceRequestInput, setTraceRequestInput] = useState(() => readTraceRequestIdFromPathname());
  const [walletState, setWalletState] = useState({ ownerAddress: '', aaAddress: '' });
  const [showSetup, setShowSetup] = useState(false);

  const [records, setRecords] = useState([]);
  const [kpi, setKpi] = useState({ pending: 0, paid: 0, failed: 0, todaySpend: 0 });
  const [series, setSeries] = useState([]);
  const [selectedTraceId, setSelectedTraceId] = useState('');
  const [traceData, setTraceData] = useState(null);
  const [identityLatest, setIdentityLatest] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState('');
  const [errorText, setErrorText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [failTriggering, setFailTriggering] = useState(false);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [readerExpanded, setReaderExpanded] = useState(false);
  const [readerCopied, setReaderCopied] = useState(false);
  const [readerFullExcerpt, setReaderFullExcerpt] = useState(null);
  const [readerExcerptLoading, setReaderExcerptLoading] = useState(false);
  const [opsCopiedField, setOpsCopiedField] = useState('');
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [serviceReceipts, setServiceReceipts] = useState([]);
  const [marketRefreshing, setMarketRefreshing] = useState(false);
  const [publishingService, setPublishingService] = useState(false);
  const [invokingService, setInvokingService] = useState(false);
  const [serviceStatusLoading, setServiceStatusLoading] = useState(false);
  const [selectedServiceStatus, setSelectedServiceStatus] = useState(null);
  const [selectedServiceReputation, setSelectedServiceReputation] = useState(null);
  const [agentReputationRows, setAgentReputationRows] = useState([]);
  const [invokePayer, setInvokePayer] = useState('');
  const [serviceForm, setServiceForm] = useState({
    id: '',
    action: 'btc-price-feed',
    name: 'BTCUSD Quote Service',
    description: 'Pay-per-call BTCUSD quote via ERC8004 + x402.',
    pair: 'BTCUSDT',
    source: 'hyperliquid',
    resourceUrl: 'https://x.com/Kite_AI',
    maxChars: '1200',
    price: '0.00001',
    tags: 'atapi,x402,btc',
    horizonMin: '60',
    slaMs: '12000',
    rateLimitPerMinute: '12',
    budgetPerDay: '0.06',
    allowlistPayers: '',
    active: true
  });

  const flowPriceRef = useRef(null);
  const chartPriceRef = useRef(null);
  const traceFetchRef = useRef({ token: 0, traceId: '' });
  const readerCopyTimerRef = useRef(null);
  const opsCopyTimerRef = useRef(null);

  const isOpsPage = route === 'ops';
  const isMarketPage = route === 'market';
  const isTracePage = route === 'trace';

  const navigate = useCallback((nextRoute) => {
    const target = nextRoute === 'ops' ? '/ops' : nextRoute === 'market' ? '/market' : '/';
    try {
      if (window.location.pathname !== target) {
        window.history.pushState({}, '', `${target}${window.location.search}${window.location.hash}`);
      }
    } catch {
      // ignore history errors
    }
    const normalizedRoute = nextRoute === 'ops' ? 'ops' : nextRoute === 'market' ? 'market' : 'demo';
    setRoute(normalizedRoute);
    if (normalizedRoute !== 'ops') setShowSetup(false);
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
    normalizeRoutePath();
    const onPopState = () => {
      normalizeRoutePath();
      const nextRoute = readRouteFromPathname();
      const nextRequestId = readTraceRequestIdFromPathname();
      setRoute(nextRoute);
      setTraceRequestId(nextRequestId);
      setTraceRequestInput(nextRequestId);
      setShowSetup(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    setReaderExpanded(false);
    setReaderCopied(false);
    setReaderFullExcerpt(null);
    setReaderExcerptLoading(false);
    setOpsCopiedField('');
    if (readerCopyTimerRef.current) {
      clearTimeout(readerCopyTimerRef.current);
      readerCopyTimerRef.current = null;
    }
    if (opsCopyTimerRef.current) {
      clearTimeout(opsCopyTimerRef.current);
      opsCopyTimerRef.current = null;
    }
  }, [selectedTraceId]);

  useEffect(
    () => () => {
      if (readerCopyTimerRef.current) {
        clearTimeout(readerCopyTimerRef.current);
        readerCopyTimerRef.current = null;
      }
      if (opsCopyTimerRef.current) {
        clearTimeout(opsCopyTimerRef.current);
        opsCopyTimerRef.current = null;
      }
    },
    []
  );

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
      traceFetchRef.current = { token: traceFetchRef.current.token + 1, traceId: '' };
      setTraceData(null);
      return;
    }
    const token = traceFetchRef.current.token + 1;
    traceFetchRef.current = { token, traceId: normalized };
    setTraceLoading(true);
    try {
      const payload = await fetchJson(`/api/demo/trace/${encodeURIComponent(normalized)}`);
      if (traceFetchRef.current.token !== token || traceFetchRef.current.traceId !== normalized) return;
      setTraceData(payload);
    } catch (error) {
      if (traceFetchRef.current.token !== token || traceFetchRef.current.traceId !== normalized) return;
      setErrorText(error.message || 'Failed to load demo trace.');
    } finally {
      if (traceFetchRef.current.token === token) setTraceLoading(false);
    }
  }, []);

  const loadTraceByRequest = useCallback(
    async (requestId) => {
      const normalized = String(requestId || '').trim();
      if (!normalized) return;
      try {
        const payload = await fetchJson(`/api/demo/trace-by-request/${encodeURIComponent(normalized)}`);
        const traceId = String(payload?.traceId || '').trim();
        if (!traceId) throw new Error('Trace id missing for this request.');
        setSelectedTraceId(traceId);
        await loadTrace(traceId);
      } catch (error) {
        setErrorText(error?.message || 'Failed to replay by requestId.');
      }
    },
    [loadTrace]
  );

  const openTracePage = useCallback(
    (requestIdRaw = '') => {
      const requestId = String(requestIdRaw || '').trim();
      const target = requestId ? `/trace/${encodeURIComponent(requestId)}` : '/trace';
      try {
        if (window.location.pathname !== target) {
          window.history.pushState({}, '', `${target}${window.location.search}${window.location.hash}`);
        }
      } catch {
        // ignore history errors
      }
      setRoute('trace');
      setShowSetup(false);
      setTraceRequestId(requestId);
      setTraceRequestInput(requestId);
      if (!requestId) {
        setSelectedTraceId('');
        setTraceData(null);
        return;
      }
      if (route === 'trace' && requestId === String(traceRequestId || '').trim()) {
        void loadTraceByRequest(requestId);
      }
    },
    [loadTraceByRequest, route, traceRequestId]
  );

  const submitTraceLookup = useCallback(
    (event) => {
      event?.preventDefault?.();
      const requestId = String(traceRequestInput || '').trim();
      if (!requestId) {
        setErrorText('Enter a requestId first.');
        return;
      }
      setErrorText('');
      openTracePage(requestId);
    },
    [openTracePage, traceRequestInput]
  );

  const loadSnapshot = useCallback(
    async ({ manual = false, forceTraceId = '' } = {}) => {
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
        const latestPoint = points.length > 0 ? points[points.length - 1] : null;
        const latestPointTraceId = String(latestPoint?.traceId || '').trim();
        const latestRequestId = String(latestPoint?.requestId || '').trim();
        const traceFromLatestPoint =
          latestPointTraceId ||
          (latestRequestId
            ? String(items.find((item) => String(item?.requestId || '').trim() === latestRequestId)?.workflowTraceId || '').trim()
            : '');
        const pinnedTraceId = String(forceTraceId || '').trim();
        const nextTraceId = String(
          route === 'demo'
            ? pinnedTraceId || selectedTraceId || traceFromLatestPoint || traceInRows || ''
            : pinnedTraceId || selectedTraceId || traceInRows || ''
        ).trim();
        if (nextTraceId) {
          setSelectedTraceId(nextTraceId);
          await loadTrace(nextTraceId);
        }

        setLastSyncAt(new Date().toISOString());
      } catch (error) {
        setErrorText(error.message || 'Failed to load demo snapshot.');
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [loadTrace, route, selectedTraceId]
  );

  const loadServiceReceipts = useCallback(async (serviceId, { silent = false } = {}) => {
    const normalized = String(serviceId || '').trim();
    if (!normalized) {
      setServiceReceipts([]);
      return;
    }
    try {
      const payload = await fetchJson(`/api/services/${encodeURIComponent(normalized)}/receipts`, { limit: 24 });
      setServiceReceipts(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      if (!silent) setErrorText(error?.message || 'Failed to load service receipts.');
    }
  }, []);

  const loadServiceStatus = useCallback(async (serviceId, { silent = false } = {}) => {
    const normalized = String(serviceId || '').trim();
    if (!normalized) {
      setSelectedServiceStatus(null);
      setSelectedServiceReputation(null);
      return;
    }
    setServiceStatusLoading(true);
    try {
      const payload = await fetchJson(`/api/services/${encodeURIComponent(normalized)}/status`);
      setSelectedServiceStatus(payload?.status || null);
      setSelectedServiceReputation(payload?.reputation || null);
    } catch (error) {
      if (!silent) setErrorText(error?.message || 'Failed to load service status.');
    } finally {
      setServiceStatusLoading(false);
    }
  }, []);

  const loadAgentReputation = useCallback(async ({ silent = false } = {}) => {
    try {
      const payload = await fetchJson('/api/reputation/agents');
      setAgentReputationRows(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      if (!silent) setErrorText(error?.message || 'Failed to load reputation board.');
    }
  }, []);

  const loadServiceCatalog = useCallback(
    async ({ manual = false, forceServiceId = '' } = {}) => {
      if (manual) setMarketRefreshing(true);
      try {
        const payload = await fetchJson('/api/services', { limit: 80 });
        const rows = Array.isArray(payload?.items) ? payload.items : [];
        setServices(rows);
        const targetId = String(forceServiceId || selectedServiceId || rows[0]?.id || '').trim();
        if (targetId) {
          setSelectedServiceId(targetId);
          await loadServiceReceipts(targetId, { silent: true });
          await loadServiceStatus(targetId, { silent: true });
        } else {
          setServiceReceipts([]);
          setSelectedServiceStatus(null);
          setSelectedServiceReputation(null);
        }
        await loadAgentReputation({ silent: true });
        setLastSyncAt(new Date().toISOString());
      } catch (error) {
        setErrorText(error?.message || 'Failed to load service catalog.');
      } finally {
        if (manual) setMarketRefreshing(false);
      }
    },
    [loadAgentReputation, loadServiceReceipts, loadServiceStatus, selectedServiceId]
  );

  const fillInvokePayerFromRuntime = useCallback(async () => {
    try {
      const payload = await fetchJson('/api/session/runtime');
      const payer = String(payload?.runtime?.aaWallet || '').trim();
      if (!payer) throw new Error('No AA wallet found in runtime.');
      setInvokePayer(payer);
      setErrorText('');
    } catch (error) {
      setErrorText(error?.message || 'Failed to read runtime payer.');
    }
  }, []);

  const publishService = useCallback(async () => {
    setPublishingService(true);
    setErrorText('');
    try {
      const adminKey = ADMIN_API_KEY || AGENT_API_KEY || VIEWER_API_KEY;
      const payload = await postJson(
        '/api/services/publish',
        {
          id: serviceForm.id || undefined,
          action: serviceForm.action || 'btc-price-feed',
          name: serviceForm.name,
          description: serviceForm.description,
          pair: serviceForm.pair || 'BTCUSDT',
          source: serviceForm.source || 'hyperliquid',
          resourceUrl: serviceForm.resourceUrl || '',
          maxChars: Number(serviceForm.maxChars || 1200),
          price: serviceForm.price || '0.00001',
          tags: String(serviceForm.tags || '').split(',').map((item) => item.trim()).filter(Boolean),
          horizonMin: Number(serviceForm.horizonMin || 60),
          slaMs: Number(serviceForm.slaMs || 12000),
          rateLimitPerMinute: Number(serviceForm.rateLimitPerMinute || 12),
          budgetPerDay: Number(serviceForm.budgetPerDay || 0),
          allowlistPayers: String(serviceForm.allowlistPayers || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          active: serviceForm.active !== false
        },
        adminKey
      );
      const serviceId = String(payload?.service?.id || '').trim();
      if (serviceId) {
        setSelectedServiceId(serviceId);
        setServiceForm((prev) => ({ ...prev, id: serviceId }));
      }
      await loadServiceCatalog({ forceServiceId: serviceId });
    } catch (error) {
      setErrorText(error?.message || 'Publish service failed.');
    } finally {
      setPublishingService(false);
    }
  }, [loadServiceCatalog, serviceForm]);

  const toggleServiceActive = useCallback(async () => {
    const serviceId = String(selectedServiceId || '').trim();
    if (!serviceId) return;
    const selected = services.find((item) => String(item?.id || '').trim() === serviceId);
    if (!selected) return;
    const adminKey = ADMIN_API_KEY || AGENT_API_KEY || VIEWER_API_KEY;
    try {
      setErrorText('');
      if (selected.active === false) {
        await postJson(`/api/services/${encodeURIComponent(serviceId)}/unrevoke`, {}, adminKey);
      } else {
        await postJson(`/api/services/${encodeURIComponent(serviceId)}/revoke`, {}, adminKey);
      }
      await loadServiceCatalog({ forceServiceId: serviceId });
    } catch (error) {
      setErrorText(error?.message || 'Failed to toggle service active state.');
    }
  }, [selectedServiceId, services, loadServiceCatalog]);

  const invokeSelectedService = useCallback(async () => {
    const serviceId = String(selectedServiceId || '').trim();
    if (!serviceId) {
      setErrorText('Select a service first.');
      return;
    }
    setInvokingService(true);
    setErrorText('');
    try {
      const headers = {
        ...buildHeaders(AGENT_API_KEY || ADMIN_API_KEY || VIEWER_API_KEY),
        'Content-Type': 'application/json'
      };
      const resp = await fetch(resolveApiUrl(`/api/services/${encodeURIComponent(serviceId)}/invoke`), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          payer: String(invokePayer || '').trim() || undefined
        })
      });
      const payload = await resp.json().catch(() => ({}));
      const traceId = String(payload?.traceId || payload?.workflow?.traceId || '').trim();
      if (traceId) {
        setSelectedTraceId(traceId);
        await loadTrace(traceId);
      }
      await loadSnapshot({ forceTraceId: traceId });
      await loadServiceReceipts(serviceId);
      if (!resp.ok || payload?.ok === false) {
        setErrorText(payload?.reason || payload?.error || `HTTP ${resp.status}`);
      }
    } catch (error) {
      setErrorText(error?.message || 'Invoke service failed.');
    } finally {
      setInvokingService(false);
    }
  }, [invokePayer, loadServiceReceipts, loadSnapshot, loadTrace, selectedServiceId]);

  const downloadReceipt = useCallback(async (requestIdRaw = '') => {
    const requestId = String(requestIdRaw || '').trim();
    if (!requestId) {
      setErrorText('No requestId found for receipt download.');
      return;
    }
    try {
      setErrorText('');
      const resp = await fetch(
        resolveApiUrl(`/api/receipt/${encodeURIComponent(requestId)}`, { download: 1 }),
        { headers: buildHeaders() }
      );
      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        throw new Error(payload?.reason || payload?.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `kiteclaw_receipt_${requestId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setErrorText(error?.message || 'Receipt download failed.');
    }
  }, []);

  const copyReaderDigest = useCallback(async (textRaw = '') => {
    const text = String(textRaw || '').trim();
    if (!text) {
      setErrorText('No digest text to copy.');
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        if (!ok) throw new Error('clipboard_copy_failed');
      }
      setReaderCopied(true);
      if (readerCopyTimerRef.current) clearTimeout(readerCopyTimerRef.current);
      readerCopyTimerRef.current = setTimeout(() => {
        setReaderCopied(false);
        readerCopyTimerRef.current = null;
      }, 1600);
    } catch (error) {
      setErrorText(error?.message || 'Failed to copy digest.');
    }
  }, []);

  const loadFullReaderExcerpt = useCallback(async (requestIdRaw = '', refresh = false) => {
    const requestId = String(requestIdRaw || '').trim();
    if (!requestId) {
      setErrorText('No requestId found for excerpt lookup.');
      return;
    }
    setReaderExcerptLoading(true);
    try {
      setErrorText('');
      const payload = await fetchJson(`/api/receipt/${encodeURIComponent(requestId)}/excerpt`, {
        maxChars: 20000,
        refresh: refresh ? 1 : undefined
      });
      const excerptPayload = payload?.excerpt || null;
      if (!excerptPayload || !String(excerptPayload?.excerpt || '').trim()) {
        throw new Error('excerpt missing');
      }
      setReaderFullExcerpt(excerptPayload);
      setReaderExpanded(true);
    } catch (error) {
      setErrorText(error?.message || 'Failed to load full excerpt.');
    } finally {
      setReaderExcerptLoading(false);
    }
  }, []);

  const copyOpsField = useCallback(async (textRaw = '', field = 'value') => {
    const text = String(textRaw || '').trim();
    if (!text || text === '-') {
      setErrorText('No value to copy.');
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        if (!ok) throw new Error('clipboard_copy_failed');
      }
      setOpsCopiedField(field);
      if (opsCopyTimerRef.current) clearTimeout(opsCopyTimerRef.current);
      opsCopyTimerRef.current = setTimeout(() => {
        setOpsCopiedField('');
        opsCopyTimerRef.current = null;
      }, 1400);
    } catch (error) {
      setErrorText(error?.message || 'Failed to copy value.');
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
    const timer = setInterval(() => {
      void loadSnapshot();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadSnapshot]);

  useEffect(() => {
    if (route !== 'market') return undefined;
    void loadServiceCatalog();
    const timer = setInterval(() => {
      void loadServiceCatalog();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadServiceCatalog, route]);

  useEffect(() => {
    if (route !== 'trace') return;
    const requestId = String(traceRequestId || '').trim();
    if (!requestId) {
      setSelectedTraceId('');
      setTraceData(null);
      return;
    }
    void loadTraceByRequest(requestId);
  }, [loadTraceByRequest, route, traceRequestId]);

  const triggerDemoRun = useCallback(async () => {
    setTriggering(true);
    setErrorText('');
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
        await loadSnapshot({ forceTraceId: traceId });
        return;
      }
      await loadSnapshot();
    } catch (error) {
      setErrorText(error.message || 'Trigger demo run failed.');
    } finally {
      setTriggering(false);
    }
  }, [loadSnapshot, loadTrace]);

  const triggerFailDemo = useCallback(async () => {
    setFailTriggering(true);
    setErrorText('');
    let payer = String(traceData?.workflow?.payer || '').trim();
    let revoked = false;
    try {
      if (!payer) {
        const runtimePayload = await fetchJson('/api/session/runtime');
        payer = String(runtimePayload?.runtime?.aaWallet || '').trim();
      }
      if (!payer) {
        throw new Error('No payer address found. Configure session runtime first.');
      }

      const adminKey = ADMIN_API_KEY || AGENT_API_KEY || VIEWER_API_KEY;
      await postJson('/api/policy/revoke', { payer }, adminKey);
      revoked = true;

      const headers = {
        ...buildHeaders(AGENT_API_KEY || adminKey),
        'Content-Type': 'application/json'
      };
      const runResp = await fetch(resolveApiUrl('/api/workflow/btc-price/run'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ pair: 'BTCUSDT', source: 'hyperliquid', payer })
      });
      const runPayload = await runResp.json().catch(() => ({}));
      const traceId = String(runPayload?.traceId || runPayload?.workflow?.traceId || '').trim();
      if (traceId) {
        setSelectedTraceId(traceId);
        await loadTrace(traceId);
        await loadSnapshot({ forceTraceId: traceId });
      } else {
        await loadSnapshot();
      }

      if (!runResp.ok || runPayload?.ok === false) {
        const reason = runPayload?.reason || runPayload?.error || `HTTP ${runResp.status}`;
        setErrorText(`Fail demo complete: guardrail blocked payment (${reason}).`);
      } else {
        setErrorText('Fail demo did not fail. Check policy permissions and API keys.');
      }
    } catch (error) {
      setErrorText(error?.message || 'Fail demo failed.');
    } finally {
      if (revoked && payer) {
        const adminKey = ADMIN_API_KEY || AGENT_API_KEY || VIEWER_API_KEY;
        try {
          await postJson('/api/policy/unrevoke', { payer }, adminKey);
        } catch (recoveryError) {
          setErrorText((prev) => {
            const base = String(prev || '').trim();
            const reason = recoveryError?.message || 'auto-recover failed';
            return base ? `${base} | Recovery: ${reason}` : `Recovery: ${reason}`;
          });
        }
      }
      setFailTriggering(false);
    }
  }, [loadSnapshot, loadTrace, traceData?.workflow?.payer]);

  const timeline = useMemo(() => normalizeTimeline(traceData?.timeline), [traceData?.timeline]);
  const traceState = String(traceData?.state || '').trim().toLowerCase() || 'running';
  const currentWorkflow = traceData?.workflow || null;
  const currentRequest = traceData?.request || null;
  const selectedService = services.find((item) => String(item?.id || '').trim() === String(selectedServiceId || '').trim()) || null;
  const reputationByServiceId = useMemo(() => {
    const map = new Map();
    for (const row of agentReputationRows) {
      const serviceId = String(row?.serviceId || '').trim();
      if (!serviceId) continue;
      map.set(serviceId, row?.reputation || null);
    }
    return map;
  }, [agentReputationRows]);
  const quote = traceData?.workflow?.result?.quote || traceData?.request?.result?.quote || null;
  const readerResult = traceData?.workflow?.result?.reader || traceData?.request?.result?.reader || null;
  const effectiveReader = readerFullExcerpt ? { ...(readerResult || {}), ...readerFullExcerpt } : readerResult;
  const readerExcerpt = String(effectiveReader?.excerpt || '').trim();
  const readerContentLength = Number(effectiveReader?.contentLength || readerExcerpt.length || 0);
  const readerPreviewText =
    readerExcerpt.length > 220 ? `${readerExcerpt.slice(0, 220)}...` : readerExcerpt || '-';
  const readerQuality =
    readerContentLength >= 800 ? 'high' : readerContentLength >= 300 ? 'medium' : readerContentLength > 0 ? 'low' : '-';
  const onchainProof = currentRequest?.proofVerification || null;
  const onchainDetails = onchainProof?.details || {};
  const onchainTxHash = String(currentRequest?.paymentTxHash || currentRequest?.paymentProof?.txHash || currentWorkflow?.txHash || '').trim();
  const onchainBlock = onchainDetails?.blockNumber ?? '-';
  const onchainStatus = onchainProof ? 'success' : traceState === 'failed' ? 'failed' : 'pending';
  const onchainExplorerLink = onchainTxHash ? `https://testnet.kitescan.ai/tx/${onchainTxHash}` : '';
  const currentAction = String(currentRequest?.action || '').trim().toLowerCase();
  const flowLabel =
    currentAction === 'btc-price-feed' || currentAction === 'x-reader-feed'
      ? 'ATAPI+x402'
      : currentRequest?.a2a
        ? 'a2a+x402'
        : 'agent-to-api+x402';
  const summaryText =
    currentWorkflow?.error ||
    currentWorkflow?.result?.summary ||
    currentRequest?.result?.summary ||
    (traceLoading ? 'Loading trace details...' : 'Waiting for workflow events...');
  const xmtpEvidence = traceData?.xmtp || null;
  const xmtpHops = Array.isArray(xmtpEvidence?.hops) ? xmtpEvidence.hops : [];
  const latestTaskResult = xmtpEvidence?.latestTaskResult || null;
  const latestTaskPayment = latestTaskResult?.payment || null;
  const latestTaskReceiptRef = latestTaskResult?.receiptRef || null;

  const chartSeries = useMemo(() => normalizeSeriesPoints(series).slice(-CHART_POINT_LIMIT), [series]);
  const chartModel = useMemo(() => buildChartModel(chartSeries), [chartSeries]);
  const latestPoint = chartSeries.length > 0 ? chartSeries[chartSeries.length - 1] : null;
  const activePoint =
    hoverIndex >= 0 && hoverIndex < chartModel.points.length ? chartModel.points[hoverIndex] : latestPoint;
  const currentRequestId = String(currentRequest?.requestId || currentWorkflow?.requestId || '').trim();

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
            if (traceId) {
              setSelectedTraceId(traceId);
              void loadTrace(traceId);
              return;
            }
            void loadTraceByRequest(item?.requestId || '');
          }}
          disabled={!traceId && !item?.requestId}
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
      <header className="page-header demo-header">
        <div>
          <p className="header-kicker">KITE TESTNET</p>
          <h1>BTCUSD</h1>
          <p className="header-subtitle">
            Open with one glance: paid BTCUSD points on chart, and the ERC8004 + x402 workflow beside it.
          </p>
        </div>
        <div className="header-actions">
          <span className="sync-text">Last sync: {formatTime(lastSyncAt)}</span>
          <button type="button" className="ghost-btn" onClick={triggerDemoRun} disabled={triggering || failTriggering}>
            {triggering ? 'Running...' : 'Run Demo'}
          </button>
          <button type="button" className="ghost-btn danger" onClick={triggerFailDemo} disabled={triggering || failTriggering}>
            {failTriggering ? 'Failing...' : 'Fail Demo'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => openTracePage(currentRequestId)} disabled={!currentRequestId}>
            Open Trace
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('market')}>
            Open Market
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('ops')}>
            Open Ops
          </button>
        </div>
      </header>

      {errorText ? <p className="error-banner">{errorText}</p> : null}

      <main className="demo-layout">
        <section className="panel chart-panel">
          <div className="panel-head">
            <h2>BTCUSD</h2>
            <span className="panel-note">updates every minute · last {CHART_POINT_LIMIT} unlocked points</span>
          </div>

          <div className="chart-topline">
            <span className="muted-label">Latest</span>
            <strong ref={chartPriceRef} className="latest-price-tag">
              {latestPoint ? `$${formatPrice(latestPoint.priceUsd)}` : '-'}
            </strong>
            <span className="muted-text">
              {latestPoint ? `${latestPoint.provider}  ${formatTime(latestPoint.t)}` : 'waiting for paid BTCUSD points'}
            </span>
          </div>

          <div className="chart-wrap">
            {chartModel.points.length === 0 ? (
              <div className="chart-empty">No paid BTCUSD points yet. Click `Run Demo` to generate the first point.</div>
            ) : (
              <svg
                className="chart-svg"
                viewBox={`0 0 ${chartModel.width} ${chartModel.height}`}
                role="img"
                aria-label="BTCUSD paid price line chart"
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

          <div className="flow-summary chart-summary">
            <p className="muted-label">Summary</p>
            <p>{summaryText}</p>
          </div>
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
              <li key={step.id} className={`flow-step-card ${step.state}`}>
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
                    <button
                      type="button"
                      className="ghost-btn receipt-btn"
                      onClick={() => void downloadReceipt(currentRequestId)}
                      disabled={!currentRequestId}
                    >
                      Download Receipt
                    </button>
                  </div>
                ) : null}
                {step.id === 'onchain' ? (
                  <div className="flow-onchain-block">
                    <p>txHash: {onchainTxHash || '-'}</p>
                    <p>block: {onchainBlock}</p>
                    <p>status: {onchainStatus}</p>
                    <p>
                      explorer:{' '}
                      {onchainExplorerLink ? (
                        <a href={onchainExplorerLink} target="_blank" rel="noreferrer">
                          {onchainExplorerLink}
                        </a>
                      ) : (
                        '-'
                      )}
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

        </section>
      </main>
    </div>
  );

  const renderOpsPage = () => (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="header-kicker">KITE TESTNET / OPS</p>
          <h1>Operations Console</h1>
          <p className="header-subtitle">KPI, traces and session setup live here.</p>
        </div>
        <div className="header-actions">
          <span className="sync-text">Last sync: {formatTime(lastSyncAt)}</span>
          <button type="button" className="ghost-btn" onClick={() => void loadSnapshot({ manual: true })} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="ghost-btn" onClick={triggerDemoRun} disabled={triggering || failTriggering}>
            {triggering ? 'Running...' : 'Run Demo'}
          </button>
          <button type="button" className="ghost-btn danger" onClick={triggerFailDemo} disabled={triggering || failTriggering}>
            {failTriggering ? 'Failing...' : 'Fail Demo'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => openTracePage(currentRequestId)} disabled={!currentRequestId}>
            Open Trace
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('market')}>
            Open Market
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
            <span className="panel-note">click row to open trace</span>
          </div>
          <div className="trace-list">{renderTraceList()}</div>
        </section>

        <section className="panel ops-quickview">
          <div className="panel-head">
            <h2>Selected Trace</h2>
            <span className={`status-pill ${traceState}`}>{traceState}</span>
          </div>
          {currentWorkflow || currentRequest || selectedTraceId ? (
            <>
              <div className="quick-meta-grid">
                <article className="evidence-card">
                  <h3>Snapshot</h3>
                  <p>traceId: {fullText(selectedTraceId || currentWorkflow?.traceId || '-')}</p>
                  <p>requestId: {fullText(currentRequestId || '-')}</p>
                  <p>action: {currentAction || '-'}</p>
                  <p>flow: {flowLabel}</p>
                  <p>updated: {formatTime(currentWorkflow?.updatedAt || currentRequest?.updatedAt || '')}</p>
                </article>
                <article className="evidence-card">
                  <h3>Payment + Result</h3>
                  <p>amount: {currentRequest?.amount || '-'}</p>
                  <p>payer: {fullText(currentWorkflow?.payer || currentRequest?.payer || '-')}</p>
                  <p>provider: {readerResult?.provider || quote?.provider || '-'}</p>
                  <p>
                    result:{' '}
                    {readerResult?.title
                      ? readerResult.title
                      : Number.isFinite(Number(quote?.priceUsd))
                        ? `$${formatPrice(quote?.priceUsd)}`
                        : '-'}
                  </p>
                  <p>summary: {summaryText || '-'}</p>
                </article>
              </div>

              <ol className="quick-step-list">
                {timeline.map((step, idx) => (
                  <li key={`q_${step.id}`} className={`quick-step ${step.state}`}>
                    <span>{idx + 1}. {step.label}</span>
                    <span className={`status-pill mini ${step.state}`}>{step.state}</span>
                  </li>
                ))}
              </ol>

              <div className="session-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void downloadReceipt(currentRequestId)}
                  disabled={!currentRequestId}
                >
                  Download Receipt
                </button>
                {onchainExplorerLink ? (
                  <a href={onchainExplorerLink} target="_blank" rel="noreferrer" className="ghost-btn">
                    Open Explorer
                  </a>
                ) : (
                  <button type="button" className="ghost-btn" disabled>
                    Open Explorer
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void copyOpsField(currentRequestId, 'requestId')}
                  disabled={!currentRequestId}
                >
                  {opsCopiedField === 'requestId' ? 'Copied requestId' : 'Copy requestId'}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void copyOpsField(onchainTxHash, 'txHash')}
                  disabled={!onchainTxHash}
                >
                  {opsCopiedField === 'txHash' ? 'Copied txHash' : 'Copy txHash'}
                </button>
              </div>
            </>
          ) : (
            <p className="empty-text">Click a trace row on the left to inspect this panel.</p>
          )}
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
              <p>registry: {fullText(currentRequest?.identity?.registry || '-')}</p>
              <p>verify: {identityLatest?.status || '-'}</p>
              <p>wallet: {fullText(identityLatest?.identity?.agentWallet || '-')}</p>
            </article>
            <article className="evidence-card">
              <h3>x402 Payment</h3>
              <p>amount: {currentRequest?.amount || '-'}</p>
              <p>token: {fullText(currentRequest?.tokenAddress || '-')}</p>
              <p>recipient: {fullText(currentRequest?.recipient || '-')}</p>
              <p>txHash: {fullText(currentRequest?.paymentTxHash || currentWorkflow?.txHash || '-')}</p>
            </article>
            <article className="evidence-card">
              <h3>API Result</h3>
              {readerResult ? (
                <>
                  <p>provider: {effectiveReader?.provider || '-'}</p>
                  <p>url: {effectiveReader?.url || '-'}</p>
                  <p>title: {effectiveReader?.title || '-'}</p>
                  <p>digest quality: {readerQuality}</p>
                  <p>contentLength: {readerContentLength || '-'}</p>
                  <p className="reader-excerpt-label">excerpt:</p>
                  <p className="reader-excerpt-text">{readerExpanded ? readerExcerpt || '-' : readerPreviewText}</p>
                  {readerExcerpt ? (
                    <p className="reader-action-row">
                      <button
                        type="button"
                        className="ghost-btn receipt-btn"
                        onClick={() => void loadFullReaderExcerpt(currentRequestId, true)}
                        disabled={!currentRequestId || readerExcerptLoading}
                      >
                        {readerExcerptLoading ? 'Loading excerpt...' : 'Refresh full excerpt'}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn receipt-btn"
                        onClick={() => setReaderExpanded((prev) => !prev)}
                      >
                        {readerExpanded ? 'Hide full digest' : 'Show full digest'}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn receipt-btn"
                        onClick={() => void copyReaderDigest(readerExcerpt)}
                      >
                        {readerCopied ? 'Copied' : 'Copy Digest'}
                      </button>
                    </p>
                  ) : null}
                  {!readerExcerpt ? (
                    <p className="reader-action-row">
                      <button
                        type="button"
                        className="ghost-btn receipt-btn"
                        onClick={() => void loadFullReaderExcerpt(currentRequestId)}
                        disabled={!currentRequestId || readerExcerptLoading}
                      >
                        {readerExcerptLoading ? 'Loading excerpt...' : 'Load full excerpt'}
                      </button>
                    </p>
                  ) : null}
                  <p>at: {formatTime(effectiveReader?.fetchedAt || '')}</p>
                </>
              ) : (
                <>
                  <p>provider: {quote?.provider || '-'}</p>
                  <p>price: {quote?.priceUsd ?? '-'}</p>
                  <p>pair: {quote?.pair || 'BTCUSDT'}</p>
                  <p>at: {formatTime(quote?.fetchedAt || '')}</p>
                </>
              )}
              <p>
                <button
                  type="button"
                  className="ghost-btn receipt-btn"
                  onClick={() => void downloadReceipt(currentRequestId)}
                  disabled={!currentRequestId}
                >
                  Download Receipt
                </button>
              </p>
            </article>
            <article className="evidence-card">
              <h3>Workflow</h3>
              <p>state: {currentWorkflow?.state || '-'}</p>
              <p>updated: {formatTime(currentWorkflow?.updatedAt || '')}</p>
              <p>payer: {fullText(currentWorkflow?.payer || '-')}</p>
              <p>flow: {flowLabel}</p>
              <p>txHash: {onchainTxHash || '-'}</p>
              <p>block: {onchainBlock}</p>
              <p>status: {onchainStatus}</p>
              <p>
                explorer:{' '}
                {onchainExplorerLink ? (
                  <a href={onchainExplorerLink} target="_blank" rel="noreferrer">
                    {onchainExplorerLink}
                  </a>
                ) : (
                  '-'
                )}
              </p>
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

  const renderTracePage = () => (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="header-kicker">KITE TESTNET / TRACE</p>
          <h1>Receipt & Evidence</h1>
          <p className="header-subtitle">Lookup by requestId and inspect x402, XMTP hops, and on-chain evidence.</p>
        </div>
        <div className="header-actions">
          <span className="sync-text">Last sync: {formatTime(lastSyncAt)}</span>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              if (traceRequestId) {
                void loadTraceByRequest(traceRequestId);
              } else {
                setErrorText('Enter a requestId first.');
              }
            }}
            disabled={traceLoading}
          >
            {traceLoading ? 'Loading...' : 'Reload Trace'}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void downloadReceipt(currentRequestId || traceRequestId)}
            disabled={!(currentRequestId || traceRequestId)}
          >
            Download Receipt
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('demo')}>
            Back to Demo
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('market')}>
            Open Market
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('ops')}>
            Open Ops
          </button>
        </div>
      </header>

      {errorText ? <p className="error-banner">{errorText}</p> : null}

      <main className="trace-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>Lookup</h2>
            <span className="panel-note">{traceLoading ? 'loading' : 'ready'}</span>
          </div>
          <form className="trace-lookup" onSubmit={submitTraceLookup}>
            <div className="vault-input">
              <label htmlFor="trace-request-id">requestId</label>
              <input
                id="trace-request-id"
                value={traceRequestInput}
                onChange={(event) => setTraceRequestInput(event.target.value)}
                placeholder="paste x402 requestId"
              />
            </div>
            <div className="session-actions">
              <button type="submit" className="ghost-btn">
                Open Request
              </button>
            </div>
          </form>
          <p className="flow-meta">requestId: {fullText(currentRequestId || traceRequestId || '-')}</p>
          <p className="flow-meta">traceId: {fullText(selectedTraceId || currentWorkflow?.traceId || '-')}</p>
          <p className="flow-meta">state: {traceState || '-'}</p>
          <p className="flow-summary">{summaryText}</p>
        </section>

        <section className="panel trace-evidence-panel">
          <div className="panel-head">
            <h2>Snapshot</h2>
            <span className={`status-pill ${traceState}`}>{traceState}</span>
          </div>
          <div className="evidence-grid trace-evidence-grid">
            <article className="evidence-card">
              <h3>Identity</h3>
              <p>agentId: {currentRequest?.identity?.agentId || '-'}</p>
              <p>registry: {fullText(currentRequest?.identity?.registry || '-')}</p>
              <p>wallet: {fullText(currentRequest?.identity?.agentWallet || '-')}</p>
            </article>
            <article className="evidence-card">
              <h3>Payment</h3>
              <p>requestId: {fullText(currentRequestId || traceRequestId || '-')}</p>
              <p>amount: {currentRequest?.amount || '-'}</p>
              <p>token: {fullText(currentRequest?.tokenAddress || '-')}</p>
              <p>payer: {fullText(currentWorkflow?.payer || currentRequest?.payer || '-')}</p>
              <p>payee: {fullText(currentRequest?.recipient || '-')}</p>
            </article>
            <article className="evidence-card">
              <h3>On-chain</h3>
              <p>txHash: {fullText(onchainTxHash || '-')}</p>
              <p>block: {onchainBlock}</p>
              <p>status: {onchainStatus}</p>
              <p>
                explorer:{' '}
                {onchainExplorerLink ? (
                  <a href={onchainExplorerLink} target="_blank" rel="noreferrer">
                    {onchainExplorerLink}
                  </a>
                ) : (
                  '-'
                )}
              </p>
            </article>
            <article className="evidence-card">
              <h3>XMTP Result Bind</h3>
              <p>events: {xmtpEvidence?.total ?? xmtpHops.length}</p>
              <p>status: {fullText(latestTaskResult?.status || '-')}</p>
              <p>summary: {fullText(latestTaskResult?.resultSummary || '-')}</p>
              <p>paymentMode: {fullText(latestTaskPayment?.mode || '-')}</p>
              <p>payment.requestId: {fullText(latestTaskPayment?.requestId || latestTaskReceiptRef?.requestId || '-')}</p>
              <p>payment.txHash: {fullText(latestTaskPayment?.txHash || latestTaskReceiptRef?.txHash || '-')}</p>
              <p>receiptRef: {fullText(latestTaskReceiptRef?.endpoint || '-')}</p>
            </article>
            <article className="evidence-card">
              <h3>API Result</h3>
              {readerResult ? (
                <>
                  <p>provider: {effectiveReader?.provider || '-'}</p>
                  <p>url: {effectiveReader?.url || '-'}</p>
                  <p>title: {effectiveReader?.title || '-'}</p>
                  <p>quality: {readerQuality}</p>
                  <p>contentLength: {readerContentLength || '-'}</p>
                  <p className="reader-excerpt-label">excerpt:</p>
                  <p className="reader-excerpt-text">{readerExpanded ? readerExcerpt || '-' : readerPreviewText}</p>
                  <p className="reader-action-row">
                    <button
                      type="button"
                      className="ghost-btn receipt-btn"
                      onClick={() => void loadFullReaderExcerpt(currentRequestId, true)}
                      disabled={!currentRequestId || readerExcerptLoading}
                    >
                      {readerExcerptLoading
                        ? 'Loading excerpt...'
                        : readerFullExcerpt
                          ? 'Refresh full excerpt'
                          : 'Load full excerpt'}
                    </button>
                    {readerExcerpt ? (
                      <button
                        type="button"
                        className="ghost-btn receipt-btn"
                        onClick={() => setReaderExpanded((prev) => !prev)}
                      >
                        {readerExpanded ? 'Hide full digest' : 'Show full digest'}
                      </button>
                    ) : null}
                    {readerExcerpt ? (
                      <button
                        type="button"
                        className="ghost-btn receipt-btn"
                        onClick={() => void copyReaderDigest(readerExcerpt)}
                      >
                        {readerCopied ? 'Copied' : 'Copy Digest'}
                      </button>
                    ) : null}
                  </p>
                </>
              ) : (
                <>
                  <p>provider: {quote?.provider || '-'}</p>
                  <p>price: {Number.isFinite(Number(quote?.priceUsd)) ? `$${formatPrice(quote?.priceUsd)}` : '-'}</p>
                  <p>pair: {quote?.pair || '-'}</p>
                </>
              )}
              <p>summary: {summaryText || '-'}</p>
            </article>
          </div>
        </section>

        <section className="panel trace-timeline-panel">
          <div className="panel-head">
            <h2>Timeline</h2>
            <span className="panel-note">{flowLabel}</span>
          </div>
          <ol className="flow-step-list">
            {timeline.map((step, idx) => (
              <li key={`trace_${step.id}`} className={`flow-step-card ${step.state}`}>
                <div className="flow-step-top">
                  <span className="flow-index">{idx + 1}</span>
                  <strong>{step.label}</strong>
                  <span className={`status-pill mini ${step.state}`}>{step.state}</span>
                </div>
                <p className="flow-step-detail">{step.detail || 'waiting...'}</p>
                {step.id === 'api_result' ? (
                  <div className="flow-price-row">
                    <span className="muted-label">Result</span>
                    <strong className="flow-price-tag">
                      {Number.isFinite(Number(quote?.priceUsd))
                        ? `$${formatPrice(quote?.priceUsd)}`
                        : readerResult?.provider || '-'}
                    </strong>
                    <button
                      type="button"
                      className="ghost-btn receipt-btn"
                      onClick={() => void downloadReceipt(currentRequestId || traceRequestId)}
                      disabled={!(currentRequestId || traceRequestId)}
                    >
                      Download Receipt
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="panel trace-timeline-panel">
          <div className="panel-head">
            <h2>XMTP Hops</h2>
            <span className="panel-note">{xmtpHops.length} events</span>
          </div>
          {xmtpHops.length === 0 ? (
            <p className="empty-text">No XMTP hop evidence for this trace yet.</p>
          ) : (
            <ol className="flow-step-list">
              {xmtpHops.map((hop, idx) => {
                const hopKind = String(hop?.kind || '').trim().toLowerCase();
                const hopStatus = String(hop?.status || '').trim().toLowerCase();
                const hopState = hopStatus === 'failed' || hop?.error ? 'failed' : 'success';
                return (
                  <li key={`xmtp_hop_${hop.id || idx}`} className={`flow-step-card ${hopState}`}>
                    <div className="flow-step-top">
                      <span className="flow-index">{idx + 1}</span>
                      <strong>{hopKind || 'xmtp-event'}</strong>
                      <span className={`status-pill mini ${hopState}`}>{hopStatus || hopState}</span>
                    </div>
                    <p className="flow-step-detail">
                      {fullText(hop?.fromAgentId || '-')} {'->'} {fullText(hop?.toAgentId || '-')} | hop {hop?.hopIndex ?? '-'} |{' '}
                      {formatTime(hop?.createdAt)}
                    </p>
                    <p className="flow-meta">taskId: {fullText(hop?.taskId || '-')}</p>
                    <p className="flow-meta">requestId: {fullText(hop?.requestId || '-')}</p>
                    <p className="flow-meta">conversationId: {fullText(hop?.conversationId || '-')}</p>
                    <p className="flow-meta">messageId: {fullText(hop?.messageId || '-')}</p>
                    {hopKind === 'task-phase' ? (
                      <>
                        <p className="flow-meta">phase: {fullText(hop?.phase || '-')}</p>
                        <p className="flow-meta">detail: {fullText(hop?.detail || '-')}</p>
                      </>
                    ) : null}
                    {hopKind === 'task-result' ? (
                      <>
                        <p className="flow-meta">result: {fullText(hop?.resultSummary || '-')}</p>
                        <p className="flow-meta">payment.requestId: {fullText(hop?.payment?.requestId || hop?.receiptRef?.requestId || '-')}</p>
                        <p className="flow-meta">payment.txHash: {fullText(hop?.payment?.txHash || hop?.receiptRef?.txHash || '-')}</p>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </div>
  );

  const renderMarketPage = () => (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="header-kicker">KITE TESTNET / MARKET</p>
          <h1>Service Directory (MVP)</h1>
          <p className="header-subtitle">Publish services, discover providers, and invoke per-call x402 settlements.</p>
        </div>
        <div className="header-actions">
          <span className="sync-text">Last sync: {formatTime(lastSyncAt)}</span>
          <button type="button" className="ghost-btn" onClick={() => void loadServiceCatalog({ manual: true })} disabled={marketRefreshing}>
            {marketRefreshing ? 'Refreshing...' : 'Refresh Catalog'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('demo')}>
            Back to Demo
          </button>
          <button type="button" className="ghost-btn" onClick={() => navigate('ops')}>
            Open Ops
          </button>
        </div>
      </header>

      {errorText ? <p className="error-banner">{errorText}</p> : null}

      <main className="market-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>Service Catalog</h2>
            <span className="panel-note">{services.length} services</span>
          </div>

          <div className="market-form">
            <div className="vault-input">
              <label htmlFor="svc-name">Service Name</label>
              <input
                id="svc-name"
                value={serviceForm.name}
                onChange={(event) => setServiceForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="BTCUSD Quote Service"
              />
            </div>
            <div className="vault-input">
              <label htmlFor="svc-desc">Description</label>
              <textarea
                id="svc-desc"
                rows={2}
                value={serviceForm.description}
                onChange={(event) => setServiceForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Describe what this service provides."
              />
            </div>
            <div className="market-form-row">
              <div className="vault-input">
                <label htmlFor="svc-action">Action</label>
                <select
                  id="svc-action"
                  value={serviceForm.action}
                  onChange={(event) => setServiceForm((prev) => ({ ...prev, action: event.target.value }))}
                >
                  <option value="btc-price-feed">btc-price-feed (ATAPI)</option>
                  <option value="risk-score-feed">risk-score-feed (A2A)</option>
                  <option value="x-reader-feed">x-reader-feed (ATAPI)</option>
                </select>
              </div>
              <div className="vault-input">
                <label htmlFor="svc-tags">Tags (csv)</label>
                <input
                  id="svc-tags"
                  value={serviceForm.tags}
                  onChange={(event) => setServiceForm((prev) => ({ ...prev, tags: event.target.value }))}
                  placeholder="a2a,x402,risk"
                />
              </div>
              <div className="vault-input">
                <label htmlFor="svc-horizon">{serviceForm.action === 'x-reader-feed' ? 'maxChars' : 'horizonMin'}</label>
                <input
                  id="svc-horizon"
                  value={serviceForm.action === 'x-reader-feed' ? serviceForm.maxChars : serviceForm.horizonMin}
                  onChange={(event) =>
                    setServiceForm((prev) =>
                      serviceForm.action === 'x-reader-feed'
                        ? { ...prev, maxChars: event.target.value }
                        : { ...prev, horizonMin: event.target.value }
                    )
                  }
                  placeholder={serviceForm.action === 'x-reader-feed' ? '1200' : '60'}
                />
              </div>
            </div>
            {serviceForm.action === 'x-reader-feed' ? (
              <div className="market-form-row">
                <div className="vault-input">
                  <label htmlFor="svc-url">URL</label>
                  <input
                    id="svc-url"
                    value={serviceForm.resourceUrl}
                    onChange={(event) => setServiceForm((prev) => ({ ...prev, resourceUrl: event.target.value }))}
                    placeholder="https://x.com/Kite_AI"
                  />
                </div>
                <div className="vault-input">
                  <label htmlFor="svc-source">Mode</label>
                  <input
                    id="svc-source"
                    value={serviceForm.source}
                    onChange={(event) => setServiceForm((prev) => ({ ...prev, source: event.target.value.toLowerCase() }))}
                    placeholder="auto"
                  />
                </div>
                <div className="vault-input">
                  <label htmlFor="svc-price">Price (x402)</label>
                  <input
                    id="svc-price"
                    value={serviceForm.price}
                    onChange={(event) => setServiceForm((prev) => ({ ...prev, price: event.target.value }))}
                    placeholder="0.00001"
                  />
                </div>
              </div>
            ) : (
              <div className="market-form-row">
                <div className="vault-input">
                  <label htmlFor="svc-pair">Pair</label>
                  <input
                    id="svc-pair"
                    value={serviceForm.pair}
                    onChange={(event) => setServiceForm((prev) => ({ ...prev, pair: event.target.value.toUpperCase() }))}
                    placeholder="BTCUSDT"
                  />
                </div>
                <div className="vault-input">
                  <label htmlFor="svc-source">Source</label>
                  <input
                    id="svc-source"
                    value={serviceForm.source}
                    onChange={(event) => setServiceForm((prev) => ({ ...prev, source: event.target.value.toLowerCase() }))}
                    placeholder="hyperliquid"
                  />
                </div>
                <div className="vault-input">
                  <label htmlFor="svc-price">Price (x402)</label>
                  <input
                    id="svc-price"
                    value={serviceForm.price}
                    onChange={(event) => setServiceForm((prev) => ({ ...prev, price: event.target.value }))}
                    placeholder="0.00001"
                  />
                </div>
              </div>
            )}
            <div className="market-form-row">
              <div className="vault-input">
                <label htmlFor="svc-sla">SLA ms</label>
                <input
                  id="svc-sla"
                  value={serviceForm.slaMs}
                  onChange={(event) => setServiceForm((prev) => ({ ...prev, slaMs: event.target.value }))}
                  placeholder="12000"
                />
              </div>
              <div className="vault-input">
                <label htmlFor="svc-rpm">Rate limit/min</label>
                <input
                  id="svc-rpm"
                  value={serviceForm.rateLimitPerMinute}
                  onChange={(event) => setServiceForm((prev) => ({ ...prev, rateLimitPerMinute: event.target.value }))}
                  placeholder="12"
                />
              </div>
              <div className="vault-input">
                <label htmlFor="svc-budget">Budget/day</label>
                <input
                  id="svc-budget"
                  value={serviceForm.budgetPerDay}
                  onChange={(event) => setServiceForm((prev) => ({ ...prev, budgetPerDay: event.target.value }))}
                  placeholder="0.06"
                />
              </div>
            </div>
            <div className="vault-input">
              <label htmlFor="svc-allowlist">Payer allowlist (csv, optional)</label>
              <input
                id="svc-allowlist"
                value={serviceForm.allowlistPayers}
                onChange={(event) => setServiceForm((prev) => ({ ...prev, allowlistPayers: event.target.value }))}
                placeholder="0xabc...,0xdef..."
              />
            </div>
            <div className="session-actions">
              <button type="button" className="ghost-btn" onClick={publishService} disabled={publishingService}>
                {publishingService ? 'Publishing...' : serviceForm.id ? 'Update Service' : 'Publish Service'}
              </button>
            </div>
          </div>

          <div className="service-list">
            {services.length === 0 ? (
              <p className="empty-text">No services published yet.</p>
            ) : (
              services.map((item, idx) => {
                const id = String(item?.id || '').trim();
                const active = item?.active !== false;
                const selected = String(selectedServiceId || '').trim() === id;
                return (
                  <button
                    type="button"
                    key={id || `svc_${idx}`}
                    className={`service-row ${selected ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedServiceId(id);
                      setServiceForm({
                        id,
                        action: String(item?.action || 'btc-price-feed').trim().toLowerCase(),
                        name: String(item?.name || '').trim(),
                        description: String(item?.description || '').trim(),
                        pair: String(item?.pair || 'BTCUSDT').trim().toUpperCase(),
                        source: String(item?.sourceRequested || item?.source || 'hyperliquid').trim().toLowerCase(),
                        resourceUrl: String(item?.resourceUrl || item?.exampleInput?.url || '').trim(),
                        maxChars: String(item?.maxChars || item?.exampleInput?.maxChars || 1200),
                        price: String(item?.price || '0.00001').trim(),
                        tags: Array.isArray(item?.tags) ? item.tags.join(',') : '',
                        horizonMin: String(item?.horizonMin || 60),
                        slaMs: String(item?.slaMs || 12000),
                        rateLimitPerMinute: String(item?.rateLimitPerMinute || 12),
                        budgetPerDay: String(item?.budgetPerDay || 0),
                        allowlistPayers: Array.isArray(item?.allowlistPayers) ? item.allowlistPayers.join(',') : '',
                        active
                      });
                      void loadServiceReceipts(id);
                      void loadServiceStatus(id);
                    }}
                  >
                    <span>{item?.name || id}</span>
                    <span>{item?.action || '-'}</span>
                    <span>{item?.price || '-'}</span>
                    <span>{reputationByServiceId.get(id)?.score ?? '-'}</span>
                    <span className={`status-pill mini ${active ? 'success' : 'failed'}`}>{active ? 'active' : 'inactive'}</span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Invoke & Receipts</h2>
            <span className="panel-note">{selectedService ? selectedService.id : 'no service selected'}</span>
          </div>

          {selectedService ? (
            <>
              <div className="evidence-grid market-detail-grid">
                <article className="evidence-card">
                  <h3>Service</h3>
                  <p>name: {selectedService.name}</p>
                  <p>action: {selectedService.action}</p>
                  {selectedService.action === 'x-reader-feed' ? (
                    <>
                      <p>url: {selectedService.resourceUrl || '-'}</p>
                      <p>mode: {selectedService.sourceRequested || selectedService.source || 'auto'}</p>
                      <p>maxChars: {selectedService.maxChars ?? '-'}</p>
                    </>
                  ) : (
                    <>
                      <p>pair: {selectedService.pair || '-'}</p>
                      <p>source: {selectedService.sourceRequested || selectedService.source}</p>
                    </>
                  )}
                  <p>tags: {Array.isArray(selectedService.tags) && selectedService.tags.length > 0 ? selectedService.tags.join(', ') : '-'}</p>
                </article>
                <article className="evidence-card">
                  <h3>x402 + Guardrails</h3>
                  <p>price: {selectedService.price}</p>
                  <p>token: {fullText(selectedService.tokenAddress)}</p>
                  <p>recipient: {fullText(selectedService.recipient)}</p>
                  <p>providerAgent: {selectedService.providerAgentId || '-'}</p>
                  <p>rate/min: {selectedService.rateLimitPerMinute ?? '-'}</p>
                  <p>budget/day: {selectedService.budgetPerDay ?? '-'}</p>
                  <p>SLA(ms): {selectedService.slaMs ?? '-'}</p>
                  <p>allowlist: {Array.isArray(selectedService.allowlistPayers) && selectedService.allowlistPayers.length > 0 ? selectedService.allowlistPayers.length : 0}</p>
                </article>
                <article className="evidence-card">
                  <h3>Service Status</h3>
                  <p>state: {selectedServiceStatus?.state || '-'}</p>
                  <p>total: {selectedServiceStatus?.totals?.total ?? 0}</p>
                  <p>success: {selectedServiceStatus?.totals?.success ?? 0}</p>
                  <p>failed: {selectedServiceStatus?.totals?.failed ?? 0}</p>
                  <p>successRate: {selectedServiceStatus?.successRate ?? 0}%</p>
                  <p>avgConfirmSec: {selectedServiceStatus?.avgConfirmSec ?? 0}</p>
                  <p>lastError: {selectedServiceStatus?.lastError || '-'}</p>
                </article>
                <article className="evidence-card">
                  <h3>Reputation</h3>
                  <p>score: {selectedServiceReputation?.score ?? '-'}</p>
                  <p>grade: {selectedServiceReputation?.grade || '-'}</p>
                  <p>sampleSize: {selectedServiceReputation?.sampleSize ?? 0}</p>
                  <p>onchainMatch: {selectedServiceReputation?.factors?.onchainMatchRate ?? 0}%</p>
                  <p>successRate: {selectedServiceReputation?.factors?.successRate ?? 0}%</p>
                  <p>avgConfirmSec: {selectedServiceReputation?.factors?.avgConfirmSec ?? 0}</p>
                </article>
              </div>

              <div className="market-invoke">
                <div className="vault-input">
                  <label htmlFor="invoke-payer">Payer (optional override)</label>
                  <input
                    id="invoke-payer"
                    value={invokePayer}
                    onChange={(event) => setInvokePayer(event.target.value)}
                    placeholder="0x..."
                  />
                </div>
                <div className="session-actions">
                  <button type="button" className="ghost-btn" onClick={fillInvokePayerFromRuntime}>
                    Use Runtime Payer
                  </button>
                  <button type="button" className="ghost-btn" onClick={toggleServiceActive}>
                    {selectedService.active === false ? 'Unrevoke Service' : 'Revoke Service'}
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => void loadServiceStatus(selectedService.id)} disabled={serviceStatusLoading}>
                    {serviceStatusLoading ? 'Loading Status...' : 'Refresh Status'}
                  </button>
                  <button type="button" className="ghost-btn" onClick={invokeSelectedService} disabled={invokingService}>
                    {invokingService ? 'Invoking...' : 'Invoke Service'}
                  </button>
                </div>
              </div>

              <ul className="event-list market-receipt-list">
                {serviceReceipts.length === 0 ? (
                  <li className="empty-text">No receipts yet. Invoke this service once.</li>
                ) : (
                  serviceReceipts.map((item) => (
                    <li key={item.invocationId} className={`event-row ${item.state === 'failed' ? 'failed' : item.state === 'success' || item.state === 'unlocked' ? 'success' : 'running'}`}>
                      <span className={`event-dot ${item.state === 'failed' ? 'failed' : item.state === 'success' || item.state === 'unlocked' ? 'success' : 'running'}`} />
                      <span>{shortenMiddle(item.traceId || item.requestId || item.invocationId, 14, 8)}</span>
                      <span>{item.x402?.status || item.state || '-'}</span>
                      <span>{formatTime(item.updatedAt || item.createdAt)}</span>
                    </li>
                  ))
                )}
              </ul>

              <div className="market-reputation">
                <div className="panel-head">
                  <h2>Agent Reputation Board</h2>
                  <span className="panel-note">{agentReputationRows.length} rows</span>
                </div>
                <div className="trace-list">
                  {agentReputationRows.length === 0 ? (
                    <p className="empty-text">No reputation rows yet.</p>
                  ) : (
                    agentReputationRows.map((row, idx) => (
                      <div key={`${row.serviceId || 'rep'}_${idx}`} className="trace-row">
                        <span>{row.agentId || '-'}</span>
                        <span>{row.serviceId || '-'}</span>
                        <span>{row.action || '-'}</span>
                        <span>{row.reputation?.score ?? '-'}</span>
                        <span>{row.reputation?.grade || '-'}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="empty-text">Select or publish a service first.</p>
          )}
        </section>
      </main>
    </div>
  );

  return isOpsPage ? renderOpsPage() : isMarketPage ? renderMarketPage() : isTracePage ? renderTracePage() : renderDemoPage();
}

export default App;
