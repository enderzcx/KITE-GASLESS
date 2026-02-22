import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { GokiteAASDK } from '../frontend/src/gokite-aa-sdk.js';
import { createOpenClawAdapter } from './services/openclawAdapter.js';
import { createPersistenceStore } from './services/persistenceStore.js';

const app = express();
const PORT = process.env.PORT || 3001;
const dataPath = path.resolve('data', 'records.json');
const x402Path = path.resolve('data', 'x402_requests.json');
const policyFailurePath = path.resolve('data', 'policy_failures.json');
const policyConfigPath = path.resolve('data', 'policy_config.json');
const sessionRuntimePath = path.resolve('data', 'session_runtime.json');
const workflowPath = path.resolve('data', 'workflows.json');
const identityChallengePath = path.resolve('data', 'identity_challenges.json');

const SETTLEMENT_TOKEN =
  process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const MERCHANT_ADDRESS =
  process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const X402_PRICE = process.env.X402_PRICE || '0.05';
const KITE_AGENT2_AA_ADDRESS =
  process.env.KITE_AGENT2_AA_ADDRESS || '0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8';
const X402_REACTIVE_PRICE = process.env.X402_REACTIVE_PRICE || '0.03';
const X402_BTC_PRICE = process.env.X402_BTC_PRICE || '0.00001';
const X402_TTL_MS = 10 * 60 * 1000;
const KITE_AGENT1_ID = process.env.KITE_AGENT1_ID || '1';
const KITE_AGENT2_ID = process.env.KITE_AGENT2_ID || '2';
const POLICY_MAX_PER_TX_DEFAULT = Number(process.env.KITE_POLICY_MAX_PER_TX || '0.20');
const POLICY_DAILY_LIMIT_DEFAULT = Number(process.env.KITE_POLICY_DAILY_LIMIT || '0.60');
const POLICY_ALLOWED_RECIPIENTS_DEFAULT = String(
  process.env.KITE_POLICY_ALLOWED_RECIPIENTS || `${MERCHANT_ADDRESS},${KITE_AGENT2_AA_ADDRESS}`
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
const KITE_MIN_NATIVE_GAS = String(process.env.KITE_MIN_NATIVE_GAS || '0.0001').trim();
const PROOF_RPC_TIMEOUT_MS = Number(process.env.KITE_PROOF_RPC_TIMEOUT_MS || 10_000);
const PROOF_RPC_RETRIES = Number(process.env.KITE_PROOF_RPC_RETRIES || 3);
const OPENCLAW_BASE_URL = String(process.env.OPENCLAW_BASE_URL || '').trim();
const OPENCLAW_CHAT_PATH = String(process.env.OPENCLAW_CHAT_PATH || '/api/v1/chat').trim();
const OPENCLAW_HEALTH_PATH = String(process.env.OPENCLAW_HEALTH_PATH || '/health').trim();
const OPENCLAW_API_KEY = String(process.env.OPENCLAW_API_KEY || '').trim();
const OPENCLAW_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS || 12_000);
const OPENCLAW_CHAT_PROTOCOL = String(process.env.OPENCLAW_CHAT_PROTOCOL || 'auto').trim().toLowerCase();
const OPENCLAW_MODEL = String(process.env.OPENCLAW_MODEL || '').trim();
const OPENCLAW_SYSTEM_PROMPT = String(process.env.OPENCLAW_SYSTEM_PROMPT || '').trim();
const ERC8004_IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
const ERC8004_AGENT_ID_RAW = process.env.ERC8004_AGENT_ID || '';
const ERC8004_AGENT_ID = Number.isFinite(Number(ERC8004_AGENT_ID_RAW))
  ? Number(ERC8004_AGENT_ID_RAW)
  : null;
const API_KEY_ADMIN = String(process.env.KITECLAW_API_KEY_ADMIN || '').trim();
const API_KEY_AGENT = String(process.env.KITECLAW_API_KEY_AGENT || '').trim();
const API_KEY_VIEWER = String(process.env.KITECLAW_API_KEY_VIEWER || '').trim();
const RATE_LIMIT_WINDOW_MS = Number(process.env.KITECLAW_RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.KITECLAW_RATE_LIMIT_MAX || 240);
const IDENTITY_CHALLENGE_TTL_MS = Number(process.env.IDENTITY_CHALLENGE_TTL_MS || 120_000);
const IDENTITY_CHALLENGE_MAX_ROWS = Number(process.env.IDENTITY_CHALLENGE_MAX_ROWS || 500);
const IDENTITY_VERIFY_MODE = String(process.env.IDENTITY_VERIFY_MODE || 'signature').trim().toLowerCase();
const AUTO_BTC_PRICE_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.AUTO_BTC_PRICE_ENABLED || '').trim());
const AUTO_BTC_PRICE_INTERVAL_MS = Math.max(15_000, Number(process.env.AUTO_BTC_PRICE_INTERVAL_MS || 60_000));
const AUTO_BTC_PRICE_SOURCE_AGENT_ID = String(process.env.AUTO_BTC_PRICE_SOURCE_AGENT_ID || KITE_AGENT1_ID).trim();
const AUTO_BTC_PRICE_TARGET_AGENT_ID = String(process.env.AUTO_BTC_PRICE_TARGET_AGENT_ID || KITE_AGENT2_ID).trim();
const AUTO_BTC_PRICE_PAIR = String(process.env.AUTO_BTC_PRICE_PAIR || 'BTCUSDT').trim().toUpperCase();
const AUTO_BTC_PRICE_SOURCE = String(process.env.AUTO_BTC_PRICE_SOURCE || 'hyperliquid').trim().toLowerCase();
const AUTO_BTC_PRICE_PAYER = String(process.env.AUTO_BTC_PRICE_PAYER || '').trim();

const ROLE_RANK = {
  viewer: 1,
  agent: 2,
  admin: 3
};

const openclawAdapter = createOpenClawAdapter({
  baseUrl: OPENCLAW_BASE_URL,
  chatPath: OPENCLAW_CHAT_PATH,
  healthPath: OPENCLAW_HEALTH_PATH,
  apiKey: OPENCLAW_API_KEY,
  timeoutMs: OPENCLAW_TIMEOUT_MS,
  protocol: OPENCLAW_CHAT_PROTOCOL,
  model: OPENCLAW_MODEL,
  systemPrompt: OPENCLAW_SYSTEM_PROMPT
});

const persistenceStore = createPersistenceStore({
  mode: process.env.KITE_PERSISTENCE_MODE || '',
  databaseUrl: process.env.DATABASE_URL || ''
});

const PERSIST_ARRAY_PATHS = [
  dataPath,
  x402Path,
  policyFailurePath,
  workflowPath,
  identityChallengePath
];
const PERSIST_OBJECT_PATHS = [policyConfigPath, sessionRuntimePath];
const persistArrayCache = new Map();
const persistObjectCache = new Map();
let persistenceInitDone = false;
let autoBtcPriceTimer = null;
let autoBtcPriceBusy = false;
const autoBtcPriceState = {
  enabled: false,
  intervalMs: AUTO_BTC_PRICE_INTERVAL_MS,
  sourceAgentId: AUTO_BTC_PRICE_SOURCE_AGENT_ID,
  targetAgentId: AUTO_BTC_PRICE_TARGET_AGENT_ID,
  pair: AUTO_BTC_PRICE_PAIR,
  source: AUTO_BTC_PRICE_SOURCE,
  payer: AUTO_BTC_PRICE_PAYER,
  startedAt: '',
  lastTickAt: '',
  lastTraceId: '',
  lastStatus: '',
  lastError: ''
};

function authConfigured() {
  return Boolean(API_KEY_ADMIN || API_KEY_AGENT || API_KEY_VIEWER);
}

function extractApiKey(req) {
  const xApiKey = String(req.headers['x-api-key'] || '').trim();
  if (xApiKey) return xApiKey;
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function resolveRoleByApiKey(key) {
  if (!key) return '';
  if (API_KEY_ADMIN && key === API_KEY_ADMIN) return 'admin';
  if (API_KEY_AGENT && key === API_KEY_AGENT) return 'agent';
  if (API_KEY_VIEWER && key === API_KEY_VIEWER) return 'viewer';
  return '';
}

function requireRole(requiredRole = 'viewer') {
  return (req, res, next) => {
    if (!authConfigured()) {
      req.authRole = 'dev-open';
      return next();
    }
    const providedKey = extractApiKey(req);
    const role = resolveRoleByApiKey(providedKey);
    if (!role) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        reason: 'Missing or invalid API key.',
        traceId: req.traceId || ''
      });
    }
    const roleRank = ROLE_RANK[role] || 0;
    const requiredRank = ROLE_RANK[requiredRole] || ROLE_RANK.viewer;
    if (roleRank < requiredRank) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        reason: `Role "${role}" cannot access "${requiredRole}" endpoint.`,
        traceId: req.traceId || ''
      });
    }
    req.authRole = role;
    return next();
  };
}

function getInternalAgentApiKey() {
  return API_KEY_AGENT || API_KEY_ADMIN || '';
}

function getAutoBtcPriceStatus() {
  return {
    ...autoBtcPriceState,
    running: Boolean(autoBtcPriceTimer),
    busy: autoBtcPriceBusy
  };
}

