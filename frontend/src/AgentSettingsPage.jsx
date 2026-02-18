import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk';

const TOKEN_DECIMALS = 18;
const DEFAULT_TOKEN = '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
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
  const privateKey =
    import.meta.env.VITE_KITECLAW_PRIVATE_KEY ||
    import.meta.env.VITE_USER_PRIVATE_KEY ||
    '';

  useEffect(() => {
    const storedSessionAddr = localStorage.getItem(SESSION_KEY_ADDR_STORAGE) || '';
    const storedSessionPriv = localStorage.getItem(SESSION_KEY_PRIV_STORAGE) || '';
    if (storedSessionAddr && storedSessionPriv) {
      setSessionKey(storedSessionAddr);
      setSessionPrivKey(storedSessionPriv);
    }
  }, []);

  useEffect(() => {
    try {
      let signerAddress = '';
      if (walletState?.ownerAddress) {
        signerAddress = walletState.ownerAddress;
      } else if (privateKey) {
        signerAddress = new ethers.Wallet(privateKey).address;
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
  }, [walletState, privateKey, rpcUrl, bundlerUrl]);

  const getSigner = async () => {
    if (walletState?.ownerAddress && typeof window.ethereum !== 'undefined') {
      const provider = new ethers.BrowserProvider(window.ethereum);
      return provider.getSigner();
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Wallet(privateKey, provider);
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
    if (!walletState?.ownerAddress && !privateKey) {
      setStatus('No signer available. Connect wallet or configure private key.');
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
    if (!walletState?.ownerAddress && !privateKey) {
      setStatus('No signer available. Connect wallet or configure private key.');
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
      localStorage.setItem(SESSION_KEY_ADDR_STORAGE, generatedSessionWallet.address);
      localStorage.setItem(SESSION_KEY_PRIV_STORAGE, generatedSessionWallet.privateKey);
      setStatus(`Session generated and rules applied: ${tx.hash}\nSessionId: ${sessionId}`);
    } catch (err) {
      setStatus(`Creation failed: ${err.message}`);
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
        </div>
        <div className="vault-actions">
          <button onClick={handleCreateSession}>Generate Session Key & Apply Rules</button>
        </div>
        {status && <div className="request-error">{status}</div>}
      </div>
    </div>
  );
}

export default AgentSettingsPage;





