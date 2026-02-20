import { useEffect, useState } from 'react';
import { GokiteAASDK } from './gokite-aa-sdk';
import './App.css';
import {
  fetchX402ByTxHash,
  loadIdentityProfile
} from './transfer/api';
import { useTransferFlow } from './transfer/useTransferFlow';
import { useTransferAuth } from './transfer/useTransferAuth';
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

  const { handleConnectWallet, handleAuthentication } = useTransferAuth({
    sdk,
    walletState,
    owner,
    setOwner,
    setAAWallet,
    setSenderBalance,
    setAuthStatus,
    setIsAuthenticated,
    constants: {
      AUTH_STORAGE_PREFIX,
      SETTLEMENT_TOKEN,
      TOKEN_DECIMALS
    }
  });

  const { clearChallenge, handleRequestPaymentInfo, handlePayAndSubmitProof } = useTransferFlow({
    sdk,
    walletState,
    owner,
    aaWallet,
    setAAWallet,
    isAuthenticated,
    identity,
    actionType,
    queryText,
    reactiveSymbol,
    reactiveTakeProfit,
    reactiveStopLoss,
    x402Challenge,
    setX402Challenge,
    setLoading,
    setStatus,
    setAuthStatus,
    setConfirmState,
    setSenderBalance,
    setTxHash,
    setUserOpHash,
    setPaidResult,
    lookupX402ByTxHash,
    constants: {
      SESSION_KEY_PRIV_STORAGE,
      SESSION_TX_STORAGE,
      SESSION_ID_STORAGE,
      TOKEN_DECIMALS,
      SETTLEMENT_TOKEN,
      GOLDSKY_ENDPOINT,
      rpcUrl
    }
  });

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




