#!/usr/bin/env node

// Minimal internal-node demo runner for KITE agent network.
// It triggers router info/technical demo and fetches runs + audit timeline.

const DEFAULT_BASE_URL = process.env.KITE_BACKEND_URL || 'http://127.0.0.1:3001';

function parseArgs(argv) {
  const out = {
    base: DEFAULT_BASE_URL,
    apiKey: process.env.KITECLAW_API_KEY_AGENT || process.env.KITECLAW_API_KEY_VIEWER || '',
    waitMs: 15000,
    retryOnTimeout: true,
    autoStart: true
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = String(argv[i + 1] || '').trim();
    const hasNextValue = next && !next.startsWith('--');

    switch (key) {
      case 'base':
        if (hasNextValue) {
          out.base = next;
          i += 1;
        }
        break;
      case 'api-key':
        if (hasNextValue) {
          out.apiKey = next;
          i += 1;
        }
        break;
      case 'wait-ms': {
        const parsed = Number(next);
        if (hasNextValue && Number.isFinite(parsed) && parsed > 0) {
          out.waitMs = Math.trunc(parsed);
          i += 1;
        }
        break;
      }
      case 'retry-on-timeout':
        out.retryOnTimeout = true;
        break;
      case 'no-retry-on-timeout':
        out.retryOnTimeout = false;
        break;
      case 'auto-start':
        out.autoStart = true;
        break;
      case 'no-auto-start':
        out.autoStart = false;
        break;
      default:
        break;
    }
  }

  out.base = out.base.replace(/\/+$/, '');
  return out;
}

async function requestJson({ method, base, path, apiKey, body }) {
  const headers = {
    'content-type': 'application/json'
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = {
      ok: false,
      error: 'invalid_json_response',
      reason: error.message,
      raw: text
    };
  }

  return {
    status: response.status,
    ok: response.ok,
    payload
  };
}

function printUsage() {
  console.log('Usage: node demo/node-internal/run-demo.mjs [options]');
  console.log('Options:');
  console.log('  --base <url>               Backend base URL (default: http://127.0.0.1:3001)');
  console.log('  --api-key <key>            API key for protected endpoints');
  console.log('  --wait-ms <ms>             Wait timeout for router demo (default: 15000)');
  console.log('  --retry-on-timeout         Enable retry on timeout (default)');
  console.log('  --no-retry-on-timeout      Disable retry on timeout');
  console.log('  --auto-start               Auto start XMTP runtimes (default)');
  console.log('  --no-auto-start            Do not auto start XMTP runtimes');
}

function getTraceIdFromRun(runResponse) {
  const commandTraceId = String(runResponse?.payload?.command?.traceId || '').trim();
  if (commandTraceId) return commandTraceId;
  const payloadTraceId = String(runResponse?.payload?.traceId || '').trim();
  if (payloadTraceId && !payloadTraceId.startsWith('req_')) return payloadTraceId;
  return '';
}

function renderTimeline(timeline) {
  const rows = Array.isArray(timeline) ? timeline : [];
  const compact = rows.slice(0, 12).map((item) => ({
    seq: item?.seq,
    type: item?.type,
    actorId: item?.actorId,
    at: item?.at,
    status:
      item?.summary?.status ||
      item?.summary?.quote?.status ||
      item?.summary?.rationale?.selectedActorId ||
      ''
  }));
  console.table(compact);
  if (rows.length > compact.length) {
    console.log(`... ${rows.length - compact.length} more events omitted`);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  console.log('Step 1/3: trigger internal node demo run');
  const runResp = await requestJson({
    method: 'POST',
    base: args.base,
    path: '/api/network/demo/router-info-technical/run',
    apiKey: args.apiKey,
    body: {
      autoStart: args.autoStart,
      retryOnTimeout: args.retryOnTimeout,
      waitMs: args.waitMs
    }
  });

  if (!runResp.ok || !runResp.payload?.ok) {
    console.error('Run failed:', JSON.stringify(runResp.payload, null, 2));
    process.exitCode = 1;
    return;
  }

  const runTraceId = getTraceIdFromRun(runResp);
  if (!runTraceId) {
    console.error('Run succeeded but traceId is missing in response.');
    process.exitCode = 1;
    return;
  }

  console.log(`Run traceId: ${runTraceId}`);

  console.log('Step 2/3: fetch run summary');
  const runsResp = await requestJson({
    method: 'GET',
    base: args.base,
    path: `/api/network/runs?traceId=${encodeURIComponent(runTraceId)}`,
    apiKey: args.apiKey
  });

  if (!runsResp.ok || !runsResp.payload?.ok) {
    console.error('Fetch runs failed:', JSON.stringify(runsResp.payload, null, 2));
    process.exitCode = 1;
    return;
  }

  const runs = Array.isArray(runsResp.payload?.items) ? runsResp.payload.items : [];
  console.table(
    runs.map((item) => ({
      traceId: item?.traceId,
      state: item?.state,
      totalEvents: item?.totalEvents,
      latestEventType: item?.latestEventType,
      latestAt: item?.latestAt
    }))
  );

  console.log('Step 3/3: fetch timeline + negotiation terms');
  const auditResp = await requestJson({
    method: 'GET',
    base: args.base,
    path: `/api/network/audit/${encodeURIComponent(runTraceId)}`,
    apiKey: args.apiKey
  });

  if (!auditResp.ok || !auditResp.payload?.ok) {
    console.error('Fetch audit failed:', JSON.stringify(auditResp.payload, null, 2));
    process.exitCode = 1;
    return;
  }

  const audit = auditResp.payload;
  console.log('Negotiation terms:');
  console.log(JSON.stringify(audit.negotiation || {}, null, 2));

  console.log('Timeline preview:');
  renderTimeline(audit.timeline);

  console.log('Demo complete.');
}

main().catch((error) => {
  console.error('Unexpected error:', error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
