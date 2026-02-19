import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk';

const TOKEN_DECIMALS = 18;
const DEFAULT_TOKEN = '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const DEFAULT_GATEWAY_RECIPIENT = '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const SESSION_KEY_ADDR_STORAGE = 'kiteclaw_session_address';
const SESSION_KEY_PRIV_STORAGE = 'kiteclaw_session_privkey';

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
      { internalType: 'bytes32', name: 'sessionId', type: 'bytes32' },
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
    name: 'setSpendingRules',
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

function AgentSettingsPage({ onBack, walletState }) {
  const [sessionKey, setSessionKey] = useState('');
  const [sessionPrivKey, setSessionPrivKey] = useState('');
  const [accountAddress, setAccountAddress] = useState(
    import.meta.env.VITE_KITECLAW_AA_WALLET_ADDRESS ||
    import.meta.env.VITE_AA_WALLET_ADDRESS ||
    ''
  );
  const [agentAddress, setAgentAddress] = useState(
    import.meta.env.VITE_KITECLAW_AA_WALLET_ADDRESS ||
    import.meta.env.VITE_AA_WALLET_ADDRESS ||
    ''
  );
  const [singleLimit, setSingleLimit] = useState('5');
  const [dailyLimit, setDailyLimit] = useState('50');
  const [gatewayRecipient, setGatewayRecipient] = useState(DEFAULT_GATEWAY_RECIPIENT);
  const [revokedPayers, setRevokedPayers] = useState([]);
  const [allowedToken, setAllowedToken] = useState(DEFAULT_TOKEN);
  const [status, setStatus] = useState('');

  const rpcUrl =
    import.meta.env.VITE_KITEAI_RPC_URL ||
    import.meta.env.VITE_KITE_RPC_URL ||
    'https://rpc-testnet.gokite.ai/';
  const bundlerUrl =
    import.meta.env.VITE_KITEAI_BUNDLER_URL ||
    import.meta.env.VITE_BUNDLER_URL ||
    'https://bundler-service.staging.gokite.ai/rpc/';

  useEffect(() => {
    const storedSessionAddr = localStorage.getItem(SESSION_KEY_ADDR_STORAGE) || '';
    const storedSessionPriv = localStorage.getItem(SESSION_KEY_PRIV_STORAGE) || '';
    if (storedSessionAddr && storedSessionPriv) {
      setSessionKey(storedSessionAddr);
      setSessionPrivKey(storedSessionPriv);
    }
  }, []);

  useEffect(() => {
    const loadGatewayPolicy = async () => {
      try {
        const res = await fetch('/api/x402/policy');
        if (!res.ok) return;
        const data = await res.json();
        const policy = data?.policy || {};
        if (policy?.maxPerTx) setSingleLimit(String(policy.maxPerTx));
        if (policy?.dailyLimit) setDailyLimit(String(policy.dailyLimit));
        if (Array.isArray(policy?.revokedPayers)) setRevokedPayers(policy.revokedPayers);
        const firstAllowed = Array.isArray(policy?.allowedRecipients)
          ? policy.allowedRecipients[0]
          : '';
        if (firstAllowed) setGatewayRecipient(firstAllowed);
      } catch {
        // keep defaults when backend policy is unavailable
      }
    };
    void loadGatewayPolicy();
  }, []);

  useEffect(() => {
    try {
      let signerAddress = '';
      if (walletState?.ownerAddress) {
        signerAddress = walletState.ownerAddress;
      } else {
        return;
      }
      const sdk = new GokiteAASDK({
        network: 'kite_testnet',
        rpcUrl,
        bundlerUrl,
        entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
        proxyAddress: accountAddress
      });
      const derivedAA = sdk.getAccountAddress(signerAddress);
      setAccountAddress(derivedAA);
      setAgentAddress((prev) => (prev ? prev : derivedAA));
    } catch {
      // keep fallback address when derivation fails
    }
  }, [walletState, rpcUrl, bundlerUrl]);

  const getSigner = async () => {
    if (walletState?.ownerAddress && typeof window.ethereum !== 'undefined') {
      const provider = new ethers.BrowserProvider(window.ethereum);
      return provider.getSigner();
    }
    throw new Error('Please connect wallet to manage session and spending rules.');
  };

  const buildRules = async (provider) => {
    const latestBlock = await provider.getBlock('latest');
    const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
    return [
      [0, ethers.parseUnits(singleLimit || '0', TOKEN_DECIMALS), 0, []],
      [86400, ethers.parseUnits(dailyLimit || '0', TOKEN_DECIMALS), Math.max(0, nowTs - 1), []]
    ];
  };

  const handleSetAllowedToken = async () => {
    if (!walletState?.ownerAddress) {
      setStatus('No signer available. Please connect wallet.');
      return;
    }
    if (!allowedToken) {
      setStatus('Please enter a token address.');
      return;
    }
    try {
      setStatus('Setting token...');
      const signer = await getSigner();
      const data = accountInterface.encodeFunctionData('addSupportedToken', [
        allowedToken
      ]);
      const tx = await signer.sendTransaction({ to: accountAddress, data });
      await tx.wait();
      setStatus(`Token added: ${tx.hash}`);
    } catch (err) {
      setStatus(`Failed: ${err.message}`);
    }
  };

  const handleCreateSession = async () => {
    if (!walletState?.ownerAddress) {
      setStatus('No signer available. Please connect wallet.');
      return;
    }
    if (!accountAddress) {
      setStatus('AA wallet address is missing.');
      return;
    }
    try {
      setStatus('Creating...');
      const signer = await getSigner();
      const generatedSessionWallet = ethers.Wallet.createRandom();
      setSessionKey(generatedSessionWallet.address);
      setSessionPrivKey(generatedSessionWallet.privateKey);
      const sessionId = ethers.keccak256(
        ethers.toUtf8Bytes(`${generatedSessionWallet.address}-${Date.now()}`)
      );
      const rules = await buildRules(signer.provider);
      const data = accountInterface.encodeFunctionData('createSession', [
        sessionId,
        agentAddress || accountAddress,
        rules
      ]);
      const tx = await signer.sendTransaction({ to: accountAddress, data });
      await tx.wait();
      await syncGatewayPolicy();
      localStorage.setItem(SESSION_KEY_ADDR_STORAGE, generatedSessionWallet.address);
      localStorage.setItem(SESSION_KEY_PRIV_STORAGE, generatedSessionWallet.privateKey);
      setStatus(`Session generated, rules applied, gateway policy synced: ${tx.hash}\nSessionId: ${sessionId}`);
    } catch (err) {
      setStatus(`Creation failed: ${err.message}`);
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

  const handleSyncGatewayPolicy = async () => {
    try {
      setStatus('Syncing gateway policy...');
      await syncGatewayPolicy();
      setStatus('Gateway policy synced successfully.');
    } catch (err) {
      setStatus(`Gateway policy sync failed: ${err.message}`);
    }
  };

  const refreshGatewayPolicy = async () => {
    try {
      const res = await fetch('/api/x402/policy');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const policy = data?.policy || {};
      if (Array.isArray(policy?.revokedPayers)) setRevokedPayers(policy.revokedPayers);
    } catch {
      // ignore refresh errors in UI
    }
  };

  const handleRevokeCurrentPayer = async () => {
    const payer = accountAddress || walletState?.aaAddress || '';
    if (!payer || !ethers.isAddress(payer)) {
      setStatus('Cannot revoke: current AA payer address is invalid.');
      return;
    }
    try {
      setStatus('Revoking current payer at gateway...');
      const res = await fetch('/api/x402/policy/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payer })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        throw new Error(body?.reason || body?.error || `HTTP ${res.status}`);
      }
      await refreshGatewayPolicy();
      setStatus(`Gateway revoke active for payer: ${payer}`);
    } catch (err) {
      setStatus(`Revoke failed: ${err.message}`);
    }
  };

  const handleUnrevokeCurrentPayer = async () => {
    const payer = accountAddress || walletState?.aaAddress || '';
    if (!payer || !ethers.isAddress(payer)) {
      setStatus('Cannot unrevoke: current AA payer address is invalid.');
      return;
    }
    try {
      setStatus('Removing gateway revoke for current payer...');
      const res = await fetch('/api/x402/policy/unrevoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payer })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        throw new Error(body?.reason || body?.error || `HTTP ${res.status}`);
      }
      await refreshGatewayPolicy();
      setStatus(`Gateway revoke removed for payer: ${payer}`);
    } catch (err) {
      setStatus(`Unrevoke failed: ${err.message}`);
    }
  };

  return (
    <div className="transfer-container">
      <div className="top-entry">
        {onBack && (
          <button className="link-btn" onClick={onBack}>
            Back to Request Page
          </button>
        )}
      </div>

      <h1>Agent Payment Settings</h1>

      <div className="vault-card">
        <h2>Session Key</h2>
        {sessionKey && (
          <div className="rules-list">
            <div className="result-row">
              <span className="label">Session Key Address:</span>
              <span className="value hash">{sessionKey}</span>
            </div>
            <div className="result-row">
              <span className="label">Session Private Key:</span>
              <span className="value hash">{sessionPrivKey}</span>
            </div>
            <div className="request-error">
              Store the private key safely. Use only in local demo.
            </div>
          </div>
        )}
      </div>

      <div className="vault-card">
        <h2>Allowed Token</h2>
        <div className="vault-actions">
          <div className="vault-input">
            <label>Token Address</label>
            <input
              type="text"
              value={allowedToken}
              onChange={(e) => setAllowedToken(e.target.value)}
              placeholder={DEFAULT_TOKEN}
            />
          </div>
          <button onClick={handleSetAllowedToken}>Set as Allowed Token</button>
        </div>
      </div>

      <div className="vault-card">
        <h2>Permissions & Limits</h2>
        <div className="vault-actions">
          <div className="vault-input">
            <label>Agent Address</label>
            <input
              type="text"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              placeholder={accountAddress || '0x...'}
            />
          </div>
        </div>
        <div className="vault-actions">
          <div className="vault-input">
            <label>Single Tx Limit (USDT)</label>
            <input
              type="text"
              value={singleLimit}
              onChange={(e) => setSingleLimit(e.target.value)}
              placeholder="5"
            />
          </div>
          <div className="vault-input">
            <label>Daily Limit (USDT)</label>
            <input
              type="text"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              placeholder="50"
            />
          </div>
          <div className="vault-input">
            <label>Gateway Allowed Recipient</label>
            <input
              type="text"
              value={gatewayRecipient}
              onChange={(e) => setGatewayRecipient(e.target.value)}
              placeholder={DEFAULT_GATEWAY_RECIPIENT}
            />
          </div>
        </div>
        <div className="vault-actions">
          <button onClick={handleCreateSession}>Generate Session Key & Apply Rules</button>
          <button onClick={handleSyncGatewayPolicy}>Sync Gateway Policy Only</button>
        </div>
        <div className="vault-actions">
          <button onClick={handleRevokeCurrentPayer}>Revoke Current Payer (Kill Switch)</button>
          <button onClick={handleUnrevokeCurrentPayer}>Unrevoke Current Payer</button>
        </div>
        <div className="rules-list">
          <h3>Gateway Revoked Payers</h3>
          {revokedPayers.length === 0 && (
            <div className="result-row">
              <span className="label">-</span>
              <span className="value">No revoked payer.</span>
            </div>
          )}
          {revokedPayers.map((addr, idx) => (
            <div className="result-row" key={`revoked-${idx}`}>
              <span className="label">Payer {idx + 1}:</span>
              <span className="value hash">{addr}</span>
            </div>
          ))}
        </div>
        {status && <div className="request-error">{status}</div>}
      </div>
    </div>
  );
}

export default AgentSettingsPage;





