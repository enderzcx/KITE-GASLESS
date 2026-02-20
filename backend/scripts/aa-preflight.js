import 'dotenv/config';
import { ethers } from 'ethers';

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const AA_PROXY = process.env.KITECLAW_AA_PROXY || process.env.KITECLAW_AA_ADDRESS || '';

const IMPLEMENTATION_SLOT =
  '0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC';
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

const BASIC_ABI = [
  'function owner() view returns (address)',
  'function UPGRADE_INTERFACE_VERSION() view returns (string)',
  'function proxiableUUID() view returns (bytes32)'
];

function slotToAddress(slotValue) {
  if (!slotValue || slotValue === '0x') return '0x0000000000000000000000000000000000000000';
  const hex = slotValue.toString().slice(2).padStart(64, '0');
  return ethers.getAddress(`0x${hex.slice(24)}`);
}

async function safeCall(contract, fn) {
  try {
    const value = await contract[fn]();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function main() {
  if (!AA_PROXY || !ethers.isAddress(AA_PROXY)) {
    throw new Error('Set KITECLAW_AA_PROXY (or KITECLAW_AA_ADDRESS) to a valid proxy address.');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const proxyCode = await provider.getCode(AA_PROXY);
  if (!proxyCode || proxyCode === '0x') {
    throw new Error(`No code at proxy address: ${AA_PROXY}`);
  }

  const [implRaw, adminRaw] = await Promise.all([
    provider.getStorage(AA_PROXY, IMPLEMENTATION_SLOT),
    provider.getStorage(AA_PROXY, ADMIN_SLOT)
  ]);

  const implementation = slotToAddress(implRaw);
  const admin = slotToAddress(adminRaw);
  const contract = new ethers.Contract(AA_PROXY, BASIC_ABI, provider);
  const owner = await safeCall(contract, 'owner');
  const upgradeInterfaceVersion = await safeCall(contract, 'UPGRADE_INTERFACE_VERSION');
  const proxiableUUID = await safeCall(contract, 'proxiableUUID');

  const result = {
    rpcUrl: RPC_URL,
    proxy: AA_PROXY,
    implementation,
    adminSlotAddress: admin,
    owner,
    upgradeInterfaceVersion,
    proxiableUUID,
    likelyUUPS:
      upgradeInterfaceVersion.ok || proxiableUUID.ok
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[aa-preflight] failed:', error.message);
  process.exit(1);
});

