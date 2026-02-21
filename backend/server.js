import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { GokiteAASDK } from '../frontend/src/gokite-aa-sdk.js';

const app = express();
const PORT = process.env.PORT || 3001;
const dataPath = path.resolve('data', 'records.json');
const x402Path = path.resolve('data', 'x402_requests.json');
const policyFailurePath = path.resolve('data', 'policy_failures.json');
const policyConfigPath = path.resolve('data', 'policy_config.json');
const sessionRuntimePath = path.resolve('data', 'session_runtime.json');
const workflowPath = path.resolve('data', 'workflows.json');

const SETTLEMENT_TOKEN =
  process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const MERCHANT_ADDRESS =
  process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const X402_PRICE = process.env.X402_PRICE || '0.05';
const KITE_AGENT2_AA_ADDRESS =
  process.env.KITE_AGENT2_AA_ADDRESS || '0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8';
const X402_REACTIVE_PRICE = process.env.X402_REACTIVE_PRICE || '0.03';
const X402_TTL_MS = 10 * 60 * 1000;
const KITE_AGENT1_ID = process.env.KITE_AGENT1_ID || '1';
const KITE_AGENT2_ID = process.env.KITE_AGENT2_ID || '2';
const POLICY_MAX_PER_TX_DEFAULT = Number(process.env.KITE_POLICY_MAX_PER_TX || '0.20');
const POLICY_DAILY_LIMIT_DEFAULT = Number(process.env.KITE_POLICY_DAILY_LIMIT || '0.60');
const POLICY_ALLOWED_RECIPIENTS_DEFAULT = String(
  process.env.KITE_POLICY_ALLOWED_RECIPIENTS || MERCHANT_ADDRESS
)
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const BACKEND_SIGNER_PRIVATE_KEY = process.env.KITECLAW_BACKEND_SIGNER_PRIVATE_KEY || '';
const ENV_SESSION_PRIVATE_KEY = process.env.KITECLAW_SESSION_KEY || '';
const ENV_SESSION_ADDRESS = process.env.KITECLAW_SESSION_ADDRESS || '';
const ENV_SESSION_ID = process.env.KITECLAW_SESSION_ID || '';
const BACKEND_RPC_URL = process.env.KITEAI_RPC_URL || 'https://rpc-testnet.gokite.ai/';
const BACKEND_BUNDLER_URL =
  process.env.KITEAI_BUNDLER_URL || 'https://bundler-service.staging.gokite.ai/rpc/';
const BACKEND_ENTRYPOINT_ADDRESS =
  process.env.KITE_ENTRYPOINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const ERC8004_IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
const ERC8004_AGENT_ID_RAW = process.env.ERC8004_AGENT_ID || '';
const ERC8004_AGENT_ID = Number.isFinite(Number(ERC8004_AGENT_ID_RAW))
  ? Number(ERC8004_AGENT_ID_RAW)
  : null;
let backendSigner = null;
if (BACKEND_SIGNER_PRIVATE_KEY) {
  try {
    backendSigner = new ethers.Wallet(BACKEND_SIGNER_PRIVATE_KEY, new ethers.JsonRpcProvider(BACKEND_RPC_URL));
  } catch {
    backendSigner = null;
  }
}

app.use(cors());
app.use(express.json());

function ensureJsonFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '[]', 'utf8');
  }
}

function readJsonArray(targetPath) {
  ensureJsonFile(targetPath);
  const raw = fs.readFileSync(targetPath, 'utf8');
  const cleaned = raw.replace(/^\uFEFF/, '');
  return JSON.parse(cleaned || '[]');
}

function writeJsonArray(targetPath, records) {
  fs.writeFileSync(targetPath, JSON.stringify(records, null, 2), 'utf8');
}

function ensureJsonObjectFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '{}', 'utf8');
  }
}

