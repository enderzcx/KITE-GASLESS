import { config as loadEnv } from 'dotenv';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GokiteAASDK } from '../../frontend/src/gokite-aa-sdk.js';

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
  console.log('AA account deployed successfully.');
}

main().catch((error) => {
  console.error('[aa-ensure-account] failed:', error.message);
  process.exit(1);
});
