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
const MERCHANT_ADDRESS = '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const AUTH_STORAGE_PREFIX = 'kiteclaw_auth_';

function RequestPage({ onOpenTransfer, onOpenVault, onOpenAgentSettings, onOpenRecords, walletState }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [aaWallet, setAAWallet] = useState(walletState?.aaAddress || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const rpcUrl =
    import.meta.env.VITE_KITEAI_RPC_URL ||
    import.meta.env.VITE_KITE_RPC_URL ||
    '/rpc';
  const bundlerUrl =
    import.meta.env.VITE_KITEAI_BUNDLER_URL ||
    import.meta.env.VITE_BUNDLER_URL ||
    '/bundler';

  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl,
    bundlerUrl,
    entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    proxyAddress: aaWallet || undefined
  });

  const privateKey =
    import.meta.env.VITE_KITECLAW_PRIVATE_KEY ||
    import.meta.env.VITE_USER_PRIVATE_KEY ||
    '';

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
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    if (privateKey) {
      const autoSigner = new ethers.Wallet(privateKey, provider);
      return {
        signer: autoSigner,
        ownerAddress: walletState?.ownerAddress || autoSigner.address,
        mode: 'agent_key'
      };
    }

    if (walletState?.ownerAddress) {
      if (typeof window.ethereum === 'undefined') {
        throw new Error('No wallet detected and no auto-sign private key configured.');
      }
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const ownerSigner = await browserProvider.getSigner();
      return {
        signer: ownerSigner,
        ownerAddress: walletState.ownerAddress,
        mode: 'owner'
      };
    }
    throw new Error('Wallet not connected and no auto-sign private key configured.');
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

      const signFunction = async (userOpHash) => {
        return signer.signMessage(ethers.getBytes(userOpHash));
      };

      const transferResult = await sdk.sendERC20({
        tokenAddress: SETTLEMENT_TOKEN,
        recipient: MERCHANT_ADDRESS,
        amount: ethers.parseUnits('0.05', TOKEN_DECIMALS)
      }, signFunction);

      if (transferResult.status !== 'success') {
        await logRecord({
          type: 'Order',
          amount: '0.05',
          token: SETTLEMENT_TOKEN,
          recipient: MERCHANT_ADDRESS,
          txHash: transferResult.transactionHash || '',
          status: 'failed'
        });
        throw new Error(transferResult.reason || 'Transfer failed');
      }

      const randomLink = productLinks[Math.floor(Math.random() * productLinks.length)];

      setResult({
        txHash: transferResult.transactionHash,
        productUrl: randomLink
      });

      await logRecord({
        type: 'Order',
        amount: '0.05',
        token: SETTLEMENT_TOKEN,
        recipient: MERCHANT_ADDRESS,
        txHash: transferResult.transactionHash,
        status: 'success',
        signerMode: mode
      });
    } catch (err) {
      setError(err.message || 'An error occurred');
      await logRecord({
        type: 'Order',
        amount: '0.05',
        token: SETTLEMENT_TOKEN,
        recipient: MERCHANT_ADDRESS,
        txHash: '',
        status: 'error'
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
            placeholder="Example: buy me the top-rated air fryer"
            disabled={loading}
          />
          <button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
        {error && <div className="request-error">{error}</div>}
        {authStatus && <div className="request-error">{authStatus}</div>}
      </div>

      {result && (
        <div className="result-card">
          <h2>Purchased the top-rated air fryer</h2>
          <div className="result-row">
            <span className="label">Details:</span>
            <span className="value">{result.productUrl}</span>
          </div>
          <div className="result-row">
            <span className="label">Price:</span>
            <span className="value">0.05USDT</span>
          </div>
          <div className="result-row">
            <span className="label">Tracking No.:</span>
            <span className="value">88886666687</span>
          </div>
          <div className="result-row">
            <span className="label">On-chain Tx Hash:</span>
            <span className="value hash">{result.txHash}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default RequestPage;

