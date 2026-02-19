import { useEffect, useState } from 'react';

const DEFAULT_ALLOWED = '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const INVALID_SCOPE_RECIPIENT = '0x1111111111111111111111111111111111111111';
const TOKEN_ADDRESS =
  import.meta.env.VITE_KITEAI_SETTLEMENT_TOKEN ||
  import.meta.env.VITE_SETTLEMENT_TOKEN ||
  '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';

function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.01';
  return (Math.round(n * 10000) / 10000).toString();
}

function AbuseCasesPage({ onBack, walletState }) {
  const [policy, setPolicy] = useState(null);
  const [failures, setFailures] = useState([]);
  const [running, setRunning] = useState('');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('');

  const payer = walletState?.aaAddress || walletState?.ownerAddress || '';
  const allowedRecipient = policy?.allowedRecipients?.[0] || DEFAULT_ALLOWED;
  const maxPerTx = Number(policy?.maxPerTx || 0.2);
  const baseAmount = Math.max(0.01, Math.min(0.1, maxPerTx));
  const overLimitAmount = formatAmount(maxPerTx + 0.11);

  const loadPolicy = async () => {
    try {
      const res = await fetch('/api/x402/policy');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPolicy(data?.policy || null);
    } catch (error) {
      setStatus(`Load policy failed: ${error.message}`);
    }
  };

  const loadFailures = async () => {
    try {
      const res = await fetch('/api/x402/policy-failures?limit=20');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFailures(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      setStatus(`Load policy failures failed: ${error.message}`);
    }
  };

  useEffect(() => {
    void loadPolicy();
    void loadFailures();
  }, []);

  const postTransferIntent = async (payload) => {
    const res = await fetch('/api/x402/transfer-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  const finalizeCase = async (label, response, extra = {}) => {
    setResult({
      label,
      httpStatus: response.status,
      error: response.body?.error || '',
      reason: response.body?.reason || '',
      evidence: response.body?.evidence || null,
      ...extra
    });
    await loadFailures();
  };

  const runOverLimitCase = async () => {
    const label = 'Over-limit amount';
    setRunning(label);
    setStatus('Running over-limit case...');
    const response = await postTransferIntent({
      payer,
      recipient: allowedRecipient,
      amount: overLimitAmount,
      tokenAddress: TOKEN_ADDRESS
    });
    await finalizeCase(label, response, { expected: '403 over_limit_per_tx' });
    setStatus('Done.');
    setRunning('');
  };

  const runScopeViolationCase = async () => {
    const label = 'Scope violation recipient';
    setRunning(label);
    setStatus('Running scope-violation case...');
    const response = await postTransferIntent({
      payer,
      recipient: INVALID_SCOPE_RECIPIENT,
      amount: formatAmount(baseAmount),
      tokenAddress: TOKEN_ADDRESS
    });
    await finalizeCase(label, response, { expected: '403 scope_violation' });
    setStatus('Done.');
    setRunning('');
  };

  const runFakeProofCase = async () => {
    const label = 'Fake proof replay';
    setRunning(label);
    setStatus('Running fake-proof case...');
    const first = await postTransferIntent({
      payer,
      recipient: allowedRecipient,
      amount: formatAmount(baseAmount),
      tokenAddress: TOKEN_ADDRESS
    });
    if (first.status !== 402 || !first.body?.x402?.requestId) {
      await finalizeCase(label, first, { expected: 'First step 402 challenge' });
      setStatus('Done.');
      setRunning('');
      return;
    }

    const reqId = first.body.x402.requestId;
    const second = await postTransferIntent({
      payer,
      recipient: allowedRecipient,
      amount: formatAmount(baseAmount),
      tokenAddress: TOKEN_ADDRESS,
      requestId: reqId,
      paymentProof: {
        requestId: reqId,
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        payer,
        tokenAddress: TOKEN_ADDRESS,
        recipient: allowedRecipient,
        amount: formatAmount(baseAmount)
      }
    });
    await finalizeCase(label, second, {
      expected: '402 proof not found in transfer records',
      challengeRequestId: reqId
    });
    setStatus('Done.');
    setRunning('');
  };

  const runExpiredCase = async () => {
    const label = 'Expired request';
    setRunning(label);
    setStatus('Running expired-request case...');
    const first = await postTransferIntent({
      payer,
      recipient: allowedRecipient,
      amount: formatAmount(baseAmount),
      tokenAddress: TOKEN_ADDRESS
    });
    if (first.status !== 402 || !first.body?.x402?.requestId) {
      await finalizeCase(label, first, { expected: 'First step 402 challenge' });
      setStatus('Done.');
      setRunning('');
      return;
    }
    const reqId = first.body.x402.requestId;
    const second = await postTransferIntent({
      payer,
      recipient: allowedRecipient,
      amount: formatAmount(baseAmount),
      tokenAddress: TOKEN_ADDRESS,
      requestId: reqId,
      debugForceExpire: true,
      paymentProof: {
        requestId: reqId,
        txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        payer,
        tokenAddress: TOKEN_ADDRESS,
        recipient: allowedRecipient,
        amount: formatAmount(baseAmount)
      }
    });
    await finalizeCase(label, second, {
      expected: '402 request expired',
      challengeRequestId: reqId
    });
    setStatus('Done.');
    setRunning('');
  };

  const runInsufficientFundsCase = async () => {
    const label = 'Insufficient funds (graceful demo)';
    setRunning(label);
    setStatus('Running insufficient-funds case...');
    const response = await postTransferIntent({
      payer,
      recipient: allowedRecipient,
      amount: formatAmount(baseAmount),
      tokenAddress: TOKEN_ADDRESS,
      simulateInsufficientFunds: true
    });
    await finalizeCase(label, response, { expected: '402 insufficient_funds' });
    setStatus('Done.');
    setRunning('');
  };

  return (
    <div className="transfer-container records-page">
      <div className="top-entry">
        {onBack && (
          <button className="link-btn" onClick={onBack}>
            Back to Transfer Page
          </button>
        )}
        <button className="link-btn" onClick={loadFailures}>
          Refresh Failures
        </button>
      </div>

      <h1>Abuse / Over-limit Graceful Failure</h1>

      <div className="vault-card">
        <h2>Policy Snapshot</h2>
        <div className="result-row">
          <span className="label">Payer:</span>
          <span className="value hash">{payer || 'Not connected'}</span>
        </div>
        <div className="result-row">
          <span className="label">Allowed recipient:</span>
          <span className="value hash">{allowedRecipient}</span>
        </div>
        <div className="result-row">
          <span className="label">Max per tx:</span>
          <span className="value">{policy?.maxPerTx ?? '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Daily limit:</span>
          <span className="value">{policy?.dailyLimit ?? '-'}</span>
        </div>
      </div>

      <div className="vault-card">
        <h2>Failure Test Cases</h2>
        <div className="cases-grid">
          <button onClick={runOverLimitCase} disabled={!payer || Boolean(running)}>
            {running === 'Over-limit amount' ? 'Running...' : 'Run Over-limit'}
          </button>
          <button onClick={runScopeViolationCase} disabled={!payer || Boolean(running)}>
            {running === 'Scope violation recipient' ? 'Running...' : 'Run Scope Violation'}
          </button>
          <button onClick={runFakeProofCase} disabled={!payer || Boolean(running)}>
            {running === 'Fake proof replay' ? 'Running...' : 'Run Fake Proof'}
          </button>
          <button onClick={runExpiredCase} disabled={!payer || Boolean(running)}>
            {running === 'Expired request' ? 'Running...' : 'Run Expired Request'}
          </button>
          <button onClick={runInsufficientFundsCase} disabled={!payer || Boolean(running)}>
            {running === 'Insufficient funds (graceful demo)' ? 'Running...' : 'Run Insufficient Funds'}
          </button>
        </div>
        {status && <div className="request-error">{status}</div>}
      </div>

      {result && (
        <div className="vault-card">
          <h2>Latest Case Result</h2>
          <div className="result-row">
            <span className="label">Case:</span>
            <span className="value">{result.label}</span>
          </div>
          <div className="result-row">
            <span className="label">HTTP:</span>
            <span className="value">{result.httpStatus}</span>
          </div>
          <div className="result-row">
            <span className="label">Error:</span>
            <span className="value">{result.error || '-'}</span>
          </div>
          <div className="result-row">
            <span className="label">Reason:</span>
            <span className="value">{result.reason || '-'}</span>
          </div>
          <div className="result-row">
            <span className="label">Expected:</span>
            <span className="value">{result.expected || '-'}</span>
          </div>
          {result.challengeRequestId && (
            <div className="result-row">
              <span className="label">Request ID:</span>
              <span className="value hash">{result.challengeRequestId}</span>
            </div>
          )}
          {result.evidence && (
            <div className="result-row">
              <span className="label">Evidence:</span>
              <span className="value hash">{JSON.stringify(result.evidence)}</span>
            </div>
          )}
        </div>
      )}

      <div className="vault-card">
        <h2>Policy Enforcement Evidence Logs</h2>
        <div className="records-head policy-head">
          <span>Time</span>
          <span>Code</span>
          <span>Payer</span>
          <span>Recipient</span>
          <span>Amount</span>
          <span>Message</span>
        </div>
        {failures.length === 0 && <div className="result-row">No policy failure logs yet.</div>}
        {failures.map((item, idx) => (
          <div className="records-row policy-row" key={`${item.time}-${idx}`}>
            <span className="records-cell">{item.time || '-'}</span>
            <span className="records-cell">{item.code || '-'}</span>
            <span className="records-cell hash">{item.payer || '-'}</span>
            <span className="records-cell hash">{item.recipient || '-'}</span>
            <span className="records-cell">{item.amount || '-'}</span>
            <span className="records-cell">{item.message || '-'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AbuseCasesPage;