async function runAutoBtcPriceTick(reason = 'timer') {
  if (autoBtcPriceBusy) return;
  autoBtcPriceBusy = true;
  autoBtcPriceState.lastTickAt = new Date().toISOString();
  autoBtcPriceState.lastError = '';
  autoBtcPriceState.lastStatus = 'running';

  try {
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(autoBtcPriceState.payer || runtime.aaWallet || '');
    const traceId = createTraceId('auto_btc');
    const internalApiKey = getInternalAgentApiKey();
    const headers = { 'Content-Type': 'application/json' };
    if (internalApiKey) headers['x-api-key'] = internalApiKey;

    const resp = await fetch(`http://127.0.0.1:${PORT}/api/workflow/btc-price/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        traceId,
        sourceAgentId: autoBtcPriceState.sourceAgentId || KITE_AGENT1_ID,
        targetAgentId: autoBtcPriceState.targetAgentId || KITE_AGENT2_ID,
        pair: autoBtcPriceState.pair || 'BTCUSDT',
        source: autoBtcPriceState.source || 'auto',
        payer
      })
    });
    const body = await resp.json().catch(() => ({}));
    autoBtcPriceState.lastTraceId = String(body?.traceId || traceId).trim();
    if (!resp.ok || !body?.ok) {
      autoBtcPriceState.lastStatus = 'failed';
      autoBtcPriceState.lastError = String(body?.reason || body?.error || `HTTP ${resp.status}`).trim();
      return;
    }

    autoBtcPriceState.lastStatus = String(body?.state || 'success').trim().toLowerCase();
    autoBtcPriceState.lastError = '';
  } catch (error) {
    autoBtcPriceState.lastStatus = 'failed';
    autoBtcPriceState.lastError = String(error?.message || 'auto tick failed').trim();
  } finally {
    autoBtcPriceBusy = false;
    if (reason === 'startup' || reason === 'manual') {
      console.log(`[auto-btc] tick ${autoBtcPriceState.lastStatus} trace=${autoBtcPriceState.lastTraceId || '-'}`);
    }
  }
}

function stopAutoBtcPriceLoop() {
  if (autoBtcPriceTimer) {
    clearInterval(autoBtcPriceTimer);
    autoBtcPriceTimer = null;
  }
  autoBtcPriceState.enabled = false;
}

function startAutoBtcPriceLoop(options = {}) {
  const intervalMs = Math.max(15_000, Number(options.intervalMs || autoBtcPriceState.intervalMs || 60_000));
  autoBtcPriceState.intervalMs = intervalMs;
  autoBtcPriceState.sourceAgentId = String(options.sourceAgentId || autoBtcPriceState.sourceAgentId || KITE_AGENT1_ID).trim();
  autoBtcPriceState.targetAgentId = String(options.targetAgentId || autoBtcPriceState.targetAgentId || KITE_AGENT2_ID).trim();
  autoBtcPriceState.pair = String(options.pair || autoBtcPriceState.pair || 'BTCUSDT').trim().toUpperCase();
  autoBtcPriceState.source = String(options.source || autoBtcPriceState.source || 'auto').trim().toLowerCase();
  autoBtcPriceState.payer = String(options.payer || autoBtcPriceState.payer || '').trim();
  autoBtcPriceState.enabled = true;
  autoBtcPriceState.startedAt = new Date().toISOString();
  autoBtcPriceState.lastError = '';

  if (autoBtcPriceTimer) clearInterval(autoBtcPriceTimer);
  autoBtcPriceTimer = setInterval(() => {
    runAutoBtcPriceTick('timer').catch(() => {});
  }, intervalMs);

  if (options.immediate !== false) {
    runAutoBtcPriceTick(options.reason || 'manual').catch(() => {});
  }
}

const rateLimitStore = new Map();
function getRateKey(req) {
  const key = extractApiKey(req);
  if (key) return `k:${key.slice(0, 8)}`;
  return `ip:${String(req.ip || req.socket?.remoteAddress || 'unknown')}`;
}

function apiRateLimit(req, res, next) {
  const now = Date.now();
  const key = getRateKey(req);
  const current = rateLimitStore.get(key);
  if (!current || now - current.startMs >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { startMs: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      ok: false,
      error: 'rate_limited',
      reason: 'Too many API requests',
      traceId: req.traceId || ''
    });
  }
  return next();
}

let backendSigner = null;
if (BACKEND_SIGNER_PRIVATE_KEY) {
  try {
    backendSigner = new ethers.Wallet(BACKEND_SIGNER_PRIVATE_KEY, new ethers.JsonRpcProvider(BACKEND_RPC_URL));
  } catch {
    backendSigner = null;
  }
}

async function ensureAAAccountDeployment({ owner, salt = 0n } = {}) {
  if (!backendSigner) {
    throw new Error('Backend signer unavailable. Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY first.');
  }
  const normalizedOwner = normalizeAddress(owner || '');
  if (!ethers.isAddress(normalizedOwner)) {
    throw new Error('A valid owner address is required.');
  }

  const sdk = new GokiteAASDK({
    network: 'kite_testnet',
    rpcUrl: BACKEND_RPC_URL,
    bundlerUrl: BACKEND_BUNDLER_URL,
    entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS
  });
  const accountAddress = sdk.getAccountAddress(normalizedOwner, salt);
  const provider = backendSigner.provider || new ethers.JsonRpcProvider(BACKEND_RPC_URL);
  const beforeCode = await provider.getCode(accountAddress);
  const alreadyDeployed = Boolean(beforeCode && beforeCode !== '0x');

  if (alreadyDeployed) {
    return {
      owner: normalizedOwner,
      accountAddress,
      salt: salt.toString(),
      deployed: true,
      createdNow: false,
      txHash: ''
    };
  }

  const factory = new ethers.Contract(
    sdk.config.accountFactoryAddress,
    ['function createAccount(address owner, uint256 salt) returns (address)'],
    backendSigner
  );
  const tx = await factory.createAccount(normalizedOwner, salt);
  await tx.wait();

  const afterCode = await provider.getCode(accountAddress);
  const deployed = Boolean(afterCode && afterCode !== '0x');
  if (!deployed) {
    throw new Error('AA createAccount confirmed, but no code found at predicted address.');
  }

  return {
    owner: normalizedOwner,
    accountAddress,
    salt: salt.toString(),
    deployed: true,
    createdNow: true,
    txHash: tx.hash
  };
}

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const incoming =
    String(req.headers['x-trace-id'] || '').trim() ||
    String(req.query.traceId || '').trim() ||
    String(req.body?.traceId || '').trim();
  const traceId = incoming || createTraceId('req');
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);
  next();
});
app.use('/api', apiRateLimit);

const sseClients = new Set();

function broadcastEvent(eventName, payload = {}) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  const eventTraceId = String(payload?.traceId || '').trim();
  for (const client of sseClients) {
    const clientTraceId = String(client?.traceId || '').trim();
    if (!clientTraceId && eventTraceId) {
      continue;
    }
    if (clientTraceId && eventTraceId && clientTraceId !== eventTraceId) {
      continue;
    }
    if (clientTraceId && !eventTraceId) {
      continue;
    }
    try {
      client.res.write(msg);
    } catch {
      // ignore broken stream
    }
  }
}

function openSseStream(req, res) {
  const traceIdFilter = String(req.query?.traceId || '').trim();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const client = {
    res,
    traceId: traceIdFilter
  };
  sseClients.add(client);
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      ok: true,
      at: new Date().toISOString(),
      traceId: traceIdFilter || ''
    })}\n\n`
  );

  const keepalive = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
    } catch {
      // handled by close
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(client);
  });
}

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function persistenceKeyForPath(targetPath) {
  const base = String(path.basename(targetPath || '') || '').trim().toLowerCase();
  return `doc:${base}`;
}

function ensureJsonFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '[]', 'utf8');
  }
}

function loadJsonArrayFromFile(targetPath) {
  ensureJsonFile(targetPath);
  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const cleaned = raw.replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArrayToFile(targetPath, records) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(Array.isArray(records) ? records : [], null, 2), 'utf8');
}

function ensureJsonObjectFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '{}', 'utf8');
  }
}

