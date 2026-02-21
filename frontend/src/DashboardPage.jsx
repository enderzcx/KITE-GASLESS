import { useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk';

const TOKEN_DECIMALS = 18;
const SETTLEMENT_TOKEN =
  import.meta.env.VITE_KITEAI_SETTLEMENT_TOKEN ||
  import.meta.env.VITE_SETTLEMENT_TOKEN ||
  '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
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

const tokenSupportAbi = [
  'function isTokenSupported(address token) view returns (bool)',
  'function addSupportedToken(address token)'
];

function shortHash(v = '') {
  const s = String(v || '');
  if (!s) return '-';
  if (s.length < 16) return s;
  return `${s.slice(0, 10)}...${s.slice(-8)}`;
}

function toNumberOrNaN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function createClientTraceId(prefix = 'trace') {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
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

function isA2AServiceMessage(text = '') {
  return /(\ba2a\b|a\s*to\s*a|agent\s*to\s*agent|stop\s*order|reactive\s*stop)/i.test(String(text || ''));
}

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
  const [, setIdentityProfile] = useState(null);
  const [identityError, setIdentityError] = useState('');

  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const chatBottomRef = useRef(null);
  const workflowPollTimerRef = useRef(null);
  const workflowPollTraceRef = useRef('');
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
  const addressExplorerBase = String(
    import.meta.env.VITE_KITE_EXPLORER_ADDRESS_BASE || 'https://testnet.kitescan.ai/address/'
  ).trim();
  const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiUrl = (pathname) => (apiBase ? `${apiBase}${pathname}` : pathname);
  const ownerAddress = walletState?.ownerAddress || runtime?.owner || '';
  const aaWalletAddress = accountAddress || runtime?.aaWallet || walletState?.aaAddress || '';
  const aaExplorerUrl = aaWalletAddress ? `${addressExplorerBase}${aaWalletAddress}` : '';

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
      if (!accountAddress && rt?.aaWallet) {
        setAccountAddress(rt.aaWallet);
      }
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

  const clearWorkflowPoll = () => {
    if (workflowPollTimerRef.current) {
      clearTimeout(workflowPollTimerRef.current);
      workflowPollTimerRef.current = null;
    }
    workflowPollTraceRef.current = '';
  };

  const startWorkflowPoll = (wfTraceId) => {
    const trace = String(wfTraceId || '').trim();
    if (!trace) return;
    clearWorkflowPoll();
    workflowPollTraceRef.current = trace;
    const deadline = Date.now() + 90_000;

    const tick = async () => {
      if (workflowPollTraceRef.current !== trace) return;
      try {
        const resp = await fetch(apiUrl(`/api/workflow/${encodeURIComponent(trace)}`));
        const body = await resp.json().catch(() => ({}));
        if (resp.ok && body?.ok) {
          const wf = body?.workflow || {};
          const wfState = String(wf?.state || '').toLowerCase();
          if (wfState === 'unlocked') {
            clearWorkflowPoll();
            setFlow((prev) => ({
              ...prev,
              state: 'success',
              message: 'Transaction completed and verification passed.',
              error: '',
              traceId: trace,
              requestId: wf?.requestId || prev.requestId,
              txHash: wf?.txHash || prev.txHash,
              steps: {
                ...prev.steps,
                challenge: true,
                payment: true,
                proof: true,
                onchain: true,
                done: true
              }
            }));
            return;
          }
          if (wfState === 'failed') {
            clearWorkflowPoll();
            setFlow((prev) => ({
              ...prev,
              state: 'error',
              message: 'Workflow failed.',
              error: String(wf?.error || 'Unknown workflow error'),
              traceId: trace,
              requestId: wf?.requestId || prev.requestId,
              txHash: wf?.txHash || prev.txHash
            }));
            return;
          }
        }
      } catch {
        // keep polling
      }

      if (workflowPollTraceRef.current !== trace) return;
      if (Date.now() >= deadline) {
        clearWorkflowPoll();
        setFlow((prev) => (
          prev.state === 'running'
            ? {
                ...prev,
                state: 'error',
                message: 'Workflow timeout.',
                error: 'No terminal workflow event received. Please refresh and check records.'
              }
            : prev
        ));
        return;
      }
      workflowPollTimerRef.current = setTimeout(tick, 2000);
    };

    workflowPollTimerRef.current = setTimeout(tick, 2500);
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

  useEffect(() => () => clearWorkflowPoll(), []);

  useEffect(() => {
    if (!chatBottomRef.current) return;
    chatBottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatHistory]);

  useEffect(() => {
    if (!traceId) return;
    const es = new EventSource(apiUrl(`/api/events/stream?traceId=${encodeURIComponent(traceId)}`));
    const matchesTrace = (payload) => {
      const payloadTraceId = String(payload?.traceId || '').trim();
      return !payloadTraceId || payloadTraceId === traceId;
    };

    es.addEventListener('challenge_issued', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      if (!matchesTrace(payload)) return;
      const nextTrace = String(payload?.traceId || traceId || '').trim();
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
      if (nextTrace) startWorkflowPoll(nextTrace);
      const fee = String(payload?.amount || '0.03');
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'agent',
          text: `Request submitted. This service costs ${fee} USDT. Auto payment started, please check the payment status on the right panel.`,
          ts: Date.now()
        }
      ]);
    });

    es.addEventListener('payment_sent', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      if (!matchesTrace(payload)) return;
      setFlow((prev) => ({
        ...prev,
        state: 'running',
        error: '',
        message: 'Payment sent on-chain.',
        txHash: payload?.txHash || payload?.paymentTxHash || prev.txHash,
        steps: { ...prev.steps, challenge: true, payment: true }
      }));
      if (payload?.traceId) setTraceId(payload.traceId);
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'agent',
          text: `Payment succeeded. Tx: ${payload?.txHash || payload?.paymentTxHash || '-'}`,
          ts: Date.now()
        }
      ]);
    });

    es.addEventListener('proof_submitted', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      if (!matchesTrace(payload)) return;
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
      if (!matchesTrace(payload)) return;
      clearWorkflowPoll();
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
      const qty = toNumberOrNaN(payload?.quantity);
      const symbol = String(payload?.symbol || '').trim();
      const tp = toNumberOrNaN(payload?.takeProfit);
      const sl = toNumberOrNaN(payload?.stopLoss);
      const parts = [];
      if (symbol) parts.push(symbol);
      if (Number.isFinite(tp)) parts.push(`TP ${tp}`);
      if (Number.isFinite(sl)) parts.push(`SL ${sl}`);
      if (Number.isFinite(qty)) parts.push(`QTY ${qty}`);
      const orderText = parts.length > 0 ? parts.join(' ') : 'stop-order details unavailable';
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'agent',
          text: `Payment verified successfully. Stop-order confirmed: ${orderText}.`,
          ts: Date.now()
        }
      ]);
    });

    es.addEventListener('failed', (evt) => {
      const payload = evt?.data ? JSON.parse(evt.data) : {};
      if (!matchesTrace(payload)) return;
      clearWorkflowPoll();
      const reason = String(payload?.reason || payload?.error || 'Unknown error');
      const insufficient = /(insufficient|balance)/i.test(reason);
      setFlow((prev) => ({
        ...prev,
        state: 'error',
        message: 'Workflow failed.',
        error: reason,
        traceId: payload?.traceId || prev.traceId
      }));
      if (payload?.traceId) setTraceId(payload.traceId);
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'agent',
          text: insufficient
            ? `Oops, insufficient balance. This request needs ${payload?.required || 'unknown'} USDT, current balance is ${payload?.balance || 'unknown'}.`
            : `Workflow failed: ${reason}`,
          ts: Date.now()
        }
      ]);
    });

    return () => es.close();
  }, [apiBase, traceId]);

  useEffect(() => {
    if (flow.state !== 'running') return;
    if (!traceId) return;
    if (workflowPollTraceRef.current === traceId) return;
    startWorkflowPoll(traceId);
  }, [flow.state, traceId]);

  const getSigner = async () => {
    if (!walletState?.ownerAddress || typeof window.ethereum === 'undefined') {
      throw new Error('Please connect wallet first.');
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    return provider.getSigner();
  };

  const verifyA2AIdentitySignature = async ({ requestTraceId = '' } = {}) => {
    const challengeResp = await fetch(apiUrl('/api/identity/challenge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traceId: requestTraceId })
    });
    const challengeBody = await challengeResp.json().catch(() => ({}));
    if (!challengeResp.ok || !challengeBody?.ok) {
      throw new Error(
        challengeBody?.reason || challengeBody?.error || `identity challenge failed: HTTP ${challengeResp.status}`
      );
    }

    const challenge = challengeBody?.challenge || {};
    if (challenge?.signatureRequired === false || String(challenge?.mode || '').trim() === 'registry') {
      const profile = challengeBody?.profile || {};
      return {
        verified: true,
        agentId: profile?.configured?.agentId || profile?.agentId || '',
        agentWallet: profile?.agentWallet || '',
        checkedAt: Date.now()
      };
    }

    const challengeId = String(challenge?.challengeId || '').trim();
    const message = String(challenge?.message || '').trim();
    if (!challengeId || !message) {
      throw new Error('identity challenge payload is invalid');
    }

    const signer = await getSigner();
    const signature = await signer.signMessage(message);

    const verifyResp = await fetch(apiUrl('/api/identity/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        signature,
        traceId: requestTraceId
      })
    });
    const verifyBody = await verifyResp.json().catch(() => ({}));
    if (!verifyResp.ok || !verifyBody?.ok || !verifyBody?.verified) {
      throw new Error(
        verifyBody?.reason || verifyBody?.error || `identity verify failed: HTTP ${verifyResp.status}`
      );
    }

    const profile = verifyBody?.profile || challengeBody?.profile || {};
    return {
      verified: true,
      agentId: profile?.configured?.agentId || profile?.agentId || '',
      agentWallet: profile?.agentWallet || '',
      checkedAt: Date.now()
    };
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
    aaWallet = aaWalletAddress,
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
        aaWallet,
        owner: ownerAddress,
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

  const copyToClipboardSafe = async (value) => {
    if (!value) return false;
    if (!navigator?.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  };

  const ensureAADeployed = async () => {
    const owner = String(ownerAddress || '').trim();
    if (!owner) {
      throw new Error('Please connect wallet first.');
    }
    const resp = await fetch(apiUrl('/api/aa/ensure'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body?.ok) {
      throw new Error(body?.reason || body?.error || `AA deploy failed: HTTP ${resp.status}`);
    }
    const wallet = String(body?.aaWallet || '').trim();
    if (!wallet) {
      throw new Error('AA deployment response missing aaWallet.');
    }
    setAccountAddress(wallet);
    await refreshRuntime();
    return {
      aaWallet: wallet,
      txHash: String(body?.txHash || '').trim(),
      createdNow: Boolean(body?.createdNow)
    };
  };

  const createSessionWithAddress = async (targetAAWallet) => {
    const wallet = String(targetAAWallet || aaWalletAddress || '').trim();
    if (!wallet) {
      throw new Error('AA wallet not ready.');
    }
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
    const tx = await signer.sendTransaction({ to: wallet, data });
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
      aaWallet: wallet,
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
    return { sessionTxHash: tx.hash };
  };

  const ensureSettlementTokenConfigured = async (targetAAWallet) => {
    const wallet = String(targetAAWallet || aaWalletAddress || '').trim();
    if (!wallet || !ethers.isAddress(wallet)) {
      throw new Error('AA wallet not ready for token setup.');
    }
    if (!SETTLEMENT_TOKEN || !ethers.isAddress(SETTLEMENT_TOKEN)) {
      throw new Error('Settlement token is not configured correctly.');
    }

    const signer = await getSigner();
    const contract = new ethers.Contract(wallet, tokenSupportAbi, signer);

    try {
      const already = await contract.isTokenSupported(SETTLEMENT_TOKEN);
      if (already) return { tokenTxHash: '', already: true };
    } catch {
      // continue to add token when read call is unavailable on some implementations
    }

    try {
      const tx = await contract.addSupportedToken(SETTLEMENT_TOKEN);
      await tx.wait();
      return { tokenTxHash: tx.hash, already: false };
    } catch (error) {
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('tokenalreadysupported') || msg.includes('already supported')) {
        return { tokenTxHash: '', already: true };
      }
      throw error;
    }
  };

  const handleOneClickSetup = async () => {
    if (setupBusy) return;
    setSetupBusy(true);
    try {
      setStatus('Step 1/4: Generating and deploying AA wallet...');
      const deploy = await ensureAADeployed();
      const copied = await copyToClipboardSafe(deploy.aaWallet);
      setStatus('Step 2/4: Setting settlement token (USDT)...');
      const tokenSetup = await ensureSettlementTokenConfigured(deploy.aaWallet);
      setStatus('Step 3/4: Creating session key and applying rules...');
      const session = await createSessionWithAddress(deploy.aaWallet);
      setStatus(
        `Step 4/4 done. AA ${deploy.createdNow ? 'deployed' : 'already deployed'} (${shortHash(deploy.aaWallet)}), ` +
          `token ${tokenSetup.already ? 'already set' : `set ${shortHash(tokenSetup.tokenTxHash)}`}, ` +
          `session ${shortHash(session.sessionTxHash)}. ${copied ? 'Address copied.' : 'Copy address manually if needed.'}`
      );
    } catch (err) {
      setStatus(`One-click setup failed: ${err.message}`);
      setFlow((prev) => ({
        ...prev,
        state: 'error',
        message: 'AA/session setup failed.',
        error: err.message
      }));
    } finally {
      setSetupBusy(false);
    }
  };

  const handleCopyAAAddress = async () => {
    const copied = await copyToClipboardSafe(aaWalletAddress);
    setStatus(copied ? 'AA wallet address copied.' : 'Copy failed. Please copy the address manually.');
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatBusy) return;
    const userText = chatInput.trim();
    const requestTraceId = createClientTraceId('trace');
    const requiresA2AVerification = isA2AServiceMessage(userText);
    const historyPayload = [...chatHistory, { role: 'user', text: userText }]
      .slice(-12)
      .map((item) => ({
        role: item.role === 'agent' ? 'assistant' : 'user',
        content: String(item.text || '').trim()
      }))
      .filter((item) => item.content);
    setChatInput('');
    setChatBusy(true);
    clearWorkflowPoll();
    setTraceId(requestTraceId);
    setFlow((prev) => ({
      ...initialFlow,
      traceId: requestTraceId,
      message: 'Submitting request...',
      steps: {
        ...initialFlow.steps,
        session: prev.steps.session,
        identity: prev.steps.identity
      }
    }));
    setChatHistory((prev) => [...prev, { role: 'user', text: userText, ts: Date.now() }]);

    try {
      let identityInfo = null;
      if (requiresA2AVerification) {
        setFlow((prev) => ({ ...prev, message: 'Verifying agent identity for A2A request...' }));
        let identityErrorReason = '';
        try {
          identityInfo = await verifyA2AIdentitySignature({ requestTraceId });
        } catch (error) {
          identityErrorReason = error?.message || 'unknown_reason';
          identityInfo = {
            verified: false,
            agentId: '',
            agentWallet: '',
            checkedAt: Date.now()
          };
        }

        setChatHistory((prev) => [
          ...prev,
          {
            role: 'agent',
            text: identityInfo.verified
              ? 'A2A identity verification passed. Request accepted, preparing x402 challenge...'
              : `A2A identity verification failed: ${identityErrorReason || 'unknown_reason'}`,
            ts: Date.now(),
            identity: identityInfo
          }
        ]);
        setFlow((prev) => ({
          ...prev,
          steps: { ...prev.steps, identity: Boolean(identityInfo?.verified) }
        }));

        if (!identityInfo.verified) {
          setFlow((prev) => ({
            ...prev,
            state: 'idle',
            message: 'A2A request blocked: identity verification failed.',
            error: ''
          }));
          return;
        }
      }

      const resp = await fetch(apiUrl('/api/chat/agent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          sessionId: sessionId || runtime?.sessionId || '',
          traceId: requestTraceId,
          history: historyPayload
        })
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok || !body?.ok) {
        throw new Error(body?.reason || body?.error || `chat failed: HTTP ${resp.status}`);
      }
      if (body.traceId) setTraceId(body.traceId);
      const finalTrace = String(body.traceId || requestTraceId || '').trim();
      const stateStepText = `${body.state || ''} ${body.step || ''}`.toLowerCase();
      const isSuccess = /(unlocked|completed|success|done)/i.test(stateStepText);
      const isRunning = /(x402|challenge|payment|proof|onchain|settle|intent|workflow_running)/i.test(
        stateStepText
      );
      setFlow((prev) => ({
        ...prev,
        state: isSuccess
          ? 'success'
          : isRunning
            ? 'running'
            : (prev.steps.challenge || prev.steps.payment || prev.steps.proof || prev.steps.onchain
              ? prev.state
              : 'idle'),
        message: body.step ? `Agent step: ${body.step}` : prev.message,
        requestId: body.requestId || prev.requestId,
        txHash: body.txHash || prev.txHash,
        steps: isSuccess
          ? {
              ...prev.steps,
              challenge: true,
              payment: true,
              proof: true,
              onchain: true,
              done: true
            }
          : prev.steps
      }));
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'agent',
          text: body.reply || '(no reply)',
          ts: Date.now(),
          traceId: body.traceId || '',
          mode: body.mode || '',
          state: body.state || '',
          step: body.step || '',
          identity: identityInfo
        }
      ]);
      if (finalTrace && isRunning) {
        startWorkflowPoll(finalTrace);
      }
    } catch (err) {
      clearWorkflowPoll();
      setFlow((prev) => ({
        ...prev,
        state: prev.steps.challenge || prev.steps.payment || prev.steps.proof || prev.steps.onchain
          ? 'error'
          : 'idle',
        message: prev.steps.challenge || prev.steps.payment || prev.steps.proof || prev.steps.onchain
          ? 'Workflow failed.'
          : prev.message,
        error: prev.steps.challenge || prev.steps.payment || prev.steps.proof || prev.steps.onchain
          ? err.message
          : ''
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
          {onOpenTransfer && <button className="link-btn" onClick={onOpenTransfer}>Transfer</button>}
          {onOpenRecords && <button className="link-btn" onClick={onOpenRecords}>Records</button>}
          {onOpenOnChain && <button className="link-btn" onClick={onOpenOnChain}>Audit</button>}
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
                {item.identity && (
                  <>
                    <small>identity: {item.identity.verified ? 'verified' : 'failed'}</small>
                    {item.identity.agentId && <small>agentId: {item.identity.agentId}</small>}
                    {item.identity.agentWallet && <small>agentWallet: {shortHash(item.identity.agentWallet)}</small>}
                  </>
                )}
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
          <div className="request-input dashboard-chat-input-bottom">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder='Try: "place stop order BTC-USDT TP 80000 SL 50000 QTY 0.1"'
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendChat();
              }}
            />
            <button onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>
              {chatBusy ? 'Sending...' : 'Send'}
            </button>
          </div>
          <div className="dashboard-aa-footer">
            <div className="dashboard-aa-footer-row">
              <span className="label">AA Wallet</span>
              <span className="value hash">{aaWalletAddress || '-'}</span>
            </div>
            <div className="dashboard-aa-footer-actions">
              <button
                type="button"
                className="link-btn dashboard-inline-link"
                onClick={() => void handleCopyAAAddress()}
              >
                Copy AA Address
              </button>
              {aaExplorerUrl && (
                <a className="link-btn dashboard-inline-link" href={aaExplorerUrl} target="_blank" rel="noreferrer">
                  View AA on Kitescan
                </a>
              )}
            </div>
            <p className="dashboard-aa-footer-tip">
              Fund this AA wallet first: transfer KITE (gas) and USDT (x402 payments) to this address.
            </p>
          </div>
        </article>

        <aside className="dashboard-status-stack">
          <article className="vault-card">
            <div className="status-current-card">
              <span className="status-current-title">Current Stage</span>
              <strong className="status-current-label">{currentStep.label}</strong>
              <small className="status-current-message">{flow.message || '-'}</small>
            </div>
            {completedSteps.length > 0 && (
              <details className="status-history">
                <summary>Completed Steps ({completedSteps.length})</summary>
                <div className="status-history-chips">
                  {completedSteps.map((step) => (
                    <span key={step.key} className="status-chip">
                      {step.label}
                    </span>
                  ))}
                </div>
              </details>
            )}
            <div className="result-row">
              <span className="label">State</span>
              <span className="value">{flow.state}</span>
            </div>
            <div className="result-row">
              <span className="label">OpenClaw</span>
              <span className="value">{openclawHealth.connected ? 'online' : 'offline'}</span>
            </div>
            <div className="result-row">
              <span className="label">Mode</span>
              <span className="value">{openclawHealth.mode || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Message</span>
              <span className="value">{flow.message || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Request</span>
              <span className="value hash">{shortHash(flow.requestId)}</span>
            </div>
            <div className="result-row">
              <span className="label">Tx</span>
              <span className="value hash">{flow.txHash || '-'}</span>
            </div>
            {flow.error && <div className="request-error">{flow.error}</div>}
            {identityError && <div className="request-error">{identityError}</div>}
            {!openclawHealth.connected && <div className="request-error">OpenClaw: {openclawHealth.reason}</div>}
          </article>

          <article className="vault-card loop-indicator-card">
            <h2>Payment Loop</h2>
            <div className={`loop-indicator ${flowClass}`}>
              <span className="loop-indicator-icon">{flowIcon}</span>
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

            <button onClick={() => void handleOneClickSetup()} disabled={setupBusy}>
              {setupBusy ? 'Setting up AA + Session...' : 'Generate + Deploy AA, Copy, View & Apply Session Rules'}
            </button>
            {status && <div className="request-error">{status}</div>}
          </article>
        </aside>
      </section>
    </div>
  );
}