function readJsonObject(targetPath) {
  ensureJsonObjectFile(targetPath);
  const raw = fs.readFileSync(targetPath, 'utf8');
  const cleaned = raw.replace(/^\uFEFF/, '');
  const parsed = JSON.parse(cleaned || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function writeJsonObject(targetPath, payload) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

function readRecords() {
  return readJsonArray(dataPath);
}

function writeRecords(records) {
  writeJsonArray(dataPath, records);
}

function readX402Requests() {
  return readJsonArray(x402Path);
}

function writeX402Requests(records) {
  writeJsonArray(x402Path, records);
}

function readPolicyFailures() {
  return readJsonArray(policyFailurePath);
}

function writePolicyFailures(records) {
  writeJsonArray(policyFailurePath, records);
}

function readWorkflows() {
  return readJsonArray(workflowPath);
}

function writeWorkflows(records) {
  writeJsonArray(workflowPath, records);
}

function upsertWorkflow(workflow) {
  const rows = readWorkflows();
  const idx = rows.findIndex((w) => String(w.traceId || '') === String(workflow.traceId || ''));
  if (idx >= 0) rows[idx] = workflow;
  else rows.unshift(workflow);
  writeWorkflows(rows);
  return workflow;
}

function sanitizeSessionRuntime(input = {}) {
  const aaWallet = normalizeAddress(input.aaWallet || '');
  const owner = normalizeAddress(input.owner || '');
  const sessionAddress = normalizeAddress(input.sessionAddress || '');
  const sessionPrivateKey = String(input.sessionPrivateKey || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  const sessionTxHash = String(input.sessionTxHash || '').trim();
  const expiresAt = Number(input.expiresAt || 0);
  const maxPerTx = Number(input.maxPerTx || 0);
  const dailyLimit = Number(input.dailyLimit || 0);
  const gatewayRecipient = normalizeAddress(input.gatewayRecipient || '');
  const source = String(input.source || 'frontend').trim();
  const updatedAt = Number(input.updatedAt || Date.now());

  return {
    aaWallet: ethers.isAddress(aaWallet) ? aaWallet : '',
    owner: ethers.isAddress(owner) ? owner : '',
    sessionAddress: ethers.isAddress(sessionAddress) ? sessionAddress : '',
    sessionPrivateKey: /^0x[0-9a-fA-F]{64}$/.test(sessionPrivateKey) ? sessionPrivateKey : '',
    sessionId: /^0x[0-9a-fA-F]{64}$/.test(sessionId) ? sessionId : '',
    sessionTxHash: /^0x[0-9a-fA-F]{64}$/.test(sessionTxHash) ? sessionTxHash : '',
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
    maxPerTx: Number.isFinite(maxPerTx) && maxPerTx > 0 ? maxPerTx : 0,
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : 0,
    gatewayRecipient: ethers.isAddress(gatewayRecipient) ? gatewayRecipient : '',
    source,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now()
  };
}

function readSessionRuntime() {
  const file = sanitizeSessionRuntime(readJsonObject(sessionRuntimePath));
  const merged = {
    ...file,
    sessionPrivateKey: file.sessionPrivateKey || (ENV_SESSION_PRIVATE_KEY || ''),
    sessionAddress: file.sessionAddress || normalizeAddress(ENV_SESSION_ADDRESS || ''),
    sessionId: file.sessionId || (ENV_SESSION_ID || '')
  };
  return sanitizeSessionRuntime(merged);
}

function writeSessionRuntime(input = {}) {
  const next = sanitizeSessionRuntime(input);
  writeJsonObject(sessionRuntimePath, next);
  return next;
}

function maskSecret(secret = '') {
  const value = String(secret || '');
  if (!value) return '';
  if (value.length <= 12) return '***';
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function getServiceProviderBytes32(action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (normalized === 'reactive-stop-orders') {
    return ethers.encodeBytes32String('reactive-stop-orders');
  }
  return ethers.encodeBytes32String('kol-score');
}

function normalizeRecipients(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((v) => v.trim());
  return arr
    .map((addr) => normalizeAddress(addr))
    .filter((addr, index, self) => addr && ethers.isAddress(addr) && self.indexOf(addr) === index);
}

function normalizeAddresses(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((v) => v.trim());
  return arr
    .map((addr) => normalizeAddress(addr))
    .filter((addr, index, self) => addr && ethers.isAddress(addr) && self.indexOf(addr) === index);
}

function sanitizePolicy(input = {}) {
  const maxPerTx = Number(input.maxPerTx);
  const dailyLimit = Number(input.dailyLimit);
  const allowedRecipients = normalizeRecipients(input.allowedRecipients);
  const revokedPayers = normalizeAddresses(input.revokedPayers);
  return {
    maxPerTx: Number.isFinite(maxPerTx) && maxPerTx > 0 ? maxPerTx : POLICY_MAX_PER_TX_DEFAULT,
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : POLICY_DAILY_LIMIT_DEFAULT,
    allowedRecipients:
      allowedRecipients.length > 0 ? allowedRecipients : POLICY_ALLOWED_RECIPIENTS_DEFAULT,
    revokedPayers
  };
}

function ensurePolicyFile() {
  if (!fs.existsSync(policyConfigPath)) {
    fs.mkdirSync(path.dirname(policyConfigPath), { recursive: true });
    const initial = sanitizePolicy({
      maxPerTx: POLICY_MAX_PER_TX_DEFAULT,
      dailyLimit: POLICY_DAILY_LIMIT_DEFAULT,
      allowedRecipients: POLICY_ALLOWED_RECIPIENTS_DEFAULT
    });
    fs.writeFileSync(policyConfigPath, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readPolicyConfig() {
  ensurePolicyFile();
  const raw = fs.readFileSync(policyConfigPath, 'utf8');
  const cleaned = raw.replace(/^\uFEFF/, '');
  return sanitizePolicy(JSON.parse(cleaned || '{}'));
}

function writePolicyConfig(input) {
  const next = sanitizePolicy(input);
  fs.writeFileSync(policyConfigPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function normalizeAddress(address = '') {
  return String(address).trim().toLowerCase();
}

function mapX402Item(item = {}) {
  const paidAt = Number(item.paidAt || 0);
  const createdAt = Number(item.createdAt || 0);
  return {
    requestId: item.requestId || '',
    action: item.action || '',
    flowMode: item.a2a ? 'a2a+x402' : 'agent-to-api+x402',
    sourceAgentId: item?.a2a?.sourceAgentId || '',
    targetAgentId: item?.a2a?.targetAgentId || '',
    agentId: item?.identity?.agentId || '',
    payer: item.payer || '',
    amount: item.amount || '',
    status: item.status || '',
    paidAt: paidAt > 0 ? new Date(paidAt).toISOString() : '',
    createdAt: createdAt > 0 ? new Date(createdAt).toISOString() : '',
    paymentTxHash: item.paymentTxHash || item?.paymentProof?.txHash || '',
    query: item.query || '',
    tokenAddress: item.tokenAddress || '',
    recipient: item.recipient || '',
    policyDecision: item?.policy?.decision || '',
    identity: item.identity || null
  };
}

function computeDashboardKpi(items = []) {
  let pending = 0;
  let paid = 0;
  let failed = 0;
  let todaySpend = 0;
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();

  for (const item of items) {
    const status = String(item.status || '').toLowerCase();
    const createdAt = Number(item.createdAt || 0);
    const expiresAt = Number(item.expiresAt || 0);
    if (status === 'paid') {
      paid += 1;
      const paidAtMs = Number(item.paidAt || createdAt || 0);
      if (paidAtMs >= dayStartMs) {
        const amount = Number(item.amount || 0);
        if (Number.isFinite(amount)) {
          todaySpend += amount;
        }
      }
    } else if (status === 'pending') {
      if (expiresAt > 0 && now > expiresAt) {
        failed += 1;
      } else {
        pending += 1;
      }
    } else if (status === 'failed' || status === 'rejected' || status === 'error' || status === 'expired') {
      failed += 1;
    }
  }

  return {
    pending,
    paid,
    failed,
    todaySpend: Number(todaySpend.toFixed(6))
  };
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function appendWorkflowStep(workflow, name, status, details = {}) {
  if (!workflow.steps) workflow.steps = [];
  workflow.steps.push({
    name,
    status,
    at: new Date().toISOString(),
    details
  });
}

function createX402Request(query, payer, action = 'kol-score', options = {}) {
  const now = Date.now();
  const requestId = `x402_${now}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    requestId,
    action,
    query,
    payer,
    amount: String(options.amount || X402_PRICE),
    tokenAddress: options.tokenAddress || SETTLEMENT_TOKEN,
    recipient: options.recipient || MERCHANT_ADDRESS,
    status: 'pending',
    createdAt: now,
    expiresAt: now + X402_TTL_MS,
    policy: options.policy || null,
    identity: options.identity || {
      registry: ERC8004_IDENTITY_REGISTRY || '',
      agentId: ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : ''
    }
  };
}

function buildPaymentRequiredResponse(reqItem, reason = '') {
  return {
    error: 'payment_required',
    reason,
    x402: {
      version: '0.1-demo',
      requestId: reqItem.requestId,
      expiresAt: reqItem.expiresAt,
      accepts: [
        {
          scheme: 'kite-aa-erc20',
          network: 'kite_testnet',
          tokenAddress: reqItem.tokenAddress,
          amount: reqItem.amount,
          recipient: reqItem.recipient,
          decimals: 18
        }
      ]
    }
  };
}

function getActionConfig(actionRaw = '') {
  const action = String(actionRaw || 'kol-score').trim().toLowerCase();
  if (action === 'kol-score') {
    return {
      action: 'kol-score',
      amount: X402_PRICE,
      recipient: MERCHANT_ADDRESS,
      summary: 'KOL score report unlocked by x402 payment'
    };
  }
  if (action === 'reactive-stop-orders') {
    return {
      action: 'reactive-stop-orders',
      amount: X402_REACTIVE_PRICE,
      recipient: KITE_AGENT2_AA_ADDRESS,
      summary: 'Reactive contracts stop-orders signal unlocked by x402 payment'
    };
  }
  return null;
}

function normalizeReactiveParams(actionParams = {}) {
  const symbol = String(actionParams.symbol || '').trim().toUpperCase();
  const takeProfitRaw = Number(actionParams.takeProfit);
  const stopLossRaw = Number(actionParams.stopLoss);
  if (!symbol) {
    throw new Error('Reactive action requires symbol.');
  }
  if (!Number.isFinite(takeProfitRaw) || takeProfitRaw <= 0) {
    throw new Error('Reactive action requires a valid takeProfit.');
  }
  if (!Number.isFinite(stopLossRaw) || stopLossRaw <= 0) {
    throw new Error('Reactive action requires a valid stopLoss.');
  }
  return {
    symbol,
    takeProfit: takeProfitRaw,
    stopLoss: stopLossRaw
  };
}

function buildA2ACapabilities() {
  return {
    protocol: 'a2a-mvp-v0',
    targetAgent: {
      agentId: KITE_AGENT2_ID,
      wallet: KITE_AGENT2_AA_ADDRESS,
      service: 'reactive-stop-orders'
    },
    payment: {
      standard: 'x402',
      flow: '402 -> on-chain payment -> proof verify -> 200',
      settlementToken: SETTLEMENT_TOKEN,
      network: 'kite_testnet'
    },
    actions: [
      {
        id: 'reactive-stop-orders',
        input: {
          symbol: 'string',
          takeProfit: 'number > 0',
          stopLoss: 'number > 0'
        },
        price: X402_REACTIVE_PRICE,
        recipient: KITE_AGENT2_AA_ADDRESS
      }
    ]
  };
}

function validatePaymentProof(reqItem, paymentProof) {
  if (!paymentProof || typeof paymentProof !== 'object') return 'missing payment proof';
  if (!paymentProof.txHash) return 'missing txHash';
  if (paymentProof.requestId !== reqItem.requestId) return 'requestId mismatch';
  if (normalizeAddress(paymentProof.tokenAddress) !== normalizeAddress(reqItem.tokenAddress)) return 'token mismatch';
  if (normalizeAddress(paymentProof.recipient) !== normalizeAddress(reqItem.recipient)) return 'recipient mismatch';
  if (String(paymentProof.amount) !== String(reqItem.amount)) return 'amount mismatch';
  return '';
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function getUtcDateKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

function buildPolicySnapshot() {
  return readPolicyConfig();
}

function logPolicyFailure(entry) {
  const logs = readPolicyFailures();
  logs.unshift({
    time: new Date().toISOString(),
    ...entry
  });
  writePolicyFailures(logs.slice(0, 300));
}

function sumPaidAmountByPayerForUtcDay(requests, payer, utcDateKey) {
  return requests
    .filter((item) => {
      if (String(item.status).toLowerCase() !== 'paid') return false;
      if (normalizeAddress(item.payer) !== normalizeAddress(payer)) return false;
      const mark = item.paidAt || item.createdAt;
      if (!mark) return false;
      return getUtcDateKey(Number(mark)) === utcDateKey;
    })
    .reduce((acc, item) => acc + (toSafeNumber(item.amount) || 0), 0);
}

function evaluateTransferPolicy({ payer, recipient, amount, requests }) {
  const policy = buildPolicySnapshot();
  const payerLc = normalizeAddress(payer);

  if (!payerLc || !ethers.isAddress(payerLc)) {
    return {
      ok: false,
      code: 'invalid_payer',
      message: 'Payer must be a valid address.',
      evidence: {
        actual: payer
      }
    };
  }

  if (Array.isArray(policy.revokedPayers) && policy.revokedPayers.includes(payerLc)) {
    return {
      ok: false,
      code: 'payer_revoked',
      message: 'Payer is revoked by gateway guardrail.',
      evidence: {
        payer: payerLc,
        revokedPayers: policy.revokedPayers
      }
    };
  }

  const amountNum = toSafeNumber(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return {
      ok: false,
      code: 'invalid_amount',
      message: 'Amount must be a positive number.',
      evidence: {
        actual: amount,
        expected: '> 0'
      }
    };
  }

  if (!recipient || !ethers.isAddress(recipient)) {
    return {
      ok: false,
      code: 'invalid_recipient',
      message: 'Recipient must be a valid address.',
      evidence: {
        actual: recipient,
        expected: '0x + 40 hex address'
      }
    };
  }

  const recipientLc = normalizeAddress(recipient);
  if (!policy.allowedRecipients.includes(recipientLc)) {
    return {
      ok: false,
      code: 'scope_violation',
      message: 'Recipient is outside allowed scope.',
      evidence: {
        actualRecipient: recipientLc,
        allowedRecipients: policy.allowedRecipients
      }
    };
  }

  if (amountNum > policy.maxPerTx) {
    return {
      ok: false,
      code: 'over_limit_per_tx',
      message: 'Amount exceeds per-transaction limit.',
      evidence: {
        actualAmount: amountNum,
        maxPerTx: policy.maxPerTx
      }
    };
  }

  const utcDateKey = getUtcDateKey(Date.now());
  const spentToday = sumPaidAmountByPayerForUtcDay(requests, payer, utcDateKey);
  const projected = spentToday + amountNum;
  if (projected > policy.dailyLimit) {
    return {
      ok: false,
      code: 'over_limit_daily',
      message: 'Amount exceeds daily budget limit.',
      evidence: {
        utcDate: utcDateKey,
        spentToday,
        requestedAmount: amountNum,
        projectedTotal: projected,
        dailyLimit: policy.dailyLimit
      }
    };
  }

  return {
    ok: true,
    code: 'allowed',
    message: 'Policy checks passed.',
    evidence: {
      amount: amountNum,
      recipient: recipientLc,
      ...buildPolicySnapshot()
    }
  };
}

async function verifyProofOnChain(reqItem, paymentProof) {
  const txHash = String(paymentProof?.txHash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, reason: 'invalid txHash format' };
  }

  const tokenAddress = normalizeAddress(reqItem?.tokenAddress || '');
  const recipient = normalizeAddress(reqItem?.recipient || '');
  const payer = normalizeAddress(reqItem?.payer || '');
  if (!tokenAddress || !recipient) {
    return { ok: false, reason: 'missing expected token/recipient in request' };
  }

  let expectedAmountRaw = null;
  try {
    expectedAmountRaw = ethers.parseUnits(String(reqItem?.amount || '0'), 18);
  } catch {
    return { ok: false, reason: 'invalid expected amount' };
  }

  const provider = new ethers.JsonRpcProvider(BACKEND_RPC_URL);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return { ok: false, reason: 'transaction receipt not found (pending or unknown)' };
  }
  if (Number(receipt.status) !== 1) {
    return { ok: false, reason: 'transaction reverted on-chain' };
  }

  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const transferIface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)'
  ]);

  const candidateLogs = (receipt.logs || []).filter((log) => {
    return (
      normalizeAddress(log.address) === tokenAddress &&
      Array.isArray(log.topics) &&
      String(log.topics[0] || '').toLowerCase() === String(transferTopic).toLowerCase()
    );
  });

  for (const log of candidateLogs) {
    try {
      const parsed = transferIface.parseLog(log);
      const from = normalizeAddress(String(parsed.args.from));
      const to = normalizeAddress(String(parsed.args.to));
      const value = ethers.getBigInt(parsed.args.value);
      const amountMatch = value === expectedAmountRaw;
      const toMatch = to === recipient;
      const fromMatch = !payer || from === payer;
      if (amountMatch && toMatch && fromMatch) {
        return {
          ok: true,
          details: {
            txHash,
            blockNumber: Number(receipt.blockNumber || 0),
            tokenAddress,
            from,
            to,
            valueRaw: value.toString()
          }
        };
      }
    } catch {
      // ignore unparsable transfer logs
    }
  }

  return {
    ok: false,
    reason: 'no matching ERC20 Transfer log found for token/recipient/amount/payer'
  };
}

function getBackendSignerState() {
  return {
    enabled: Boolean(backendSigner),
    address: backendSigner?.address || '',
    custody: 'backend_env'
  };
}

const ERC8004_IDENTITY_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getAgentWallet(uint256 agentId) view returns (address)'
];

function parseAgentId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function readIdentityProfile(input = {}) {
  const requestedRegistry = String(input.registry || '').trim();
  const requestedAgentId = parseAgentId(input.agentId);
  const configured = {
    registry: requestedRegistry || ERC8004_IDENTITY_REGISTRY || '',
    agentId:
      requestedAgentId !== null
        ? String(requestedAgentId)
        : ERC8004_AGENT_ID !== null
          ? String(ERC8004_AGENT_ID)
          : ''
  };

  if (!configured.registry || !ethers.isAddress(configured.registry)) {
    return {
      configured,
      available: false,
      reason: 'identity_registry_not_configured'
    };
  }
  const resolvedAgentId = parseAgentId(configured.agentId);
  if (resolvedAgentId === null) {
    return {
      configured,
      available: false,
      reason: 'agent_id_not_configured'
    };
  }

  const provider = new ethers.JsonRpcProvider(BACKEND_RPC_URL);
  const network = await provider.getNetwork();
  const contract = new ethers.Contract(configured.registry, ERC8004_IDENTITY_ABI, provider);
  const [ownerAddress, tokenURI, agentWallet] = await Promise.all([
    contract.ownerOf(resolvedAgentId),
    contract.tokenURI(resolvedAgentId),
    contract.getAgentWallet(resolvedAgentId)
  ]);

  return {
    configured,
    available: true,
    chainId: String(network.chainId),
    ownerAddress,
    tokenURI,
    agentWallet
  };
}

function assertBackendSigner(res) {
  if (!backendSigner) {
    res.status(503).json({
      error: 'backend_signer_unavailable',
      reason: 'Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY in backend environment.'
    });
    return false;
  }
  return true;
}

app.get('/api/records', (req, res) => {
  res.json(readRecords());
});

app.post('/api/records', (req, res) => {
  const record = req.body || {};
  const records = readRecords();
  const normalized = {
    time: record.time || new Date().toISOString(),
    type: record.type || 'unknown',
    amount: record.amount || '',
    token: record.token || '',
    recipient: record.recipient || '',
    txHash: record.txHash || '',
    status: record.status || 'unknown',
    requestId: record.requestId || '',
    signerMode: record.signerMode || '',
    agentId:
      record.agentId ||
      (ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : ''),
    identityRegistry: record.identityRegistry || ERC8004_IDENTITY_REGISTRY || ''
  };
  records.unshift(normalized);
  writeRecords(records);
  res.json({ ok: true });
});

app.get('/api/signer/info', (req, res) => {
  res.json(getBackendSignerState());
});

app.get('/api/session/runtime', (req, res) => {
  const runtime = readSessionRuntime();
  return res.json({
    ok: true,
    runtime: {
      ...runtime,
      sessionPrivateKey: undefined,
      sessionPrivateKeyMasked: maskSecret(runtime.sessionPrivateKey),
      hasSessionPrivateKey: Boolean(runtime.sessionPrivateKey)
    }
  });
});

app.get('/api/session/runtime/secret', (req, res) => {
  const runtime = readSessionRuntime();
  return res.json({
    ok: true,
    runtime
  });
});

app.post('/api/session/runtime/sync', (req, res) => {
  const body = req.body || {};
  const next = writeSessionRuntime({
    aaWallet: body.aaWallet,
    owner: body.owner,
    sessionAddress: body.sessionAddress,
    sessionPrivateKey: body.sessionPrivateKey,
    sessionId: body.sessionId,
    sessionTxHash: body.sessionTxHash,
    expiresAt: body.expiresAt,
    maxPerTx: body.maxPerTx,
    dailyLimit: body.dailyLimit,
    gatewayRecipient: body.gatewayRecipient,
    source: body.source || 'frontend',
    updatedAt: Date.now()
  });
  return res.json({
    ok: true,
    runtime: {
      ...next,
      sessionPrivateKey: undefined,
      sessionPrivateKeyMasked: maskSecret(next.sessionPrivateKey),
      hasSessionPrivateKey: Boolean(next.sessionPrivateKey)
    }
  });
});

app.delete('/api/session/runtime', (req, res) => {
  writeJsonObject(sessionRuntimePath, {});
  return res.json({ ok: true, cleared: true });
});

app.get('/api/identity', async (req, res) => {
  try {
    const profile = await readIdentityProfile({
      registry: req.query.identityRegistry,
      agentId: req.query.agentId
    });
    res.json({ ok: true, profile });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'identity_read_failed',
      reason: error.message
    });
  }
});

app.get('/api/identity/current', async (req, res) => {
  try {
    const profile = await readIdentityProfile({});
    return res.json({ ok: true, profile });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'identity_read_failed',
      reason: error.message
    });
  }
});

app.get('/api/x402/mapping/latest', (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
  const rows = readX402Requests().map(mapX402Item).slice(0, limit);
  const kpi = computeDashboardKpi(readX402Requests());
  return res.json({ ok: true, total: rows.length, kpi, items: rows });
});

app.get('/api/onchain/latest', (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
  const paidRows = readX402Requests()
    .filter((item) => String(item.status || '').toLowerCase() === 'paid' && (item.paymentTxHash || item?.paymentProof?.txHash))
    .map((item) => ({
      source: 'x402',
      requestId: item.requestId || '',
      txHash: item.paymentTxHash || item?.paymentProof?.txHash || '',
      payer: item.payer || '',
      from: item.payer || '',
      to: item.recipient || '',
      amount: item.amount || '',
      tokenAddress: item.tokenAddress || '',
      block: item?.proofVerification?.details?.blockNumber || '',
      time: Number(item.paidAt || item.createdAt || 0) > 0
        ? new Date(Number(item.paidAt || item.createdAt)).toISOString()
        : ''
    }));

  const recordRows = readRecords()
    .filter((row) => row && row.txHash)
    .map((row) => ({
      source: row.type || 'record',
      requestId: row.requestId || '',
      txHash: row.txHash || '',
      payer: row.aaWallet || '',
      from: row.aaWallet || '',
      to: row.recipient || '',
      amount: row.amount || '',
      tokenAddress: row.token || '',
      block: row.block || '',
      time: row.time || ''
    }));

  const merged = [...paidRows, ...recordRows];
  const dedup = [];
  const seen = new Set();
  for (const row of merged) {
    const key = String(row.txHash || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedup.push(row);
  }
  dedup.sort((a, b) => {
    const ta = Date.parse(a.time || 0) || 0;
    const tb = Date.parse(b.time || 0) || 0;
    return tb - ta;
  });

  return res.json({ ok: true, total: dedup.length, items: dedup.slice(0, limit) });
});

app.post('/api/chat/agent', (req, res) => {
  const message = String(req.body?.message || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();
  const traceId = String(req.body?.traceId || `trace_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`).trim();

  if (!message) {
    return res.status(400).json({ ok: false, error: 'message_required' });
  }

  const lower = message.toLowerCase();
  let reply = 'Received. Use "Place stop order BTC-USDT TP 80000 SL 50000" to start the payment workflow.';
  const suggestions = [];

  if (lower.includes('stop') || lower.includes('tp') || lower.includes('sl')) {
    reply =
      'Intent recognized: stop-order request. Next step: call workflow endpoint POST /api/workflow/stop-order/run with symbol/takeProfit/stopLoss.';
    suggestions.push({
      action: 'place_stop_order',
      endpoint: '/api/workflow/stop-order/run',
      params: {
        symbol: 'BTC-USDT',
        takeProfit: 80000,
        stopLoss: 50000,
        sourceAgentId: KITE_AGENT1_ID,
        targetAgentId: KITE_AGENT2_ID
      }
    });
  } else if (lower.includes('status') || lower.includes('runtime')) {
    const runtime = readSessionRuntime();
    reply = `Runtime status: ${runtime?.sessionAddress ? 'ready' : 'not_ready'}.`;
  }

  return res.json({
    ok: true,
    reply,
    traceId,
    sessionId: sessionId || null,
    suggestions
  });
});

app.post('/api/workflow/stop-order/run', async (req, res) => {
  const symbol = String(req.body?.symbol || 'BTC-USDT').trim().toUpperCase();
  const takeProfit = Number(req.body?.takeProfit);
  const stopLoss = Number(req.body?.stopLoss);
  const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = String(req.body?.traceId || createTraceId('workflow')).trim();
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
  const workflow = {
    traceId,
    type: 'stop-order',
    state: 'running',
    sourceAgentId,
    targetAgentId,
    payer,
    input: {
      symbol,
      takeProfit,
      stopLoss
    },
    requestId: '',
    txHash: '',
    userOpHash: '',
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  upsertWorkflow(workflow);

  try {
    if (!symbol || !Number.isFinite(takeProfit) || !Number.isFinite(stopLoss) || takeProfit <= 0 || stopLoss <= 0) {
      throw new Error('Invalid stop-order params. symbol/takeProfit/stopLoss are required.');
    }

    const challengeResult = await handleA2AStopOrders({
      payer,
      sourceAgentId,
      targetAgentId,
      task: { symbol, takeProfit, stopLoss }
    });
    if (challengeResult.status !== 402) {
      throw new Error(
        challengeResult?.body?.reason ||
          challengeResult?.body?.error ||
          `Expected 402 challenge, got ${challengeResult.status}`
      );
    }
    const challenge = challengeResult.body?.x402;
    const requestId = String(challenge?.requestId || '').trim();
    const accept = Array.isArray(challenge?.accepts) ? challenge.accepts[0] : null;
    if (!requestId || !accept?.tokenAddress || !accept?.recipient || !accept?.amount) {
      throw new Error('Malformed x402 challenge payload.');
    }
    workflow.requestId = requestId;
    appendWorkflowStep(workflow, 'challenge_issued', 'ok', {
      requestId,
      amount: accept.amount,
      recipient: accept.recipient
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const payResp = await fetch(`http://127.0.0.1:${PORT}/api/session/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenAddress: accept.tokenAddress,
        recipient: accept.recipient,
        amount: accept.amount,
        requestId,
        action: 'reactive-stop-orders',
        query: `A2A stop-order ${symbol} tp=${takeProfit} sl=${stopLoss}`
      })
    });
    const payBody = await payResp.json().catch(() => ({}));
    if (!payResp.ok || !payBody?.ok) {
      throw new Error(payBody?.reason || payBody?.error || `session pay failed: HTTP ${payResp.status}`);
    }
    const txHash = String(payBody?.payment?.txHash || '').trim();
    const userOpHash = String(payBody?.payment?.userOpHash || '').trim();
    if (!txHash) throw new Error('session pay returned empty txHash.');
    workflow.txHash = txHash;
    workflow.userOpHash = userOpHash;
    appendWorkflowStep(workflow, 'payment_sent', 'ok', {
      txHash,
      userOpHash
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const proofResult = await handleA2AStopOrders({
      payer,
      sourceAgentId,
      targetAgentId,
      requestId,
      paymentProof: {
        requestId,
        txHash,
        payer,
        tokenAddress: accept.tokenAddress,
        recipient: accept.recipient,
        amount: accept.amount
      },
      task: { symbol, takeProfit, stopLoss }
    });
    if (proofResult.status !== 200) {
      throw new Error(
        proofResult?.body?.reason || proofResult?.body?.error || `proof submit failed: ${proofResult.status}`
      );
    }
    appendWorkflowStep(workflow, 'proof_submitted', 'ok', {
      verified: true
    });
    appendWorkflowStep(workflow, 'unlocked', 'ok', {
      result: proofResult?.body?.result?.summary || ''
    });
    workflow.state = 'unlocked';
    workflow.result = proofResult?.body?.result || null;
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    return res.json({
      ok: true,
      traceId,
      requestId,
      txHash,
      userOpHash,
      state: workflow.state,
      workflow
    });
  } catch (error) {
    appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
    workflow.state = 'failed';
    workflow.error = error.message;
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);
    return res.status(500).json({
      ok: false,
      traceId,
      state: workflow.state,
      error: 'workflow_failed',
      reason: error.message,
      workflow
    });
  }
});

app.get('/api/workflow/:traceId', (req, res) => {
  const traceId = String(req.params.traceId || '').trim();
  if (!traceId) {
    return res.status(400).json({ ok: false, error: 'traceId_required' });
  }
  const rows = readWorkflows();
  const workflow = rows.find((w) => String(w.traceId || '') === traceId);
  if (!workflow) {
    return res.status(404).json({ ok: false, error: 'workflow_not_found', traceId });
  }
  return res.json({ ok: true, traceId, workflow });
});

app.get('/api/a2a/capabilities', (req, res) => {
  res.json({ ok: true, capabilities: buildA2ACapabilities() });
});

async function handleA2AStopOrders(body = {}) {
  const payer = String(body.payer || '').trim();
  const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
  const requestId = String(body.requestId || '').trim();
  const paymentProof = body.paymentProof;
  const task = body.task || {};

  let actionParams = null;
  try {
    actionParams = normalizeReactiveParams(task);
  } catch (error) {
    return {
      status: 400,
      body: {
        error: 'invalid_task',
        reason: error.message
      }
    };
  }

  const actionCfg = getActionConfig('reactive-stop-orders');
  const requests = readX402Requests();
  const a2aQuery = `A2A stop-order ${actionParams.symbol} tp=${actionParams.takeProfit} sl=${actionParams.stopLoss}`;

  if (!requestId || !paymentProof) {
    const policyResult = evaluateTransferPolicy({
      payer,
      recipient: actionCfg.recipient,
      amount: actionCfg.amount,
      requests
    });
    if (!policyResult.ok) {
      logPolicyFailure({
        action: 'a2a-reactive-stop-orders',
        payer,
        recipient: actionCfg.recipient,
        amount: actionCfg.amount,
        code: policyResult.code,
        message: policyResult.message,
        evidence: policyResult.evidence
      });
      return {
        status: 403,
        body: {
          error: policyResult.code,
          reason: policyResult.message,
          evidence: policyResult.evidence
        }
      };
    }

    const reqItem = createX402Request(a2aQuery, payer, actionCfg.action, {
      amount: actionCfg.amount,
      recipient: actionCfg.recipient,
      policy: {
        decision: 'allowed',
        snapshot: buildPolicySnapshot(),
        evidence: policyResult.evidence
      }
    });
    reqItem.actionParams = actionParams;
    reqItem.a2a = {
      sourceAgentId,
      targetAgentId,
      taskType: 'reactive-stop-orders'
    };
    requests.unshift(reqItem);
    writeX402Requests(requests);

    return {
      status: 402,
      body: {
        ...buildPaymentRequiredResponse(reqItem),
        a2a: {
          protocol: 'a2a-mvp-v0',
          sourceAgentId,
          targetAgentId,
          taskType: 'reactive-stop-orders',
          task: actionParams
        }
      }
    };
  }

  const reqItem = requests.find((item) => item.requestId === requestId);
  if (!reqItem) {
    return {
      status: 402,
      body: {
        error: 'payment_required',
        reason: 'request not found'
      }
    };
  }

  if (Date.now() > reqItem.expiresAt) {
    reqItem.status = 'expired';
    writeX402Requests(requests);
    return {
      status: 402,
      body: buildPaymentRequiredResponse(reqItem, 'request expired')
    };
  }

  if (reqItem.status === 'paid') {
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'x402',
        requestId: reqItem.requestId,
        reused: true,
        result: {
          summary: 'A2A reactive stop-order task already unlocked',
          orderPlan: {
            symbol: reqItem?.actionParams?.symbol || '-',
            takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
            stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
            provider: 'Reactive Contracts'
          }
        },
        a2a: reqItem.a2a || null
      }
    };
  }

  const validationError = validatePaymentProof(reqItem, paymentProof);
  if (validationError) {
    return {
      status: 402,
      body: buildPaymentRequiredResponse(reqItem, validationError)
    };
  }

  const verification = await verifyProofOnChain(reqItem, paymentProof);
  if (!verification.ok) {
    return {
      status: 402,
      body: buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`)
    };
  }

  reqItem.status = 'paid';
  reqItem.paidAt = Date.now();
  reqItem.paymentTxHash = paymentProof.txHash;
  reqItem.paymentProof = {
    requestId: paymentProof.requestId,
    txHash: paymentProof.txHash,
    payer: paymentProof.payer || '',
    tokenAddress: paymentProof.tokenAddress,
    recipient: paymentProof.recipient,
    amount: paymentProof.amount
  };
  reqItem.proofVerification = {
    mode: 'onchain_transfer_log',
    verifiedAt: Date.now(),
    details: verification.details || null
  };
  writeX402Requests(requests);

  return {
    status: 200,
    body: {
      ok: true,
      mode: 'x402',
      requestId: reqItem.requestId,
      payment: {
        txHash: paymentProof.txHash,
        amount: reqItem.amount,
        tokenAddress: reqItem.tokenAddress,
        recipient: reqItem.recipient
      },
      result: {
        summary: 'A2A reactive stop-order task unlocked by x402 payment',
        orderPlan: {
          symbol: reqItem?.actionParams?.symbol || '-',
          takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
          stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
          provider: 'Reactive Contracts'
        }
      },
      a2a: reqItem.a2a || {
        sourceAgentId,
        targetAgentId,
        taskType: 'reactive-stop-orders'
      }
    }
  };
}

app.post('/api/a2a/tasks/stop-orders', async (req, res) => {
  const result = await handleA2AStopOrders(req.body);
  return res.status(result.status).json(result.body);
});

app.get('/api/skill/openclaw/manifest', (req, res) => {
  return res.json({
    ok: true,
    skill: {
      name: 'kiteclaw.stop_orders',
      version: '1.0.0',
      title: 'KITECLAW Reactive Stop Orders',
      transport: 'http-json',
      endpoints: {
        invoke: '/api/skill/openclaw/invoke',
        status: '/api/skill/openclaw/status/:requestId',
        evidence: '/api/skill/openclaw/evidence/:requestId'
      },
      inputSchema: {
        type: 'object',
        required: ['payer', 'task'],
        properties: {
          payer: { type: 'string' },
          sourceAgentId: { type: 'string', default: KITE_AGENT1_ID },
          targetAgentId: { type: 'string', default: KITE_AGENT2_ID },
          task: {
            type: 'object',
            required: ['symbol', 'takeProfit', 'stopLoss'],
            properties: {
              symbol: { type: 'string' },
              takeProfit: { type: 'number' },
              stopLoss: { type: 'number' }
            }
          },
          requestId: { type: 'string' },
          paymentProof: { type: 'object' }
        }
      }
    }
  });
});

app.post('/api/skill/openclaw/invoke', async (req, res) => {
  const result = await handleA2AStopOrders(req.body);
  return res.status(result.status).json({
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    ...result.body
  });
});

app.get('/api/skill/openclaw/status/:requestId', (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ ok: false, error: 'requestId is required' });
  }
  const item = readX402Requests().find((r) => String(r.requestId) === requestId);
  if (!item) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const now = Date.now();
  const effectiveStatus =
    item.status === 'paid' ? 'paid' : now > Number(item.expiresAt || 0) ? 'expired' : item.status;
  return res.json({
    ok: true,
    requestId: item.requestId,
    status: effectiveStatus,
    action: item.action,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    paidAt: item.paidAt || null,
    paymentTxHash: item.paymentTxHash || item?.paymentProof?.txHash || ''
  });
});

app.get('/api/skill/openclaw/evidence/:requestId', (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ ok: false, error: 'requestId is required' });
  }
  const item = readX402Requests().find((r) => String(r.requestId) === requestId);
  if (!item) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const txHash = String(item.paymentTxHash || item?.paymentProof?.txHash || '').toLowerCase();
  const transferRecord = readRecords().find(
    (r) => txHash && String(r.txHash || '').toLowerCase() === txHash
  );
  return res.json({
    ok: true,
    request: item,
    payment: {
      txHash: item.paymentTxHash || item?.paymentProof?.txHash || '',
      tokenAddress: item.tokenAddress,
      recipient: item.recipient,
      amount: item.amount
    },
    transferRecord: transferRecord || null,
    policy: item.policy || null,
    identity: item.identity || null,
    a2a: item.a2a || null
  });
});

app.post('/api/signer/sign-userop-hash', async (req, res) => {
  if (!assertBackendSigner(res)) return;
  const userOpHash = String(req.body?.userOpHash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) {
    return res.status(400).json({ error: 'invalid_userOpHash' });
  }
  try {
    const signature = await backendSigner.signMessage(ethers.getBytes(userOpHash));
    return res.json({ ok: true, signerAddress: backendSigner.address, signature });
  } catch (error) {
    return res.status(500).json({ error: 'sign_failed', reason: error.message });
  }
});

app.post('/api/x402/kol-score', async (req, res) => {
  const body = req.body || {};
  const query = String(body.query || '').trim();
  const payer = String(body.payer || '').trim();
  const actionRequested = String(body.action || 'kol-score').trim().toLowerCase();
  const requestId = String(body.requestId || '').trim();
  const paymentProof = body.paymentProof;
  const identityInput = body.identity || {};
  const actionParamsInput = body.actionParams || {};
  if (!query) return res.status(400).json({ error: 'query is required' });
  const actionCfg = getActionConfig(actionRequested);
  if (!actionCfg) {
    return res.status(400).json({
      error: 'unsupported_action',
      reason: `Unsupported action: ${actionRequested}`
    });
  }
  if (!ethers.isAddress(actionCfg.recipient)) {
    return res.status(400).json({
      error: 'invalid_action_recipient',
      reason: `非法地址: action recipient is invalid (${actionCfg.recipient})`
    });
  }

  const requests = readX402Requests();
  let normalizedActionParams = null;
  if (actionCfg.action === 'reactive-stop-orders') {
    try {
      normalizedActionParams = normalizeReactiveParams(actionParamsInput);
    } catch (error) {
      return res.status(400).json({
        error: 'invalid_reactive_params',
        reason: error.message
      });
    }
  }
  if (!requestId || !paymentProof) {
    const policyResult = evaluateTransferPolicy({
      payer,
      recipient: actionCfg.recipient,
      amount: actionCfg.amount,
      requests
    });
    if (!policyResult.ok) {
      logPolicyFailure({
        action: actionCfg.action,
        payer,
        recipient: actionCfg.recipient,
        amount: actionCfg.amount,
        code: policyResult.code,
        message: policyResult.message,
        evidence: policyResult.evidence
      });
      return res.status(403).json({
        error: policyResult.code,
        reason: policyResult.message,
        evidence: policyResult.evidence,
        policy: buildPolicySnapshot()
      });
    }

    let identityProfile = null;
    try {
      identityProfile = await readIdentityProfile({
        registry: identityInput.identityRegistry || identityInput.registry,
        agentId: identityInput.agentId
      });
    } catch (error) {
      return res.status(400).json({
        error: 'invalid_identity',
        reason: error.message
      });
    }
    const reqItem = createX402Request(query, payer, actionCfg.action, {
      amount: actionCfg.amount,
      recipient: actionCfg.recipient,
      policy: {
        decision: 'allowed',
        snapshot: buildPolicySnapshot(),
        evidence: policyResult.evidence
      },
      identity: identityProfile?.configured
    });
    reqItem.actionParams = normalizedActionParams;
    requests.unshift(reqItem);
    writeX402Requests(requests);
    return res.status(402).json(buildPaymentRequiredResponse(reqItem));
  }

  const reqItem = requests.find((item) => item.requestId === requestId);
  if (!reqItem) {
    const fallbackItem = createX402Request(query, payer, 'kol-score');
    requests.unshift(fallbackItem);
    writeX402Requests(requests);
    return res.status(402).json(buildPaymentRequiredResponse(fallbackItem, 'request not found, regenerated'));
  }

  if (Date.now() > reqItem.expiresAt) {
    reqItem.status = 'expired';
    writeX402Requests(requests);
    return res.status(402).json(buildPaymentRequiredResponse(reqItem, 'request expired'));
  }

  if (reqItem.status === 'paid') {
    const paidResult =
      reqItem.action === 'reactive-stop-orders'
        ? {
            summary: 'Reactive contracts stop-orders signal already unlocked',
            orderPlan: {
              symbol: reqItem?.actionParams?.symbol || '-',
              takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
              stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
              provider: 'Reactive Contracts'
            }
          }
        : {
            summary: 'KOL score report already unlocked',
            topKOLs: [
              { handle: '@alpha_kol', score: 91 },
              { handle: '@beta_growth', score: 88 },
              { handle: '@gamma_builder', score: 84 }
            ]
          };
    return res.json({
      ok: true,
      mode: 'x402',
      requestId: reqItem.requestId,
      reused: true,
      result: paidResult
    });
  }

  const validationError = validatePaymentProof(reqItem, paymentProof);
  if (validationError) return res.status(402).json(buildPaymentRequiredResponse(reqItem, validationError));

  const verification = await verifyProofOnChain(reqItem, paymentProof);
  if (!verification.ok) {
    return res
      .status(402)
      .json(buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`));
  }

  reqItem.status = 'paid';
  reqItem.paidAt = Date.now();
  reqItem.paymentTxHash = paymentProof.txHash;
  reqItem.paymentProof = {
    requestId: paymentProof.requestId,
    txHash: paymentProof.txHash,
    payer: paymentProof.payer || '',
    tokenAddress: paymentProof.tokenAddress,
    recipient: paymentProof.recipient,
    amount: paymentProof.amount
  };
  reqItem.proofVerification = {
    mode: 'onchain_transfer_log',
    verifiedAt: Date.now(),
    details: verification.details || null
  };
  writeX402Requests(requests);

  return res.json({
    ok: true,
    mode: 'x402',
    requestId: reqItem.requestId,
    payment: {
      txHash: paymentProof.txHash,
      amount: reqItem.amount,
      tokenAddress: reqItem.tokenAddress,
      recipient: reqItem.recipient
    },
    result:
      reqItem.action === 'reactive-stop-orders'
        ? {
            summary: 'Reactive contracts stop-orders signal unlocked by x402 payment',
            orderPlan: {
              symbol: reqItem?.actionParams?.symbol || '-',
              takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
              stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
              provider: 'Reactive Contracts'
            }
          }
        : {
            summary: 'KOL score report unlocked by x402 payment',
            topKOLs: [
              { handle: '@alpha_kol', score: 91 },
              { handle: '@beta_growth', score: 88 },
              { handle: '@gamma_builder', score: 84 }
            ]
          }
  });
});

app.post('/api/x402/transfer-intent', async (req, res) => {
  const body = req.body || {};
  const payer = String(body.payer || '').trim();
  const requestId = String(body.requestId || '').trim();
  const paymentProof = body.paymentProof;
  const recipient = String(body.recipient || '').trim();
  const amount = String(body.amount || '').trim();
  const tokenAddress = String(body.tokenAddress || SETTLEMENT_TOKEN).trim();
  const simulateInsufficientFunds = Boolean(body.simulateInsufficientFunds);
  const forceExpire = Boolean(body.debugForceExpire);
  const identityInput = body.identity || {};

  const requests = readX402Requests();
  if (!requestId || !paymentProof) {
    if (!recipient || !amount) return res.status(400).json({ error: 'recipient and amount are required' });
    if (simulateInsufficientFunds) {
      logPolicyFailure({
        action: 'transfer-intent',
        payer,
        recipient,
        amount,
        code: 'insufficient_funds',
        message: 'Simulated insufficient funds for graceful-failure demo.',
        evidence: {
          mode: 'demo_flag',
          requiredAmount: amount
        }
      });
      return res.status(402).json({
        error: 'insufficient_funds',
        reason: 'Insufficient funds to satisfy x402 payment requirement (demo).'
      });
    }

    const policyResult = evaluateTransferPolicy({
      payer,
      recipient,
      amount,
      requests
    });
    if (!policyResult.ok) {
      logPolicyFailure({
        action: 'transfer-intent',
        payer,
        recipient,
        amount,
        code: policyResult.code,
        message: policyResult.message,
        evidence: policyResult.evidence
      });
      return res.status(403).json({
        error: policyResult.code,
        reason: policyResult.message,
        evidence: policyResult.evidence,
        policy: buildPolicySnapshot()
      });
    }

    let identityProfile = null;
    try {
      identityProfile = await readIdentityProfile({
        registry: identityInput.identityRegistry || identityInput.registry,
        agentId: identityInput.agentId
      });
    } catch (error) {
      return res.status(400).json({
        error: 'invalid_identity',
        reason: error.message
      });
    }
    const reqItem = createX402Request(`transfer ${amount} to ${recipient}`, payer, 'transfer-intent', {
      amount,
      recipient,
      tokenAddress,
      policy: {
        decision: 'allowed',
        snapshot: buildPolicySnapshot(),
        evidence: policyResult.evidence
      },
      identity: identityProfile?.configured
    });
    requests.unshift(reqItem);
    writeX402Requests(requests);
    return res.status(402).json(buildPaymentRequiredResponse(reqItem));
  }

  const reqItem = requests.find((item) => item.requestId === requestId);
  if (!reqItem) return res.status(402).json({ error: 'payment_required', reason: 'request not found' });

  if (forceExpire) {
    reqItem.expiresAt = Date.now() - 1;
  }

  if (Date.now() > reqItem.expiresAt) {
    reqItem.status = 'expired';
    writeX402Requests(requests);
    return res.status(402).json(buildPaymentRequiredResponse(reqItem, 'request expired'));
  }

  if (reqItem.status === 'paid') {
    return res.json({ ok: true, mode: 'x402', requestId: reqItem.requestId, reused: true, result: { summary: 'Transfer intent already unlocked' } });
  }

  const validationError = validatePaymentProof(reqItem, paymentProof);
  if (validationError) return res.status(402).json(buildPaymentRequiredResponse(reqItem, validationError));

  const verification = await verifyProofOnChain(reqItem, paymentProof);
  if (!verification.ok) {
    return res
      .status(402)
      .json(buildPaymentRequiredResponse(reqItem, `on-chain proof verification failed: ${verification.reason}`));
  }

  reqItem.status = 'paid';
  reqItem.paidAt = Date.now();
  reqItem.paymentTxHash = paymentProof.txHash;
  reqItem.paymentProof = {
    requestId: paymentProof.requestId,
    txHash: paymentProof.txHash,
    payer: paymentProof.payer || '',
    tokenAddress: paymentProof.tokenAddress,
    recipient: paymentProof.recipient,
    amount: paymentProof.amount
  };
  reqItem.proofVerification = {
    mode: 'onchain_transfer_log',
    verifiedAt: Date.now(),
    details: verification.details || null
  };
  writeX402Requests(requests);

  return res.json({
    ok: true,
    mode: 'x402',
    requestId: reqItem.requestId,
    payment: {
      txHash: paymentProof.txHash,
      amount: reqItem.amount,
      tokenAddress: reqItem.tokenAddress,
      recipient: reqItem.recipient
    },
    result: { summary: 'Transfer intent unlocked by x402 proof verification' }
  });
});

app.get('/api/x402/policy', (req, res) => {
  res.json({ ok: true, policy: buildPolicySnapshot() });
});

app.post('/api/x402/policy', (req, res) => {
  const body = req.body || {};
  const nextPolicy = writePolicyConfig({
    maxPerTx: body.maxPerTx,
    dailyLimit: body.dailyLimit,
    allowedRecipients: body.allowedRecipients,
    revokedPayers: body.revokedPayers
  });
  res.json({ ok: true, policy: nextPolicy });
});

app.post('/api/x402/policy/revoke', (req, res) => {
  const payer = normalizeAddress(req.body?.payer || '');
  if (!payer || !ethers.isAddress(payer)) {
    return res.status(400).json({ error: 'invalid_payer' });
  }
  const current = buildPolicySnapshot();
  const revoked = new Set(current.revokedPayers || []);
  revoked.add(payer);
  const next = writePolicyConfig({
    ...current,
    revokedPayers: Array.from(revoked)
  });
  return res.json({
    ok: true,
    action: 'revoked',
    payer,
    policy: next
  });
});

app.post('/api/x402/policy/unrevoke', (req, res) => {
  const payer = normalizeAddress(req.body?.payer || '');
  if (!payer || !ethers.isAddress(payer)) {
    return res.status(400).json({ error: 'invalid_payer' });
  }
  const current = buildPolicySnapshot();
  const revoked = new Set((current.revokedPayers || []).filter((addr) => addr !== payer));
  const next = writePolicyConfig({
    ...current,
    revokedPayers: Array.from(revoked)
  });
  return res.json({
    ok: true,
    action: 'unrevoked',
    payer,
    policy: next
  });
});

app.get('/api/x402/policy-failures', (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
  const code = String(req.query.code || '').trim().toLowerCase();
  const action = String(req.query.action || '').trim().toLowerCase();
  const payer = String(req.query.payer || '').trim().toLowerCase();
  const rows = readPolicyFailures().filter((item) => {
    const codeOk = !code || String(item.code || '').toLowerCase() === code;
    const actionOk = !action || String(item.action || '').toLowerCase() === action;
    const payerOk = !payer || String(item.payer || '').toLowerCase() === payer;
    return codeOk && actionOk && payerOk;
  });
  res.json({ ok: true, total: rows.length, items: rows.slice(0, limit) });
});

app.get('/api/x402/requests', (req, res) => {
  const requestId = String(req.query.requestId || '').trim().toLowerCase();
  const txHash = String(req.query.txHash || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const action = String(req.query.action || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));

  const requests = readX402Requests();
  const filtered = requests.filter((item) => {
    const idOk = !requestId || String(item.requestId || '').toLowerCase() === requestId;
    const txOk = !txHash || String(item.paymentTxHash || '').toLowerCase() === txHash || String(item?.paymentProof?.txHash || '').toLowerCase() === txHash;
    const statusOk = !status || String(item.status || '').toLowerCase() === status;
    const actionOk = !action || String(item.action || '').toLowerCase() === action;
    return idOk && txOk && statusOk && actionOk;
  });

  res.json({ ok: true, total: filtered.length, items: filtered.slice(0, limit) });
});

// AA Session Payment Endpoint
app.post('/api/session/pay', async (req, res) => {
  try {
    const runtime = readSessionRuntime();

    if (!runtime.sessionPrivateKey || !runtime.aaWallet) {
      return res.status(400).json({
        ok: false,
        error: 'session_not_configured',
        reason: 'Session key not synced. Please configure via /api/session/runtime/sync first.'
      });
    }

    const {
      tokenAddress,
      recipient,
      amount,
      requestId = '',
      action = 'kol-score',
      query = '',
      sessionId: bodySessionId = ''
    } = req.body || {};

    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      return res.status(400).json({ ok: false, error: 'invalid_tokenAddress' });
    }
    if (!recipient || !ethers.isAddress(recipient)) {
      return res.status(400).json({ ok: false, error: 'invalid_recipient' });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_amount' });
    }

    const decimals = 18;
    const amountRaw = ethers.parseUnits(String(amount), decimals);
    const sessionId = String(bodySessionId || runtime.sessionId || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_session_id',
        reason: 'sessionId is required. Sync runtime with sessionId from Agent Settings.'
      });
    }

    const provider = new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const sessionWallet = new ethers.Wallet(runtime.sessionPrivateKey, provider);
    const sessionSignerAddress = await sessionWallet.getAddress();
    const serviceProvider = getServiceProviderBytes32(action);

    const sessionReadAbi = [
      'function sessionExists(bytes32 sessionId) view returns (bool)',
      'function getSessionAgent(bytes32 sessionId) view returns (address)',
      'function checkSpendingRules(bytes32 sessionId, uint256 normalizedAmount, bytes32 serviceProvider) view returns (bool)'
    ];
    const account = new ethers.Contract(runtime.aaWallet, sessionReadAbi, provider);
    const [exists, agentAddr, rulePass] = await Promise.all([
      account.sessionExists(sessionId),
      account.getSessionAgent(sessionId),
      account.checkSpendingRules(sessionId, amountRaw, serviceProvider)
    ]);
    if (!exists) {
      return res.status(400).json({
        ok: false,
        error: 'session_not_found',
        reason: `Session not found on-chain: ${sessionId}`
      });
    }
    if (String(agentAddr || '').toLowerCase() !== String(sessionSignerAddress).toLowerCase()) {
      return res.status(400).json({
        ok: false,
        error: 'session_agent_mismatch',
        reason: `On-chain session agent mismatch. expected=${agentAddr}, current=${sessionSignerAddress}`
      });
    }
    if (!rulePass) {
      return res.status(400).json({
        ok: false,
        error: 'session_rule_failed',
        reason: 'Session spending rule precheck failed (amount/provider out of scope).'
      });
    }

    const erc20Abi = ['function balanceOf(address account) view returns (uint256)'];
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    const aaBalance = await tokenContract.balanceOf(runtime.aaWallet);
    if (aaBalance < amountRaw) {
      return res.status(400).json({
        ok: false,
        error: 'insufficient_funds',
        reason: `AA wallet ${runtime.aaWallet} has insufficient balance`,
        details: {
          aaWallet: runtime.aaWallet,
          balance: ethers.formatUnits(aaBalance, decimals),
          required: amount
        }
      });
    }

    const sdk = new GokiteAASDK({
      network: 'kite_testnet',
      rpcUrl: BACKEND_RPC_URL,
      bundlerUrl: BACKEND_BUNDLER_URL,
      entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
      proxyAddress: runtime.aaWallet
    });
    if (runtime.owner && ethers.isAddress(runtime.owner)) {
      sdk.config.ownerAddress = runtime.owner;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const authPayload = {
      from: runtime.aaWallet,
      to: recipient,
      token: tokenAddress,
      value: amountRaw,
      validAfter: BigInt(Math.max(0, nowSec - 30)),
      validBefore: BigInt(nowSec + 10 * 60),
      nonce: ethers.hexlify(ethers.randomBytes(32))
    };
    const authSignature = await sdk.buildTransferAuthorizationSignature(sessionWallet, authPayload);
    const metadata = ethers.hexlify(
      ethers.toUtf8Bytes(
        JSON.stringify({
          requestId: String(requestId || ''),
          action: String(action || ''),
          query: String(query || '')
        })
      )
    );
    const signFunction = async (userOpHash) =>
      sessionWallet.signMessage(ethers.getBytes(userOpHash));

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

    if (result.status !== 'success' || !result.transactionHash) {
      return res.status(500).json({
        ok: false,
        error: 'aa_session_payment_failed',
        reason: result.reason || 'unknown',
        details: {
          userOpHash: result.userOpHash || '',
          sessionId,
          payer: runtime.aaWallet
        }
      });
    }

    const records = readRecords();
    const record = {
      time: new Date().toISOString(),
      type: 'aa-session-payment',
      amount: String(amount),
      token: tokenAddress,
      recipient: recipient,
      txHash: result.transactionHash,
      userOpHash: result.userOpHash || '',
      status: 'success',
      requestId: requestId || '',
      signerMode: 'aa-session',
      agentId: ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : '',
      identityRegistry: ERC8004_IDENTITY_REGISTRY || '',
      aaWallet: runtime.aaWallet,
      sessionAddress: runtime.sessionAddress,
      sessionId,
      action
    };
    records.unshift(record);
    writeRecords(records);

    return res.json({
      ok: true,
      status: 'paid',
      payment: {
        requestId: requestId || '',
        tokenAddress,
        recipient,
        amount: String(amount),
        amountWei: amountRaw.toString(),
        aaWallet: runtime.aaWallet,
        sessionAddress: runtime.sessionAddress,
        sessionId,
        txHash: result.transactionHash,
        userOpHash: result.userOpHash || ''
      },
      message: 'AA session payment submitted and confirmed.'
    });

  } catch (error) {
    console.error('Session pay error:', error);
    return res.status(500).json({
      ok: false,
      error: 'payment_failed',
      reason: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
