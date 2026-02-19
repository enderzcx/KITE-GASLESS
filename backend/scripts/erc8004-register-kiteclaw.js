import { ethers } from 'ethers';

const RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
const AGENT_URI = process.env.ERC8004_AGENT_URI || '';
const PRIVATE_KEY =
  process.env.ERC8004_REGISTRAR_PRIVATE_KEY || process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';

const ABI = [
  'function registerFee() view returns (uint256)',
  'function register(string tokenURI) payable returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`);
}

async function main() {
  requireEnv('ERC8004_IDENTITY_REGISTRY', IDENTITY_REGISTRY);
  requireEnv('ERC8004_AGENT_URI', AGENT_URI);
  requireEnv('ERC8004_REGISTRAR_PRIVATE_KEY or KITECLAW_BACKEND_SIGNER_PRIVATE_KEY', PRIVATE_KEY);
  if (!ethers.isAddress(IDENTITY_REGISTRY)) {
    throw new Error(`Invalid ERC8004_IDENTITY_REGISTRY: ${IDENTITY_REGISTRY}`);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(IDENTITY_REGISTRY, ABI, wallet);

  console.log(`RPC: ${RPC_URL}`);
  console.log(`ChainId: ${network.chainId}`);
  console.log(`IdentityRegistry: ${IDENTITY_REGISTRY}`);
  console.log(`Registrar: ${wallet.address}`);
  console.log(`AgentURI: ${AGENT_URI}`);

  const code = await provider.getCode(IDENTITY_REGISTRY);
  if (!code || code === '0x') {
    throw new Error('Identity registry has no code on this network. Deploy registry first.');
  }

  let fee = 0n;
  try {
    fee = await contract.registerFee();
  } catch {
    fee = 0n;
  }
  console.log(`registerFee: ${fee.toString()}`);

  const tx = await contract.register(AGENT_URI, { value: fee });
  console.log(`register tx: ${tx.hash}`);
  const receipt = await tx.wait();

  const transferTopic = contract.interface.getEvent('Transfer').topicHash;
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
      log.topics?.[0] === transferTopic
  );
  if (!transferLog) {
    throw new Error('Transfer event not found in receipt; cannot resolve agentId');
  }
  const parsed = contract.interface.parseLog(transferLog);
  const agentId = parsed?.args?.tokenId?.toString();
  if (!agentId) throw new Error('Failed to parse agentId from Transfer event');

  const owner = await contract.ownerOf(agentId);
  let agentWallet = '';
  try {
    agentWallet = await contract.getAgentWallet(agentId);
  } catch {
    agentWallet = '(getAgentWallet call failed)';
  }

  console.log('----- ERC-8004 REGISTER RESULT -----');
  console.log(`agentId: ${agentId}`);
  console.log(`owner: ${owner}`);
  console.log(`agentWallet: ${agentWallet}`);
  console.log(`txHash: ${tx.hash}`);
}

main().catch((error) => {
  console.error('ERC-8004 register failed:', error.message);
  process.exit(1);
});
