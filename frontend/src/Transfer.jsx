import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk';
import './App.css';

const SETTLEMENT_TOKEN =
  import.meta.env.VITE_KITEAI_SETTLEMENT_TOKEN ||
  import.meta.env.VITE_SETTLEMENT_TOKEN ||
  '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const TOKEN_DECIMALS = 18;
const AUTH_STORAGE_PREFIX = 'kiteclaw_auth_';

function Transfer({ onBack, walletState }) {
  const [aaWallet, setAAWallet] = useState(walletState?.aaAddress || '');
  const [owner, setOwner] = useState(walletState?.ownerAddress || '');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.3');
  const [loading, setLoading] = useState(false);
  const [senderBalance, setSenderBalance] = useState('0');
  const [txHash, setTxHash] = useState('');
  const [userOpHash, setUserOpHash] = useState('');
  const [status, setStatus] = useState('');
  const [authStatus, setAuthStatus] = useState('');
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
    if (walletState?.ownerAddress) {
      setOwner(walletState.ownerAddress);
    }
    if (walletState?.aaAddress) {
      setAAWallet(walletState.aaAddress);
    }
  }, [walletState]);

  useEffect(() => {
    const currentOwner = walletState?.ownerAddress || owner;
    if (!currentOwner) {
      setIsAuthenticated(false);
      return;
    }
    const authKey = `${AUTH_STORAGE_PREFIX}${currentOwner.toLowerCase()}`;
    setIsAuthenticated(localStorage.getItem(authKey) === 'ok');
  }, [walletState?.ownerAddress, owner]);

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

  const handleConnectWallet = async () => {
    try {
      if (typeof window.ethereum !== 'undefined') {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const derivedAA = sdk.ensureAccountAddress(address);

        setOwner(address);
        setAAWallet(derivedAA);

        const balance = await sdk.getERC20Balance(SETTLEMENT_TOKEN);
        setSenderBalance(ethers.formatUnits(balance, TOKEN_DECIMALS));

        alert(`Wallet connected: ${address}`);
      } else {
        alert('Please install MetaMask or another wallet.');
      }
    } catch (error) {
      alert(`Connection failed: ${error.message}`);
    }
  };

  const resolveSigner = async () => {
    if (privateKey) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      return new ethers.Wallet(privateKey, provider);
    }
    if (walletState?.ownerAddress && typeof window.ethereum !== 'undefined') {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      return signer;
    }
    throw new Error('Wallet not connected and no auto-sign private key configured.');
  };

  const handleAuthentication = async () => {
    const currentOwner = walletState?.ownerAddress || owner;
    if (!currentOwner) {
      setAuthStatus('Please connect your wallet first.');
      return;
    }
    if (typeof window.ethereum === 'undefined') {
      setAuthStatus('No wallet environment detected.');
      return;
    }
    try {
      setAuthStatus('Authenticating...');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const challenge = `KiteClaw Authentication\nOwner: ${currentOwner}\nTime: ${Date.now()}`;
      await signer.signMessage(challenge);
      const authKey = `${AUTH_STORAGE_PREFIX}${currentOwner.toLowerCase()}`;
      localStorage.setItem(authKey, 'ok');
      setIsAuthenticated(true);
      setAuthStatus('Authentication successful.');
    } catch (error) {
      setAuthStatus(`Authentication failed: ${error.message}`);
    }
  };

  const handleTransfer = async () => {
    if (!recipient || !amount) {
      alert('Please enter recipient address and amount.');
      return;
    }

    try {
      setLoading(true);
      setStatus('');
      if (!privateKey && (walletState?.ownerAddress || owner) && !isAuthenticated) {
        throw new Error('Please complete Authentication once before sending.');
      }

      const signer = await resolveSigner();
      const derivedAA = sdk.ensureAccountAddress(await signer.getAddress());
      if (derivedAA !== aaWallet) {
        setAAWallet(derivedAA);
      }

      const balance = await sdk.getERC20Balance(SETTLEMENT_TOKEN);
      setSenderBalance(ethers.formatUnits(balance, TOKEN_DECIMALS));

      const signFunction = async (userOpHash) => {
        return signer.signMessage(ethers.getBytes(userOpHash));
      };

      const result = await sdk.sendERC20({
        tokenAddress: SETTLEMENT_TOKEN,
        recipient,
        amount: ethers.parseUnits(amount, TOKEN_DECIMALS)
      }, signFunction);

      if (result.status === 'success') {
        setStatus('success');
        setTxHash(result.transactionHash);
        setUserOpHash(result.userOpHash);

        const newBalance = await sdk.getERC20Balance(SETTLEMENT_TOKEN);
        setSenderBalance(ethers.formatUnits(newBalance, TOKEN_DECIMALS));

        await logRecord({
          type: 'TransferPage',
          amount,
          token: SETTLEMENT_TOKEN,
          recipient,
          txHash: result.transactionHash,
          status: 'success'
        });
      } else {
        setStatus('failed');
        await logRecord({
          type: 'TransferPage',
          amount,
          token: SETTLEMENT_TOKEN,
          recipient,
          txHash: result.transactionHash || '',
          status: 'failed'
        });
        alert(`Transfer failed: ${result.reason}`);
      }
    } catch (error) {
      setStatus('error');
      await logRecord({
        type: 'TransferPage',
        amount,
        token: SETTLEMENT_TOKEN,
        recipient,
        txHash: '',
        status: 'error'
      });
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
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

      <h1>Gokite Account Abstraction</h1>

      <div className="info-card">
        <h2>Account Info</h2>
        <div className="info-row">
          <span className="label">AA Wallet:</span>
          <span className="value">{aaWallet || 'Not generated'}</span>
        </div>
        <div className="info-row">
          <span className="label">Owner:</span>
          <span className="value">{owner || 'Not connected'}</span>
        </div>
      </div>

      <div className="balance-card">
        <h2>Balance</h2>
        <div className="info-row">
          <span className="label">{aaWallet || 'AA Address'}:</span>
          <span className="value">{senderBalance} USDT</span>
        </div>
      </div>

      <div className="transfer-card">
        <h2>Transfer</h2>
        <button
          onClick={handleConnectWallet}
          className="connect-btn"
        >
          {owner ? 'Connected' : 'Connect Wallet'}
        </button>
        <button onClick={handleAuthentication} className="connect-btn" disabled={loading || !owner}>
          {isAuthenticated ? 'Authenticated' : 'Authentication'}
        </button>
        {authStatus && <div className="request-error">{authStatus}</div>}

        <div className="form-group">
          <label>
            Recipient Address:
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              disabled={loading}
            />
          </label>
        </div>
        <div className="form-group">
          <label>
            Amount (USDT):
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.3"
              disabled={loading}
            />
          </label>
        </div>
        <button
          onClick={handleTransfer}
          disabled={loading}
          className={loading ? 'loading' : ''}
        >
          {loading ? 'Transferring...' : 'Transfer'}
        </button>
      </div>

      {status === 'success' && (
        <div className="success-card">
          <h2>Transfer Successful!</h2>
          <div className="info-row">
            <span className="label">Transaction Hash:</span>
            <span className="value hash">{txHash}</span>
          </div>
          <div className="info-row">
            <span className="label">UserOp Hash:</span>
            <span className="value hash">{userOpHash}</span>
          </div>
          <div className="balance-update">
            <h3>Post-transfer Balance</h3>
            <div className="info-row">
              <span className="label">{aaWallet || 'AA Address'}:</span>
              <span className="value">{senderBalance} USDT</span>
            </div>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="error-card">
          <h2>Transfer failed</h2>
        </div>
      )}

      {status === 'error' && (
        <div className="error-card">
          <h2>An error occurred</h2>
        </div>
      )}
    </div>
  );
}

export default Transfer;


