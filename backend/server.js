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
import { createXmtpAgentRuntime } from './services/xmtpAgentRuntime.js';

const app = express();
const PORT = process.env.PORT || 3001;
const dataPath = path.resolve('data', 'records.json');
const x402Path = path.resolve('data', 'x402_requests.json');
const policyFailurePath = path.resolve('data', 'policy_failures.json');
const policyConfigPath = path.resolve('data', 'policy_config.json');
const sessionRuntimePath = path.resolve('data', 'session_runtime.json');
const workflowPath = path.resolve('data', 'workflows.json');
const identityChallengePath = path.resolve('data', 'identity_challenges.json');
const servicesPath = path.resolve('data', 'services.json');
const serviceInvocationsPath = path.resolve('data', 'service_invocations.json');
const networkAgentsPath = path.resolve('data', 'network_agents.json');
const xmtpEventsPath = path.resolve('data', 'xmtp_events.json');

const SETTLEMENT_TOKEN =
  process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const MERCHANT_ADDRESS =
  process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const X402_PRICE = process.env.X402_PRICE || '0.05';
const KITE_AGENT2_AA_ADDRESS =
  process.env.KITE_AGENT2_AA_ADDRESS || '0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8';
const X402_REACTIVE_PRICE = process.env.X402_REACTIVE_PRICE || '0.03';
const X402_BTC_PRICE = process.env.X402_BTC_PRICE || '0.00001';
const X402_RISK_SCORE_PRICE = process.env.X402_RISK_SCORE_PRICE || '0.00002';
const X402_X_READER_PRICE = process.env.X402_X_READER_PRICE || '0.00001';
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
const X_READER_MAX_CHARS_DEFAULT = Math.max(200, Math.min(8000, Number(process.env.X_READER_MAX_CHARS_DEFAULT || 1200)));
const X_READER_TIMEOUT_MS = Math.max(3000, Math.min(20000, Number(process.env.X_READER_TIMEOUT_MS || 12000)));
const XMTP_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.XMTP_ENABLED || '').trim());
const XMTP_AUTO_ACK = /^(1|true|yes|on)$/i.test(String(process.env.XMTP_AUTO_ACK || '').trim());
const XMTP_EVENT_RETENTION = Math.max(50, Math.min(Number(process.env.XMTP_EVENT_RETENTION || 600), 5000));
const XMTP_ENV = String(process.env.XMTP_ENV || 'dev').trim().toLowerCase() || 'dev';
const XMTP_DB_ENCRYPTION_KEY = String(process.env.XMTP_DB_ENCRYPTION_KEY || '').trim();
const XMTP_DB_DIRECTORY = String(process.env.XMTP_DB_DIRECTORY || './data/xmtp-db').trim();
const XMTP_WALLET_KEY = String(process.env.XMTP_WALLET_KEY || '').trim();
const XMTP_ROUTER_WALLET_KEY = String(process.env.XMTP_ROUTER_WALLET_KEY || XMTP_WALLET_KEY).trim();
const XMTP_RISK_WALLET_KEY = String(process.env.XMTP_RISK_WALLET_KEY || '').trim();
const XMTP_ROUTER_AGENT_ADDRESS = String(process.env.XMTP_ROUTER_AGENT_ADDRESS || '').trim();
const XMTP_RISK_AGENT_ADDRESS = String(process.env.XMTP_RISK_AGENT_ADDRESS || '').trim();
const XMTP_READER_AGENT_ADDRESS = String(process.env.XMTP_READER_AGENT_ADDRESS || '').trim();
const XMTP_PRICE_AGENT_ADDRESS = String(process.env.XMTP_PRICE_AGENT_ADDRESS || '').trim();
const XMTP_EXECUTOR_AGENT_ADDRESS = String(process.env.XMTP_EXECUTOR_AGENT_ADDRESS || '').trim();
const XMTP_ROUTER_AGENT_AA_ADDRESS = String(process.env.XMTP_ROUTER_AGENT_AA_ADDRESS || '').trim();
const XMTP_RISK_AGENT_AA_ADDRESS = String(process.env.XMTP_RISK_AGENT_AA_ADDRESS || '').trim();
const XMTP_READER_AGENT_AA_ADDRESS = String(process.env.XMTP_READER_AGENT_AA_ADDRESS || '').trim();
const XMTP_PRICE_AGENT_AA_ADDRESS = String(process.env.XMTP_PRICE_AGENT_AA_ADDRESS || '').trim();
const XMTP_EXECUTOR_AGENT_AA_ADDRESS = String(process.env.XMTP_EXECUTOR_AGENT_AA_ADDRESS || '').trim();
const XMTP_ROUTER_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_ROUTER_RUNTIME_ENABLED || (XMTP_ENABLED ? '1' : '0')).trim()
);
const XMTP_RISK_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_RISK_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_RISK_WALLET_KEY ? '1' : '0')).trim()
);
const XMTP_AUTO_NETWORK_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.XMTP_AUTO_NETWORK_ENABLED || '').trim());
const XMTP_AUTO_NETWORK_INTERVAL_MS = Math.max(15_000, Number(process.env.XMTP_AUTO_NETWORK_INTERVAL_MS || 60_000));
const XMTP_AUTO_NETWORK_SOURCE_AGENT_ID = String(process.env.XMTP_AUTO_NETWORK_SOURCE_AGENT_ID || 'router-agent').trim().toLowerCase();
const XMTP_AUTO_NETWORK_TARGET_AGENT_IDS = String(process.env.XMTP_AUTO_NETWORK_TARGET_AGENT_IDS || 'risk-agent,reader-agent').trim();
const XMTP_AUTO_NETWORK_CAPABILITY = String(process.env.XMTP_AUTO_NETWORK_CAPABILITY || 'network-heartbeat').trim();

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
  identityChallengePath,
  servicesPath,
  serviceInvocationsPath,
  networkAgentsPath,
  xmtpEventsPath
];
const PERSIST_OBJECT_PATHS = [policyConfigPath, sessionRuntimePath];
const persistArrayCache = new Map();
const persistObjectCache = new Map();
let persistenceInitDone = false;
let autoBtcPriceTimer = null;
let autoBtcPriceBusy = false;
let autoXmtpNetworkTimer = null;
let autoXmtpNetworkBusy = false;
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

function parseAgentIdList(input = '') {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }
  return String(input || '')
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

const autoXmtpNetworkState = {
  enabled: false,
  intervalMs: XMTP_AUTO_NETWORK_INTERVAL_MS,
  sourceAgentId: XMTP_AUTO_NETWORK_SOURCE_AGENT_ID,
  targetAgentIds: parseAgentIdList(XMTP_AUTO_NETWORK_TARGET_AGENT_IDS),
  capability: XMTP_AUTO_NETWORK_CAPABILITY || 'network-heartbeat',
  startedAt: '',
  lastTickAt: '',
  lastTraceId: '',
  lastRequestId: '',
  lastTaskId: '',
  lastTargetAgentId: '',
  lastStatus: '',
  lastError: '',
  sentCount: 0,
  failedCount: 0,
  cursor: 0
};

const ROUTER_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_ROUTER_WALLET_KEY);
const RISK_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_RISK_WALLET_KEY);
const XMTP_ROUTER_DERIVED_ADDRESS = deriveAddressFromPrivateKey(ROUTER_WALLET_KEY_NORMALIZED);
const XMTP_RISK_DERIVED_ADDRESS = deriveAddressFromPrivateKey(RISK_WALLET_KEY_NORMALIZED);
const XMTP_ROUTER_RESOLVED_ADDRESS = normalizeAddress(XMTP_ROUTER_AGENT_ADDRESS || XMTP_ROUTER_DERIVED_ADDRESS || '');
const XMTP_RISK_RESOLVED_ADDRESS = normalizeAddress(XMTP_RISK_AGENT_ADDRESS || XMTP_RISK_DERIVED_ADDRESS || '');
const XMTP_ROUTER_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'router-agent');
const XMTP_RISK_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'risk-agent');

function authConfigured() {
  return Boolean(API_KEY_ADMIN || API_KEY_AGENT || API_KEY_VIEWER);
}

function extractApiKey(req) {
  const xApiKey = String(req.headers['x-api-key'] || '').trim();
  if (xApiKey) return xApiKey;
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const streamQueryKey = String(req.query?.apiKey || req.query?.token || '').trim();
  if (streamQueryKey && req.method === 'GET' && String(req.path || '').includes('/stream')) {
    return streamQueryKey;
  }
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

function shouldRetrySessionPayReason(reason = '') {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes('timeout') ||
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('socket hang up') ||
    text.includes('network')
  );
}

