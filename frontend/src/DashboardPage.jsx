import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk';

const TOKEN_DECIMALS = 18;
const DEFAULT_TOKEN = '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const DEFAULT_GATEWAY_RECIPIENT = '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
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
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' }
    ],
    name: 'addSupportedToken',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]);

export default function DashboardPage({
  walletState,
  onBack,
  onOpenTransfer,
  onOpenVault,
  onOpenRecords,
  onOpenOnChain,
  onOpenAbuseCases
}) {
  const [accountAddress, setAccountAddress] = useState(
    import.meta.env.VITE_KITECLAW_AA_WALLET_ADDRESS ||
      import.meta.env.VITE_AA_WALLET_ADDRESS ||
      walletState?.aaAddress ||
      ''
  );
  const [singleLimit, setSingleLimit] = useState('0.1');
  const [dailyLimit, setDailyLimit] = useState('0.6');
  const [gatewayRecipient, setGatewayRecipient] = useState(DEFAULT_GATEWAY_RECIPIENT);
  const [allowedToken, setAllowedToken] = useState(DEFAULT_TOKEN);
  const [status, setStatus] = useState('');

  const [sessionKey, setSessionKey] = useState('');
  const [sessionPrivKey, setSessionPrivKey] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessionTxHash, setSessionTxHash] = useState('');
  const [runtime, setRuntime] = useState(null);
  const [runtimeSyncInfo, setRuntimeSyncInfo] = useState('');

  const rpcUrl =
    import.meta.env.VITE_KITEAI_RPC_URL ||
    import.meta.env.VITE_KITE_RPC_URL ||
    'https://rpc-testnet.gokite.ai/';
  const bundlerUrl =
    import.meta.env.VITE_KITEAI_BUNDLER_URL ||
    import.meta.env.VITE_BUNDLER_URL ||
    'https://bundler-service.staging.gokite.ai/rpc/';

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
      // ignore and keep fallback
    }
  }, [walletState?.ownerAddress, rpcUrl, bundlerUrl]);

  useEffect(() => {
    setSessionKey(localStorage.getItem(SESSION_KEY_ADDR_STORAGE) || '');
    setSessionPrivKey(localStorage.getItem(SESSION_KEY_PRIV_STORAGE) || '');
    setSessionId(localStorage.getItem(SESSION_ID_STORAGE) || '');
    setSessionTxHash(localStorage.getItem(SESSION_TX_STORAGE) || '');
    void refreshRuntime();
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

  const refreshRuntime = async () => {
    try {
      const res = await fetch('/api/session/runtime');
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) setRuntime(body.runtime || null);
    } catch {
      // ignore
    }
  };

  const syncGatewayPolicy = async () => {
    const maxPerTx = Number(singleLimit);
    const daily = Number(dailyLimit);
    if (!Number.isFinite(maxPerTx) || maxPerTx <= 0) {
      throw new Error('Single Tx Limit must be a positive number.');
    }
    if (!Number.isFinite(daily) || daily <= 0) {
      throw new Error('Daily Limit must be a positive number.');
    }
    if (!gatewayRecipient || !ethers.isAddress(gatewayRecipient)) {
      throw new Error('Gateway allowed recipient must be a valid address.');
    }
    const resp = await fetch('/api/x402/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxPerTx,
        dailyLimit: daily,
        allowedRecipients: [gatewayRecipient]
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body?.ok) {
      throw new Error(body?.reason || `Gateway policy sync failed: HTTP ${resp.status}`);
    }
  };

  const syncSessionRuntime = async ({
    sessionAddress = sessionKey,
    sessionPrivateKey = sessionPrivKey,
    currentSessionId = sessionId,
    currentSessionTxHash = sessionTxHash
  } = {}) => {
    if (!sessionAddress || !sessionPrivateKey || !currentSessionId) {
      throw new Error('Missing session key/session private key/session id. Generate session first.');
    }
    const resp = await fetch('/api/session/runtime/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aaWallet: accountAddress,
        owner: walletState?.ownerAddress || '',
        sessionAddress,
        sessionPrivateKey,
        sessionId: currentSessionId,
        sessionTxHash: currentSessionTxHash,
        expiresAt: 0,
        maxPerTx: Number(singleLimit),
        dailyLimit: Number(dailyLimit),
        gatewayRecipient,
        source: 'dashboard-setup'
      })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body?.ok) {
      throw new Error(body?.reason || body?.error || `Session runtime sync failed: HTTP ${resp.status}`);
    }
    const rt = body?.runtime || {};
    setRuntimeSyncInfo(
      `Runtime synced: ${rt.sessionAddress || '-'} (${new Date(Number(rt.updatedAt || Date.now())).toISOString()})`
    );
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

      await syncGatewayPolicy();
      await syncSessionRuntime({
        sessionAddress: generatedSessionWallet.address,
        sessionPrivateKey: generatedSessionWallet.privateKey,
        currentSessionId: nextSessionId,
        currentSessionTxHash: tx.hash
      });
      setStatus(`Session created + rules applied + runtime synced: ${tx.hash}`);
    } catch (err) {
      setStatus(`Create session failed: ${err.message}`);
    }
  };

  const handleSyncRuntime = async () => {
    try {
      setStatus('Syncing session runtime...');
      await syncSessionRuntime();
      setStatus('Session runtime synced successfully.');
    } catch (err) {
      setStatus(`Runtime sync failed: ${err.message}`);
    }
  };

  const handleSyncPolicy = async () => {
    try {
      setStatus('Syncing gateway policy...');
      await syncGatewayPolicy();
      setStatus('Gateway policy synced successfully.');
      await refreshRuntime();
    } catch (err) {
      setStatus(`Policy sync failed: ${err.message}`);
    }
  };

  const handleSetAllowedToken = async () => {
    try {
      setStatus('Setting allowed token...');
      const signer = await getSigner();
      const data = accountInterface.encodeFunctionData('addSupportedToken', [allowedToken]);
      const tx = await signer.sendTransaction({ to: accountAddress, data });
      await tx.wait();
      setStatus(`Allowed token updated: ${tx.hash}`);
    } catch (err) {
      setStatus(`Set token failed: ${err.message}`);
    }
  };

  const setupReady =
    Boolean(sessionKey && sessionId) &&
    Boolean(runtime?.hasSessionPrivateKey) &&
    String(runtime?.aaWallet || '').toLowerCase() === String(accountAddress || '').toLowerCase();

  return (
    <div className="transfer-container transfer-shell">
      <header className="shell-header">
        <div className="shell-brand">
          <span className="brand-badge">KITECLAW</span>
          <p>Dashboard Setup & Automation Readiness</p>
        </div>
        <div className="top-entry">
          {onBack && <button className="link-btn" onClick={onBack}>Switch Wallet</button>}
          {onOpenTransfer && <button className="link-btn" onClick={onOpenTransfer}>Open Transfer</button>}
          {onOpenVault && <button className="link-btn" onClick={onOpenVault}>Open Vault</button>}
          {onOpenRecords && <button className="link-btn" onClick={onOpenRecords}>Transfer Records</button>}
          {onOpenOnChain && <button className="link-btn" onClick={onOpenOnChain}>On-chain Confirmation</button>}
          {onOpenAbuseCases && <button className="link-btn" onClick={onOpenAbuseCases}>Abuse / Limit Cases</button>}
        </div>
      </header>

      <section className="vault-card">
        <h2>Setup Readiness</h2>
        <div className="result-row">
          <span className="label">Status</span>
          <span className="value">{setupReady ? 'READY' : 'NOT READY'}</span>
        </div>
        <div className="result-row">
          <span className="label">AA Wallet</span>
          <span className="value hash">{accountAddress || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Session Key</span>
          <span className="value hash">{sessionKey || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Session ID</span>
          <span className="value hash">{sessionId || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Runtime Synced</span>
          <span className="value">{runtime?.hasSessionPrivateKey ? 'yes' : 'no'}</span>
        </div>
      </section>

      <section className="vault-card">
        <h2>Session Setup (One-time before OpenClaw auto-run)</h2>
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
            <label>Gateway Allowed Recipient</label>
            <input value={gatewayRecipient} onChange={(e) => setGatewayRecipient(e.target.value)} />
          </div>
        </div>
        <div className="vault-actions">
          <div className="vault-input">
            <label>Allowed Token</label>
            <input value={allowedToken} onChange={(e) => setAllowedToken(e.target.value)} />
          </div>
        </div>
        <div className="vault-actions">
          <button onClick={handleCreateSession}>Generate Session Key & Apply Rules</button>
          <button onClick={handleSyncRuntime}>Sync Session Runtime</button>
          <button onClick={handleSyncPolicy}>Sync Gateway Policy</button>
          <button onClick={handleSetAllowedToken}>Set Allowed Token</button>
        </div>
      </section>

      <section className="vault-card">
        <h2>Runtime Snapshot</h2>
        <div className="result-row">
          <span className="label">Runtime AA</span>
          <span className="value hash">{runtime?.aaWallet || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Runtime Session</span>
          <span className="value hash">{runtime?.sessionAddress || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Runtime Session ID</span>
          <span className="value hash">{runtime?.sessionId || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Max per tx</span>
          <span className="value">{runtime?.maxPerTx || '-'}</span>
        </div>
        <div className="result-row">
          <span className="label">Daily limit</span>
          <span className="value">{runtime?.dailyLimit || '-'}</span>
        </div>
        {runtimeSyncInfo && <div className="request-error">{runtimeSyncInfo}</div>}
        {status && <div className="request-error">{status}</div>}
      </section>
    </div>
  );
}

