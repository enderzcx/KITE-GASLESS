const args = process.argv.slice(2);

function readArg(name, fallback = '') {
  const key = `--${name}`;
  const index = args.findIndex((item) => item === key || item.startsWith(`${key}=`));
  if (index < 0) return fallback;
  const token = args[index];
  if (token.includes('=')) return token.slice(token.indexOf('=') + 1).trim() || fallback;
  return String(args[index + 1] || '').trim() || fallback;
}

const baseUrl = String(readArg('base-url', 'http://127.0.0.1:3399')).replace(/\/+$/, '');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(method, path, body = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    text,
    json
  };
}

function extractX402(reply = '', label = '消息面') {
  const pattern = new RegExp(`${label}\\s+x402:\\s*requestId=([^\\s]+)\\s+txHash=([^\\s]+)`);
  const matched = String(reply || '').match(pattern);
  return {
    requestId: matched?.[1] || '',
    txHash: matched?.[2] || ''
  };
}

async function runInfoOnlyCase() {
  const resp = await requestJson('POST', '/api/agent001/chat/run', {
    autoStart: true,
    text: '仅消息面，不要技术面。给我 BTC 最新市场情绪摘要。'
  });
  assert(resp.ok && resp.json?.ok, `info-only call failed: status=${resp.status} body=${resp.text}`);
  const reply = String(resp.json?.reply || '').trim();
  assert(reply.includes('消息面:'), `info-only reply missing 消息面: ${reply}`);
  assert(!reply.includes('技术面:'), `info-only reply should not include 技术面: ${reply}`);
  assert(reply.includes('消息面 x402: requestId='), `info-only reply missing 消息面 x402 evidence: ${reply}`);
  const x402 = extractX402(reply, '消息面');
  assert(x402.requestId && x402.txHash, `info-only x402 parse failed: ${reply}`);

  const pull = await requestJson('GET', `/api/agent001/results/${x402.requestId}`);
  assert(pull.ok && pull.json?.ok, `info-only pull failed: status=${pull.status} body=${pull.text}`);
  assert(
    String(pull.json?.capability || '').trim() === 'info-analysis-feed',
    `info-only capability mismatch: ${pull.text}`
  );
  assert(
    String(pull.json?.payment?.txHash || '').trim().toLowerCase() === x402.txHash.toLowerCase(),
    `info-only txHash mismatch: reply=${x402.txHash}, pull=${String(pull.json?.payment?.txHash || '').trim()}`
  );
  return { reply, ...x402 };
}

async function runTechnicalOnlyCase() {
  const resp = await requestJson('POST', '/api/agent001/chat/run', {
    autoStart: true,
    text: '仅技术面，不要消息面。给我 BTCUSDT 60m 技术分析结论。'
  });
  assert(resp.ok && resp.json?.ok, `technical-only call failed: status=${resp.status} body=${resp.text}`);
  const reply = String(resp.json?.reply || '').trim();
  assert(reply.includes('技术面:'), `technical-only reply missing 技术面: ${reply}`);
  assert(!reply.includes('消息面:'), `technical-only reply should not include 消息面: ${reply}`);
  assert(reply.includes('技术面 x402: requestId='), `technical-only reply missing 技术面 x402 evidence: ${reply}`);
  const x402 = extractX402(reply, '技术面');
  assert(x402.requestId && x402.txHash, `technical-only x402 parse failed: ${reply}`);

  const pull = await requestJson('GET', `/api/agent001/results/${x402.requestId}`);
  assert(pull.ok && pull.json?.ok, `technical-only pull failed: status=${pull.status} body=${pull.text}`);
  assert(
    String(pull.json?.capability || '').trim() === 'technical-analysis-feed',
    `technical-only capability mismatch: ${pull.text}`
  );
  assert(
    String(pull.json?.payment?.txHash || '').trim().toLowerCase() === x402.txHash.toLowerCase(),
    `technical-only txHash mismatch: reply=${x402.txHash}, pull=${String(pull.json?.payment?.txHash || '').trim()}`
  );
  return { reply, ...x402 };
}

async function runFailureCase() {
  const resp = await requestJson('POST', '/api/agent001/chat/run', {
    autoStart: true,
    text: ''
  });
  assert(!resp.ok, `failure case should be non-2xx: status=${resp.status} body=${resp.text}`);
  assert(resp.status === 400, `failure case status should be 400, got=${resp.status}, body=${resp.text}`);
  assert(resp.json?.ok === false, `failure case body missing ok=false: ${resp.text}`);
  assert(String(resp.json?.error || '').trim() === 'text_required', `failure case error mismatch: ${resp.text}`);
  assert(String(resp.json?.reason || '').trim(), `failure case missing reason: ${resp.text}`);
  return resp.json;
}

async function main() {
  const info = await runInfoOnlyCase();
  const technical = await runTechnicalOnlyCase();
  const failed = await runFailureCase();
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        infoOnly: {
          requestId: info.requestId,
          txHash: info.txHash
        },
        technicalOnly: {
          requestId: technical.requestId,
          txHash: technical.txHash
        },
        failure: {
          error: failed.error,
          reason: failed.reason
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        baseUrl,
        error: String(error?.message || error).trim() || 'verify_failed'
      },
      null,
      2
    )
  );
  process.exit(1);
});