function loadJsonObjectFromFile(targetPath) {
  ensureJsonObjectFile(targetPath);
  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const cleaned = raw.replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonObjectToFile(targetPath, payload) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

function queuePersistWrite(stateKey, payload) {
  if (!persistenceStore.isConnected()) return;
  persistenceStore.setDocument(stateKey, payload).catch((error) => {
    console.error(`[persistence] failed writing ${stateKey}: ${error?.message || error}`);
  });
}

function readJsonArray(targetPath) {
  const stateKey = persistenceKeyForPath(targetPath);
  if (persistArrayCache.has(stateKey)) {
    return cloneValue(persistArrayCache.get(stateKey) || []);
  }
  const rows = loadJsonArrayFromFile(targetPath);
  persistArrayCache.set(stateKey, rows);
  queuePersistWrite(stateKey, rows);
  return cloneValue(rows);
}

function writeJsonArray(targetPath, records) {
  const stateKey = persistenceKeyForPath(targetPath);
  const rows = Array.isArray(records) ? records : [];
  persistArrayCache.set(stateKey, cloneValue(rows));
  writeJsonArrayToFile(targetPath, rows);
  queuePersistWrite(stateKey, rows);
}

function readJsonObject(targetPath) {
  const stateKey = persistenceKeyForPath(targetPath);
  if (persistObjectCache.has(stateKey)) {
    return cloneValue(persistObjectCache.get(stateKey) || {});
  }
  const payload = loadJsonObjectFromFile(targetPath);
  persistObjectCache.set(stateKey, payload);
  queuePersistWrite(stateKey, payload);
  return cloneValue(payload);
}

function writeJsonObject(targetPath, payload) {
  const stateKey = persistenceKeyForPath(targetPath);
  const normalized = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  persistObjectCache.set(stateKey, cloneValue(normalized));
  writeJsonObjectToFile(targetPath, normalized);
  queuePersistWrite(stateKey, normalized);
}

async function hydratePersistenceCachesFromDatabase() {
  if (!persistenceStore.isConnected()) return;
  for (const targetPath of PERSIST_ARRAY_PATHS) {
    const stateKey = persistenceKeyForPath(targetPath);
    const payload = await persistenceStore.getDocument(stateKey);
    if (!Array.isArray(payload)) continue;
    persistArrayCache.set(stateKey, payload);
    writeJsonArrayToFile(targetPath, payload);
  }
  for (const targetPath of PERSIST_OBJECT_PATHS) {
    const stateKey = persistenceKeyForPath(targetPath);
    const payload = await persistenceStore.getDocument(stateKey);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    persistObjectCache.set(stateKey, payload);
    writeJsonObjectToFile(targetPath, payload);
  }
}

async function seedPersistenceFromFilesIfMissing() {
  if (!persistenceStore.isConnected()) return;
  for (const targetPath of PERSIST_ARRAY_PATHS) {
    const stateKey = persistenceKeyForPath(targetPath);
    const exists = await persistenceStore.hasDocument(stateKey);
    if (exists) continue;
    const rows = loadJsonArrayFromFile(targetPath);
    await persistenceStore.setDocument(stateKey, rows);
  }
  for (const targetPath of PERSIST_OBJECT_PATHS) {
    const stateKey = persistenceKeyForPath(targetPath);
    const exists = await persistenceStore.hasDocument(stateKey);
    if (exists) continue;
    const payload = loadJsonObjectFromFile(targetPath);
    await persistenceStore.setDocument(stateKey, payload);
  }
}

async function initializePersistence() {
  if (persistenceInitDone) return;
  persistenceInitDone = true;
  try {
    await persistenceStore.init();
  } catch (error) {
    console.error(`[persistence] init failed, fallback to file mode: ${error?.message || error}`);
    return;
  }
  if (!persistenceStore.isConnected()) return;
  await seedPersistenceFromFilesIfMissing();
  await hydratePersistenceCachesFromDatabase();
  const info = persistenceStore.info();
  console.log(`[persistence] mode=${info.mode} connected=${info.connected}`);
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

function readIdentityChallenges() {
  return readJsonArray(identityChallengePath);
}

function writeIdentityChallenges(records) {
  writeJsonArray(identityChallengePath, records);
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
  if (normalized === 'btc-price-feed') {
    return ethers.encodeBytes32String('btc-price-feed');
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

function getCoreAllowedRecipients() {
  return normalizeRecipients([MERCHANT_ADDRESS, KITE_AGENT2_AA_ADDRESS]);
}

function mergeAllowedRecipients(addresses = []) {
  const merged = normalizeRecipients(addresses);
  for (const core of getCoreAllowedRecipients()) {
    if (!merged.includes(core)) merged.push(core);
  }
  return merged;
}

function sanitizePolicy(input = {}) {
  const maxPerTx = Number(input.maxPerTx);
  const dailyLimit = Number(input.dailyLimit);
  const allowedRecipients = mergeAllowedRecipients(
    normalizeRecipients(input.allowedRecipients).length > 0
      ? input.allowedRecipients
      : POLICY_ALLOWED_RECIPIENTS_DEFAULT
  );
  const revokedPayers = normalizeAddresses(input.revokedPayers);
  return {
    maxPerTx: Number.isFinite(maxPerTx) && maxPerTx > 0 ? maxPerTx : POLICY_MAX_PER_TX_DEFAULT,
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : POLICY_DAILY_LIMIT_DEFAULT,
    allowedRecipients,
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

function mapX402Item(item = {}, workflow = null) {
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
    workflowState: workflow?.state || '',
    workflowTraceId: workflow?.traceId || '',
    workflowUpdatedAt: workflow?.updatedAt || workflow?.createdAt || '',
    workflowError: workflow?.error || '',
    policyDecision: item?.policy?.decision || '',
    identity: item.identity || null
  };
}

function buildLatestWorkflowByRequestId(workflows = []) {
  const index = new Map();
  for (const item of workflows) {
    const requestId = String(item?.requestId || '').trim();
    if (!requestId) continue;
    const prev = index.get(requestId);
    const prevTs = new Date(prev?.updatedAt || prev?.createdAt || 0).getTime();
    const currTs = new Date(item?.updatedAt || item?.createdAt || 0).getTime();
    if (!prev || currTs >= prevTs) {
      index.set(requestId, item);
    }
  }
  return index;
}

function toIsoFromMs(value) {
  const ms = Number(value || 0);
  return ms > 0 ? new Date(ms).toISOString() : '';
}

function normalizeExecutionState(value = '', fallback = 'running') {
  const raw = String(value || '').trim().toLowerCase();
  if (['unlocked', 'success', 'ok', 'completed', 'paid'].includes(raw)) return 'success';
  if (['failed', 'error', 'expired', 'rejected'].includes(raw)) return 'failed';
  if (['running', 'pending', 'processing'].includes(raw)) return 'running';
  return fallback;
}

function buildA2AReceipt(requestItem = {}, workflow = null, overrides = {}) {
  const requestId = String(requestItem.requestId || '').trim();
  const workflowTraceId = String(workflow?.traceId || '').trim();
  const linkedTraceId = String(requestItem?.a2a?.traceId || '').trim();
  const traceId = String(overrides.traceId || workflowTraceId || linkedTraceId).trim();
  const sourceAgentId = String(overrides.sourceAgentId || requestItem?.a2a?.sourceAgentId || '').trim();
  const targetAgentId = String(overrides.targetAgentId || requestItem?.a2a?.targetAgentId || '').trim();
  const capability = String(overrides.capability || requestItem?.a2a?.taskType || requestItem.action || '').trim();
  const requestStatus = String(requestItem.status || '').trim().toLowerCase();
  const state = normalizeExecutionState(
    overrides.state || workflow?.state || requestStatus || 'running',
    'running'
  );
  const paymentTxHash = String(requestItem.paymentTxHash || requestItem?.paymentProof?.txHash || '').trim();
  const createdAt = toIsoFromMs(requestItem.createdAt);
  const paidAt = toIsoFromMs(requestItem.paidAt);
  const updatedAt = String(
    overrides.updatedAt || workflow?.updatedAt || workflow?.createdAt || paidAt || createdAt || new Date().toISOString()
  ).trim();
  const phase = String(
    overrides.phase ||
      (state === 'failed'
        ? 'failed'
        : requestStatus === 'paid'
          ? state === 'success'
            ? 'settled'
            : 'paid'
          : 'payment_required')
  ).trim();

  const links = {
    workflow: traceId ? `/api/workflow/${traceId}` : '',
    evidence: traceId ? `/api/evidence/export?traceId=${encodeURIComponent(traceId)}` : ''
  };

  return {
    protocol: 'x402-a2a-v1',
    interactionId: requestId,
    traceId,
    sourceAgentId,
    targetAgentId,
    capability,
    state,
    phase,
    query: String(requestItem.query || '').trim(),
    payment: {
      requestId,
      status: requestStatus || '',
      payer: String(requestItem.payer || '').trim(),
      amount: String(requestItem.amount || '').trim(),
      tokenAddress: String(requestItem.tokenAddress || '').trim(),
      recipient: String(requestItem.recipient || '').trim(),
      txHash: paymentTxHash
    },
    timing: {
      createdAt,
      paidAt,
      updatedAt
    },
    result: {
      summary: String(workflow?.result?.summary || overrides.summary || '').trim(),
      error: String(workflow?.error || overrides.error || '').trim()
    },
    links
  };
}

function listA2AReceipts(input = {}) {
  const sourceFilter = String(input.sourceAgentId || '').trim().toLowerCase();
  const targetFilter = String(input.targetAgentId || '').trim().toLowerCase();
  const capabilityFilter = String(input.capability || '').trim().toLowerCase();
  const stateFilter = String(input.state || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(input.limit || 50), 500));

  const workflows = readWorkflows();
  const workflowByRequestId = buildLatestWorkflowByRequestId(workflows);
  const receipts = readX402Requests()
    .filter((item) => item?.a2a && (item?.a2a?.sourceAgentId || item?.a2a?.targetAgentId))
    .map((item) =>
      buildA2AReceipt(item, workflowByRequestId.get(String(item?.requestId || '').trim()) || null, {
        traceId: item?.a2a?.traceId || ''
      })
    )
    .filter((row) => {
      const sourceOk = !sourceFilter || String(row.sourceAgentId || '').toLowerCase() === sourceFilter;
      const targetOk = !targetFilter || String(row.targetAgentId || '').toLowerCase() === targetFilter;
      const capabilityOk = !capabilityFilter || String(row.capability || '').toLowerCase() === capabilityFilter;
      const stateOk = !stateFilter || String(row.state || '').toLowerCase() === stateFilter;
      return sourceOk && targetOk && capabilityOk && stateOk;
    });
  return receipts.slice(0, limit);
}

function buildA2ANetworkGraph(receipts = []) {
  const edges = new Map();
  const nodes = new Map();

  function ensureNode(agentId = '') {
    const key = String(agentId || '').trim();
    if (!key) return null;
    if (!nodes.has(key)) {
      nodes.set(key, {
        agentId: key,
        outCount: 0,
        inCount: 0,
        successCount: 0,
        failedCount: 0,
        runningCount: 0,
        outAmount: 0,
        inAmount: 0
      });
    }
    return nodes.get(key);
  }

  for (const receipt of receipts) {
    const source = String(receipt.sourceAgentId || '').trim();
    const target = String(receipt.targetAgentId || '').trim();
    const capability = String(receipt.capability || 'unknown').trim();
    if (!source || !target) continue;
    const amount = Number(receipt?.payment?.amount || 0);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const state = normalizeExecutionState(receipt.state, 'running');

    const edgeKey = `${source}->${target}::${capability}`;
    if (!edges.has(edgeKey)) {
      edges.set(edgeKey, {
        edgeId: edgeKey,
        sourceAgentId: source,
        targetAgentId: target,
        capability,
        totalCount: 0,
        successCount: 0,
        failedCount: 0,
        runningCount: 0,
        totalAmount: 0,
        latestAt: '',
        lastState: '',
        lastTxHash: ''
      });
    }
    const edge = edges.get(edgeKey);
    edge.totalCount += 1;
    edge.totalAmount = Number((edge.totalAmount + safeAmount).toFixed(6));
    if (state === 'success') edge.successCount += 1;
    else if (state === 'failed') edge.failedCount += 1;
    else edge.runningCount += 1;
    const updatedAt = String(receipt?.timing?.updatedAt || '').trim();
    if (!edge.latestAt || new Date(updatedAt).getTime() >= new Date(edge.latestAt).getTime()) {
      edge.latestAt = updatedAt;
      edge.lastState = state;
      edge.lastTxHash = String(receipt?.payment?.txHash || '').trim();
    }

    const sourceNode = ensureNode(source);
    const targetNode = ensureNode(target);
    if (sourceNode) {
      sourceNode.outCount += 1;
      sourceNode.outAmount = Number((sourceNode.outAmount + safeAmount).toFixed(6));
      if (state === 'success') sourceNode.successCount += 1;
      else if (state === 'failed') sourceNode.failedCount += 1;
      else sourceNode.runningCount += 1;
    }
    if (targetNode) {
      targetNode.inCount += 1;
      targetNode.inAmount = Number((targetNode.inAmount + safeAmount).toFixed(6));
      if (state === 'success') targetNode.successCount += 1;
      else if (state === 'failed') targetNode.failedCount += 1;
      else targetNode.runningCount += 1;
    }
  }

  const edgeRows = Array.from(edges.values()).sort((a, b) => {
    const atA = Number.isFinite(Date.parse(a.latestAt || '')) ? Date.parse(a.latestAt || '') : 0;
    const atB = Number.isFinite(Date.parse(b.latestAt || '')) ? Date.parse(b.latestAt || '') : 0;
    return atB - atA;
  });
  const nodeRows = Array.from(nodes.values()).sort((a, b) => (b.outCount + b.inCount) - (a.outCount + a.inCount));

  return {
    protocol: 'x402-a2a-v1',
    generatedAt: new Date().toISOString(),
    nodeCount: nodeRows.length,
    edgeCount: edgeRows.length,
    nodes: nodeRows,
    edges: edgeRows
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

function resolveWorkflowTraceId(requestedTraceId = '') {
  const input = String(requestedTraceId || '').trim();
  if (!input) return createTraceId('workflow');
  const exists = readWorkflows().some((item) => String(item?.traceId || '') === input);
  return exists ? createTraceId('workflow') : input;
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
  if (action === 'btc-price-feed') {
    return {
      action: 'btc-price-feed',
      amount: X402_BTC_PRICE,
      recipient: KITE_AGENT2_AA_ADDRESS,
      summary: 'BTC price quote unlocked by x402 payment'
    };
  }
  return null;
}

function normalizeReactiveParams(actionParams = {}) {
  const symbol = String(actionParams.symbol || '').trim().toUpperCase();
  const takeProfitRaw = Number(actionParams.takeProfit);
  const stopLossRaw = Number(actionParams.stopLoss);
  const quantityText = String(actionParams.quantity ?? '').trim();
  const hasQuantity = quantityText !== '';
  const quantityRaw = hasQuantity ? Number(quantityText) : null;
  if (!symbol) {
    throw new Error('Reactive action requires symbol.');
  }
  if (!Number.isFinite(takeProfitRaw) || takeProfitRaw <= 0) {
    throw new Error('Reactive action requires a valid takeProfit.');
  }
  if (!Number.isFinite(stopLossRaw) || stopLossRaw <= 0) {
    throw new Error('Reactive action requires a valid stopLoss.');
  }
  if (hasQuantity && (!Number.isFinite(quantityRaw) || quantityRaw <= 0)) {
    throw new Error('Reactive action requires a valid quantity when quantity is provided.');
  }
  return {
    symbol,
    takeProfit: takeProfitRaw,
    stopLoss: stopLossRaw,
    ...(hasQuantity ? { quantity: quantityRaw } : {})
  };
}

function normalizeBtcPriceParams(input = {}) {
  const rawPair = String(input.pair || 'BTCUSDT').trim().toUpperCase();
  const rawSource = String(input.source || 'hyperliquid').trim().toLowerCase();
  const compactPair = rawPair.replace(/[-_\s]/g, '');

  if (!['BTC', 'BTCUSDT', 'BTCUSD'].includes(compactPair)) {
    throw new Error('BTC price task requires pair BTC/BTCUSDT/BTCUSD/BTC-USDT.');
  }
  if (!['hyperliquid', 'auto', 'binance', 'okx', 'coingecko'].includes(rawSource)) {
    throw new Error('BTC price task source must be one of hyperliquid/auto/binance/okx/coingecko.');
  }

  return {
    pair: 'BTCUSDT',
    source: 'hyperliquid',
    sourceRequested: rawSource,
    providers: ['hyperliquid', 'binance', 'okx']
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = String(options?.method || 'GET').trim().toUpperCase() || 'GET';
    const headers = options?.headers || {};
    const reqInit = {
      method,
      headers,
      signal: controller.signal
    };
    if (options?.body !== undefined) {
      reqInit.body = options.body;
    }
    const resp = await fetch(url, reqInit);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBtcFromHyperliquid() {
  const body = await fetchJsonWithTimeout('https://api.hyperliquid.xyz/info', 8000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' })
  });
  const price = Number(body?.BTC);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function fetchBtcFromBinance(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, 8000);
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function fetchBtcFromOkx() {
  const body = await fetchJsonWithTimeout('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT', 8000);
  const price = Number(body?.data?.[0]?.last);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function fetchBtcPriceQuote(params = {}) {
  const { pair, sourceRequested, providers } = normalizeBtcPriceParams(params);
  const failures = [];
  const attemptedProviders = [];

  for (const provider of providers) {
    attemptedProviders.push(provider);
    try {
      let price = NaN;
      if (provider === 'hyperliquid') {
        price = await fetchBtcFromHyperliquid();
      } else if (provider === 'binance') {
        price = await fetchBtcFromBinance(pair);
      } else if (provider === 'okx') {
        price = await fetchBtcFromOkx();
      }

      if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
      return {
        provider,
        pair,
        priceUsd: Number(price.toFixed(6)),
        fetchedAt: new Date().toISOString(),
        sourceRequested,
        attemptedProviders
      };
    } catch (error) {
      failures.push(`${provider}:${error?.message || 'failed'}`);
    }
  }

  throw new Error(`price_source_unavailable (${failures.join(', ') || 'no provider'})`);
}

function computeReactiveStopOrderAmount(actionParams = {}) {
  const baseAmount = Number(X402_REACTIVE_PRICE || '0.03');
  const base = Number.isFinite(baseAmount) && baseAmount > 0 ? baseAmount : 0.03;
  const qty = Number(actionParams?.quantity);
  if (Number.isFinite(qty) && qty > 0) {
    const scaled = qty * 0.01;
    const computed = Math.max(base, scaled);
    return String(Number(computed.toFixed(6)));
  }
  return String(Number(base.toFixed(6)));
}

function buildA2ACapabilities() {
  return {
    protocol: 'x402-a2a-v1',
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
    lifecycle: ['discover', 'quote', 'pay', 'execute', 'prove', 'settle'],
    actions: [
      {
        id: 'btc-price-feed',
        input: {
          pair: 'string (default BTCUSDT)',
          source: 'hyperliquid (fallback: binance, okx; legacy auto/binance/coingecko accepted)'
        },
        price: X402_BTC_PRICE,
        recipient: KITE_AGENT2_AA_ADDRESS
      },
      {
        id: 'reactive-stop-orders',
        input: {
          symbol: 'string',
          takeProfit: 'number > 0',
          stopLoss: 'number > 0',
          quantity: 'number > 0 (optional)'
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
  try {
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

    const receipt = await fetchReceiptWithRetry(txHash);
    if (!receipt) {
      return { ok: false, reason: 'transaction receipt not found (pending or unknown)' };
    }
    if (parseHexNumber(receipt.status) !== 1) {
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
        const parsed = transferIface.parseLog({
          topics: log.topics,
          data: log.data
        });
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
              blockNumber: parseHexNumber(receipt.blockNumber),
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
  } catch (error) {
    return {
      ok: false,
      reason: `proof verification rpc error: ${error?.message || 'unknown'}`
    };
  }
}

function parseHexNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (!str) return 0;
  if (str.startsWith('0x') || str.startsWith('0X')) return Number(BigInt(str));
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callRpc(method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROOF_RPC_TIMEOUT_MS);
  try {
    const resp = await fetch(BACKEND_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      throw new Error(`rpc http ${resp.status}`);
    }
    const json = await resp.json().catch(() => ({}));
    if (json?.error) {
      throw new Error(json.error?.message || 'rpc returned error');
    }
    return json?.result;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchReceiptWithRetry(txHash) {
  const retries = Number.isFinite(PROOF_RPC_RETRIES) && PROOF_RPC_RETRIES > 0 ? PROOF_RPC_RETRIES : 1;
  let lastError = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await callRpc('eth_getTransactionReceipt', [txHash]);
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        await waitMs(300 * (i + 1));
      }
    }
  }
  throw lastError || new Error('rpc receipt lookup failed');
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

function isIdentitySignatureRequired() {
  return !['registry', 'registry_only', 'service', 'service_registry'].includes(
    IDENTITY_VERIFY_MODE
  );
}

function buildIdentitySummary(profile = {}) {
  return {
    available: Boolean(profile?.available),
    chainId: String(profile?.chainId || ''),
    configured: profile?.configured || null,
    agentId: String(profile?.configured?.agentId || ''),
    registry: String(profile?.configured?.registry || ''),
    ownerAddress: String(profile?.ownerAddress || ''),
    agentWallet: String(profile?.agentWallet || ''),
    tokenURI: String(profile?.tokenURI || '')
  };
}

function createIdentityChallengeMessage({
  challengeId = '',
  traceId = '',
  nonce = '',
  issuedAt = 0,
  expiresAt = 0,
  profile = {}
} = {}) {
  return [
    'KITECLAW Identity Verification',
    `challengeId: ${challengeId}`,
    `traceId: ${traceId}`,
    `registry: ${String(profile?.configured?.registry || '')}`,
    `agentId: ${String(profile?.configured?.agentId || '')}`,
    `agentWallet: ${String(profile?.agentWallet || '')}`,
    `nonce: ${nonce}`,
    `issuedAt: ${new Date(issuedAt).toISOString()}`,
    `expiresAt: ${new Date(expiresAt).toISOString()}`
  ].join('\n');
}

function normalizeIdentityChallengeRows(rows = []) {
  const now = Date.now();
  const validRows = Array.isArray(rows)
    ? rows.filter((item) => item && typeof item === 'object')
    : [];
  const freshRows = validRows.filter((item) => {
    const expiresAt = Number(item.expiresAt || 0);
    if (item.usedAt) return now - Number(item.usedAt || 0) <= 24 * 60 * 60 * 1000;
    return expiresAt > 0 && now - expiresAt <= 24 * 60 * 60 * 1000;
  });
  const limit = Number.isFinite(IDENTITY_CHALLENGE_MAX_ROWS) && IDENTITY_CHALLENGE_MAX_ROWS > 0
    ? IDENTITY_CHALLENGE_MAX_ROWS
    : 500;
  return freshRows.slice(0, limit);
}

function getLatestIdentityChallengeSnapshot() {
  const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
  if (!rows.length) return null;
  const latest = [...rows].sort((a, b) => {
    const ta = Number(a?.verifiedAt || a?.usedAt || a?.issuedAt || 0);
    const tb = Number(b?.verifiedAt || b?.usedAt || b?.issuedAt || 0);
    return tb - ta;
  })[0];
  if (!latest) return null;
  return {
    challengeId: String(latest.challengeId || ''),
    traceId: String(latest.traceId || ''),
    status: String(latest.status || ''),
    issuedAt: Number(latest.issuedAt || 0) > 0 ? new Date(Number(latest.issuedAt)).toISOString() : '',
    expiresAt: Number(latest.expiresAt || 0) > 0 ? new Date(Number(latest.expiresAt)).toISOString() : '',
    verifiedAt: Number(latest.verifiedAt || 0) > 0 ? new Date(Number(latest.verifiedAt)).toISOString() : '',
    recoveredAddress: String(latest.recoveredAddress || ''),
    identity: {
      registry: String(latest?.identity?.registry || ''),
      agentId: String(latest?.identity?.agentId || ''),
      agentWallet: String(latest?.identity?.agentWallet || '')
    }
  };
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

app.get('/api/records', requireRole('viewer'), (req, res) => {
  res.json(readRecords());
});

app.post('/api/records', requireRole('agent'), (req, res) => {
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

app.get('/api/signer/info', requireRole('viewer'), (req, res) => {
  res.json(getBackendSignerState());
});

app.get('/api/session/runtime', requireRole('viewer'), (req, res) => {
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

app.get('/api/session/runtime/secret', requireRole('admin'), (req, res) => {
  const runtime = readSessionRuntime();
  return res.json({
    ok: true,
    runtime
  });
});

app.post('/api/session/runtime/sync', requireRole('admin'), (req, res) => {
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

app.post('/api/aa/ensure', requireRole('admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const runtime = readSessionRuntime();
    const owner = String(body.owner || runtime.owner || '').trim();
    const saltRaw = String(body.salt ?? process.env.KITECLAW_AA_SALT ?? '0').trim();
    let salt = 0n;
    try {
      salt = BigInt(saltRaw || '0');
    } catch {
      return res.status(400).json({
        ok: false,
        error: 'invalid_salt',
        reason: `Invalid salt: ${saltRaw}`,
        traceId: req.traceId || ''
      });
    }

    const ensured = await ensureAAAccountDeployment({ owner, salt });
    const merged = writeSessionRuntime({
      ...runtime,
      aaWallet: ensured.accountAddress,
      owner: ensured.owner,
      source: 'aa-ensure',
      updatedAt: Date.now()
    });

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      aaWallet: ensured.accountAddress,
      owner: ensured.owner,
      salt: ensured.salt,
      deployed: ensured.deployed,
      createdNow: ensured.createdNow,
      txHash: ensured.txHash,
      runtime: {
        ...merged,
        sessionPrivateKey: undefined,
        sessionPrivateKeyMasked: maskSecret(merged.sessionPrivateKey),
        hasSessionPrivateKey: Boolean(merged.sessionPrivateKey)
      }
    });
  } catch (error) {
    const isSignerErr =
      /backend signer unavailable|KITECLAW_BACKEND_SIGNER_PRIVATE_KEY/i.test(String(error?.message || ''));
    return res.status(isSignerErr ? 503 : 400).json({
      ok: false,
      error: isSignerErr ? 'backend_signer_unavailable' : 'aa_ensure_failed',
      reason: error?.message || 'aa_ensure_failed',
      traceId: req.traceId || ''
    });
  }
});

app.delete('/api/session/runtime', requireRole('admin'), (req, res) => {
  writeJsonObject(sessionRuntimePath, {});
  return res.json({ ok: true, cleared: true });
});

app.get('/api/identity', requireRole('viewer'), async (req, res) => {
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

app.get('/api/identity/current', requireRole('viewer'), async (req, res) => {
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

app.post('/api/identity/challenge', requireRole('viewer'), async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await readIdentityProfile({
      registry: body.identityRegistry || body.registry,
      agentId: body.agentId
    });
    if (!profile?.available) {
      return res.status(400).json({
        ok: false,
        error: 'identity_unavailable',
        reason: profile?.reason || 'identity_unavailable',
        profile: buildIdentitySummary(profile),
        traceId: req.traceId || ''
      });
    }

    const agentWallet = normalizeAddress(profile.agentWallet || '');
    if (!ethers.isAddress(agentWallet)) {
      return res.status(400).json({
        ok: false,
        error: 'identity_wallet_invalid',
        reason: 'Configured identity wallet is invalid.',
        profile: buildIdentitySummary(profile),
        traceId: req.traceId || ''
      });
    }

    if (!isIdentitySignatureRequired()) {
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        challenge: {
          mode: 'registry',
          signatureRequired: false
        },
        profile: buildIdentitySummary(profile)
      });
    }

    const now = Date.now();
    const challengeId = createTraceId('idv');
    const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
    const ttl = Number.isFinite(IDENTITY_CHALLENGE_TTL_MS) && IDENTITY_CHALLENGE_TTL_MS > 0
      ? IDENTITY_CHALLENGE_TTL_MS
      : 120_000;
    const expiresAt = now + ttl;
    const message = createIdentityChallengeMessage({
      challengeId,
      traceId: req.traceId || '',
      nonce,
      issuedAt: now,
      expiresAt,
      profile
    });

    const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
    rows.unshift({
      challengeId,
      traceId: req.traceId || '',
      nonce,
      message,
      issuedAt: now,
      expiresAt,
      identity: {
        registry: String(profile?.configured?.registry || ''),
        agentId: String(profile?.configured?.agentId || ''),
        agentWallet
      },
      status: 'issued'
    });
    writeIdentityChallenges(normalizeIdentityChallengeRows(rows));

    return res.json({
      ok: true,
      traceId: req.traceId || '',
      challenge: {
        challengeId,
        message,
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        ttlMs: ttl
      },
      profile: buildIdentitySummary(profile)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'identity_challenge_failed',
      reason: error?.message || 'challenge failed',
      traceId: req.traceId || ''
    });
  }
});

app.post('/api/identity/verify', requireRole('viewer'), async (req, res) => {
  try {
    const body = req.body || {};
    const challengeId = String(body.challengeId || '').trim();
    const signature = String(body.signature || '').trim();
    if (!challengeId) {
      return res.status(400).json({
        ok: false,
        error: 'challenge_required',
        reason: 'challengeId is required.',
        traceId: req.traceId || ''
      });
    }
    if (!signature) {
      return res.status(400).json({
        ok: false,
        error: 'signature_required',
        reason: 'signature is required.',
        traceId: req.traceId || ''
      });
    }

    const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
    const idx = rows.findIndex((item) => String(item?.challengeId || '') === challengeId);
    if (idx < 0) {
      return res.status(404).json({
        ok: false,
        error: 'challenge_not_found',
        reason: 'challenge not found',
        traceId: req.traceId || ''
      });
    }

    const entry = rows[idx];
    const now = Date.now();
    if (Number(entry.usedAt || 0) > 0) {
      return res.status(409).json({
        ok: false,
        error: 'challenge_used',
        reason: 'challenge already used',
        traceId: req.traceId || ''
      });
    }
    if (now > Number(entry.expiresAt || 0)) {
      entry.status = 'expired';
      rows[idx] = entry;
      writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
      return res.status(410).json({
        ok: false,
        error: 'challenge_expired',
        reason: 'challenge expired',
        traceId: req.traceId || ''
      });
    }

    const profile = await readIdentityProfile({
      registry: entry?.identity?.registry || '',
      agentId: entry?.identity?.agentId || ''
    });
    if (!profile?.available) {
      return res.status(400).json({
        ok: false,
        error: 'identity_unavailable',
        reason: profile?.reason || 'identity_unavailable',
        profile: buildIdentitySummary(profile),
        traceId: req.traceId || ''
      });
    }

    const expectedWallet = normalizeAddress(profile.agentWallet || '');
    if (!ethers.isAddress(expectedWallet)) {
      return res.status(400).json({
        ok: false,
        error: 'identity_wallet_invalid',
        reason: 'Configured identity wallet is invalid.',
        profile: buildIdentitySummary(profile),
        traceId: req.traceId || ''
      });
    }

    let recoveredAddress = '';
    try {
      recoveredAddress = normalizeAddress(ethers.verifyMessage(String(entry.message || ''), signature));
    } catch (error) {
      return res.status(401).json({
        ok: false,
        error: 'invalid_signature',
        reason: error?.message || 'invalid signature',
        traceId: req.traceId || ''
      });
    }

    if (recoveredAddress !== expectedWallet) {
      return res.status(401).json({
        ok: false,
        error: 'invalid_signature',
        reason: 'signature does not match configured agent wallet',
        expected: expectedWallet,
        recovered: recoveredAddress,
        traceId: req.traceId || ''
      });
    }

    entry.status = 'verified';
    entry.usedAt = now;
    entry.verifiedAt = now;
    entry.recoveredAddress = recoveredAddress;
    rows[idx] = entry;
    writeIdentityChallenges(normalizeIdentityChallengeRows(rows));

    return res.json({
      ok: true,
      verified: true,
      traceId: req.traceId || '',
      challengeId,
      verifiedAt: new Date(now).toISOString(),
      profile: buildIdentitySummary(profile)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'identity_verify_failed',
      reason: error?.message || 'identity verify failed',
      traceId: req.traceId || ''
    });
  }
});

app.get('/api/demo/identity/latest', requireRole('viewer'), (req, res) => {
  const latest = getLatestIdentityChallengeSnapshot();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    verifyMode: IDENTITY_VERIFY_MODE,
    latest
  });
});

app.get('/api/x402/mapping/latest', requireRole('viewer'), (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
  const workflows = readWorkflows();
  const workflowByRequestId = buildLatestWorkflowByRequestId(workflows);
  const rows = readX402Requests()
    .map((item) => mapX402Item(item, workflowByRequestId.get(String(item?.requestId || '').trim()) || null))
    .slice(0, limit);
  const kpi = computeDashboardKpi(readX402Requests());
  return res.json({ ok: true, total: rows.length, kpi, items: rows });
});

app.get('/api/onchain/latest', requireRole('viewer'), (req, res) => {
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

app.post('/api/chat/agent', requireRole('agent'), async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();
  const traceId = String(req.body?.traceId || `trace_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`).trim();
  const agent = String(req.body?.agent || '').trim();
  const history = Array.isArray(req.body?.history)
    ? req.body.history
        .slice(-20)
        .map((item) => ({
          role: String(item?.role || '').trim(),
          content: String(item?.content || item?.text || item?.message || '').trim()
        }))
        .filter((item) => item.content)
    : [];

  if (!message) {
    return res.status(400).json({
      ok: false,
      error: 'message_required',
      reason: 'message is required',
      traceId
    });
  }

  try {
    const runtime = readSessionRuntime();
    const inferStopOrderIntent = ({ text = '', suggestions = [] }) => {
      const fromSuggestions = Array.isArray(suggestions)
        ? suggestions.find((item) => {
            const action = String(item?.action || '').trim().toLowerCase();
            const endpoint = String(item?.endpoint || '').trim().toLowerCase();
            return (
              action === 'place_stop_order' ||
              action === 'reactive-stop-orders' ||
              endpoint.includes('/workflow/stop-order/run') ||
              endpoint.includes('/a2a/tasks/stop-orders')
            );
          })
        : null;

      if (fromSuggestions) {
        try {
          const params = fromSuggestions?.params || fromSuggestions?.task || {};
          return normalizeReactiveParams(params);
        } catch {
          // fall through to text parser
        }
      }

      const raw = String(text || '').trim();
      if (!raw) return null;
      const triggerLike = /(stop[\s-]*order|reactive\s*stop|a2a|agent\s*to\s*agent|a\s*to\s*a|tp|sl)/i.test(raw);
      if (!triggerLike) return null;

      const symbolCandidates = Array.from(
        raw.matchAll(/\b([A-Za-z]{2,10}\s*[-/]\s*[A-Za-z]{2,10})\b/g),
        (m) => String(m?.[1] || '').replace(/\s+/g, '').replace('/', '-').toUpperCase()
      ).filter(Boolean);
      const symbolFromText =
        symbolCandidates.find((s) => /(USDT|USD|BTC|ETH|BNB|SOL)$/.test(s.split('-')[1] || '')) ||
        symbolCandidates.find((s) => s !== 'STOP-ORDER' && s !== 'TAKE-PROFIT' && s !== 'STOP-LOSS') ||
        '';
      const tpMatch = raw.match(/(?:\btp\b|take\s*profit)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
      const slMatch = raw.match(/(?:\bsl\b|stop\s*loss)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
      const qtyMatch = raw.match(/(?:\bqty\b|quantity|size|amount)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
      if (!tpMatch || !slMatch) return null;

      try {
        const parsed = {
          symbol: symbolFromText || 'BTC-USDT',
          takeProfit: Number(tpMatch[1]),
          stopLoss: Number(slMatch[1])
        };
        if (qtyMatch) {
          parsed.quantity = Number(qtyMatch[1]);
        }
        return normalizeReactiveParams(parsed);
      } catch {
        return null;
      }
    };

    const runStopOrderWorkflow = async ({ intent, workflowTraceId }) => {
      const internalApiKey = getInternalAgentApiKey();
      const headers = { 'Content-Type': 'application/json' };
      if (internalApiKey) {
        headers['x-api-key'] = internalApiKey;
      }
      const payer = normalizeAddress(req.body?.payer || runtime?.aaWallet || '');
      const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
      const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
      const workflowResp = await fetch(`http://127.0.0.1:${PORT}/api/workflow/stop-order/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          symbol: intent.symbol,
          takeProfit: intent.takeProfit,
          stopLoss: intent.stopLoss,
          ...(Number.isFinite(intent.quantity) ? { quantity: intent.quantity } : {}),
          payer,
          sourceAgentId,
          targetAgentId,
          traceId: workflowTraceId
        })
      });
      const workflowBody = await workflowResp.json().catch(() => ({}));
      return {
        ok: workflowResp.ok && Boolean(workflowBody?.ok),
        status: workflowResp.status,
        body: workflowBody
      };
    };

    const fallbackIntent = inferStopOrderIntent({ text: message, suggestions: [] });
    let result = await openclawAdapter.chat({
      message,
      sessionId,
      traceId,
      history,
      agent,
      context: {
        aaWallet: runtime?.aaWallet || '',
        owner: runtime?.owner || '',
        runtimeReady: Boolean(runtime?.sessionAddress && runtime?.sessionPrivateKey)
      }
    });

    if (!result?.ok && fallbackIntent) {
      result = {
        ok: true,
        mode: 'intent-fallback',
        reply: 'Intent recognized. Running x402 stop-order workflow now.',
        traceId,
        state: 'intent_recognized',
        step: 'intent_parsed',
        suggestions: [
          {
            action: 'place_stop_order',
            endpoint: '/api/workflow/stop-order/run',
            params: fallbackIntent
          }
        ]
      };
    }

    if (!result?.ok) {
      return res.status(result?.statusCode || 503).json({
        ok: false,
        error: result?.error || 'openclaw_adapter_error',
        reason: result?.reason || 'OpenClaw adapter failed',
        traceId: result?.traceId || traceId
      });
    }

    const resolvedSuggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    const intent = inferStopOrderIntent({ text: message, suggestions: resolvedSuggestions });
    const nextTraceId = String(result.traceId || traceId).trim() || traceId;

    if (intent) {
      const workflow = await runStopOrderWorkflow({
        intent,
        workflowTraceId: nextTraceId
      });
      if (!workflow.ok) {
        return res.status(workflow.status || 500).json({
          ok: false,
          mode: 'x402',
          error: workflow.body?.error || 'workflow_failed',
          reason: workflow.body?.reason || `workflow failed: HTTP ${workflow.status}`,
          traceId: nextTraceId,
          state: workflow.body?.state || 'failed',
          step: 'workflow_failed'
        });
      }

      return res.json({
        ok: true,
        mode: 'x402',
        reply:
          workflow.body?.state === 'unlocked'
            ? `A2A stop-order unlocked: ${intent.symbol} TP ${intent.takeProfit} SL ${intent.stopLoss}${
              Number.isFinite(intent.quantity) ? ` QTY ${intent.quantity}` : ''
            }`
            : (result.reply || 'Workflow accepted.'),
        traceId: nextTraceId,
        sessionId: sessionId || null,
        state: workflow.body?.state || 'unlocked',
        step: workflow.body?.state === 'unlocked' ? 'workflow_unlocked' : 'workflow_running',
        requestId: workflow.body?.requestId || workflow.body?.workflow?.requestId || '',
        txHash: workflow.body?.txHash || workflow.body?.workflow?.txHash || '',
        userOpHash: workflow.body?.userOpHash || workflow.body?.workflow?.userOpHash || '',
        suggestions: resolvedSuggestions
      });
    }

    return res.json({
      ok: true,
      mode: result.mode || 'local-fallback',
      reply: result.reply || 'Received.',
      traceId: nextTraceId,
      sessionId: sessionId || null,
      state: result.state || 'received',
      step: result.step || 'chat_received',
      suggestions: resolvedSuggestions
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'chat_agent_internal_error',
      reason: error?.message || 'chat failed',
      traceId
    });
  }
});

app.get('/api/chat/agent/health', requireRole('viewer'), async (req, res) => {
  try {
    const adapterInfo = typeof openclawAdapter.info === 'function' ? openclawAdapter.info() : {};
    const health = await openclawAdapter.health();
    if (!health?.ok) {
      return res.status(503).json({
        ok: false,
        error: 'openclaw_unreachable',
        mode: health?.mode || 'remote',
        connected: false,
        reason: health?.reason || 'OpenClaw health check failed',
        adapter: adapterInfo,
        traceId: req.traceId || ''
      });
    }
    return res.json({
      ok: true,
      mode: health.mode || 'local-fallback',
      connected: Boolean(health.connected),
      reason: health.reason || 'ok',
      adapter: adapterInfo,
      traceId: req.traceId || ''
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'openclaw_health_error',
      connected: false,
      reason: error?.message || 'OpenClaw health failed',
      traceId: req.traceId || ''
    });
  }
});

app.get('/api/events/stream', requireRole('viewer'), (req, res) => {
  openSseStream(req, res);
});

app.get('/api/demo/stream', requireRole('viewer'), (req, res) => {
  openSseStream(req, res);
});

app.post('/api/workflow/stop-order/run', requireRole('agent'), async (req, res) => {
  const symbol = String(req.body?.symbol || 'BTC-USDT').trim().toUpperCase();
  const takeProfit = Number(req.body?.takeProfit);
  const stopLoss = Number(req.body?.stopLoss);
  const quantityText = String(req.body?.quantity ?? '').trim();
  const hasQuantity = quantityText !== '';
  const quantity = hasQuantity ? Number(quantityText) : null;
  const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = resolveWorkflowTraceId(req.body?.traceId);
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
  const taskPayload = {
    symbol,
    takeProfit,
    stopLoss,
    ...(hasQuantity ? { quantity } : {})
  };
  const workflow = {
    traceId,
    type: 'stop-order',
    state: 'running',
    sourceAgentId,
    targetAgentId,
    payer,
    input: taskPayload,
    requestId: '',
    txHash: '',
    userOpHash: '',
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  upsertWorkflow(workflow);
  broadcastEvent('workflow_started', { traceId, state: workflow.state, input: workflow.input });

  try {
    if (!symbol || !Number.isFinite(takeProfit) || !Number.isFinite(stopLoss) || takeProfit <= 0 || stopLoss <= 0) {
      throw new Error('Invalid stop-order params. symbol/takeProfit/stopLoss are required.');
    }
    if (hasQuantity && (!Number.isFinite(quantity) || quantity <= 0)) {
      throw new Error('Invalid stop-order params. quantity must be > 0 when provided.');
    }

    const challengeResult = await handleA2AStopOrders({
      payer,
      sourceAgentId,
      targetAgentId,
      traceId,
      task: taskPayload
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
    broadcastEvent('challenge_issued', {
      traceId,
      requestId,
      amount: accept.amount,
      recipient: accept.recipient,
      symbol,
      takeProfit,
      stopLoss,
      ...(hasQuantity ? { quantity } : {})
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const internalApiKey = getInternalAgentApiKey();
    const payHeaders = { 'Content-Type': 'application/json' };
    if (internalApiKey) {
      payHeaders['x-api-key'] = internalApiKey;
    }
    const payResp = await fetch(`http://127.0.0.1:${PORT}/api/session/pay`, {
      method: 'POST',
      headers: payHeaders,
      body: JSON.stringify({
        tokenAddress: accept.tokenAddress,
        recipient: accept.recipient,
        amount: accept.amount,
        requestId,
        action: 'reactive-stop-orders',
        query: `A2A stop-order ${symbol} tp=${takeProfit} sl=${stopLoss}${
          hasQuantity ? ` qty=${quantity}` : ''
        }`
      })
    });
    const payBody = await payResp.json().catch(() => ({}));
    if (!payResp.ok || !payBody?.ok) {
      const payError = String(payBody?.error || '').trim().toLowerCase();
      if (payError === 'insufficient_funds') {
        const required = String(payBody?.details?.required || accept.amount || '').trim();
        const balance = String(payBody?.details?.balance || '').trim();
        const err = new Error(
          `Insufficient balance: requires ${required || accept.amount} USDT, current balance ${balance || 'unknown'}.`
        );
        err.code = 'insufficient_funds';
        err.required = required || String(accept.amount || '');
        err.balance = balance || '';
        throw err;
      }
      if (payError === 'insufficient_kite_gas') {
        const requiredGas = String(payBody?.details?.required || '0.0001').trim();
        const gasBalance = String(payBody?.details?.balance || '').trim();
        const err = new Error(
          `Insufficient KITE gas: requires >= ${requiredGas} KITE, current balance ${gasBalance || 'unknown'}.`
        );
        err.code = 'insufficient_kite_gas';
        err.requiredGas = requiredGas;
        err.balance = gasBalance || '';
        throw err;
      }
      if (payError === 'unsupported_settlement_token' || payError === 'invalid_token_contract') {
        const err = new Error(payBody?.reason || 'Settlement token config is invalid.');
        err.code = payError;
        throw err;
      }
      if (payError === 'session_not_found' || payError === 'session_agent_mismatch' || payError === 'session_rule_failed') {
        const err = new Error(payBody?.reason || payError);
        err.code = payError;
        throw err;
      }
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
    broadcastEvent('payment_sent', {
      traceId,
      requestId,
      txHash,
      userOpHash,
      symbol,
      takeProfit,
      stopLoss,
      ...(hasQuantity ? { quantity } : {})
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const proofResult = await handleA2AStopOrders({
      payer,
      sourceAgentId,
      targetAgentId,
      traceId,
      requestId,
      paymentProof: {
        requestId,
        txHash,
        payer,
        tokenAddress: accept.tokenAddress,
        recipient: accept.recipient,
        amount: accept.amount
      },
      task: taskPayload
    });
    if (proofResult.status !== 200) {
      throw new Error(
        proofResult?.body?.reason || proofResult?.body?.error || `proof submit failed: ${proofResult.status}`
      );
    }
    appendWorkflowStep(workflow, 'proof_submitted', 'ok', {
      verified: true
    });
    broadcastEvent('proof_submitted', { traceId, requestId, verified: true });
    appendWorkflowStep(workflow, 'unlocked', 'ok', {
      result: proofResult?.body?.result?.summary || ''
    });
    broadcastEvent('unlocked', {
      traceId,
      requestId,
      txHash,
      summary: proofResult?.body?.result?.summary || '',
      symbol,
      takeProfit,
      stopLoss,
      ...(hasQuantity ? { quantity } : {})
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
      workflow,
      receipt: proofResult?.body?.receipt || null
    });
  } catch (error) {
    appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
    broadcastEvent('failed', {
      traceId,
      state: 'failed',
      reason: error.message,
      code: error?.code || 'workflow_failed',
      required: error?.required || '',
      balance: error?.balance || ''
    });
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
      workflow,
      receipt:
        workflow.requestId && workflow.sourceAgentId && workflow.targetAgentId
          ? buildA2AReceipt(
              {
                requestId: workflow.requestId,
                status: 'pending',
                action: 'reactive-stop-orders',
                query: `A2A stop-order ${workflow?.input?.symbol || ''}`.trim(),
                payer: workflow.payer || '',
                amount: '',
                tokenAddress: SETTLEMENT_TOKEN,
                recipient: KITE_AGENT2_AA_ADDRESS,
                paymentTxHash: workflow.txHash || '',
                a2a: {
                  sourceAgentId: workflow.sourceAgentId,
                  targetAgentId: workflow.targetAgentId,
                  taskType: 'reactive-stop-orders',
                  traceId
                }
              },
              workflow,
              { state: 'failed', phase: 'failed', error: error.message, traceId }
            )
          : null
    });
  }
});

app.post('/api/workflow/btc-price/run', requireRole('agent'), async (req, res) => {
  const pair = String(req.body?.pair || 'BTCUSDT').trim().toUpperCase();
  const source = String(req.body?.source || 'auto').trim().toLowerCase();
  const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = resolveWorkflowTraceId(req.body?.traceId);
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
  const workflow = {
    traceId,
    type: 'btc-price',
    state: 'running',
    sourceAgentId,
    targetAgentId,
    payer,
    input: { pair, source },
    requestId: '',
    txHash: '',
    userOpHash: '',
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  upsertWorkflow(workflow);
  broadcastEvent('workflow_started', { traceId, state: workflow.state, input: workflow.input });

  try {
    const challengeResult = await handleA2ABtcPrice({
      payer,
      sourceAgentId,
      targetAgentId,
      traceId,
      task: { pair, source }
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
    broadcastEvent('challenge_issued', {
      traceId,
      requestId,
      amount: accept.amount,
      recipient: accept.recipient,
      pair,
      source
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const internalApiKey = getInternalAgentApiKey();
    const payHeaders = { 'Content-Type': 'application/json' };
    if (internalApiKey) {
      payHeaders['x-api-key'] = internalApiKey;
    }
    const payResp = await fetch(`http://127.0.0.1:${PORT}/api/session/pay`, {
      method: 'POST',
      headers: payHeaders,
      body: JSON.stringify({
        tokenAddress: accept.tokenAddress,
        recipient: accept.recipient,
        amount: accept.amount,
        requestId,
        action: 'btc-price-feed',
        query: `A2A BTC price ${pair} source=${source}`
      })
    });
    const payBody = await payResp.json().catch(() => ({}));
    if (!payResp.ok || !payBody?.ok) {
      const payError = String(payBody?.error || '').trim().toLowerCase();
      if (payError === 'insufficient_funds') {
        const required = String(payBody?.details?.required || accept.amount || '').trim();
        const balance = String(payBody?.details?.balance || '').trim();
        const err = new Error(
          `Insufficient balance: requires ${required || accept.amount} USDT, current balance ${balance || 'unknown'}.`
        );
        err.code = 'insufficient_funds';
        err.required = required || String(accept.amount || '');
        err.balance = balance || '';
        throw err;
      }
      if (payError === 'insufficient_kite_gas') {
        const requiredGas = String(payBody?.details?.required || '0.0001').trim();
        const gasBalance = String(payBody?.details?.balance || '').trim();
        const err = new Error(
          `Insufficient KITE gas: requires >= ${requiredGas} KITE, current balance ${gasBalance || 'unknown'}.`
        );
        err.code = 'insufficient_kite_gas';
        err.requiredGas = requiredGas;
        err.balance = gasBalance || '';
        throw err;
      }
      throw new Error(payBody?.reason || payBody?.error || `session pay failed: HTTP ${payResp.status}`);
    }
    const txHash = String(payBody?.payment?.txHash || '').trim();
    const userOpHash = String(payBody?.payment?.userOpHash || '').trim();
    if (!txHash) throw new Error('session pay returned empty txHash.');
    workflow.txHash = txHash;
    workflow.userOpHash = userOpHash;
    appendWorkflowStep(workflow, 'payment_sent', 'ok', { txHash, userOpHash });
    broadcastEvent('payment_sent', {
      traceId,
      requestId,
      txHash,
      userOpHash,
      pair,
      source
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const proofResult = await handleA2ABtcPrice({
      payer,
      sourceAgentId,
      targetAgentId,
      traceId,
      requestId,
      paymentProof: {
        requestId,
        txHash,
        payer,
        tokenAddress: accept.tokenAddress,
        recipient: accept.recipient,
        amount: accept.amount
      },
      task: { pair, source }
    });
    if (proofResult.status !== 200) {
      throw new Error(
        proofResult?.body?.reason || proofResult?.body?.error || `proof submit failed: ${proofResult.status}`
      );
    }
    appendWorkflowStep(workflow, 'proof_submitted', 'ok', { verified: true });
    broadcastEvent('proof_submitted', { traceId, requestId, verified: true });
    appendWorkflowStep(workflow, 'unlocked', 'ok', {
      result: proofResult?.body?.result?.summary || ''
    });
    broadcastEvent('unlocked', {
      traceId,
      requestId,
      txHash,
      summary: proofResult?.body?.result?.summary || '',
      pair,
      source
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
      workflow,
      receipt: proofResult?.body?.receipt || null
    });
  } catch (error) {
    appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
    broadcastEvent('failed', {
      traceId,
      state: 'failed',
      reason: error.message,
      code: error?.code || 'workflow_failed'
    });
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
      workflow,
      receipt:
        workflow.requestId && workflow.sourceAgentId && workflow.targetAgentId
          ? buildA2AReceipt(
              {
                requestId: workflow.requestId,
                status: 'pending',
                action: 'btc-price-feed',
                query: `A2A BTC price ${workflow?.input?.pair || 'BTCUSDT'}`.trim(),
                payer: workflow.payer || '',
                amount: String(X402_BTC_PRICE || ''),
                tokenAddress: SETTLEMENT_TOKEN,
                recipient: KITE_AGENT2_AA_ADDRESS,
                paymentTxHash: workflow.txHash || '',
                a2a: {
                  sourceAgentId: workflow.sourceAgentId,
                  targetAgentId: workflow.targetAgentId,
                  taskType: 'btc-price-feed',
                  traceId
                }
              },
              workflow,
              { state: 'failed', phase: 'failed', error: error.message, traceId }
            )
          : null
    });
  }
});

app.get('/api/workflow/:traceId', requireRole('viewer'), (req, res) => {
  const traceId = String(req.params.traceId || '').trim();
  if (!traceId) {
    return res.status(400).json({ ok: false, error: 'traceId_required' });
  }
  const rows = readWorkflows();
  const workflow = rows.find((w) => String(w.traceId || '') === traceId);
  if (!workflow) {
    return res.status(404).json({ ok: false, error: 'workflow_not_found', traceId });
  }
  const reqItem = readX402Requests().find((item) => String(item.requestId || '') === String(workflow.requestId || ''));
  return res.json({
    ok: true,
    traceId,
    workflow,
    receipt: reqItem?.a2a ? buildA2AReceipt(reqItem, workflow, { traceId }) : null
  });
});

app.get('/api/demo/trace/:traceId', requireRole('viewer'), (req, res) => {
  const traceId = String(req.params.traceId || '').trim();
  if (!traceId) {
    return res.status(400).json({ ok: false, error: 'traceId_required' });
  }

  const workflows = readWorkflows();
  const workflow = workflows.find((w) => String(w.traceId || '') === traceId);
  if (!workflow) {
    return res.status(404).json({ ok: false, error: 'workflow_not_found', traceId });
  }

  const reqItem = readX402Requests().find((item) => String(item.requestId || '') === String(workflow.requestId || ''));
  const mapped = reqItem ? mapX402Item(reqItem, workflow) : null;
  const receipt = reqItem?.a2a ? buildA2AReceipt(reqItem, workflow, { traceId }) : null;
  const identityLatest = getLatestIdentityChallengeSnapshot();

  const hasIdentity = Boolean(reqItem?.identity?.registry || reqItem?.identity?.agentId);
  const hasChallenge = Boolean(
    workflow?.requestId ||
      (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'challenge_issued'))
  );
  const hasPayment = Boolean(
    workflow?.txHash ||
      reqItem?.paymentTxHash ||
      reqItem?.paymentProof?.txHash ||
      (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'payment_sent'))
  );
  const hasProof = Boolean(
    reqItem?.proofVerification ||
      (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'proof_submitted'))
  );
  const hasApiResult = Boolean(
    workflow?.result ||
      String(workflow?.state || '').trim().toLowerCase() === 'unlocked' ||
      (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'unlocked'))
  );
  const hasOnchain = Boolean(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash);
  const workflowState = normalizeExecutionState(workflow?.state || '', 'running');

  const order = ['identity', 'challenge', 'payment', 'proof', 'api_result', 'onchain'];
  const stepState = {
    identity: hasIdentity ? 'success' : 'waiting',
    challenge: hasChallenge ? 'success' : 'waiting',
    payment: hasPayment ? 'success' : 'waiting',
    proof: hasProof ? 'success' : 'waiting',
    api_result: hasApiResult ? 'success' : 'waiting',
    onchain: hasOnchain ? 'success' : 'waiting'
  };

  if (workflowState === 'failed') {
    const failedStep =
      order.find((id) => stepState[id] !== 'success') ||
      'api_result';
    stepState[failedStep] = 'failed';
  } else {
    const runningStep = order.find((id) => stepState[id] !== 'success');
    if (runningStep) {
      stepState[runningStep] = 'running';
    }
  }

  const timeline = [
    {
      id: 'identity',
      label: 'ERC8004 Identity',
      state: stepState.identity,
      detail: hasIdentity
        ? `agentId ${String(reqItem?.identity?.agentId || '-')}`
        : 'waiting for identity metadata'
    },
    {
      id: 'challenge',
      label: 'x402 Challenge',
      state: stepState.challenge,
      detail: hasChallenge ? `requestId ${String(workflow?.requestId || reqItem?.requestId || '-')}` : 'waiting for challenge'
    },
    {
      id: 'payment',
      label: 'Payment Sent',
      state: stepState.payment,
      detail: hasPayment ? `tx ${String(workflow?.txHash || reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || '-')}` : 'waiting for payment'
    },
    {
      id: 'proof',
      label: 'Proof Verified',
      state: stepState.proof,
      detail: hasProof ? 'on-chain transfer log matched' : 'waiting for proof verification'
    },
    {
      id: 'api_result',
      label: 'API Result',
      state: stepState.api_result,
      detail: hasApiResult ? String(workflow?.result?.summary || reqItem?.result?.summary || 'result unlocked') : 'waiting for result unlock'
    },
    {
      id: 'onchain',
      label: 'On-chain Evidence',
      state: stepState.onchain,
      detail: hasOnchain ? String(workflow?.txHash || reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || '-') : 'waiting for tx evidence'
    }
  ];

  return res.json({
    ok: true,
    traceId,
    state: workflowState,
    workflow,
    request: reqItem || null,
    mapped,
    receipt,
    identityLatest,
    timeline
  });
});

app.get('/api/evidence/export', requireRole('viewer'), (req, res) => {
  const traceId = String(req.query.traceId || '').trim();
  if (!traceId) {
    return res.status(400).json({ ok: false, error: 'traceId_required' });
  }

  const workflows = readWorkflows();
  const workflow = workflows.find((w) => String(w.traceId || '') === traceId);
  if (!workflow) {
    return res.status(404).json({ ok: false, error: 'workflow_not_found', traceId });
  }

  const requests = readX402Requests();
  const reqItem = requests.find((r) => String(r.requestId || '') === String(workflow.requestId || ''));
  const records = readRecords();
  const paymentRecord = records.find((r) => String(r.txHash || '').toLowerCase() === String(workflow.txHash || '').toLowerCase());
  const runtime = readSessionRuntime();

  const exportPayload = {
    traceId,
    exportedAt: new Date().toISOString(),
    workflow: workflow || null,
    a2aReceipt: reqItem?.a2a ? buildA2AReceipt(reqItem, workflow, { traceId }) : null,
    x402: reqItem
      ? {
          requestId: reqItem.requestId || '',
          status: reqItem.status || '',
          action: reqItem.action || '',
          amount: reqItem.amount || '',
          payer: reqItem.payer || '',
          recipient: reqItem.recipient || '',
          tokenAddress: reqItem.tokenAddress || '',
          paymentTxHash: reqItem.paymentTxHash || reqItem?.paymentProof?.txHash || '',
          proofVerification: reqItem.proofVerification || null,
          policy: reqItem.policy || null,
          identity: reqItem.identity || null,
          actionParams: reqItem.actionParams || null,
          a2a: reqItem.a2a || null
        }
      : null,
    paymentRecord: paymentRecord || null,
    runtimeSnapshot: {
      aaWallet: runtime.aaWallet || '',
      sessionAddress: runtime.sessionAddress || '',
      sessionId: runtime.sessionId || '',
      maxPerTx: runtime.maxPerTx || 0,
      dailyLimit: runtime.dailyLimit || 0,
      gatewayRecipient: runtime.gatewayRecipient || ''
    }
  };

  return res.json({ ok: true, traceId, evidence: exportPayload });
});

app.get('/api/a2a/capabilities', (req, res) => {
  res.json({ ok: true, capabilities: buildA2ACapabilities() });
});

app.get('/api/a2a/receipts', requireRole('viewer'), (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 500));
  const items = listA2AReceipts({
    sourceAgentId: req.query.sourceAgentId,
    targetAgentId: req.query.targetAgentId,
    capability: req.query.capability,
    state: req.query.state,
    limit
  });
  return res.json({
    ok: true,
    total: items.length,
    items
  });
});

app.get('/api/a2a/network/graph', requireRole('viewer'), (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 200), 1000));
  const recent = Math.max(1, Math.min(Number(req.query.recent || 20), 200));
  const items = listA2AReceipts({
    sourceAgentId: req.query.sourceAgentId,
    targetAgentId: req.query.targetAgentId,
    capability: req.query.capability,
    state: req.query.state,
    limit
  });
  const graph = buildA2ANetworkGraph(items);
  return res.json({
    ok: true,
    total: items.length,
    graph,
    recent: items.slice(0, recent)
  });
});

async function handleA2ABtcPrice(body = {}) {
  const payer = String(body.payer || '').trim();
  const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = String(body.traceId || '').trim();
  const requestId = String(body.requestId || '').trim();
  const paymentProof = body.paymentProof;
  const taskInput = body.task || {};

  let task = null;
  try {
    task = normalizeBtcPriceParams({
      pair: body.pair || taskInput.pair,
      source: body.source || taskInput.source
    });
  } catch (error) {
    return {
      status: 400,
      body: {
        error: 'invalid_task',
        reason: error.message
      }
    };
  }

  const actionCfg = getActionConfig('btc-price-feed');
  const actionAmount = String(actionCfg?.amount || X402_BTC_PRICE || '0.00001');
  const requests = readX402Requests();
  const a2aQuery = `A2A BTC price ${task.pair} source=${task.source}`;

  if (!requestId || !paymentProof) {
    const policyResult = evaluateTransferPolicy({
      payer,
      recipient: actionCfg.recipient,
      amount: actionAmount,
      requests
    });
    if (!policyResult.ok) {
      logPolicyFailure({
        action: 'a2a-btc-price-feed',
        payer,
        recipient: actionCfg.recipient,
        amount: actionAmount,
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
      amount: actionAmount,
      recipient: actionCfg.recipient,
      policy: {
        decision: 'allowed',
        snapshot: buildPolicySnapshot(),
        evidence: policyResult.evidence
      }
    });
    reqItem.actionParams = task;
    reqItem.a2a = {
      sourceAgentId,
      targetAgentId,
      taskType: 'btc-price-feed',
      traceId
    };
    requests.unshift(reqItem);
    writeX402Requests(requests);
    const receipt = buildA2AReceipt(reqItem, null, {
      traceId,
      phase: 'payment_required',
      state: 'running'
    });

    return {
      status: 402,
      body: {
        ...buildPaymentRequiredResponse(reqItem),
        a2a: {
          protocol: 'x402-a2a-v1',
          sourceAgentId,
          targetAgentId,
          taskType: 'btc-price-feed',
          task
        },
        receipt
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
    let quote = reqItem?.result?.quote || null;
    if (!quote) {
      try {
        quote = await fetchBtcPriceQuote(reqItem.actionParams || task);
      } catch {
        quote = null;
      }
    }
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'x402',
        requestId: reqItem.requestId,
        reused: true,
        result: {
          summary: reqItem?.result?.summary || 'A2A BTC price quote already unlocked',
          quote
        },
        a2a: reqItem.a2a || null,
        receipt: buildA2AReceipt(reqItem, null, {
          traceId,
          sourceAgentId,
          targetAgentId,
          capability: 'btc-price-feed',
          phase: 'settled',
          state: 'success',
          summary: reqItem?.result?.summary || 'A2A BTC price quote already unlocked'
        })
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

  const quote = await fetchBtcPriceQuote(reqItem.actionParams || task);
  const quoteSummary = `BTC ${quote.pair} = $${quote.priceUsd} (${quote.provider})`;

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
  reqItem.a2a = {
    ...(reqItem.a2a || {}),
    sourceAgentId: String(reqItem?.a2a?.sourceAgentId || sourceAgentId).trim(),
    targetAgentId: String(reqItem?.a2a?.targetAgentId || targetAgentId).trim(),
    taskType: String(reqItem?.a2a?.taskType || 'btc-price-feed').trim(),
    traceId: String(reqItem?.a2a?.traceId || traceId).trim()
  };
  reqItem.result = {
    summary: `A2A BTC price quote unlocked by x402 payment: ${quoteSummary}`,
    quote
  };
  writeX402Requests(requests);

  const receipt = buildA2AReceipt(reqItem, null, {
    traceId: reqItem?.a2a?.traceId || traceId,
    sourceAgentId,
    targetAgentId,
    capability: 'btc-price-feed',
    phase: 'settled',
    state: 'success',
    summary: reqItem?.result?.summary || quoteSummary
  });

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
      result: reqItem.result,
      a2a: reqItem.a2a || {
        sourceAgentId,
        targetAgentId,
        taskType: 'btc-price-feed'
      },
      receipt
    }
  };
}

async function handleA2AStopOrders(body = {}) {
  const payer = String(body.payer || '').trim();
  const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = String(body.traceId || '').trim();
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
  const actionAmount = computeReactiveStopOrderAmount(actionParams);
  const requests = readX402Requests();
  const a2aQuery = `A2A stop-order ${actionParams.symbol} tp=${actionParams.takeProfit} sl=${actionParams.stopLoss}${
    Number.isFinite(actionParams?.quantity) ? ` qty=${actionParams.quantity}` : ''
  }`;

  if (!requestId || !paymentProof) {
    const policyResult = evaluateTransferPolicy({
      payer,
      recipient: actionCfg.recipient,
      amount: actionAmount,
      requests
    });
    if (!policyResult.ok) {
      logPolicyFailure({
        action: 'a2a-reactive-stop-orders',
        payer,
        recipient: actionCfg.recipient,
        amount: actionAmount,
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
      amount: actionAmount,
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
      taskType: 'reactive-stop-orders',
      traceId
    };
    requests.unshift(reqItem);
    writeX402Requests(requests);
    const receipt = buildA2AReceipt(reqItem, null, {
      traceId,
      phase: 'payment_required',
      state: 'running'
    });

    return {
      status: 402,
      body: {
        ...buildPaymentRequiredResponse(reqItem),
        a2a: {
          protocol: 'x402-a2a-v1',
          sourceAgentId,
          targetAgentId,
          taskType: 'reactive-stop-orders',
          task: actionParams
        },
        receipt
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
            quantity: reqItem?.actionParams?.quantity ?? '-',
            provider: 'Reactive Contracts'
          }
        },
        a2a: reqItem.a2a || null,
        receipt: buildA2AReceipt(reqItem, null, {
          traceId,
          sourceAgentId,
          targetAgentId,
          capability: 'reactive-stop-orders',
          phase: 'settled',
          state: 'success',
          summary: 'A2A reactive stop-order task already unlocked'
        })
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
  reqItem.a2a = {
    ...(reqItem.a2a || {}),
    sourceAgentId: String(reqItem?.a2a?.sourceAgentId || sourceAgentId).trim(),
    targetAgentId: String(reqItem?.a2a?.targetAgentId || targetAgentId).trim(),
    taskType: String(reqItem?.a2a?.taskType || 'reactive-stop-orders').trim(),
    traceId: String(reqItem?.a2a?.traceId || traceId).trim()
  };
  writeX402Requests(requests);
  const receipt = buildA2AReceipt(reqItem, null, {
    traceId: reqItem?.a2a?.traceId || traceId,
    sourceAgentId,
    targetAgentId,
    capability: 'reactive-stop-orders',
    phase: 'settled',
    state: 'success',
    summary: 'A2A reactive stop-order task unlocked by x402 payment'
  });

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
          quantity: reqItem?.actionParams?.quantity ?? '-',
          provider: 'Reactive Contracts'
        }
      },
      a2a: reqItem.a2a || {
        sourceAgentId,
        targetAgentId,
        taskType: 'reactive-stop-orders'
      },
      receipt
    }
  };
}

app.post('/api/a2a/tasks/stop-orders', requireRole('agent'), async (req, res) => {
  try {
    const result = await handleA2AStopOrders(req.body);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'a2a_handler_failed',
      reason: error.message || 'Unknown error'
    });
  }
});

app.post('/api/a2a/tasks/btc-price', requireRole('agent'), async (req, res) => {
  try {
    const result = await handleA2ABtcPrice(req.body);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'a2a_btc_price_handler_failed',
      reason: error.message || 'Unknown error'
    });
  }
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
              stopLoss: { type: 'number' },
              quantity: { type: 'number' }
            }
          },
          requestId: { type: 'string' },
          paymentProof: { type: 'object' }
        }
      }
    }
  });
});

app.post('/api/skill/openclaw/invoke', requireRole('agent'), async (req, res) => {
  try {
    const result = await handleA2AStopOrders(req.body);
    return res.status(result.status).json({
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      ...result.body
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      status: 500,
      error: 'openclaw_invoke_failed',
      reason: error.message || 'Unknown error'
    });
  }
});

app.get('/api/skill/openclaw/status/:requestId', requireRole('agent'), (req, res) => {
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

app.get('/api/skill/openclaw/evidence/:requestId', requireRole('agent'), (req, res) => {
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

app.post('/api/signer/sign-userop-hash', requireRole('agent'), async (req, res) => {
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

app.post('/api/x402/kol-score', requireRole('agent'), async (req, res) => {
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
      reason: `Invalid address: action recipient is invalid (${actionCfg.recipient})`
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
  if (actionCfg.action === 'btc-price-feed') {
    try {
      normalizedActionParams = normalizeBtcPriceParams(actionParamsInput || {});
    } catch (error) {
      return res.status(400).json({
        error: 'invalid_btc_price_params',
        reason: error.message
      });
    }
  }
  const amountToCharge =
    actionCfg.action === 'reactive-stop-orders'
      ? computeReactiveStopOrderAmount(normalizedActionParams || {})
      : actionCfg.amount;
  if (!requestId || !paymentProof) {
    const policyResult = evaluateTransferPolicy({
      payer,
      recipient: actionCfg.recipient,
      amount: amountToCharge,
      requests
    });
    if (!policyResult.ok) {
      logPolicyFailure({
        action: actionCfg.action,
        payer,
        recipient: actionCfg.recipient,
        amount: amountToCharge,
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
      amount: amountToCharge,
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
    let paidResult = {
      summary: 'KOL score report already unlocked',
      topKOLs: [
        { handle: '@alpha_kol', score: 91 },
        { handle: '@beta_growth', score: 88 },
        { handle: '@gamma_builder', score: 84 }
      ]
    };
    if (reqItem.action === 'reactive-stop-orders') {
      paidResult = {
        summary: 'Reactive contracts stop-orders signal already unlocked',
        orderPlan: {
          symbol: reqItem?.actionParams?.symbol || '-',
          takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
          stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
          quantity: reqItem?.actionParams?.quantity ?? '-',
          provider: 'Reactive Contracts'
        }
      };
    }
    if (reqItem.action === 'btc-price-feed') {
      let quote = reqItem?.result?.quote || null;
      if (!quote) {
        try {
          quote = await fetchBtcPriceQuote(reqItem.actionParams || {});
        } catch {
          quote = null;
        }
      }
      paidResult = {
        summary: reqItem?.result?.summary || 'BTC price quote already unlocked',
        quote
      };
    }
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
  let finalResult = {
    summary: 'KOL score report unlocked by x402 payment',
    topKOLs: [
      { handle: '@alpha_kol', score: 91 },
      { handle: '@beta_growth', score: 88 },
      { handle: '@gamma_builder', score: 84 }
    ]
  };
  if (reqItem.action === 'reactive-stop-orders') {
    finalResult = {
      summary: 'Reactive contracts stop-orders signal unlocked by x402 payment',
      orderPlan: {
        symbol: reqItem?.actionParams?.symbol || '-',
        takeProfit: reqItem?.actionParams?.takeProfit ?? '-',
        stopLoss: reqItem?.actionParams?.stopLoss ?? '-',
        quantity: reqItem?.actionParams?.quantity ?? '-',
        provider: 'Reactive Contracts'
      }
    };
  }
  if (reqItem.action === 'btc-price-feed') {
    const quote = await fetchBtcPriceQuote(reqItem.actionParams || {});
    finalResult = {
      summary: `BTC ${quote.pair} = $${quote.priceUsd} (${quote.provider})`,
      quote
    };
  }
  reqItem.result = finalResult;
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
    result: finalResult
  });
});

app.post('/api/x402/transfer-intent', requireRole('agent'), async (req, res) => {
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

app.get('/api/x402/policy', requireRole('viewer'), (req, res) => {
  res.json({ ok: true, traceId: req.traceId, policy: buildPolicySnapshot() });
});

app.get('/api/auth/info', requireRole('viewer'), (req, res) => {
  res.json({
    ok: true,
    traceId: req.traceId,
    authConfigured: authConfigured(),
    acceptedHeaders: ['x-api-key', 'Authorization: Bearer <key>'],
    roles: ['viewer', 'agent', 'admin'],
    persistence: persistenceStore.info()
  });
});

app.get('/api/system/persistence', requireRole('viewer'), (req, res) => {
  res.json({
    ok: true,
    traceId: req.traceId || '',
    persistence: persistenceStore.info()
  });
});

app.get('/api/market/btc/price', requireRole('viewer'), async (req, res) => {
  try {
    const quote = await fetchBtcPriceQuote({
      pair: req.query.pair,
      source: req.query.source
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      quote
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'price_source_unavailable',
      reason: error?.message || 'price_source_unavailable'
    });
  }
});

app.get('/api/automation/btc-price/status', requireRole('viewer'), (req, res) => {
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'a2a-btc-price',
      ...getAutoBtcPriceStatus()
    }
  });
});

app.post('/api/automation/btc-price/start', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  startAutoBtcPriceLoop({
    intervalMs: body.intervalMs,
    sourceAgentId: body.sourceAgentId,
    targetAgentId: body.targetAgentId,
    pair: body.pair,
    source: body.source,
    payer: body.payer,
    immediate: body.immediate !== false,
    reason: 'manual'
  });
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'a2a-btc-price',
      ...getAutoBtcPriceStatus()
    }
  });
});

app.post('/api/automation/btc-price/stop', requireRole('admin'), (req, res) => {
  stopAutoBtcPriceLoop();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'a2a-btc-price',
      ...getAutoBtcPriceStatus()
    }
  });
});

app.post('/api/x402/policy', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const nextPolicy = writePolicyConfig({
    maxPerTx: body.maxPerTx,
    dailyLimit: body.dailyLimit,
    allowedRecipients: body.allowedRecipients,
    revokedPayers: body.revokedPayers
  });
  res.json({ ok: true, traceId: req.traceId, policy: nextPolicy });
});

app.post('/api/policy/update', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const nextPolicy = writePolicyConfig({
    maxPerTx: body.maxPerTx,
    dailyLimit: body.dailyLimit,
    allowedRecipients: body.allowedRecipients,
    revokedPayers: body.revokedPayers
  });
  res.json({ ok: true, traceId: req.traceId, policy: nextPolicy });
});

app.post('/api/x402/policy/revoke', requireRole('admin'), (req, res) => {
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
    traceId: req.traceId,
    policy: next
  });
});

app.post('/api/policy/revoke', requireRole('admin'), (req, res) => {
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
  return res.json({ ok: true, action: 'revoked', payer, traceId: req.traceId, policy: next });
});

app.post('/api/x402/policy/unrevoke', requireRole('admin'), (req, res) => {
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
    traceId: req.traceId,
    policy: next
  });
});