async function postSessionPayWithRetry(payload = {}, options = {}) {
  const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts || 3), 5));
  const timeoutMs = Math.max(30_000, Math.min(Number(options.timeoutMs || 210_000), 300_000));
  const internalApiKey = getInternalAgentApiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (internalApiKey) headers['x-api-key'] = internalApiKey;

  let lastError = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    const attempt = i + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/api/session/pay`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = await resp.json().catch(() => ({}));
      if (resp.ok && body?.ok) {
        return { resp, body, attempts: attempt };
      }
      const reason = String(body?.reason || body?.error || `HTTP ${resp.status}`).trim();
      const err = new Error(reason || 'session pay failed');
      err.payBody = body;
      err.status = resp.status;
      err.attempts = attempt;
      err.retryable = shouldRetrySessionPayReason(reason);
      lastError = err;
      if (!err.retryable || i >= maxAttempts - 1) throw err;
      await waitMs(700 * attempt);
    } catch (error) {
      const reason = String(error?.message || '').trim();
      const retryable = shouldRetrySessionPayReason(reason) || error?.name === 'AbortError';
      const wrapped = error instanceof Error ? error : new Error(reason || 'session pay failed');
      wrapped.attempts = attempt;
      wrapped.retryable = retryable;
      lastError = wrapped;
      if (!retryable || i >= maxAttempts - 1) throw wrapped;
      await waitMs(700 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('session pay failed');
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

function getAutoXmtpNetworkStatus() {
  return {
    ...autoXmtpNetworkState,
    running: Boolean(autoXmtpNetworkTimer),
    busy: autoXmtpNetworkBusy
  };
}

function resolveAutoXmtpTargetAgentId() {
  const ids = Array.isArray(autoXmtpNetworkState.targetAgentIds) ? autoXmtpNetworkState.targetAgentIds : [];
  if (!ids.length) return '';
  const total = ids.length;
  const current = Math.max(0, Number(autoXmtpNetworkState.cursor || 0));
  for (let i = 0; i < total; i += 1) {
    const idx = (current + i) % total;
    const candidate = String(ids[idx] || '').trim().toLowerCase();
    if (!candidate) continue;
    const row = findNetworkAgentById(candidate);
    if (row?.active === false) continue;
    autoXmtpNetworkState.cursor = (idx + 1) % total;
    return candidate;
  }
  return '';
}

async function runAutoXmtpNetworkTick(reason = 'timer') {
  if (autoXmtpNetworkBusy) return;
  autoXmtpNetworkBusy = true;
  autoXmtpNetworkState.lastTickAt = new Date().toISOString();
  autoXmtpNetworkState.lastStatus = 'running';
  autoXmtpNetworkState.lastError = '';

  try {
    if (!xmtpRuntime.getStatus().running) {
      await xmtpRuntime.start();
    }
    if (!xmtpRuntime.getStatus().running) {
      throw new Error(xmtpRuntime.getStatus().lastError || 'xmtp_runtime_not_running');
    }

    const toAgentId = resolveAutoXmtpTargetAgentId();
    if (!toAgentId) throw new Error('no_active_target_agent');

    const traceId = createTraceId('xmtp_auto_trace');
    const requestId = createTraceId('xmtp_auto_req');
    const taskId = createTraceId('xmtp_auto_task');
    const envelope = {
      kind: 'task-envelope',
      protocolVersion: 'kite-agent-task-v1',
      traceId,
      requestId,
      taskId,
      fromAgentId: String(autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase(),
      toAgentId,
      channel: 'dm',
      hopIndex: 1,
      mode: 'a2a',
      capability: String(autoXmtpNetworkState.capability || 'network-heartbeat').trim(),
      input: {
        source: 'xmtp-auto-loop',
        reason,
        fromAgentId: String(autoXmtpNetworkState.sourceAgentId || '').trim(),
        toAgentId,
        tickAt: new Date().toISOString()
      },
      paymentIntent: {},
      expectsReply: true,
      timestamp: new Date().toISOString()
    };

    const sent = await xmtpRuntime.sendDm({
      toAgentId,
      envelope,
      traceId,
      requestId,
      taskId,
      fromAgentId: String(autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase(),
      channel: 'dm',
      hopIndex: 1
    });
    if (!sent?.ok) {
      throw new Error(String(sent?.reason || sent?.error || 'xmtp_auto_send_failed').trim());
    }

    autoXmtpNetworkState.lastTraceId = traceId;
    autoXmtpNetworkState.lastRequestId = requestId;
    autoXmtpNetworkState.lastTaskId = taskId;
    autoXmtpNetworkState.lastTargetAgentId = toAgentId;
    autoXmtpNetworkState.lastStatus = 'success';
    autoXmtpNetworkState.sentCount += 1;
  } catch (error) {
    autoXmtpNetworkState.lastStatus = 'failed';
    autoXmtpNetworkState.lastError = String(error?.message || 'auto_xmtp_tick_failed').trim();
    autoXmtpNetworkState.failedCount += 1;
  } finally {
    autoXmtpNetworkBusy = false;
    if (reason === 'startup' || reason === 'manual') {
      console.log(
        `[auto-xmtp] tick ${autoXmtpNetworkState.lastStatus} target=${autoXmtpNetworkState.lastTargetAgentId || '-'} task=${autoXmtpNetworkState.lastTaskId || '-'}`
      );
    }
  }
}

function stopAutoXmtpNetworkLoop() {
  if (autoXmtpNetworkTimer) {
    clearInterval(autoXmtpNetworkTimer);
    autoXmtpNetworkTimer = null;
  }
  autoXmtpNetworkState.enabled = false;
}

function startAutoXmtpNetworkLoop(options = {}) {
  const intervalMs = Math.max(15_000, Number(options.intervalMs || autoXmtpNetworkState.intervalMs || 60_000));
  const targetAgentIds = parseAgentIdList(options.targetAgentIds || autoXmtpNetworkState.targetAgentIds.join(','));
  autoXmtpNetworkState.intervalMs = intervalMs;
  autoXmtpNetworkState.sourceAgentId = String(options.sourceAgentId || autoXmtpNetworkState.sourceAgentId || 'router-agent').trim().toLowerCase();
  autoXmtpNetworkState.targetAgentIds = targetAgentIds;
  autoXmtpNetworkState.capability = String(options.capability || autoXmtpNetworkState.capability || 'network-heartbeat').trim();
  autoXmtpNetworkState.enabled = true;
  autoXmtpNetworkState.startedAt = new Date().toISOString();
  autoXmtpNetworkState.lastError = '';
  autoXmtpNetworkState.lastStatus = '';

  if (autoXmtpNetworkTimer) clearInterval(autoXmtpNetworkTimer);
  autoXmtpNetworkTimer = setInterval(() => {
    runAutoXmtpNetworkTick('timer').catch(() => {});
  }, intervalMs);

  if (options.immediate !== false) {
    runAutoXmtpNetworkTick(options.reason || 'manual').catch(() => {});
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

function broadcastEvent(eventName, payload = {}) {
  // SSE module removed; keep no-op to avoid touching workflow call sites.
  void eventName;
  void payload;
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

function readPublishedServices() {
  return readJsonArray(servicesPath);
}

function writePublishedServices(records) {
  writeJsonArray(servicesPath, records);
}

function readServiceInvocations() {
  return readJsonArray(serviceInvocationsPath);
}

function writeServiceInvocations(records) {
  writeJsonArray(serviceInvocationsPath, records);
}

function readNetworkAgents() {
  return readJsonArray(networkAgentsPath);
}

function writeNetworkAgents(records) {
  writeJsonArray(networkAgentsPath, records);
}

function readXmtpEvents() {
  return readJsonArray(xmtpEventsPath);
}

function writeXmtpEvents(records) {
  writeJsonArray(xmtpEventsPath, records);
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
    // Compatibility alias: some deployed AA session policies only allow legacy providers.
    const alias = String(process.env.KITE_BTC_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'risk-score-feed') {
    const alias = String(process.env.KITE_RISK_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'x-reader-feed') {
    const alias = String(process.env.KITE_XREADER_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
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

function normalizePrivateKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(normalized) ? normalized : '';
}

function deriveAddressFromPrivateKey(value = '') {
  const privateKey = normalizePrivateKey(value);
  if (!privateKey) return '';
  try {
    return normalizeAddress(new ethers.Wallet(privateKey).address || '');
  } catch {
    return '';
  }
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
    workflowTraceId: workflow?.traceId || item?.a2a?.traceId || '',
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

function parsePositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : NaN;
}

function buildDemoPriceSeries(limitInput = 60) {
  const limit = Math.max(10, Math.min(Number(limitInput || 60), 300));
  const workflowByRequestId = buildLatestWorkflowByRequestId(readWorkflows());
  const dedup = new Map();

  for (const item of readX402Requests()) {
    if (!item || typeof item !== 'object') continue;
    const requestId = String(item.requestId || '').trim();
    if (!requestId) continue;
    const action = String(item.action || '').trim().toLowerCase();
    const status = String(item.status || '').trim().toLowerCase();
    if (action !== 'btc-price-feed' || status !== 'paid') continue;

    const workflow = workflowByRequestId.get(requestId) || null;
    const quote = item?.result?.quote || workflow?.result?.quote || null;
    const priceUsd = parsePositiveNumber(quote?.priceUsd);
    if (!Number.isFinite(priceUsd)) continue;

    const fetchedAtRaw = String(
      quote?.fetchedAt ||
        workflow?.updatedAt ||
        workflow?.createdAt ||
        (Number(item.paidAt || 0) > 0 ? new Date(Number(item.paidAt)).toISOString() : '') ||
        (Number(item.createdAt || 0) > 0 ? new Date(Number(item.createdAt)).toISOString() : '')
    ).trim();
    const fetchedMs = Date.parse(fetchedAtRaw);
    if (!Number.isFinite(fetchedMs)) continue;

    const nextRow = {
      t: new Date(fetchedMs).toISOString(),
      priceUsd: Number(priceUsd.toFixed(6)),
      provider: String(quote?.provider || '').trim().toLowerCase() || 'unknown',
      traceId: String(workflow?.traceId || item?.a2a?.traceId || '').trim(),
      requestId
    };
    const prev = dedup.get(requestId);
    if (!prev || Date.parse(prev.t) <= fetchedMs) {
      dedup.set(requestId, nextRow);
    }
  }

  const series = [...dedup.values()]
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .slice(-limit);

  return { limit, series };
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
  if (action === 'risk-score-feed') {
    return {
      action: 'risk-score-feed',
      amount: X402_RISK_SCORE_PRICE,
      recipient: KITE_AGENT2_AA_ADDRESS,
      summary: 'BTC risk score unlocked by x402 payment'
    };
  }
  if (action === 'x-reader-feed') {
    return {
      action: 'x-reader-feed',
      amount: X402_X_READER_PRICE,
      recipient: KITE_AGENT2_AA_ADDRESS,
      summary: 'x-reader digest unlocked by x402 payment'
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

function normalizeRiskScoreParams(input = {}) {
  const rawSymbol = String(input.symbol || input.pair || 'BTCUSDT').trim().toUpperCase();
  const symbolCompact = rawSymbol.replace(/[-_\s]/g, '');
  if (!['BTC', 'BTCUSDT', 'BTCUSD'].includes(symbolCompact)) {
    throw new Error('Risk-score task requires symbol BTC/BTCUSDT/BTCUSD.');
  }
  const horizonMinRaw = Number(input.horizonMin ?? input.horizonMins ?? 60);
  const horizonMin = Number.isFinite(horizonMinRaw) ? Math.max(5, Math.min(Math.round(horizonMinRaw), 240)) : 60;
  const normalizedBtc = normalizeBtcPriceParams({ source: input.source || 'hyperliquid', pair: rawSymbol });
  return {
    symbol: symbolCompact === 'BTC' || symbolCompact === 'BTCUSD' ? 'BTCUSDT' : symbolCompact,
    horizonMin,
    source: normalizedBtc.source,
    sourceRequested: normalizedBtc.sourceRequested,
    providers: normalizedBtc.providers
  };
}

function normalizeXReaderParams(input = {}) {
  const rawUrl = String(input.url || input.resourceUrl || input.targetUrl || '').trim();
  if (!rawUrl) {
    throw new Error('x-reader task requires url.');
  }
  let normalizedUrl = '';
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(String(parsed.protocol || '').toLowerCase())) {
      throw new Error('invalid protocol');
    }
    normalizedUrl = parsed.toString();
  } catch {
    throw new Error('x-reader task requires a valid http/https url.');
  }

  const rawMode = String(input.mode || input.source || 'auto').trim().toLowerCase();
  if (!['auto', 'jina', 'xreader'].includes(rawMode)) {
    throw new Error('x-reader task mode must be one of auto/jina/xreader.');
  }
  const maxCharsRaw = Number(input.maxChars ?? input.maxLength ?? X_READER_MAX_CHARS_DEFAULT);
  const maxChars = Number.isFinite(maxCharsRaw)
    ? Math.max(200, Math.min(Math.round(maxCharsRaw), 20000))
    : X_READER_MAX_CHARS_DEFAULT;

  return {
    url: normalizedUrl,
    mode: rawMode === 'xreader' ? 'auto' : rawMode,
    maxChars
  };
}

function parseExcerptMaxChars(input, fallback = 8000) {
  const value = Number(input ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(200, Math.min(Math.round(value), 20000));
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

async function fetchTextWithTimeout(url, timeoutMs = 8000, options = {}) {
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
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractXReaderDigest(rawText = '', maxChars = X_READER_MAX_CHARS_DEFAULT) {
  const normalized = String(rawText || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return {
      title: '',
      excerpt: ''
    };
  }
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const contentLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (lower.startsWith('url source:')) return false;
    if (lower.startsWith('markdown content:')) return false;
    return true;
  });
  const title =
    contentLines.find((line) => {
      const lower = line.toLowerCase();
      if (lower.startsWith('title:')) return false;
      if (line.length < 6) return false;
      return true;
    }) || '';
  const excerpt = contentLines.join('\n').slice(0, maxChars);
  return {
    title: String(title || '').replace(/^title:\s*/i, '').trim(),
    excerpt
  };
}

async function fetchXReaderFromJina(url = '', maxChars = X_READER_MAX_CHARS_DEFAULT) {
  const target = String(url || '').trim().replace(/^https?:\/\//i, '');
  const readerUrl = `https://r.jina.ai/http://${target}`;
  const text = await fetchTextWithTimeout(readerUrl, X_READER_TIMEOUT_MS);
  const digest = extractXReaderDigest(text, maxChars);
  if (!digest.excerpt) {
    throw new Error('empty x-reader response');
  }
  return {
    provider: 'x-reader',
    backend: 'jina',
    url: String(url || '').trim(),
    title: digest.title || '',
    excerpt: digest.excerpt,
    contentLength: digest.excerpt.length,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchXReaderDigest(params = {}) {
  const task = normalizeXReaderParams(params);
  const attemptedProviders = [];
  const failures = [];
  const providers = ['jina'];

  for (const provider of providers) {
    attemptedProviders.push(provider);
    try {
      let reader = null;
      if (provider === 'jina') {
        reader = await fetchXReaderFromJina(task.url, task.maxChars);
      }
      if (!reader?.excerpt) {
        throw new Error('empty excerpt');
      }
      return {
        ...reader,
        mode: task.mode,
        maxChars: task.maxChars,
        sourceRequested: task.mode,
        attemptedProviders
      };
    } catch (error) {
      failures.push(`${provider}:${error?.message || 'failed'}`);
    }
  }
  throw new Error(`x_reader_unavailable (${failures.join(', ') || 'no provider'})`);
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

function toRiskLevel(score = 50) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'elevated';
  if (score >= 35) return 'medium';
  return 'low';
}

function buildRiskScoreSummary(score, level, symbol, quote) {
  return `${symbol} risk score ${score}/100 (${level}) at $${quote.priceUsd} [${quote.provider}]`;
}

async function runRiskScoreAnalysis(input = {}) {
  const task = normalizeRiskScoreParams(input);
  const quote = await fetchBtcPriceQuote({
    pair: task.symbol,
    source: task.sourceRequested
  });

  const horizonPoints = Math.max(3, Math.min(task.horizonMin, 60));
  const series = buildDemoPriceSeries(horizonPoints).series;
  const prices = series.map((item) => Number(item.priceUsd)).filter((item) => Number.isFinite(item) && item > 0);
  const avgPrice = prices.length > 0 ? prices.reduce((sum, value) => sum + value, 0) / prices.length : Number(quote.priceUsd);
  const minPrice = prices.length > 0 ? Math.min(...prices) : Number(quote.priceUsd);
  const maxPrice = prices.length > 0 ? Math.max(...prices) : Number(quote.priceUsd);
  const rangePct = avgPrice > 0 ? ((maxPrice - minPrice) / avgPrice) * 100 : 0;

  const deviationPct = avgPrice > 0 ? (Math.abs(Number(quote.priceUsd) - avgPrice) / avgPrice) * 100 : 0;
  const rawScore = 22 + rangePct * 11 + deviationPct * 8;
  const bounded = Math.max(5, Math.min(95, Math.round(rawScore)));
  const level = toRiskLevel(bounded);

  return {
    summary: buildRiskScoreSummary(bounded, level, task.symbol, quote),
    risk: {
      symbol: task.symbol,
      score: bounded,
      level,
      horizonMin: task.horizonMin,
      rangePct: Number(rangePct.toFixed(4)),
      deviationPct: Number(deviationPct.toFixed(4)),
      sampleSize: prices.length,
      provider: quote.provider
    },
    quote
  };
}

function createServiceId() {
  return `svc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeServiceAction(actionRaw = '') {
  const action = String(actionRaw || 'btc-price-feed').trim().toLowerCase();
  if (!['btc-price-feed', 'risk-score-feed', 'x-reader-feed'].includes(action)) {
    throw new Error('Supported service actions: btc-price-feed, risk-score-feed, x-reader-feed.');
  }
  return action;
}

function normalizeStringList(input, { lower = false, dedup = true } = {}) {
  const values = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
  const normalized = values
    .map((value) => (lower ? String(value || '').trim().toLowerCase() : String(value || '').trim()))
    .filter(Boolean);
  if (!dedup) return normalized;
  return normalized.filter((value, index, arr) => arr.indexOf(value) === index);
}

function sanitizeServiceRecord(input = {}, existing = null) {
  const now = new Date().toISOString();
  const action = normalizeServiceAction(input.action || existing?.action || 'btc-price-feed');
  const isRisk = action === 'risk-score-feed';
  const isXReader = action === 'x-reader-feed';
  const normalizedTask =
    isRisk
      ? normalizeRiskScoreParams({
          symbol: input.pair || input.symbol || existing?.pair || 'BTCUSDT',
          source: input.source || existing?.source || 'hyperliquid',
          horizonMin: input.horizonMin ?? existing?.horizonMin ?? 60
        })
      : isXReader
        ? normalizeXReaderParams({
            url:
              input.resourceUrl ||
              input.url ||
              existing?.resourceUrl ||
              existing?.url ||
              existing?.exampleInput?.url ||
              '',
            mode: input.mode || input.source || existing?.mode || existing?.source || 'auto',
            maxChars: input.maxChars ?? existing?.maxChars ?? existing?.exampleInput?.maxChars ?? X_READER_MAX_CHARS_DEFAULT
          })
      : normalizeBtcPriceParams({
          pair: input.pair || existing?.pair || 'BTCUSDT',
          source: input.source || existing?.source || 'hyperliquid'
        });
  const recipient = normalizeAddress(input.recipient || existing?.recipient || KITE_AGENT2_AA_ADDRESS);
  if (!recipient || !ethers.isAddress(recipient)) {
    throw new Error('service recipient must be a valid address');
  }
  const tokenAddress = normalizeAddress(input.tokenAddress || existing?.tokenAddress || SETTLEMENT_TOKEN);
  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    throw new Error('service tokenAddress must be a valid address');
  }
  const priceRaw = Number(input.price ?? existing?.price ?? X402_BTC_PRICE ?? '0.00001');
  if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
    throw new Error('service price must be a valid positive number');
  }
  const name =
    String(input.name || existing?.name || '').trim() ||
    (isXReader ? 'X Reader Digest Service' : 'BTCUSD Quote Service');
  const description =
    String(input.description || existing?.description || '').trim() ||
    (isXReader ? 'Pay-per-call URL digest powered by x-reader + x402.' : 'Pay-per-call BTCUSD quote service.');
  const providerAgentId = String(input.providerAgentId || existing?.providerAgentId || KITE_AGENT2_ID).trim();
  const tags = normalizeStringList(
    input.tags || existing?.tags || (isXReader ? ['atapi', 'x402', 'x-reader'] : ['atapi', 'x402', action]),
    { lower: true, dedup: true }
  );
  const allowlistPayers = normalizeAddresses(input.allowlistPayers || existing?.allowlistPayers || []);
  const slaMsRaw = Number(input.slaMs ?? existing?.slaMs ?? 12000);
  const rateLimitPerMinuteRaw = Number(input.rateLimitPerMinute ?? existing?.rateLimitPerMinute ?? 12);
  const budgetPerDayRaw = Number(input.budgetPerDay ?? existing?.budgetPerDay ?? 0);
  const exampleInput =
    input.exampleInput && typeof input.exampleInput === 'object'
      ? input.exampleInput
        : existing?.exampleInput && typeof existing.exampleInput === 'object'
        ? existing.exampleInput
        : isRisk
          ? { symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid' }
          : isXReader
            ? { url: 'https://x.com/Kite_AI', mode: 'auto', maxChars: X_READER_MAX_CHARS_DEFAULT }
          : { pair: 'BTCUSDT', source: 'hyperliquid' };
  const activeInput = input.active;
  const active =
    typeof activeInput === 'boolean'
      ? activeInput
      : existing
        ? existing.active !== false
        : true;

  return {
    id: String(existing?.id || input.id || createServiceId()).trim(),
    name,
    description,
    action,
    pair: normalizedTask.pair || '',
    source: normalizedTask.source || normalizedTask.mode || 'auto',
    sourceRequested: normalizedTask.sourceRequested || normalizedTask.mode || 'auto',
    horizonMin: normalizedTask.horizonMin || null,
    resourceUrl: normalizedTask.url || '',
    maxChars: normalizedTask.maxChars || null,
    providerAgentId,
    recipient,
    tokenAddress,
    price: String(Number(priceRaw.toFixed(6))),
    tags,
    slaMs: Number.isFinite(slaMsRaw) && slaMsRaw > 0 ? Math.round(slaMsRaw) : 12000,
    rateLimitPerMinute:
      Number.isFinite(rateLimitPerMinuteRaw) && rateLimitPerMinuteRaw > 0
        ? Math.min(120, Math.max(1, Math.round(rateLimitPerMinuteRaw)))
        : 12,
    budgetPerDay: Number.isFinite(budgetPerDayRaw) && budgetPerDayRaw > 0 ? Number(budgetPerDayRaw.toFixed(6)) : 0,
    allowlistPayers,
    exampleInput,
    active,
    createdAt: String(existing?.createdAt || now).trim(),
    updatedAt: now,
    publishedBy: String(input.publishedBy || existing?.publishedBy || 'admin').trim()
  };
}

function createDefaultServiceCatalog() {
  const now = new Date().toISOString();
  return [
    {
      id: 'svc_btcusd_minute',
      name: 'BTCUSD Quote (ATAPI)',
      description: 'Agent-to-API BTCUSD quote via ERC8004 + x402 payment.',
      action: 'btc-price-feed',
      pair: 'BTCUSDT',
      source: 'hyperliquid',
      sourceRequested: 'hyperliquid',
      providerAgentId: String(KITE_AGENT2_ID).trim(),
      recipient: normalizeAddress(KITE_AGENT2_AA_ADDRESS),
      tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
      price: String(Number(Number(X402_BTC_PRICE || '0.00001').toFixed(6))),
      tags: ['atapi', 'x402', 'btc', 'price-feed'],
      slaMs: 12000,
      rateLimitPerMinute: 12,
      budgetPerDay: 0.06,
      allowlistPayers: [],
      exampleInput: { pair: 'BTCUSDT', source: 'hyperliquid' },
      active: true,
      createdAt: now,
      updatedAt: now,
      publishedBy: 'system'
    },
    {
      id: 'svc_btc_risk_score',
      name: 'BTC Risk Score (A2A)',
      description: 'Agent-to-agent risk score derived from paid BTC quote and recent volatility.',
      action: 'risk-score-feed',
      pair: 'BTCUSDT',
      source: 'hyperliquid',
      sourceRequested: 'hyperliquid',
      horizonMin: 60,
      providerAgentId: '3',
      recipient: normalizeAddress(KITE_AGENT2_AA_ADDRESS),
      tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
      price: String(Number(Number(X402_RISK_SCORE_PRICE || '0.00002').toFixed(6))),
      tags: ['a2a', 'x402', 'risk'],
      slaMs: 15000,
      rateLimitPerMinute: 10,
      budgetPerDay: 0.08,
      allowlistPayers: [],
      exampleInput: { symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid' },
      active: true,
      createdAt: now,
      updatedAt: now,
      publishedBy: 'system'
    },
    {
      id: 'svc_x_reader_digest',
      name: 'X Reader Digest (ATAPI)',
      description: 'Agent-to-API URL digest via x-reader + ERC8004 + x402 payment.',
      action: 'x-reader-feed',
      pair: '',
      source: 'auto',
      sourceRequested: 'auto',
      resourceUrl: 'https://x.com/Kite_AI',
      maxChars: X_READER_MAX_CHARS_DEFAULT,
      providerAgentId: String(KITE_AGENT2_ID).trim(),
      recipient: normalizeAddress(KITE_AGENT2_AA_ADDRESS),
      tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
      price: String(Number(Number(X402_X_READER_PRICE || '0.00001').toFixed(6))),
      tags: ['atapi', 'x402', 'x-reader', 'digest'],
      slaMs: 15000,
      rateLimitPerMinute: 8,
      budgetPerDay: 0.05,
      allowlistPayers: [],
      exampleInput: { url: 'https://x.com/Kite_AI', mode: 'auto', maxChars: X_READER_MAX_CHARS_DEFAULT },
      active: true,
      createdAt: now,
      updatedAt: now,
      publishedBy: 'system'
    }
  ];
}

function mergeBuiltinServices(rows = []) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const defaults = createDefaultServiceCatalog();
  let changed = false;
  for (const service of defaults) {
    const id = String(service?.id || '').trim();
    if (!id) continue;
    const exists = list.some((item) => String(item?.id || '').trim() === id);
    if (!exists) {
      list.push(service);
      changed = true;
    }
  }
  return { rows: list, changed };
}

function ensureServiceCatalog() {
  const rows = readPublishedServices();
  if (Array.isArray(rows) && rows.length > 0) {
    const merged = mergeBuiltinServices(rows);
    if (merged.changed) {
      writePublishedServices(merged.rows);
    }
    return merged.rows;
  }
  const seed = createDefaultServiceCatalog();
  writePublishedServices(seed);
  return seed;
}

function sanitizeNetworkAgentRecord(input = {}, existing = null) {
  const source = input && typeof input === 'object' ? input : {};
  const fallback = existing && typeof existing === 'object' ? existing : {};
  const now = new Date().toISOString();
  const id = String(source.id || fallback.id || '').trim().toLowerCase();
  const name = String(source.name || fallback.name || '').trim();
  const role = String(source.role || fallback.role || '').trim().toLowerCase();
  const mode = String(source.mode || fallback.mode || '').trim().toLowerCase();
  const xmtpAddress = normalizeAddress(source.xmtpAddress || fallback.xmtpAddress || '');
  const aaAddress = normalizeAddress(source.aaAddress || fallback.aaAddress || '');
  const inboxId = String(source.inboxId || fallback.inboxId || '').trim();
  const ownerWallet = normalizeAddress(source.ownerWallet || fallback.ownerWallet || '');
  const description = String(source.description || fallback.description || '').trim();
  const capabilitiesRaw = Array.isArray(source.capabilities)
    ? source.capabilities
    : Array.isArray(fallback.capabilities)
      ? fallback.capabilities
      : [];
  const active =
    typeof source.active === 'boolean'
      ? source.active
      : typeof fallback.active === 'boolean'
        ? fallback.active
        : true;
  const capabilities = capabilitiesRaw
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 24);
  return {
    id,
    name: name || id,
    role,
    mode,
    xmtpAddress,
    aaAddress,
    inboxId,
    ownerWallet,
    description,
    capabilities,
    active,
    createdAt: String(fallback.createdAt || source.createdAt || now).trim() || now,
    updatedAt: String(source.updatedAt || fallback.updatedAt || now).trim() || now
  };
}

function createDefaultNetworkAgents() {
  const seeds = [
    {
      id: 'router-agent',
      name: 'Router Agent',
      role: 'router',
      mode: 'a2a',
      xmtpAddress: XMTP_ROUTER_RESOLVED_ADDRESS,
      aaAddress: XMTP_ROUTER_AGENT_AA_ADDRESS,
      description: 'Routes tasks and coordinates A2A execution.',
      capabilities: ['route-task', 'dispatch-a2a']
    },
    {
      id: 'risk-agent',
      name: 'Risk Agent',
      role: 'provider',
      mode: 'a2a',
      xmtpAddress: XMTP_RISK_RESOLVED_ADDRESS,
      aaAddress: XMTP_RISK_AGENT_AA_ADDRESS,
      description: 'Computes risk-score feed through agent capability.',
      capabilities: ['risk-score-feed', 'volatility-snapshot']
    },
    {
      id: 'reader-agent',
      name: 'Reader Agent',
      role: 'provider',
      mode: 'a2api',
      xmtpAddress: XMTP_READER_AGENT_ADDRESS,
      aaAddress: XMTP_READER_AGENT_AA_ADDRESS,
      description: 'Runs x-reader digest for URLs via ATAPI adapter.',
      capabilities: ['x-reader-feed', 'url-digest']
    },
    {
      id: 'price-agent',
      name: 'Price Agent',
      role: 'provider',
      mode: 'a2api',
      xmtpAddress: XMTP_PRICE_AGENT_ADDRESS,
      aaAddress: XMTP_PRICE_AGENT_AA_ADDRESS,
      description: 'Fetches BTC/market quote feeds.',
      capabilities: ['btc-price-feed', 'market-quote']
    },
    {
      id: 'executor-agent',
      name: 'Executor Agent',
      role: 'executor',
      mode: 'a2a',
      xmtpAddress: XMTP_EXECUTOR_AGENT_ADDRESS,
      aaAddress: XMTP_EXECUTOR_AGENT_AA_ADDRESS,
      description: 'Executes final orchestration and result aggregation.',
      capabilities: ['execute-plan', 'result-aggregation']
    }
  ];
  return seeds.map((item) => sanitizeNetworkAgentRecord(item)).filter((item) => item.id);
}

function ensureNetworkAgents() {
  const rows = readNetworkAgents();
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((item) => sanitizeNetworkAgentRecord(item))
    .filter((item) => item.id);
  if (normalized.length > 0) {
    const before = JSON.stringify(Array.isArray(rows) ? rows : []);
    const after = JSON.stringify(normalized);
    if (before !== after) writeNetworkAgents(normalized);
    return normalized;
  }
  const seeded = createDefaultNetworkAgents();
  writeNetworkAgents(seeded);
  return seeded;
}

function findNetworkAgentById(agentId = '') {
  const id = String(agentId || '').trim().toLowerCase();
  if (!id) return null;
  return ensureNetworkAgents().find((item) => String(item?.id || '').trim().toLowerCase() === id) || null;
}

const xmtpRuntime = createXmtpAgentRuntime({
  enabled: XMTP_ROUTER_RUNTIME_ENABLED,
  runtimeName: 'router-runtime',
  agentId: 'router-agent',
  walletKey: ROUTER_WALLET_KEY_NORMALIZED,
  env: XMTP_ENV,
  dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
  dbDirectory: XMTP_ROUTER_DB_DIRECTORY,
  autoAck: XMTP_AUTO_ACK,
  eventRetention: XMTP_EVENT_RETENTION,
  readEvents: readXmtpEvents,
  writeEvents: writeXmtpEvents,
  resolveAgentById: findNetworkAgentById
});

const xmtpRiskRuntime = createXmtpAgentRuntime({
  enabled: XMTP_RISK_RUNTIME_ENABLED,
  runtimeName: 'risk-runtime',
  agentId: 'risk-agent',
  walletKey: RISK_WALLET_KEY_NORMALIZED,
  env: XMTP_ENV,
  dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
  dbDirectory: XMTP_RISK_DB_DIRECTORY,
  autoAck: true,
  eventRetention: XMTP_EVENT_RETENTION,
  readEvents: readXmtpEvents,
  writeEvents: writeXmtpEvents,
  resolveAgentById: findNetworkAgentById
});

async function startXmtpRuntimes() {
  const router = await xmtpRuntime.start();
  let risk = xmtpRiskRuntime.getStatus();
  if (XMTP_RISK_RUNTIME_ENABLED) {
    risk = await xmtpRiskRuntime.start();
  }
  return { router, risk };
}

async function stopXmtpRuntimes() {
  const router = await xmtpRuntime.stop();
  const risk = await xmtpRiskRuntime.stop();
  return { router, risk };
}

function upsertServiceInvocation(invocation = {}) {
  const rows = readServiceInvocations();
  const invocationId = String(invocation.invocationId || '').trim();
  if (!invocationId) return;
  const idx = rows.findIndex((item) => String(item?.invocationId || '').trim() === invocationId);
  if (idx >= 0) rows[idx] = invocation;
  else rows.unshift(invocation);
  writeServiceInvocations(rows);
}

function mapServiceReceipt(invocation = {}, workflowByTraceId = new Map(), requestById = new Map()) {
  const traceId = String(invocation.traceId || '').trim();
  const workflow = traceId ? workflowByTraceId.get(traceId) || null : null;
  const requestId =
    String(invocation.requestId || '').trim() ||
    String(workflow?.requestId || '').trim();
  const requestItem = requestId ? requestById.get(requestId) || null : null;
  const txHash = String(
    invocation.txHash || requestItem?.paymentTxHash || requestItem?.paymentProof?.txHash || workflow?.txHash || ''
  ).trim();
  const block = requestItem?.proofVerification?.details?.blockNumber || '-';
  const onchainStatus =
    requestItem?.proofVerification
      ? 'success'
      : String(invocation.state || '').trim().toLowerCase() === 'failed'
        ? 'failed'
        : 'pending';

  return {
    invocationId: String(invocation.invocationId || '').trim(),
    serviceId: String(invocation.serviceId || '').trim(),
    traceId,
    requestId,
    state: String(invocation.state || '').trim().toLowerCase() || 'running',
    createdAt: String(invocation.createdAt || '').trim(),
    updatedAt: String(invocation.updatedAt || '').trim(),
    payer: String(invocation.payer || '').trim(),
    sourceAgentId: String(invocation.sourceAgentId || '').trim(),
    targetAgentId: String(invocation.targetAgentId || '').trim(),
    summary: String(invocation.summary || workflow?.result?.summary || '').trim(),
    error: String(invocation.error || workflow?.error || '').trim(),
    x402: {
      amount: String(requestItem?.amount || invocation.amount || '').trim(),
      tokenAddress: String(requestItem?.tokenAddress || invocation.tokenAddress || '').trim(),
      recipient: String(requestItem?.recipient || invocation.recipient || '').trim(),
      status: String(requestItem?.status || '').trim().toLowerCase() || (onchainStatus === 'success' ? 'paid' : 'pending'),
      txHash
    },
    onchain: {
      txHash,
      block,
      status: onchainStatus,
      explorer: txHash ? `https://testnet.kitescan.ai/tx/${txHash}` : ''
    }
  };
}

