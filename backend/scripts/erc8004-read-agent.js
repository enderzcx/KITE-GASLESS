import { ethers } from 'ethers';

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
const AGENT_ID = process.env.ERC8004_AGENT_ID || '';

const ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function getMetadataByName(uint256 tokenId, string memory key) view returns (string memory)'
];

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('ERC8004_IDENTITY_REGISTRY', IDENTITY_REGISTRY);
  requireEnv('ERC8004_AGENT_ID', AGENT_ID);
  if (!ethers.isAddress(IDENTITY_REGISTRY)) {
    throw new Error(`Invalid ERC8004_IDENTITY_REGISTRY: ${IDENTITY_REGISTRY}`);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const contract = new ethers.Contract(IDENTITY_REGISTRY, ABI, provider);

  const owner = await contract.ownerOf(AGENT_ID);
  const tokenURI = await contract.tokenURI(AGENT_ID);
  let agentWallet = '';
  let agentRegistry = '';
  try {
    agentWallet = await contract.getAgentWallet(AGENT_ID);
  } catch {
    agentWallet = '(getAgentWallet call failed)';
  }
  try {
    agentRegistry = await contract.getMetadataByName(AGENT_ID, 'agentRegistry');
  } catch {
    agentRegistry = '(getMetadataByName call failed)';
  }

  console.log(`RPC: ${RPC_URL}`);
  console.log(`ChainId: ${network.chainId}`);
  console.log(`IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`AgentId: ${AGENT_ID}`);
  console.log('----- ERC-8004 AGENT PROFILE -----');
  console.log(`owner: ${owner}`);
  console.log(`tokenURI: ${tokenURI}`);
  console.log(`agentWallet: ${agentWallet}`);
  console.log(`agentRegistry(metadata): ${agentRegistry}`);
}

main().catch((error) => {
  console.error('ERC-8004 read failed:', error.message);
  process.exit(1);
});
