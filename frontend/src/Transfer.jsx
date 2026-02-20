import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { GokiteAASDK } from './gokite-aa-sdk';
import './App.css';
import {
  fetchX402ByTxHash,
  loadIdentityProfile,
  logRecord,
  requestPaidAction
} from './transfer/api';
import {
  getServiceProviderBytes32,
  precheckSession,
  resolveSessionSigner
} from './transfer/services/sessionService';
import { pollOnChainConfirmation } from './transfer/services/confirmationService';
import TransferTopNav from './transfer/components/TransferTopNav';
import TransferFormPanel from './transfer/components/TransferFormPanel';
import ConfirmationPanel from './transfer/components/ConfirmationPanel';
import X402Panel from './transfer/components/X402Panel';
import SuccessPanel from './transfer/components/SuccessPanel';
import AccountInfoCard from './transfer/components/AccountInfoCard';
import IdentityCard from './transfer/components/IdentityCard';
import BalanceCard from './transfer/components/BalanceCard';

const SETTLEMENT_TOKEN =
  import.meta.env.VITE_KITEAI_SETTLEMENT_TOKEN ||
  import.meta.env.VITE_SETTLEMENT_TOKEN ||
  '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const TOKEN_DECIMALS = 18;
const AUTH_STORAGE_PREFIX = 'kiteclaw_auth_';
const SESSION_KEY_PRIV_STORAGE = 'kiteclaw_session_privkey';
const SESSION_TX_STORAGE = 'kiteclaw_session_tx_hash';
const SESSION_ID_STORAGE = 'kiteclaw_session_id';
const GOLDSKY_ENDPOINT =
  import.meta.env.VITE_KITECLAW_GOLDSKY_ENDPOINT ||
  'https://api.goldsky.com/api/public/project_cmlrmfrtks90001wg8goma8pv/subgraphs/kk/1.0.1/gn';

