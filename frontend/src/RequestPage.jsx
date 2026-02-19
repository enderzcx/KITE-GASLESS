import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk';

const productLinks = [
  'https://shop.example.com/product/airfryer-01',
  'https://shop.example.com/product/airfryer-02',
  'https://shop.example.com/product/airfryer-03'
];

const SETTLEMENT_TOKEN =
  import.meta.env.VITE_KITEAI_SETTLEMENT_TOKEN ||
  import.meta.env.VITE_SETTLEMENT_TOKEN ||
  '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const TOKEN_DECIMALS = 18;
const AUTH_STORAGE_PREFIX = 'kiteclaw_auth_';
const SESSION_KEY_PRIV_STORAGE = 'kiteclaw_session_privkey';

function RequestPage({
  onOpenTransfer,
  onOpenVault,
  onOpenAgentSettings,
  onOpenRecords,
  onOpenOnChain,
  onOpenAbuseCases,
  walletState
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [aaWallet, setAAWallet] = useState(walletState?.aaAddress || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [identityError, setIdentityError] = useState('');

  const rpcUrl =
    import.meta.env.VITE_KITEAI_RPC_URL ||
    import.meta.env.VITE_KITE_RPC_URL ||
    'https://rpc-testnet.gokite.ai/';
  const bundlerUrl =
    import.meta.env.VITE_KITEAI_BUNDLER_URL ||
    import.meta.env.VITE_BUNDLER_URL ||
    'https://bundler-service.staging.gokite.ai/rpc/';

  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl,
    bundlerUrl,
    entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    proxyAddress: aaWallet || undefined
  });

  useEffect(() => {
    if (walletState?.aaAddress) {
      setAAWallet(walletState.aaAddress);
    }
  }, [walletState]);

  useEffect(() => {
    if (!walletState?.ownerAddress) {
      setIsAuthenticated(false);
      return;
    }
    const authKey = `${AUTH_STORAGE_PREFIX}${walletState.ownerAddress.toLowerCase()}`;
    setIsAuthenticated(localStorage.getItem(authKey) === 'ok');
  }, [walletState?.ownerAddress]);

  useEffect(() => {
    const loadIdentity = async () => {
      try {
        const res = await fetch('/api/identity');
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.reason || `HTTP ${res.status}`);
        }
        setIdentity(data.profile || null);
        setIdentityError('');
      } catch (err) {
        setIdentity(null);
        setIdentityError(err.message || 'identity load failed');
      }
    };
    loadIdentity();
  }, []);

  const handleAuthentication = async () => {
    if (!walletState?.ownerAddress) {
      setAuthStatus('Please connect your wallet first.');
      return;
    }
    if (typeof window.ethereum === 'undefined') {
      setAuthStatus('No wallet environment detected.');
      return;
    }
    try {
      setAuthStatus('Authenticating...');
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const ownerSigner = await browserProvider.getSigner();
      const challenge = `KiteClaw Authentication\nOwner: ${walletState.ownerAddress}\nTime: ${Date.now()}`;
      await ownerSigner.signMessage(challenge);
      const authKey = `${AUTH_STORAGE_PREFIX}${walletState.ownerAddress.toLowerCase()}`;
      localStorage.setItem(authKey, 'ok');
      setIsAuthenticated(true);
      setAuthStatus('Authentication successful. You can now send without wallet popups.');
    } catch (err) {
      setAuthStatus(`Authentication failed: ${err.message || 'unknown error'}`);
    }
  };

  const resolveSigner = async () => {
    const fetchBackendSignerInfo = async () => {
      const resp = await fetch('/api/signer/info');
      if (!resp.ok) throw new Error(`backend signer info failed: HTTP ${resp.status}`);
      return resp.json();
    };
    const signByBackend = async (userOpHash) => {
      const resp = await fetch('/api/signer/sign-userop-hash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userOpHash })
      });
      const body = await resp.json();
      if (!resp.ok || !body?.signature) {
        throw new Error(body?.reason || `backend signer failed: HTTP ${resp.status}`);
      }
      return body.signature;
    };

    const sessionPrivKey = localStorage.getItem(SESSION_KEY_PRIV_STORAGE) || '';

    // Session key signs userOpHash, but AA owner remains root owner address.
    if (sessionPrivKey) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const sessionSigner = new ethers.Wallet(sessionPrivKey, provider);
      let ownerAddress = walletState?.ownerAddress || '';
      if (!ownerAddress) {
        const signerInfo = await fetchBackendSignerInfo();
        ownerAddress = signerInfo?.address || '';
      }
      if (!ownerAddress) {
        throw new Error('Session key found but owner address is missing. Connect wallet once or configure backend signer.');
      }
      return {
        signer: sessionSigner,
        ownerAddress,
        mode: 'session_key'
      };
    }

    if (walletState?.ownerAddress) {
      if (typeof window.ethereum === 'undefined') {
        throw new Error('No wallet detected.');
      }
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const ownerSigner = await browserProvider.getSigner();
      return {
        signer: ownerSigner,
        ownerAddress: walletState.ownerAddress,
        mode: 'owner'
      };
    }

    const signerInfo = await fetchBackendSignerInfo();
    if (!signerInfo?.enabled || !signerInfo?.address) {
      throw new Error('Wallet not connected and backend signer is unavailable.');
    }
    return {
      signer: { signMessage: signByBackend },
      ownerAddress: signerInfo.address,
      mode: 'backend_signer'
    };
  };

  const logRecord = async (record) => {
    try {
      await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
    } catch {
      // ignore logging errors
    }
  };

  const requestPaidResource = async ({ queryText, payer, requestId, paymentProof }) => {
    const identityPayload = {
      agentId: identity?.configured?.agentId || '',
      identityRegistry: identity?.configured?.registry || ''
    };
    const resp = await fetch('/api/x402/kol-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: queryText,
        payer,
        requestId,
        paymentProof,
        identity: identityPayload
      })
    });

    const body = await resp.json();
    return { status: resp.status, body };
  };

  const handleSubmit = async () => {
    if (loading) return;
    if (!query.trim()) {
      setError('Please enter your request.');
      return;
    }

    setError('');
    setLoading(true);
    setResult(null);

    try {
      if (walletState?.ownerAddress && !isAuthenticated) {
        throw new Error('Please complete Authentication once before sending.');
      }

      const { signer, ownerAddress, mode } = await resolveSigner();
      const derivedAA = sdk.ensureAccountAddress(ownerAddress);
      if (derivedAA !== aaWallet) {
        setAAWallet(derivedAA);
      }

      setAuthStatus('Step 1/3: requesting paid resource (expecting 402)...');
      const firstTry = await requestPaidResource({ queryText: query, payer: derivedAA });
      if (firstTry.status !== 402) {
        throw new Error(`Expected 402, got ${firstTry.status}.`);
      }

      const challenge = firstTry.body?.x402;
      const payInfo = challenge?.accepts?.[0];
      if (!challenge?.requestId || !payInfo) {
        throw new Error('Invalid x402 challenge response.');
      }

      setAuthStatus('Step 2/3: paying x402 challenge on-chain...');
      if (mode === 'session_key') {
        setAuthStatus('Step 2/3: paying with session key (no wallet popup expected)...');
      }
      const signFunction = async (userOpHash) => {
        if (mode === 'backend_signer') {
          return signer.signMessage(userOpHash);
        }
        return signer.signMessage(ethers.getBytes(userOpHash));
      };
      const transferResult = await sdk.sendERC20(
        {
          tokenAddress: payInfo.tokenAddress || SETTLEMENT_TOKEN,
          recipient: payInfo.recipient,
          amount: ethers.parseUnits(String(payInfo.amount), payInfo.decimals ?? TOKEN_DECIMALS)
        },
        signFunction
      );

      if (transferResult.status !== 'success') {
        await logRecord({
          type: 'x402Payment',
          amount: String(payInfo.amount),
          token: payInfo.tokenAddress || SETTLEMENT_TOKEN,
          recipient: payInfo.recipient,
          txHash: transferResult.transactionHash || '',
          status: 'failed',
          requestId: challenge.requestId,
          signerMode: mode
        });
        throw new Error(transferResult.reason || 'x402 payment transfer failed');
      }

      await logRecord({
        type: 'x402Payment',
        amount: String(payInfo.amount),
        token: payInfo.tokenAddress || SETTLEMENT_TOKEN,
        recipient: payInfo.recipient,
        txHash: transferResult.transactionHash,
        status: 'success',
        requestId: challenge.requestId,
        signerMode: mode
      });

      const paymentProof = {
        requestId: challenge.requestId,
        txHash: transferResult.transactionHash,
        payer: derivedAA,
        tokenAddress: payInfo.tokenAddress || SETTLEMENT_TOKEN,
        recipient: payInfo.recipient,
        amount: String(payInfo.amount)
      };

      setAuthStatus('Step 3/3: retrying resource request with payment proof...');
      const secondTry = await requestPaidResource({
        queryText: query,
        payer: derivedAA,
        requestId: challenge.requestId,
        paymentProof
      });

      if (secondTry.status !== 200 || !secondTry.body?.ok) {
        throw new Error(secondTry.body?.reason || `x402 verification failed: ${secondTry.status}`);
      }

      const randomLink = productLinks[Math.floor(Math.random() * productLinks.length)];
      setResult({
        txHash: transferResult.transactionHash,
        requestId: secondTry.body.requestId,
        productUrl: randomLink,
        summary: secondTry.body?.result?.summary || 'Paid resource unlocked',
        topKOLs: secondTry.body?.result?.topKOLs || []
      });

      setAuthStatus('x402 flow complete: 402 -> payment -> proof verified -> 200');
    } catch (err) {
      setError(err.message || 'An error occurred');
      await logRecord({
        type: 'x402Payment',
        amount: '',
        token: '',
        recipient: '',
        txHash: '',
        status: 'error',
        requestId: '',
        signerMode: ''
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="request-page">
      <div className="top-entry">
        <button className="link-btn" onClick={onOpenTransfer}>
          Open Transfer Page
        </button>
        <button className="link-btn" onClick={onOpenVault}>
          Open Vault Page
        </button>
        <button className="link-btn" onClick={onOpenAgentSettings}>
          Agent Payment Settings
        </button>
        <button className="link-btn" onClick={onOpenRecords}>
          Transfer Records
        </button>
        <button className="link-btn" onClick={onOpenOnChain}>
          On-chain Confirmation
        </button>
        <button className="link-btn" onClick={onOpenAbuseCases}>
          Abuse / Limit Cases
        </button>
      </div>

      <div className="request-card">
        <h1>What would you like to buy?</h1>
        <div className="request-input">
          <button onClick={handleAuthentication} disabled={loading}>
            {isAuthenticated ? 'Authenticated' : 'Authentication'}
          </button>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Example: buy me KOL score report for AI payment campaign"
            disabled={loading}
          />
          <button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
        {error && <div className="request-error">{error}</div>}
        {authStatus && <div className="request-error">{authStatus}</div>}
      </div>

      <div className="result-card">
        <h2>Verifiable Agent Identity</h2>
        {identityError && <div className="request-error">identity error: {identityError}</div>}
        {!identityError && !identity?.available && (
          <div className="result-row">
            <span className="label">Status:</span>
            <span className="value">not configured ({identity?.reason || 'unknown'})</span>
          </div>
        )}
        {identity?.available && (
          <>
            <div className="result-row">
              <span className="label">Agent ID:</span>
              <span className="value">{identity?.configured?.agentId || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Registry:</span>
              <span className="value hash">{identity?.configured?.registry || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Agent Wallet:</span>
              <span className="value hash">{identity?.agentWallet || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Owner:</span>
              <span className="value hash">{identity?.ownerAddress || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Token URI:</span>
              <span className="value hash">{identity?.tokenURI || '-'}</span>
            </div>
          </>
        )}
      </div>

      {result && (
        <div className="result-card">
          <h2>x402-paid Resource Unlocked</h2>
          <div className="result-row">
            <span className="label">Summary:</span>
            <span className="value">{result.summary}</span>
          </div>
          <div className="result-row">
            <span className="label">Sample Link:</span>
            <span className="value">{result.productUrl}</span>
          </div>
          <div className="result-row">
            <span className="label">x402 Request ID:</span>
            <span className="value hash">{result.requestId}</span>
          </div>
          <div className="result-row">
            <span className="label">Payment Tx Hash:</span>
            <span className="value hash">{result.txHash}</span>
          </div>
          {result.topKOLs.length > 0 && (
            <div className="result-row">
              <span className="label">Top KOLs:</span>
              <span className="value">{result.topKOLs.map((item) => `${item.handle}(${item.score})`).join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default RequestPage;
