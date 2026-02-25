function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizePath(path = '') {
  const raw = normalizeText(path);
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function toIsoNow() {
  return new Date().toISOString();
}

function waitMs(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function parseJsonSafe(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { rawText: raw };
  }
}

export function createOpenAliceAdapter(config = {}) {
  const baseUrl = normalizeText(config.baseUrl).replace(/\/+$/, '');
  const timeoutMs = Math.max(2000, Math.min(Number(config.timeoutMs || 12000), 60000));
  const retry = Math.max(0, Math.min(Number(config.retry || 1), 3));
  const apiKey = normalizeText(config.apiKey);
  const hasRemote = Boolean(baseUrl);

  async function requestJson(pathname = '/', payload = null, method = 'POST') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const resp = await fetch(`${baseUrl}${normalizePath(pathname)}`, {
        method,
        headers,
        body: payload === null ? undefined : JSON.stringify(payload),
        signal: ctrl.signal
      });
      const rawText = await resp.text();
      const body = parseJsonSafe(rawText);
      if (!resp.ok) {
        return {
          ok: false,
          error: String(body?.error || 'openalice_http_error').trim() || 'openalice_http_error',
          reason: String(body?.reason || body?.message || `HTTP ${resp.status}`).trim() || `HTTP ${resp.status}`,
          statusCode: resp.status,
          body
        };
      }
      return { ok: true, statusCode: resp.status, body };
    } catch (error) {
      const isTimeout = error?.name === 'AbortError';
      return {
        ok: false,
        error: isTimeout ? 'openalice_timeout' : 'openalice_unreachable',
        reason: String(error?.message || (isTimeout ? 'OpenAlice timeout' : 'OpenAlice request failed')).trim(),
        statusCode: 503,
        body: {}
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function callWithFallback(pathCandidates = [], payload = {}, method = 'POST') {
    if (!hasRemote) {
      return {
        ok: false,
        error: 'openalice_base_url_missing',
        reason: 'OPENALICE_BASE_URL is required when ANALYSIS_PROVIDER=openalice.',
        statusCode: 503,
        body: {}
      };
    }
    const candidates = Array.isArray(pathCandidates) ? pathCandidates : [];
    const failures = [];
    for (const pathname of candidates) {
      for (let i = 0; i <= retry; i += 1) {
        const result = await requestJson(pathname, payload, method);
        if (result.ok) return result;
        failures.push(`${pathname}:${result.reason}`);
        if (i < retry) {
          await waitMs(250 * (i + 1));
        }
      }
    }
    const reason = failures.length > 0 ? failures.join('; ') : 'openalice request failed';
    return {
      ok: false,
      error: 'openalice_request_failed',
      reason,
      statusCode: 502,
      body: {}
    };
  }

  async function health() {
    if (!hasRemote) {
      return {
        ok: false,
        connected: false,
        reason: 'OPENALICE_BASE_URL is empty',
        checkedAt: toIsoNow()
      };
    }
    const result = await callWithFallback(
      ['/health', '/api/health', '/api/openalice/health', '/v1/health'],
      null,
      'GET'
    );
    if (!result.ok) {
      return {
        ok: false,
        connected: false,
        reason: result.reason,
        checkedAt: toIsoNow()
      };
    }
    return {
      ok: true,
      connected: true,
      reason: String(result.body?.reason || 'ok').trim() || 'ok',
      checkedAt: toIsoNow(),
      details: result.body
    };
  }

  async function analyzeInfo(input = {}) {
    const payload = {
      kind: 'info-analysis',
      ...input
    };
    const result = await callWithFallback(
      ['/api/analysis/info/run', '/api/analysis/info', '/analysis/info', '/v1/analysis/info'],
      payload,
      'POST'
    );
    if (!result.ok) return result;
    return {
      ok: true,
      data: result.body?.result && typeof result.body.result === 'object' ? result.body.result : result.body,
      statusCode: result.statusCode,
      body: result.body
    };
  }

  async function analyzeTechnical(input = {}) {
    const payload = {
      kind: 'technical-analysis',
      ...input
    };
    const result = await callWithFallback(
      ['/api/analysis/technical/run', '/api/analysis/technical', '/analysis/technical', '/v1/analysis/technical'],
      payload,
      'POST'
    );
    if (!result.ok) return result;
    return {
      ok: true,
      data: result.body?.result && typeof result.body.result === 'object' ? result.body.result : result.body,
      statusCode: result.statusCode,
      body: result.body
    };
  }

  function info() {
    return {
      mode: hasRemote ? 'remote' : 'disabled',
      hasRemote,
      baseUrl: hasRemote ? baseUrl : '',
      timeoutMs,
      retry
    };
  }

  return {
    info,
    health,
    analyzeInfo,
    analyzeTechnical
  };
}