function Transfer({
  onBack,
  walletState,
  onOpenVault,
  onOpenAgentSettings,
  onOpenRecords,
  onOpenOnChain,
  onOpenAbuseCases
}) {
  const [aaWallet, setAAWallet] = useState(walletState?.aaAddress || '');
  const [owner, setOwner] = useState(walletState?.ownerAddress || '');
  const [actionType, setActionType] = useState('kol-score');
  const [queryText, setQueryText] = useState('KOL score report for AI payment campaign');
  const [reactiveSymbol, setReactiveSymbol] = useState('BTC-USDT');
  const [reactiveTakeProfit, setReactiveTakeProfit] = useState('70000');
  const [reactiveStopLoss, setReactiveStopLoss] = useState('62000');
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
  const [x402Challenge, setX402Challenge] = useState(null);
  const [paidResult, setPaidResult] = useState(null);
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
        const profile = await loadIdentityProfile();
        setIdentity(profile);
        setIdentityError('');
      } catch (error) {
        setIdentity(null);
        setIdentityError(error.message || 'identity load failed');
      }
    };
    loadIdentity();
  }, []);

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
      const item = await fetchX402ByTxHash(hash);
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

  const handleRequestPaymentInfo = async () => {
    try {
      setLoading(true);
      setStatus('');
      const ownerAddress = walletState?.ownerAddress || owner || '';
      if (!ownerAddress) {
        throw new Error('Please connect wallet first.');
      }
      await sdk.verifyFactory();
      if (!isAuthenticated) {
        throw new Error('Please complete Authentication once before requesting payment info.');
      }
      const derivedAA = sdk.ensureAccountAddress(ownerAddress);
      const lifecycle = await sdk.getAccountLifecycle(ownerAddress);
      if (derivedAA !== aaWallet) {
        setAAWallet(derivedAA);
      }
      if (!lifecycle.deployed) {
        setAuthStatus('AA not deployed yet: first payment will auto-deploy AA via factory initCode.');
      } else {
        setAuthStatus('AA already deployed: payment will use existing account.');
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
      const normalizedQuery = String(queryText || '').trim() || 'KOL score report for AI payment campaign';
      const actionParams =
        actionType === 'reactive-stop-orders'
          ? {
              symbol: String(reactiveSymbol || '').trim().toUpperCase(),
              takeProfit: Number(reactiveTakeProfit),
              stopLoss: Number(reactiveStopLoss)
            }
          : undefined;
      if (actionType === 'reactive-stop-orders') {
        if (!actionParams.symbol) {
          throw new Error('Reactive action requires symbol.');
        }
        if (!Number.isFinite(actionParams.takeProfit) || actionParams.takeProfit <= 0) {
          throw new Error('Reactive action requires valid takeProfit.');
        }
        if (!Number.isFinite(actionParams.stopLoss) || actionParams.stopLoss <= 0) {
          throw new Error('Reactive action requires valid stopLoss.');
        }
      }
      const firstTry = await requestPaidAction({
        payer: derivedAA,
        query: normalizedQuery,
        action: actionType,
        actionParams,
        identity
      });
      if (firstTry.status !== 402) {
        throw new Error(`Expected 402 challenge, got ${firstTry.status}`);
      }
      const challenge = firstTry.body?.x402;
      const payInfo = challenge?.accepts?.[0];
      if (!challenge?.requestId || !payInfo) {
        throw new Error('Invalid x402 challenge for transfer intent.');
      }

      setX402Challenge({
        requestId: challenge.requestId,
        payer: derivedAA,
        recipient: payInfo.recipient,
        amount: String(payInfo.amount),
        tokenAddress: payInfo.tokenAddress || SETTLEMENT_TOKEN,
        decimals: payInfo.decimals ?? TOKEN_DECIMALS,
        query: normalizedQuery,
        actionType,
        actionParams
      });

      setConfirmState({
        stage: 'challenge_ready',
        message: 'x402 challenge ready. Click "Pay & Submit Proof" to continue.',
        txHash: '',
        blockNumber: '',
        from: '',
        to: '',
        valueRaw: '',
        match: null
      });
      setStatus('challenge_ready');
    } catch (error) {
      setStatus('error');
      setX402Challenge(null);
      setConfirmState({
        stage: 'failed',
        message: `Request payment info error: ${error.message}`,
        txHash: '',
        blockNumber: '',
        from: '',
        to: '',
        valueRaw: '',
        match: false
      });
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePayAndSubmitProof = async () => {
    if (!x402Challenge) {
      alert('Please request payment info first.');
      return;
    }
    const sessionTxHash = localStorage.getItem(SESSION_TX_STORAGE) || '';
    const sessionId = localStorage.getItem(SESSION_ID_STORAGE) || '';
    if (!sessionTxHash) {
      alert('Session setup not verified. Go to Agent Payment Settings and create/verify session first.');
      return;
    }
    if (!sessionId || !/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
      alert('Session ID missing or invalid. Regenerate session in Agent Payment Settings.');
      return;
    }

    try {
      setLoading(true);
      setStatus('');
      const { signer, ownerAddress, mode } = await resolveSessionSigner({
        rpcUrl,
        sessionPrivateKey: localStorage.getItem(SESSION_KEY_PRIV_STORAGE) || '',
        ownerAddress: walletState?.ownerAddress || owner || '',
        allowSessionKey: true
      });
      const derivedAA = sdk.ensureAccountAddress(ownerAddress);
      if (derivedAA !== aaWallet) {
        setAAWallet(derivedAA);
      }

      const balance = await sdk.getERC20Balance(SETTLEMENT_TOKEN);
      setSenderBalance(ethers.formatUnits(balance, TOKEN_DECIMALS));

      const signFunction = async (userOpHash) => {
        return signer.signMessage(ethers.getBytes(userOpHash));
      };
      setAuthStatus('Authenticated: using session key signer (no wallet popup).');

      setConfirmState({
        stage: 'x402_payment',
        message: 'Paying x402 challenge on-chain...',
        txHash: '',
        blockNumber: '',
        from: '',
        to: '',
        valueRaw: '',
        match: null
      });

      const amountRaw = ethers.parseUnits(String(x402Challenge.amount), x402Challenge.decimals);
      const sessionSignerAddress = await signer.getAddress();
      const nowSec = Math.floor(Date.now() / 1000);
      const serviceProvider = getServiceProviderBytes32(x402Challenge.actionType);
      await precheckSession({
        rpcUrl,
        accountAddress: derivedAA,
        sessionId,
        sessionSignerAddress,
        amountRaw,
        serviceProvider
      });
      const authPayload = {
        from: derivedAA,
        to: x402Challenge.recipient,
        token: x402Challenge.tokenAddress,
        value: amountRaw,
        validAfter: BigInt(Math.max(0, nowSec - 30)),
        validBefore: BigInt(nowSec + 10 * 60),
        nonce: ethers.hexlify(ethers.randomBytes(32))
      };
      const authSignature = await sdk.buildTransferAuthorizationSignature(signer, authPayload);
      const metadata = ethers.hexlify(
        ethers.toUtf8Bytes(
          JSON.stringify({
            requestId: x402Challenge.requestId,
            action: x402Challenge.actionType,
            query: x402Challenge.query
          })
        )
      );

      const result = await sdk.sendSessionTransferWithAuthorizationAndProvider(
        {
          sessionId,
          auth: authPayload,
          authSignature,
          serviceProvider,
          metadata
        },
        signFunction,
        {
          callGasLimit: 320000n,
          verificationGasLimit: 450000n,
          preVerificationGas: 120000n
        }
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
          type: 'x402ActionPayment',
          amount: x402Challenge.amount,
          token: x402Challenge.tokenAddress,
          recipient: x402Challenge.recipient,
          txHash: result.transactionHash,
          status: 'success',
          requestId: x402Challenge.requestId,
          signerMode: mode
        });

        setConfirmState((prev) => ({
          ...prev,
          stage: 'x402_verify',
          message: 'Submitting payment proof for x402 verification...'
        }));
        const paymentProof = {
          requestId: x402Challenge.requestId,
          txHash: result.transactionHash,
          payer: x402Challenge.payer,
          tokenAddress: x402Challenge.tokenAddress,
          recipient: x402Challenge.recipient,
          amount: x402Challenge.amount
        };
        const secondTry = await requestPaidAction({
          payer: x402Challenge.payer,
          query: x402Challenge.query,
          action: x402Challenge.actionType,
          requestId: x402Challenge.requestId,
          paymentProof,
          actionParams: x402Challenge.actionParams,
          identity
        });
        if (secondTry.status !== 200 || !secondTry.body?.ok) {
          throw new Error(secondTry.body?.reason || `x402 verification failed: ${secondTry.status}`);
        }
        setPaidResult({
          action: x402Challenge.actionType,
          summary: secondTry.body?.result?.summary || 'Paid action unlocked',
          topKOLs: secondTry.body?.result?.topKOLs || [],
          orderPlan: secondTry.body?.result?.orderPlan || null
        });

        void lookupX402ByTxHash(result.transactionHash);
        void pollOnChainConfirmation({
          endpoint: GOLDSKY_ENDPOINT,
          hash: result.transactionHash,
          expectedTo: x402Challenge.recipient,
          expectedAmount: x402Challenge.amount,
          tokenDecimals: TOKEN_DECIMALS,
          onState: setConfirmState
        });
        setX402Challenge(null);
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
          type: 'x402ActionPayment',
          amount: x402Challenge.amount,
          token: SETTLEMENT_TOKEN,
          recipient: x402Challenge.recipient,
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
        type: 'x402ActionPayment',
        amount: x402Challenge?.amount || '',
        token: SETTLEMENT_TOKEN,
        recipient: x402Challenge?.recipient || '',
        txHash: '',
        status: 'error'
      });
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const clearChallenge = () => {
    if (x402Challenge) {
      setX402Challenge(null);
      setConfirmState({
        stage: 'idle',
        message: 'Challenge cleared. Request payment info again.',
        txHash: '',
        blockNumber: '',
        from: '',
        to: '',
        valueRaw: '',
        match: null
      });
    }
  };

  return (
    <div className="transfer-container">
      <TransferTopNav
        onBack={onBack}
        onOpenVault={onOpenVault}
        onOpenAgentSettings={onOpenAgentSettings}
        onOpenRecords={onOpenRecords}
        onOpenOnChain={onOpenOnChain}
        onOpenAbuseCases={onOpenAbuseCases}
      />

      <h1>Gokite Account Abstraction</h1>

      <AccountInfoCard aaWallet={aaWallet} owner={owner} actionType={actionType} />
      <IdentityCard identity={identity} identityError={identityError} />
      <BalanceCard aaWallet={aaWallet} senderBalance={senderBalance} />

      <div className="transfer-layout">
        <TransferFormPanel
          owner={owner}
          loading={loading}
          isAuthenticated={isAuthenticated}
          authStatus={authStatus}
          actionType={actionType}
          queryText={queryText}
          reactiveSymbol={reactiveSymbol}
          reactiveTakeProfit={reactiveTakeProfit}
          reactiveStopLoss={reactiveStopLoss}
          x402Challenge={x402Challenge}
          onConnect={handleConnectWallet}
          onAuthenticate={handleAuthentication}
          onActionChange={(value) => {
            setActionType(value);
            clearChallenge();
          }}
          onQueryChange={(value) => {
            setQueryText(value);
            clearChallenge();
          }}
          onReactiveSymbolChange={(value) => {
            setReactiveSymbol(value);
            clearChallenge();
          }}
          onReactiveTakeProfitChange={(value) => {
            setReactiveTakeProfit(value);
            clearChallenge();
          }}
          onReactiveStopLossChange={(value) => {
            setReactiveStopLoss(value);
            clearChallenge();
          }}
          onRequest402={handleRequestPaymentInfo}
          onPayAndSubmit={handlePayAndSubmitProof}
        />
        <ConfirmationPanel confirmState={confirmState} />
      </div>

      <X402Panel x402Lookup={x402Lookup} x402Challenge={x402Challenge} />
      <SuccessPanel
        status={status}
        txHash={txHash}
        userOpHash={userOpHash}
        paidResult={paidResult}
        aaWallet={aaWallet}
        senderBalance={senderBalance}
      />

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