function computeServiceReputation(service = null, receipts = []) {
  const rows = Array.isArray(receipts) ? receipts : [];
  const total = rows.length;
  const successCount = rows.filter((item) => String(item?.state || '').toLowerCase() === 'success' || String(item?.state || '').toLowerCase() === 'unlocked').length;
  const failedCount = rows.filter((item) => String(item?.state || '').toLowerCase() === 'failed').length;
  const successRate = total > 0 ? successCount / total : 0;
  const onchainSuccessCount = rows.filter((item) => String(item?.onchain?.status || '').toLowerCase() === 'success').length;
  const onchainRatio = total > 0 ? onchainSuccessCount / total : 0;

  const latencies = rows
    .map((item) => {
      const created = Date.parse(String(item?.createdAt || '').trim());
      const updated = Date.parse(String(item?.updatedAt || '').trim());
      if (!Number.isFinite(created) || !Number.isFinite(updated) || updated <= created) return NaN;
      return (updated - created) / 1000;
    })
    .filter((value) => Number.isFinite(value) && value >= 0);
  const avgConfirmSec = latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0;
  const latencyScore = avgConfirmSec <= 0 ? 1 : Math.max(0, Math.min(1, 1 - avgConfirmSec / 120));

  const reputationScore = Number(
    Math.max(
      0,
      Math.min(100, (successRate * 70 + onchainRatio * 20 + latencyScore * 10) * 100)
    ).toFixed(2)
  );

  return {
    serviceId: String(service?.id || '').trim(),
    providerAgentId: String(service?.providerAgentId || '').trim(),
    score: reputationScore,
    grade: reputationScore >= 85 ? 'A' : reputationScore >= 70 ? 'B' : reputationScore >= 55 ? 'C' : 'D',
    factors: {
      successRate: Number((successRate * 100).toFixed(2)),
      onchainMatchRate: Number((onchainRatio * 100).toFixed(2)),
      avgConfirmSec: Number(avgConfirmSec.toFixed(2))
    },
    sampleSize: total,
    failedCount
  };
}

