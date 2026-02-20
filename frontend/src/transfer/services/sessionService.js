import { ethers } from 'ethers';

const SESSION_READ_ABI = [
  'function sessionExists(bytes32 sessionId) view returns (bool)',
  'function getSessionAgent(bytes32 sessionId) view returns (address)',
  'function checkSpendingRules(bytes32 sessionId, uint256 normalizedAmount, bytes32 serviceProvider) view returns (bool)'
];

export function getServiceProviderBytes32(action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (normalized === 'reactive-stop-orders') {
    return ethers.encodeBytes32String('reactive-stop-orders');
  }
  return ethers.encodeBytes32String('kol-score');
}

export async function resolveSessionSigner({ rpcUrl, sessionPrivateKey, ownerAddress, allowSessionKey = true }) {
  const sessionPrivKey = String(sessionPrivateKey || '').trim();

  if (allowSessionKey && sessionPrivKey) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(sessionPrivKey, provider);
    if (!ownerAddress) {
      throw new Error('Session key found but owner address is missing. Connect wallet first.');
    }
    return { signer, ownerAddress, mode: 'session_key' };
  }

  throw new Error(
    'No session key found. Please go to Agent Payment Settings and click "Generate Session Key & Apply Rules" first.'
  );
}

export async function precheckSession({
  rpcUrl,
  accountAddress,
  sessionId,
  sessionSignerAddress,
  amountRaw,
  serviceProvider
}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const account = new ethers.Contract(accountAddress, SESSION_READ_ABI, provider);
  const [exists, agentAddr, rulePass] = await Promise.all([
    account.sessionExists(sessionId),
    account.getSessionAgent(sessionId),
    account.checkSpendingRules(sessionId, amountRaw, serviceProvider)
  ]);

  if (!exists) {
    throw new Error(`Session not found on-chain: ${sessionId}`);
  }
  if (String(agentAddr || '').toLowerCase() !== String(sessionSignerAddress || '').toLowerCase()) {
    throw new Error(
      `Session agent mismatch. on-chain=${agentAddr}, current_session_signer=${sessionSignerAddress}`
    );
  }
  if (!rulePass) {
    throw new Error('Session spending rule precheck failed (amount/provider out of scope).');
  }
}
