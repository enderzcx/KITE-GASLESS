import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GokiteAASDK } from '../lib/gokite-aa-sdk.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
loadEnv({ path: path.resolve(backendDir, '.env') });

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const BUNDLER_URL =
  process.env.KITEAI_BUNDLER_URL || 'https://bundler-service.staging.gokite.ai/rpc/';
const ENTRYPOINT =
  process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const SESSION_RUNTIME_PATH = path.resolve(backendDir, 'data', 'session_runtime.json');

const SETTLEMENT_TOKEN = String(
  process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63'
).trim();
const GATEWAY_RECIPIENT = String(
  process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29'
).trim();
const REQUIRED_AA_VERSION = String(
  process.env.KITE_AA_REQUIRED_VERSION || 'GokiteAccountV2-session-userop'
).trim();

function parseArg(name) {
  const idx = process.argv.findIndex((item) => item === `--${name}`);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '').trim();
}

function normalizePrivateKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

function readJsonObject(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeJsonObject(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function main() {
  const singleLimit = parseArg('singleLimit') || '5';
  const dailyLimit = parseArg('dailyLimit') || '50';
  const tokenAddress = parseArg('token') || SETTLEMENT_TOKEN;
  const gatewayRecipient = parseArg('gatewayRecipient') || GATEWAY_RECIPIENT;

  const ownerKey =
    normalizePrivateKey(parseArg('ownerKey')) ||
    normalizePrivateKey(process.env.XMTP_ROUTER_WALLET_KEY || '');
  if (!ownerKey) {
    throw new Error('Missing owner key. Set XMTP_ROUTER_WALLET_KEY or pass --ownerKey.');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const ownerWallet = new ethers.Wallet(ownerKey, provider);
  const ownerAddress = await ownerWallet.getAddress();

  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: ENTRYPOINT
  });

  const salt = BigInt(String(process.env.KITECLAW_AA_SALT || '0').trim() || '0');
  const aaWallet = sdk.ensureAccountAddress(ownerAddress, salt);
  const code = await provider.getCode(aaWallet);
  if (!code || code === '0x') {
    throw new Error(`AA wallet not deployed: ${aaWallet}. Run npm run aa:ensure first.`);
  }
  const versionContract = new ethers.Contract(
    aaWallet,
    ['function version() view returns (string)'],
    provider
  );
  let version = '';
  try {
    version = String(await versionContract.version()).trim();
  } catch {
    version = '';
  }
  if (version !== REQUIRED_AA_VERSION) {
    throw new Error(
      `AA version mismatch. required=${REQUIRED_AA_VERSION}, current=${version || 'unknown_or_legacy'}. Run aa-upgrade first.`
    );
  }

  const account = new ethers.Contract(
    aaWallet,
    [
      'function addSupportedToken(address token) external',
      'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
      'function sessionExists(bytes32 sessionId) view returns (bool)',
      'function getSessionAgent(bytes32 sessionId) view returns (address)'
    ],
    ownerWallet
  );

  if (!ethers.isAddress(tokenAddress)) {
    throw new Error(`Invalid token address: ${tokenAddress}`);
  }
  if (!ethers.isAddress(gatewayRecipient)) {
    throw new Error(`Invalid gateway recipient: ${gatewayRecipient}`);
  }

  // addSupportedToken may revert if token already exists; ignore that case.
  try {
    const tokenTx = await account.addSupportedToken(tokenAddress);
    await tokenTx.wait();
    console.log(`addSupportedToken tx: ${tokenTx.hash}`);
  } catch (error) {
    console.log(`addSupportedToken skipped: ${String(error?.message || 'already configured')}`);
  }

  const latestBlock = await provider.getBlock('latest');
  const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
  const rules = [
    {
      timeWindow: 0n,
      budget: ethers.parseUnits(singleLimit, 18),
      initialWindowStartTime: 0,
      targetProviders: []
    },
    {
      timeWindow: 86400n,
      budget: ethers.parseUnits(dailyLimit, 18),
      initialWindowStartTime: Math.max(0, nowTs - 1),
      targetProviders: []
    }
  ];

  const sessionWallet = ethers.Wallet.createRandom();
  const sessionId = ethers.keccak256(
    ethers.toUtf8Bytes(`${sessionWallet.address}-${Date.now()}`)
  );
  const tx = await account.createSession(sessionId, sessionWallet.address, rules);
  await tx.wait();

  const [exists, onchainAgent] = await Promise.all([
    account.sessionExists(sessionId),
    account.getSessionAgent(sessionId)
  ]);
  if (!exists) {
    throw new Error(`Session not found on-chain after tx: ${sessionId}`);
  }
  if (String(onchainAgent || '').toLowerCase() !== String(sessionWallet.address).toLowerCase()) {
    throw new Error(
      `Session agent mismatch. onchain=${onchainAgent}, local=${sessionWallet.address}`
    );
  }

  const current = readJsonObject(SESSION_RUNTIME_PATH);
  const next = {
    ...current,
    aaWallet,
    owner: ownerAddress,
    sessionAddress: sessionWallet.address,
    sessionPrivateKey: sessionWallet.privateKey,
    sessionId,
    sessionTxHash: tx.hash,
    expiresAt: 0,
    maxPerTx: Number(singleLimit),
    dailyLimit: Number(dailyLimit),
    gatewayRecipient,
    source: 'cli-router-session',
    updatedAt: Date.now()
  };
  writeJsonObject(SESSION_RUNTIME_PATH, next);

  console.log(
    JSON.stringify(
      {
        ok: true,
        owner: ownerAddress,
        aaWallet,
        sessionAddress: sessionWallet.address,
        sessionId,
        sessionTxHash: tx.hash,
        singleLimit,
        dailyLimit,
        tokenAddress,
        gatewayRecipient
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[aa-create-router-session] failed:', error?.message || String(error));
  process.exit(1);
});
