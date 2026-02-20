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

  const res = await fetch('/api/x402/kol-score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payer,
      query,
      action,
      requestId,
      paymentProof,
      actionParams,
      identity: identityPayload
    })
  });

  const body = await res.json();
  return { status: res.status, body };
}

export async function fetchX402ByTxHash(hash) {
  const res = await fetch(`/api/x402/requests?txHash=${String(hash).toLowerCase()}&limit=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items[0] : null;
}
