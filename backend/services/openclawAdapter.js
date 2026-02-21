import crypto from 'crypto';

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function parseStopOrderIntent(message = '') {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
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

export function createOpenClawAdapter(config = {}) {
  const baseUrl = String(config.baseUrl || '').trim().replace(/\/+$/, '');
  const chatPath = String(config.chatPath || '/api/v1/chat').trim();
  const healthPath = String(config.healthPath || '/health').trim();
  const apiKey = String(config.apiKey || '').trim();
  const timeoutMs = Number(config.timeoutMs || 12_000);

  const hasRemote = Boolean(baseUrl);

  async function requestRemote(payload) {
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
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return {
          ok: false,
          error: body?.error || 'openclaw_remote_error',
          reason: body?.reason || `OpenClaw HTTP ${resp.status}`,
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

  async function health() {
    if (!hasRemote) {
      return {
        ok: true,
        mode: 'local-fallback',
        connected: true,
        reason: 'OPENCLAW_BASE_URL is empty; using local adapter fallback.'
      };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(`${baseUrl}${healthPath}`, {
        method: 'GET',
        headers: {
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        signal: ctrl.signal
      });
      if (!resp.ok) {
        return {
          ok: false,
          mode: 'remote',
          connected: false,
          reason: `OpenClaw health HTTP ${resp.status}`
        };
      }
      return {
        ok: true,
        mode: 'remote',
        connected: true,
        reason: 'OpenClaw reachable'
      };
    } catch (error) {
      return {
        ok: false,
        mode: 'remote',
        connected: false,
        reason: error?.name === 'AbortError' ? 'OpenClaw health timeout' : (error?.message || 'OpenClaw health failed')
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function chat({ message, sessionId, traceId, context = {} }) {
    const nextTraceId = String(traceId || createTraceId('trace')).trim();
    const intent = parseStopOrderIntent(message);

    if (hasRemote) {
      const remote = await requestRemote({
        message,
        sessionId,
        traceId: nextTraceId,
        context
      });
      if (remote.ok) {
        const body = remote.body || {};
        return {
          ok: true,
          reply: String(body.reply || body.message || 'Received.'),
          traceId: String(body.traceId || nextTraceId),
          state: String(body.state || (intent ? 'intent_recognized' : 'received')),
          step: String(body.step || (intent ? 'intent_parsed' : 'chat_received')),
          suggestions: Array.isArray(body.suggestions) ? body.suggestions : [],
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

    let reply = 'Received. Use \"place stop order BTC-USDT TP 80000 SL 50000\" to run workflow.';
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
      reply,
      traceId: nextTraceId,
      state,
      step,
      suggestions,
      raw: { mode: 'local-fallback' }
    };
  }

  return { chat, health };
}
