import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk';

const TOKEN_DECIMALS = 18;
const SESSION_KEY_ADDR_STORAGE = 'kiteclaw_session_address';
const SESSION_KEY_PRIV_STORAGE = 'kiteclaw_session_privkey';
const SESSION_ID_STORAGE = 'kiteclaw_session_id';
const SESSION_TX_STORAGE = 'kiteclaw_session_tx_hash';

const accountInterface = new ethers.Interface([
  {
    inputs: [
      { internalType: 'bytes32', name: 'sessionId', type: 'bytes32' },
      { internalType: 'address', name: 'agent', type: 'address' },
      {
        components: [
          { internalType: 'uint256', name: 'timeWindow', type: 'uint256' },
          { internalType: 'uint160', name: 'budget', type: 'uint160' },
          { internalType: 'uint96', name: 'initialWindowStartTime', type: 'uint96' },
          { internalType: 'bytes32[]', name: 'targetProviders', type: 'bytes32[]' }
        ],
        internalType: 'struct SessionManager.Rule[]',
        name: 'rules',
        type: 'tuple[]'
      }
    ],
    name: 'createSession',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]);

function shortHash(v = '') {
  const s = String(v || '');
  if (!s) return '-';
  if (s.length < 16) return s;
  return `${s.slice(0, 10)}...${s.slice(-8)}`;
}

const initialFlow = {
  state: 'idle',
  message: 'Waiting for agent command.',
  error: '',
  steps: {
    session: false,
    challenge: false,
    payment: false,
    proof: false,
    onchain: false,
    identity: false,
    done: false
  },
  txHash: '',
  requestId: '',
  traceId: ''
};

export default function DashboardPage({
  walletState,
  onBack,
  onOpenTransfer,
  onOpenRecords,
  onOpenOnChain
}) {
  const [accountAddress, setAccountAddress] = useState(
    import.meta.env.VITE_KITECLAW_AA_WALLET_ADDRESS ||
      import.meta.env.VITE_AA_WALLET_ADDRESS ||
      walletState?.aaAddress ||
      ''
  );

  const [singleLimit, setSingleLimit] = useState('0.1');
  const [dailyLimit, setDailyLimit] = useState('0.6');
  const [sessionHours, setSessionHours] = useState('168');
  const [status, setStatus] = useState('');

  const [sessionKey, setSessionKey] = useState('');
  const [sessionPrivKey, setSessionPrivKey] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessionTxHash, setSessionTxHash] = useState('');

  const [runtime, setRuntime] = useState(null);
  const [identityProfile, setIdentityProfile] = useState(null);
  const [identityError, setIdentityError] = useState('');

  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [openclawHealth, setOpenclawHealth] = useState({
    connected: true,
    mode: 'local-fallback',
    reason: 'Checking...'
  });

  const [traceId, setTraceId] = useState('');
  const [flow, setFlow] = useState(initialFlow);

  const rpcUrl =
    import.meta.env.VITE_KITEAI_RPC_URL ||
    import.meta.env.VITE_KITE_RPC_URL ||
    'https://rpc-testnet.gokite.ai/';
  const bundlerUrl =
    import.meta.env.VITE_KITEAI_BUNDLER_URL ||
    import.meta.env.VITE_BUNDLER_URL ||
    'https://bundler-service.staging.gokite.ai/rpc/';
  const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiUrl = (pathname) => (apiBase ? `${apiBase}${pathname}` : pathname);

  useEffect(() => {
    const ownerAddress = walletState?.ownerAddress || '';
    if (!ownerAddress) return;
    try {
      const sdk = new GokiteAASDK({
        network: 'kite_testnet',
        rpcUrl,
        bundlerUrl,
        entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
      });
      setAccountAddress(sdk.getAccountAddress(ownerAddress));
    } catch {
      // keep fallback
    }
  }, [walletState?.ownerAddress, rpcUrl, bundlerUrl]);

  const refreshRuntime = async () => {
    const res = await fetch(apiUrl('/api/session/runtime'));
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.ok) {
      const rt = body.runtime || null;
      setRuntime(rt);
      setFlow((prev) => ({
        ...prev,
        steps: {
          ...prev.steps,
          session: Boolean(rt?.hasSessionPrivateKey && rt?.sessionAddress)
        }
      }));
    }
  };

  const refreshIdentity = async () => {
    const res = await fetch(apiUrl('/api/identity/current'));
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.ok) {
      setIdentityProfile(body.profile || null);
      setIdentityError('');
      setFlow((prev) => ({
        ...prev,
        steps: {
          ...prev.steps,
          identity: Boolean(body?.profile?.configured)
        }
      }));
    } else {
      setIdentityProfile(null);
      setIdentityError(body?.reason || `Identity load failed: HTTP ${res.status}`);
    }
  };

  const refreshDashboard = async () => {
    await Promise.allSettled([refreshRuntime(), refreshIdentity(), refreshOpenclawHealth()]);
  };

  const refreshOpenclawHealth = async () => {
    const res = await fetch(apiUrl('/api/chat/agent/health'));
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.ok) {
      setOpenclawHealth({
        connected: Boolean(body.connected),
        mode: body.mode || 'remote',
        reason: body.reason || 'ok'
      });
      return;
    }
    setOpenclawHealth({
      connected: false,
      mode: body?.mode || 'remote',
      reason: body?.reason || `health HTTP ${res.status}`
    });
  };

  useEffect(() => {
    setSessionKey(localStorage.getItem(SESSION_KEY_ADDR_STORAGE) || '');
    setSessionPrivKey(localStorage.getItem(SESSION_KEY_PRIV_STORAGE) || '');
    setSessionId(localStorage.getItem(SESSION_ID_STORAGE) || '');
    setSessionTxHash(localStorage.getItem(SESSION_TX_STORAGE) || '');
    void refreshDashboard();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshDashboard();
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const es = new EventSource(apiUrl('/api/events/stream'));

    es.addEventListener('challenge_issued', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      setFlow((prev) => ({
        ...prev,
        state: 'running',
        error: '',
        message: 'x402 challenge issued.',
        requestId: payload?.requestId || prev.requestId,
        traceId: payload?.traceId || prev.traceId,
        steps: { ...prev.steps, challenge: true }
      }));
      if (payload?.traceId) setTraceId(payload.traceId);
    });

    es.addEventListener('payment_sent', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      setFlow((prev) => ({
        ...prev,
        state: 'running',
        error: '',
        message: 'Payment sent on-chain.',
        txHash: payload?.txHash || payload?.paymentTxHash || prev.txHash,
        steps: { ...prev.steps, challenge: true, payment: true }
      }));
      if (payload?.traceId) setTraceId(payload.traceId);
    });

    es.addEventListener('proof_submitted', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      setFlow((prev) => ({
        ...prev,
        state: 'running',
        error: '',
        message: 'Payment proof submitted.',
        steps: { ...prev.steps, challenge: true, payment: true, proof: true }
      }));
      if (payload?.traceId) setTraceId(payload.traceId);
    });

    es.addEventListener('unlocked', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      setFlow((prev) => ({
        ...prev,
        state: 'success',
        message: 'Transaction completed and verification passed.',
        error: '',
        traceId: payload?.traceId || prev.traceId,
        txHash: payload?.txHash || payload?.paymentTxHash || prev.txHash,
        steps: {
          ...prev.steps,
          challenge: true,
          payment: true,
          proof: true,
          onchain: true,
          done: true
        }
      }));
      if (payload?.traceId) setTraceId(payload.traceId);
    });

    es.addEventListener('failed', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      setFlow((prev) => ({
        ...prev,
        state: 'error',
        message: 'Workflow failed.',
        error: payload?.reason || payload?.error || 'Unknown error',
        traceId: payload?.traceId || prev.traceId
      }));
      if (payload?.traceId) setTraceId(payload.traceId);
    });

    return () => es.close();
  }, []);

  const getSigner = async () => {
    if (!walletState?.ownerAddress || typeof window.ethereum === 'undefined') {
      throw new Error('Please connect wallet first.');
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    return provider.getSigner();
  };

  const buildRules = async (provider) => {
    const latestBlock = await provider.getBlock('latest');
    const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
    return [
      [0, ethers.parseUnits(singleLimit || '0', TOKEN_DECIMALS), 0, []],
      [86400, ethers.parseUnits(dailyLimit || '0', TOKEN_DECIMALS), Math.max(0, nowTs - 1), []]
    ];
  };

  const syncSessionRuntime = async ({
    sessionAddress = sessionKey,
    sessionPrivateKey = sessionPrivKey,
    currentSessionId = sessionId,
    currentSessionTxHash = sessionTxHash
  } = {}) => {
    const hours = Number(sessionHours);
    const expiresAt = Number.isFinite(hours) && hours > 0
      ? Math.floor(Date.now() / 1000) + Math.floor(hours * 3600)
      : 0;

    const resp = await fetch(apiUrl('/api/session/runtime/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aaWallet: accountAddress,
        owner: walletState?.ownerAddress || '',
        sessionAddress,
        sessionPrivateKey,
        sessionId: currentSessionId,
        sessionTxHash: currentSessionTxHash,
        expiresAt,
        maxPerTx: Number(singleLimit),
        dailyLimit: Number(dailyLimit),
        source: 'dashboard-setup'
      })
    });

    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body?.ok) {
      throw new Error(body?.reason || body?.error || `Session runtime sync failed: HTTP ${resp.status}`);
    }
    await refreshRuntime();
  };

  const handleCreateSession = async () => {
    try {
      setStatus('Creating session and applying rules...');
      const signer = await getSigner();
      const generatedSessionWallet = ethers.Wallet.createRandom();
      const nextSessionId = ethers.keccak256(
        ethers.toUtf8Bytes(`${generatedSessionWallet.address}-${Date.now()}`)
      );
      const rules = await buildRules(signer.provider);
      const data = accountInterface.encodeFunctionData('createSession', [
        nextSessionId,
        generatedSessionWallet.address,
        rules
      ]);
      const tx = await signer.sendTransaction({ to: accountAddress, data });
      await tx.wait();

      localStorage.setItem(SESSION_KEY_ADDR_STORAGE, generatedSessionWallet.address);
      localStorage.setItem(SESSION_KEY_PRIV_STORAGE, generatedSessionWallet.privateKey);
      localStorage.setItem(SESSION_ID_STORAGE, nextSessionId);
      localStorage.setItem(SESSION_TX_STORAGE, tx.hash);

      setSessionKey(generatedSessionWallet.address);
      setSessionPrivKey(generatedSessionWallet.privateKey);
      setSessionId(nextSessionId);
      setSessionTxHash(tx.hash);

      await syncSessionRuntime({
        sessionAddress: generatedSessionWallet.address,
        sessionPrivateKey: generatedSessionWallet.privateKey,
        currentSessionId: nextSessionId,
        currentSessionTxHash: tx.hash
      });

      setFlow((prev) => ({
        ...prev,
        steps: { ...prev.steps, session: true },
        message: 'Session setup completed.'
      }));
      setStatus(`Session created and synced: ${tx.hash}`);
    } catch (err) {
      setStatus(`Create session failed: ${err.message}`);
      setFlow((prev) => ({
        ...prev,
        state: 'error',
        message: 'Session setup failed.',
        error: err.message
      }));
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatBusy) return;
    const userText = chatInput.trim();
    setChatInput('');
    setChatBusy(true);
    setFlow((prev) => ({ ...prev, state: 'running', message: 'Agent is processing your command.', error: '' }));
    setChatHistory((prev) => [...prev, { role: 'user', text: userText, ts: Date.now() }]);

    try {
      const resp = await fetch(apiUrl('/api/chat/agent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          sessionId: sessionId || runtime?.sessionId || '',
          traceId: traceId || undefined
        })
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok || !body?.ok) {
        throw new Error(body?.reason || body?.error || `chat failed: HTTP ${resp.status}`);
      }
      if (body.traceId) setTraceId(body.traceId);
      setFlow((prev) => ({
        ...prev,
        state: body.state === 'intent_recognized' ? 'running' : prev.state,
        message: body.step ? `Agent step: ${body.step}` : prev.message
      }));
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'agent',
          text: body.reply || '(no reply)',
          ts: Date.now(),
          traceId: body.traceId || '',
          state: body.state || '',
          step: body.step || ''
        }
      ]);
    } catch (err) {
      setFlow((prev) => ({
        ...prev,
        state: 'error',
        message: 'Agent request failed.',
        error: err.message
      }));
      setChatHistory((prev) => [...prev, { role: 'agent', text: `Error: ${err.message}`, ts: Date.now() }]);
    } finally {
      setChatBusy(false);
    }
  };

  const flowIcon = useMemo(() => {
    if (flow.state === 'running') return '↻';
    if (flow.state === 'success') return '✓';
    if (flow.state === 'error') return '✕';
    return '↻';
  }, [flow.state]);

  const flowClass = useMemo(() => {
    if (flow.state === 'running') return 'running';
    if (flow.state === 'success') return 'success';
    if (flow.state === 'error') return 'error';
    return 'idle';
  }, [flow.state]);

  const statusSteps = useMemo(
    () => [
      { key: 'session', label: 'Session Ready' },
      { key: 'identity', label: 'Identity Verified' },
      { key: 'challenge', label: 'x402 Challenge' },
      { key: 'payment', label: 'Payment Sent' },
      { key: 'proof', label: 'Proof Submitted' },
      { key: 'onchain', label: 'On-chain Settled' },
      { key: 'done', label: 'Completed' }
    ],
    []
  );

  const currentStep = useMemo(() => {
    const firstPending = statusSteps.find((step) => !flow.steps[step.key]);
    if (flow.state === 'success') return { label: 'Completed', key: 'done' };
    if (flow.state === 'error') return { label: 'Failed', key: 'failed' };
    return firstPending || { label: 'Completed', key: 'done' };
  }, [statusSteps, flow.steps, flow.state]);

  const completedSteps = useMemo(
    () => statusSteps.filter((step) => Boolean(flow.steps[step.key])),
    [statusSteps, flow.steps]
  );

  const setupReady = Boolean(
    (runtime?.hasSessionPrivateKey && runtime?.sessionAddress) || (sessionKey && sessionId)
  );

  return (
    <div className="transfer-container transfer-shell">
      <header className="shell-header">
        <div className="shell-title-inline shell-title-fused">
          <span className="brand-badge">KITECLAW</span>
          <h1>DASHBOARD</h1>
        </div>
        <div className="top-entry">
          <button className="icon-refresh-btn" onClick={() => void refreshDashboard()} title="Refresh Dashboard" aria-label="Refresh Dashboard">↻</button>
          {onBack && <button className="link-btn" onClick={onBack}>Switch Wallet</button>}
          {onOpenTransfer && <button className="link-btn" onClick={onOpenTransfer}>Open Transfer</button>}
          {onOpenVault && <button className="link-btn" onClick={onOpenVault}>Open Vault</button>}
          {onOpenRecords && <button className="link-btn" onClick={onOpenRecords}>Transfer Records</button>}
          {onOpenOnChain && <button className="link-btn" onClick={onOpenOnChain}>On-chain Confirmation</button>}
          {onOpenAbuseCases && <button className="link-btn" onClick={onOpenAbuseCases}>Abuse / Limit Cases</button>}
        </div>
      </header>

      <section className="dashboard-main-grid">
        <article className="vault-card dashboard-chat-card">
          <h2>Chat Agent</h2>
          <div className="dashboard-chat-history dashboard-chat-history-tall">
            {chatHistory.length === 0 && <div className="dashboard-empty">No messages yet.</div>}
            {chatHistory.map((item, idx) => (
              <div key={`${item.ts}-${idx}`} className={`dashboard-chat-msg ${item.role}`}>
                <strong>{item.role === 'user' ? 'You' : 'KiteClaw'}</strong>
                <p>{item.text}</p>
                {item.traceId && <small>traceId: {item.traceId}</small>}
                {item.step && <small>step: {item.step}</small>}
                {item.state && <small>state: {item.state}</small>}
              </div>
            ))}
          </div>
          <div className="request-input dashboard-chat-input-bottom">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder='Try: "place stop order BTC-USDT TP 80000 SL 50000"'
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendChat();
              }}
            />
            <button onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>
              {chatBusy ? 'Sending...' : 'Send'}
            </button>
          </div>
        </article>

        <aside className="dashboard-status-stack">
          <article className="vault-card">
            <h2>Session</h2>
            <div className="result-row"><span className="label">Setup</span><span className="value">{setupReady ? 'ready' : 'not ready'}</span></div>
            <div className="result-row"><span className="label">AA Wallet</span><span className="value hash">{shortHash(accountAddress)}</span></div>
            <div className="result-row"><span className="label">Session</span><span className="value hash">{shortHash(runtime?.sessionAddress || sessionKey)}</span></div>
            <div className="result-row"><span className="label">Session ID</span><span className="value hash">{shortHash(runtime?.sessionId || sessionId)}</span></div>
          </article>
          <article className="vault-card">
            <h2>x402</h2>
            <div className="result-row"><span className="label">Latest</span><span className="value">{latestMapping?.status || '-'}</span></div>
            <div className="result-row"><span className="label">Action</span><span className="value">{latestMapping?.action || '-'}</span></div>
            <div className="result-row"><span className="label">Request</span><span className="value hash">{shortHash(latestMapping?.requestId || '')}</span></div>
            <div className="result-row"><span className="label">Tx</span><span className="value hash">{shortHash(latestMapping?.paymentTxHash || '')}</span></div>
          </article>
          <article className="vault-card">
            <h2>On-chain</h2>
            <div className="result-row"><span className="label">Latest Tx</span><span className="value hash">{shortHash(latestOnchain?.txHash || '')}</span></div>
            <div className="result-row"><span className="label">Amount</span><span className="value">{latestOnchain?.amount || '-'}</span></div>
            <div className="result-row"><span className="label">To</span><span className="value hash">{shortHash(latestOnchain?.to || '')}</span></div>
            <div className="result-row"><span className="label">Time</span><span className="value">{latestOnchain?.time || '-'}</span></div>
          </article>
          <article className="vault-card">
            <h2>Identity</h2>
            <div className="result-row"><span className="label">Configured</span><span className="value">{identityProfile?.configured ? 'yes' : 'no'}</span></div>
            <div className="result-row"><span className="label">Registry</span><span className="value hash">{shortHash(identityProfile?.registry || '')}</span></div>
            <div className="result-row"><span className="label">Agent ID</span><span className="value">{identityProfile?.agentId ?? '-'}</span></div>
            <div className="result-row"><span className="label">Wallet</span><span className="value hash">{shortHash(identityProfile?.agentWallet || '')}</span></div>
          </article>
        </aside>
      </section>

      <section className="vault-card">
        <h2>Place Stop Order (One-click Workflow)</h2>
        <div className="vault-actions">
          <div className="vault-input">
            <label>Symbol</label>
            <input value={workflowSymbol} onChange={(e) => setWorkflowSymbol(e.target.value)} />
          </div>
          <div className="vault-input">
            <label>Take Profit</label>
            <input value={workflowTakeProfit} onChange={(e) => setWorkflowTakeProfit(e.target.value)} />
          </div>
          <div className="vault-input">
            <label>Stop Loss</label>
            <input value={workflowStopLoss} onChange={(e) => setWorkflowStopLoss(e.target.value)} />
          </div>
          <div className="vault-input">
            <label>Source Agent ID</label>
            <input value={workflowSourceAgentId} onChange={(e) => setWorkflowSourceAgentId(e.target.value)} />
          </div>
          <div className="vault-input">
            <label>Target Agent ID</label>
            <input value={workflowTargetAgentId} onChange={(e) => setWorkflowTargetAgentId(e.target.value)} />
          </div>
        </div>
        <div className="vault-actions">
          <button onClick={() => void runWorkflow()} disabled={workflowBusy}>
            {workflowBusy ? 'Running...' : 'Run Stop-order Workflow'}
          </button>
          <button
            onClick={() => {
              if (traceId) void fetchWorkflow(traceId);
            }}
            disabled={!traceId}
          >
            Refresh Workflow
          </button>
          <button onClick={() => void exportEvidence()} disabled={!traceId}>
            Export Evidence JSON
          </button>
        </div>
        <div className="result-row">
          <span className="label">Trace ID</span>
          <span className="value hash">{traceId || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">State</span>
          <span className="value">{workflowData?.state || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Request ID</span>
          <span className="value hash">{workflowData?.requestId || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Payment Tx</span>
          <span className="value hash">{workflowData?.txHash || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">UserOp Hash</span>
          <span className="value hash">{workflowData?.userOpHash || '-'}</span>
        </div>
        {workflowError && <div className="request-error">Workflow Error: {workflowError}</div>}
        {workflowData?.steps?.length > 0 && (
          <div className="workflow-timeline">
            {workflowData.steps.map((step, idx) => (
              <div className={`workflow-step ${step.status === 'error' ? 'error' : 'ok'}`} key={`${step.at}-${idx}`}>
                <div className="workflow-step-head">
                  <strong>{step.name}</strong>
                  <span>{step.status}</span>
                </div>
                <small>{step.at}</small>
                {step?.details?.reason && <div className="workflow-reason">reason: {step.details.reason}</div>}
                {!step?.details?.reason && step?.details && (
                  <div className="workflow-reason">{JSON.stringify(step.details)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="vault-card">
        <h2>Live Event Stream (SSE)</h2>
        <div className="workflow-timeline">
          {liveEvents.length === 0 && <div className="dashboard-empty">No live events yet.</div>}
          {liveEvents.map((evt, idx) => (
            <div className="workflow-step ok" key={`${evt.at}-${idx}`}>
              <div className="workflow-step-head">
                <strong>{evt.label}</strong>
                <span>event</span>
              </div>
              <small>{evt.at}</small>
              <div className="workflow-reason">{JSON.stringify(evt.payload || {})}</div>
            </div>
            <p className="loop-indicator-text">
              {flow.state === 'running' && 'Processing payment + verification...'}
              {flow.state === 'success' && 'Transaction completed, verification passed.'}
              {flow.state === 'error' && 'Workflow failed. Check error message above.'}
              {flow.state === 'idle' && 'Idle. Waiting for next task.'}
            </p>
          </article>

          <article className="vault-card">
            <h2>Session Policy</h2>
            <div className="result-row"><span className="label">Ready</span><span className="value">{setupReady ? 'yes' : 'no'}</span></div>

            <div className="vault-actions">
              <div className="vault-input">
                <label>Single Tx Limit (USDT)</label>
                <input value={singleLimit} onChange={(e) => setSingleLimit(e.target.value)} />
              </div>
              <div className="vault-input">
                <label>Daily Limit (USDT)</label>
                <input value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
              </div>
              <div className="vault-input">
                <label>Session Effective (Hours)</label>
                <input value={sessionHours} onChange={(e) => setSessionHours(e.target.value)} />
              </div>
            </div>

            <button onClick={() => void handleCreateSession()}>Generate Session Key & Apply Rules</button>
            {status && <div className="request-error">{status}</div>}
          </article>
        </aside>
      </section>
    </div>
  );
}
