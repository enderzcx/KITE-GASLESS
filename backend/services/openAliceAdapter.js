function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizePath(path = '') {
  const raw = normalizeText(path);
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeBaseUrl(value = '') {
  return normalizeText(value).replace(/\/+$/, '');
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

function parseJsonObjectFromText(text = '') {
  const raw = normalizeText(text);
  if (!raw) return null;
  const direct = parseJsonSafe(raw);
  if (direct && typeof direct === 'object' && !Array.isArray(direct) && !direct.rawText) return direct;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const inside = parseJsonSafe(fenced[1]);
    if (inside && typeof inside === 'object' && !Array.isArray(inside) && !inside.rawText) return inside;
  }

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = parseJsonSafe(raw.slice(first, last + 1));
    if (slice && typeof slice === 'object' && !Array.isArray(slice) && !slice.rawText) return slice;
  }
  return null;
}

function pickObject(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function buildRoleConfig(role = '', baseUrl = '', apiKey = '') {
  return {
    role: normalizeText(role),
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: normalizeText(apiKey)
  };
}

function buildInfoChatMessage(input = {}) {
  const url = normalizeText(input.url || input.resourceUrl || '');
  const topic = normalizeText(input.topic || input.query || url || 'market topic');
  const inputType = normalizeText(input.inputType || (url ? 'url' : 'topic')).toLowerCase() || 'topic';
  const traceId = normalizeText(input.traceId || '');
  const mode = normalizeText(input.mode || 'auto');
  const maxChars = Number.isFinite(Number(input.maxChars)) ? Number(input.maxChars) : 1200;
  return [
    'You are Message Agent for crypto information analysis.',
    'Return ONLY one compact JSON object. No markdown, no code fence, no extra text.',
    'If inputType=topic, do topic/news sentiment analysis directly without requiring webpage browsing.',
    'JSON schema:',
    '{"provider":"openalice","traceId":"","topic":"","sentimentScore":0,"confidence":0.5,"headlines":[],"keyFactors":[],"summary":"","asOf":""}',
    'Rules:',
    '- sentimentScore range: -1 to 1',
    '- confidence range: 0 to 1',
    '- headlines and keyFactors are string arrays, max 6 items each',
    '- asOf must be ISO-8601 timestamp',
    '',
    `Input traceId=${traceId || 'n/a'}`,
    `Input inputType=${inputType}`,
    `Input topic=${topic}`,
    `Input url=${url || 'n/a'}`,
    `Input mode=${mode}`,
    `Input maxChars=${maxChars}`
  ].join('\n');
}

function buildTechnicalChatMessage(input = {}) {
  const symbol = normalizeText(input.symbol || input.pair || 'BTCUSDT').toUpperCase();
  const compactSymbol = symbol.replace(/[-_\s/]/g, '');
  const toolSymbol = compactSymbol === 'BTC' || compactSymbol === 'BTCUSDT' || compactSymbol === 'BTCUSD'
    ? 'BTCUSD'
    : compactSymbol;
  const traceId = normalizeText(input.traceId || '');
  const source = normalizeText(input.source || 'auto');
  const timeframe = normalizeText(input.timeframe || `${Number(input.horizonMin || 60)}m`);
  const interval = /^(60m|1h)$/i.test(timeframe) ? '1h' : '1d';
  return [
    'You are Technical Analysis Agent for crypto markets.',
    'Return ONLY one compact JSON object. No markdown, no code fence, no extra text.',
    'You MUST call tool(s) before final answer. If tools fail, state exact tool error in summary.',
    'Preferred tool: calculateIndicator.',
    'Run these formulas with asset="crypto" before final answer:',
    `1) RSI(CLOSE('${toolSymbol}', '${interval}'), 14)`,
    `2) MACD(CLOSE('${toolSymbol}', '${interval}'), 12, 26, 9)`,
    `3) EMA(CLOSE('${toolSymbol}', '${interval}'), 12)`,
    `4) EMA(CLOSE('${toolSymbol}', '${interval}'), 26)`,
    `5) ATR(HIGH('${toolSymbol}', '${interval}'), LOW('${toolSymbol}', '${interval}'), CLOSE('${toolSymbol}', '${interval}'), 14)`,
    `6) CLOSE('${toolSymbol}', '${interval}')[-1]`,
    'JSON schema:',
    '{"provider":"openalice","traceId":"","symbol":"BTCUSDT","timeframe":"60m","indicators":{"rsi":50,"macd":0,"emaFast":0,"emaSlow":0,"atr":0},"signals":{"trend":"sideways","momentum":"neutral","volatility":"normal","bias":"neutral"},"confidence":0.5,"riskBand":{"stopLossPct":1.5,"takeProfitPct":3.0},"riskScore":50,"summary":"","asOf":"","quote":{"provider":"openalice","pair":"BTCUSDT","priceUsd":0,"fetchedAt":"","sourceRequested":"auto","attemptedProviders":["openalice"]}}',
    'Rules:',
    '- confidence range: 0 to 1',
    '- riskScore range: 5 to 95',
    '- asOf and quote.fetchedAt must be ISO-8601 timestamp',
    '- quote.priceUsd must come from tool data, not fabricated',
    '- if any required tool call fails, put "TOOL_ERROR: <reason>" at summary start',
    '',
    `Input traceId=${traceId || 'n/a'}`,
    `Input symbol=${symbol}`,
    `Input toolSymbol=${toolSymbol}`,
    `Input timeframe=${timeframe}`,
    `Input source=${source}`
  ].join('\n');
}

export function createOpenAliceAdapter(config = {}) {
  const sharedBaseUrl = normalizeBaseUrl(config.baseUrl);
  const timeoutMs = Math.max(2000, Math.min(Number(config.timeoutMs || 12000), 60000));
  const retry = Math.max(0, Math.min(Number(config.retry || 1), 3));
  const sharedApiKey = normalizeText(config.apiKey);

  const infoRole = buildRoleConfig(
    'message',
    config.infoBaseUrl || config.messageBaseUrl || sharedBaseUrl,
    config.infoApiKey || config.messageApiKey || sharedApiKey
  );
  const technicalRole = buildRoleConfig(
    'technical',
    config.technicalBaseUrl || config.techBaseUrl || sharedBaseUrl,
    config.technicalApiKey || config.techApiKey || sharedApiKey
  );
  const hasRemote = Boolean(infoRole.baseUrl || technicalRole.baseUrl);

  async function requestJson(roleConfig = {}, pathname = '/', payload = null, method = 'POST') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const baseUrl = normalizeBaseUrl(roleConfig.baseUrl);
      const apiKey = normalizeText(roleConfig.apiKey);
      if (!baseUrl) {
        return {
          ok: false,
          error: 'openalice_base_url_missing',
          reason: `${normalizeText(roleConfig.role) || 'openalice'} baseUrl is empty`,
          statusCode: 503,
          body: {}
        };
      }
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

  async function callWithFallback(roleConfig = {}, pathCandidates = [], payload = {}, method = 'POST') {
    const baseUrl = normalizeBaseUrl(roleConfig.baseUrl);
    if (!baseUrl) {
      return {
        ok: false,
        error: 'openalice_base_url_missing',
        reason: `${normalizeText(roleConfig.role) || 'openalice'} baseUrl is empty.`,
        statusCode: 503,
        body: {}
      };
    }
    const candidates = Array.isArray(pathCandidates) ? pathCandidates : [];
    const failures = [];
    for (const pathname of candidates) {
      for (let i = 0; i <= retry; i += 1) {
        const result = await requestJson(roleConfig, pathname, payload, method);
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

  function pickBodyDataObject(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return (
      pickObject(body.result) ||
      pickObject(body.data) ||
      pickObject(body.output) ||
      pickObject(body.analysis) ||
      null
    );
  }

  function parseChatBody(body = {}) {
    const bodyObject = pickObject(body) || {};
    const dataObject = pickBodyDataObject(bodyObject);
    if (dataObject) {
      return {
        data: dataObject,
        rawText: ''
      };
    }
    const textCandidate = normalizeText(
      bodyObject.text ||
        bodyObject.message ||
        bodyObject.reply ||
        bodyObject.outputText ||
        bodyObject.resultText ||
        ''
    );
    const parsed = parseJsonObjectFromText(textCandidate);
    if (parsed) {
      return {
        data: parsed,
        rawText: textCandidate
      };
    }
    return {
      data: null,
      rawText: textCandidate
    };
  }

  async function callChat(roleConfig = {}, message = '') {
    const result = await callWithFallback(roleConfig, ['/api/chat', '/chat', '/v1/chat'], { message }, 'POST');
    if (!result.ok) return result;
    const parsed = parseChatBody(result.body || {});
    if (parsed.data) {
      return {
        ok: true,
        data: parsed.data,
        statusCode: result.statusCode,
        body: result.body,
        rawText: parsed.rawText
      };
    }
    return {
      ok: true,
      data: null,
      statusCode: result.statusCode,
      body: result.body,
      rawText: parsed.rawText
    };
  }

  async function probeRoleHealth(roleConfig = {}) {
    const roleName = normalizeText(roleConfig.role) || 'openalice';
    const baseUrl = normalizeBaseUrl(roleConfig.baseUrl);
    if (!baseUrl) {
      return {
        role: roleName,
        ok: false,
        connected: false,
        reason: `${roleName} baseUrl is empty`,
        checkedAt: toIsoNow()
      };
    }

    const healthResult = await callWithFallback(
      roleConfig,
      ['/health', '/status', '/api/health', '/api/openalice/health', '/v1/health'],
      null,
      'GET'
    );
    if (healthResult.ok) {
      return {
        role: roleName,
        ok: true,
        connected: true,
        reason: 'health_ok',
        checkedAt: toIsoNow(),
        details: healthResult.body
      };
    }

    const chatProbe = await callChat(roleConfig, 'Return exactly: {"ok":true}');
    if (chatProbe.ok) {
      return {
        role: roleName,
        ok: true,
        connected: true,
        reason: 'chat_ok',
        checkedAt: toIsoNow(),
        details: pickObject(chatProbe.body) || {}
      };
    }

    return {
      role: roleName,
      ok: false,
      connected: false,
      reason: healthResult.reason || chatProbe.reason || `${roleName} unavailable`,
      checkedAt: toIsoNow(),
      details: {}
    };
  }

  async function health() {
    if (!hasRemote) {
      return {
        ok: false,
        connected: false,
        reason: 'OPENALICE_*_BASE_URL is empty',
        checkedAt: toIsoNow(),
        roles: {
          message: {
            role: 'message',
            ok: false,
            connected: false,
            reason: 'message baseUrl is empty',
            checkedAt: toIsoNow()
          },
          technical: {
            role: 'technical',
            ok: false,
            connected: false,
            reason: 'technical baseUrl is empty',
            checkedAt: toIsoNow()
          }
        }
      };
    }

    const infoHealth = await probeRoleHealth(infoRole);
    const technicalHealth = await probeRoleHealth(technicalRole);
    const ok = Boolean(infoHealth.ok && technicalHealth.ok);
    return {
      ok,
      connected: ok,
      reason: ok ? 'ok' : `message:${infoHealth.reason}; technical:${technicalHealth.reason}`,
      checkedAt: toIsoNow(),
      roles: {
        message: infoHealth,
        technical: technicalHealth
      }
    };
  }

  function buildInfoFallbackData(input = {}, rawText = '') {
    return {
      provider: 'openalice-chat',
      traceId: normalizeText(input.traceId || ''),
      topic: normalizeText(input.topic || input.url || 'market-context'),
      sentimentScore: 0,
      confidence: 0.35,
      headlines: ['OpenAlice returned plain text'],
      keyFactors: normalizeText(rawText).slice(0, 180) ? [normalizeText(rawText).slice(0, 180)] : [],
      summary: normalizeText(rawText).slice(0, 700) || 'OpenAlice response is not JSON.',
      asOf: toIsoNow()
    };
  }

  function buildTechnicalFallbackData(input = {}, rawText = '') {
    const symbol = normalizeText(input.symbol || input.pair || 'BTCUSDT').toUpperCase() || 'BTCUSDT';
    const timeframe = normalizeText(input.timeframe || `${Number(input.horizonMin || 60)}m`);
    return {
      provider: 'openalice-chat',
      traceId: normalizeText(input.traceId || ''),
      symbol,
      timeframe,
      indicators: { rsi: null, macd: null, emaFast: null, emaSlow: null, atr: null },
      signals: { trend: 'sideways', momentum: 'neutral', volatility: 'normal', bias: 'neutral' },
      confidence: 0.35,
      riskBand: { stopLossPct: 1.5, takeProfitPct: 3 },
      riskScore: 50,
      summary: normalizeText(rawText).slice(0, 700) || `Technical analysis placeholder for ${symbol}.`,
      asOf: toIsoNow(),
      quote: null
    };
  }

  async function analyzeInfo(input = {}) {
    const payload = {
      kind: 'info-analysis',
      ...input
    };
    const endpointResult = await callWithFallback(
      infoRole,
      ['/api/analysis/info/run', '/api/analysis/info', '/analysis/info', '/v1/analysis/info'],
      payload,
      'POST'
    );
    if (endpointResult.ok) {
      return {
        ok: true,
        data: pickBodyDataObject(endpointResult.body) || pickObject(endpointResult.body) || {},
        statusCode: endpointResult.statusCode,
        body: endpointResult.body,
        route: 'message-endpoint'
      };
    }

    const chatResult = await callChat(infoRole, buildInfoChatMessage(payload));
    if (!chatResult.ok) return chatResult;
    return {
      ok: true,
      data: pickObject(chatResult.data) || buildInfoFallbackData(payload, chatResult.rawText || ''),
      statusCode: chatResult.statusCode,
      body: chatResult.body,
      route: 'message-chat'
    };
  }

  async function analyzeTechnical(input = {}) {
    const payload = {
      kind: 'technical-analysis',
      ...input
    };

    const endpointResult = await callWithFallback(
      technicalRole,
      ['/api/analysis/technical/run', '/api/analysis/technical', '/analysis/technical', '/v1/analysis/technical'],
      payload,
      'POST'
    );
    if (endpointResult.ok) {
      return {
        ok: true,
        data: pickBodyDataObject(endpointResult.body) || pickObject(endpointResult.body) || {},
        statusCode: endpointResult.statusCode,
        body: endpointResult.body,
        route: 'technical-endpoint'
      };
    }

    const chatResult = await callChat(technicalRole, buildTechnicalChatMessage(payload));
    if (!chatResult.ok) return chatResult;
    return {
      ok: true,
      data: pickObject(chatResult.data) || buildTechnicalFallbackData(payload, chatResult.rawText || ''),
      statusCode: chatResult.statusCode,
      body: chatResult.body,
      route: 'technical-chat'
    };
  }

  function info() {
    const mode =
      infoRole.baseUrl && technicalRole.baseUrl
        ? infoRole.baseUrl === technicalRole.baseUrl
          ? 'single-endpoint'
          : 'dual-endpoint'
        : hasRemote
          ? 'partial'
          : 'disabled';
    return {
      mode,
      hasRemote,
      roles: {
        message: {
          role: infoRole.role,
          baseUrl: infoRole.baseUrl
        },
        technical: {
          role: technicalRole.role,
          baseUrl: technicalRole.baseUrl
        }
      },
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
