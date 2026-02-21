import crypto from 'crypto';

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function parseStopOrderIntent(message = '') {
  const text = String(message || '').trim();
  const stopLike = /(stop|tp|sl|止盈|止损)/i.test(text);
  if (!stopLike) return null;

  const symbolMatch = text.match(/\b([A-Z]{2,10}-[A-Z]{2,10})\b/i);
  const tpMatch = text.match(/\b(?:tp|take\s*profit)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i);
  const slMatch = text.match(/\b(?:sl|stop\s*loss)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/i);

  return {
    action: 'place_stop_order',
    symbol: symbolMatch ? symbolMatch[1].toUpperCase() : 'BTC-USDT',
    takeProfit: tpMatch ? Number(tpMatch[1]) : 80000,
    stopLoss: slMatch ? Number(slMatch[1]) : 50000
  };
}

function normalizeRole(rawRole = '') {
  const role = String(rawRole || '').trim().toLowerCase();
  if (role === 'assistant' || role === 'agent') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((item) => {
      const role = normalizeRole(item?.role);
      const content = String(item?.content || item?.text || item?.message || '').trim();
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);
}

function resolveProtocol(protocol, chatPath) {
  const explicit = String(protocol || '').trim().toLowerCase();
  if (explicit === 'openai' || explicit === 'openclaw') return explicit;

  const path = String(chatPath || '').toLowerCase();
  if (path.includes('/chat/completions')) return 'openai';
  return 'openclaw';
}

function normalizeContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (typeof item.text === 'string') return item.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function extractReplyFromBody(body) {
  if (!body || typeof body !== 'object') return '';

  const direct =
    normalizeContent(body.reply) ||
    normalizeContent(body.message) ||
    normalizeContent(body.output) ||
    normalizeContent(body.text) ||
    normalizeContent(body?.data?.reply) ||
    normalizeContent(body?.data?.message) ||
    normalizeContent(body?.result?.reply) ||
    normalizeContent(body?.result?.message);
  if (direct) return direct;

  const openaiMessage = normalizeContent(body?.choices?.[0]?.message?.content);
  if (openaiMessage) return openaiMessage;

  const altText = normalizeContent(body?.choices?.[0]?.text) || normalizeContent(body?.output_text);
  if (altText) return altText;

  return '';
}

function extractSuggestions(body) {
  if (Array.isArray(body?.suggestions)) return body.suggestions;
  if (Array.isArray(body?.data?.suggestions)) return body.data.suggestions;
  if (Array.isArray(body?.result?.suggestions)) return body.result.suggestions;
  return [];
}

function buildMessages({ history, message, systemPrompt, context }) {
  const msgs = [];
  if (systemPrompt) {
    msgs.push({ role: 'system', content: systemPrompt });
  }
  if (context && typeof context === 'object') {
    const contextPayload = {
      aaWallet: context.aaWallet || '',
      owner: context.owner || '',
      runtimeReady: Boolean(context.runtimeReady)
    };
    msgs.push({
      role: 'system',
      content: `Runtime context: ${JSON.stringify(contextPayload)}`
    });
  }
  msgs.push(...normalizeHistory(history));
  msgs.push({ role: 'user', content: String(message || '').trim() });
  return msgs;
}

export function createOpenClawAdapter(config = {}) {
  const baseUrl = String(config.baseUrl || '').trim().replace(/\/+$/, '');
  const chatPath = String(config.chatPath || '/api/v1/chat').trim();
  const healthPath = String(config.healthPath || '/health').trim();
  const apiKey = String(config.apiKey || '').trim();
  const timeoutMs = Number(config.timeoutMs || 12_000);
  const protocol = resolveProtocol(config.protocol, chatPath);
  const model = String(config.model || '').trim();
  const systemPrompt = String(config.systemPrompt || '').trim();

  const hasRemote = Boolean(baseUrl);

  async function requestRemote({ message, sessionId, traceId, context = {}, history = [], agent = '' }) {
    const messages = buildMessages({ history, message, systemPrompt, context });
    const payload =
      protocol === 'openai'
        ? {
            model: model || 'openclaw-local',
            messages,
            stream: false,
            temperature: 0.2,
            user: sessionId || undefined,
            metadata: {
              traceId: traceId || '',
              agent: String(agent || '').trim()
            }
          }
        : {
            message,
            input: message,
            sessionId,
            traceId,
            context,
            history: normalizeHistory(history),
            messages,
            agent: String(agent || '').trim()
          };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(`${baseUrl}${chatPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      const rawText = await resp.text();
      let body = {};
      try {
        body = rawText ? JSON.parse(rawText) : {};
      } catch {
        body = { rawText };
      }
      if (!resp.ok) {
        const detail =
          String(body?.reason || body?.error || body?.message || '').trim() ||
          String(rawText || '').slice(0, 240);
        const statusText = String(resp.statusText || '').trim();
        const fallbackReason = statusText ? `OpenClaw HTTP ${resp.status} ${statusText}` : `OpenClaw HTTP ${resp.status}`;
        return {
          ok: false,
          error: body?.error || 'openclaw_remote_error',
          reason: detail || fallbackReason,
          statusCode: resp.status
        };
      }
      return { ok: true, body };
    } catch (error) {
      return {
        ok: false,
        error: 'openclaw_unreachable',
        reason: error?.name === 'AbortError' ? 'OpenClaw timeout' : (error?.message || 'OpenClaw request failed'),
        statusCode: 503
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestHealth(pathname) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(`${baseUrl}${pathname}`, {
        method: 'GET',
        headers: {
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        signal: ctrl.signal
      });
      if (!resp.ok) {
        return {
          ok: false,
          reason: `OpenClaw health HTTP ${resp.status} (${pathname})`
        };
      }
      const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
      const isOpenAiModels = protocol === 'openai' && pathname.includes('/v1/models');
      if (!isOpenAiModels) {
        return { ok: true, reason: 'OpenClaw reachable' };
      }

      const rawText = await resp.text();
      let body = null;
      try {
        body = rawText ? JSON.parse(rawText) : null;
      } catch {
        body = null;
      }

      if (!contentType.includes('application/json') || !body || !Array.isArray(body.data)) {
        return {
          ok: false,
          reason: `OpenAI models endpoint returned invalid payload (${pathname})`
        };
      }

      return { ok: true, reason: 'OpenAI-compatible endpoint reachable' };
    } catch (error) {
      return {
        ok: false,
        reason:
          error?.name === 'AbortError'
            ? `OpenClaw health timeout (${pathname})`
            : (error?.message || `OpenClaw health failed (${pathname})`)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function health() {
    if (!hasRemote) {
      return {
        ok: true,
        mode: 'local-fallback',
        connected: true,
        reason: 'OPENCLAW_BASE_URL is empty; using local adapter fallback.'
      };
    }

    const primary = await requestHealth(healthPath);
    if (primary.ok) {
      return {
        ok: true,
        mode: 'remote',
        connected: true,
        reason: primary.reason
      };
    }

    if (protocol === 'openai' && healthPath === '/health') {
      const fallback = await requestHealth('/v1/models');
      if (fallback.ok) {
        return {
          ok: true,
          mode: 'remote',
          connected: true,
          reason: 'OpenAI-compatible endpoint reachable (/v1/models)'
        };
      }
      return {
        ok: false,
        mode: 'remote',
        connected: false,
        reason: `${primary.reason}; fallback failed: ${fallback.reason}`
      };
    }

    return {
      ok: false,
      mode: 'remote',
      connected: false,
      reason: primary.reason
    };
  }

  async function chat({ message, sessionId, traceId, context = {}, history = [], agent = '' }) {
    const nextTraceId = String(traceId || createTraceId('trace')).trim();
    const intent = parseStopOrderIntent(message);

    if (hasRemote) {
      const remote = await requestRemote({
        message,
        sessionId,
        traceId: nextTraceId,
        context,
        history,
        agent
      });
      if (remote.ok) {
        const body = remote.body || {};
        const reply = extractReplyFromBody(body);
        const state = String(
          body.state ||
          body.status ||
          body.phase ||
          (intent ? 'intent_recognized' : 'received')
        );
        const step = String(body.step || body.action || (intent ? 'intent_parsed' : 'chat_received'));
        return {
          ok: true,
          mode: 'remote',
          reply: reply || 'Received.',
          traceId: String(body.traceId || nextTraceId),
          state,
          step,
          suggestions: extractSuggestions(body),
          raw: body
        };
      }
      return {
        ok: false,
        traceId: nextTraceId,
        error: remote.error,
        reason: remote.reason,
        statusCode: remote.statusCode || 503
      };
    }

    let reply = 'Received. Use "place stop order BTC-USDT TP 80000 SL 50000" to run workflow.';
    let state = 'received';
    let step = 'chat_received';
    const suggestions = [];

    if (intent) {
      reply = 'Intent recognized. Ready to run stop-order workflow.';
      state = 'intent_recognized';
      step = 'intent_parsed';
      suggestions.push({
        action: 'place_stop_order',
        endpoint: '/api/workflow/stop-order/run',
        params: {
          symbol: intent.symbol,
          takeProfit: intent.takeProfit,
          stopLoss: intent.stopLoss
        }
      });
    }

    return {
      ok: true,
      mode: 'local-fallback',
      reply,
      traceId: nextTraceId,
      state,
      step,
      suggestions,
      raw: { mode: 'local-fallback' }
    };
  }

  function info() {
    return {
      hasRemote,
      mode: hasRemote ? 'remote' : 'local-fallback',
      protocol,
      chatPath,
      healthPath,
      baseUrl: hasRemote ? baseUrl : '',
      model: model || ''
    };
  }

  return { chat, health, info };
}