function evaluateServiceInvokeGuard(service = {}, input = {}) {
  const payer = normalizeAddress(input.payer || '');
  const nowMs = Number(input.nowMs || Date.now());
  const invocations = Array.isArray(input.invocations) ? input.invocations : [];
  const checks = [];

  const allowlist = normalizeAddresses(service.allowlistPayers || []);
  if (allowlist.length > 0 && (!payer || !allowlist.includes(payer))) {
    return {
      ok: false,
      code: 'service_payer_not_allowed',
      reason: 'Payer is not in service allowlist.',
      checks: [{ rule: 'allowlistPayers', ok: false, expected: allowlist, got: payer }]
    };
  }
  checks.push({ rule: 'allowlistPayers', ok: true });

  const rpm = Number(service.rateLimitPerMinute || 0);
  if (Number.isFinite(rpm) && rpm > 0) {
    const windowStart = nowMs - 60 * 1000;
    const recentCount = invocations.filter((item) => {
      const at = Date.parse(String(item?.createdAt || item?.updatedAt || '').trim());
      return Number.isFinite(at) && at >= windowStart;
    }).length;
    if (recentCount >= rpm) {
      return {
        ok: false,
        code: 'service_rate_limited',
        reason: `Service per-minute limit exceeded (${recentCount}/${rpm}).`,
        checks: [{ rule: 'rateLimitPerMinute', ok: false, recentCount, limit: rpm }]
      };
    }
    checks.push({ rule: 'rateLimitPerMinute', ok: true, recentCount, limit: rpm });
  }

  const budget = Number(service.budgetPerDay || 0);
  const price = Number(service.price || 0);
  if (Number.isFinite(budget) && budget > 0 && Number.isFinite(price) && price > 0) {
    const dayKey = getUtcDateKey(nowMs);
    const spent = invocations
      .filter((item) => {
        const at = Date.parse(String(item?.updatedAt || item?.createdAt || '').trim());
        if (!Number.isFinite(at)) return false;
        if (getUtcDateKey(at) !== dayKey) return false;
        const state = String(item?.state || '').trim().toLowerCase();
        return state === 'success' || state === 'unlocked';
      })
      .reduce((sum, item) => {
        const amount = Number(item?.amount || price || 0);
        return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0);
    const projected = spent + price;
    if (projected > budget) {
      return {
        ok: false,
        code: 'service_budget_exceeded',
        reason: `Service daily budget exceeded (${projected.toFixed(6)} > ${budget}).`,
        checks: [{ rule: 'budgetPerDay', ok: false, spent: Number(spent.toFixed(6)), projected: Number(projected.toFixed(6)), budget }]
      };
    }
    checks.push({ rule: 'budgetPerDay', ok: true, spent: Number(spent.toFixed(6)), projected: Number(projected.toFixed(6)), budget });
  }

  return {
    ok: true,
    checks
  };
}

function buildServiceStatus(service, allInvocations = [], receipts = []) {
  const rows = allInvocations
    .filter((item) => String(item?.serviceId || '').trim() === String(service?.id || '').trim())
    .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0));

  const total = rows.length;
  const success = rows.filter((item) => ['success', 'unlocked'].includes(String(item?.state || '').trim().toLowerCase())).length;
  const failed = rows.filter((item) => String(item?.state || '').trim().toLowerCase() === 'failed').length;
  const running = rows.filter((item) => String(item?.state || '').trim().toLowerCase() === 'running').length;
  const successRate = total > 0 ? Number(((success / total) * 100).toFixed(2)) : 0;
  const latency = receipts
    .map((item) => {
      const c = Date.parse(String(item?.createdAt || '').trim());
      const u = Date.parse(String(item?.updatedAt || '').trim());
      if (!Number.isFinite(c) || !Number.isFinite(u) || u <= c) return NaN;
      return (u - c) / 1000;
    })
    .filter((v) => Number.isFinite(v) && v >= 0);
  const avgConfirmSec = latency.length > 0 ? Number((latency.reduce((s, v) => s + v, 0) / latency.length).toFixed(2)) : 0;

  return {
    serviceId: String(service?.id || '').trim(),
    state: running > 0 ? 'running' : failed > 0 && success === 0 ? 'degraded' : 'healthy',
    totals: {
      total,
      success,
      failed,
      running
    },
    successRate,
    avgConfirmSec,
    lastUpdatedAt: String(rows[0]?.updatedAt || rows[0]?.createdAt || service?.updatedAt || '').trim(),
    lastError:
      String(
        rows.find((item) => String(item?.error || '').trim())?.error || ''
      ).trim()
  };
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
        id: 'risk-score-feed',
        input: {
          symbol: 'string (BTC/BTCUSDT/BTCUSD)',
          horizonMin: 'number 5-240',
          source: 'hyperliquid (fallback: binance, okx)'
        },
        price: X402_RISK_SCORE_PRICE,
        recipient: KITE_AGENT2_AA_ADDRESS
      },
      {
        id: 'x-reader-feed',
        input: {
          url: 'string (http/https)',
          mode: 'auto/jina',
          maxChars: 'number 200-8000'
        },
        price: X402_X_READER_PRICE,
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

function stableSerialize(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(',')}}`;
}

function buildResponseHash(requestId = '', action = '', resultPayload = {}) {
  const envelope = {
    requestId: String(requestId || '').trim(),
    action: String(action || '').trim().toLowerCase(),
    result: resultPayload && typeof resultPayload === 'object' ? resultPayload : {}
  };
  const canonical = stableSerialize(envelope);
  const responseHash = ethers.keccak256(ethers.toUtf8Bytes(canonical));
  return { envelope, canonical, responseHash };
}

async function signResponseHash(hash = '') {
  const normalized = String(hash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized) || !backendSigner) {
    return {
      signature: '',
      signer: backendSigner?.address || '',
      scheme: 'personal_sign',
      available: Boolean(backendSigner)
    };
  }
  try {
    const signature = await backendSigner.signMessage(ethers.getBytes(normalized));
    return {
      signature: String(signature || '').trim(),
      signer: backendSigner.address,
      scheme: 'personal_sign',
      available: true
    };
  } catch {
    return {
      signature: '',
      signer: backendSigner?.address || '',
      scheme: 'personal_sign',
      available: Boolean(backendSigner)
    };
  }
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

function isTransientTransportError(reason = '') {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('timeout') ||
    text.includes('socket hang up') ||
    text.includes('network')
  );
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

function buildIdentityPayload(profile = {}, extras = {}) {
  return {
    registry: String(profile?.configured?.registry || '').trim(),
    agentId: String(profile?.configured?.agentId || '').trim(),
    agentWallet: normalizeAddress(profile?.agentWallet || ''),
    ownerAddress: normalizeAddress(profile?.ownerAddress || ''),
    tokenURI: String(profile?.tokenURI || '').trim(),
    ...extras
  };
}

function saveIdentityVerificationRecord({
  traceId = '',
  profile = {},
  verifyMode = '',
  status = 'verified',
  challengeId = '',
  nonce = '',
  message = '',
  signature = '',
  issuedAt = 0,
  expiresAt = 0,
  verifiedAt = Date.now(),
  recoveredAddress = ''
} = {}) {
  const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
  rows.unshift({
    challengeId: String(challengeId || createTraceId('idv')).trim(),
    traceId: String(traceId || '').trim(),
    nonce: String(nonce || '').trim(),
    message: String(message || '').trim(),
    signature: String(signature || '').trim(),
    issuedAt: Number(issuedAt || 0),
    expiresAt: Number(expiresAt || 0),
    usedAt: Number(verifiedAt || 0),
    verifiedAt: Number(verifiedAt || 0),
    recoveredAddress: normalizeAddress(recoveredAddress || ''),
    status: String(status || 'verified').trim(),
    verifyMode: String(verifyMode || IDENTITY_VERIFY_MODE || '').trim(),
    identity: buildIdentityPayload(profile)
  });
  writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
}

async function ensureWorkflowIdentityVerified({ traceId = '', identityInput = {} } = {}) {
  const profile = await readIdentityProfile({
    registry: identityInput?.identityRegistry || identityInput?.registry,
    agentId: identityInput?.agentId
  });
  if (!profile?.available) {
    throw new Error(profile?.reason || 'identity_unavailable');
  }

  const agentWallet = normalizeAddress(profile.agentWallet || '');
  if (!ethers.isAddress(agentWallet)) {
    throw new Error('identity_wallet_invalid');
  }

  const now = Date.now();
  if (!isIdentitySignatureRequired()) {
    saveIdentityVerificationRecord({
      traceId,
      profile,
      verifyMode: 'registry',
      status: 'verified_registry',
      issuedAt: now,
      expiresAt: now,
      verifiedAt: now,
      recoveredAddress: agentWallet
    });
    return {
      verifyMode: 'registry',
      signatureRequired: false,
      verifiedAt: new Date(now).toISOString(),
      identity: buildIdentityPayload(profile, {
        verifyMode: 'registry',
        verifiedAt: new Date(now).toISOString()
      }),
      profile: buildIdentitySummary(profile)
    };
  }

  if (!backendSigner) {
    throw new Error('identity_signature_required_but_backend_signer_unavailable');
  }

  const signerAddress = normalizeAddress(backendSigner.address || '');
  if (!signerAddress || signerAddress !== agentWallet) {
    throw new Error(
      `identity_signer_mismatch: backend_signer=${signerAddress || '-'} expected_agent_wallet=${agentWallet}`
    );
  }

  const challengeId = createTraceId('idv');
  const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
  const ttl = Number.isFinite(IDENTITY_CHALLENGE_TTL_MS) && IDENTITY_CHALLENGE_TTL_MS > 0
    ? IDENTITY_CHALLENGE_TTL_MS
    : 120_000;
  const expiresAt = now + ttl;
  const message = createIdentityChallengeMessage({
    challengeId,
    traceId,
    nonce,
    issuedAt: now,
    expiresAt,
    profile
  });
  const signature = await backendSigner.signMessage(message);
  const recoveredAddress = normalizeAddress(ethers.verifyMessage(message, signature));
  if (!recoveredAddress || recoveredAddress !== agentWallet) {
    throw new Error(
      `identity_signature_invalid: recovered=${recoveredAddress || '-'} expected_agent_wallet=${agentWallet}`
    );
  }

  saveIdentityVerificationRecord({
    traceId,
    profile,
    verifyMode: 'signature',
    status: 'verified',
    challengeId,
    nonce,
    message,
    signature,
    issuedAt: now,
    expiresAt,
    verifiedAt: now,
    recoveredAddress
  });

  return {
    verifyMode: 'signature',
    signatureRequired: true,
    verifiedAt: new Date(now).toISOString(),
    identity: buildIdentityPayload(profile, {
      verifyMode: 'signature',
      verifiedAt: new Date(now).toISOString(),
      challengeId
    }),
    profile: buildIdentitySummary(profile)
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

app.get('/api/demo/price-series', requireRole('viewer'), (req, res) => {
  const { limit, series } = buildDemoPriceSeries(req.query.limit);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    window: {
      limit,
      intervalSec: 60
    },
    series
  });
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

    let payBody = {};
    try {
      const pay = await postSessionPayWithRetry(
        {
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount,
          requestId,
          action: 'reactive-stop-orders',
          query: `A2A stop-order ${symbol} tp=${takeProfit} sl=${stopLoss}${
            hasQuantity ? ` qty=${quantity}` : ''
          }`
        },
        { maxAttempts: 3, timeoutMs: 210_000 }
      );
      payBody = pay.body || {};
    } catch (error) {
      payBody = error?.payBody || {};
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
      throw new Error(payBody?.reason || payBody?.error || error?.message || 'session pay failed');
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

    let payBody = {};
    try {
      const pay = await postSessionPayWithRetry(
        {
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount,
          requestId,
          action: 'btc-price-feed',
        query: `ATAPI BTC price ${pair} source=${source}`
        },
        { maxAttempts: 3, timeoutMs: 210_000 }
      );
      payBody = pay.body || {};
    } catch (error) {
      payBody = error?.payBody || {};
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
      throw new Error(payBody?.reason || payBody?.error || error?.message || 'session pay failed');
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
      quote: proofResult?.body?.result?.quote || null,
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
                query: `ATAPI BTC price ${workflow?.input?.pair || 'BTCUSDT'}`.trim(),
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

app.post('/api/workflow/risk-score/run', requireRole('agent'), async (req, res) => {
  let normalizedTask = null;
  try {
    normalizedTask = normalizeRiskScoreParams({
      symbol: req.body?.symbol || req.body?.pair || 'BTCUSDT',
      source: req.body?.source || 'hyperliquid',
      horizonMin: req.body?.horizonMin ?? 60
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_task',
      reason: error?.message || 'invalid task'
    });
  }

  const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = resolveWorkflowTraceId(req.body?.traceId);
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
  const workflow = {
    traceId,
    type: 'risk-score',
    state: 'running',
    sourceAgentId,
    targetAgentId,
    payer,
    input: normalizedTask,
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
    const challengeResult = await handleA2ARiskScore({
      payer,
      sourceAgentId,
      targetAgentId,
      traceId,
      task: normalizedTask
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
      symbol: normalizedTask.symbol,
      horizonMin: normalizedTask.horizonMin
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    let payBody = {};
    try {
      const pay = await postSessionPayWithRetry(
        {
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount,
          requestId,
          action: 'risk-score-feed',
          query: `A2A risk-score ${normalizedTask.symbol} horizon=${normalizedTask.horizonMin} source=${normalizedTask.source}`
        },
        { maxAttempts: 3, timeoutMs: 210_000 }
      );
      payBody = pay.body || {};
    } catch (error) {
      payBody = error?.payBody || {};
      throw new Error(payBody?.reason || payBody?.error || error?.message || 'session pay failed');
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
      symbol: normalizedTask.symbol,
      horizonMin: normalizedTask.horizonMin
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const proofResult = await handleA2ARiskScore({
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
      task: normalizedTask
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
      quote: proofResult?.body?.result?.quote || null,
      risk: proofResult?.body?.result?.risk || null,
      symbol: normalizedTask.symbol,
      horizonMin: normalizedTask.horizonMin
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
                action: 'risk-score-feed',
                query: `A2A risk-score ${workflow?.input?.symbol || 'BTCUSDT'} horizon=${workflow?.input?.horizonMin || 60}`.trim(),
                payer: workflow.payer || '',
                amount: String(X402_RISK_SCORE_PRICE || ''),
                tokenAddress: SETTLEMENT_TOKEN,
                recipient: KITE_AGENT2_AA_ADDRESS,
                paymentTxHash: workflow.txHash || '',
                a2a: {
                  sourceAgentId: workflow.sourceAgentId,
                  targetAgentId: workflow.targetAgentId,
                  taskType: 'risk-score-feed',
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

app.post('/api/workflow/x-reader/run', requireRole('agent'), async (req, res) => {
  let normalizedTask = null;
  try {
    normalizedTask = normalizeXReaderParams({
      url: req.body?.url || req.body?.resourceUrl,
      mode: req.body?.mode || req.body?.source || 'auto',
      maxChars: req.body?.maxChars ?? X_READER_MAX_CHARS_DEFAULT
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_task',
      reason: error?.message || 'invalid task'
    });
  }

  const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = resolveWorkflowTraceId(req.body?.traceId);
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
  const workflow = {
    traceId,
    type: 'x-reader',
    state: 'running',
    sourceAgentId,
    targetAgentId,
    payer,
    input: normalizedTask,
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
    const challengeResult = await handleA2AXReader({
      payer,
      sourceAgentId,
      targetAgentId,
      traceId,
      task: normalizedTask
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
      url: normalizedTask.url
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    let payBody = {};
    try {
      const pay = await postSessionPayWithRetry(
        {
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount,
          requestId,
          action: 'x-reader-feed',
          query: `ATAPI x-reader ${normalizedTask.url}`
        },
        { maxAttempts: 3, timeoutMs: 210_000 }
      );
      payBody = pay.body || {};
    } catch (error) {
      payBody = error?.payBody || {};
      throw new Error(payBody?.reason || payBody?.error || error?.message || 'session pay failed');
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
      url: normalizedTask.url
    });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const proofResult = await handleA2AXReader({
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
      task: normalizedTask
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
      reader: proofResult?.body?.result?.reader || null,
      url: normalizedTask.url
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
                action: 'x-reader-feed',
                query: `ATAPI x-reader ${workflow?.input?.url || ''}`.trim(),
                payer: workflow.payer || '',
                amount: String(X402_X_READER_PRICE || ''),
                tokenAddress: SETTLEMENT_TOKEN,
                recipient: KITE_AGENT2_AA_ADDRESS,
                paymentTxHash: workflow.txHash || '',
                a2a: {
                  sourceAgentId: workflow.sourceAgentId,
                  targetAgentId: workflow.targetAgentId,
                  taskType: 'x-reader-feed',
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

app.get('/api/demo/trace-by-request/:requestId', requireRole('viewer'), (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ ok: false, error: 'requestId_required' });
  }
  const workflows = readWorkflows();
  const workflow = workflows.find((w) => String(w.requestId || '').trim() === requestId);
  if (!workflow?.traceId) {
    return res.status(404).json({ ok: false, error: 'workflow_not_found_by_request', requestId });
  }
  return res.json({
    ok: true,
    requestId,
    traceId: String(workflow.traceId || '').trim()
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

app.get('/api/receipt/:requestId', requireRole('viewer'), async (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ ok: false, error: 'requestId_required' });
  }
  const requests = readX402Requests();
  const reqItem = requests.find((item) => String(item?.requestId || '').trim() === requestId);
  if (!reqItem) {
    return res.status(404).json({ ok: false, error: 'request_not_found', requestId });
  }

  const workflowByRequestId = buildLatestWorkflowByRequestId(readWorkflows());
  const workflow = workflowByRequestId.get(requestId) || null;
  const action = String(reqItem?.action || workflow?.type || '').trim().toLowerCase();
  const resultPayload = (workflow?.result && typeof workflow.result === 'object' ? workflow.result : null) ||
    (reqItem?.result && typeof reqItem.result === 'object' ? reqItem.result : {}) ||
    {};
  const { responseHash } = buildResponseHash(requestId, action, resultPayload);
  const signatureBundle = await signResponseHash(responseHash);

  const txHash = String(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash || '').trim();
  const block = reqItem?.proofVerification?.details?.blockNumber ?? '-';
  const onchainStatus =
    reqItem?.proofVerification
      ? 'success'
      : ['failed', 'expired', 'rejected', 'error'].includes(String(reqItem?.status || '').trim().toLowerCase())
        ? 'failed'
        : 'pending';
  const explorer = txHash ? `https://testnet.kitescan.ai/tx/${txHash}` : '';
  const flow =
    String(reqItem?.a2a?.sourceAgentId || '').trim() && String(reqItem?.a2a?.targetAgentId || '').trim()
      ? 'a2a+x402'
      : 'agent-to-api+x402';

  const receiptPayload = {
    version: 'kiteclaw-receipt-v1',
    generatedAt: new Date().toISOString(),
    requestId,
    workflowTraceId: String(workflow?.traceId || reqItem?.a2a?.traceId || '').trim(),
    action,
    flow,
    identity: {
      agentId: reqItem?.identity?.agentId || '',
      registry: reqItem?.identity?.registry || '',
      wallet: reqItem?.identity?.agentWallet || ''
    },
    payment: {
      amount: String(reqItem?.amount || '').trim(),
      tokenAddress: String(reqItem?.tokenAddress || '').trim(),
      payer: String(reqItem?.payer || workflow?.payer || '').trim(),
      payee: String(reqItem?.recipient || '').trim(),
      txHash,
      userOpHash: String(workflow?.userOpHash || '').trim(),
      settledAt: Number(reqItem?.paidAt || 0) > 0 ? new Date(Number(reqItem.paidAt)).toISOString() : ''
    },
    onchainConfirmation: {
      txHash,
      block,
      status: onchainStatus,
      explorer,
      mode: reqItem?.proofVerification?.mode || 'onchain_transfer_log',
      verifiedAt:
        Number(reqItem?.proofVerification?.verifiedAt || 0) > 0
          ? new Date(Number(reqItem.proofVerification.verifiedAt)).toISOString()
          : ''
    },
    apiResult: {
      summary: String(resultPayload?.summary || '').trim(),
      payload: resultPayload,
      responseHash,
      responseSignature: signatureBundle.signature,
      signer: signatureBundle.signer,
      signatureScheme: signatureBundle.scheme,
      signatureAvailable: signatureBundle.available
    }
  };

  const shouldDownload = /^(1|true|yes|download)$/i.test(String(req.query.download || '').trim());
  if (shouldDownload) {
    const fileName = `kiteclaw_receipt_${requestId}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"${fileName}\"`);
  }
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    receipt: receiptPayload
  });
});

