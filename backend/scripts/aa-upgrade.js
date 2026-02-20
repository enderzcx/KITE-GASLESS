import 'dotenv/config';
import { ethers } from 'ethers';

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const AA_PROXY = process.env.KITECLAW_AA_PROXY || process.env.KITECLAW_AA_ADDRESS || '';
const NEW_IMPLEMENTATION = process.env.KITECLAW_AA_NEW_IMPLEMENTATION || '';
const CALLDATA = process.env.KITECLAW_AA_UPGRADE_CALLDATA || '0x';

const UPGRADE_ABI = [
  'function owner() view returns (address)',
  'function upgradeToAndCall(address newImplementation, bytes data) payable'
];

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('Missing PRIVATE_KEY (or KITECLAW_BACKEND_SIGNER_PRIVATE_KEY).');
  }
  if (!AA_PROXY || !ethers.isAddress(AA_PROXY)) {
    throw new Error('Set KITECLAW_AA_PROXY (or KITECLAW_AA_ADDRESS) to a valid address.');
  }
  if (!NEW_IMPLEMENTATION || !ethers.isAddress(NEW_IMPLEMENTATION)) {
    throw new Error('Set KITECLAW_AA_NEW_IMPLEMENTATION to a valid implementation address.');
  }
  if (!/^0x([0-9a-fA-F]{2})*$/.test(CALLDATA)) {
    throw new Error('KITECLAW_AA_UPGRADE_CALLDATA must be valid hex bytes.');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const account = new ethers.Contract(AA_PROXY, UPGRADE_ABI, signer);
  const owner = await account.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not owner. owner=${owner}, signer=${signer.address}`);
  }

  console.log('[aa-upgrade] proxy:', AA_PROXY);
  console.log('[aa-upgrade] new implementation:', NEW_IMPLEMENTATION);
  console.log('[aa-upgrade] signer:', signer.address);
  console.log('[aa-upgrade] calldata:', CALLDATA);

  const tx = await account.upgradeToAndCall(NEW_IMPLEMENTATION, CALLDATA);
  console.log('[aa-upgrade] tx submitted:', tx.hash);
  const receipt = await tx.wait();
  console.log('[aa-upgrade] confirmed in block:', receipt.blockNumber);
}

main().catch((error) => {
  console.error('[aa-upgrade] failed:', error.message);
  process.exit(1);
});