app.post('/api/policy/unrevoke', requireRole('admin'), (req, res) => {
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
  return res.json({ ok: true, action: 'unrevoked', payer, traceId: req.traceId, policy: next });
});

app.get('/api/x402/policy-failures', requireRole('viewer'), (req, res) => {
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

app.get('/api/x402/requests', requireRole('viewer'), (req, res) => {
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
app.post('/api/session/pay', requireRole('agent'), async (req, res) => {
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
    const expectedSettlementToken = normalizeAddress(SETTLEMENT_TOKEN || '');
    if (
      expectedSettlementToken &&
      ethers.isAddress(expectedSettlementToken) &&
      normalizeAddress(tokenAddress) !== expectedSettlementToken
    ) {
      return res.status(400).json({
        ok: false,
        error: 'unsupported_settlement_token',
        reason: `Unsupported settlement token. expected=${expectedSettlementToken}, got=${normalizeAddress(tokenAddress)}`
      });
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

    const accountCode = await provider.getCode(runtime.aaWallet);
    if (!accountCode || accountCode === '0x') {
      return res.status(400).json({
        ok: false,
        error: 'aa_wallet_not_deployed_or_incompatible',
        reason: `No contract code found at runtime aaWallet: ${runtime.aaWallet}. Deploy AA account first, then recreate/sync session.`,
        details: {
          aaWallet: runtime.aaWallet,
          sessionId
        }
      });
    }

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

    const erc20Abi = ['function balanceOf(address account) view returns (uint256)'];
    const tokenCode = await provider.getCode(tokenAddress);
    if (!tokenCode || tokenCode === '0x') {
      return res.status(400).json({
        ok: false,
        error: 'invalid_token_contract',
        reason: `No contract code at tokenAddress: ${tokenAddress}`
      });
    }
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
    let minNativeGas = 0n;
    try {
      minNativeGas = ethers.parseEther(KITE_MIN_NATIVE_GAS || '0');
    } catch {
      minNativeGas = ethers.parseEther('0.0001');
    }
    const nativeBalance = await provider.getBalance(runtime.aaWallet);
    if (nativeBalance < minNativeGas) {
      return res.status(400).json({
        ok: false,
        error: 'insufficient_kite_gas',
        reason: `AA wallet ${runtime.aaWallet} has insufficient KITE for gas. Need >= ${ethers.formatEther(minNativeGas)} KITE.`,
        details: {
          aaWallet: runtime.aaWallet,
          balance: ethers.formatEther(nativeBalance),
          required: ethers.formatEther(minNativeGas)
        }
      });
    }
    if (!rulePass) {
      return res.status(400).json({
        ok: false,
        error: 'session_rule_failed',
        reason: 'Session spending rule precheck failed (amount/provider out of scope).'
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

let httpServer = null;

async function startServer() {
  await initializePersistence();
  httpServer = app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
    if (AUTO_BTC_PRICE_ENABLED) {
      startAutoBtcPriceLoop({
        intervalMs: AUTO_BTC_PRICE_INTERVAL_MS,
        sourceAgentId: AUTO_BTC_PRICE_SOURCE_AGENT_ID,
        targetAgentId: AUTO_BTC_PRICE_TARGET_AGENT_ID,
        pair: AUTO_BTC_PRICE_PAIR,
        source: AUTO_BTC_PRICE_SOURCE,
        payer: AUTO_BTC_PRICE_PAYER,
        immediate: true,
        reason: 'startup'
      });
      console.log(
        `[auto-btc] enabled intervalMs=${AUTO_BTC_PRICE_INTERVAL_MS} pair=${AUTO_BTC_PRICE_PAIR} source=${AUTO_BTC_PRICE_SOURCE}`
      );
    }
  });
}

async function shutdownServer() {
  stopAutoBtcPriceLoop();
  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      httpServer = null;
    }
  } catch {
    // ignore server close errors
  }
  await persistenceStore.close();
}

startServer().catch((error) => {
  console.error(`Backend startup failed: ${error?.message || error}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  shutdownServer().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdownServer().finally(() => process.exit(0));
});