app.get('/api/receipt/:requestId/excerpt', requireRole('viewer'), async (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ ok: false, error: 'requestId_required' });
  }

  const requests = readX402Requests();
  const reqIndex = requests.findIndex((item) => String(item?.requestId || '').trim() === requestId);
  if (reqIndex < 0) {
    return res.status(404).json({ ok: false, error: 'request_not_found', requestId });
  }

  const reqItem = requests[reqIndex];
  if (String(reqItem?.action || '').trim().toLowerCase() !== 'x-reader-feed') {
    return res.status(400).json({
      ok: false,
      error: 'excerpt_not_supported',
      reason: 'only x-reader-feed supports excerpt retrieval'
    });
  }

  const state = String(reqItem?.status || '').trim().toLowerCase();
  const isUnlocked = state === 'paid' || state === 'unlocked';
  if (!isUnlocked) {
    return res.status(409).json({
      ok: false,
      error: 'request_not_unlocked',
      reason: `request state is ${state || 'pending'}`
    });
  }

  const maxChars = parseExcerptMaxChars(req.query.maxChars, 8000);
  const forceRefresh = /^(1|true|yes|refresh)$/i.test(String(req.query.refresh || '').trim());
  const workflowByRequestId = buildLatestWorkflowByRequestId(readWorkflows());
  const workflow = workflowByRequestId.get(requestId) || null;
  const workflowReader =
    workflow?.result?.reader && typeof workflow.result.reader === 'object'
      ? workflow.result.reader
      : null;
  const storedReader =
    reqItem?.result?.reader && typeof reqItem.result.reader === 'object'
      ? reqItem.result.reader
      : workflowReader;
  const storedExcerpt = String(storedReader?.excerpt || '').trim();
  const shouldRefresh = forceRefresh || !storedExcerpt || storedExcerpt.length < maxChars;

  let reader = storedReader;
  let source = 'stored';
  if (shouldRefresh) {
    try {
      const normalizedTask = normalizeXReaderParams({
        url: reqItem?.actionParams?.url || storedReader?.url || '',
        mode: reqItem?.actionParams?.mode || storedReader?.mode || 'auto',
        maxChars
      });
      reader = await fetchXReaderDigest(normalizedTask);
      source = 'refreshed';
      reqItem.actionParams = {
        ...(reqItem.actionParams || {}),
        ...normalizedTask
      };
      reqItem.result = {
        ...(reqItem.result || {}),
        summary: String(reqItem?.result?.summary || `x-reader digest unlocked by x402 payment: ${reader.title || reader.url}`).trim(),
        reader
      };
      requests[reqIndex] = reqItem;
      writeX402Requests(requests);
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: 'x_reader_fetch_failed',
        reason: error?.message || 'x_reader_fetch_failed'
      });
    }
  }

  const excerpt = String(reader?.excerpt || '').trim();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    requestId,
    excerpt: {
      provider: String(reader?.provider || 'x-reader').trim() || 'x-reader',
      url: String(reader?.url || reqItem?.actionParams?.url || '').trim(),
      title: String(reader?.title || '').trim(),
      mode: String(reader?.mode || reqItem?.actionParams?.mode || 'auto').trim(),
      contentLength: Number(reader?.contentLength || excerpt.length || 0),
      maxCharsRequested: maxChars,
      capped: excerpt.length >= maxChars,
      fetchedAt: String(reader?.fetchedAt || '').trim(),
      source,
      excerpt
    }
  });
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
  const identityInput = body.identity || {};

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
  const a2aQuery = `ATAPI BTC price ${task.pair} source=${task.source}`;

  if (!requestId || !paymentProof) {
    let identityVerification = null;
    try {
      identityVerification = await ensureWorkflowIdentityVerified({
        traceId,
        identityInput
      });
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'identity_verification_failed',
          reason: error?.message || 'identity verification failed'
        }
      };
    }

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
      },
      identity: identityVerification?.identity
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
          task,
          identity: identityVerification?.identity || null
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
          summary: reqItem?.result?.summary || 'ATAPI BTC price quote already unlocked',
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
          summary: reqItem?.result?.summary || 'ATAPI BTC price quote already unlocked'
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
    summary: `ATAPI BTC price quote unlocked by x402 payment: ${quoteSummary}`,
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

