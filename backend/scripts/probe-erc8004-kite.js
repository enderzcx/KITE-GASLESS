import { ethers } from 'ethers';

const KITE_RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const KITE_CHAIN_ID = 2368;

// Identity Registry deterministic addresses from erc-8004-contracts README.
// Mainnet and Sepolia are listed there; on unsupported chains these usually have no code.
const OFFICIAL_IDENTITY_REGISTRY_ADDRESSES = [
  { network: 'ethereum-mainnet', address: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
  { network: 'sepolia', address: '0x8004A818b30DF2b6fBa1f59d9EdA2A215e674ecD' }
];

const IDENTITY_REGISTRY_ABI = [
  'function registerFee() view returns (uint256)',
  'function metadataUpdateFee() view returns (uint256)'
];

async function probeAddress(provider, label, address) {
  const code = await provider.getCode(address);
  const hasCode = code && code !== '0x';
  const result = {
    label,
    address,
    hasCode,
    registerFee: 'n/a',
    metadataUpdateFee: 'n/a'
  };

  if (!hasCode) return result;

  try {
    const contract = new ethers.Contract(address, IDENTITY_REGISTRY_ABI, provider);
    const regFee = await contract.registerFee();
    result.registerFee = regFee.toString();
  } catch {
    result.registerFee = 'call-failed';
  }

  try {
    const contract = new ethers.Contract(address, IDENTITY_REGISTRY_ABI, provider);
    const updateFee = await contract.metadataUpdateFee();
    result.metadataUpdateFee = updateFee.toString();
  } catch {
    result.metadataUpdateFee = 'call-failed';
  }

  return result;
}

function printRow(row) {
  const { label, address, hasCode, registerFee, metadataUpdateFee } = row;
  console.log(
    `${label.padEnd(22)} | ${address} | code=${String(hasCode).padEnd(5)} | registerFee=${String(
      registerFee
    ).padEnd(12)} | metadataUpdateFee=${metadataUpdateFee}`
  );
}

function toSafeAddress(address) {
  try {
    return ethers.getAddress(String(address).toLowerCase());
  } catch {
    return '';
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(KITE_RPC_URL);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`RPC: ${KITE_RPC_URL}`);
  console.log(`Connected chainId: ${chainId}`);
  if (chainId !== KITE_CHAIN_ID) {
    console.warn(`Warning: expected Kite Testnet chainId ${KITE_CHAIN_ID}, but got ${chainId}.`);
  }

  const customIdentityRegistry = toSafeAddress(process.env.ERC8004_IDENTITY_REGISTRY || '');
  const candidates = OFFICIAL_IDENTITY_REGISTRY_ADDRESSES.map((item) => ({
    network: item.network,
    address: toSafeAddress(item.address)
  })).filter((item) => item.address);
  if (customIdentityRegistry) {
    candidates.unshift({ network: 'custom-env', address: customIdentityRegistry });
  }

  console.log('\nProbing ERC-8004 Identity Registry candidates on current RPC...\n');
  console.log(
    'source-network'.padEnd(22) +
      ' | address'.padEnd(44) +
      ' | code  | registerFee   | metadataUpdateFee'
  );
  console.log('-'.repeat(120));

  let found = 0;
  for (const item of candidates) {
    const row = await probeAddress(provider, item.network, item.address);
    if (row.hasCode) found += 1;
    printRow(row);
  }

  console.log('\nSummary:');
  if (found === 0) {
    console.log(
      '- No candidate Identity Registry code found on this RPC.\n' +
        '- Inference: Kite Testnet likely does not host these official ERC-8004 registry addresses.\n' +
        '- Next: deploy ERC-8004 registries on Kite Testnet, or use an existing deployment address from your infra.'
    );
  } else {
    console.log(`- Found ${found} candidate address(es) with contract code. Verify ABI/ownership before using.`);
  }
}

main().catch((error) => {
  console.error('Probe failed:', error.message);
  process.exit(1);
});
