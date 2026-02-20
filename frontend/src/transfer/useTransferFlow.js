import { ethers } from 'ethers';
import { requestPaidAction, logRecord } from './api';
import {
  getServiceProviderBytes32,
  precheckSession,
  resolveSessionSigner
} from './services/sessionService';
import { pollOnChainConfirmation } from './services/confirmationService';

export function useTransferFlow({
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
  constants
}) {
  const {
    SESSION_KEY_PRIV_STORAGE,
    SESSION_TX_STORAGE,
    SESSION_ID_STORAGE,
    TOKEN_DECIMALS,
    SETTLEMENT_TOKEN,
    GOLDSKY_ENDPOINT,
    rpcUrl
  } = constants;

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

      const signFunction = async (userOpHash) => signer.signMessage(ethers.getBytes(userOpHash));
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

  return {
    clearChallenge,
    handleRequestPaymentInfo,
    handlePayAndSubmitProof
  };
}