async function handleA2ARiskScore(body = {}) {
  const payer = String(body.payer || '').trim();
  const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = String(body.traceId || '').trim();
  const requestId = String(body.requestId || '').trim();
  const paymentProof = body.paymentProof;
  const taskInput = body.task || {};
  const identityInput = body.identity || {};

  let task = null;
  try {
    task = normalizeRiskScoreParams(taskInput);
  } catch (error) {
    return {
      status: 400,
      body: {
        error: 'invalid_task',
        reason: error.message
      }
    };
  }

  const actionCfg = getActionConfig('risk-score-feed');
  const actionAmount = String(actionCfg?.amount || X402_RISK_SCORE_PRICE || '0.00002');
  const requests = readX402Requests();
  const a2aQuery = `A2A risk-score ${task.symbol} horizon=${task.horizonMin} source=${task.source}`;

  if (!requestId || !paymentProof) {
    let identityVerification = null;
    try {
      identityVerification = await ensureWorkflowIdentityVerified({
        traceId,
        identityInput
      });
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'identity_verification_failed',
          reason: error?.message || 'identity verification failed'
        }
      };
    }

    const policyResult = evaluateTransferPolicy({
      payer,
      recipient: actionCfg.recipient,
      amount: actionAmount,
      requests
    });
    if (!policyResult.ok) {
      logPolicyFailure({
        action: 'a2a-risk-score-feed',
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
      },
      identity: identityVerification?.identity
    });
    reqItem.actionParams = task;
    reqItem.a2a = {
      sourceAgentId,
      targetAgentId,
      taskType: 'risk-score-feed',
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
          taskType: 'risk-score-feed',
          task,
          identity: identityVerification?.identity || null
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
    let riskResult = reqItem?.result || null;
    if (!riskResult) {
      try {
        riskResult = await runRiskScoreAnalysis(reqItem.actionParams || task);
      } catch {
        riskResult = null;
      }
    }
    return {
      status: 200,
      body: {
        ok: true,
        mode: 'x402',
        requestId: reqItem.requestId,
        reused: true,
        result: riskResult || { summary: 'A2A risk score already unlocked' },
        a2a: reqItem.a2a || null,
        receipt: buildA2AReceipt(reqItem, null, {
          traceId,
          sourceAgentId,
          targetAgentId,
          capability: 'risk-score-feed',
          phase: 'settled',
          state: 'success',
          summary: reqItem?.result?.summary || 'A2A risk score already unlocked'
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

  const riskResult = await runRiskScoreAnalysis(reqItem.actionParams || task);

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
    taskType: String(reqItem?.a2a?.taskType || 'risk-score-feed').trim(),
    traceId: String(reqItem?.a2a?.traceId || traceId).trim()
  };
  reqItem.result = {
    summary: `A2A risk score unlocked by x402 payment: ${riskResult.summary}`,
    ...riskResult
  };
  writeX402Requests(requests);

  const receipt = buildA2AReceipt(reqItem, null, {
    traceId: reqItem?.a2a?.traceId || traceId,
    sourceAgentId,
    targetAgentId,
    capability: 'risk-score-feed',
    phase: 'settled',
    state: 'success',
    summary: reqItem?.result?.summary || riskResult.summary
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
        taskType: 'risk-score-feed'
      },
      receipt
    }
  };
}

async function handleA2AXReader(body = {}) {
  const payer = String(body.payer || '').trim();
  const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(body.targetAgentId || KITE_AGENT2_ID).trim();
  const traceId = String(body.traceId || '').trim();
  const requestId = String(body.requestId || '').trim();
  const paymentProof = body.paymentProof;
  const taskInput = body.task || {};
  const identityInput = body.identity || {};

  let task = null;
  try {
    task = normalizeXReaderParams({
      url: body.url || taskInput.url || taskInput.resourceUrl,
      mode: body.mode || body.source || taskInput.mode || taskInput.source || 'auto',
      maxChars: body.maxChars ?? taskInput.maxChars ?? X_READER_MAX_CHARS_DEFAULT
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

  const actionCfg = getActionConfig('x-reader-feed');
  const actionAmount = String(actionCfg?.amount || X402_X_READER_PRICE || '0.00001');
  const requests = readX402Requests();
  const a2aQuery = `ATAPI x-reader ${task.url}`;

  if (!requestId || !paymentProof) {
    let identityVerification = null;
    try {
      identityVerification = await ensureWorkflowIdentityVerified({
        traceId,
        identityInput
      });
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'identity_verification_failed',
          reason: error?.message || 'identity verification failed'
        }
      };
    }

    const policyResult = evaluateTransferPolicy({
      payer,
      recipient: actionCfg.recipient,
      amount: actionAmount,
      requests
    });
    if (!policyResult.ok) {
      logPolicyFailure({
        action: 'a2a-x-reader-feed',
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
      },
      identity: identityVerification?.identity
    });
    reqItem.actionParams = task;
    reqItem.a2a = {
      sourceAgentId,
      targetAgentId,
      taskType: 'x-reader-feed',
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
          taskType: 'x-reader-feed',
          task,
          identity: identityVerification?.identity || null
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
    let reader = reqItem?.result?.reader || null;
    if (!reader) {
      try {
        reader = await fetchXReaderDigest(reqItem.actionParams || task);
      } catch {
        reader = null;
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
          summary: reqItem?.result?.summary || 'ATAPI x-reader digest already unlocked',
          reader
        },
        a2a: reqItem.a2a || null,
        receipt: buildA2AReceipt(reqItem, null, {
          traceId,
          sourceAgentId,
          targetAgentId,
          capability: 'x-reader-feed',
          phase: 'settled',
          state: 'success',
          summary: reqItem?.result?.summary || 'ATAPI x-reader digest already unlocked'
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

  const reader = await fetchXReaderDigest(reqItem.actionParams || task);
  const summaryTail = reader.title || reader.url || 'x-reader digest';

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
    taskType: String(reqItem?.a2a?.taskType || 'x-reader-feed').trim(),
    traceId: String(reqItem?.a2a?.traceId || traceId).trim()
  };
  reqItem.result = {
    summary: `ATAPI x-reader digest unlocked by x402 payment: ${summaryTail}`,
    reader
  };
  writeX402Requests(requests);

  const receipt = buildA2AReceipt(reqItem, null, {
    traceId: reqItem?.a2a?.traceId || traceId,
    sourceAgentId,
    targetAgentId,
    capability: 'x-reader-feed',
    phase: 'settled',
    state: 'success',
    summary: reqItem?.result?.summary || summaryTail
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
        taskType: 'x-reader-feed'
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
  const identityInput = body.identity || {};

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
    let identityVerification = null;
    try {
      identityVerification = await ensureWorkflowIdentityVerified({
        traceId,
        identityInput
      });
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'identity_verification_failed',
          reason: error?.message || 'identity verification failed'
        }
      };
    }

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
      },
      identity: identityVerification?.identity
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
          task: actionParams,
          identity: identityVerification?.identity || null
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

app.post('/api/a2a/tasks/risk-score', requireRole('agent'), async (req, res) => {
  try {
    const result = await handleA2ARiskScore(req.body);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'a2a_risk_score_handler_failed',
      reason: error.message || 'Unknown error'
    });
  }
});

app.post('/api/a2a/tasks/x-reader', requireRole('agent'), async (req, res) => {
  try {
    const result = await handleA2AXReader(req.body);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'a2a_x_reader_handler_failed',
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
  if (actionCfg.action === 'risk-score-feed') {
    try {
      normalizedActionParams = normalizeRiskScoreParams(actionParamsInput || {});
    } catch (error) {
      return res.status(400).json({
        error: 'invalid_risk_score_params',
        reason: error.message
      });
    }
  }
  if (actionCfg.action === 'x-reader-feed') {
    try {
      normalizedActionParams = normalizeXReaderParams(actionParamsInput || {});
    } catch (error) {
      return res.status(400).json({
        error: 'invalid_x_reader_params',
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
    if (reqItem.action === 'risk-score-feed') {
      let riskResult = reqItem?.result || null;
      if (!riskResult) {
        try {
          riskResult = await runRiskScoreAnalysis(reqItem.actionParams || {});
        } catch {
          riskResult = null;
        }
      }
      paidResult = riskResult || {
        summary: 'BTC risk score already unlocked'
      };
    }
    if (reqItem.action === 'x-reader-feed') {
      let reader = reqItem?.result?.reader || null;
      if (!reader) {
        try {
          reader = await fetchXReaderDigest(reqItem.actionParams || {});
        } catch {
          reader = null;
        }
      }
      paidResult = {
        summary: reqItem?.result?.summary || 'x-reader digest already unlocked',
        reader
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
  if (reqItem.action === 'risk-score-feed') {
    const riskResult = await runRiskScoreAnalysis(reqItem.actionParams || {});
    finalResult = riskResult;
  }
  if (reqItem.action === 'x-reader-feed') {
    const reader = await fetchXReaderDigest(reqItem.actionParams || {});
    finalResult = {
      summary: `x-reader digest unlocked by x402 payment: ${reader.title || reader.url}`,
      reader
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

app.get('/api/network/agents', requireRole('viewer'), (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 80), 300));
  const activeOnly = /^(1|true|yes|on)$/i.test(String(req.query.active || '').trim());
  const rows = ensureNetworkAgents()
    .filter((item) => (activeOnly ? item?.active !== false : true))
    .slice(0, limit);
  const routerStatus = xmtpRuntime.getStatus();
  const riskStatus = xmtpRiskRuntime.getStatus();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    network: {
      total: rows.length,
      xmtp: {
        env: routerStatus.env || XMTP_ENV,
        router: {
          enabled: routerStatus.enabled,
          running: routerStatus.running
        },
        risk: {
          enabled: riskStatus.enabled,
          running: riskStatus.running
        }
      }
    },
    items: rows
  });
});

app.post('/api/network/agents/publish', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const requestedId = String(body.id || '').trim().toLowerCase();
  if (!requestedId) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'agent_id_required',
      reason: 'id is required.'
    });
  }
  const rows = ensureNetworkAgents();
  const idx = rows.findIndex((item) => String(item?.id || '').trim().toLowerCase() === requestedId);
  const existing = idx >= 0 ? rows[idx] : null;
  const record = sanitizeNetworkAgentRecord(
    {
      ...body,
      id: requestedId,
      active: body.active !== false
    },
    existing
  );
  if (!record.id) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'agent_id_invalid',
      reason: 'invalid id'
    });
  }
  if (idx >= 0) rows[idx] = record;
  else rows.unshift(record);
  writeNetworkAgents(rows);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    mode: idx >= 0 ? 'updated' : 'created',
    agent: record
  });
});

app.get('/api/xmtp/status', requireRole('viewer'), (req, res) => {
  const router = xmtpRuntime.getStatus();
  const risk = xmtpRiskRuntime.getStatus();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    xmtp: {
      env: router.env || XMTP_ENV,
      router,
      risk
    }
  });
});

