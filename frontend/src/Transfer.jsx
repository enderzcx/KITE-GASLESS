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
const SESSION_KEY_PRIV_STORAGE = 'kiteclaw_session_privkey';
const GOLDSKY_ENDPOINT =
  import.meta.env.VITE_KITECLAW_GOLDSKY_ENDPOINT ||
  'https://api.goldsky.com/api/public/project_cmlrmfrtks90001wg8goma8pv/subgraphs/kk/1.0.1/gn';

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
  const [confirmState, setConfirmState] = useState({
    stage: 'idle',
    message: 'Waiting for transfer...',
    txHash: '',
    blockNumber: '',
    from: '',
    to: '',
    valueRaw: '',
    match: null
  });
  const [x402Lookup, setX402Lookup] = useState({
    loading: false,
    found: false,
    message: 'No x402 lookup yet.',
    item: null
  });
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
      } catch (error) {
        setIdentity(null);
        setIdentityError(error.message || 'identity load failed');
      }
    };
    loadIdentity();
  }, []);

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

  const lookupX402ByTxHash = async (hash) => {
    if (!hash) {
      setX402Lookup({
        loading: false,
        found: false,
        message: 'Missing tx hash.',
        item: null
      });
      return;
    }
    try {
      setX402Lookup({
        loading: true,
        found: false,
        message: 'Checking x402 mapping by tx hash...',
        item: null
      });
      const res = await fetch(`/api/x402/requests?txHash=${String(hash).toLowerCase()}&limit=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const item = Array.isArray(data?.items) ? data.items[0] : null;
      if (item) {
        setX402Lookup({
          loading: false,
          found: true,
          message: 'x402 mapping found for this tx hash.',
          item
        });
      } else {
        setX402Lookup({
          loading: false,
          found: false,
          message:
            'No x402 mapping found. This is likely a standard transfer (not a 402 paid-action flow).',
          item: null
        });
      }
    } catch (error) {
      setX402Lookup({
        loading: false,
        found: false,
        message: `x402 lookup failed: ${error.message}`,
        item: null
      });
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

    // Session key only signs userOpHash. AA owner remains root owner address.
    if (sessionPrivKey) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const sessionSigner = new ethers.Wallet(sessionPrivKey, provider);
      let ownerAddress = walletState?.ownerAddress || owner || '';
      if (!ownerAddress) {
        const signerInfo = await fetchBackendSignerInfo();
        ownerAddress = signerInfo?.address || '';
      }
      if (!ownerAddress) {
        throw new Error('Session key found but owner address is missing. Connect wallet once or configure backend signer.');
      }
      return { signer: sessionSigner, ownerAddress, mode: 'session_key' };
    }

    if (walletState?.ownerAddress && typeof window.ethereum !== 'undefined') {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      return { signer, ownerAddress: walletState.ownerAddress, mode: 'owner' };
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

  const requestX402TransferIntent = async ({ payer, recipientAddress, transferAmount, requestId, paymentProof }) => {
    const identityPayload = {
      agentId: identity?.configured?.agentId || '',
      identityRegistry: identity?.configured?.registry || ''
    };
    const res = await fetch('/api/x402/transfer-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payer,
        recipient: recipientAddress,
        amount: transferAmount,
        tokenAddress: SETTLEMENT_TOKEN,
        requestId,
        paymentProof,
        identity: identityPayload
      })
    });
    const body = await res.json();
    return { status: res.status, body };
  };

  const handleTransfer = async () => {
    if (!recipient || !amount) {
      alert('Please enter recipient address and amount.');
      return;
    }

    try {
      setLoading(true);
      setStatus('');
      const hasSessionSigner = Boolean(localStorage.getItem(SESSION_KEY_PRIV_STORAGE));
      if (!hasSessionSigner && (walletState?.ownerAddress || owner) && !isAuthenticated) {
        throw new Error('Please complete Authentication once before sending.');
      }

      const { signer, ownerAddress, mode } = await resolveSigner();
      const derivedAA = sdk.ensureAccountAddress(ownerAddress);
      if (derivedAA !== aaWallet) {
        setAAWallet(derivedAA);
      }

      const balance = await sdk.getERC20Balance(SETTLEMENT_TOKEN);
      setSenderBalance(ethers.formatUnits(balance, TOKEN_DECIMALS));

      const signFunction = async (userOpHash) => {
        if (mode === 'backend_signer') {
          return signer.signMessage(userOpHash);
        }
        return signer.signMessage(ethers.getBytes(userOpHash));
      };
      if (mode === 'session_key') {
        setAuthStatus('Using session key signer (no wallet popup expected).');
      }

      setConfirmState({
        stage: 'x402_challenge',
        message: 'Requesting x402 challenge (expecting 402)...',
        txHash: '',
        blockNumber: '',
        from: '',
        to: '',
        valueRaw: '',
        match: null
      });
      const firstTry = await requestX402TransferIntent({
        payer: derivedAA,
        recipientAddress: recipient,
        transferAmount: amount
      });
      if (firstTry.status !== 402) {
        throw new Error(`Expected 402 challenge, got ${firstTry.status}`);
      }
      const challenge = firstTry.body?.x402;
      const payInfo = challenge?.accepts?.[0];
      if (!challenge?.requestId || !payInfo) {
        throw new Error('Invalid x402 challenge for transfer intent.');
      }

      setConfirmState({
        stage: 'x402_payment',
        message: 'x402 challenge received. Paying on-chain...',
        txHash: '',
        blockNumber: '',
        from: '',
        to: '',
        valueRaw: '',
        match: null
      });
      const result = await sdk.sendERC20(
        {
          tokenAddress: payInfo.tokenAddress || SETTLEMENT_TOKEN,
          recipient: payInfo.recipient,
          amount: ethers.parseUnits(String(payInfo.amount), payInfo.decimals ?? TOKEN_DECIMALS)
        },
        signFunction
      );

      if (result.status === 'success') {
        setStatus('success');
        setTxHash(result.transactionHash);
        setUserOpHash(result.userOpHash);
        setConfirmState({
          stage: 'submitted',
          message: 'Transaction submitted. Waiting for on-chain confirmation...',
          txHash: result.transactionHash || '',
          blockNumber: '',
          from: '',
          to: '',
          valueRaw: '',
          match: null
        });

        const newBalance = await sdk.getERC20Balance(SETTLEMENT_TOKEN);
        setSenderBalance(ethers.formatUnits(newBalance, TOKEN_DECIMALS));

        await logRecord({
          type: 'x402Transfer',
          amount: String(payInfo.amount),
          token: payInfo.tokenAddress || SETTLEMENT_TOKEN,
          recipient: payInfo.recipient,
          txHash: result.transactionHash,
          status: 'success',
          requestId: challenge.requestId,
          signerMode: mode
        });

        setConfirmState((prev) => ({
          ...prev,
          stage: 'x402_verify',
          message: 'Submitting payment proof for x402 verification...'
        }));
        const paymentProof = {
          requestId: challenge.requestId,
          txHash: result.transactionHash,
          payer: derivedAA,
          tokenAddress: payInfo.tokenAddress || SETTLEMENT_TOKEN,
          recipient: payInfo.recipient,
          amount: String(payInfo.amount)
        };
        const secondTry = await requestX402TransferIntent({
          payer: derivedAA,
          recipientAddress: payInfo.recipient,
          transferAmount: String(payInfo.amount),
          requestId: challenge.requestId,
          paymentProof
        });
        if (secondTry.status !== 200 || !secondTry.body?.ok) {
          throw new Error(secondTry.body?.reason || `x402 verification failed: ${secondTry.status}`);
        }

        void lookupX402ByTxHash(result.transactionHash);
        void pollOnChainConfirmation(result.transactionHash, payInfo.recipient, String(payInfo.amount));
      } else {
        setStatus('failed');
        setConfirmState({
          stage: 'failed',
          message: `Transfer failed before on-chain confirmation: ${result.reason || 'unknown reason'}`,
          txHash: result.transactionHash || '',
          blockNumber: '',
          from: '',
          to: '',
          valueRaw: '',
          match: false
        });
        await logRecord({
          type: 'x402Transfer',
          amount,
          token: SETTLEMENT_TOKEN,
          recipient,
          txHash: result.transactionHash || '',
          status: 'failed',
          signerMode: mode
        });
        alert(`Transfer failed: ${result.reason}`);
      }
    } catch (error) {
      setStatus('error');
      setConfirmState({
        stage: 'failed',
        message: `Transfer request error: ${error.message}`,
        txHash: '',
        blockNumber: '',
        from: '',
        to: '',
        valueRaw: '',
        match: false
      });
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

  const pollOnChainConfirmation = async (hash, expectedTo, expectedAmount) => {
    const expectedToLc = (expectedTo || '').toLowerCase();
    let expectedRaw = '';
    try {
      expectedRaw = ethers.parseUnits(String(expectedAmount || '0'), TOKEN_DECIMALS).toString();
    } catch {
      expectedRaw = '';
    }

    for (let i = 0; i < 12; i += 1) {
      try {
        const query = `
          {
            transfers(
              first: 1,
              where: { transactionHash: "${String(hash || '').toLowerCase()}" },
              orderBy: blockTimestamp,
              orderDirection: desc
            ) {
              transactionHash
              blockNumber
              from
              to
              value
            }
          }
        `;
        const res = await fetch(GOLDSKY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        const json = await res.json();
        const row = json?.data?.transfers?.[0];

        if (row) {
          const isMatch =
            (!expectedToLc || String(row.to || '').toLowerCase() === expectedToLc) &&
            (!expectedRaw || String(row.value) === expectedRaw);
          setConfirmState({
            stage: 'confirmed',
            message: 'On-chain confirmation received.',
            txHash: row.transactionHash || hash,
            blockNumber: String(row.blockNumber || ''),
            from: row.from || '',
            to: row.to || '',
            valueRaw: String(row.value || ''),
            match: isMatch
          });
          return;
        }

        setConfirmState((prev) => ({
          ...prev,
          stage: 'indexing',
          message: `Indexing on-chain data... retry ${i + 1}/12`
        }));
      } catch {
        setConfirmState((prev) => ({
          ...prev,
          stage: 'indexing',
          message: `Querying Goldsky... retry ${i + 1}/12`
        }));
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    setConfirmState((prev) => ({
      ...prev,
      stage: 'timeout',
      message: 'Timed out waiting for indexed confirmation. You can verify by tx hash in On-chain page.'
    }));
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

      <div className="info-card">
        <h2>Verifiable Agent Identity</h2>
        {identityError && <div className="request-error">identity error: {identityError}</div>}
        {!identityError && !identity?.available && (
          <div className="info-row">
            <span className="label">Status:</span>
            <span className="value">not configured ({identity?.reason || 'unknown'})</span>
          </div>
        )}
        {identity?.available && (
          <>
            <div className="info-row">
              <span className="label">Agent ID:</span>
              <span className="value">{identity?.configured?.agentId || '-'}</span>
            </div>
            <div className="info-row">
              <span className="label">Registry:</span>
              <span className="value hash">{identity?.configured?.registry || '-'}</span>
            </div>
            <div className="info-row">
              <span className="label">Agent Wallet:</span>
              <span className="value hash">{identity?.agentWallet || '-'}</span>
            </div>
          </>
        )}
      </div>

      <div className="balance-card">
        <h2>Balance</h2>
        <div className="info-row">
          <span className="label">{aaWallet || 'AA Address'}:</span>
          <span className="value">{senderBalance} USDT</span>
        </div>
      </div>

      <div className="transfer-layout">
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

        <div className="transfer-card confirm-card">
          <h2>On-chain Confirmation</h2>
          <div className="result-row">
            <span className="label">Stage:</span>
            <span className="value">{confirmState.stage}</span>
          </div>
          <div className="result-row">
            <span className="label">Message:</span>
            <span className="value">{confirmState.message}</span>
          </div>
          <div className="result-row">
            <span className="label">Tx Hash:</span>
            <span className="value hash">{confirmState.txHash || '-'}</span>
          </div>
          <div className="result-row">
            <span className="label">Block:</span>
            <span className="value">{confirmState.blockNumber || '-'}</span>
          </div>
          <div className="result-row">
            <span className="label">From:</span>
            <span className="value hash">{confirmState.from || '-'}</span>
          </div>
          <div className="result-row">
            <span className="label">To:</span>
            <span className="value hash">{confirmState.to || '-'}</span>
          </div>
          <div className="result-row">
            <span className="label">Amount (raw):</span>
            <span className="value">{confirmState.valueRaw || '-'}</span>
          </div>
          <div className="result-row">
            <span className="label">Match:</span>
            <span className="value">
              {confirmState.match === null ? '-' : String(confirmState.match)}
            </span>
          </div>
        </div>
      </div>

      <div className="transfer-card x402-card">
        <h2>x402 Mapping</h2>
        <div className="result-row">
          <span className="label">Lookup:</span>
          <span className="value">{x402Lookup.loading ? 'loading' : x402Lookup.found ? 'found' : 'not found'}</span>
        </div>
        <div className="result-row">
          <span className="label">Message:</span>
          <span className="value">{x402Lookup.message}</span>
        </div>
        {x402Lookup.item && (
          <>
            <div className="result-row">
              <span className="label">Action:</span>
              <span className="value">{x402Lookup.item.action || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Request ID:</span>
              <span className="value hash">{x402Lookup.item.requestId || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Payer:</span>
              <span className="value hash">{x402Lookup.item.payer || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Status:</span>
              <span className="value">{x402Lookup.item.status || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Amount:</span>
              <span className="value">{x402Lookup.item.amount || '-'} USDT</span>
            </div>
            <div className="result-row">
              <span className="label">Payment Tx:</span>
              <span className="value hash">{x402Lookup.item.paymentTxHash || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Policy decision:</span>
              <span className="value">{x402Lookup.item?.policy?.decision || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Policy snapshot:</span>
              <span className="value hash">
                {x402Lookup.item?.policy?.snapshot
                  ? JSON.stringify(x402Lookup.item.policy.snapshot)
                  : '-'}
              </span>
            </div>
          </>
        )}
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



