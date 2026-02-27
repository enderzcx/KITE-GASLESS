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
const BACKEND_SIGNER_KEY = process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const IMPLEMENTATION_SLOT =
  '0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC';
const EXPECTED_IMPLEMENTATION = ethers.getAddress(
  String(process.env.KITE_AA_EXPECTED_IMPLEMENTATION || '0xD0dA36a3B402160901dC03a0B9B9f88D6cffA7b6')
);
const EXPECTED_VERSION = String(
  process.env.KITE_AA_REQUIRED_VERSION || 'GokiteAccountV2-session-userop'
).trim();

function parseArg(name) {
  const idx = process.argv.findIndex((item) => item === `--${name}`);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '').trim();
}

function readRuntimeOwner() {
  try {
    const runtimePath = path.resolve(backendDir, 'data', 'session_runtime.json');
    const raw = fs.readFileSync(runtimePath, 'utf8');
    const data = JSON.parse(raw || '{}');
    return String(data?.owner || '').trim();
  } catch {
    return '';
  }
}

function slotToAddress(slotValue) {
  if (!slotValue || slotValue === '0x') return ethers.ZeroAddress;
  const hex = slotValue.toString().slice(2).padStart(64, '0');
  return ethers.getAddress(`0x${hex.slice(24)}`);
}

async function assertUpgradedImplementation(provider, proxyAddress) {
  const implRaw = await provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT);
  const implementation = slotToAddress(implRaw);
  console.log(`implementation: ${implementation}`);
  if (implementation !== EXPECTED_IMPLEMENTATION) {
    throw new Error(
      `AA implementation mismatch. expected=${EXPECTED_IMPLEMENTATION}, actual=${implementation}`
    );
  }
}

async function assertAccountVersion(provider, proxyAddress) {
  const c = new ethers.Contract(proxyAddress, ['function version() view returns (string)'], provider);
  const version = String(await c.version()).trim();
  console.log(`version: ${version}`);
  if (version !== EXPECTED_VERSION) {
    throw new Error(`AA version mismatch. expected=${EXPECTED_VERSION}, actual=${version || 'unknown'}`);
  }
}

async function main() {
  const owner =
    parseArg('owner') ||
    String(process.env.KITECLAW_OWNER_ADDRESS || '').trim() ||
    readRuntimeOwner();
  const saltArg = parseArg('salt') || String(process.env.KITECLAW_AA_SALT || '0').trim();
  const salt = BigInt(saltArg || '0');

  if (!owner || !ethers.isAddress(owner)) {
    throw new Error(
      'Missing valid owner address. Provide --owner 0x... or set KITECLAW_OWNER_ADDRESS in backend/.env.'
    );
  }
  if (!BACKEND_SIGNER_KEY) {
    throw new Error('Missing KITECLAW_BACKEND_SIGNER_PRIVATE_KEY in backend/.env.');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const signer = new ethers.Wallet(BACKEND_SIGNER_KEY, provider);
  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: RPC_URL,
    bundlerUrl: BUNDLER_URL,
    entryPointAddress: ENTRYPOINT
  });

  const accountAddress = sdk.getAccountAddress(owner, salt);
  const code = await provider.getCode(accountAddress);
  const isDeployed = Boolean(code && code !== '0x');

  console.log(`chainId: ${network.chainId}`);
  console.log(`factory: ${sdk.config.accountFactoryAddress}`);
  console.log(`owner: ${owner}`);
  console.log(`salt: ${salt.toString()}`);
  console.log(`predictedAA: ${accountAddress}`);
  console.log(`deployed: ${isDeployed}`);

  if (isDeployed) {
    await assertUpgradedImplementation(provider, accountAddress);
    await assertAccountVersion(provider, accountAddress);
    console.log('AA account already deployed. No action needed.');
    return;
  }

  const factory = new ethers.Contract(
    sdk.config.accountFactoryAddress,
    ['function createAccount(address owner, uint256 salt) returns (address)'],
    signer
  );
  const tx = await factory.createAccount(owner, salt);
  console.log(`createAccount tx: ${tx.hash}`);
  await tx.wait();

  const codeAfter = await provider.getCode(accountAddress);
  if (!codeAfter || codeAfter === '0x') {
    throw new Error('createAccount tx confirmed, but no code found at predicted AA address.');
  }
  await assertUpgradedImplementation(provider, accountAddress);
  await assertAccountVersion(provider, accountAddress);
  console.log('AA account deployed successfully.');
}

main().catch((error) => {
  console.error('[aa-ensure-account] failed:', error.message);
  process.exit(1);
});