app.post('/api/xmtp/start', requireRole('admin'), async (req, res) => {
  const status = await startXmtpRuntimes();
  const ok = Boolean(status?.router?.running);
  return res.status(ok ? 200 : 400).json({
    ok,
    traceId: req.traceId || '',
    xmtp: status,
    reason: ok ? '' : status?.router?.lastError || 'xmtp_runtime_not_running'
  });
});

app.post('/api/xmtp/stop', requireRole('admin'), async (req, res) => {
  const status = await stopXmtpRuntimes();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    xmtp: status
  });
});

app.get('/api/xmtp/automation/status', requireRole('viewer'), (req, res) => {
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'xmtp-network-self-talk',
      ...getAutoXmtpNetworkStatus()
    }
  });
});

app.post('/api/xmtp/automation/start', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  startAutoXmtpNetworkLoop({
    intervalMs: body.intervalMs,
    sourceAgentId: body.sourceAgentId,
    targetAgentIds: body.targetAgentIds,
    capability: body.capability,
    immediate: body.immediate !== false,
    reason: 'manual'
  });
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'xmtp-network-self-talk',
      ...getAutoXmtpNetworkStatus()
    }
  });
});

app.post('/api/xmtp/automation/stop', requireRole('admin'), (req, res) => {
  stopAutoXmtpNetworkLoop();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'xmtp-network-self-talk',
      ...getAutoXmtpNetworkStatus()
    }
  });
});

app.get('/api/xmtp/events', requireRole('viewer'), (req, res) => {
  const items = xmtpRuntime.listEvents({
    limit: req.query.limit,
    direction: req.query.direction,
    runtimeName: req.query.runtimeName,
    fromAgentId: req.query.fromAgentId,
    toAgentId: req.query.toAgentId,
    conversationId: req.query.conversationId,
    kind: req.query.kind,
    traceId: req.query.traceId,
    requestId: req.query.requestId,
    taskId: req.query.taskId
  });
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    total: items.length,
    items
  });
});

app.get('/api/xmtp/can-message', requireRole('viewer'), async (req, res) => {
  const toAgentId = String(req.query.toAgentId || '').trim();
  const candidateAddress = String(req.query.toAddress || '').trim();
  const resolved = toAgentId ? findNetworkAgentById(toAgentId) : null;
  const toAddress = normalizeAddress(candidateAddress || resolved?.xmtpAddress || '');
  if (!toAddress) {
    return res.status(400).json({
      ok: false,
      error: 'toAddress_required',
      reason: 'Provide valid toAddress or toAgentId with configured xmtpAddress.',
      traceId: req.traceId || ''
    });
  }
  const result = await xmtpRuntime.canMessageAddress(toAddress);
  return res.json({
    ok: result.ok,
    traceId: req.traceId || '',
    toAddress,
    toAgentId,
    canMessage: result.canMessage,
    reason: result.reason,
    details: result.details || {}
  });
});

app.post('/api/xmtp/dm/send', requireRole('agent'), async (req, res) => {
  const body = req.body || {};
  if (!xmtpRuntime.getStatus().running && body.autoStart === true) {
    await startXmtpRuntimes();
  }
  const result = await xmtpRuntime.sendDm({
    fromAgentId: body.fromAgentId,
    toAgentId: body.toAgentId,
    toAddress: body.toAddress,
    channel: body.channel || 'dm',
    hopIndex: body.hopIndex,
    text: body.text,
    envelope: body.envelope,
    traceId: body.traceId,
    requestId: body.requestId,
    taskId: body.taskId
  });
  if (!result?.ok) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: result?.error || 'xmtp_send_failed',
      reason: result?.reason || 'xmtp_send_failed',
      details: result
    });
  }
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    message: result
  });
});

app.post('/api/network/tasks/run', requireRole('agent'), async (req, res) => {
  const body = req.body || {};
  const toAgentId = String(body.toAgentId || '').trim();
  if (!toAgentId) {
    return res.status(400).json({
      ok: false,
      error: 'toAgentId_required',
      reason: 'toAgentId is required for network task routing.',
      traceId: req.traceId || ''
    });
  }

  const traceId = String(body.traceId || createTraceId('xmtp_trace')).trim();
  const requestId = String(body.requestId || createTraceId('xmtp_req')).trim();
  const taskId = String(body.taskId || createTraceId('xmtp_task')).trim();
  const fromAgentId = String(body.fromAgentId || 'router-agent').trim().toLowerCase();
  const capability = String(body.capability || '').trim();
  const mode = String(body.mode || 'a2a').trim().toLowerCase();
  const channel = String(body.channel || 'dm').trim().toLowerCase() || 'dm';
  const hopIndex = Number.isFinite(Number(body.hopIndex)) ? Number(body.hopIndex) : 1;
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {};
  const paymentIntent =
    body.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
      ? body.paymentIntent
      : {};

  const envelope = {
    kind: 'task-envelope',
    protocolVersion: 'kite-agent-task-v1',
    traceId,
    requestId,
    taskId,
    fromAgentId,
    toAgentId,
    channel,
    hopIndex,
    mode,
    capability,
    input,
    paymentIntent,
    expectsReply: body.expectsReply !== false,
    timestamp: new Date().toISOString()
  };

  if (!xmtpRuntime.getStatus().running && body.autoStart !== false) {
    await startXmtpRuntimes();
  }
  const result = await xmtpRuntime.sendDm({
    fromAgentId,
    toAgentId,
    toAddress: body.toAddress,
    channel,
    hopIndex,
    envelope,
    traceId,
    requestId,
    taskId
  });
  if (!result?.ok) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: result?.error || 'network_task_send_failed',
      reason: result?.reason || 'network_task_send_failed',
      details: result
    });
  }

  return res.json({
    ok: true,
    traceId: req.traceId || '',
    task: {
      fromAgentId,
      toAgentId,
      traceId,
      requestId,
      taskId,
      channel,
      hopIndex,
      mode,
      capability
    },
    xmtp: result
  });
});

app.post('/api/network/demo/router-risk/run', requireRole('agent'), async (req, res) => {
  const body = req.body || {};
  const autoStart = body.autoStart !== false;
  if (autoStart) {
    await startXmtpRuntimes();
  }
  const routerStatus = xmtpRuntime.getStatus();
  if (!routerStatus.running) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'xmtp_router_not_running',
      reason: routerStatus.lastError || 'router runtime is not running'
    });
  }

  const riskAgent = findNetworkAgentById('risk-agent');
  const riskAddress = normalizeAddress(body.toAddress || riskAgent?.xmtpAddress || XMTP_RISK_RESOLVED_ADDRESS);
  if (!riskAddress) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'risk_agent_address_missing',
      reason: 'Set XMTP_RISK_AGENT_ADDRESS or XMTP_RISK_WALLET_KEY and ensure mapping exists.'
    });
  }

  const traceId = String(body.traceId || createTraceId('router_risk_trace')).trim();
  const requestId = String(body.requestId || createTraceId('router_risk_req')).trim();
  const taskId = String(body.taskId || createTraceId('router_risk_task')).trim();
  const capability = String(body.capability || 'risk-score-feed').trim();
  const envelope = {
    kind: 'task-envelope',
    protocolVersion: 'kite-agent-task-v1',
    traceId,
    requestId,
    taskId,
    fromAgentId: 'router-agent',
    toAgentId: 'risk-agent',
    channel: 'dm',
    hopIndex: 1,
    mode: 'a2a',
    capability,
    input:
      body.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? body.input
        : {
            symbol: 'BTCUSDT',
            horizonMin: 60,
            source: 'router-risk-demo'
          },
    paymentIntent:
      body.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
        ? body.paymentIntent
        : {
            mode: 'mock'
          },
    expectsReply: true,
    timestamp: new Date().toISOString()
  };

  const sent = await xmtpRuntime.sendDm({
    fromAgentId: 'router-agent',
    toAgentId: 'risk-agent',
    toAddress: riskAddress,
    channel: 'dm',
    hopIndex: 1,
    envelope,
    traceId,
    requestId,
    taskId
  });
  if (!sent?.ok) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: sent?.error || 'router_risk_send_failed',
      reason: sent?.reason || 'router_risk_send_failed',
      details: sent
    });
  }

  const waitMsLimit = Math.max(500, Math.min(Number(body.waitMs || 10_000), 20_000));
  const deadline = Date.now() + waitMsLimit;
  let ackEvent = null;
  while (Date.now() <= deadline) {
    const hits = xmtpRuntime.listEvents({
      runtimeName: 'router-runtime',
      direction: 'inbound',
      kind: 'task-ack',
      taskId
    });
    if (Array.isArray(hits) && hits.length > 0) {
      ackEvent = hits[0];
      break;
    }
    await waitMs(350);
  }

  return res.json({
    ok: true,
    traceId: req.traceId || '',
    task: {
      traceId,
      requestId,
      taskId,
      fromAgentId: 'router-agent',
      toAgentId: 'risk-agent',
      capability,
      hopIndex: 1
    },
    xmtp: sent,
    ackReceived: Boolean(ackEvent),
    ackEvent,
    runtime: {
      router: xmtpRuntime.getStatus(),
      risk: xmtpRiskRuntime.getStatus()
    }
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

app.get('/api/services', requireRole('viewer'), (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 500));
  const activeOnly = String(req.query.active || '').trim().toLowerCase();
  const rows = ensureServiceCatalog()
    .filter((item) => {
      if (activeOnly === '1' || activeOnly === 'true') return item?.active !== false;
      if (activeOnly === '0' || activeOnly === 'false') return item?.active === false;
      return true;
    })
    .sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0))
    .slice(0, limit);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    total: rows.length,
    items: rows
  });
});

