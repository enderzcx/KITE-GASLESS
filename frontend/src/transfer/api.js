export async function loadIdentityProfile() {
  const res = await fetch('/api/identity');
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.reason || `HTTP ${res.status}`);
  }
  return data.profile || null;
}

export async function logRecord(record) {
  try {
    await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    });
  } catch {
    // ignore logging errors in UI path
  }
}

export async function requestPaidAction({
  payer,
  query,
  action,
  requestId,
  paymentProof,
  actionParams,
  identity
}) {
  const identityPayload = {
    agentId: identity?.configured?.agentId || '',
    identityRegistry: identity?.configured?.registry || ''
  };

  const normalizedAction = String(action || '').trim().toLowerCase();
  const isReactiveA2A = normalizedAction === 'reactive-stop-orders';
  const endpoint = isReactiveA2A ? '/api/a2a/tasks/stop-orders' : '/api/x402/kol-score';

  const payload = isReactiveA2A
    ? {
        payer,
        sourceAgentId: identityPayload.agentId || '1',
        targetAgentId: '2',
        requestId,
        paymentProof,
        task: actionParams || {}
      }
    : {
        payer,
        query,
        action,
        requestId,
        paymentProof,
        actionParams,
        identity: identityPayload
      };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `API ${endpoint} returned non-JSON (HTTP ${res.status}). ` +
        `Please restart backend and ensure latest routes are loaded.`
    );
  }
  return { status: res.status, body };
}

export async function fetchX402ByTxHash(hash) {
  const res = await fetch(`/api/x402/requests?txHash=${String(hash).toLowerCase()}&limit=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items[0] : null;
}