app.get('/api/services/:serviceId', requireRole('viewer'), (req, res) => {
  const serviceId = String(req.params.serviceId || '').trim();
  if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
  const service = ensureServiceCatalog().find((item) => String(item?.id || '').trim() === serviceId);
  if (!service) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
  const recentInvocations = readServiceInvocations()
    .filter((item) => String(item?.serviceId || '').trim() === serviceId)
    .slice(0, 12);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    service,
    recentInvocations
  });
});

app.post('/api/services/publish', requireRole('admin'), (req, res) => {
  try {
    const body = req.body || {};
    const rows = ensureServiceCatalog();
    const requestedId = String(body.id || '').trim();
    const existingIdx = requestedId ? rows.findIndex((item) => String(item?.id || '').trim() === requestedId) : -1;
    const existing = existingIdx >= 0 ? rows[existingIdx] : null;
    const record = sanitizeServiceRecord(
      {
        ...body,
        publishedBy: req.authRole || 'admin'
      },
      existing
    );
    if (existingIdx >= 0) rows[existingIdx] = record;
    else rows.unshift(record);
    writePublishedServices(rows);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      service: record,
      mode: existing ? 'updated' : 'created'
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'invalid_service',
      reason: error?.message || 'invalid service payload'
    });
  }
});

app.post('/api/services/:serviceId/invoke', requireRole('agent'), async (req, res) => {
  const serviceId = String(req.params.serviceId || '').trim();
  if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
  const service = ensureServiceCatalog().find((item) => String(item?.id || '').trim() === serviceId);
  if (!service) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
  if (service.active === false) {
    return res.status(409).json({ ok: false, error: 'service_inactive', reason: 'Service is not active.' });
  }
  const action = String(service.action || '').trim().toLowerCase();
  if (!['btc-price-feed', 'risk-score-feed', 'x-reader-feed'].includes(action)) {
    return res.status(400).json({
      ok: false,
      error: 'unsupported_service_action',
      reason: 'Supported action: btc-price-feed, risk-score-feed, x-reader-feed.'
    });
  }

  const runtime = readSessionRuntime();
  const body = req.body || {};
  const traceId = resolveWorkflowTraceId(body.traceId || createTraceId('service'));
  const payer = normalizeAddress(body.payer || runtime.aaWallet || '');
  const sourceAgentId = String(body.sourceAgentId || KITE_AGENT1_ID).trim();
  const targetAgentId = String(body.targetAgentId || service.providerAgentId || KITE_AGENT2_ID).trim();
  const invocationId = createTraceId('svc_call');
  const now = new Date().toISOString();
  const serviceInvocations = readServiceInvocations().filter((item) => String(item?.serviceId || '').trim() === serviceId);
  const guard = evaluateServiceInvokeGuard(service, {
    payer,
    nowMs: Date.now(),
    invocations: serviceInvocations
  });
  if (!guard.ok) {
    return res.status(403).json({
      ok: false,
      error: guard.code || 'service_guard_blocked',
      reason: guard.reason || 'service guard blocked invoke',
      checks: guard.checks || []
    });
  }

  const invocation = {
    invocationId,
    serviceId,
    action,
    traceId,
    requestId: '',
    state: 'running',
    payer,
    sourceAgentId,
    targetAgentId,
    amount: String(service.price || X402_BTC_PRICE || ''),
    tokenAddress: String(service.tokenAddress || SETTLEMENT_TOKEN || '').trim(),
    recipient: String(service.recipient || KITE_AGENT2_AA_ADDRESS || '').trim(),
    summary: '',
    error: '',
    txHash: '',
    userOpHash: '',
    createdAt: now,
    updatedAt: now
  };
  upsertServiceInvocation(invocation);

  try {
    const internalApiKey = getInternalAgentApiKey();
    const headers = { 'Content-Type': 'application/json' };
    if (internalApiKey) headers['x-api-key'] = internalApiKey;
    const invokePayload =
      action === 'risk-score-feed'
        ? {
            traceId,
            sourceAgentId,
            targetAgentId,
            symbol: service.pair || 'BTCUSDT',
            horizonMin: Number(service.horizonMin || 60),
            source: service.source || 'hyperliquid',
            payer
          }
        : action === 'x-reader-feed'
          ? {
              traceId,
              sourceAgentId,
              targetAgentId,
              url: service.resourceUrl || service.exampleInput?.url || body.url || '',
              mode: service.source || service.mode || 'auto',
              maxChars: Number(service.maxChars || service.exampleInput?.maxChars || X_READER_MAX_CHARS_DEFAULT),
              payer
            }
        : {
            traceId,
            sourceAgentId,
            targetAgentId,
            pair: service.pair || 'BTCUSDT',
            source: service.source || 'hyperliquid',
            payer
          };
    const workflowPath =
      action === 'risk-score-feed'
        ? '/api/workflow/risk-score/run'
        : action === 'x-reader-feed'
          ? '/api/workflow/x-reader/run'
          : '/api/workflow/btc-price/run';

    const resp = await fetch(`http://127.0.0.1:${PORT}${workflowPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(invokePayload)
    });
    const payload = await resp.json().catch(() => ({}));
    const workflow = payload?.workflow || null;
    const next = {
      ...invocation,
      traceId: String(payload?.traceId || traceId).trim(),
      requestId: String(payload?.requestId || workflow?.requestId || '').trim(),
      state: String(payload?.state || workflow?.state || (resp.ok ? 'success' : 'failed')).trim().toLowerCase(),
      summary: String(workflow?.result?.summary || payload?.receipt?.result?.summary || '').trim(),
      error: String(payload?.reason || payload?.error || '').trim(),
      txHash: String(payload?.txHash || workflow?.txHash || '').trim(),
      userOpHash: String(payload?.userOpHash || workflow?.userOpHash || '').trim(),
      updatedAt: new Date().toISOString()
    };
    upsertServiceInvocation(next);

    return res.status(resp.status).json({
      ...payload,
      serviceId,
      invocationId
    });
  } catch (error) {
    const failed = {
      ...invocation,
      state: 'failed',
      error: String(error?.message || 'service invoke failed').trim(),
      updatedAt: new Date().toISOString()
    };
    upsertServiceInvocation(failed);
    return res.status(500).json({
      ok: false,
      error: 'invoke_failed',
      reason: failed.error,
      serviceId,
      invocationId,
      traceId
    });
  }
});

app.get('/api/services/:serviceId/status', requireRole('viewer'), (req, res) => {
  const serviceId = String(req.params.serviceId || '').trim();
  if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
  const service = ensureServiceCatalog().find((item) => String(item?.id || '').trim() === serviceId);
  if (!service) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });

  const workflows = readWorkflows();
  const workflowByTraceId = new Map(workflows.map((item) => [String(item?.traceId || '').trim(), item]));
  const requests = readX402Requests();
  const requestById = new Map(requests.map((item) => [String(item?.requestId || '').trim(), item]));
  const invocations = readServiceInvocations().filter((item) => String(item?.serviceId || '').trim() === serviceId);
  const receipts = invocations.map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));
  const status = buildServiceStatus(service, invocations, receipts);
  const reputation = computeServiceReputation(service, receipts);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    service,
    status,
    reputation
  });
});

app.get('/api/reputation/agents', requireRole('viewer'), (req, res) => {
  const services = ensureServiceCatalog();
  const workflows = readWorkflows();
  const workflowByTraceId = new Map(workflows.map((item) => [String(item?.traceId || '').trim(), item]));
  const requests = readX402Requests();
  const requestById = new Map(requests.map((item) => [String(item?.requestId || '').trim(), item]));
  const invocations = readServiceInvocations();

  const rows = services.map((service) => {
    const perServiceInv = invocations.filter((item) => String(item?.serviceId || '').trim() === String(service.id || '').trim());
    const receipts = perServiceInv.map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));
    const reputation = computeServiceReputation(service, receipts);
    return {
      agentId: String(service.providerAgentId || '').trim() || 'unknown',
      serviceId: String(service.id || '').trim(),
      action: String(service.action || '').trim(),
      reputation
    };
  });

  return res.json({
    ok: true,
    traceId: req.traceId || '',
    total: rows.length,
    items: rows
  });
});

app.post('/api/services/:serviceId/revoke', requireRole('admin'), (req, res) => {
  const serviceId = String(req.params.serviceId || '').trim();
  if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
  const rows = ensureServiceCatalog();
  const idx = rows.findIndex((item) => String(item?.id || '').trim() === serviceId);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
  rows[idx] = {
    ...rows[idx],
    active: false,
    updatedAt: new Date().toISOString()
  };
  writePublishedServices(rows);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    service: rows[idx]
  });
});

app.post('/api/services/:serviceId/unrevoke', requireRole('admin'), (req, res) => {
  const serviceId = String(req.params.serviceId || '').trim();
  if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
  const rows = ensureServiceCatalog();
  const idx = rows.findIndex((item) => String(item?.id || '').trim() === serviceId);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });
  rows[idx] = {
    ...rows[idx],
    active: true,
    updatedAt: new Date().toISOString()
  };
  writePublishedServices(rows);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    service: rows[idx]
  });
});

app.get('/api/services/:serviceId/receipts', requireRole('viewer'), (req, res) => {
  const serviceId = String(req.params.serviceId || '').trim();
  if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
  const service = ensureServiceCatalog().find((item) => String(item?.id || '').trim() === serviceId);
  if (!service) return res.status(404).json({ ok: false, error: 'service_not_found', serviceId });

  const limit = Math.max(1, Math.min(Number(req.query.limit || 40), 200));
  const workflows = readWorkflows();
  const workflowByTraceId = new Map(
    workflows.map((item) => [String(item?.traceId || '').trim(), item])
  );
  const requests = readX402Requests();
  const requestById = new Map(
    requests.map((item) => [String(item?.requestId || '').trim(), item])
  );

  const rows = readServiceInvocations()
    .filter((item) => String(item?.serviceId || '').trim() === serviceId)
    .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
    .slice(0, limit)
    .map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));

  return res.json({
    ok: true,
    traceId: req.traceId || '',
    service,
    total: rows.length,
    items: rows
  });
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

    const maxAttempts = Math.max(1, Math.min(Number(process.env.KITE_SESSION_PAY_RETRIES || 2), 3));
    let result = null;
    let attempts = 0;
    for (let i = 0; i < maxAttempts; i += 1) {
      attempts = i + 1;
      result = await sdk.sendSessionTransferWithAuthorizationAndProvider(
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
      if (result?.status === 'success' && result?.transactionHash) break;
      const reason = String(result?.reason || '').trim();
      const retriable = isTransientTransportError(reason);
      if (!retriable || i >= maxAttempts - 1) break;
      await waitMs(600 * (i + 1));
    }

    if (!result || result.status !== 'success' || !result.transactionHash) {
      return res.status(500).json({
        ok: false,
        error: 'aa_session_payment_failed',
        reason: result?.reason || 'unknown',
        details: {
          userOpHash: result?.userOpHash || '',
          sessionId,
          payer: runtime.aaWallet,
          attempts
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
  ensureServiceCatalog();
  ensureNetworkAgents();
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
  if (XMTP_ROUTER_RUNTIME_ENABLED || XMTP_RISK_RUNTIME_ENABLED) {
    const status = await startXmtpRuntimes();
    if (status?.router?.running) {
      console.log(
        `[xmtp/router] env=${status.router.env} address=${status.router.address || '-'} inbox=${status.router.inboxId || '-'}`
      );
      if (XMTP_AUTO_NETWORK_ENABLED) {
        startAutoXmtpNetworkLoop({
          intervalMs: XMTP_AUTO_NETWORK_INTERVAL_MS,
          sourceAgentId: XMTP_AUTO_NETWORK_SOURCE_AGENT_ID,
          targetAgentIds: XMTP_AUTO_NETWORK_TARGET_AGENT_IDS,
          capability: XMTP_AUTO_NETWORK_CAPABILITY,
          immediate: true,
          reason: 'startup'
        });
        console.log(
          `[auto-xmtp] enabled intervalMs=${XMTP_AUTO_NETWORK_INTERVAL_MS} source=${XMTP_AUTO_NETWORK_SOURCE_AGENT_ID} targets=${parseAgentIdList(XMTP_AUTO_NETWORK_TARGET_AGENT_IDS).join(',')}`
        );
      }
    } else {
      console.warn(`[xmtp/router] failed to start: ${status?.router?.lastError || 'unknown_error'}`);
    }
    if (status?.risk?.enabled) {
      if (status?.risk?.running) {
        console.log(
          `[xmtp/risk] env=${status.risk.env} address=${status.risk.address || '-'} inbox=${status.risk.inboxId || '-'}`
        );
      } else {
        console.warn(`[xmtp/risk] failed to start: ${status?.risk?.lastError || 'unknown_error'}`);
      }
    }
  }
}

async function shutdownServer() {
  stopAutoBtcPriceLoop();
  stopAutoXmtpNetworkLoop();
  await stopXmtpRuntimes();
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
