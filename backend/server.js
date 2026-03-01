import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { GokiteAASDK } from './lib/gokite-aa-sdk.js';
import { createOpenClawAdapter } from './services/openclawAdapter.js';
import { createHyperliquidAdapter } from './services/hyperliquidAdapter.js';
import { createPersistenceStore } from './services/persistenceStore.js';
import { createMessageProviderAnalysisService } from './services/messageProviderAnalysisService.js';
import { createX402ReceiptService } from './services/x402ReceiptService.js';
import { createXmtpAgentRuntime } from './services/xmtpAgentRuntime.js';
import { createAgent001ExecutionService } from './services/agent001ExecutionService.js';
import { createAgent001PlanningService } from './services/agent001PlanningService.js';
import { createAgent001Orchestrator } from './services/agent001Orchestrator.js';
import {
  classifyAgent001IntentFallback,
  detectAgent001IntentOverrides,
  extractFirstUrlFromText,
  extractHorizonFromText,
  extractTradingSymbolFromText,
  isAgent001ForceOrderRequested,
  parseAgent001OrderDirectives,
  resolveAgent001Intent
} from './services/agent001Intent.js';

function resolveSharedTokenFromMarkdown(repoRoot = '') {
  const normalizedRoot = String(repoRoot || '').trim();
  if (!normalizedRoot) return '';
  const explicitCandidates = [
    path.resolve(normalizedRoot, '重要信息.md'),
    path.resolve(normalizedRoot, 'IMPORTANT.md'),
    path.resolve(normalizedRoot, 'IMPORTANT_INFO.md')
  ];
  const visited = new Set();
  for (const targetPath of explicitCandidates) {
    const normalizedPath = path.normalize(targetPath);
    if (visited.has(normalizedPath)) continue;
    visited.add(normalizedPath);
    try {
      if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isFile()) continue;
      const lines = fs.readFileSync(normalizedPath, 'utf8').split(/\r?\n/);
      const matchedLines = lines
        .map((line) => String(line || '').trim())
        .filter((line) => /^OPENNEWS_TOKEN\/TWITTER_TOKEN\s*=/.test(line));
      const matched = matchedLines.length > 0 ? matchedLines[matchedLines.length - 1] : '';
      if (!matched) continue;
      const token = String(matched.split('=', 2)[1] || '').trim();
      if (token) return token;
    } catch {
      // ignore token file read failure
    }
  }
  try {
    const mdFiles = fs
      .readdirSync(normalizedRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => path.resolve(normalizedRoot, entry.name));
    for (const mdPath of mdFiles) {
      const normalizedPath = path.normalize(mdPath);
      if (visited.has(normalizedPath)) continue;
      visited.add(normalizedPath);
      try {
        const lines = fs.readFileSync(normalizedPath, 'utf8').split(/\r?\n/);
        const matchedLines = lines
          .map((line) => String(line || '').trim())
          .filter((line) => /^OPENNEWS_TOKEN\/TWITTER_TOKEN\s*=/.test(line));
        const matched = matchedLines.length > 0 ? matchedLines[matchedLines.length - 1] : '';
        if (!matched) continue;
        const token = String(matched.split('=', 2)[1] || '').trim();
        if (token) return token;
      } catch {
        // ignore per-file read failures
      }
    }
  } catch {
    // ignore root read failures
  }
  return '';
}

function hydrateMessageProviderTokenFromLocalDocs() {
  const hasOpenNewsToken = Boolean(String(process.env.OPENNEWS_TOKEN || '').trim());
  const hasTwitterToken = Boolean(String(process.env.TWITTER_TOKEN || '').trim());
  const hasSharedToken = Boolean(String(process.env.KITE_MESSAGE_PROVIDER_TOKEN || '').trim());
  if (hasOpenNewsToken || hasTwitterToken || hasSharedToken) return;
  const repoRoot = path.resolve(process.cwd(), '..');
  const token = resolveSharedTokenFromMarkdown(repoRoot);
  if (!token) return;
  process.env.OPENNEWS_TOKEN = token;
  process.env.TWITTER_TOKEN = token;
}

hydrateMessageProviderTokenFromLocalDocs();

function toBoundedIntEnv(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(min, Math.min(rounded, max));
}

const app = express();
const PORT = String(process.env.PORT || 3001).trim() || '3001';
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
const xmtpGroupsPath = path.resolve('data', 'xmtp_groups.json');
const networkCommandsPath = path.resolve('data', 'network_commands.json');
const agent001ResultsPath = path.resolve('data', 'agent001_results.json');

const SETTLEMENT_TOKEN =
  process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const MERCHANT_ADDRESS =
  process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const X402_UNIFIED_SERVICE_PRICE = String(process.env.X402_UNIFIED_SERVICE_PRICE || '0.00015').trim() || '0.00015';
const X402_PRICE = process.env.X402_PRICE || X402_UNIFIED_SERVICE_PRICE;
const KITE_AGENT2_AA_ADDRESS =
  process.env.KITE_AGENT2_AA_ADDRESS || '0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8';
const X402_REACTIVE_PRICE = process.env.X402_REACTIVE_PRICE || X402_UNIFIED_SERVICE_PRICE;
const X402_BTC_PRICE = process.env.X402_BTC_PRICE || X402_UNIFIED_SERVICE_PRICE;
const X402_RISK_SCORE_PRICE = process.env.X402_RISK_SCORE_PRICE || X402_UNIFIED_SERVICE_PRICE;
const X402_X_READER_PRICE = process.env.X402_X_READER_PRICE || X402_UNIFIED_SERVICE_PRICE;
const X402_TECHNICAL_PRICE = process.env.X402_TECHNICAL_PRICE || X402_RISK_SCORE_PRICE;
const X402_INFO_PRICE = process.env.X402_INFO_PRICE || X402_X_READER_PRICE;
const X402_HYPERLIQUID_ORDER_PRICE = process.env.X402_HYPERLIQUID_ORDER_PRICE || X402_UNIFIED_SERVICE_PRICE;
const HYPERLIQUID_ORDER_RECIPIENT = normalizeAddress(
  String(process.env.X402_HYPERLIQUID_ORDER_RECIPIENT || process.env.HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS).trim()
);
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
const AA_V2_VERSION_TAG = String(
  process.env.KITE_AA_REQUIRED_VERSION || 'GokiteAccountV2-session-userop'
).trim();
const KITE_REQUIRE_AA_V2 = !/^(0|false|no|off)$/i.test(
  String(process.env.KITE_REQUIRE_AA_V2 || '1').trim()
);
const KITE_ALLOW_EOA_RELAY_FALLBACK = /^(1|true|yes|on)$/i.test(
  String(process.env.KITE_ALLOW_EOA_RELAY_FALLBACK || '0').trim()
);
const KITE_ALLOW_BACKEND_USEROP_SIGN = /^(1|true|yes|on)$/i.test(
  String(process.env.KITE_ALLOW_BACKEND_USEROP_SIGN || '0').trim()
);
const KITE_BUNDLER_RPC_TIMEOUT_MS = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_TIMEOUT_MS, 15_000, 2_000, 180_000);
const KITE_BUNDLER_RPC_RETRIES = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_RETRIES, 3, 1, 8);
const KITE_BUNDLER_RPC_BACKOFF_BASE_MS = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_BACKOFF_BASE_MS, 650, 100, 10_000);
const KITE_BUNDLER_RPC_BACKOFF_MAX_MS = toBoundedIntEnv(process.env.KITE_BUNDLER_RPC_BACKOFF_MAX_MS, 6_000, 200, 30_000);
const KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS = toBoundedIntEnv(
  process.env.KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
  3_000,
  800,
  15_000
);
const KITE_SESSION_PAY_RETRIES = toBoundedIntEnv(process.env.KITE_SESSION_PAY_RETRIES, 3, 1, 8);
const KITE_SESSION_PAY_METRICS_RECENT_LIMIT = toBoundedIntEnv(
  process.env.KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
  80,
  10,
  500
);
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
const HYPERLIQUID_TESTNET_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.HYPERLIQUID_TESTNET_ENABLED || '0').trim()
);
const HYPERLIQUID_TESTNET_PRIVATE_KEY = normalizePrivateKey(
  String(process.env.HYPERLIQUID_TESTNET_PRIVATE_KEY || '').trim()
);
const HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS = normalizeAddress(
  String(process.env.HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS || '').trim()
);
const HYPERLIQUID_TESTNET_API_URL = String(process.env.HYPERLIQUID_TESTNET_API_URL || '').trim();
const HYPERLIQUID_TESTNET_TIMEOUT_MS = Math.max(
  3000,
  Math.min(Number(process.env.HYPERLIQUID_TESTNET_TIMEOUT_MS || 12_000), 120_000)
);
const HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS = Math.max(
  1,
  Math.min(Number(process.env.HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS || 30), 1000)
);
const ANALYSIS_PROVIDER = 'market-data';
const OPENNEWS_API_BASE = String(process.env.OPENNEWS_API_BASE || 'https://ai.6551.io').trim().replace(/\/+$/, '');
const OPENNEWS_TOKEN = String(process.env.OPENNEWS_TOKEN || process.env.KITE_MESSAGE_PROVIDER_TOKEN || '').trim();
const OPENNEWS_TIMEOUT_MS = Math.max(2500, Math.min(Number(process.env.OPENNEWS_TIMEOUT_MS || 8000), 120000));
const OPENNEWS_RETRY = Math.max(0, Math.min(Number(process.env.OPENNEWS_RETRY || 1), 3));
const OPENNEWS_MAX_ROWS = Math.max(1, Math.min(Number(process.env.OPENNEWS_MAX_ROWS || 8), 50));
const OPENTWITTER_API_BASE = String(process.env.TWITTER_API_BASE || 'https://ai.6551.io')
  .trim()
  .replace(/\/+$/, '');
const OPENTWITTER_TOKEN = String(
  process.env.TWITTER_TOKEN || process.env.OPENNEWS_TOKEN || process.env.KITE_MESSAGE_PROVIDER_TOKEN || ''
).trim();
const OPENTWITTER_TIMEOUT_MS = Math.max(2500, Math.min(Number(process.env.TWITTER_TIMEOUT_MS || 8000), 120000));
const OPENTWITTER_RETRY = Math.max(0, Math.min(Number(process.env.TWITTER_RETRY || 1), 3));
const OPENTWITTER_MAX_ROWS = Math.max(1, Math.min(Number(process.env.TWITTER_MAX_ROWS || 8), 50));
const MESSAGE_PROVIDER_DEFAULT_KEYWORDS = String(process.env.MESSAGE_PROVIDER_DEFAULT_KEYWORDS || 'BTC,AI,美股,ETH')
  .split(',')
  .map((item) => String(item || '').trim())
  .filter(Boolean)
  .slice(0, 24);
const MESSAGE_PROVIDER_DISABLE_CLAWFEED = !/^(0|false|no|off)$/i.test(
  String(process.env.MESSAGE_PROVIDER_DISABLE_CLAWFEED || '1').trim()
);
const MESSAGE_PROVIDER_MARKET_DATA_FALLBACK = !/^(0|false|no|off)$/i.test(
  String(process.env.MESSAGE_PROVIDER_MARKET_DATA_FALLBACK || '0').trim()
);
const ERC8004_IDENTITY_REGISTRY = process.env.ERC8004_IDENTITY_REGISTRY || '';
const ERC8004_AGENT_ID_RAW = process.env.ERC8004_AGENT_ID || '';
const ERC8004_AGENT_ID = Number.isFinite(Number(ERC8004_AGENT_ID_RAW))
  ? Number(ERC8004_AGENT_ID_RAW)
  : null;
const API_KEY_ADMIN = String(process.env.KITECLAW_API_KEY_ADMIN || '').trim();
const API_KEY_AGENT = String(process.env.KITECLAW_API_KEY_AGENT || '').trim();
const API_KEY_VIEWER = String(process.env.KITECLAW_API_KEY_VIEWER || '').trim();
const AUTH_DISABLED = /^(1|true|yes|on)$/i.test(String(process.env.KITECLAW_AUTH_DISABLED || '').trim());
const RATE_LIMIT_WINDOW_MS = Number(process.env.KITECLAW_RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.KITECLAW_RATE_LIMIT_MAX || 240);
const IDENTITY_CHALLENGE_TTL_MS = Number(process.env.IDENTITY_CHALLENGE_TTL_MS || 120_000);
const IDENTITY_CHALLENGE_MAX_ROWS = Number(process.env.IDENTITY_CHALLENGE_MAX_ROWS || 500);
const IDENTITY_VERIFY_MODE = String(process.env.IDENTITY_VERIFY_MODE || 'signature').trim().toLowerCase();
const AUTO_TRADE_PLAN_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.AUTO_TRADE_PLAN_ENABLED || '').trim());
const AUTO_TRADE_PLAN_INTERVAL_MS = Math.max(60_000, Number(process.env.AUTO_TRADE_PLAN_INTERVAL_MS || 600_000));
const AUTO_TRADE_PLAN_SYMBOL = String(process.env.AUTO_TRADE_PLAN_SYMBOL || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
const AUTO_TRADE_PLAN_HORIZON_MIN = Math.max(5, Math.min(Number(process.env.AUTO_TRADE_PLAN_HORIZON_MIN || 60), 1440));
const AUTO_TRADE_PLAN_PROMPT = String(process.env.AUTO_TRADE_PLAN_PROMPT || '').trim();
const X_READER_MAX_CHARS_DEFAULT = Math.max(200, Math.min(8000, Number(process.env.X_READER_MAX_CHARS_DEFAULT || 1200)));
const XMTP_ROUTER_KEY_AVAILABLE = Boolean(
  String(process.env.XMTP_ROUTER_WALLET_KEY || process.env.XMTP_WALLET_KEY || '').trim()
);
const XMTP_RISK_KEY_AVAILABLE = Boolean(String(process.env.XMTP_RISK_WALLET_KEY || '').trim());
const XMTP_READER_KEY_AVAILABLE = Boolean(String(process.env.XMTP_READER_WALLET_KEY || '').trim());
const XMTP_PRICE_KEY_AVAILABLE = Boolean(String(process.env.XMTP_PRICE_WALLET_KEY || '').trim());
const XMTP_EXECUTOR_KEY_AVAILABLE = Boolean(String(process.env.XMTP_EXECUTOR_WALLET_KEY || '').trim());
const XMTP_ANY_KEY_AVAILABLE =
  XMTP_ROUTER_KEY_AVAILABLE ||
  XMTP_RISK_KEY_AVAILABLE ||
  XMTP_READER_KEY_AVAILABLE ||
  XMTP_PRICE_KEY_AVAILABLE ||
  XMTP_EXECUTOR_KEY_AVAILABLE;
const XMTP_ENABLED_RAW = String(process.env.XMTP_ENABLED || '').trim();
const XMTP_ENABLED = XMTP_ENABLED_RAW
  ? /^(1|true|yes|on)$/i.test(XMTP_ENABLED_RAW)
  : XMTP_ANY_KEY_AVAILABLE;
const XMTP_AUTO_ACK = /^(1|true|yes|on)$/i.test(String(process.env.XMTP_AUTO_ACK || '').trim());
const XMTP_EVENT_RETENTION = Math.max(50, Math.min(Number(process.env.XMTP_EVENT_RETENTION || 600), 5000));
const XMTP_ENV = String(process.env.XMTP_ENV || 'dev').trim().toLowerCase() || 'dev';
const XMTP_API_URL = String(process.env.XMTP_API_URL || '').trim();
const XMTP_HISTORY_SYNC_URL = String(process.env.XMTP_HISTORY_SYNC_URL || '').trim();
const XMTP_GATEWAY_HOST = String(process.env.XMTP_GATEWAY_HOST || '').trim();
const XMTP_DB_ENCRYPTION_KEY = String(process.env.XMTP_DB_ENCRYPTION_KEY || '').trim();
const XMTP_DB_DIRECTORY = String(process.env.XMTP_DB_DIRECTORY || './data/xmtp-db').trim();
const XMTP_WALLET_KEY = String(process.env.XMTP_WALLET_KEY || '').trim();
const XMTP_ROUTER_WALLET_KEY = String(process.env.XMTP_ROUTER_WALLET_KEY || XMTP_WALLET_KEY).trim();
const XMTP_RISK_WALLET_KEY = String(process.env.XMTP_RISK_WALLET_KEY || '').trim();
const XMTP_READER_WALLET_KEY = String(process.env.XMTP_READER_WALLET_KEY || '').trim();
const XMTP_PRICE_WALLET_KEY = String(process.env.XMTP_PRICE_WALLET_KEY || '').trim();
const XMTP_EXECUTOR_WALLET_KEY = String(process.env.XMTP_EXECUTOR_WALLET_KEY || '').trim();
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
  String(process.env.XMTP_ROUTER_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_ROUTER_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_RISK_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_RISK_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_RISK_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_READER_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_READER_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_READER_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_PRICE_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_PRICE_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_PRICE_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_EXECUTOR_RUNTIME_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.XMTP_EXECUTOR_RUNTIME_ENABLED || (XMTP_ENABLED && XMTP_EXECUTOR_KEY_AVAILABLE ? '1' : '0')).trim()
);
const XMTP_ANY_RUNTIME_ENABLED =
  XMTP_ROUTER_RUNTIME_ENABLED ||
  XMTP_RISK_RUNTIME_ENABLED ||
  XMTP_READER_RUNTIME_ENABLED ||
  XMTP_PRICE_RUNTIME_ENABLED ||
  XMTP_EXECUTOR_RUNTIME_ENABLED;
const XMTP_AUTO_NETWORK_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.XMTP_AUTO_NETWORK_ENABLED || '').trim());
const XMTP_AUTO_NETWORK_INTERVAL_MS = Math.max(15_000, Number(process.env.XMTP_AUTO_NETWORK_INTERVAL_MS || 60_000));
const XMTP_AUTO_NETWORK_SOURCE_AGENT_ID = String(process.env.XMTP_AUTO_NETWORK_SOURCE_AGENT_ID || 'router-agent').trim().toLowerCase();
const XMTP_AUTO_NETWORK_TARGET_AGENT_IDS = String(process.env.XMTP_AUTO_NETWORK_TARGET_AGENT_IDS || 'risk-agent,reader-agent').trim();
const XMTP_AUTO_NETWORK_CAPABILITY = String(process.env.XMTP_AUTO_NETWORK_CAPABILITY || 'network-heartbeat').trim();
const XMTP_WORKERS_GROUP_LABEL = String(process.env.XMTP_WORKERS_GROUP_LABEL || 'workers-group').trim();
const XMTP_WORKERS_GROUP_NAME = String(process.env.XMTP_WORKERS_GROUP_NAME || 'Agent001 + Workers').trim();
const XMTP_WORKERS_GROUP_AGENT_IDS = String(
  process.env.XMTP_WORKERS_GROUP_AGENT_IDS || 'risk-agent,reader-agent,price-agent,executor-agent'
).trim();
const AGENT001_REQUIRE_X402 = true;
const AGENT001_PREBIND_ONLY = !/^(0|false|no|off)$/i.test(
  String(process.env.AGENT001_PREBIND_ONLY || '1').trim()
);
const AGENT001_BIND_TIMEOUT_MS = Math.max(
  30_000,
  Math.min(Number(process.env.AGENT001_BIND_TIMEOUT_MS || 210_000), 300_000)
);

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

const hyperliquidAdapter = createHyperliquidAdapter({
  enabled: HYPERLIQUID_TESTNET_ENABLED,
  isTestnet: true,
  privateKey: HYPERLIQUID_TESTNET_PRIVATE_KEY,
  accountAddress: HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS,
  apiUrl: HYPERLIQUID_TESTNET_API_URL,
  timeoutMs: HYPERLIQUID_TESTNET_TIMEOUT_MS,
  defaultMarketSlippageBps: HYPERLIQUID_TESTNET_MARKET_SLIPPAGE_BPS
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
  xmtpEventsPath,
  xmtpGroupsPath,
  networkCommandsPath,
  agent001ResultsPath
];
const PERSIST_OBJECT_PATHS = [policyConfigPath, sessionRuntimePath];
const persistArrayCache = new Map();
const persistObjectCache = new Map();
let persistenceInitDone = false;
let autoXmtpNetworkTimer = null;
let autoXmtpNetworkBusy = false;
let autoTradePlanTimer = null;
let autoTradePlanBusy = false;

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

const autoTradePlanState = {
  enabled: false,
  intervalMs: AUTO_TRADE_PLAN_INTERVAL_MS,
  symbol: AUTO_TRADE_PLAN_SYMBOL,
  horizonMin: AUTO_TRADE_PLAN_HORIZON_MIN,
  prompt: AUTO_TRADE_PLAN_PROMPT,
  startedAt: '',
  lastTickAt: '',
  lastStatus: '',
  lastDecision: '',
  lastSummary: '',
  lastRequestId: '',
  lastTxHash: '',
  lastError: '',
  runs: 0,
  orderRuns: 0,
  noOrderRuns: 0,
  failedRuns: 0
};

const ROUTER_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_ROUTER_WALLET_KEY);
const RISK_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_RISK_WALLET_KEY);
const READER_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_READER_WALLET_KEY);
const PRICE_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_PRICE_WALLET_KEY);
const EXECUTOR_WALLET_KEY_NORMALIZED = normalizePrivateKey(XMTP_EXECUTOR_WALLET_KEY);
const XMTP_ROUTER_DERIVED_ADDRESS = deriveAddressFromPrivateKey(ROUTER_WALLET_KEY_NORMALIZED);
const XMTP_RISK_DERIVED_ADDRESS = deriveAddressFromPrivateKey(RISK_WALLET_KEY_NORMALIZED);
const XMTP_READER_DERIVED_ADDRESS = deriveAddressFromPrivateKey(READER_WALLET_KEY_NORMALIZED);
const XMTP_PRICE_DERIVED_ADDRESS = deriveAddressFromPrivateKey(PRICE_WALLET_KEY_NORMALIZED);
const XMTP_EXECUTOR_DERIVED_ADDRESS = deriveAddressFromPrivateKey(EXECUTOR_WALLET_KEY_NORMALIZED);
const XMTP_ROUTER_RESOLVED_ADDRESS = normalizeAddress(XMTP_ROUTER_AGENT_ADDRESS || XMTP_ROUTER_DERIVED_ADDRESS || '');
const XMTP_RISK_RESOLVED_ADDRESS = normalizeAddress(XMTP_RISK_AGENT_ADDRESS || XMTP_RISK_DERIVED_ADDRESS || '');
const XMTP_READER_RESOLVED_ADDRESS = normalizeAddress(XMTP_READER_AGENT_ADDRESS || XMTP_READER_DERIVED_ADDRESS || '');
const XMTP_PRICE_RESOLVED_ADDRESS = normalizeAddress(XMTP_PRICE_AGENT_ADDRESS || XMTP_PRICE_DERIVED_ADDRESS || '');
const XMTP_EXECUTOR_RESOLVED_ADDRESS = normalizeAddress(
  XMTP_EXECUTOR_AGENT_ADDRESS || XMTP_EXECUTOR_DERIVED_ADDRESS || ''
);
const XMTP_ROUTER_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'router-agent');
const XMTP_RISK_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'risk-agent');
const XMTP_READER_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'reader-agent');
const XMTP_PRICE_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'price-agent');
const XMTP_EXECUTOR_DB_DIRECTORY = path.resolve(XMTP_DB_DIRECTORY, 'executor-agent');

function authConfigured() {
  if (AUTH_DISABLED) return false;
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

function buildSessionPayCategoryCounters() {
  return {
    transport: 0,
    replacement_fee: 0,
    session_validation: 0,
    funding: 0,
    policy: 0,
    aa_version: 0,
    config: 0,
    unknown: 0
  };
}

const sessionPayMetrics = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalSuccess: 0,
  totalFailed: 0,
  totalRetryAttempts: 0,
  totalRetriesUsed: 0,
  totalFallbackAttempted: 0,
  totalFallbackSucceeded: 0,
  failuresByCategory: buildSessionPayCategoryCounters(),
  retriesByCategory: buildSessionPayCategoryCounters(),
  recentFailures: []
};

function shouldRetrySessionPayReason(reason = '') {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes('timeout') ||
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('und_err_socket') ||
    text.includes('und_err_connect_timeout') ||
    text.includes('socket hang up') ||
    text.includes('network') ||
    text.includes('tls') ||
    text.includes('secure connection') ||
    text.includes('client network socket disconnected') ||
    text.includes('bad gateway') ||
    text.includes('gateway timeout') ||
    text.includes('service unavailable') ||
    text.includes('http 502') ||
    text.includes('http 503') ||
    text.includes('http 504')
  );
}

function classifySessionPayFailure({ reason = '', errorCode = '' } = {}) {
  const code = String(errorCode || '').trim().toLowerCase();
  const text = String(reason || '').trim().toLowerCase();
  if (code === 'aa_version_mismatch' || text.includes('aa must be upgraded to v2')) return 'aa_version';
  if (
    [
      'session_not_configured',
      'invalid_session_id',
      'session_not_found',
      'session_agent_mismatch',
      'session_rule_failed'
    ].includes(code)
  ) {
    return 'session_validation';
  }
  if (['insufficient_funds', 'insufficient_kite_gas'].includes(code)) return 'funding';
  if (
    [
      'unsupported_settlement_token',
      'invalid_token_contract',
      'invalid_tokenaddress',
      'invalid_recipient',
      'invalid_amount',
      'aa_wallet_not_deployed_or_incompatible'
    ].includes(code)
  ) {
    return 'config';
  }
  if (
    code.includes('backend_signer') ||
    text.includes('eoa_relay_disabled') ||
    text.includes('backend userop signing is disabled')
  ) {
    return 'policy';
  }
  if (
    text.includes('replacement fee too low') ||
    text.includes('replacement underpriced') ||
    text.includes('cannot be replaced') ||
    text.includes('replacement transaction underpriced')
  ) {
    return 'replacement_fee';
  }
  if (shouldRetrySessionPayReason(text)) return 'transport';
  return 'unknown';
}

function pushRecentSessionPayFailure(entry = {}) {
  sessionPayMetrics.recentFailures.unshift(entry);
  if (sessionPayMetrics.recentFailures.length > KITE_SESSION_PAY_METRICS_RECENT_LIMIT) {
    sessionPayMetrics.recentFailures = sessionPayMetrics.recentFailures.slice(0, KITE_SESSION_PAY_METRICS_RECENT_LIMIT);
  }
}

function markSessionPayFailure({ errorCode = '', reason = '', traceId = '', requestId = '', attempts = 0 } = {}) {
  sessionPayMetrics.totalFailed += 1;
  const category = classifySessionPayFailure({ errorCode, reason });
  if (sessionPayMetrics.failuresByCategory[category] === undefined) {
    sessionPayMetrics.failuresByCategory[category] = 0;
  }
  sessionPayMetrics.failuresByCategory[category] += 1;
  pushRecentSessionPayFailure({
    time: new Date().toISOString(),
    category,
    errorCode: String(errorCode || '').trim(),
    reason: String(reason || '').trim(),
    traceId: String(traceId || '').trim(),
    requestId: String(requestId || '').trim(),
    attempts: Number.isFinite(Number(attempts)) ? Number(attempts) : 0
  });
  return category;
}

function markSessionPayRetry({ reason = '', errorCode = '' } = {}) {
  sessionPayMetrics.totalRetryAttempts += 1;
  const category = classifySessionPayFailure({ reason, errorCode });
  if (sessionPayMetrics.retriesByCategory[category] === undefined) {
    sessionPayMetrics.retriesByCategory[category] = 0;
  }
  sessionPayMetrics.retriesByCategory[category] += 1;
  return category;
}

function sessionPayConfigSnapshot() {
  return {
    sessionPayRetries: KITE_SESSION_PAY_RETRIES,
    bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
    bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
    bundlerRpcBackoffBaseMs: KITE_BUNDLER_RPC_BACKOFF_BASE_MS,
    bundlerRpcBackoffMaxMs: KITE_BUNDLER_RPC_BACKOFF_MAX_MS,
    bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    recentFailureLimit: KITE_SESSION_PAY_METRICS_RECENT_LIMIT,
    eoaRelayFallbackEnabled: KITE_ALLOW_EOA_RELAY_FALLBACK,
    backendUserOpSignEnabled: KITE_ALLOW_BACKEND_USEROP_SIGN
  };
}

async function postSessionPayWithRetry(payload = {}, options = {}) {
  const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts || KITE_SESSION_PAY_RETRIES), 8));
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
      err.reasonCategory = classifySessionPayFailure({ reason, errorCode: String(body?.error || '').trim() });
      lastError = err;
      if (!err.retryable || i >= maxAttempts - 1) throw err;
      markSessionPayRetry({ reason, errorCode: String(body?.error || '').trim() });
      continue;
    } catch (error) {
      const reason = String(error?.message || '').trim();
      const retryable = shouldRetrySessionPayReason(reason) || error?.name === 'AbortError';
      const wrapped = error instanceof Error ? error : new Error(reason || 'session pay failed');
      wrapped.attempts = attempt;
      wrapped.retryable = retryable;
      wrapped.reasonCategory = classifySessionPayFailure({ reason });
      lastError = wrapped;
      if (!retryable || i >= maxAttempts - 1) throw wrapped;
      markSessionPayRetry({ reason });
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('session pay failed');
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

function getAutoTradePlanStatus() {
  return {
    ...autoTradePlanState,
    running: Boolean(autoTradePlanTimer),
    busy: autoTradePlanBusy
  };
}

function buildAutoTradePlanPrompt() {
  const customPrompt = String(autoTradePlanState.prompt || '').trim();
  if (customPrompt) return customPrompt;
  const symbol = String(autoTradePlanState.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const horizonMin = Math.max(5, Math.min(Number(autoTradePlanState.horizonMin || 60), 1440));
  return `请基于技术面和消息面给出 ${symbol} ${horizonMin}m 交易计划，并按规则判定是否下单；不要强制下单。`;
}

function extractAutoTradePlanPaymentEvidence(replyText = '') {
  const lines = String(replyText || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  for (const line of lines) {
    const directMatch = line.match(/^x402 requestId:\s*([^\s]+)\s*$/i);
    if (!directMatch) continue;
    const idx = lines.indexOf(line);
    const nextLine = idx >= 0 ? String(lines[idx + 1] || '').trim() : '';
    const txMatch = nextLine.match(/^x402 txHash:\s*([^\s]+)\s*$/i);
    return {
      requestId: String(directMatch[1] || '').trim(),
      txHash: txMatch ? String(txMatch[1] || '').trim() : ''
    };
  }
  const inlineMatch = String(replyText || '').match(/x402:\s*requestId=([^\s]+)\s+txHash=([^\s]+)/i);
  if (inlineMatch) {
    return {
      requestId: String(inlineMatch[1] || '').trim(),
      txHash: String(inlineMatch[2] || '').trim()
    };
  }
  return { requestId: '', txHash: '' };
}

function classifyAutoTradePlanOutcome(replyText = '') {
  const text = String(replyText || '').trim();
  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  const decisionLine =
    lines.find((line) => /^决策:\s*/i.test(line)) ||
    lines.find((line) => /^执行结果:\s*/i.test(line)) ||
    lines[0] ||
    '';

  if (/下单执行失败|交易链路中断|交易执行前置条件不足|交易计划生成失败|执行阻断/i.test(text)) {
    return {
      status: 'failed',
      decision: 'failed',
      summary: decisionLine || '交易计划执行失败。',
      reason: decisionLine || 'trade_plan_execution_failed'
    };
  }
  if (/下单执行:\s*已触发 Hyperliquid 测试网下单/i.test(text)) {
    return {
      status: 'ordered',
      decision: 'ordered',
      summary: decisionLine || '触发下单。',
      reason: ''
    };
  }
  if (/执行结果:\s*不满足自动下单条件，本轮不下单|决策:\s*不挂单/i.test(text)) {
    return {
      status: 'no-order',
      decision: 'no-order',
      summary: decisionLine || '本轮不下单。',
      reason: ''
    };
  }
  return {
    status: 'success',
    decision: 'unknown',
    summary: decisionLine || '交易计划已执行。',
    reason: ''
  };
}

async function runAutoTradePlanTick(reason = 'timer') {
  if (autoTradePlanBusy) return;
  autoTradePlanBusy = true;
  autoTradePlanState.lastTickAt = new Date().toISOString();
  autoTradePlanState.lastStatus = 'running';
  autoTradePlanState.lastError = '';

  let countedRun = false;
  try {
    const reply = await handleRouterRuntimeTextMessage({
      text: buildAutoTradePlanPrompt(),
      context: null
    });
    const replyText = String(reply || '').trim();
    if (!replyText) {
      throw new Error('auto_trade_plan_empty_reply');
    }
    autoTradePlanState.runs += 1;
    countedRun = true;

    const outcome = classifyAutoTradePlanOutcome(replyText);
    const payment = extractAutoTradePlanPaymentEvidence(replyText);
    autoTradePlanState.lastDecision = String(outcome.decision || '').trim();
    autoTradePlanState.lastSummary = String(outcome.summary || '').trim();
    autoTradePlanState.lastRequestId = String(payment.requestId || '').trim();
    autoTradePlanState.lastTxHash = String(payment.txHash || '').trim();
    autoTradePlanState.lastStatus = String(outcome.status || 'success').trim();
    autoTradePlanState.lastError = String(outcome.reason || '').trim();

    if (outcome.status === 'ordered') {
      autoTradePlanState.orderRuns += 1;
    } else if (outcome.status === 'no-order') {
      autoTradePlanState.noOrderRuns += 1;
    } else if (outcome.status === 'failed') {
      autoTradePlanState.failedRuns += 1;
    }
  } catch (error) {
    if (!countedRun) autoTradePlanState.runs += 1;
    autoTradePlanState.failedRuns += 1;
    autoTradePlanState.lastStatus = 'failed';
    autoTradePlanState.lastDecision = 'failed';
    autoTradePlanState.lastError = String(error?.message || 'auto_trade_plan_failed').trim();
    autoTradePlanState.lastSummary = '';
    autoTradePlanState.lastRequestId = '';
    autoTradePlanState.lastTxHash = '';
  } finally {
    autoTradePlanBusy = false;
    if (reason === 'startup' || reason === 'manual') {
      console.log(
        `[auto-trade-plan] tick ${autoTradePlanState.lastStatus} decision=${autoTradePlanState.lastDecision || '-'} requestId=${autoTradePlanState.lastRequestId || '-'}`
      );
    }
  }
}

function stopAutoTradePlanLoop() {
  if (autoTradePlanTimer) {
    clearInterval(autoTradePlanTimer);
    autoTradePlanTimer = null;
  }
  autoTradePlanState.enabled = false;
}

function startAutoTradePlanLoop(options = {}) {
  const intervalMs = Math.max(60_000, Number(options.intervalMs || autoTradePlanState.intervalMs || 600_000));
  const horizonMin = Math.max(5, Math.min(Number(options.horizonMin || autoTradePlanState.horizonMin || 60), 1440));
  const symbol = String(options.symbol || autoTradePlanState.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const prompt = String(options.prompt || autoTradePlanState.prompt || '').trim();

  autoTradePlanState.intervalMs = intervalMs;
  autoTradePlanState.symbol = symbol;
  autoTradePlanState.horizonMin = horizonMin;
  autoTradePlanState.prompt = prompt;
  autoTradePlanState.enabled = true;
  autoTradePlanState.startedAt = new Date().toISOString();
  autoTradePlanState.lastError = '';
  autoTradePlanState.lastStatus = '';

  if (autoTradePlanTimer) clearInterval(autoTradePlanTimer);
  autoTradePlanTimer = setInterval(() => {
    runAutoTradePlanTick('timer').catch(() => {});
  }, intervalMs);

  if (options.immediate !== false) {
    runAutoTradePlanTick(options.reason || 'manual').catch(() => {});
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
    entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
    bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
    bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
    bundlerRpcBackoffBaseMs: KITE_BUNDLER_RPC_BACKOFF_BASE_MS,
    bundlerRpcBackoffMaxMs: KITE_BUNDLER_RPC_BACKOFF_MAX_MS,
    bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
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

function computeX402StatusCounts(rows = [], now = Date.now()) {
  const items = Array.isArray(rows) ? rows : [];
  let pending = 0;
  let paid = 0;
  let expired = 0;
  let failed = 0;
  for (const item of items) {
    const status = String(item?.status || '').trim().toLowerCase();
    const expiresAt = Number(item?.expiresAt || 0);
    if (status === 'paid') {
      paid += 1;
    } else if (status === 'pending') {
      if (expiresAt > 0 && now > expiresAt) expired += 1;
      else pending += 1;
    } else if (status === 'expired') {
      expired += 1;
    } else if (status) {
      failed += 1;
    }
  }
  return {
    total: items.length,
    pending,
    paid,
    expired,
    failed
  };
}

function expireStaleX402PendingRequests({
  dryRun = false,
  stalePendingMs = 24 * 60 * 60 * 1000,
  limit = 0,
  reason = 'ttl_or_stale_pending'
} = {}) {
  const now = Date.now();
  const maxStalePendingMs = Number.isFinite(Number(stalePendingMs)) && Number(stalePendingMs) > 0
    ? Number(stalePendingMs)
    : 24 * 60 * 60 * 1000;
  const maxUpdates = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), 10_000)
    : 0;
  const rows = readX402Requests();
  const before = computeX402StatusCounts(rows, now);
  let touched = 0;
  const touchedIds = [];
  const nextRows = rows.map((item) => {
    const status = String(item?.status || '').trim().toLowerCase();
    if (status !== 'pending') return item;
    if (maxUpdates > 0 && touched >= maxUpdates) return item;
    const expiresAt = Number(item?.expiresAt || 0);
    const createdAt = Number(item?.createdAt || 0);
    const expiredByTtl = expiresAt > 0 && now > expiresAt;
    const expiredByAge = (!expiresAt || expiresAt <= 0) && createdAt > 0 && now - createdAt > maxStalePendingMs;
    if (!expiredByTtl && !expiredByAge) return item;
    touched += 1;
    touchedIds.push(String(item?.requestId || '').trim());
    if (dryRun) return item;
    return {
      ...item,
      status: 'expired',
      expiredAt: now,
      cleanup: {
        reason,
        expiredBy: expiredByTtl ? 'ttl' : 'age',
        stalePendingMs: maxStalePendingMs,
        cleanedAt: now
      }
    };
  });
  if (!dryRun && touched > 0) {
    writeX402Requests(nextRows);
  }
  const after = computeX402StatusCounts(dryRun ? rows : nextRows, now);
  return {
    ok: true,
    dryRun,
    now,
    stalePendingMs: maxStalePendingMs,
    requestedLimit: maxUpdates,
    cleaned: touched,
    before,
    after,
    requestIds: touchedIds.slice(0, 100)
  };
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

function readXmtpGroups() {
  return readJsonArray(xmtpGroupsPath);
}

function writeXmtpGroups(records) {
  writeJsonArray(xmtpGroupsPath, records);
}

function readNetworkCommands() {
  return readJsonArray(networkCommandsPath);
}

function writeNetworkCommands(records) {
  writeJsonArray(networkCommandsPath, records);
}

function readAgent001Results() {
  return readJsonArray(agent001ResultsPath);
}

function writeAgent001Results(records) {
  writeJsonArray(agent001ResultsPath, records);
}

function upsertAgent001ResultRecord(input = {}) {
  const requestId = String(input?.requestId || '').trim();
  if (!requestId) return null;
  const rows = readAgent001Results();
  const now = new Date().toISOString();
  const existingIndex = rows.findIndex((item) => String(item?.requestId || '').trim() === requestId);
  const prev = existingIndex >= 0 ? rows[existingIndex] : null;
  const merged = {
    requestId,
    capability: String(input?.capability || prev?.capability || '').trim().toLowerCase(),
    stage: String(input?.stage || prev?.stage || '').trim().toLowerCase(),
    status: String(input?.status || prev?.status || '').trim().toLowerCase(),
    traceId: String(input?.traceId || prev?.traceId || '').trim(),
    taskId: String(input?.taskId || prev?.taskId || '').trim(),
    toAgentId: String(input?.toAgentId || prev?.toAgentId || '').trim().toLowerCase(),
    payer: normalizeAddress(input?.payer || prev?.payer || ''),
    input:
      input?.input && typeof input.input === 'object' && !Array.isArray(input.input)
        ? input.input
        : prev?.input && typeof prev.input === 'object' && !Array.isArray(prev.input)
          ? prev.input
          : {},
    quote:
      input?.quote && typeof input.quote === 'object' && !Array.isArray(input.quote)
        ? input.quote
        : prev?.quote && typeof prev.quote === 'object' && !Array.isArray(prev.quote)
          ? prev.quote
          : null,
    payment:
      input?.payment && typeof input.payment === 'object' && !Array.isArray(input.payment)
        ? input.payment
        : prev?.payment && typeof prev.payment === 'object' && !Array.isArray(prev.payment)
          ? prev.payment
          : null,
    receiptRef:
      input?.receiptRef && typeof input.receiptRef === 'object' && !Array.isArray(input.receiptRef)
        ? input.receiptRef
        : prev?.receiptRef && typeof prev.receiptRef === 'object' && !Array.isArray(prev.receiptRef)
          ? prev.receiptRef
          : null,
    result:
      input?.result && typeof input.result === 'object' && !Array.isArray(input.result)
        ? input.result
        : prev?.result && typeof prev.result === 'object' && !Array.isArray(prev.result)
          ? prev.result
          : null,
    error: String(input?.error || prev?.error || '').trim(),
    reason: String(input?.reason || prev?.reason || '').trim(),
    warnings: Array.isArray(input?.warnings)
      ? input.warnings.map((item) => String(item || '').trim()).filter(Boolean)
      : Array.isArray(prev?.warnings)
        ? prev.warnings.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
    dm:
      input?.dm && typeof input.dm === 'object' && !Array.isArray(input.dm)
        ? input.dm
        : prev?.dm && typeof prev.dm === 'object' && !Array.isArray(prev.dm)
          ? prev.dm
          : null,
    source: String(input?.source || prev?.source || '').trim().toLowerCase(),
    createdAt: String(prev?.createdAt || now).trim() || now,
    updatedAt: now
  };
  if (existingIndex >= 0) rows[existingIndex] = merged;
  else rows.unshift(merged);
  writeAgent001Results(rows);
  return merged;
}

function upsertWorkflow(workflow) {
  const rows = readWorkflows();
  const idx = rows.findIndex((w) => String(w.traceId || '') === String(workflow.traceId || ''));
  if (idx >= 0) rows[idx] = workflow;
  else rows.unshift(workflow);
  writeWorkflows(rows);
  return workflow;
}

const x402ReceiptService = createX402ReceiptService({
  readX402Requests,
  readWorkflows
});
const {
  mapX402Item,
  buildLatestWorkflowByRequestId,
  buildDemoPriceSeries,
  normalizeExecutionState,
  buildA2AReceipt,
  listA2AReceipts,
  buildA2ANetworkGraph,
  computeDashboardKpi
} = x402ReceiptService;

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
  if (normalized === 'technical-analysis-feed') {
    const alias = String(
      process.env.KITE_TECHNICAL_SERVICE_PROVIDER_ALIAS || process.env.KITE_RISK_SERVICE_PROVIDER_ALIAS || 'kol-score'
    )
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
  if (normalized === 'info-analysis-feed') {
    const alias = String(
      process.env.KITE_INFO_SERVICE_PROVIDER_ALIAS || process.env.KITE_XREADER_SERVICE_PROVIDER_ALIAS || 'kol-score'
    )
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
  return normalizeRecipients([
    MERCHANT_ADDRESS,
    KITE_AGENT2_AA_ADDRESS,
    resolveTechnicalSettlementRecipient(),
    resolveInfoSettlementRecipient()
  ]);
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

function isTechnicalAnalysisAction(actionRaw = '') {
  const action = String(actionRaw || '').trim().toLowerCase();
  return action === 'technical-analysis-feed' || action === 'risk-score-feed';
}

function isInfoAnalysisAction(actionRaw = '') {
  const action = String(actionRaw || '').trim().toLowerCase();
  return action === 'info-analysis-feed' || action === 'x-reader-feed';
}

function resolveTechnicalSettlementRecipient() {
  const candidate = normalizeAddress(XMTP_RISK_AGENT_AA_ADDRESS || KITE_AGENT2_AA_ADDRESS || '');
  return ethers.isAddress(candidate) ? candidate : normalizeAddress(KITE_AGENT2_AA_ADDRESS || '');
}

function resolveInfoSettlementRecipient() {
  const candidate = normalizeAddress(XMTP_READER_AGENT_AA_ADDRESS || KITE_AGENT2_AA_ADDRESS || '');
  return ethers.isAddress(candidate) ? candidate : normalizeAddress(KITE_AGENT2_AA_ADDRESS || '');
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
  if (isTechnicalAnalysisAction(action)) {
    return {
      action: action === 'technical-analysis-feed' ? 'technical-analysis-feed' : 'risk-score-feed',
      amount: action === 'technical-analysis-feed' ? X402_TECHNICAL_PRICE : X402_RISK_SCORE_PRICE,
      recipient: resolveTechnicalSettlementRecipient(),
      summary:
        action === 'technical-analysis-feed'
          ? 'Technical analysis unlocked by x402 payment'
          : 'BTC risk score unlocked by x402 payment'
    };
  }
  if (isInfoAnalysisAction(action)) {
    return {
      action: 'info-analysis-feed',
      amount: X402_INFO_PRICE || X402_X_READER_PRICE,
      recipient: resolveInfoSettlementRecipient(),
      summary: 'Info analysis unlocked by x402 payment'
    };
  }
  if (action === 'hyperliquid-order-testnet') {
    return {
      action: 'hyperliquid-order-testnet',
      amount: X402_HYPERLIQUID_ORDER_PRICE,
      recipient: HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS,
      summary: 'Hyperliquid testnet order unlocked by x402 payment'
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

  const symbolBase = compactPair.startsWith('ETH') ? 'ETH' : compactPair.startsWith('BTC') ? 'BTC' : '';
  if (!symbolBase) {
    throw new Error('Price task requires pair BTC/ETH (BTCUSDT/BTCUSD/ETHUSDT/ETHUSD).');
  }
  if (!['hyperliquid', 'auto', 'binance', 'okx', 'coingecko'].includes(rawSource)) {
    throw new Error('BTC price task source must be one of hyperliquid/auto/binance/okx/coingecko.');
  }

  const normalizedPair = `${symbolBase}USDT`;
  let providers = ['hyperliquid', 'binance', 'okx'];
  if (rawSource === 'binance') providers = ['binance', 'hyperliquid', 'okx'];
  else if (rawSource === 'okx') providers = ['okx', 'hyperliquid', 'binance'];
  else if (rawSource === 'coingecko') providers = ['binance', 'okx', 'hyperliquid'];

  return {
    pair: normalizedPair,
    source: 'hyperliquid',
    sourceRequested: rawSource,
    providers
  };
}

function normalizeRiskScoreParams(input = {}) {
  const rawSymbol = String(input.symbol || input.pair || 'BTCUSDT').trim().toUpperCase();
  const symbolCompact = rawSymbol.replace(/[-_\s]/g, '');
  const symbolBase = symbolCompact.startsWith('ETH') ? 'ETH' : symbolCompact.startsWith('BTC') ? 'BTC' : '';
  if (!symbolBase) {
    throw new Error('Risk-score task requires symbol BTC/ETH (BTCUSDT/BTCUSD/ETHUSDT/ETHUSD).');
  }
  const horizonMinRaw = Number(input.horizonMin ?? input.horizonMins ?? 60);
  const horizonMin = Number.isFinite(horizonMinRaw) ? Math.max(5, Math.min(Math.round(horizonMinRaw), 240)) : 60;
  const normalizedBtc = normalizeBtcPriceParams({ source: input.source || 'hyperliquid', pair: rawSymbol });
  return {
    symbol: normalizedBtc.pair,
    horizonMin,
    source: normalizedBtc.source,
    sourceRequested: normalizedBtc.sourceRequested,
    providers: normalizedBtc.providers
  };
}

function normalizeXReaderParams(input = {}) {
  const rawInput = String(
    input.url || input.resourceUrl || input.targetUrl || input.topic || input.query || input.keyword || ''
  ).trim();
  if (!rawInput) {
    throw new Error('info-analysis task requires url or topic.');
  }
  let normalizedUrl = '';
  let topic = '';
  let inputType = 'url';
  try {
    const parsed = new URL(rawInput);
    if (!['http:', 'https:'].includes(String(parsed.protocol || '').toLowerCase())) {
      throw new Error('invalid protocol');
    }
    normalizedUrl = parsed.toString();
    const host = String(parsed.hostname || '').replace(/^www\./i, '').trim();
    topic = host ? `market sentiment for ${host}` : normalizedUrl;
    inputType = 'url';
  } catch {
    normalizedUrl = '';
    topic = rawInput;
    inputType = 'topic';
  }

  const requestedMode = String(input.mode || input.source || 'auto').trim().toLowerCase();
  const modeAliases = {
    market: 'market-data',
    marketdata: 'market-data',
    legacy: 'market-data',
    fallback: 'market-data',
    news: 'auto',
    xreader: 'auto',
    jina: 'auto',
    opennewsmcp: 'opennews',
    opennews: 'opennews',
    twitter: 'opentwitter',
    opentwittermcp: 'opentwitter',
    opentwitter: 'opentwitter',
    mcp: 'multi-provider',
    multiprovider: 'multi-provider'
  };
  const rawMode = modeAliases[requestedMode] || requestedMode;
  if (!['auto', 'market-data', 'opennews', 'opentwitter', 'multi-provider'].includes(rawMode)) {
    throw new Error('info-analysis task mode must be one of auto/market-data/opennews/opentwitter/multi-provider.');
  }
  const maxCharsRaw = Number(input.maxChars ?? input.maxLength ?? X_READER_MAX_CHARS_DEFAULT);
  const maxChars = Number.isFinite(maxCharsRaw)
    ? Math.max(200, Math.min(Math.round(maxCharsRaw), 20000))
    : X_READER_MAX_CHARS_DEFAULT;

  return {
    url: normalizedUrl,
    topic,
    inputType,
    mode: rawMode,
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

function clampNumber(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeStringArray(values = [], limit = 12) {
  const source = Array.isArray(values)
    ? values
    : String(values || '')
        .split('\n')
        .map((item) => String(item || '').trim())
        .filter(Boolean);
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Number(limit) || 12));
}

function normalizeFreshIsoTimestamp(primaryValue = '', fallbackValue = '') {
  const now = Date.now();
  const maxAgeMs = 1000 * 60 * 60 * 24 * 7;
  const futureSkewMs = 1000 * 60 * 10;
  const candidates = [primaryValue, fallbackValue];
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) continue;
    const ageMs = now - ts;
    const tooOld = ageMs > maxAgeMs;
    const tooFuture = ts - now > futureSkewMs;
    if (tooOld || tooFuture) continue;
    return new Date(ts).toISOString();
  }
  return new Date(now).toISOString();
}

function normalizeInfoAnalysisResult(raw = {}, task = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const candidateHeadlines = normalizeStringArray(
    source.headlines || source.news || source.items || source.facts || []
  );
  const candidateFactors = normalizeStringArray(source.keyFactors || source.factors || source.signals || []);
  const summary =
    String(source.summary || source.excerpt || source.text || source.digest || '').trim() ||
    candidateFactors[0] ||
    candidateHeadlines[0] ||
    `Info analysis ready for ${String(task.url || task.topic || 'resource').trim()}`;
  const topic = String(source.topic || task.topic || task.url || '').trim() || 'market-context';
  const confidence = clampNumber(source.confidence, 0, 1, 0.5);
  const sentimentScore = clampNumber(source.sentimentScore ?? source.sentiment ?? 0, -1, 1, 0);
  return {
    provider: String(source.provider || ANALYSIS_PROVIDER).trim() || ANALYSIS_PROVIDER,
    traceId: String(source.traceId || task.traceId || '').trim(),
    topic,
    sentimentScore: Number(sentimentScore.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    headlines: candidateHeadlines,
    keyFactors: candidateFactors,
    summary,
    asOf: normalizeFreshIsoTimestamp(source.asOf || source.timestamp || source.fetchedAt || '')
  };
}

function normalizeTechnicalAnalysisResult(raw = {}, task = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const quoteSource = source.quote && typeof source.quote === 'object' && !Array.isArray(source.quote) ? source.quote : {};
  const symbol = String(source.symbol || source.pair || task.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const timeframe =
    String(source.timeframe || source.interval || '').trim() || `${Math.max(5, Number(task.horizonMin || 60))}m`;
  const confidence = clampNumber(source.confidence, 0, 1, 0.5);
  const defaultBias = confidence >= 0.65 ? 'bullish' : confidence <= 0.35 ? 'bearish' : 'neutral';
  const indicatorsSource =
    source.indicators && typeof source.indicators === 'object' && !Array.isArray(source.indicators)
      ? source.indicators
      : {};
  const signalsSource =
    source.signals && typeof source.signals === 'object' && !Array.isArray(source.signals)
      ? source.signals
      : {};
  const riskBandSource =
    source.riskBand && typeof source.riskBand === 'object' && !Array.isArray(source.riskBand)
      ? source.riskBand
      : {};
  const summary =
    String(source.summary || source.text || source.digest || '').trim() ||
    `Technical analysis ready for ${symbol} (${timeframe}).`;
  const riskScoreRaw = Number(source.riskScore ?? source.score ?? source?.risk?.score ?? NaN);
  const riskScore = Number.isFinite(riskScoreRaw) ? Math.max(5, Math.min(95, Math.round(riskScoreRaw))) : null;

  const quotePriceRaw = Number(quoteSource.priceUsd ?? source.priceUsd ?? source.price ?? NaN);
  const quotePair = String(quoteSource.pair || symbol).trim().toUpperCase() || symbol;
  const quoteProvider =
    String(quoteSource.provider || source.quoteProvider || source.provider || ANALYSIS_PROVIDER)
      .trim()
      .toLowerCase() || ANALYSIS_PROVIDER;
  const normalizedAsOf = normalizeFreshIsoTimestamp(
    source.asOf || source.timestamp || source.fetchedAt || '',
    quoteSource.fetchedAt || ''
  );
  const normalizedQuoteFetchedAt = normalizeFreshIsoTimestamp(
    quoteSource.fetchedAt || '',
    source.asOf || source.timestamp || source.fetchedAt || ''
  );
  const quote =
    Number.isFinite(quotePriceRaw) && quotePriceRaw > 0
      ? {
          provider: quoteProvider,
          pair: quotePair,
          priceUsd: Number(quotePriceRaw.toFixed(6)),
          fetchedAt: normalizedQuoteFetchedAt,
          sourceRequested: String(task.sourceRequested || task.source || '').trim().toLowerCase() || 'auto',
          attemptedProviders: normalizeStringArray(quoteSource.attemptedProviders || [quoteProvider], 6)
        }
      : null;

  return {
    provider: String(source.provider || ANALYSIS_PROVIDER).trim() || ANALYSIS_PROVIDER,
    traceId: String(source.traceId || task.traceId || '').trim(),
    symbol,
    timeframe,
    indicators: {
      rsi: Number.isFinite(Number(indicatorsSource.rsi)) ? Number(indicatorsSource.rsi) : null,
      macd: Number.isFinite(Number(indicatorsSource.macd)) ? Number(indicatorsSource.macd) : null,
      emaFast: Number.isFinite(Number(indicatorsSource.emaFast)) ? Number(indicatorsSource.emaFast) : null,
      emaSlow: Number.isFinite(Number(indicatorsSource.emaSlow)) ? Number(indicatorsSource.emaSlow) : null,
      atr: Number.isFinite(Number(indicatorsSource.atr)) ? Number(indicatorsSource.atr) : null
    },
    signals: {
      trend: String(signalsSource.trend || 'sideways').trim().toLowerCase() || 'sideways',
      momentum: String(signalsSource.momentum || 'neutral').trim().toLowerCase() || 'neutral',
      volatility: String(signalsSource.volatility || 'normal').trim().toLowerCase() || 'normal',
      bias: String(signalsSource.bias || defaultBias).trim().toLowerCase() || defaultBias
    },
    confidence: Number(confidence.toFixed(4)),
    riskBand: {
      stopLossPct: Number(
        clampNumber(riskBandSource.stopLossPct, 0.1, 30, Number.isFinite(Number(task.stopLossPct)) ? Number(task.stopLossPct) : 1.5).toFixed(4)
      ),
      takeProfitPct: Number(
        clampNumber(riskBandSource.takeProfitPct, 0.1, 60, Number.isFinite(Number(task.takeProfitPct)) ? Number(task.takeProfitPct) : 3).toFixed(4)
      )
    },
    riskScore,
    summary,
    asOf: normalizedAsOf,
    quote
  };
}

function resolveAnalysisErrorStatus(error = null, fallback = 500) {
  const code = String(error?.code || '').trim().toLowerCase();
  if (code.startsWith('service_unavailable') || code.startsWith('provider_unavailable')) return 502;
  if (code.startsWith('provider_timeout')) return 504;
  if (code.startsWith('provider_auth_failed')) return 401;
  if (code.startsWith('provider_rate_limited')) return 429;
  if (code.startsWith('invalid_')) return 400;
  const message = String(error?.message || '').trim().toLowerCase();
  if (message.includes('invalid_') || message.includes('invalid ')) return 400;
  return Number.isFinite(Number(fallback)) ? Number(fallback) : 500;
}

const messageProviderAnalysisService = createMessageProviderAnalysisService({
  analysisProvider: ANALYSIS_PROVIDER,
  messageProviderDefaultKeywords: MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
  messageProviderMarketDataFallback: MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
  openNews: {
    baseUrl: OPENNEWS_API_BASE,
    token: OPENNEWS_TOKEN,
    timeoutMs: OPENNEWS_TIMEOUT_MS,
    retries: OPENNEWS_RETRY,
    maxRows: OPENNEWS_MAX_ROWS
  },
  openTwitter: {
    baseUrl: OPENTWITTER_API_BASE,
    token: OPENTWITTER_TOKEN,
    timeoutMs: OPENTWITTER_TIMEOUT_MS,
    retries: OPENTWITTER_RETRY,
    maxRows: OPENTWITTER_MAX_ROWS
  },
  clampNumber,
  normalizeFreshIsoTimestamp,
  normalizeStringArray,
  normalizeInfoAnalysisResult,
  averageNumbers,
  normalizeXReaderParams,
  runMarketInfoAnalysis
});
const { runInfoAnalysis } = messageProviderAnalysisService;

async function fetchXReaderDigest(params = {}) {
  const task = normalizeXReaderParams(params);
  const info = await runInfoAnalysis({
    ...task,
    traceId: String(params?.traceId || '').trim()
  });
  const providerRaw = String(info?.provider || ANALYSIS_PROVIDER).trim().toLowerCase() || ANALYSIS_PROVIDER;
  const attemptedProviders = providerRaw
    .split('+')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const headline = Array.isArray(info.headlines) && info.headlines.length > 0 ? info.headlines[0] : '';
  const factor = Array.isArray(info.keyFactors) && info.keyFactors.length > 0 ? info.keyFactors[0] : '';
  const excerpt = String(info.summary || factor || headline || '').trim().slice(0, task.maxChars);
  return {
    provider: info.provider || ANALYSIS_PROVIDER,
    backend: providerRaw || ANALYSIS_PROVIDER,
    url: task.url,
    topic: task.topic,
    inputType: task.inputType,
    title: String(headline || '').trim(),
    excerpt,
    contentLength: excerpt.length,
    fetchedAt: info.asOf || new Date().toISOString(),
    mode: task.mode,
    maxChars: task.maxChars,
    sourceRequested: task.mode,
    attemptedProviders: attemptedProviders.length > 0 ? attemptedProviders : [ANALYSIS_PROVIDER],
    analysis: info
  };
}

async function fetchBtcFromHyperliquid(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout('https://api.hyperliquid.xyz/info', 8000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' })
  });
  const normalizedPair = String(pair || 'BTCUSDT').trim().toUpperCase().replace(/[-_\s]/g, '');
  const symbolBase = normalizedPair.startsWith('ETH') ? 'ETH' : 'BTC';
  const price = Number(body?.[symbolBase]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function fetchBtcFromBinance(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, 8000);
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
  return price;
}

async function fetchBtcFromOkx(pair = 'BTCUSDT') {
  const normalizedPair = String(pair || 'BTCUSDT').trim().toUpperCase().replace(/[-_\s]/g, '');
  const symbolBase = normalizedPair.startsWith('ETH') ? 'ETH' : 'BTC';
  const instId = `${symbolBase}-USDT`;
  const body = await fetchJsonWithTimeout(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, 8000);
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
        price = await fetchBtcFromHyperliquid(pair);
      } else if (provider === 'binance') {
        price = await fetchBtcFromBinance(pair);
      } else if (provider === 'okx') {
        price = await fetchBtcFromOkx(pair);
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

async function fetchBinanceTicker24h(pair = 'BTCUSDT') {
  const body = await fetchJsonWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, 8000);
  const lastPrice = Number(body?.lastPrice);
  const changePct = Number(body?.priceChangePercent);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) throw new Error('invalid lastPrice');
  return {
    provider: 'binance',
    pair,
    lastPrice,
    changePct: Number.isFinite(changePct) ? changePct : null,
    highPrice: Number(body?.highPrice),
    lowPrice: Number(body?.lowPrice),
    volume: Number(body?.volume),
    quoteVolume: Number(body?.quoteVolume)
  };
}

async function fetchCoinGeckoBtcSnapshot() {
  const body = await fetchJsonWithTimeout(
    'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false',
    8000
  );
  const market = body?.market_data && typeof body.market_data === 'object' ? body.market_data : {};
  const currentUsd = Number(market?.current_price?.usd);
  const change24h = Number(market?.price_change_percentage_24h);
  if (!Number.isFinite(currentUsd) || currentUsd <= 0) throw new Error('invalid coingecko current_price.usd');
  return {
    provider: 'coingecko',
    currentUsd,
    change24h: Number.isFinite(change24h) ? change24h : null,
    marketCapUsd: Number(market?.market_cap?.usd),
    totalVolumeUsd: Number(market?.total_volume?.usd),
    updatedAt: String(body?.last_updated || '').trim()
  };
}

async function fetchFearGreedIndex() {
  const body = await fetchJsonWithTimeout('https://api.alternative.me/fng/?limit=1', 8000);
  const row = Array.isArray(body?.data) ? body.data[0] || {} : {};
  const value = Number(row?.value);
  if (!Number.isFinite(value)) throw new Error('invalid fear_and_greed value');
  return {
    provider: 'alternative-me',
    value: Math.max(0, Math.min(100, value)),
    classification: String(row?.value_classification || '').trim() || 'Unknown',
    timestamp: String(row?.timestamp || '').trim()
  };
}

function averageNumbers(values = []) {
  const items = values.filter((item) => Number.isFinite(Number(item)));
  if (items.length === 0) return NaN;
  return items.reduce((sum, item) => sum + Number(item), 0) / items.length;
}

function computeEma(values = [], period = 14) {
  const list = values.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (list.length < period || period < 2) return NaN;
  const k = 2 / (period + 1);
  let ema = list.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < list.length; i += 1) {
    ema = list[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeRsi(values = [], period = 14) {
  const list = values.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (list.length <= period) return NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = list[i] - list[i - 1];
    if (delta >= 0) gain += delta;
    else loss += Math.abs(delta);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < list.length; i += 1) {
    const delta = list[i] - list[i - 1];
    const up = delta > 0 ? delta : 0;
    const down = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss <= 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeMacd(values = [], fast = 12, slow = 26) {
  const fastEma = computeEma(values, fast);
  const slowEma = computeEma(values, slow);
  if (!Number.isFinite(fastEma) || !Number.isFinite(slowEma)) return NaN;
  return fastEma - slowEma;
}

function computeAtr(highs = [], lows = [], closes = [], period = 14) {
  const h = highs.map((item) => Number(item));
  const l = lows.map((item) => Number(item));
  const c = closes.map((item) => Number(item));
  const len = Math.min(h.length, l.length, c.length);
  if (len <= period) return NaN;
  const trs = [];
  for (let i = 1; i < len; i += 1) {
    const high = h[i];
    const low = l[i];
    const prevClose = c[i - 1];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) continue;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (trs.length < period) return NaN;
  let atr = trs.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < trs.length; i += 1) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

async function fetchBinanceKlines(pair = 'BTCUSDT', interval = '1m', limit = 180) {
  const safeLimit = Math.max(30, Math.min(Number(limit || 180), 500));
  const body = await fetchJsonWithTimeout(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${safeLimit}`,
    8000
  );
  if (!Array.isArray(body) || body.length === 0) throw new Error('empty klines');
  return body
    .map((row) => ({
      openTime: Number(row?.[0]),
      open: Number(row?.[1]),
      high: Number(row?.[2]),
      low: Number(row?.[3]),
      close: Number(row?.[4]),
      closeTime: Number(row?.[6])
    }))
    .filter(
      (item) =>
        Number.isFinite(item.openTime) &&
        Number.isFinite(item.closeTime) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.close) &&
        item.close > 0
    );
}

async function runMarketInfoAnalysis(params = {}) {
  const task = normalizeXReaderParams(params);
  const topic = String(params?.topic || task.topic || task.url || 'BTC market sentiment').trim();
  const traceId = String(params?.traceId || '').trim();
  const failures = [];

  const [binanceRes, geckoRes, fearGreedRes] = await Promise.allSettled([
    fetchBinanceTicker24h('BTCUSDT'),
    fetchCoinGeckoBtcSnapshot(),
    fetchFearGreedIndex()
  ]);

  const headlines = [];
  const keyFactors = [];
  const sentimentParts = [];

  if (binanceRes.status === 'fulfilled') {
    const changePct = Number(binanceRes.value.changePct);
    const lastPrice = Number(binanceRes.value.lastPrice);
    if (Number.isFinite(changePct)) {
      headlines.push(`Binance BTC 24h ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`);
      keyFactors.push(`Binance last ${lastPrice.toFixed(2)} USD`);
      sentimentParts.push(clampNumber(changePct / 10, -1, 1, 0));
    }
  } else {
    failures.push(`binance:${String(binanceRes.reason?.message || binanceRes.reason || 'failed').trim()}`);
  }

  if (geckoRes.status === 'fulfilled') {
    const change24h = Number(geckoRes.value.change24h);
    const currentUsd = Number(geckoRes.value.currentUsd);
    if (Number.isFinite(change24h)) {
      headlines.push(`CoinGecko BTC 24h ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`);
      keyFactors.push(`CoinGecko spot ${currentUsd.toFixed(2)} USD`);
      sentimentParts.push(clampNumber(change24h / 10, -1, 1, 0));
    }
  } else {
    failures.push(`coingecko:${String(geckoRes.reason?.message || geckoRes.reason || 'failed').trim()}`);
  }

  if (fearGreedRes.status === 'fulfilled') {
    const value = Number(fearGreedRes.value.value);
    const classification = String(fearGreedRes.value.classification || '').trim();
    if (Number.isFinite(value)) {
      headlines.push(`Fear&Greed ${Math.round(value)} (${classification || 'n/a'})`);
      keyFactors.push(`Sentiment index=${Math.round(value)} /100`);
      sentimentParts.push(clampNumber((value - 50) / 50, -1, 1, 0));
    }
  } else {
    failures.push(`feargreed:${String(fearGreedRes.reason?.message || fearGreedRes.reason || 'failed').trim()}`);
  }

  if (headlines.length === 0 && keyFactors.length === 0) {
    throw new Error(`market_info_unavailable (${failures.join('; ') || 'no data source'})`);
  }

  const sentimentScore = Number.isFinite(averageNumbers(sentimentParts))
    ? averageNumbers(sentimentParts)
    : 0;
  const confidence = clampNumber(0.35 + headlines.length * 0.12 + keyFactors.length * 0.08, 0.35, 0.92, 0.5);
  const summary = `${topic}: sentiment ${sentimentScore >= 0 ? '偏多' : '偏空'} (${sentimentScore.toFixed(2)}), confidence ${confidence.toFixed(2)}; data=binance/coingecko/feargreed`;

  return normalizeInfoAnalysisResult(
    {
      provider: 'market-data',
      traceId,
      topic,
      sentimentScore,
      confidence,
      headlines,
      keyFactors,
      summary,
      asOf: new Date().toISOString()
    },
    {
      ...task,
      traceId
    }
  );
}

function buildFallbackTechnicalFromQuote(task = {}, quote = null, reason = '') {
  const safeQuote =
    quote && Number.isFinite(Number(quote?.priceUsd)) && Number(quote.priceUsd) > 0
      ? quote
      : {
          provider: 'fallback',
          pair: String(task.symbol || 'BTCUSDT').trim().toUpperCase(),
          priceUsd: 0,
          fetchedAt: new Date().toISOString(),
          sourceRequested: String(task.sourceRequested || task.source || 'auto').trim().toLowerCase() || 'auto',
          attemptedProviders: []
        };
  const horizonPoints = Math.max(3, Math.min(Number(task.horizonMin || 60), 60));
  const series = buildDemoPriceSeries(horizonPoints).series;
  const prices = series.map((item) => Number(item.priceUsd)).filter((item) => Number.isFinite(item) && item > 0);
  const baselinePrice =
    prices.length > 0 ? averageNumbers(prices) : Number.isFinite(Number(safeQuote.priceUsd)) ? Number(safeQuote.priceUsd) : 0;
  const minPrice = prices.length > 0 ? Math.min(...prices) : baselinePrice;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : baselinePrice;
  const rangePct = baselinePrice > 0 ? ((maxPrice - minPrice) / baselinePrice) * 100 : 0;
  const deviationPct = baselinePrice > 0 ? (Math.abs(Number(safeQuote.priceUsd) - baselinePrice) / baselinePrice) * 100 : 0;
  const rawScore = 24 + rangePct * 11 + deviationPct * 8;
  const bounded = Math.max(5, Math.min(95, Math.round(rawScore)));
  const level = toRiskLevel(bounded);
  const technical = normalizeTechnicalAnalysisResult(
    {
      provider: 'market-data-fallback',
      symbol: task.symbol,
      timeframe: `${task.horizonMin}m`,
      confidence: clampNumber(1 - Math.min(0.85, rangePct / 22), 0.1, 0.9, 0.5),
      summary: buildRiskScoreSummary(bounded, level, task.symbol, safeQuote),
      riskScore: bounded,
      signals: {
        trend: deviationPct >= 1.8 ? 'directional' : 'sideways',
        momentum: deviationPct >= 1.2 ? 'active' : 'neutral',
        volatility: rangePct >= 1.8 ? 'elevated' : 'normal',
        bias: level === 'high' || level === 'elevated' ? 'defensive' : 'balanced'
      },
      indicators: {
        rsi: null,
        macd: null,
        emaFast: null,
        emaSlow: null,
        atr: Number(rangePct.toFixed(6))
      },
      riskBand: {
        stopLossPct: Number(Math.max(0.8, Math.min(3.5, 1.1 + rangePct / 3)).toFixed(4)),
        takeProfitPct: Number(Math.max(1.2, Math.min(8, 2 + rangePct * 1.8)).toFixed(4))
      },
      quote: safeQuote,
      asOf: safeQuote.fetchedAt
    },
    task
  );
  technical.rangePct = Number(rangePct.toFixed(4));
  technical.deviationPct = Number(deviationPct.toFixed(4));
  technical.sampleSize = prices.length;
  if (reason) {
    technical.summary = `${technical.summary} (fallback reason: ${String(reason).slice(0, 180)})`;
    technical.fallbackReason = String(reason).slice(0, 280);
  }
  return technical;
}

async function runMarketTechnicalAnalysis(task = {}, input = {}) {
  const traceId = String(input?.traceId || '').trim();
  const quote = await fetchBtcPriceQuote({
    pair: task.symbol,
    source: task.sourceRequested
  });
  const klines = await fetchBinanceKlines(task.symbol, '1m', Math.max(90, Number(task.horizonMin || 60) * 3));
  if (klines.length < 30) throw new Error('market_data_technical_klines_insufficient');

  const closes = klines.map((item) => Number(item.close)).filter((item) => Number.isFinite(item) && item > 0);
  const highs = klines.map((item) => Number(item.high)).filter((item) => Number.isFinite(item) && item > 0);
  const lows = klines.map((item) => Number(item.low)).filter((item) => Number.isFinite(item) && item > 0);
  if (closes.length < 30 || highs.length < 30 || lows.length < 30) {
    throw new Error('market_data_technical_series_invalid');
  }

  const rsi = computeRsi(closes, 14);
  const macd = computeMacd(closes, 12, 26);
  const emaFast = computeEma(closes, 12);
  const emaSlow = computeEma(closes, 26);
  const atr = computeAtr(highs, lows, closes, 14);
  const spot = Number.isFinite(Number(quote.priceUsd)) && Number(quote.priceUsd) > 0 ? Number(quote.priceUsd) : closes[closes.length - 1];

  const lookback = Math.max(20, Math.min(Number(task.horizonMin || 60), closes.length));
  const window = closes.slice(-lookback);
  const avgPrice = averageNumbers(window);
  const minPrice = window.length > 0 ? Math.min(...window) : spot;
  const maxPrice = window.length > 0 ? Math.max(...window) : spot;
  const rangePct = avgPrice > 0 ? ((maxPrice - minPrice) / avgPrice) * 100 : 0;
  const deviationPct = avgPrice > 0 ? (Math.abs(spot - avgPrice) / avgPrice) * 100 : 0;
  const volatilityPct = spot > 0 && Number.isFinite(atr) ? (atr / spot) * 100 : rangePct / 2;

  const trend =
    Number.isFinite(emaFast) && Number.isFinite(emaSlow)
      ? emaFast > emaSlow * 1.0005
        ? 'uptrend'
        : emaFast < emaSlow * 0.9995
          ? 'downtrend'
          : 'sideways'
      : 'sideways';
  const momentum =
    Number.isFinite(rsi) ? (rsi >= 60 ? 'bullish' : rsi <= 40 ? 'bearish' : 'neutral') : 'neutral';
  const volatility =
    volatilityPct >= 1.5 ? 'elevated' : volatilityPct <= 0.6 ? 'compressed' : 'normal';
  const bias =
    trend === 'uptrend' && momentum !== 'bearish'
      ? 'bullish'
      : trend === 'downtrend' && momentum !== 'bullish'
        ? 'bearish'
        : 'neutral';
  const confidence = clampNumber(
    0.45 +
      (Number.isFinite(rsi) ? 0.12 : 0) +
      (Number.isFinite(macd) ? 0.12 : 0) +
      (Number.isFinite(emaFast) && Number.isFinite(emaSlow) ? 0.14 : 0) +
      (Number.isFinite(atr) ? 0.09 : 0),
    0.35,
    0.92,
    0.55
  );
  const rawScore =
    20 +
    rangePct * 9 +
    deviationPct * 6 +
    (Number.isFinite(rsi) ? Math.abs(rsi - 50) * 0.45 : 8) +
    (Number.isFinite(macd) && spot > 0 ? Math.min(8, Math.abs((macd / spot) * 10000)) : 0);
  const riskScore = Math.max(5, Math.min(95, Math.round(rawScore)));
  const level = toRiskLevel(riskScore);

  const technical = normalizeTechnicalAnalysisResult(
    {
      provider: 'market-data',
      traceId,
      symbol: task.symbol,
      timeframe: `${task.horizonMin}m`,
      indicators: {
        rsi: Number.isFinite(rsi) ? Number(rsi.toFixed(4)) : null,
        macd: Number.isFinite(macd) ? Number(macd.toFixed(8)) : null,
        emaFast: Number.isFinite(emaFast) ? Number(emaFast.toFixed(6)) : null,
        emaSlow: Number.isFinite(emaSlow) ? Number(emaSlow.toFixed(6)) : null,
        atr: Number.isFinite(atr) ? Number(atr.toFixed(6)) : null
      },
      signals: {
        trend,
        momentum,
        volatility,
        bias
      },
      confidence,
      riskBand: {
        stopLossPct: Number(Math.max(0.5, Math.min(4.5, volatilityPct * 1.8)).toFixed(4)),
        takeProfitPct: Number(Math.max(1.2, Math.min(10, volatilityPct * 3.1)).toFixed(4))
      },
      riskScore,
      summary: `${task.symbol} technical risk ${riskScore}/100 (${level}), trend=${trend}, momentum=${momentum}, volatility=${volatility}`,
      asOf: new Date().toISOString(),
      quote
    },
    task
  );
  technical.rangePct = Number(rangePct.toFixed(4));
  technical.deviationPct = Number(deviationPct.toFixed(4));
  technical.sampleSize = window.length;
  return technical;
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
  let technical = null;
  let fallbackReason = '';
  try {
    technical = await runMarketTechnicalAnalysis(task, input);
  } catch (error) {
    fallbackReason = String(error?.message || 'market_data_technical_unavailable').trim();
    const quote = await fetchBtcPriceQuote({
      pair: task.symbol,
      source: task.sourceRequested
    });
    technical = buildFallbackTechnicalFromQuote(task, quote, fallbackReason);
  }

  const quote =
    technical?.quote && Number.isFinite(Number(technical.quote.priceUsd)) && Number(technical.quote.priceUsd) > 0
      ? technical.quote
      : await fetchBtcPriceQuote({
          pair: task.symbol,
          source: task.sourceRequested
        });
  const scoreRaw = Number(technical?.riskScore ?? NaN);
  const bounded = Number.isFinite(scoreRaw)
    ? Math.max(5, Math.min(95, Math.round(scoreRaw)))
    : Math.max(5, Math.min(95, Math.round(Number(technical?.confidence || 0.5) * 100)));
  const level = toRiskLevel(bounded);

  return {
    summary: String(technical?.summary || buildRiskScoreSummary(bounded, level, task.symbol, quote)).trim(),
    risk: {
      symbol: task.symbol,
      score: bounded,
      level,
      horizonMin: task.horizonMin,
      rangePct: Number(
        Number.isFinite(Number(technical?.rangePct))
          ? Number(technical.rangePct)
          : Number(technical?.indicators?.atr || 0)
      ),
      deviationPct: Number(
        Number.isFinite(Number(technical?.deviationPct))
          ? Number(technical.deviationPct)
          : Number(technical?.confidence ? Math.abs(0.5 - Number(technical.confidence)) * 2.5 : 0)
      ),
      sampleSize: Number.isFinite(Number(technical?.sampleSize)) ? Number(technical.sampleSize) : 0,
      provider: String(quote?.provider || technical?.provider || 'legacy').trim().toLowerCase()
    },
    quote,
    technical: {
      ...technical,
      ...(fallbackReason && !technical?.fallbackReason ? { fallbackReason } : {})
    }
  };
}

function createServiceId() {
  return `svc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeServiceAction(actionRaw = '') {
  const normalized = String(actionRaw || 'btc-price-feed').trim().toLowerCase();
  const action = normalized === 'x-reader-feed' ? 'info-analysis-feed' : normalized;
  if (
    ![
      'btc-price-feed',
      'risk-score-feed',
      'technical-analysis-feed',
      'info-analysis-feed',
      'hyperliquid-order-testnet'
    ].includes(action)
  ) {
    throw new Error(
      'Supported service actions: btc-price-feed, risk-score-feed, technical-analysis-feed, info-analysis-feed, hyperliquid-order-testnet.'
    );
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
  const isTechnical = isTechnicalAnalysisAction(action);
  const isInfo = isInfoAnalysisAction(action);
  const isHyperliquidOrder = action === 'hyperliquid-order-testnet';
  const normalizedTask =
    isTechnical
      ? normalizeRiskScoreParams({
          symbol: input.pair || input.symbol || existing?.pair || 'BTCUSDT',
          source: input.source || existing?.source || 'hyperliquid',
          horizonMin: input.horizonMin ?? existing?.horizonMin ?? 60
        })
      : isInfo
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
      : isHyperliquidOrder
        ? {
            pair: String(input.pair || input.symbol || existing?.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT',
            source: 'hyperliquid-testnet',
            sourceRequested: 'hyperliquid-testnet',
            orderType: String(input.orderType || existing?.orderType || 'limit').trim().toLowerCase() || 'limit',
            tif: String(input.tif || existing?.tif || 'Gtc').trim() || 'Gtc'
          }
        : normalizeBtcPriceParams({
            pair: input.pair || existing?.pair || 'BTCUSDT',
            source: input.source || existing?.source || 'hyperliquid'
          });
  const fallbackRecipient = isTechnical
    ? resolveTechnicalSettlementRecipient()
    : isInfo
      ? resolveInfoSettlementRecipient()
      : isHyperliquidOrder
        ? normalizeAddress(HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS)
        : normalizeAddress(KITE_AGENT2_AA_ADDRESS);
  const recipient = normalizeAddress(input.recipient || existing?.recipient || fallbackRecipient);
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
    (isInfo
      ? action === 'info-analysis-feed'
        ? 'Message Info Analysis Service'
        : 'X Reader Digest Service'
      : isTechnical
        ? action === 'technical-analysis-feed'
          ? 'Technical Analysis Service'
          : 'BTC Risk Score Service'
      : isHyperliquidOrder
        ? 'Hyperliquid Testnet Order Service'
        : 'BTCUSD Quote Service');
  const description =
    String(input.description || existing?.description || '').trim() ||
    (isInfo
      ? action === 'info-analysis-feed'
        ? 'Pay-per-call message-side info analysis via market-data + x402.'
        : 'Pay-per-call URL digest powered by x-reader + x402.'
      : isTechnical
        ? action === 'technical-analysis-feed'
          ? 'Pay-per-call technical analysis via risk agent + x402.'
          : 'Pay-per-call risk score analysis via x402.'
      : isHyperliquidOrder
        ? 'Pay-per-call Hyperliquid testnet order execution via x402.'
        : 'Pay-per-call BTCUSD quote service.');
  const providerAgentId = String(input.providerAgentId || existing?.providerAgentId || KITE_AGENT2_ID).trim();
  const tags = normalizeStringList(
    input.tags ||
      existing?.tags ||
      (isInfo
        ? action === 'info-analysis-feed'
          ? ['a2a', 'x402', 'message', 'info-analysis']
          : ['atapi', 'x402', 'x-reader']
        : isTechnical
          ? action === 'technical-analysis-feed'
            ? ['a2a', 'x402', 'technical-analysis']
            : ['a2a', 'x402', 'risk']
        : isHyperliquidOrder
          ? ['atapi', 'x402', 'hyperliquid', 'order']
          : ['atapi', 'x402', action]),
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
        : isTechnical
          ? action === 'technical-analysis-feed'
            ? { symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid', perspective: 'technical' }
            : { symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid' }
          : isInfo
            ? action === 'info-analysis-feed'
              ? { topic: 'BTC market sentiment today', mode: 'auto', maxChars: X_READER_MAX_CHARS_DEFAULT }
              : { url: 'https://newshacker.me/', mode: 'auto', maxChars: X_READER_MAX_CHARS_DEFAULT }
            : isHyperliquidOrder
              ? { symbol: 'BTCUSDT', side: 'buy', orderType: 'limit', tif: 'Gtc', size: 0.001 }
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
      recipient: resolveTechnicalSettlementRecipient(),
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
      id: 'svc_technical_analysis',
      name: 'Technical Analysis (A2A)',
      description: 'Agent-to-agent technical analysis feed with strict x402 settlement evidence.',
      action: 'technical-analysis-feed',
      pair: 'BTCUSDT',
      source: 'hyperliquid',
      sourceRequested: 'hyperliquid',
      horizonMin: 60,
      providerAgentId: 'technical-agent',
      recipient: resolveTechnicalSettlementRecipient(),
      tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
      price: String(Number(Number(X402_TECHNICAL_PRICE || X402_RISK_SCORE_PRICE || '0.00002').toFixed(6))),
      tags: ['a2a', 'x402', 'technical-analysis'],
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
      id: 'svc_info_analysis',
      name: 'Message Info Analysis (A2A)',
      description: 'Agent-to-agent message-side info analysis via market-data + x402 payment.',
      action: 'info-analysis-feed',
      pair: '',
      source: 'auto',
      sourceRequested: 'auto',
      resourceUrl: '',
      maxChars: X_READER_MAX_CHARS_DEFAULT,
      providerAgentId: 'message-agent',
      recipient: resolveInfoSettlementRecipient(),
      tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
      price: String(Number(Number(X402_INFO_PRICE || X402_X_READER_PRICE || '0.00001').toFixed(6))),
      tags: ['a2a', 'x402', 'message', 'info-analysis'],
      slaMs: 15000,
      rateLimitPerMinute: 8,
      budgetPerDay: 0.05,
      allowlistPayers: [],
      exampleInput: { topic: 'BTC market sentiment today', mode: 'auto', maxChars: X_READER_MAX_CHARS_DEFAULT },
      active: true,
      createdAt: now,
      updatedAt: now,
      publishedBy: 'system'
    },
    {
      id: 'svc_hyperliquid_order_testnet',
      name: 'Hyperliquid Order (Testnet)',
      description: 'Agent-to-API Hyperliquid testnet order execution via x402 payment.',
      action: 'hyperliquid-order-testnet',
      pair: 'BTCUSDT',
      source: 'hyperliquid-testnet',
      sourceRequested: 'hyperliquid-testnet',
      providerAgentId: 'executor-agent',
      recipient: normalizeAddress(HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS),
      tokenAddress: normalizeAddress(SETTLEMENT_TOKEN),
      price: String(Number(Number(X402_HYPERLIQUID_ORDER_PRICE || '0.00002').toFixed(6))),
      tags: ['atapi', 'x402', 'hyperliquid', 'order'],
      slaMs: 15000,
      rateLimitPerMinute: 8,
      budgetPerDay: 0.08,
      allowlistPayers: [],
      exampleInput: { symbol: 'BTCUSDT', side: 'buy', orderType: 'limit', tif: 'Gtc', size: 0.001 },
      active: true,
      createdAt: now,
      updatedAt: now,
      publishedBy: 'system'
    }
  ];
}

function normalizedUnifiedServicePrice() {
  const parsed = Number(X402_UNIFIED_SERVICE_PRICE);
  if (!Number.isFinite(parsed) || parsed <= 0) return '0.00015';
  return String(Number(parsed.toFixed(6)));
}

function mergeBuiltinServices(rows = []) {
  const rawList = Array.isArray(rows) ? [...rows] : [];
  let changed = false;
  const unifiedPrice = normalizedUnifiedServicePrice();
  const list = rawList
    .filter((item) => {
      const id = String(item?.id || '').trim();
      if (id === 'svc_x_reader_digest') {
        changed = true;
        return false;
      }
      return true;
    })
    .map((item) => {
      const action = String(item?.action || '').trim().toLowerCase();
      let next = item;
      if (action === 'x-reader-feed') {
        changed = true;
        next = {
          ...next,
          action: 'info-analysis-feed',
          updatedAt: new Date().toISOString()
        };
      }
      if (String(next?.price || '').trim() !== unifiedPrice) {
        changed = true;
        next = {
          ...next,
          price: unifiedPrice,
          updatedAt: new Date().toISOString()
        };
      }
      return next;
    });
  const defaults = createDefaultServiceCatalog().map((service) => ({
    ...service,
    price: unifiedPrice
  }));
  for (const service of defaults) {
    const id = String(service?.id || '').trim();
    if (!id) continue;
    const index = list.findIndex((item) => String(item?.id || '').trim() === id);
    if (index < 0) {
      list.push(service);
      changed = true;
      continue;
    }
    const current = list[index] || {};
    if (String(current?.price || '').trim() !== unifiedPrice) {
      changed = true;
      list[index] = {
        ...current,
        price: unifiedPrice,
        updatedAt: new Date().toISOString()
      };
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
  const seed = createDefaultServiceCatalog().map((item) => ({
    ...item,
    price: normalizedUnifiedServicePrice()
  }));
  writePublishedServices(seed);
  return seed;
}

function mapCapabilityToServiceActions(capability = '') {
  const normalized = String(capability || '').trim().toLowerCase();
  if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
    return ['technical-analysis-feed', 'risk-score-feed'];
  }
  if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
    return ['info-analysis-feed'];
  }
  if (['btc-price-feed', 'market-quote'].includes(normalized)) {
    return ['btc-price-feed'];
  }
  if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
    return ['hyperliquid-order-testnet'];
  }
  return [];
}

function defaultAgentIdByCapability(capability = '') {
  const normalized = String(capability || '').trim().toLowerCase();
  if (['technical-analysis-feed', 'risk-score-feed', 'volatility-snapshot'].includes(normalized)) {
    return 'technical-agent';
  }
  if (['info-analysis-feed', 'x-reader-feed', 'url-digest'].includes(normalized)) {
    return 'message-agent';
  }
  if (['hyperliquid-order-testnet', 'trade-order-feed', 'execute-plan'].includes(normalized)) {
    return 'executor-agent';
  }
  if (['btc-price-feed', 'market-quote'].includes(normalized)) {
    return 'price-agent';
  }
  return 'router-agent';
}

function toPriceNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function selectServiceCandidatesByCapability(capability = '') {
  const actions = mapCapabilityToServiceActions(capability);
  if (actions.length === 0) return [];
  return ensureServiceCatalog().filter((item) => {
    if (item?.active === false) return false;
    const action = String(item?.action || '').trim().toLowerCase();
    return actions.includes(action);
  });
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
  const identityRegistry = normalizeAddress(source.identityRegistry || fallback.identityRegistry || '');
  const identityAgentIdRaw = source.identityAgentId ?? fallback.identityAgentId ?? '';
  const identityAgentId =
    identityAgentIdRaw === '' || identityAgentIdRaw === null || identityAgentIdRaw === undefined
      ? ''
      : String(identityAgentIdRaw).trim();
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
    identityRegistry,
    identityAgentId,
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
      name: 'AGENT001',
      role: 'router',
      mode: 'a2a',
      xmtpAddress: XMTP_ROUTER_RESOLVED_ADDRESS,
      aaAddress: XMTP_ROUTER_AGENT_AA_ADDRESS,
      identityRegistry: ERC8004_IDENTITY_REGISTRY || '',
      identityAgentId: ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID || '') : '',
      description: 'AGENT001 orchestrator: direct DM entry for task routing and A2A coordination.',
      capabilities: ['route-task', 'dispatch-a2a']
    },
    {
      id: 'risk-agent',
      name: 'Risk Agent',
      role: 'provider',
      mode: 'a2a',
      xmtpAddress: XMTP_RISK_RESOLVED_ADDRESS,
      aaAddress: XMTP_RISK_AGENT_AA_ADDRESS,
      identityRegistry: String(process.env.XMTP_RISK_IDENTITY_REGISTRY || '').trim(),
      identityAgentId: String(process.env.XMTP_RISK_IDENTITY_AGENT_ID || '').trim(),
      description: 'Computes risk-score feed through agent capability.',
      capabilities: ['risk-score-feed', 'volatility-snapshot', 'technical-analysis-feed']
    },
    {
      id: 'technical-agent',
      name: 'Technical Agent',
      role: 'provider',
      mode: 'a2a',
      xmtpAddress: XMTP_RISK_RESOLVED_ADDRESS,
      aaAddress: XMTP_RISK_AGENT_AA_ADDRESS,
      identityRegistry: String(process.env.XMTP_TECHNICAL_IDENTITY_REGISTRY || process.env.XMTP_RISK_IDENTITY_REGISTRY || '').trim(),
      identityAgentId: String(process.env.XMTP_TECHNICAL_IDENTITY_AGENT_ID || process.env.XMTP_RISK_IDENTITY_AGENT_ID || '').trim(),
      description: 'Single technical facade over risk/price sub-analysis outputs.',
      capabilities: ['technical-analysis-feed', 'risk-score-feed', 'market-quote']
    },
    {
      id: 'reader-agent',
      name: 'Reader Agent',
      role: 'provider',
      mode: 'a2api',
      xmtpAddress: XMTP_READER_RESOLVED_ADDRESS,
      aaAddress: XMTP_READER_AGENT_AA_ADDRESS,
      identityRegistry: String(process.env.XMTP_READER_IDENTITY_REGISTRY || '').trim(),
      identityAgentId: String(process.env.XMTP_READER_IDENTITY_AGENT_ID || '').trim(),
      description: 'Runs x-reader digest for URLs via ATAPI adapter.',
      capabilities: ['url-digest', 'info-analysis-feed']
    },
    {
      id: 'message-agent',
      name: 'Message Agent',
      role: 'provider',
      mode: 'a2api',
      xmtpAddress: XMTP_READER_RESOLVED_ADDRESS,
      aaAddress: XMTP_READER_AGENT_AA_ADDRESS,
      identityRegistry: String(process.env.XMTP_MESSAGE_IDENTITY_REGISTRY || process.env.XMTP_READER_IDENTITY_REGISTRY || '').trim(),
      identityAgentId: String(process.env.XMTP_MESSAGE_IDENTITY_AGENT_ID || process.env.XMTP_READER_IDENTITY_AGENT_ID || '').trim(),
      description: 'Message/news sentiment facade over reader runtime.',
      capabilities: ['info-analysis-feed', 'url-digest']
    },
    {
      id: 'price-agent',
      name: 'Price Agent',
      role: 'provider',
      mode: 'a2api',
      xmtpAddress: XMTP_PRICE_RESOLVED_ADDRESS,
      aaAddress: XMTP_PRICE_AGENT_AA_ADDRESS,
      description: 'Fetches BTC/market quote feeds.',
      capabilities: ['btc-price-feed', 'market-quote']
    },
    {
      id: 'executor-agent',
      name: 'Executor Agent',
      role: 'executor',
      mode: 'a2a',
      xmtpAddress: XMTP_EXECUTOR_RESOLVED_ADDRESS,
      aaAddress: XMTP_EXECUTOR_AGENT_AA_ADDRESS,
      description: 'Executes final orchestration and result aggregation.',
      capabilities: ['execute-plan', 'result-aggregation']
    }
  ];
  return seeds.map((item) => sanitizeNetworkAgentRecord(item)).filter((item) => item.id);
}

function mergeBuiltinNetworkAgents(rows = []) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const defaults = createDefaultNetworkAgents();
  let changed = false;
  for (const agent of defaults) {
    const id = String(agent?.id || '').trim().toLowerCase();
    if (!id) continue;
    const idx = list.findIndex((item) => String(item?.id || '').trim().toLowerCase() === id);
    if (idx < 0) {
      list.push(agent);
      changed = true;
      continue;
    }
    const current = sanitizeNetworkAgentRecord(list[idx], list[idx]);
    const mergedCapabilities = Array.from(new Set([...(current.capabilities || []), ...(agent.capabilities || [])]));
    const nextName = id === 'router-agent' ? String(agent.name || current.name || '').trim() : String(current.name || agent.name || '').trim();
    const nextDescription =
      id === 'router-agent'
        ? String(agent.description || current.description || '').trim()
        : String(current.description || agent.description || '').trim();
    const merged = sanitizeNetworkAgentRecord(
      {
        ...current,
        name: nextName,
        description: nextDescription,
        capabilities: mergedCapabilities
      },
      current
    );
    if (JSON.stringify(current) !== JSON.stringify(merged)) {
      list[idx] = merged;
      changed = true;
    }
  }
  return { rows: list, changed };
}

function ensureNetworkAgents() {
  const rows = readNetworkAgents();
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((item) => sanitizeNetworkAgentRecord(item))
    .filter((item) => item.id);
  if (normalized.length > 0) {
    const merged = mergeBuiltinNetworkAgents(normalized);
    const before = JSON.stringify(Array.isArray(rows) ? rows : []);
    const after = JSON.stringify(merged.rows);
    if (before !== after || merged.changed) writeNetworkAgents(merged.rows);
    return merged.rows;
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

function sanitizeXmtpGroupRecord(input = {}, existing = null) {
  const source = input && typeof input === 'object' ? input : {};
  const prev = existing && typeof existing === 'object' ? existing : {};
  const now = new Date().toISOString();
  const groupId = String(source.groupId || prev.groupId || '').trim();
  const label = String(source.label || prev.label || '').trim();
  const groupName = String(source.groupName || prev.groupName || '').trim();
  const description = String(source.description || prev.description || '').trim();
  const runtimeName = String(source.runtimeName || prev.runtimeName || 'router-runtime').trim();
  const memberAgentIds = parseAgentIdList(source.memberAgentIds || prev.memberAgentIds || []);
  const memberAddresses = normalizeAddresses(source.memberAddresses || prev.memberAddresses || []);
  const createdAt = String(prev.createdAt || source.createdAt || now).trim() || now;
  const updatedAt = String(source.updatedAt || now).trim() || now;
  const lastUsedAt = String(source.lastUsedAt || prev.lastUsedAt || updatedAt).trim() || updatedAt;
  return {
    groupId,
    label,
    groupName,
    description,
    runtimeName,
    memberAgentIds,
    memberAddresses,
    createdAt,
    updatedAt,
    lastUsedAt
  };
}

function upsertXmtpGroupRecord(input = {}) {
  const rows = readXmtpGroups();
  const groupId = String(input?.groupId || '').trim();
  const label = String(input?.label || '').trim().toLowerCase();
  const idx = rows.findIndex((item) => {
    if (groupId && String(item?.groupId || '').trim() === groupId) return true;
    if (label && String(item?.label || '').trim().toLowerCase() === label) return true;
    return false;
  });
  const current = idx >= 0 ? rows[idx] : null;
  const record = sanitizeXmtpGroupRecord(input, current);
  if (idx >= 0) rows[idx] = record;
  else rows.unshift(record);
  writeXmtpGroups(rows);
  return record;
}

function findXmtpGroupRecord({ groupId = '', label = '' } = {}) {
  const normalizedGroupId = String(groupId || '').trim();
  const normalizedLabel = String(label || '').trim().toLowerCase();
  return (
    readXmtpGroups().find((item) => {
      if (normalizedGroupId && String(item?.groupId || '').trim() === normalizedGroupId) return true;
      if (normalizedLabel && String(item?.label || '').trim().toLowerCase() === normalizedLabel) return true;
      return false;
    }) || null
  );
}

function resolveAgentAddressesByIds(agentIds = []) {
  const normalizedIds = parseAgentIdList(agentIds);
  const resolved = [];
  for (const id of normalizedIds) {
    const row = findNetworkAgentById(id);
    const address = normalizeAddress(row?.xmtpAddress || '');
    if (!address) continue;
    resolved.push({
      agentId: id,
      address
    });
  }
  const uniqueByAddress = [];
  for (const item of resolved) {
    if (uniqueByAddress.some((row) => row.address === item.address)) continue;
    uniqueByAddress.push(item);
  }
  return uniqueByAddress;
}

function normalizeNetworkCommandType(value = '') {
  const type = String(value || '').trim().toLowerCase();
  if (!type) return 'router-info-technical';
  if (type === 'router-risk-group' || type === 'router-risk') return 'router-info-technical';
  if (type === 'router-info-technical') return type;
  throw new Error('Unsupported command type. Supported: router-info-technical.');
}

function createCommandId() {
  return createTraceId('cmd');
}

function appendNetworkCommandEvent(command = {}, status = '', step = '', message = '', meta = null) {
  const events = Array.isArray(command?.events) ? [...command.events] : [];
  events.push({
    at: new Date().toISOString(),
    status: String(status || '').trim().toLowerCase(),
    step: String(step || '').trim().toLowerCase(),
    message: String(message || '').trim(),
    meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null
  });
  if (events.length > 120) {
    events.splice(0, events.length - 120);
  }
  return events;
}

function sanitizeNetworkCommandRecord(input = {}, existing = null) {
  const source = input && typeof input === 'object' ? input : {};
  const prev = existing && typeof existing === 'object' ? existing : {};
  const now = new Date().toISOString();
  const commandId = String(source.commandId || prev.commandId || createCommandId()).trim();
  const type = normalizeNetworkCommandType(source.type || prev.type || 'router-info-technical');
  const label = String(source.label || prev.label || type).trim();
  const statusRaw = String(source.status || prev.status || 'queued').trim().toLowerCase();
  const status = ['queued', 'running', 'done', 'failed'].includes(statusRaw) ? statusRaw : 'queued';
  const payload =
    source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
      ? source.payload
      : prev.payload && typeof prev.payload === 'object' && !Array.isArray(prev.payload)
        ? prev.payload
        : {};
  const result =
    source.result && typeof source.result === 'object' && !Array.isArray(source.result)
      ? source.result
      : prev.result && typeof prev.result === 'object' && !Array.isArray(prev.result)
        ? prev.result
        : null;
  const error = String(source.error || prev.error || '').trim();
  const attemptsRaw = Number(source.attempts ?? prev.attempts ?? 0);
  const attempts = Number.isFinite(attemptsRaw) && attemptsRaw > 0 ? Math.round(attemptsRaw) : 0;
  const createdAt = String(prev.createdAt || source.createdAt || now).trim() || now;
  const updatedAt = String(source.updatedAt || now).trim() || now;
  const startedAt = String(source.startedAt || prev.startedAt || '').trim();
  const finishedAt = String(source.finishedAt || prev.finishedAt || '').trim();
  const lastRunAt = String(source.lastRunAt || prev.lastRunAt || '').trim();
  const traceId = String(source.traceId || prev.traceId || '').trim();
  const requestId = String(source.requestId || prev.requestId || '').trim();
  const taskId = String(source.taskId || prev.taskId || '').trim();
  const eventsSource = Array.isArray(source.events) ? source.events : Array.isArray(prev.events) ? prev.events : [];
  const events = eventsSource
    .map((item) => ({
      at: String(item?.at || '').trim(),
      status: String(item?.status || '').trim().toLowerCase(),
      step: String(item?.step || '').trim().toLowerCase(),
      message: String(item?.message || '').trim(),
      meta: item?.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) ? item.meta : null
    }))
    .filter((item) => item.at || item.status || item.step || item.message)
    .slice(-120);

  return {
    commandId,
    type,
    label,
    status,
    payload,
    result,
    error,
    attempts,
    traceId,
    requestId,
    taskId,
    createdAt,
    updatedAt,
    startedAt,
    finishedAt,
    lastRunAt,
    events
  };
}

function findNetworkCommandById(commandId = '') {
  const id = String(commandId || '').trim();
  if (!id) return null;
  return (
    readNetworkCommands().find((item) => String(item?.commandId || '').trim() === id) || null
  );
}

function upsertNetworkCommandRecord(input = {}) {
  const rows = readNetworkCommands();
  const commandId = String(input?.commandId || '').trim();
  const idx = rows.findIndex((item) => String(item?.commandId || '').trim() === commandId);
  const existing = idx >= 0 ? rows[idx] : null;
  const record = sanitizeNetworkCommandRecord(input, existing);
  if (idx >= 0) rows[idx] = record;
  else rows.unshift(record);
  rows.sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0));
  writeNetworkCommands(rows);
  return record;
}

function parseNetworkCommandFilterList(input = '') {
  return String(input || '')
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}

function normalizeNetworkCommandPayload(input = {}) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function extractNetworkCommandRefs(result = {}, fallback = {}) {
  const task = result?.task && typeof result.task === 'object' ? result.task : {};
  const group = result?.group && typeof result.group === 'object' ? result.group : {};
  return {
    traceId: String(task.traceId || result.traceId || fallback.traceId || '').trim(),
    requestId: String(task.requestId || result.requestId || fallback.requestId || '').trim(),
    taskId: String(task.taskId || result.taskId || fallback.taskId || '').trim(),
    groupId: String(group.groupId || fallback.groupId || '').trim()
  };
}

function summarizeNetworkCommandExecution(result = {}) {
  const tasks = result?.tasks && typeof result.tasks === 'object' && !Array.isArray(result.tasks) ? result.tasks : null;
  if (!tasks) {
    const resultReceived = Boolean(result?.resultReceived);
    return {
      resultReceived,
      partialFailure: Boolean(result?.partialFailure),
      successCount: resultReceived ? 1 : 0,
      failureCount: resultReceived ? 0 : 1
    };
  }

  const failStatuses = ['failed', 'error', 'rejected', 'timeout'];
  const taskItems = Object.values(tasks).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  if (taskItems.length === 0) {
    const resultReceived = Boolean(result?.resultReceived);
    return {
      resultReceived,
      partialFailure: Boolean(result?.partialFailure),
      successCount: resultReceived ? 1 : 0,
      failureCount: resultReceived ? 0 : 1
    };
  }

  let successCount = 0;
  let failureCount = 0;
  let resultReceived = false;
  for (const task of taskItems) {
    const hasResult = Boolean(task?.resultReceived || task?.resultEvent || task?.taskResult);
    resultReceived = resultReceived || hasResult;
    const status = String(task?.status || task?.taskResult?.status || '').trim().toLowerCase();
    const explicitSuccess = typeof task?.success === 'boolean' ? task.success : null;
    const isFailure = explicitSuccess === false || Boolean(task?.failure) || failStatuses.includes(status) || !hasResult;
    if (isFailure) {
      failureCount += 1;
      continue;
    }
    successCount += 1;
  }

  return {
    resultReceived,
    partialFailure: successCount > 0 && failureCount > 0,
    successCount,
    failureCount
  };
}

async function invokeNetworkCommandTarget({ type = 'router-info-technical', payload = {} } = {}) {
  const commandType = normalizeNetworkCommandType(type);
  let endpoint = '/api/network/demo/router-info-technical/run';
  if (commandType !== 'router-info-technical') {
    endpoint = '/api/network/demo/router-info-technical/run';
  }
  const internalApiKey = getInternalAgentApiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (internalApiKey) headers['x-api-key'] = internalApiKey;
  const resp = await fetch(`http://127.0.0.1:${PORT}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body?.ok) {
    const reason = String(body?.reason || body?.error || `HTTP ${resp.status}`).trim();
    const error = new Error(reason || 'network command invoke failed');
    error.statusCode = resp.status;
    error.errorCode = String(body?.error || 'network_command_invoke_failed').trim();
    error.responseBody = body;
    error.endpoint = endpoint;
    throw error;
  }
  return {
    endpoint,
    statusCode: resp.status,
    body
  };
}

async function executeNetworkCommand(command = {}, options = {}) {
  const existing = command && typeof command === 'object' ? command : null;
  if (!existing?.commandId) {
    return {
      ok: false,
      statusCode: 400,
      error: 'command_not_found',
      reason: 'command not found'
    };
  }
  if (String(existing.status || '').trim().toLowerCase() === 'running') {
    return {
      ok: false,
      statusCode: 409,
      error: 'command_running',
      reason: 'command is already running'
    };
  }

  const now = new Date().toISOString();
  const payloadOverride = normalizeNetworkCommandPayload(options.payload || null);
  const basePayload = normalizeNetworkCommandPayload(existing.payload);
  const payload = { ...basePayload, ...payloadOverride };
  const preRunEvents = appendNetworkCommandEvent(
    existing,
    'running',
    'dispatch',
    `run ${existing.type} command`,
    {
      source: String(options.source || 'api').trim(),
      payloadOverride: Object.keys(payloadOverride).length > 0
    }
  );
  let running = upsertNetworkCommandRecord({
    ...existing,
    payload,
    status: 'running',
    error: '',
    result: null,
    attempts: Number(existing.attempts || 0) + 1,
    startedAt: now,
    finishedAt: '',
    lastRunAt: now,
    updatedAt: now,
    events: preRunEvents
  });

  try {
    const invokeResult = await invokeNetworkCommandTarget({
      type: running.type,
      payload
    });
    const executionSummary = summarizeNetworkCommandExecution(invokeResult.body);
    const refs = extractNetworkCommandRefs(invokeResult.body, running);
    const doneEvents = appendNetworkCommandEvent(
      running,
      'done',
      'complete',
      executionSummary.partialFailure
        ? `command partial done via ${invokeResult.endpoint}`
        : `command done via ${invokeResult.endpoint}`,
      {
        statusCode: invokeResult.statusCode,
        resultReceived: executionSummary.resultReceived,
        partialFailure: executionSummary.partialFailure,
        successCount: executionSummary.successCount,
        failureCount: executionSummary.failureCount
      }
    );
    const finishedAt = new Date().toISOString();
    const done = upsertNetworkCommandRecord({
      ...running,
      status: 'done',
      result: invokeResult.body,
      error: '',
      traceId: refs.traceId,
      requestId: refs.requestId,
      taskId: refs.taskId,
      finishedAt,
      updatedAt: finishedAt,
      events: doneEvents
    });
    return {
      ok: true,
      statusCode: 200,
      command: done,
      execution: {
        endpoint: invokeResult.endpoint,
        statusCode: invokeResult.statusCode,
        resultReceived: executionSummary.resultReceived,
        partialFailure: executionSummary.partialFailure,
        successCount: executionSummary.successCount,
        failureCount: executionSummary.failureCount
      }
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const reason = String(error?.message || 'network command failed').trim();
    const failEvents = appendNetworkCommandEvent(
      running,
      'failed',
      'complete',
      reason,
      {
        endpoint: String(error?.endpoint || '').trim(),
        statusCode: Number(error?.statusCode || 0) || null
      }
    );
    const failResult =
      error?.responseBody && typeof error.responseBody === 'object' && !Array.isArray(error.responseBody)
        ? {
            endpoint: String(error?.endpoint || '').trim(),
            statusCode: Number(error?.statusCode || 0) || 0,
            response: error.responseBody
          }
        : null;
    const failed = upsertNetworkCommandRecord({
      ...running,
      status: 'failed',
      error: reason,
      result: failResult,
      finishedAt: failedAt,
      updatedAt: failedAt,
      events: failEvents
    });
    return {
      ok: false,
      statusCode: Number(error?.statusCode || 502),
      error: String(error?.errorCode || 'network_command_failed').trim(),
      reason,
      command: failed
    };
  }
}

function getTaskEnvelopeInput(envelope = {}) {
  return envelope?.input && typeof envelope.input === 'object' && !Array.isArray(envelope.input)
    ? envelope.input
    : {};
}

function buildTaskPaymentFromIntent(envelope = {}) {
  const paymentIntent =
    envelope?.paymentIntent && typeof envelope.paymentIntent === 'object' && !Array.isArray(envelope.paymentIntent)
      ? envelope.paymentIntent
      : {};
  const requestId = String(paymentIntent.requestId || envelope?.requestId || '').trim();
  const txHash = String(paymentIntent.txHash || '').trim();
  const block = Number.isFinite(Number(paymentIntent.block)) ? Number(paymentIntent.block) : null;
  const status = String(paymentIntent.status || '').trim().toLowerCase();
  const explorer = String(paymentIntent.explorer || '').trim();
  const verifiedAt = String(paymentIntent.verifiedAt || '').trim();
  return {
    mode: String(paymentIntent.mode || 'mock').trim().toLowerCase() || 'mock',
    requestId,
    txHash,
    block,
    status,
    explorer,
    verifiedAt
  };
}

function buildTaskReceiptRef(payment = {}) {
  const requestId = String(payment?.requestId || '').trim();
  const txHash = String(payment?.txHash || '').trim();
  const block = Number.isFinite(Number(payment?.block)) ? Number(payment.block) : null;
  const status = String(payment?.status || '').trim().toLowerCase();
  const explorer = String(payment?.explorer || '').trim();
  const verifiedAt = String(payment?.verifiedAt || '').trim();
  return {
    requestId,
    txHash,
    block,
    status,
    explorer,
    verifiedAt,
    endpoint: requestId ? `/api/receipt/${requestId}` : ''
  };
}

function normalizeTaskFailure(error = null, fallbackCode = 'task_failed') {
  const code = String(error?.code || fallbackCode || 'task_failed').trim().toLowerCase() || 'task_failed';
  const reason = String(error?.message || code).trim() || code;
  return { code, reason };
}

function pickBestServiceByReputationAndPrice(services = []) {
  const rows = Array.isArray(services) ? services : [];
  if (rows.length === 0) return null;
  const priceValues = rows.map((item) => toPriceNumber(item?.service?.price, NaN)).filter((value) => Number.isFinite(value) && value > 0);
  const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : NaN;
  const maxPrice = priceValues.length > 0 ? Math.max(...priceValues) : NaN;

  const ranked = rows.map((item) => {
    const reputation = Number(item?.reputation?.score ?? 0);
    const price = toPriceNumber(item?.service?.price, NaN);
    let priceScore = 100;
    if (Number.isFinite(price) && Number.isFinite(minPrice) && Number.isFinite(maxPrice) && maxPrice > minPrice) {
      priceScore = ((maxPrice - price) / (maxPrice - minPrice)) * 100;
    }
    const finalScore = Number((reputation * 0.7 + priceScore * 0.3).toFixed(4));
    return {
      ...item,
      metrics: {
        reputationScore: Number(reputation.toFixed(4)),
        priceScore: Number(priceScore.toFixed(4)),
        finalScore
      }
    };
  });

  ranked.sort((a, b) => {
    const diff = Number(b?.metrics?.finalScore || 0) - Number(a?.metrics?.finalScore || 0);
    if (Math.abs(diff) > 1e-9) return diff > 0 ? 1 : -1;
    const slaA = Number(a?.service?.slaMs || 0);
    const slaB = Number(b?.service?.slaMs || 0);
    return slaA - slaB;
  });
  return ranked[0] || null;
}

function buildBestServiceQuote({ wantedCapability = '', preferredAgentId = '' } = {}) {
  const services = selectServiceCandidatesByCapability(wantedCapability);
  if (services.length === 0) return null;
  const invocations = readServiceInvocations();
  const workflows = readWorkflows();
  const workflowByTraceId = new Map(workflows.map((item) => [String(item?.traceId || '').trim(), item]));
  const requests = readX402Requests();
  const requestById = new Map(requests.map((item) => [String(item?.requestId || '').trim(), item]));
  const preferred = String(preferredAgentId || '').trim().toLowerCase();

  const rows = services.map((service) => {
    const perServiceInv = invocations.filter(
      (item) => String(item?.serviceId || '').trim() === String(service?.id || '').trim()
    );
    const receipts = perServiceInv.map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));
    const reputation = computeServiceReputation(service, receipts);
    const providerAgentId = String(service?.providerAgentId || '').trim().toLowerCase();
    return {
      service,
      reputation,
      providerAgentId
    };
  });

  const filtered = preferred ? rows.filter((item) => item.providerAgentId === preferred) : rows;
  const picked = pickBestServiceByReputationAndPrice(filtered.length > 0 ? filtered : rows);
  if (!picked?.service) return null;
  return {
    serviceId: String(picked.service.id || '').trim(),
    providerAgentId: String(picked.service.providerAgentId || defaultAgentIdByCapability(wantedCapability)).trim(),
    capability: String(wantedCapability || '').trim().toLowerCase(),
    price: String(picked.service.price || '').trim(),
    tokenAddress: String(picked.service.tokenAddress || SETTLEMENT_TOKEN || '').trim(),
    recipient: String(picked.service.recipient || KITE_AGENT2_AA_ADDRESS || '').trim(),
    slaMs: Number.isFinite(Number(picked.service.slaMs)) ? Number(picked.service.slaMs) : 12000,
    validForSec: 180,
    metrics: picked.metrics
  };
}

function parseJsonObjectFromText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      const parsed = JSON.parse(String(fenced[1] || '').trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(raw.slice(first, last + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function buildAgent001HelpText() {
  return [
    'AGENT001 在线，可直接自然语言下单给我：',
    '1) 技术面：例如 “分析 BTCUSDT 技术面 60m” 或 “分析 ETHUSDT 技术面 60m”',
    '2) 消息面：例如 “分析 btc market sentiment today” 或发送 URL',
    '3) 联合分析：例如 “给我 BTC 的消息+技术联合结论”',
    '4) 交易执行：例如 “市价下单 BTCUSDT 买入 size=0.001 止盈 90000 止损 82000” 或 “限价下单 BTCUSDT 卖出 price=95000 size=0.001”',
    '我会自动与 technical-agent / message-agent 通过 XMTP 协作，再回你结果。'
  ].join('\n');
}

async function classifyAgent001IntentByLlm(text = '') {
  const rawText = String(text || '').trim();
  if (!rawText) return { intent: 'help', symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid', topic: '' };
  const prompt = [
    'You are AGENT001 intent router.',
    'Return ONLY JSON with schema:',
    '{"intent":"technical|info|both|trade|chat|help","symbol":"BTCUSDT","horizonMin":60,"source":"hyperliquid","topic":""}',
    'Rules:',
    '- intent=technical for technical/risk analysis requests',
    '- intent=info for news/sentiment/info requests',
    '- intent=both for combined info+technical requests',
    '- intent=trade for order/plan/entry/exit/place-order requests',
    '- intent=help for capability/help requests',
    '- topic should keep user query text for info intent',
    '- symbol should default BTCUSDT',
    '',
    `User text: ${rawText}`
  ].join('\n');
  const chat = await openclawAdapter.chat({
    message: prompt,
    sessionId: 'agent001_intent',
    traceId: createTraceId('agent001_intent'),
    agent: 'router-agent'
  });
  if (!chat?.ok) return null;
  const parsed = parseJsonObjectFromText(chat.reply || '');
  if (!parsed) return null;
  return {
    intent: String(parsed.intent || '').trim().toLowerCase() || '',
    symbol: String(parsed.symbol || '').trim().toUpperCase() || 'BTCUSDT',
    horizonMin: Number.isFinite(Number(parsed.horizonMin)) ? Math.max(5, Math.min(Math.round(Number(parsed.horizonMin)), 240)) : 60,
    source: String(parsed.source || 'hyperliquid').trim().toLowerCase() || 'hyperliquid',
    topic: String(parsed.topic || '').trim()
  };
}

function resolveAgentAddressByIdForRouter(agentId = '') {
  const id = String(agentId || '').trim().toLowerCase();
  const mapped = findNetworkAgentById(id);
  const mappedAddress = normalizeAddress(mapped?.xmtpAddress || '');
  if (mappedAddress) return mappedAddress;
  if (id === 'risk-agent' || id === 'technical-agent') return normalizeAddress(XMTP_RISK_RESOLVED_ADDRESS);
  if (id === 'reader-agent' || id === 'message-agent') return normalizeAddress(XMTP_READER_RESOLVED_ADDRESS);
  return '';
}

async function waitRouterTaskResultByTaskId(taskId = '', waitMsLimit = 25_000) {
  const safeTaskId = String(taskId || '').trim();
  if (!safeTaskId) return null;
  const deadline = Date.now() + Math.max(1_000, Math.min(Number(waitMsLimit || 25_000), 60_000));
  while (Date.now() <= deadline) {
    const hits = xmtpRuntime.listEvents({
      runtimeName: 'router-runtime',
      direction: 'inbound',
      kind: 'task-result',
      taskId: safeTaskId
    });
    if (Array.isArray(hits) && hits.length > 0) {
      return hits[0];
    }
    await waitMs(280);
  }
  return null;
}

function isXmtpRuntimeUnhealthy(status = {}) {
  if (!status || typeof status !== 'object') return true;
  if (!status.enabled) return true;
  if (!status.configured) return true;
  if (!status.running) return true;
  const reason = String(status.lastError || '').trim().toLowerCase();
  if (!reason) return false;
  return (
    reason.includes('conversation streaming') ||
    reason.includes('streaming') ||
    reason.includes('incoming_handler') ||
    reason.includes('unhandled') ||
    reason.includes('connection') ||
    reason.includes('genericfailure')
  );
}

function isRecoverableXmtpFailure(error = '', reason = '') {
  const text = `${String(error || '').trim()} ${String(reason || '').trim()}`.toLowerCase();
  if (!text) return false;
  return (
    text.includes('stream') ||
    text.includes('timeout') ||
    text.includes('xmtp_') ||
    text.includes('not_running') ||
    text.includes('unhandled') ||
    text.includes('connection') ||
    text.includes('h2 protocol') ||
    text.includes('genericfailure') ||
    text.includes('router_send_failed')
  );
}

function resolveDispatchRuntimeByAgentId(agentId = '') {
  const id = String(agentId || '').trim().toLowerCase();
  if (id === 'risk-agent' || id === 'technical-agent') {
    return { runtime: xmtpRiskRuntime, label: 'risk' };
  }
  if (id === 'reader-agent' || id === 'message-agent') {
    return { runtime: xmtpReaderRuntime, label: 'reader' };
  }
  return { runtime: null, label: '' };
}

async function healXmtpRuntime(runtime, label = '') {
  if (!runtime || typeof runtime.getStatus !== 'function') {
    return { label, attempted: false, recovered: false, reason: 'runtime_not_found' };
  }
  const before = runtime.getStatus();
  if (!isXmtpRuntimeUnhealthy(before)) {
    return {
      label,
      attempted: false,
      recovered: true,
      before,
      after: before
    };
  }
  let stopError = '';
  try {
    await runtime.stop();
  } catch (error) {
    stopError = String(error?.message || 'stop_failed').trim();
  }
  let after = null;
  let startError = '';
  try {
    after = await runtime.start();
  } catch (error) {
    startError = String(error?.message || 'start_failed').trim();
  }
  const latest = runtime.getStatus();
  return {
    label,
    attempted: true,
    recovered: Boolean(latest?.running),
    before,
    after: after || latest,
    reason: startError || stopError || ''
  };
}

async function ensureDispatchRuntimesHealthy(toAgentId = '') {
  const actions = [];
  actions.push(await healXmtpRuntime(xmtpRuntime, 'router'));
  const target = resolveDispatchRuntimeByAgentId(toAgentId);
  if (target?.runtime) {
    actions.push(await healXmtpRuntime(target.runtime, target.label || 'target'));
  }
  return {
    actions,
    router: xmtpRuntime.getStatus(),
    target: target?.runtime ? target.runtime.getStatus() : null
  };
}

function isLegacyBtcOnlyTechnicalFailure(taskResult = null, capability = '', input = {}) {
  const normalizedCapability = String(capability || '').trim().toLowerCase();
  if (normalizedCapability !== 'technical-analysis-feed' && normalizedCapability !== 'risk-score-feed') return false;
  const symbol = String(input?.symbol || input?.pair || '').trim().toUpperCase().replace(/[-_\s]/g, '');
  if (!symbol.startsWith('ETH')) return false;
  const status = String(taskResult?.status || '').trim().toLowerCase();
  if (!['failed', 'error', 'rejected'].includes(status)) return false;
  const combined = [
    String(taskResult?.error || '').trim(),
    String(taskResult?.result?.summary || '').trim(),
    String(taskResult?.result?.failure?.reason || '').trim()
  ]
    .join(' ')
    .toLowerCase();
  return combined.includes('risk-score task requires symbol') && combined.includes('btc/btcusdt/btcusd');
}

async function buildLocalTechnicalRecoveryDispatch({
  capability = '',
  input = {},
  sent = null,
  task = {},
  attempt = 1,
  recovery = []
} = {}) {
  const technicalTask = normalizeRiskScoreParams({
    symbol: input?.symbol || input?.pair || 'BTCUSDT',
    source: input?.source || 'hyperliquid',
    horizonMin: input?.horizonMin ?? 60
  });
  const local = await runRiskScoreAnalysis(technicalTask);
  return {
    ok: true,
    sent,
    task,
    resultEvent: null,
    taskResult: {
      kind: 'task-result',
      protocolVersion: 'kite-agent-task-v1',
      status: 'done',
      result: {
        ...local,
        analysisType: 'technical',
        analysis: local?.technical && typeof local.technical === 'object' ? local.technical : null
      },
      error: '',
      fallback: 'local-technical-recovery'
    },
    attempt,
    recovery: Array.isArray(recovery) ? recovery : []
  };
}

async function runAgent001DispatchTask({
  toAgentId = '',
  capability = '',
  input = {},
  paymentIntent = null,
  waitMsLimit = 25_000
} = {}) {
  const resolvedToAgentId = String(toAgentId || '').trim().toLowerCase();
  const preflight = await ensureDispatchRuntimesHealthy(resolvedToAgentId);
  const recovery = Array.isArray(preflight?.actions) ? [...preflight.actions] : [];
  const routerStatus = xmtpRuntime.getStatus();
  if (!routerStatus.running) {
    return {
      ok: false,
      error: 'xmtp_router_not_running',
      reason: routerStatus.lastError || 'router runtime is not running',
      recovery
    };
  }
  const targetRuntime = resolveDispatchRuntimeByAgentId(resolvedToAgentId);
  const targetStatus =
    targetRuntime?.runtime && typeof targetRuntime.runtime.getStatus === 'function'
      ? targetRuntime.runtime.getStatus()
      : null;
  if (targetStatus && !targetStatus.running) {
    return {
      ok: false,
      error: 'xmtp_target_not_running',
      reason: targetStatus.lastError || `${targetRuntime.label || resolvedToAgentId} runtime is not running`,
      recovery
    };
  }
  const toAddress = resolveAgentAddressByIdForRouter(resolvedToAgentId);
  if (!toAddress) {
    return {
      ok: false,
      error: 'target_agent_address_missing',
      reason: `missing xmtp address for ${resolvedToAgentId || 'unknown'}`,
      recovery
    };
  }
  const maxAttempts = 2;
  let lastFailure = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const traceId = createTraceId('agent001_trace');
    const requestId = createTraceId('agent001_req');
    const taskId = createTraceId('agent001_task');
    const envelope = {
      kind: 'task-envelope',
      protocolVersion: 'kite-agent-task-v1',
      traceId,
      requestId,
      taskId,
      fromAgentId: 'router-agent',
      toAgentId: resolvedToAgentId,
      channel: 'dm',
      hopIndex: 1,
      mode: 'a2a',
      capability: String(capability || '').trim(),
      input: input && typeof input === 'object' && !Array.isArray(input) ? input : {},
      paymentIntent:
        paymentIntent && typeof paymentIntent === 'object' && !Array.isArray(paymentIntent) ? paymentIntent : {},
      expectsReply: true,
      timestamp: new Date().toISOString()
    };
    const sent = await xmtpRuntime.sendDm({
      fromAgentId: 'router-agent',
      toAgentId: resolvedToAgentId,
      toAddress,
      channel: 'dm',
      hopIndex: 1,
      envelope,
      traceId,
      requestId,
      taskId
    });
    if (!sent?.ok) {
      lastFailure = {
        ok: false,
        error: sent?.error || 'router_send_failed',
        reason: sent?.reason || 'router send failed',
        sent,
        task: { traceId, requestId, taskId, toAgentId: resolvedToAgentId, capability },
        attempt
      };
    } else {
      const resultEvent = await waitRouterTaskResultByTaskId(taskId, waitMsLimit);
      const taskResult = resultEvent?.parsed && typeof resultEvent.parsed === 'object' && !Array.isArray(resultEvent.parsed)
        ? resultEvent.parsed
        : null;
      if (taskResult) {
        if (isLegacyBtcOnlyTechnicalFailure(taskResult, capability, input)) {
          try {
            return await buildLocalTechnicalRecoveryDispatch({
              capability,
              input,
              sent,
              task: { traceId, requestId, taskId, toAgentId: resolvedToAgentId, capability },
              attempt,
              recovery
            });
          } catch {
            // local recovery failed, keep original failure result
          }
        }
        return {
          ok: true,
          sent,
          task: { traceId, requestId, taskId, toAgentId: resolvedToAgentId, capability },
          resultEvent,
          taskResult,
          attempt,
          recovery
        };
      }
      lastFailure = {
        ok: false,
        error: 'task_result_timeout',
        reason: `no task-result within ${Math.max(1_000, Math.min(Number(waitMsLimit || 25_000), 60_000))}ms`,
        sent,
        task: { traceId, requestId, taskId, toAgentId: resolvedToAgentId, capability },
        attempt
      };
    }

    if (attempt < maxAttempts && isRecoverableXmtpFailure(lastFailure?.error, lastFailure?.reason)) {
      const extra = await ensureDispatchRuntimesHealthy(resolvedToAgentId);
      if (Array.isArray(extra?.actions)) recovery.push(...extra.actions);
      await waitMs(650);
      continue;
    }
    break;
  }

  return {
    ...(lastFailure || { ok: false, error: 'dispatch_failed', reason: 'unknown dispatch failure' }),
    recovery
  };
}

function buildAgent001DispatchSummary(results = {}) {
  const technical = results?.technical || null;
  const info = results?.info || null;
  const lines = [];
  if (technical?.ok && technical?.taskResult?.result?.summary) {
    lines.push(`技术面: ${String(technical.taskResult.result.summary).trim()}`);
  } else if (technical) {
    lines.push(`技术面失败: ${String(technical.reason || technical.error || 'unknown').trim()}`);
  }
  if (info?.ok && info?.taskResult?.result?.summary) {
    lines.push(`消息面: ${String(info.taskResult.result.summary).trim()}`);
    const infoDetailLines = buildAgent001InfoDetailLines(info?.taskResult?.result || {});
    if (infoDetailLines.length > 0) {
      lines.push(...infoDetailLines);
    }
  } else if (info) {
    lines.push(`消息面失败: ${String(info.reason || info.error || 'unknown').trim()}`);
  }
  return lines.join('\n').trim();
}

function sanitizePlainText(value = '') {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipAgent001Line(text = '', maxLen = 140) {
  const raw = sanitizePlainText(String(text || '').trim());
  if (!raw) return '';
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1)}…`;
}

function extractAgent001TopHandles(keyFactors = [], limit = 3) {
  const rows = Array.isArray(keyFactors) ? keyFactors : [];
  const handles = [];
  for (const item of rows) {
    const text = String(item || '').trim();
    const matched = text.match(/x:@([A-Za-z0-9_]+)/);
    if (!matched) continue;
    const handle = `@${String(matched[1] || '').trim()}`;
    if (!handle || handles.includes(handle)) continue;
    handles.push(handle);
    if (handles.length >= limit) break;
  }
  return handles;
}

function buildAgent001InfoDetailLines(infoResult = {}) {
  const payload =
    infoResult?.info && typeof infoResult.info === 'object' && !Array.isArray(infoResult.info)
      ? infoResult.info
      : infoResult;
  const headlines = normalizeStringArray(payload?.headlines || infoResult?.headlines || [], 3)
    .map((item) => clipAgent001Line(item, 120))
    .filter(Boolean);
  const keyFactors = normalizeStringArray(payload?.keyFactors || infoResult?.keyFactors || [], 20);
  const handles = extractAgent001TopHandles(keyFactors, 3);
  const nonHandleFactors = keyFactors
    .filter((item) => !/^x:@/i.test(String(item || '').trim()))
    .slice(0, 3)
    .map((item) => clipAgent001Line(item, 80))
    .filter(Boolean);

  const lines = [];
  if (headlines.length > 0) {
    lines.push(`消息样本: ${headlines.map((item, index) => `${index + 1}) ${item}`).join(' | ')}`);
  }
  if (handles.length > 0) {
    lines.push(`重点账号: ${handles.join(', ')}`);
  }
  if (nonHandleFactors.length > 0) {
    lines.push(`关键因子: ${nonHandleFactors.join(' | ')}`);
  }
  return lines;
}

function shouldUseAgent001LocalFallback(result = null) {
  if (!result || result.ok) return false;
  return isRecoverableXmtpFailure(result?.error, result?.reason);
}

async function applyAgent001LocalFallback({
  rawText = '',
  intent = {},
  runTechnical = false,
  runInfo = false,
  technical = null,
  info = null
} = {}) {
  let nextTechnical = technical;
  let nextInfo = info;
  const symbol = String(intent?.symbol || extractTradingSymbolFromText(rawText) || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const horizonMin = Number.isFinite(Number(intent?.horizonMin))
    ? Math.max(5, Math.min(Math.round(Number(intent.horizonMin)), 240))
    : extractHorizonFromText(rawText);

  if (runTechnical && shouldUseAgent001LocalFallback(technical)) {
    try {
      const localTechnical = await runRiskScoreAnalysis({
        symbol,
        source: String(intent?.source || 'hyperliquid').trim().toLowerCase() || 'hyperliquid',
        horizonMin
      });
      nextTechnical = {
        ok: true,
        fallback: 'local-analysis',
        taskResult: {
          result: {
            ...localTechnical,
            analysisType: 'technical',
            analysis: localTechnical?.technical && typeof localTechnical.technical === 'object' ? localTechnical.technical : null
          }
        }
      };
    } catch (error) {
      nextTechnical = {
        ...(technical && typeof technical === 'object' ? technical : {}),
        ok: false,
        error: technical?.error || 'technical_local_fallback_failed',
        reason: `${String(technical?.reason || technical?.error || 'dispatch_failed').trim()}; local=${String(error?.message || 'failed').trim()}`
      };
    }
  }

  if (runInfo && shouldUseAgent001LocalFallback(info)) {
    try {
      const infoTask = normalizeXReaderParams({
        url: intent?.topic || extractFirstUrlFromText(rawText) || rawText,
        mode: 'news',
        maxChars: 900
      });
      const reader = await fetchXReaderDigest(infoTask);
      nextInfo = {
        ok: true,
        fallback: 'local-analysis',
        taskResult: {
          result: {
            summary: String(reader?.analysis?.summary || reader?.excerpt || '').trim() || 'info digest ready',
            analysisType: 'info',
            info: reader?.analysis || null,
            reader
          }
        }
      };
    } catch (error) {
      nextInfo = {
        ...(info && typeof info === 'object' ? info : {}),
        ok: false,
        error: info?.error || 'info_local_fallback_failed',
        reason: `${String(info?.reason || info?.error || 'dispatch_failed').trim()}; local=${String(error?.message || 'failed').trim()}`
      };
    }
  }

  return { technical: nextTechnical, info: nextInfo };
}

function isAgent001TaskSuccessful(dispatchResult = null) {
  if (!dispatchResult || !dispatchResult.ok) return false;
  const status = String(dispatchResult?.taskResult?.status || 'done').trim().toLowerCase();
  return !['failed', 'error', 'rejected'].includes(status);
}

const agent001Orchestrator = createAgent001Orchestrator({
  normalizeAddress,
  readIdentityProfile,
  defaultAgentIdByCapability,
  ensureNetworkAgents,
  findNetworkAgentById,
  selectServiceCandidatesByCapability,
  readServiceInvocations,
  readWorkflows,
  readX402Requests,
  mapServiceReceipt,
  computeServiceReputation,
  pickBestServiceByReputationAndPrice,
  runAgent001DispatchTask,
  extractTradingSymbolFromText,
  extractHorizonFromText,
  extractFirstUrlFromText,
  buildRiskScorePaymentIntentForTask,
  buildInfoPaymentIntentForTask,
  createTraceId
});
const {
  selectAgent001ProviderPlan,
  runAgent001QuoteNegotiation,
  buildAgent001StrictPaymentPlan
} = agent001Orchestrator;
const agent001ExecutionService = createAgent001ExecutionService({
  fetchJsonResponseWithTimeout,
  buildInternalAgentHeaders,
  createTraceId,
  isTransientTransportError,
  waitMs,
  hasStrictX402Evidence,
  upsertAgent001ResultRecord,
  normalizeAddress,
  getXmtpRuntime: () => xmtpRuntime,
  port: PORT
});
const {
  appendAgent001OrderExecutionLines,
  buildAgent001FailureReply,
  maybeSendAgent001ProgressDm,
  maybeSendAgent001TradePlanDm,
  runAgent001HyperliquidOrderWorkflow,
  runAgent001StopOrderWorkflow
} = agent001ExecutionService;
const agent001PlanningService = createAgent001PlanningService({
  parseAgent001OrderDirectives,
  extractTradingSymbolFromText,
  extractHorizonFromText,
  clampNumber,
  toRiskLevel
});
const {
  buildAgent001TradePlan,
  coerceAgent001ForcedTradePlan
} = agent001PlanningService;

async function maybePolishAgent001Reply(rawText = '', draft = '') {
  const cleanDraft = String(draft || '').trim();
  if (!cleanDraft) return '';
  const hasTechLine = cleanDraft.includes('技术面:');
  const hasInfoLine = cleanDraft.includes('消息面:');
  const prompt = [
    '你是 AGENT001。',
    '请把以下执行结果整理成简洁中文回复。',
    '要求：',
    '- 保留关键结论',
    '- 不要编造',
    '- 不要输出 markdown 代码块',
    '- 如果结果同时包含“技术面”和“消息面”，请在回复中明确分成“技术面:”和“消息面:”两段',
    '',
    `用户原话: ${String(rawText || '').trim()}`,
    `执行结果: ${cleanDraft}`
  ].join('\n');
  const chat = await openclawAdapter.chat({
    message: prompt,
    sessionId: 'agent001_polish',
    traceId: createTraceId('agent001_polish'),
    agent: 'router-agent'
  });
  if (!chat?.ok) return cleanDraft;
  const text = String(chat.reply || '').trim();
  if (hasTechLine && hasInfoLine) {
    const hasTechLabel = /技术面[:：]/.test(text);
    const hasInfoLabel = /消息面[:：]/.test(text);
    if (!hasTechLabel || !hasInfoLabel) return cleanDraft;
  }
  return text || cleanDraft;
}

async function handleRouterRuntimeTextMessage({ text = '', context = null } = {}) {
  const rawText = String(text || '').trim();
  if (!rawText) return buildAgent001HelpText();

  if (/(help|功能|怎么用|命令|示例)/i.test(rawText)) {
    return buildAgent001HelpText();
  }
  if (/(status|状态|在线|running)/i.test(rawText)) {
    const runtime = getAllXmtpRuntimeStatuses();
    return [
      'AGENT001 状态:',
      `router: ${runtime.router.running ? 'running' : 'stopped'}`,
      `technical(risk): ${runtime.risk.running ? 'running' : 'stopped'}`,
      `message(reader): ${runtime.reader.running ? 'running' : 'stopped'}`
    ].join('\n');
  }

  const llmIntent = await classifyAgent001IntentByLlm(rawText);
  const hardOverrides = detectAgent001IntentOverrides(rawText);
  let intent = resolveAgent001Intent(rawText, llmIntent);
  if (hardOverrides.infoOnly && !hardOverrides.technicalOnly) {
    intent.intent = 'info';
    if (!String(intent.topic || '').trim()) intent.topic = rawText;
  }
  if (hardOverrides.technicalOnly && !hardOverrides.infoOnly) {
    intent.intent = 'technical';
  }
  if (intent.intent === 'chat' && AGENT001_REQUIRE_X402) {
    const fallbackIntent = classifyAgent001IntentFallback(rawText);
    if (['info', 'technical', 'both', 'trade'].includes(fallbackIntent.intent)) {
      intent = {
        ...intent,
        ...fallbackIntent,
        intent: fallbackIntent.intent,
        topic: String(intent.topic || fallbackIntent.topic || rawText).trim()
      };
    }
  }
  if (intent.intent === 'help') {
    return buildAgent001HelpText();
  }
  if (intent.intent === 'chat') {
    if (AGENT001_REQUIRE_X402) {
      return '当前已开启强制计费：除 help/status 外均需 x402 支付。请发送“分析 BTCUSDT/ETHUSDT 技术面 60m”或“分析 btc market sentiment today”。';
    }
    const chat = await openclawAdapter.chat({
      message: `你是 AGENT001，请用简洁中文回复用户。\n用户消息: ${rawText}`,
      sessionId: 'agent001_chat',
      traceId: createTraceId('agent001_chat'),
      agent: 'router-agent'
    });
    if (chat?.ok && String(chat.reply || '').trim()) return String(chat.reply || '').trim();
    return `AGENT001 已收到。可直接说“分析 BTC 技术面 60m”或“分析 btc market sentiment today”。`;
  }

  const waitMsLimit = 30_000;
  const runTrade = intent.intent === 'trade';
  if (runTrade) {
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(runtime?.aaWallet || '');
    if (!payer) {
      return '交易执行前置条件不足：未配置可用 AA payer。请先在 Agent Settings 完成 Session/AA 同步。';
    }
    const orderDirectives = parseAgent001OrderDirectives(rawText);
    const directOrderMode = orderDirectives.explicitOrder === true;
    if (directOrderMode) {
      const baseDirectPlan = {
        text: ['直连下单模式', '说明: 检测到明确下单口令，已跳过消息面/技术面分析。'].join('\n'),
        symbol: String(intent?.symbol || extractTradingSymbolFromText(rawText) || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT',
        canPlaceOrder: false
      };
      const directPlan = coerceAgent001ForcedTradePlan({
        rawText,
        tradePlan: baseDirectPlan,
        technical: null,
        info: null,
        directives: orderDirectives
      });
      const lines = [String(directPlan?.text || '').trim() || '直连下单模式初始化失败。'];
      if (!directPlan?.canPlaceOrder) {
        lines.push(`执行阻断: ${String(directPlan?.forceOrderReason || '下单参数不足').trim()}`);
        lines.push('执行结果: 直连下单失败，请补充完整参数（side/orderType/size/price）。');
        const reply = lines.join('\n');
        await maybeSendAgent001TradePlanDm({
          context,
          tradePlanText: reply,
          infoPayment: null,
          technicalPayment: null
        });
        return reply;
      }

      const directExecution = await appendAgent001OrderExecutionLines({
        lines,
        plan: directPlan,
        payer,
        orderDirectives,
        orderTraceId: 'agent001_trade_order_direct',
        stopTraceId: 'agent001_trade_stop_direct',
        failureStage: 'trade_order_direct',
        resultSource: 'agent001_trade_direct'
      });
      if (directExecution.hardFailureReply) {
        return directExecution.hardFailureReply;
      }
      const reply = lines.join('\n');
      await maybeSendAgent001TradePlanDm({
        context,
        tradePlanText: reply,
        infoPayment: null,
        technicalPayment: null
      });
      return reply;
    }

    const [technicalProvider, infoProvider] = await Promise.all([
      selectAgent001ProviderPlan({ capability: 'technical-analysis-feed' }),
      selectAgent001ProviderPlan({ capability: 'info-analysis-feed' })
    ]);
    if (!technicalProvider?.ok || !infoProvider?.ok) {
      return [
        '交易链路中断：服务发现失败。',
        `技术面: ${technicalProvider?.reason || technicalProvider?.error || 'unavailable'}`,
        `消息面: ${infoProvider?.reason || infoProvider?.error || 'unavailable'}`
      ].join('\n');
    }

    const [technicalQuoteTask, infoQuoteTask] = await Promise.all([
      runAgent001QuoteNegotiation({
        toAgentId: technicalProvider.toAgentId,
        wantedCapability: 'technical-analysis-feed',
        rawText,
        intent,
        waitMsLimit: 12_000
      }),
      runAgent001QuoteNegotiation({
        toAgentId: infoProvider.toAgentId,
        wantedCapability: 'info-analysis-feed',
        rawText,
        intent,
        waitMsLimit: 12_000
      })
    ]);
    if (!isAgent001TaskSuccessful(technicalQuoteTask) || !isAgent001TaskSuccessful(infoQuoteTask)) {
      return [
        '交易链路中断：XMTP 报价协商失败。',
        `technical quote: ${technicalQuoteTask?.reason || technicalQuoteTask?.error || 'failed'}`,
        `message quote: ${infoQuoteTask?.reason || infoQuoteTask?.error || 'failed'}`
      ].join('\n');
    }

    let infoPayPlan = null;
    let info = null;
    const infoQuote = infoQuoteTask?.taskResult?.result?.quote || null;
    try {
      infoPayPlan = await buildAgent001StrictPaymentPlan({
        capability: 'info-analysis-feed',
        rawText,
        intent,
        payer,
        targetAgentId: infoProvider.toAgentId
      });
    } catch (error) {
      return buildAgent001FailureReply({
        stage: 'trade_prebind',
        capability: 'info-analysis-feed',
        reason: error?.message || 'bind_failed'
      });
    }
    if (!hasStrictX402Evidence(infoPayPlan?.paymentIntent)) {
      return buildAgent001FailureReply({
        stage: 'trade_prebind',
        capability: 'info-analysis-feed',
        reason: 'x402 evidence missing after prebind',
        requestId: String(infoPayPlan?.paymentIntent?.requestId || '').trim(),
        txHash: String(infoPayPlan?.paymentIntent?.txHash || '').trim()
      });
    }
    upsertAgent001ResultRecord({
      requestId: infoPayPlan.paymentIntent.requestId,
      capability: 'info-analysis-feed',
      stage: 'prebind',
      status: 'paid',
      toAgentId: infoProvider.toAgentId,
      payer,
      input: infoPayPlan.normalizedTask,
      quote: infoQuote,
      payment: infoPayPlan.paymentIntent,
      receiptRef: {
        requestId: infoPayPlan.paymentIntent.requestId,
        txHash: infoPayPlan.paymentIntent.txHash,
        block: infoPayPlan.paymentIntent.block,
        status: infoPayPlan.paymentIntent.status,
        explorer: infoPayPlan.paymentIntent.explorer,
        verifiedAt: infoPayPlan.paymentIntent.verifiedAt,
        endpoint: `/api/receipt/${infoPayPlan.paymentIntent.requestId}`
      },
      warnings: infoPayPlan.warnings,
      source: 'agent001_trade'
    });
    info = await runAgent001DispatchTask({
      toAgentId: infoProvider.toAgentId,
      capability: 'info-analysis-feed',
      input: infoPayPlan.normalizedTask,
      paymentIntent: infoPayPlan.paymentIntent,
      waitMsLimit
    });
    if (!isAgent001TaskSuccessful(info)) {
      upsertAgent001ResultRecord({
        requestId: infoPayPlan.paymentIntent.requestId,
        capability: 'info-analysis-feed',
        stage: 'dispatch',
        status: 'failed',
        toAgentId: infoProvider.toAgentId,
        payer,
        input: infoPayPlan.normalizedTask,
        quote: infoQuote,
        payment: infoPayPlan.paymentIntent,
        error: info?.error || 'analysis_dispatch_failed',
        reason: info?.reason || info?.taskResult?.error || 'analysis dispatch failed',
        source: 'agent001_trade',
        dm: {
          delivered: false,
          taskId: String(info?.task?.taskId || '').trim(),
          traceId: String(info?.task?.traceId || '').trim(),
          reason: info?.reason || info?.error || ''
        }
      });
      return buildAgent001FailureReply({
        stage: 'trade_dispatch',
        capability: 'info-analysis-feed',
        reason: info?.reason || info?.error || info?.taskResult?.error || 'failed',
        requestId: infoPayPlan.paymentIntent.requestId,
        txHash: infoPayPlan.paymentIntent.txHash
      });
    }
    const infoPayment = info?.taskResult?.payment || infoPayPlan?.paymentIntent || null;
    if (!hasStrictX402Evidence(infoPayment)) {
      upsertAgent001ResultRecord({
        requestId: infoPayPlan.paymentIntent.requestId,
        capability: 'info-analysis-feed',
        stage: 'dispatch',
        status: 'failed',
        toAgentId: infoProvider.toAgentId,
        payer,
        input: infoPayPlan.normalizedTask,
        quote: infoQuote,
        payment: infoPayment || infoPayPlan.paymentIntent,
        error: 'x402_evidence_missing',
        reason: 'task-result missing strict x402 evidence',
        source: 'agent001_trade',
        dm: {
          delivered: false,
          taskId: String(info?.task?.taskId || '').trim(),
          traceId: String(info?.task?.traceId || '').trim(),
          reason: 'x402_evidence_missing'
        }
      });
      return buildAgent001FailureReply({
        stage: 'trade_dispatch',
        capability: 'info-analysis-feed',
        reason: 'task-result missing strict x402 evidence',
        requestId: String(infoPayPlan?.paymentIntent?.requestId || '').trim(),
        txHash: String(infoPayPlan?.paymentIntent?.txHash || '').trim()
      });
    }
    const infoProgressDm = await maybeSendAgent001ProgressDm({
      context,
      capability: 'info-analysis-feed',
      summary: String(info?.taskResult?.result?.summary || '').trim(),
      payment: infoPayment
    });
    upsertAgent001ResultRecord({
      requestId: infoPayment.requestId,
      capability: 'info-analysis-feed',
      stage: 'dispatch',
      status: 'done',
      toAgentId: infoProvider.toAgentId,
      payer,
      input: infoPayPlan.normalizedTask,
      quote: infoQuote,
      payment: infoPayment,
      receiptRef: buildTaskReceiptRef(infoPayment),
      result: info?.taskResult?.result || null,
      source: 'agent001_trade',
      dm: {
        delivered: Boolean(infoProgressDm?.ok),
        taskId: String(info?.task?.taskId || '').trim(),
        traceId: String(info?.task?.traceId || '').trim(),
        reason: String(infoProgressDm?.reason || '').trim()
      }
    });

    let technicalPayPlan = null;
    let technical = null;
    const technicalQuote = technicalQuoteTask?.taskResult?.result?.quote || null;
    try {
      technicalPayPlan = await buildAgent001StrictPaymentPlan({
        capability: 'technical-analysis-feed',
        rawText,
        intent,
        payer,
        targetAgentId: technicalProvider.toAgentId
      });
    } catch (error) {
      return buildAgent001FailureReply({
        stage: 'trade_prebind',
        capability: 'technical-analysis-feed',
        reason: error?.message || 'bind_failed'
      });
    }
    if (!hasStrictX402Evidence(technicalPayPlan?.paymentIntent)) {
      return buildAgent001FailureReply({
        stage: 'trade_prebind',
        capability: 'technical-analysis-feed',
        reason: 'x402 evidence missing after prebind',
        requestId: String(technicalPayPlan?.paymentIntent?.requestId || '').trim(),
        txHash: String(technicalPayPlan?.paymentIntent?.txHash || '').trim()
      });
    }
    upsertAgent001ResultRecord({
      requestId: technicalPayPlan.paymentIntent.requestId,
      capability: 'technical-analysis-feed',
      stage: 'prebind',
      status: 'paid',
      toAgentId: technicalProvider.toAgentId,
      payer,
      input: technicalPayPlan.normalizedTask,
      quote: technicalQuote,
      payment: technicalPayPlan.paymentIntent,
      receiptRef: {
        requestId: technicalPayPlan.paymentIntent.requestId,
        txHash: technicalPayPlan.paymentIntent.txHash,
        block: technicalPayPlan.paymentIntent.block,
        status: technicalPayPlan.paymentIntent.status,
        explorer: technicalPayPlan.paymentIntent.explorer,
        verifiedAt: technicalPayPlan.paymentIntent.verifiedAt,
        endpoint: `/api/receipt/${technicalPayPlan.paymentIntent.requestId}`
      },
      warnings: technicalPayPlan.warnings,
      source: 'agent001_trade'
    });
    technical = await runAgent001DispatchTask({
      toAgentId: technicalProvider.toAgentId,
      capability: 'technical-analysis-feed',
      input: technicalPayPlan.normalizedTask,
      paymentIntent: technicalPayPlan.paymentIntent,
      waitMsLimit
    });
    if (!isAgent001TaskSuccessful(technical)) {
      upsertAgent001ResultRecord({
        requestId: technicalPayPlan.paymentIntent.requestId,
        capability: 'technical-analysis-feed',
        stage: 'dispatch',
        status: 'failed',
        toAgentId: technicalProvider.toAgentId,
        payer,
        input: technicalPayPlan.normalizedTask,
        quote: technicalQuote,
        payment: technicalPayPlan.paymentIntent,
        error: technical?.error || 'analysis_dispatch_failed',
        reason: technical?.reason || technical?.taskResult?.error || 'analysis dispatch failed',
        source: 'agent001_trade',
        dm: {
          delivered: false,
          taskId: String(technical?.task?.taskId || '').trim(),
          traceId: String(technical?.task?.traceId || '').trim(),
          reason: technical?.reason || technical?.error || ''
        }
      });
      return buildAgent001FailureReply({
        stage: 'trade_dispatch',
        capability: 'technical-analysis-feed',
        reason: technical?.reason || technical?.error || technical?.taskResult?.error || 'failed',
        requestId: technicalPayPlan.paymentIntent.requestId,
        txHash: technicalPayPlan.paymentIntent.txHash
      });
    }
    const technicalPayment = technical?.taskResult?.payment || technicalPayPlan?.paymentIntent || null;
    if (!hasStrictX402Evidence(technicalPayment)) {
      upsertAgent001ResultRecord({
        requestId: technicalPayPlan.paymentIntent.requestId,
        capability: 'technical-analysis-feed',
        stage: 'dispatch',
        status: 'failed',
        toAgentId: technicalProvider.toAgentId,
        payer,
        input: technicalPayPlan.normalizedTask,
        quote: technicalQuote,
        payment: technicalPayment || technicalPayPlan.paymentIntent,
        error: 'x402_evidence_missing',
        reason: 'task-result missing strict x402 evidence',
        source: 'agent001_trade',
        dm: {
          delivered: false,
          taskId: String(technical?.task?.taskId || '').trim(),
          traceId: String(technical?.task?.traceId || '').trim(),
          reason: 'x402_evidence_missing'
        }
      });
      return buildAgent001FailureReply({
        stage: 'trade_dispatch',
        capability: 'technical-analysis-feed',
        reason: 'task-result missing strict x402 evidence',
        requestId: String(technicalPayPlan?.paymentIntent?.requestId || '').trim(),
        txHash: String(technicalPayPlan?.paymentIntent?.txHash || '').trim()
      });
    }
    const technicalProgressDm = await maybeSendAgent001ProgressDm({
      context,
      capability: 'technical-analysis-feed',
      summary: String(technical?.taskResult?.result?.summary || '').trim(),
      payment: technicalPayment
    });
    upsertAgent001ResultRecord({
      requestId: technicalPayment.requestId,
      capability: 'technical-analysis-feed',
      stage: 'dispatch',
      status: 'done',
      toAgentId: technicalProvider.toAgentId,
      payer,
      input: technicalPayPlan.normalizedTask,
      quote: technicalQuote,
      payment: technicalPayment,
      receiptRef: buildTaskReceiptRef(technicalPayment),
      result: technical?.taskResult?.result || null,
      source: 'agent001_trade',
      dm: {
        delivered: Boolean(technicalProgressDm?.ok),
        taskId: String(technical?.task?.taskId || '').trim(),
        traceId: String(technical?.task?.traceId || '').trim(),
        reason: String(technicalProgressDm?.reason || '').trim()
      }
    });

    const tradePlan = buildAgent001TradePlan({
      rawText,
      intent,
      technical,
      info,
      returnObject: true
    });
    const forceOrderRequested = isAgent001ForceOrderRequested(rawText) || orderDirectives.forceExecute;
    const explicitOrderRequested = orderDirectives.explicitOrder;
    const shouldCoercePlan = forceOrderRequested || explicitOrderRequested;
    const effectiveTradePlan =
      shouldCoercePlan
        ? coerceAgent001ForcedTradePlan({ rawText, tradePlan, technical, info, directives: orderDirectives })
        : tradePlan;
    const lines = [
      String(effectiveTradePlan?.text || '').trim() || '交易计划生成失败。',
      '',
      '报价协商:',
      `technical: ${technicalQuote?.serviceId || '-'} @ ${technicalQuote?.price || '-'} | SLA ${technicalQuote?.slaMs || '-'}ms`,
      `message: ${infoQuote?.serviceId || '-'} @ ${infoQuote?.price || '-'} | SLA ${infoQuote?.slaMs || '-'}ms`,
      '',
      '分析段 x402 证据:',
      `technical requestId: ${String(technicalPayment?.requestId || '').trim() || '-'}`,
      `technical txHash: ${String(technicalPayment?.txHash || '').trim() || '-'}`,
      `message requestId: ${String(infoPayment?.requestId || '').trim() || '-'}`,
      `message txHash: ${String(infoPayment?.txHash || '').trim() || '-'}`
    ];

    if (!effectiveTradePlan?.canPlaceOrder) {
      if (String(effectiveTradePlan?.forceOrderReason || '').trim()) {
        lines.push(`执行阻断: ${String(effectiveTradePlan.forceOrderReason).trim()}`);
      }
      lines.push('执行结果: 不满足自动下单条件，本轮不下单。');
      const tradeReply = lines.join('\n');
      await maybeSendAgent001TradePlanDm({
        context,
        tradePlanText: tradeReply,
        infoPayment,
        technicalPayment
      });
      return tradeReply;
    }

    const execution = await appendAgent001OrderExecutionLines({
      lines,
      plan: effectiveTradePlan,
      payer,
      orderDirectives,
      orderTraceId: 'agent001_trade_order',
      stopTraceId: 'agent001_trade_stop',
      failureStage: 'trade_order',
      resultSource: 'agent001_trade'
    });
    if (execution.hardFailureReply) {
      return execution.hardFailureReply;
    }
    const tradeReply = lines.join('\n');
    await maybeSendAgent001TradePlanDm({
      context,
      tradePlanText: tradeReply,
      infoPayment,
      technicalPayment
    });
    return tradeReply;
  }

  const runTechnical = runTrade || intent.intent === 'technical' || intent.intent === 'both';
  const runInfo = runTrade || intent.intent === 'info' || intent.intent === 'both';
  if (!runTechnical && !runInfo && AGENT001_REQUIRE_X402) {
    return '当前已开启强制计费：除 help/status 外均需 x402 支付。请发送技术面或消息面分析请求。';
  }

  let technical = null;
  let info = null;
  let technicalPayPlan = null;
  let infoPayPlan = null;
  let technicalProvider = null;
  let infoProvider = null;
  let technicalQuoteTask = null;
  let infoQuoteTask = null;
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(runtime?.aaWallet || '');

  if ((runTechnical || runInfo) && AGENT001_REQUIRE_X402 && !payer) {
    return '计费模式已开启，但未配置 AA payer。请先同步 Session/AA 钱包后再发起分析。';
  }

  if (AGENT001_REQUIRE_X402) {
    if (runInfo) {
      infoProvider = await selectAgent001ProviderPlan({ capability: 'info-analysis-feed' });
      if (!infoProvider?.ok) {
        return buildAgent001FailureReply({
          stage: 'analysis_quote_discovery',
          capability: 'info-analysis-feed',
          reason: infoProvider?.reason || infoProvider?.error || 'service_unavailable'
        });
      }
      infoQuoteTask = await runAgent001QuoteNegotiation({
        toAgentId: infoProvider.toAgentId,
        wantedCapability: 'info-analysis-feed',
        rawText,
        intent,
        waitMsLimit: 12_000
      });
      if (!isAgent001TaskSuccessful(infoQuoteTask)) {
        return buildAgent001FailureReply({
          stage: 'analysis_quote_negotiation',
          capability: 'info-analysis-feed',
          reason: infoQuoteTask?.reason || infoQuoteTask?.error || 'quote_failed'
        });
      }
    }
    if (runTechnical) {
      technicalProvider = await selectAgent001ProviderPlan({ capability: 'technical-analysis-feed' });
      if (!technicalProvider?.ok) {
        return buildAgent001FailureReply({
          stage: 'analysis_quote_discovery',
          capability: 'technical-analysis-feed',
          reason: technicalProvider?.reason || technicalProvider?.error || 'service_unavailable'
        });
      }
      technicalQuoteTask = await runAgent001QuoteNegotiation({
        toAgentId: technicalProvider.toAgentId,
        wantedCapability: 'technical-analysis-feed',
        rawText,
        intent,
        waitMsLimit: 12_000
      });
      if (!isAgent001TaskSuccessful(technicalQuoteTask)) {
        return buildAgent001FailureReply({
          stage: 'analysis_quote_negotiation',
          capability: 'technical-analysis-feed',
          reason: technicalQuoteTask?.reason || technicalQuoteTask?.error || 'quote_failed'
        });
      }
    }
  }

  if (runInfo) {
    if (AGENT001_REQUIRE_X402) {
      const infoQuote = infoQuoteTask?.taskResult?.result?.quote || null;
      try {
        infoPayPlan = await buildAgent001StrictPaymentPlan({
          capability: 'info-analysis-feed',
          rawText,
          intent,
          payer,
          targetAgentId: infoProvider?.toAgentId || 'message-agent'
        });
      } catch (error) {
        return buildAgent001FailureReply({
          stage: 'analysis_prebind',
          capability: 'info-analysis-feed',
          reason: error?.message || 'bind_failed'
        });
      }
      if (!hasStrictX402Evidence(infoPayPlan?.paymentIntent)) {
        return buildAgent001FailureReply({
          stage: 'analysis_prebind',
          capability: 'info-analysis-feed',
          reason: 'x402 evidence missing after prebind',
          requestId: String(infoPayPlan?.paymentIntent?.requestId || '').trim(),
          txHash: String(infoPayPlan?.paymentIntent?.txHash || '').trim()
        });
      }
      upsertAgent001ResultRecord({
        requestId: infoPayPlan.paymentIntent.requestId,
        capability: 'info-analysis-feed',
        stage: 'prebind',
        status: 'paid',
        toAgentId: infoProvider?.toAgentId || 'message-agent',
        payer,
        input: infoPayPlan.normalizedTask,
        quote: infoQuote,
        payment: infoPayPlan.paymentIntent,
        receiptRef: buildTaskReceiptRef(infoPayPlan.paymentIntent),
        warnings: infoPayPlan.warnings,
        source: 'agent001_analysis'
      });
      info = await runAgent001DispatchTask({
        toAgentId: infoProvider?.toAgentId || 'message-agent',
        capability: 'info-analysis-feed',
        input: infoPayPlan.normalizedTask,
        paymentIntent: infoPayPlan.paymentIntent,
        waitMsLimit
      });
      if (!isAgent001TaskSuccessful(info)) {
        upsertAgent001ResultRecord({
          requestId: infoPayPlan.paymentIntent.requestId,
          capability: 'info-analysis-feed',
          stage: 'dispatch',
          status: 'failed',
          toAgentId: infoProvider?.toAgentId || 'message-agent',
          payer,
          input: infoPayPlan.normalizedTask,
          quote: infoQuote,
          payment: infoPayPlan.paymentIntent,
          error: info?.error || 'analysis_dispatch_failed',
          reason: info?.reason || info?.taskResult?.error || 'analysis dispatch failed',
          source: 'agent001_analysis',
          dm: {
            delivered: false,
            taskId: String(info?.task?.taskId || '').trim(),
            traceId: String(info?.task?.traceId || '').trim(),
            reason: info?.reason || info?.error || ''
          }
        });
        return buildAgent001FailureReply({
          stage: 'analysis_dispatch',
          capability: 'info-analysis-feed',
          reason: info?.reason || info?.error || info?.taskResult?.error || 'failed',
          requestId: infoPayPlan.paymentIntent.requestId,
          txHash: infoPayPlan.paymentIntent.txHash
        });
      }
      const infoPayment = info?.taskResult?.payment || infoPayPlan?.paymentIntent || null;
      if (!hasStrictX402Evidence(infoPayment)) {
        upsertAgent001ResultRecord({
          requestId: infoPayPlan.paymentIntent.requestId,
          capability: 'info-analysis-feed',
          stage: 'dispatch',
          status: 'failed',
          toAgentId: infoProvider?.toAgentId || 'message-agent',
          payer,
          input: infoPayPlan.normalizedTask,
          quote: infoQuote,
          payment: infoPayment || infoPayPlan.paymentIntent,
          error: 'x402_evidence_missing',
          reason: 'task-result missing strict x402 evidence',
          source: 'agent001_analysis',
          dm: {
            delivered: false,
            taskId: String(info?.task?.taskId || '').trim(),
            traceId: String(info?.task?.traceId || '').trim(),
            reason: 'x402_evidence_missing'
          }
        });
        return buildAgent001FailureReply({
          stage: 'analysis_dispatch',
          capability: 'info-analysis-feed',
          reason: 'task-result missing strict x402 evidence',
          requestId: String(infoPayPlan?.paymentIntent?.requestId || '').trim(),
          txHash: String(infoPayPlan?.paymentIntent?.txHash || '').trim()
        });
      }
      const infoProgressDm = await maybeSendAgent001ProgressDm({
        context,
        capability: 'info-analysis-feed',
        summary: String(info?.taskResult?.result?.summary || '').trim(),
        payment: infoPayment
      });
      upsertAgent001ResultRecord({
        requestId: infoPayment.requestId,
        capability: 'info-analysis-feed',
        stage: 'dispatch',
        status: 'done',
        toAgentId: infoProvider?.toAgentId || 'message-agent',
        payer,
        input: infoPayPlan.normalizedTask,
        quote: infoQuote,
        payment: infoPayment,
        receiptRef: buildTaskReceiptRef(infoPayment),
        result: info?.taskResult?.result || null,
        source: 'agent001_analysis',
        dm: {
          delivered: Boolean(infoProgressDm?.ok),
          taskId: String(info?.task?.taskId || '').trim(),
          traceId: String(info?.task?.traceId || '').trim(),
          reason: String(infoProgressDm?.reason || '').trim()
        }
      });
    } else {
      info = await runAgent001DispatchTask({
        toAgentId: 'message-agent',
        capability: 'info-analysis-feed',
        input: {
          url: intent.topic || extractFirstUrlFromText(rawText) || rawText,
          mode: 'news',
          maxChars: 900
        },
        waitMsLimit
      });
    }
  }

  if (runTechnical) {
    if (AGENT001_REQUIRE_X402) {
      const technicalQuote = technicalQuoteTask?.taskResult?.result?.quote || null;
      try {
        technicalPayPlan = await buildAgent001StrictPaymentPlan({
          capability: 'technical-analysis-feed',
          rawText,
          intent,
          payer,
          targetAgentId: technicalProvider?.toAgentId || 'technical-agent'
        });
      } catch (error) {
        return buildAgent001FailureReply({
          stage: 'analysis_prebind',
          capability: 'technical-analysis-feed',
          reason: error?.message || 'bind_failed'
        });
      }
      if (!hasStrictX402Evidence(technicalPayPlan?.paymentIntent)) {
        return buildAgent001FailureReply({
          stage: 'analysis_prebind',
          capability: 'technical-analysis-feed',
          reason: 'x402 evidence missing after prebind',
          requestId: String(technicalPayPlan?.paymentIntent?.requestId || '').trim(),
          txHash: String(technicalPayPlan?.paymentIntent?.txHash || '').trim()
        });
      }
      upsertAgent001ResultRecord({
        requestId: technicalPayPlan.paymentIntent.requestId,
        capability: 'technical-analysis-feed',
        stage: 'prebind',
        status: 'paid',
        toAgentId: technicalProvider?.toAgentId || 'technical-agent',
        payer,
        input: technicalPayPlan.normalizedTask,
        quote: technicalQuote,
        payment: technicalPayPlan.paymentIntent,
        receiptRef: buildTaskReceiptRef(technicalPayPlan.paymentIntent),
        warnings: technicalPayPlan.warnings,
        source: 'agent001_analysis'
      });
      technical = await runAgent001DispatchTask({
        toAgentId: technicalProvider?.toAgentId || 'technical-agent',
        capability: 'technical-analysis-feed',
        input: technicalPayPlan.normalizedTask,
        paymentIntent: technicalPayPlan.paymentIntent,
        waitMsLimit
      });
      if (!isAgent001TaskSuccessful(technical)) {
        upsertAgent001ResultRecord({
          requestId: technicalPayPlan.paymentIntent.requestId,
          capability: 'technical-analysis-feed',
          stage: 'dispatch',
          status: 'failed',
          toAgentId: technicalProvider?.toAgentId || 'technical-agent',
          payer,
          input: technicalPayPlan.normalizedTask,
          quote: technicalQuote,
          payment: technicalPayPlan.paymentIntent,
          error: technical?.error || 'analysis_dispatch_failed',
          reason: technical?.reason || technical?.taskResult?.error || 'analysis dispatch failed',
          source: 'agent001_analysis',
          dm: {
            delivered: false,
            taskId: String(technical?.task?.taskId || '').trim(),
            traceId: String(technical?.task?.traceId || '').trim(),
            reason: technical?.reason || technical?.error || ''
          }
        });
        return buildAgent001FailureReply({
          stage: 'analysis_dispatch',
          capability: 'technical-analysis-feed',
          reason: technical?.reason || technical?.error || technical?.taskResult?.error || 'failed',
          requestId: technicalPayPlan.paymentIntent.requestId,
          txHash: technicalPayPlan.paymentIntent.txHash
        });
      }
      const technicalPayment = technical?.taskResult?.payment || technicalPayPlan?.paymentIntent || null;
      if (!hasStrictX402Evidence(technicalPayment)) {
        upsertAgent001ResultRecord({
          requestId: technicalPayPlan.paymentIntent.requestId,
          capability: 'technical-analysis-feed',
          stage: 'dispatch',
          status: 'failed',
          toAgentId: technicalProvider?.toAgentId || 'technical-agent',
          payer,
          input: technicalPayPlan.normalizedTask,
          quote: technicalQuote,
          payment: technicalPayment || technicalPayPlan.paymentIntent,
          error: 'x402_evidence_missing',
          reason: 'task-result missing strict x402 evidence',
          source: 'agent001_analysis',
          dm: {
            delivered: false,
            taskId: String(technical?.task?.taskId || '').trim(),
            traceId: String(technical?.task?.traceId || '').trim(),
            reason: 'x402_evidence_missing'
          }
        });
        return buildAgent001FailureReply({
          stage: 'analysis_dispatch',
          capability: 'technical-analysis-feed',
          reason: 'task-result missing strict x402 evidence',
          requestId: String(technicalPayPlan?.paymentIntent?.requestId || '').trim(),
          txHash: String(technicalPayPlan?.paymentIntent?.txHash || '').trim()
        });
      }
      const technicalProgressDm = await maybeSendAgent001ProgressDm({
        context,
        capability: 'technical-analysis-feed',
        summary: String(technical?.taskResult?.result?.summary || '').trim(),
        payment: technicalPayment
      });
      upsertAgent001ResultRecord({
        requestId: technicalPayment.requestId,
        capability: 'technical-analysis-feed',
        stage: 'dispatch',
        status: 'done',
        toAgentId: technicalProvider?.toAgentId || 'technical-agent',
        payer,
        input: technicalPayPlan.normalizedTask,
        quote: technicalQuote,
        payment: technicalPayment,
        receiptRef: buildTaskReceiptRef(technicalPayment),
        result: technical?.taskResult?.result || null,
        source: 'agent001_analysis',
        dm: {
          delivered: Boolean(technicalProgressDm?.ok),
          taskId: String(technical?.task?.taskId || '').trim(),
          traceId: String(technical?.task?.traceId || '').trim(),
          reason: String(technicalProgressDm?.reason || '').trim()
        }
      });
    } else {
      technical = await runAgent001DispatchTask({
        toAgentId: 'technical-agent',
        capability: 'technical-analysis-feed',
        input: {
          symbol: intent.symbol || 'BTCUSDT',
          source: intent.source || 'hyperliquid',
          horizonMin: intent.horizonMin || 60
        },
        waitMsLimit
      });
    }
  }

  let technicalResolved = technical;
  let infoResolved = info;
  if (!AGENT001_REQUIRE_X402) {
    const fallbackResolved = await applyAgent001LocalFallback({
      rawText,
      intent,
      runTechnical,
      runInfo,
      technical,
      info
    });
    technicalResolved = fallbackResolved.technical;
    infoResolved = fallbackResolved.info;
  }
  if (runTrade) {
    return buildAgent001TradePlan({
      rawText,
      intent,
      technical: technicalResolved,
      info: infoResolved
    });
  }
  const summary = buildAgent001DispatchSummary({ technical: technicalResolved, info: infoResolved });
  if (!summary) {
    return 'AGENT001 调度完成，但未拿到可读结果。请稍后重试。';
  }
  if (AGENT001_REQUIRE_X402) {
    const lines = [summary];
    if (runInfo) {
      const infoQuote = infoQuoteTask?.taskResult?.result?.quote || null;
      if (infoQuote) {
        lines.push(`消息面 quote: service=${String(infoQuote?.serviceId || '-').trim() || '-'} price=${String(infoQuote?.price || '-').trim() || '-'} slaMs=${Number.isFinite(Number(infoQuote?.slaMs)) ? Number(infoQuote.slaMs) : '-'}`);
      }
    }
    if (runTechnical) {
      const technicalQuote = technicalQuoteTask?.taskResult?.result?.quote || null;
      if (technicalQuote) {
        lines.push(`技术面 quote: service=${String(technicalQuote?.serviceId || '-').trim() || '-'} price=${String(technicalQuote?.price || '-').trim() || '-'} slaMs=${Number.isFinite(Number(technicalQuote?.slaMs)) ? Number(technicalQuote.slaMs) : '-'}`);
      }
    }
    if (runInfo) {
      const infoPayment = info?.taskResult?.payment || infoPayPlan?.paymentIntent || null;
      lines.push(`消息面 x402: requestId=${String(infoPayment?.requestId || '-').trim() || '-'} txHash=${String(infoPayment?.txHash || '-').trim() || '-'}`);
      if (String(infoPayment?.requestId || '').trim()) {
        lines.push(`消息面 pull: /api/agent001/results/${String(infoPayment.requestId).trim()}`);
      }
    }
    if (runTechnical) {
      const technicalPayment = technical?.taskResult?.payment || technicalPayPlan?.paymentIntent || null;
      lines.push(`技术面 x402: requestId=${String(technicalPayment?.requestId || '-').trim() || '-'} txHash=${String(technicalPayment?.txHash || '-').trim() || '-'}`);
      if (String(technicalPayment?.requestId || '').trim()) {
        lines.push(`技术面 pull: /api/agent001/results/${String(technicalPayment.requestId).trim()}`);
      }
    }
    if (runInfo && runTechnical) {
      const tradePlanText = buildAgent001TradePlan({
        rawText,
        intent,
        technical: technicalResolved,
        info: infoResolved
      });
      await maybeSendAgent001TradePlanDm({
        context,
        tradePlanText: String(tradePlanText || '').trim(),
        infoPayment: info?.taskResult?.payment || infoPayPlan?.paymentIntent || null,
        technicalPayment: technical?.taskResult?.payment || technicalPayPlan?.paymentIntent || null
      });
      lines.push('');
      lines.push('AGENT001 交易计划:');
      lines.push(String(tradePlanText || '').trim() || '交易计划生成失败。');
    }
    return lines.join('\n');
  }
  const polished = await maybePolishAgent001Reply(rawText, summary);
  return polished || summary;
}

async function handleRiskRuntimeTaskEnvelope({ envelope = {} } = {}) {
  const capability = String(envelope?.capability || '').trim().toLowerCase();
  const payment = buildTaskPaymentFromIntent(envelope);
  const receiptRef = buildTaskReceiptRef(payment);
  if (capability === 'service-quote') {
    const input = getTaskEnvelopeInput(envelope);
    const wantedCapability = String(input?.wantedCapability || 'technical-analysis-feed').trim().toLowerCase();
    const quote = buildBestServiceQuote({ wantedCapability, preferredAgentId: 'technical-agent' });
    return {
      status: quote ? 'done' : 'failed',
      result: quote
        ? {
            summary: `technical quote ready: ${quote.serviceId} @ ${quote.price}`,
            quote
          }
        : {
            summary: `No quote available for capability ${wantedCapability}.`,
            quote: null
          },
      error: quote ? '' : 'quote_unavailable',
      payment,
      receiptRef
    };
  }
  if (!['risk-score-feed', 'volatility-snapshot', 'technical-analysis-feed'].includes(capability)) {
    return {
      status: 'done',
      result: {
        summary: capability ? `Risk agent acknowledged capability ${capability}.` : 'Risk agent heartbeat ok.'
      },
      payment,
      receiptRef
    };
  }
  const input = getTaskEnvelopeInput(envelope);
  const task = normalizeRiskScoreParams({
    symbol: input.symbol || input.pair || 'BTCUSDT',
    source: input.source || 'hyperliquid',
    horizonMin: input.horizonMin ?? 60
  });
  try {
    const result = await runRiskScoreAnalysis(task);
    return {
      status: 'done',
      result: {
        ...result,
        analysisType: 'technical',
        analysis: result?.technical && typeof result.technical === 'object' ? result.technical : null
      },
      payment,
      receiptRef
    };
  } catch (error) {
    const failure = normalizeTaskFailure(error, 'technical_analysis_failed');
    return {
      status: 'failed',
      error: failure.code,
      result: {
        summary: `technical analysis failed: ${failure.reason}`,
        analysisType: 'technical',
        failure
      },
      payment,
      receiptRef
    };
  }
}

async function handleReaderRuntimeTaskEnvelope({ envelope = {} } = {}) {
  const capability = String(envelope?.capability || '').trim().toLowerCase();
  const payment = buildTaskPaymentFromIntent(envelope);
  const receiptRef = buildTaskReceiptRef(payment);
  if (capability === 'service-quote') {
    const input = getTaskEnvelopeInput(envelope);
    const wantedCapability = String(input?.wantedCapability || 'info-analysis-feed').trim().toLowerCase();
    const quote = buildBestServiceQuote({ wantedCapability, preferredAgentId: 'message-agent' });
    return {
      status: quote ? 'done' : 'failed',
      result: quote
        ? {
            summary: `message quote ready: ${quote.serviceId} @ ${quote.price}`,
            quote
          }
        : {
            summary: `No quote available for capability ${wantedCapability}.`,
            quote: null
          },
      error: quote ? '' : 'quote_unavailable',
      payment,
      receiptRef
    };
  }
  if (!['x-reader-feed', 'url-digest', 'info-analysis-feed'].includes(capability)) {
    return {
      status: 'done',
      result: {
        summary: capability ? `Reader agent acknowledged capability ${capability}.` : 'Reader agent heartbeat ok.'
      },
      payment,
      receiptRef
    };
  }
  const input = getTaskEnvelopeInput(envelope);
  const task = normalizeXReaderParams({
    url: input.url || input.resourceUrl || '',
    topic: input.topic || input.query || input.keyword || '',
    mode: input.mode || input.source || 'auto',
    maxChars: input.maxChars ?? X_READER_MAX_CHARS_DEFAULT
  });
  try {
    const reader = await fetchXReaderDigest(task);
    return {
      status: 'done',
      result: {
        summary:
          String(reader?.analysis?.summary || '').trim() ||
          `info digest ready: ${reader?.title || reader?.url || task.url}`,
        analysisType: 'info',
        info: reader?.analysis || null,
        reader
      },
      payment,
      receiptRef
    };
  } catch (error) {
    const failure = normalizeTaskFailure(error, 'info_analysis_failed');
    return {
      status: 'failed',
      error: failure.code,
      result: {
        summary: `info analysis failed: ${failure.reason}`,
        analysisType: 'info',
        failure
      },
      payment,
      receiptRef
    };
  }
}

async function handlePriceRuntimeTaskEnvelope({ envelope = {} } = {}) {
  const capability = String(envelope?.capability || '').trim().toLowerCase();
  const payment = buildTaskPaymentFromIntent(envelope);
  const receiptRef = buildTaskReceiptRef(payment);
  if (!['btc-price-feed', 'market-quote'].includes(capability)) {
    return {
      status: 'done',
      result: {
        summary: capability ? `Price agent acknowledged capability ${capability}.` : 'Price agent heartbeat ok.'
      },
      payment,
      receiptRef
    };
  }
  const input = getTaskEnvelopeInput(envelope);
  const task = normalizeBtcPriceParams({
    pair: input.pair || input.symbol || 'BTCUSDT',
    source: input.source || 'hyperliquid'
  });
  const quote = await fetchBtcPriceQuote(task);
  return {
    status: 'done',
    result: {
      summary: `BTC ${quote.pair} = $${quote.priceUsd} (${quote.provider})`,
      quote
    },
    payment,
    receiptRef
  };
}

async function handleExecutorRuntimeTaskEnvelope({ envelope = {} } = {}) {
  const capability = String(envelope?.capability || '').trim().toLowerCase();
  const payment = buildTaskPaymentFromIntent(envelope);
  const receiptRef = buildTaskReceiptRef(payment);
  if (!['execute-plan', 'result-aggregation'].includes(capability)) {
    return {
      status: 'done',
      result: {
        summary: capability ? `Executor acknowledged capability ${capability}.` : 'Executor heartbeat ok.'
      },
      payment,
      receiptRef
    };
  }
  const input = getTaskEnvelopeInput(envelope);
  const symbol = String(input.symbol || input.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const source = String(input.source || 'hyperliquid').trim().toLowerCase() || 'hyperliquid';
  const horizonMin = Number.isFinite(Number(input.horizonMin)) ? Math.max(1, Math.round(Number(input.horizonMin))) : 60;
  const includeQuote = input.includeQuote !== false;
  const includeRisk = input.includeRisk !== false;
  const includeReader = input.includeReader === true || Boolean(String(input.url || '').trim());
  const warnings = [];

  let quote = null;
  let risk = null;
  let reader = null;

  if (includeQuote) {
    try {
      quote = await fetchBtcPriceQuote({ pair: symbol, source });
    } catch (error) {
      warnings.push(`quote_failed: ${error?.message || 'unknown'}`);
    }
  }
  if (includeRisk) {
    try {
      risk = await runRiskScoreAnalysis({ symbol, source, horizonMin });
    } catch (error) {
      warnings.push(`risk_failed: ${error?.message || 'unknown'}`);
    }
  }
  if (includeReader) {
    const url = String(input.url || input.resourceUrl || '').trim();
    if (!url) {
      warnings.push('reader_skipped: missing url');
    } else {
      try {
        reader = await fetchXReaderDigest({
          url,
          mode: input.mode || 'auto',
          maxChars: input.maxChars ?? X_READER_MAX_CHARS_DEFAULT
        });
      } catch (error) {
        warnings.push(`reader_failed: ${error?.message || 'unknown'}`);
      }
    }
  }

  const successCount = [quote, risk, reader].filter(Boolean).length;
  const status = successCount > 0 ? 'done' : 'failed';
  return {
    status,
    error: status === 'failed' ? 'executor_plan_failed' : '',
    result: {
      summary:
        status === 'done'
          ? `Executor plan completed (${successCount} result${successCount > 1 ? 's' : ''}).`
          : 'Executor plan failed (no successful result).',
      plan: {
        symbol,
        source,
        horizonMin,
        includeQuote,
        includeRisk,
        includeReader
      },
      quote,
      risk,
      reader,
      warnings
    },
    payment,
    receiptRef
  };
}

const xmtpRuntime = createXmtpAgentRuntime({
  enabled: XMTP_ROUTER_RUNTIME_ENABLED,
  runtimeName: 'router-runtime',
  agentId: 'router-agent',
  walletKey: ROUTER_WALLET_KEY_NORMALIZED,
  env: XMTP_ENV,
  apiUrl: XMTP_API_URL,
  historySyncUrl: XMTP_HISTORY_SYNC_URL,
  gatewayHost: XMTP_GATEWAY_HOST,
  dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
  dbDirectory: XMTP_ROUTER_DB_DIRECTORY,
  autoAck: true,
  eventRetention: XMTP_EVENT_RETENTION,
  readEvents: readXmtpEvents,
  writeEvents: writeXmtpEvents,
  resolveAgentById: findNetworkAgentById,
  handleTextMessage: handleRouterRuntimeTextMessage
});

const xmtpRiskRuntime = createXmtpAgentRuntime({
  enabled: XMTP_RISK_RUNTIME_ENABLED,
  runtimeName: 'risk-runtime',
  agentId: 'risk-agent',
  walletKey: RISK_WALLET_KEY_NORMALIZED,
  env: XMTP_ENV,
  apiUrl: XMTP_API_URL,
  historySyncUrl: XMTP_HISTORY_SYNC_URL,
  gatewayHost: XMTP_GATEWAY_HOST,
  dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
  dbDirectory: XMTP_RISK_DB_DIRECTORY,
  autoAck: true,
  eventRetention: XMTP_EVENT_RETENTION,
  readEvents: readXmtpEvents,
  writeEvents: writeXmtpEvents,
  resolveAgentById: findNetworkAgentById,
  handleTaskEnvelope: handleRiskRuntimeTaskEnvelope
});

const xmtpReaderRuntime = createXmtpAgentRuntime({
  enabled: XMTP_READER_RUNTIME_ENABLED,
  runtimeName: 'reader-runtime',
  agentId: 'reader-agent',
  walletKey: READER_WALLET_KEY_NORMALIZED,
  env: XMTP_ENV,
  apiUrl: XMTP_API_URL,
  historySyncUrl: XMTP_HISTORY_SYNC_URL,
  gatewayHost: XMTP_GATEWAY_HOST,
  dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
  dbDirectory: XMTP_READER_DB_DIRECTORY,
  autoAck: true,
  eventRetention: XMTP_EVENT_RETENTION,
  readEvents: readXmtpEvents,
  writeEvents: writeXmtpEvents,
  resolveAgentById: findNetworkAgentById,
  handleTaskEnvelope: handleReaderRuntimeTaskEnvelope
});

const xmtpPriceRuntime = createXmtpAgentRuntime({
  enabled: XMTP_PRICE_RUNTIME_ENABLED,
  runtimeName: 'price-runtime',
  agentId: 'price-agent',
  walletKey: PRICE_WALLET_KEY_NORMALIZED,
  env: XMTP_ENV,
  apiUrl: XMTP_API_URL,
  historySyncUrl: XMTP_HISTORY_SYNC_URL,
  gatewayHost: XMTP_GATEWAY_HOST,
  dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
  dbDirectory: XMTP_PRICE_DB_DIRECTORY,
  autoAck: true,
  eventRetention: XMTP_EVENT_RETENTION,
  readEvents: readXmtpEvents,
  writeEvents: writeXmtpEvents,
  resolveAgentById: findNetworkAgentById,
  handleTaskEnvelope: handlePriceRuntimeTaskEnvelope
});

const xmtpExecutorRuntime = createXmtpAgentRuntime({
  enabled: XMTP_EXECUTOR_RUNTIME_ENABLED,
  runtimeName: 'executor-runtime',
  agentId: 'executor-agent',
  walletKey: EXECUTOR_WALLET_KEY_NORMALIZED,
  env: XMTP_ENV,
  apiUrl: XMTP_API_URL,
  historySyncUrl: XMTP_HISTORY_SYNC_URL,
  gatewayHost: XMTP_GATEWAY_HOST,
  dbEncryptionKey: XMTP_DB_ENCRYPTION_KEY,
  dbDirectory: XMTP_EXECUTOR_DB_DIRECTORY,
  autoAck: true,
  eventRetention: XMTP_EVENT_RETENTION,
  readEvents: readXmtpEvents,
  writeEvents: writeXmtpEvents,
  resolveAgentById: findNetworkAgentById,
  handleTaskEnvelope: handleExecutorRuntimeTaskEnvelope
});

function getAllXmtpRuntimeStatuses() {
  return {
    router: xmtpRuntime.getStatus(),
    risk: xmtpRiskRuntime.getStatus(),
    reader: xmtpReaderRuntime.getStatus(),
    price: xmtpPriceRuntime.getStatus(),
    executor: xmtpExecutorRuntime.getStatus()
  };
}

async function startXmtpRuntimes() {
  const router = await xmtpRuntime.start();
  let risk = xmtpRiskRuntime.getStatus();
  if (XMTP_RISK_RUNTIME_ENABLED) {
    risk = await xmtpRiskRuntime.start();
  }
  let reader = xmtpReaderRuntime.getStatus();
  if (XMTP_READER_RUNTIME_ENABLED) {
    reader = await xmtpReaderRuntime.start();
  }
  let price = xmtpPriceRuntime.getStatus();
  if (XMTP_PRICE_RUNTIME_ENABLED) {
    price = await xmtpPriceRuntime.start();
  }
  let executor = xmtpExecutorRuntime.getStatus();
  if (XMTP_EXECUTOR_RUNTIME_ENABLED) {
    executor = await xmtpExecutorRuntime.start();
  }
  return { router, risk, reader, price, executor };
}

async function stopXmtpRuntimes() {
  const router = await xmtpRuntime.stop();
  const risk = await xmtpRiskRuntime.stop();
  const reader = await xmtpReaderRuntime.stop();
  const price = await xmtpPriceRuntime.stop();
  const executor = await xmtpExecutorRuntime.stop();
  return { router, risk, reader, price, executor };
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
          symbol: 'string (BTC/ETH, e.g. BTCUSDT/ETHUSDT/BTCUSD/ETHUSD)',
          horizonMin: 'number 5-240',
          source: 'hyperliquid (fallback: binance, okx)'
        },
        price: X402_RISK_SCORE_PRICE,
        recipient: resolveTechnicalSettlementRecipient()
      },
      {
        id: 'technical-analysis-feed',
        input: {
          symbol: 'string (BTC/ETH, e.g. BTCUSDT/ETHUSDT/BTCUSD/ETHUSD)',
          horizonMin: 'number 5-240',
          source: 'hyperliquid (fallback: binance, okx)'
        },
        price: X402_TECHNICAL_PRICE,
        recipient: resolveTechnicalSettlementRecipient()
      },
      {
        id: 'info-analysis-feed',
        input: {
          topic: 'string (keyword/topic text) OR url',
          mode: 'auto/market-data',
          maxChars: 'number 200-8000'
        },
        price: X402_INFO_PRICE,
        recipient: resolveInfoSettlementRecipient()
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
      },
      {
        id: 'hyperliquid-order-testnet',
        input: {
          symbol: 'string (default BTCUSDT)',
          side: 'buy/sell',
          orderType: 'limit/market',
          size: 'number > 0',
          price: 'number > 0 (required for limit)',
          tif: 'Gtc/Ioc/Alo'
        },
        price: X402_HYPERLIQUID_ORDER_PRICE,
        recipient: HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS
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

function sha256HexFromUtf8(input = '') {
  return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

function digestStableObject(value) {
  const canonical = stableSerialize(value);
  return {
    algorithm: 'sha256',
    canonicalization: 'stableSerialize',
    value: sha256HexFromUtf8(canonical)
  };
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

async function awaitWithTimeout(promise, timeoutMs = 30_000, label = 'operation') {
  const ms = Math.max(1_000, Math.min(Number(timeoutMs) || 30_000, 300_000));
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const sessionUserOpQueue = new Map();

async function withSessionUserOpLock(lockKey = '', task = async () => null) {
  const key = String(lockKey || 'default').trim().toLowerCase() || 'default';
  const slot = sessionUserOpQueue.get(key) || { tail: Promise.resolve(), gate: null };
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = slot.tail
    .catch(() => {})
    .then(() => gate);
  sessionUserOpQueue.set(key, { tail, gate });
  await slot.tail.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    const current = sessionUserOpQueue.get(key);
    if (current && current.gate === gate) {
      sessionUserOpQueue.delete(key);
    }
  }
}

function isTransientTransportError(reason = '') {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('und_err_socket') ||
    text.includes('und_err_connect_timeout') ||
    text.includes('timeout') ||
    text.includes('socket hang up') ||
    text.includes('network') ||
    text.includes('tls') ||
    text.includes('secure tls connection') ||
    text.includes('bad gateway') ||
    text.includes('gateway timeout') ||
    text.includes('service unavailable') ||
    text.includes('http 502') ||
    text.includes('http 503') ||
    text.includes('http 504')
  );
}

function isUserOpReplacementFeeError(reason = '') {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes('cannot be replaced') ||
    text.includes('fee too low') ||
    text.includes('replacement underpriced') ||
    text.includes('replacement fee too low')
  );
}

function extractUserOpHashFromReason(reason = '') {
  const text = String(reason || '').trim();
  if (!text) return '';
  const matched = text.match(/0x[a-fA-F0-9]{64}/);
  return matched ? matched[0] : '';
}

function shouldFallbackToEoaRelay(reason = '') {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes('eth_estimateuseroperationgas') ||
    text.includes('execution reverted') ||
    text.includes('timeout waiting for useroperation') ||
    text.includes('aa24') ||
    text.includes('sig_validation_failed')
  );
}

async function sendSessionTransferViaEoaRelay({
  provider,
  aaWallet,
  sessionId,
  authPayload,
  authSignature,
  serviceProvider,
  metadata
} = {}) {
  if (!backendSigner) {
    return { ok: false, reason: 'backend_signer_unavailable_for_eoa_relay' };
  }
  try {
    const signer = backendSigner.provider ? backendSigner : backendSigner.connect(provider);
    const relaySender = await signer.getAddress();
    const relayGas = await provider.getBalance(relaySender);
    if (relayGas <= 0n) {
      return { ok: false, reason: `backend_signer_insufficient_kite_gas:${relaySender}` };
    }
    const writeAbi = [
      'function executeTransferWithAuthorizationAndProvider(bytes32 sessionId, tuple(address from,address to,address token,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce) auth, bytes signature, bytes32 serviceProvider, bytes metadata) external'
    ];
    const account = new ethers.Contract(aaWallet, writeAbi, signer);
    const tx = await account.executeTransferWithAuthorizationAndProvider(
      sessionId,
      authPayload,
      authSignature,
      serviceProvider,
      metadata
    );
    const receipt = await tx.wait();
    if (!receipt || Number(receipt.status || 0) !== 1) {
      return {
        ok: false,
        reason: 'eoa_relay_transaction_failed',
        txHash: tx?.hash || ''
      };
    }
    return {
      ok: true,
      txHash: tx.hash,
      blockNumber: Number(receipt.blockNumber || 0),
      relaySender
    };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message || 'eoa_relay_failed').trim()
    };
  }
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

app.get('/api/session/pay/config', requireRole('viewer'), (req, res) => {
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    config: sessionPayConfigSnapshot()
  });
});

app.get('/api/session/pay/metrics', requireRole('viewer'), (req, res) => {
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    metrics: {
      startedAt: sessionPayMetrics.startedAt,
      totalRequests: sessionPayMetrics.totalRequests,
      totalSuccess: sessionPayMetrics.totalSuccess,
      totalFailed: sessionPayMetrics.totalFailed,
      totalRetryAttempts: sessionPayMetrics.totalRetryAttempts,
      totalRetriesUsed: sessionPayMetrics.totalRetriesUsed,
      totalFallbackAttempted: sessionPayMetrics.totalFallbackAttempted,
      totalFallbackSucceeded: sessionPayMetrics.totalFallbackSucceeded,
      failureRate:
        sessionPayMetrics.totalRequests > 0
          ? Number((sessionPayMetrics.totalFailed / sessionPayMetrics.totalRequests).toFixed(4))
          : 0,
      failuresByCategory: sessionPayMetrics.failuresByCategory,
      retriesByCategory: sessionPayMetrics.retriesByCategory,
      recentFailures: sessionPayMetrics.recentFailures
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
        { maxAttempts: 5, timeoutMs: 210_000 }
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
        { maxAttempts: 5, timeoutMs: 210_000 }
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
  const prebindOnly = parseBooleanFlag(req.body?.prebindOnly, false);
  const requestedAction = String(req.body?.action || 'risk-score-feed').trim().toLowerCase();
  const workflowAction = requestedAction === 'technical-analysis-feed' ? 'technical-analysis-feed' : 'risk-score-feed';
  const workflowActionCfg = getActionConfig(workflowAction) || getActionConfig('risk-score-feed');
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
      action: workflowAction,
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
          action: workflowAction,
          query: `A2A risk-score ${normalizedTask.symbol} horizon=${normalizedTask.horizonMin} source=${normalizedTask.source}`
        },
        { maxAttempts: 5, timeoutMs: 210_000 }
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
      action: workflowAction,
      prebindOnly,
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
      prebindOnly,
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
                action: workflowAction,
                query: `A2A risk-score ${workflow?.input?.symbol || 'BTCUSDT'} horizon=${workflow?.input?.horizonMin || 60}`.trim(),
                payer: workflow.payer || '',
                amount: String(workflowActionCfg?.amount || X402_RISK_SCORE_PRICE || ''),
                tokenAddress: SETTLEMENT_TOKEN,
                recipient: String(workflowActionCfg?.recipient || resolveTechnicalSettlementRecipient()).trim(),
                paymentTxHash: workflow.txHash || '',
                a2a: {
                  sourceAgentId: workflow.sourceAgentId,
                  targetAgentId: workflow.targetAgentId,
                  taskType: workflowAction,
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

app.post('/api/workflow/info/run', requireRole('agent'), async (req, res) => {
  let normalizedTask = null;
  try {
    normalizedTask = normalizeXReaderParams({
      url: req.body?.url || req.body?.resourceUrl || req.body?.targetUrl,
      topic: req.body?.topic || req.body?.query || req.body?.keyword,
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
  const prebindOnly = parseBooleanFlag(req.body?.prebindOnly, false);
  const workflowAction = 'info-analysis-feed';
  const workflowActionCfg = getActionConfig(workflowAction) || getActionConfig('info-analysis-feed');
  const traceId = resolveWorkflowTraceId(req.body?.traceId);
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
  const workflow = {
    traceId,
    type: 'info-analysis',
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
      action: workflowAction,
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
          action: workflowAction,
          query: `ATAPI x-reader ${normalizedTask.url}`
        },
        { maxAttempts: 5, timeoutMs: 210_000 }
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
      action: workflowAction,
      prebindOnly,
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
      prebindOnly,
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
                action: workflowAction,
                query: `ATAPI x-reader ${workflow?.input?.url || ''}`.trim(),
                payer: workflow.payer || '',
                amount: String(workflowActionCfg?.amount || X402_X_READER_PRICE || ''),
                tokenAddress: SETTLEMENT_TOKEN,
                recipient: String(workflowActionCfg?.recipient || resolveInfoSettlementRecipient()).trim(),
                paymentTxHash: workflow.txHash || '',
                a2a: {
                  sourceAgentId: workflow.sourceAgentId,
                  targetAgentId: workflow.targetAgentId,
                  taskType: workflowAction,
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

app.post('/api/workflow/hyperliquid-order/run', requireRole('agent'), async (req, res) => {
  const symbol = String(req.body?.symbol || req.body?.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const side = String(req.body?.side || '').trim().toLowerCase();
  const orderType = String(req.body?.orderType || req.body?.type || 'limit').trim().toLowerCase() || 'limit';
  const tif = String(req.body?.tif || 'Gtc').trim() || 'Gtc';
  const size = Number(req.body?.size ?? req.body?.sz ?? NaN);
  const price = Number(req.body?.price ?? NaN);
  const reduceOnly = req.body?.reduceOnly === true || String(req.body?.reduceOnly || '').trim().toLowerCase() === 'true';
  const sourceAgentId = String(req.body?.sourceAgentId || 'router-agent').trim();
  const targetAgentId = String(req.body?.targetAgentId || 'executor-agent').trim();
  const traceId = resolveWorkflowTraceId(req.body?.traceId);
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(req.body?.payer || runtime.aaWallet || '');
  const tokenAddress = normalizeAddress(req.body?.tokenAddress || SETTLEMENT_TOKEN);
  const recipient = normalizeAddress(req.body?.recipient || HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS);
  const amount = String(req.body?.amount || X402_HYPERLIQUID_ORDER_PRICE).trim();
  const bindRealX402 = parseBooleanFlag(req.body?.bindRealX402, true);
  const strictBinding = parseBooleanFlag(req.body?.strictBinding, true);
  const simulate = req.body?.simulate === true || req.body?.dryRun === true;

  if (!['buy', 'sell'].includes(side)) {
    return res.status(400).json({ ok: false, error: 'invalid_side', reason: 'side must be buy/sell' });
  }
  if (!['limit', 'market'].includes(orderType)) {
    return res.status(400).json({ ok: false, error: 'invalid_order_type', reason: 'orderType must be limit/market' });
  }
  if (!Number.isFinite(size) || size <= 0) {
    return res.status(400).json({ ok: false, error: 'invalid_size', reason: 'size must be a positive number' });
  }
  if (orderType === 'limit' && (!Number.isFinite(price) || price <= 0)) {
    return res.status(400).json({ ok: false, error: 'invalid_price', reason: 'limit order requires positive price' });
  }
  if (!tokenAddress || !recipient) {
    return res.status(400).json({ ok: false, error: 'invalid_settlement_target', reason: 'tokenAddress/recipient invalid' });
  }
  if (!bindRealX402 || !strictBinding) {
    return res.status(400).json({
      ok: false,
      error: 'x402_strict_required',
      reason: 'hyperliquid-order workflow requires bindRealX402=true and strictBinding=true.'
    });
  }

  const workflow = {
    traceId,
    type: 'hyperliquid-order',
    state: 'running',
    sourceAgentId,
    targetAgentId,
    payer,
    input: {
      symbol,
      side,
      orderType,
      tif,
      size,
      price: Number.isFinite(price) ? price : null,
      reduceOnly,
      simulate
    },
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
    const challengeResp = await fetch(`http://127.0.0.1:${PORT}/api/x402/transfer-intent`, {
      method: 'POST',
      headers: buildInternalAgentHeaders(),
      body: JSON.stringify({
        payer,
        recipient,
        amount,
        tokenAddress,
        action: 'hyperliquid-order-testnet',
        query: `ATAPI hyperliquid order ${symbol} ${side} ${orderType} size=${size}`,
        identity: req.body?.identity && typeof req.body.identity === 'object' ? req.body.identity : {}
      })
    });
    const challengeBody = await challengeResp.json().catch(() => ({}));
    if (challengeResp.status !== 402) {
      throw new Error(
        challengeBody?.reason || challengeBody?.error || `Expected 402 challenge, got ${challengeResp.status}`
      );
    }
    const challenge = challengeBody?.x402;
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

    const pay = await postSessionPayWithRetry(
      {
        tokenAddress: accept.tokenAddress,
        recipient: accept.recipient,
        amount: accept.amount,
        requestId,
        action: 'hyperliquid-order-testnet',
        query: `ATAPI hyperliquid order ${symbol} ${side} ${orderType} size=${size}`
      },
      { maxAttempts: 5, timeoutMs: 210_000 }
    );
    const payBody = pay.body || {};
    const txHash = String(payBody?.payment?.txHash || '').trim();
    const userOpHash = String(payBody?.payment?.userOpHash || '').trim();
    if (!txHash) throw new Error('session pay returned empty txHash.');
    workflow.txHash = txHash;
    workflow.userOpHash = userOpHash;
    appendWorkflowStep(workflow, 'payment_sent', 'ok', { txHash, userOpHash });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const proofResp = await fetch(`http://127.0.0.1:${PORT}/api/x402/transfer-intent`, {
      method: 'POST',
      headers: buildInternalAgentHeaders(),
      body: JSON.stringify({
        requestId,
        paymentProof: {
          requestId,
          txHash,
          payer,
          tokenAddress: accept.tokenAddress,
          recipient: accept.recipient,
          amount: accept.amount
        }
      })
    });
    const proofBody = await proofResp.json().catch(() => ({}));
    if (!proofResp.ok || proofBody?.ok === false) {
      throw new Error(proofBody?.reason || proofBody?.error || `proof submit failed: ${proofResp.status}`);
    }
    appendWorkflowStep(workflow, 'proof_submitted', 'ok', { verified: true });
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);

    const orderResult = await hyperliquidAdapter.placePerpOrder({
      symbol,
      side,
      orderType,
      size,
      ...(orderType === 'limit' ? { price } : {}),
      tif,
      reduceOnly,
      simulate
    });
    appendWorkflowStep(workflow, 'unlocked', 'ok', {
      result: `Hyperliquid ${orderType} ${side} ${symbol} executed`
    });
    workflow.state = 'unlocked';
    workflow.result = {
      summary: `Hyperliquid ${orderType} ${side} ${symbol} executed`,
      order: orderResult
    };
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);
    const evidence = resolveX402EvidenceByRequestId(requestId);
    return res.json({
      ok: true,
      traceId,
      requestId,
      txHash,
      userOpHash,
      state: workflow.state,
      workflow,
      payment: evidence
        ? {
            mode: 'x402',
            requestId: evidence.requestId,
            txHash: evidence.txHash,
            block: evidence.block,
            status: evidence.status,
            explorer: evidence.explorer,
            verifiedAt: evidence.verifiedAt
          }
        : null,
      receiptRef: evidence?.receiptRef || null,
      orderResult
    });
  } catch (error) {
    appendWorkflowStep(workflow, 'failed', 'error', { reason: error.message });
    workflow.state = 'failed';
    workflow.error = error.message;
    workflow.updatedAt = new Date().toISOString();
    upsertWorkflow(workflow);
    const evidence = workflow.requestId ? resolveX402EvidenceByRequestId(workflow.requestId) : null;
    return res.status(500).json({
      ok: false,
      traceId,
      state: workflow.state,
      error: 'workflow_failed',
      reason: error.message,
      workflow,
      payment: evidence
        ? {
            mode: 'x402',
            requestId: evidence.requestId,
            txHash: evidence.txHash,
            block: evidence.block,
            status: evidence.status,
            explorer: evidence.explorer,
            verifiedAt: evidence.verifiedAt
          }
        : null,
      receiptRef: evidence?.receiptRef || null
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

function parseBooleanFlag(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return Boolean(fallback);
}

function buildInternalAgentHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };
  const key = String(API_KEY_ADMIN || API_KEY_AGENT || API_KEY_VIEWER || '').trim();
  if (key) {
    headers['x-api-key'] = key;
  }
  return headers;
}

async function fetchJsonResponseWithTimeout(
  url,
  { method = 'GET', headers = {}, body = undefined, timeoutMs = 30_000, label = 'request' } = {}
) {
  const resolvedTimeout = Math.max(3_000, Math.min(Number(timeoutMs) || 30_000, 300_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolvedTimeout);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } catch (error) {
    if (String(error?.name || '').trim() === 'AbortError') {
      throw new Error(`${label} timeout after ${resolvedTimeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetryAgent001PrebindReason(reason = '') {
  const text = String(reason || '').trim().toLowerCase();
  if (!text) return false;
  if (shouldRetrySessionPayReason(text)) return true;
  return (
    text.includes('eth_estimateuseroperationgas') ||
    text.includes('reverted') ||
    text.includes('bundler') ||
    text.includes('replacement fee too low') ||
    text.includes('replacement transaction underpriced')
  );
}

async function runAgent001PrebindWorkflowWithRetry({
  endpoint = '',
  payload = {},
  label = 'agent001 prebind'
} = {}) {
  const url = `http://127.0.0.1:${PORT}${String(endpoint || '').trim()}`;
  const maxAttempts = Math.max(1, Math.min(Number(process.env.AGENT001_PREBIND_RETRIES || 5), 5));
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { response, payload: body } = await fetchJsonResponseWithTimeout(url, {
        method: 'POST',
        headers: buildInternalAgentHeaders(),
        timeoutMs: AGENT001_BIND_TIMEOUT_MS,
        label,
        body: JSON.stringify(payload)
      });
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.reason || body?.error || `${label} failed: HTTP ${response.status}`);
      }
      return { body, attempt, attempts: attempt };
    } catch (error) {
      const reason = String(error?.message || 'agent001_prebind_failed').trim();
      const retryable = shouldRetryAgent001PrebindReason(reason);
      lastError = new Error(reason || 'agent001_prebind_failed');
      lastError.attempt = attempt;
      lastError.retryable = retryable;
      if (!retryable || attempt >= maxAttempts) break;
      await waitMs(1200 * attempt);
    }
  }
  throw lastError || new Error('agent001_prebind_failed');
}

function resolveX402EvidenceByRequestId(requestId = '', workflowByRequestId = null) {
  const normalizedRequestId = String(requestId || '').trim();
  if (!normalizedRequestId) return null;
  const reqItem =
    readX402Requests().find((item) => String(item?.requestId || '').trim() === normalizedRequestId) || null;
  if (!reqItem) return null;

  const workflowLookup =
    workflowByRequestId instanceof Map ? workflowByRequestId : buildLatestWorkflowByRequestId(readWorkflows());
  const workflow = workflowLookup.get(normalizedRequestId) || null;
  const txHash = String(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash || '').trim();
  const blockRaw = reqItem?.proofVerification?.details?.blockNumber;
  const block = Number.isFinite(Number(blockRaw)) ? Number(blockRaw) : null;
  const proofStatus =
    reqItem?.proofVerification
      ? 'success'
      : ['failed', 'error', 'expired', 'rejected'].includes(String(reqItem?.status || '').trim().toLowerCase())
        ? 'failed'
        : 'pending';
  const explorer = txHash ? `https://testnet.kitescan.ai/tx/${txHash}` : '';
  const verifiedAtRaw = Number(reqItem?.proofVerification?.verifiedAt || 0);
  const verifiedAt = verifiedAtRaw > 0 ? new Date(verifiedAtRaw).toISOString() : '';
  return {
    mode: reqItem?.proofVerification ? 'x402' : 'mock',
    requestId: normalizedRequestId,
    txHash,
    block,
    status: proofStatus,
    explorer,
    verifiedAt,
    receiptRef: {
      requestId: normalizedRequestId,
      txHash,
      block,
      status: proofStatus,
      explorer,
      verifiedAt,
      endpoint: `/api/receipt/${normalizedRequestId}`
    }
  };
}

function hasStrictX402Evidence(payment = null) {
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return false;
  const requestId = String(payment.requestId || '').trim();
  const txHash = String(payment.txHash || '').trim();
  if (!requestId || !txHash) return false;
  if (txHash.toLowerCase().startsWith('mock_')) return false;
  return true;
}

function resolveAgent001CapabilityByAction(action = '') {
  const normalized = String(action || '').trim().toLowerCase();
  if (normalized === 'risk-score-feed' || normalized === 'technical-analysis-feed') return 'technical-analysis-feed';
  if (normalized === 'x-reader-feed' || normalized === 'info-analysis-feed') return 'info-analysis-feed';
  if (normalized === 'hyperliquid-order-testnet') return 'hyperliquid-order-testnet';
  return '';
}

async function computeAgent001PaidResult({
  capability = '',
  input = {},
  traceId = ''
} = {}) {
  const normalizedCapability = String(capability || '').trim().toLowerCase();
  if (normalizedCapability === 'technical-analysis-feed') {
    const task = normalizeRiskScoreParams({
      symbol: input?.symbol || input?.pair || 'BTCUSDT',
      source: input?.source || 'hyperliquid',
      horizonMin: input?.horizonMin ?? 60
    });
    return runRiskScoreAnalysis({
      ...task,
      traceId
    });
  }
  if (normalizedCapability === 'info-analysis-feed') {
    const task = normalizeXReaderParams({
      url: input?.url || input?.resourceUrl || '',
      topic: input?.topic || input?.query || input?.keyword || '',
      mode: input?.mode || input?.source || 'auto',
      maxChars: input?.maxChars ?? X_READER_MAX_CHARS_DEFAULT
    });
    const info = await runInfoAnalysis({
      ...task,
      traceId
    });
    return {
      summary: String(info?.summary || '').trim(),
      info,
      analysisType: 'info'
    };
  }
  if (normalizedCapability === 'hyperliquid-order-testnet') {
    return {
      summary: 'hyperliquid-order-testnet result is not recomputable; use stored workflow/order result.',
      analysisType: 'order',
      recomputable: false
    };
  }
  throw new Error(`unsupported_agent001_capability:${normalizedCapability || 'unknown'}`);
}

async function resolveAgent001ResultByRequestId(requestId = '') {
  const normalizedRequestId = String(requestId || '').trim();
  if (!normalizedRequestId) {
    return {
      ok: false,
      statusCode: 400,
      error: 'requestId_required',
      reason: 'requestId is required'
    };
  }
  const rows = readAgent001Results();
  const existing =
    rows.find((item) => String(item?.requestId || '').trim() === normalizedRequestId) || null;
  const requests = readX402Requests();
  const reqItem =
    requests.find((item) => String(item?.requestId || '').trim() === normalizedRequestId) || null;
  if (!existing && !reqItem) {
    return {
      ok: false,
      statusCode: 404,
      error: 'agent001_result_not_found',
      reason: 'No AGENT001 paid result record found for requestId.',
      requestId: normalizedRequestId
    };
  }
  const evidence = resolveX402EvidenceByRequestId(normalizedRequestId);
  if (!evidence?.txHash) {
    return {
      ok: false,
      statusCode: 409,
      error: 'payment_not_verified',
      reason: 'x402 payment is not verified yet for this requestId.',
      requestId: normalizedRequestId
    };
  }

  const capability =
    String(existing?.capability || '').trim().toLowerCase() ||
    resolveAgent001CapabilityByAction(reqItem?.action || '');
  if (!capability) {
    return {
      ok: false,
      statusCode: 400,
      error: 'capability_unknown',
      reason: 'Cannot resolve capability by requestId.',
      requestId: normalizedRequestId,
      payment: evidence
    };
  }
  if (
    existing?.result &&
    typeof existing.result === 'object' &&
    !Array.isArray(existing.result) &&
    String(existing?.status || '').trim().toLowerCase() === 'done'
  ) {
    return {
      ok: true,
      requestId: normalizedRequestId,
      capability,
      status: 'done',
      source: 'stored',
      payment: evidence,
      receiptRef: evidence.receiptRef || null,
      result: existing.result,
      dm: existing?.dm || null,
      error: String(existing?.error || '').trim(),
      reason: String(existing?.reason || '').trim()
    };
  }

  const taskInput =
    existing?.input && typeof existing.input === 'object' && !Array.isArray(existing.input)
      ? existing.input
      : reqItem?.actionParams && typeof reqItem.actionParams === 'object' && !Array.isArray(reqItem.actionParams)
        ? reqItem.actionParams
        : {};
  const computed = await computeAgent001PaidResult({
    capability,
    input: taskInput,
    traceId: createTraceId('agent001_pull')
  });
  const saved = upsertAgent001ResultRecord({
    requestId: normalizedRequestId,
    capability,
    status: 'done',
    stage: 'request_pull',
    input: taskInput,
    payment: {
      mode: 'x402',
      requestId: evidence.requestId,
      txHash: evidence.txHash,
      block: evidence.block,
      status: evidence.status,
      explorer: evidence.explorer,
      verifiedAt: evidence.verifiedAt
    },
    receiptRef: evidence.receiptRef || null,
    result: computed,
    source: 'request_pull',
    dm: existing?.dm || null
  });
  return {
    ok: true,
    requestId: normalizedRequestId,
    capability,
    status: 'done',
    source: 'computed',
    payment: evidence,
    receiptRef: evidence.receiptRef || null,
    result: saved?.result || computed,
    dm: saved?.dm || null,
    error: String(saved?.error || '').trim(),
    reason: String(saved?.reason || '').trim()
  };
}

async function buildRiskScorePaymentIntentForTask({
  body = {},
  traceId = '',
  fallbackRequestId = '',
  defaultTask = { symbol: 'BTCUSDT', source: 'hyperliquid', horizonMin: 60 }
} = {}) {
  const inputTask =
    body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
      ? body.input
      : defaultTask;
  const normalizedTask = normalizeRiskScoreParams({
    symbol: inputTask?.symbol || inputTask?.pair || defaultTask.symbol || 'BTCUSDT',
    source: inputTask?.source || defaultTask.source || 'hyperliquid',
    horizonMin: inputTask?.horizonMin ?? defaultTask.horizonMin ?? 60
  });
  const rawIntent =
    body?.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
      ? body.paymentIntent
      : {};
  const bindRealX402 = parseBooleanFlag(body?.bindRealX402, false);
  const strictBinding = parseBooleanFlag(body?.strictBinding, false);
  const prebindOnly = parseBooleanFlag(body?.prebindOnly, AGENT001_PREBIND_ONLY);
  const workflowAction =
    String(body?.action || '').trim().toLowerCase() === 'technical-analysis-feed'
      ? 'technical-analysis-feed'
      : 'risk-score-feed';
  const shouldBindRealX402 =
    bindRealX402 ||
    (String(rawIntent?.mode || '').trim().toLowerCase() === 'x402' &&
      (!String(rawIntent?.requestId || '').trim() || !String(rawIntent?.txHash || '').trim()));

  let paymentIntent = {
    mode: String(rawIntent?.mode || 'mock').trim().toLowerCase() || 'mock',
    requestId: String(rawIntent?.requestId || fallbackRequestId || '').trim(),
    txHash: String(rawIntent?.txHash || '').trim(),
    block: Number.isFinite(Number(rawIntent?.block)) ? Number(rawIntent.block) : null,
    status: String(rawIntent?.status || '').trim().toLowerCase(),
    explorer: String(rawIntent?.explorer || '').trim(),
    verifiedAt: String(rawIntent?.verifiedAt || '').trim()
  };

  const warnings = [];
  let workflowBinding = null;
  if (shouldBindRealX402) {
    try {
      const payload = {
        ...normalizedTask,
        traceId: resolveWorkflowTraceId(body?.paymentTraceId || createTraceId('risk_bind')),
        payer: normalizeAddress(body?.payer || ''),
        sourceAgentId: String(body?.sourceAgentId || KITE_AGENT1_ID).trim(),
        targetAgentId: String(body?.targetAgentId || KITE_AGENT2_ID).trim(),
        action: workflowAction,
        prebindOnly
      };
      const { body: result, attempts } = await runAgent001PrebindWorkflowWithRetry({
        endpoint: '/api/workflow/risk-score/run',
        payload,
        label: 'agent001 risk prebind'
      });
      const boundRequestId = String(result?.requestId || result?.workflow?.requestId || '').trim();
      const evidence = resolveX402EvidenceByRequestId(boundRequestId);
      if (!boundRequestId || !evidence?.txHash) {
        throw new Error('x402 evidence missing after workflow run');
      }
      paymentIntent = {
        mode: 'x402',
        requestId: evidence.requestId,
        txHash: evidence.txHash,
        block: evidence.block,
        status: evidence.status,
        explorer: evidence.explorer,
        verifiedAt: evidence.verifiedAt
      };
      workflowBinding = {
        ok: true,
        traceId: String(result?.traceId || result?.workflow?.traceId || '').trim(),
        requestId: evidence.requestId,
        txHash: evidence.txHash,
        block: evidence.block,
        status: evidence.status,
        explorer: evidence.explorer,
        attempts
      };
    } catch (error) {
      const reason = String(error?.message || 'bind_real_x402_failed').trim();
      warnings.push(reason);
      if (strictBinding) {
        throw new Error(reason);
      }
    }
  } else if (paymentIntent.mode === 'x402' && paymentIntent.requestId) {
    const evidence = resolveX402EvidenceByRequestId(paymentIntent.requestId);
    if (evidence?.txHash) {
      paymentIntent = {
        mode: 'x402',
        requestId: evidence.requestId,
        txHash: evidence.txHash,
        block: evidence.block,
        status: evidence.status,
        explorer: evidence.explorer,
        verifiedAt: evidence.verifiedAt
      };
    }
  }

  if (!paymentIntent.mode) paymentIntent.mode = 'mock';
  if (!paymentIntent.requestId) paymentIntent.requestId = fallbackRequestId;
  if (paymentIntent.mode === 'x402' && !paymentIntent.txHash) {
    warnings.push('x402 evidence unavailable, fallback to mock payment intent');
    paymentIntent.mode = 'mock';
  }
  if (!paymentIntent.txHash && paymentIntent.mode === 'mock') {
    paymentIntent.txHash = `mock_${taskIdSafeToken(traceId || fallbackRequestId || 'risk')}`;
  }

  return {
    paymentIntent,
    normalizedTask,
    workflowBinding,
    warnings
  };
}

async function buildXReaderPaymentIntentForTask({
  body = {},
  traceId = '',
  fallbackRequestId = '',
  defaultTask = {
    url: 'https://newshacker.me/',
    topic: 'btc market sentiment today',
    mode: 'auto',
    maxChars: X_READER_MAX_CHARS_DEFAULT
  }
} = {}) {
  const inputTask =
    body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
      ? body.input
      : defaultTask;
  const normalizedTask = normalizeXReaderParams({
    url: inputTask?.url || inputTask?.resourceUrl || '',
    topic:
      inputTask?.topic ||
      inputTask?.query ||
      inputTask?.keyword ||
      defaultTask.topic ||
      '',
    mode: inputTask?.mode || inputTask?.source || defaultTask.mode || 'auto',
    maxChars: inputTask?.maxChars ?? defaultTask.maxChars ?? X_READER_MAX_CHARS_DEFAULT
  });
  const rawIntent =
    body?.paymentIntent && typeof body.paymentIntent === 'object' && !Array.isArray(body.paymentIntent)
      ? body.paymentIntent
      : {};
  const bindRealX402 = parseBooleanFlag(body?.bindRealX402, false);
  const strictBinding = parseBooleanFlag(body?.strictBinding, false);
  const prebindOnly = parseBooleanFlag(body?.prebindOnly, AGENT001_PREBIND_ONLY);
  const workflowAction =
    String(body?.action || '').trim().toLowerCase() === 'info-analysis-feed'
      ? 'info-analysis-feed'
      : 'info-analysis-feed';
  const shouldBindRealX402 =
    bindRealX402 ||
    (String(rawIntent?.mode || '').trim().toLowerCase() === 'x402' &&
      (!String(rawIntent?.requestId || '').trim() || !String(rawIntent?.txHash || '').trim()));

  let paymentIntent = {
    mode: String(rawIntent?.mode || 'mock').trim().toLowerCase() || 'mock',
    requestId: String(rawIntent?.requestId || fallbackRequestId || '').trim(),
    txHash: String(rawIntent?.txHash || '').trim(),
    block: Number.isFinite(Number(rawIntent?.block)) ? Number(rawIntent.block) : null,
    status: String(rawIntent?.status || '').trim().toLowerCase(),
    explorer: String(rawIntent?.explorer || '').trim(),
    verifiedAt: String(rawIntent?.verifiedAt || '').trim()
  };

  const warnings = [];
  let workflowBinding = null;
  if (shouldBindRealX402) {
    try {
      const payload = {
        ...normalizedTask,
        traceId: resolveWorkflowTraceId(body?.paymentTraceId || createTraceId('reader_bind')),
        payer: normalizeAddress(body?.payer || ''),
        sourceAgentId: String(body?.sourceAgentId || KITE_AGENT1_ID).trim(),
        targetAgentId: String(body?.targetAgentId || KITE_AGENT2_ID).trim(),
        action: workflowAction,
        prebindOnly
      };
      const { body: result, attempts } = await runAgent001PrebindWorkflowWithRetry({
        endpoint: '/api/workflow/info/run',
        payload,
        label: 'agent001 info prebind'
      });
      const boundRequestId = String(result?.requestId || result?.workflow?.requestId || '').trim();
      const evidence = resolveX402EvidenceByRequestId(boundRequestId);
      if (!boundRequestId || !evidence?.txHash) {
        throw new Error('x402 evidence missing after workflow run');
      }
      paymentIntent = {
        mode: 'x402',
        requestId: evidence.requestId,
        txHash: evidence.txHash,
        block: evidence.block,
        status: evidence.status,
        explorer: evidence.explorer,
        verifiedAt: evidence.verifiedAt
      };
      workflowBinding = {
        ok: true,
        traceId: String(result?.traceId || result?.workflow?.traceId || '').trim(),
        requestId: evidence.requestId,
        txHash: evidence.txHash,
        block: evidence.block,
        status: evidence.status,
        explorer: evidence.explorer,
        attempts
      };
    } catch (error) {
      const reason = String(error?.message || 'bind_real_x402_failed').trim();
      warnings.push(reason);
      if (strictBinding) {
        throw new Error(reason);
      }
    }
  } else if (paymentIntent.mode === 'x402' && paymentIntent.requestId) {
    const evidence = resolveX402EvidenceByRequestId(paymentIntent.requestId);
    if (evidence?.txHash) {
      paymentIntent = {
        mode: 'x402',
        requestId: evidence.requestId,
        txHash: evidence.txHash,
        block: evidence.block,
        status: evidence.status,
        explorer: evidence.explorer,
        verifiedAt: evidence.verifiedAt
      };
    }
  }

  if (!paymentIntent.mode) paymentIntent.mode = 'mock';
  if (!paymentIntent.requestId) paymentIntent.requestId = fallbackRequestId;
  if (paymentIntent.mode === 'x402' && !paymentIntent.txHash) {
    warnings.push('x402 evidence unavailable, fallback to mock payment intent');
    paymentIntent.mode = 'mock';
  }
  if (!paymentIntent.txHash && paymentIntent.mode === 'mock') {
    paymentIntent.txHash = `mock_${taskIdSafeToken(traceId || fallbackRequestId || 'reader')}`;
  }

  return {
    paymentIntent,
    normalizedTask,
    workflowBinding,
    warnings
  };
}

async function buildInfoPaymentIntentForTask(options = {}) {
  return buildXReaderPaymentIntentForTask(options);
}

function taskIdSafeToken(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24);
}

const XMTP_HOP_DIGEST_FIELDS = Object.freeze([
  'id',
  'createdAt',
  'runtimeName',
  'direction',
  'kind',
  'fromAgentId',
  'toAgentId',
  'channel',
  'hopIndex',
  'traceId',
  'requestId',
  'taskId',
  'conversationId',
  'messageId',
  'status',
  'phase',
  'detail',
  'resultSummary',
  'error',
  'payment.mode',
  'payment.requestId',
  'payment.txHash',
  'payment.block',
  'payment.status',
  'payment.explorer',
  'payment.verifiedAt',
  'receiptRef.requestId',
  'receiptRef.txHash',
  'receiptRef.block',
  'receiptRef.status',
  'receiptRef.explorer',
  'receiptRef.verifiedAt',
  'receiptRef.endpoint'
]);

function buildXmtpHopDigestMaterial(hop = {}) {
  const payment = hop?.payment && typeof hop.payment === 'object' && !Array.isArray(hop.payment) ? hop.payment : null;
  const receiptRef =
    hop?.receiptRef && typeof hop.receiptRef === 'object' && !Array.isArray(hop.receiptRef) ? hop.receiptRef : null;
  return {
    id: String(hop?.id || '').trim(),
    createdAt: String(hop?.createdAt || '').trim(),
    runtimeName: String(hop?.runtimeName || '').trim(),
    direction: String(hop?.direction || '').trim().toLowerCase(),
    kind: String(hop?.kind || '').trim().toLowerCase(),
    fromAgentId: String(hop?.fromAgentId || '').trim(),
    toAgentId: String(hop?.toAgentId || '').trim(),
    channel: String(hop?.channel || '').trim(),
    hopIndex: Number.isFinite(Number(hop?.hopIndex)) ? Number(hop.hopIndex) : null,
    traceId: String(hop?.traceId || '').trim(),
    requestId: String(hop?.requestId || '').trim(),
    taskId: String(hop?.taskId || '').trim(),
    conversationId: String(hop?.conversationId || '').trim(),
    messageId: String(hop?.messageId || '').trim(),
    status: String(hop?.status || '').trim().toLowerCase(),
    phase: String(hop?.phase || '').trim().toLowerCase(),
    detail: String(hop?.detail || '').trim(),
    resultSummary: String(hop?.resultSummary || '').trim(),
    error: String(hop?.error || '').trim(),
    payment: payment
      ? {
          mode: String(payment.mode || '').trim().toLowerCase(),
          requestId: String(payment.requestId || '').trim(),
          txHash: String(payment.txHash || '').trim(),
          block: Number.isFinite(Number(payment.block)) ? Number(payment.block) : null,
          status: String(payment.status || '').trim().toLowerCase(),
          explorer: String(payment.explorer || '').trim(),
          verifiedAt: String(payment.verifiedAt || '').trim()
        }
      : null,
    receiptRef: receiptRef
      ? {
          requestId: String(receiptRef.requestId || '').trim(),
          txHash: String(receiptRef.txHash || '').trim(),
          block: Number.isFinite(Number(receiptRef.block)) ? Number(receiptRef.block) : null,
          status: String(receiptRef.status || '').trim().toLowerCase(),
          explorer: String(receiptRef.explorer || '').trim(),
          verifiedAt: String(receiptRef.verifiedAt || '').trim(),
          endpoint: String(receiptRef.endpoint || '').trim()
        }
      : null
  };
}

function buildTraceXmtpEvidence({ traceId = '', requestId = '', taskId = '' } = {}) {
  const normalizedTraceId = String(traceId || '').trim();
  const normalizedRequestId = String(requestId || '').trim();
  const normalizedTaskId = String(taskId || '').trim();

  const query = { limit: 500 };
  if (normalizedTaskId) {
    query.taskId = normalizedTaskId;
  } else if (normalizedTraceId && !normalizedRequestId) {
    query.traceId = normalizedTraceId;
  }

  const rows = xmtpRuntime.listEvents(query);
  const allowedKinds = new Set(['task-envelope', 'task-result', 'task-ack', 'task-phase']);
  const hops = (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const kind = String(row?.kind || '').trim().toLowerCase();
      if (!allowedKinds.has(kind)) return false;
      const parsed = row?.parsed && typeof row.parsed === 'object' && !Array.isArray(row.parsed) ? row.parsed : null;
      const rowTraceId = String(row?.traceId || parsed?.traceId || '').trim();
      const rowTaskId = String(row?.taskId || parsed?.taskId || '').trim();
      const relatedRequestIds = [
        String(row?.requestId || '').trim(),
        String(parsed?.requestId || '').trim(),
        String(parsed?.payment?.requestId || '').trim(),
        String(parsed?.receiptRef?.requestId || '').trim()
      ].filter(Boolean);

      if (normalizedTaskId && rowTaskId !== normalizedTaskId) return false;
      if (normalizedTraceId && normalizedRequestId) {
        const traceMatch = rowTraceId === normalizedTraceId;
        const requestMatch = relatedRequestIds.includes(normalizedRequestId);
        if (!traceMatch && !requestMatch) return false;
      } else if (normalizedTraceId && rowTraceId !== normalizedTraceId) {
        return false;
      } else if (normalizedRequestId && !relatedRequestIds.includes(normalizedRequestId)) {
        return false;
      }
      return true;
    })
    .map((row) => {
      const parsed = row?.parsed && typeof row.parsed === 'object' && !Array.isArray(row.parsed) ? row.parsed : null;
      const payment = parsed?.payment && typeof parsed.payment === 'object' && !Array.isArray(parsed.payment) ? parsed.payment : null;
      const receiptRef =
        parsed?.receiptRef && typeof parsed.receiptRef === 'object' && !Array.isArray(parsed.receiptRef)
          ? parsed.receiptRef
          : null;
      const hop = {
        id: String(row?.id || '').trim(),
        createdAt: String(row?.createdAt || '').trim(),
        runtimeName: String(row?.runtimeName || '').trim(),
        direction: String(row?.direction || '').trim().toLowerCase(),
        kind: String(row?.kind || '').trim().toLowerCase(),
        fromAgentId: String(row?.fromAgentId || parsed?.fromAgentId || '').trim(),
        toAgentId: String(row?.toAgentId || parsed?.toAgentId || '').trim(),
        channel: String(row?.channel || parsed?.channel || '').trim(),
        hopIndex: Number.isFinite(Number(row?.hopIndex)) ? Number(row.hopIndex) : null,
        traceId: String(row?.traceId || parsed?.traceId || '').trim(),
        requestId: String(row?.requestId || parsed?.requestId || '').trim(),
        taskId: String(row?.taskId || parsed?.taskId || '').trim(),
        conversationId: String(row?.conversationId || '').trim(),
        messageId: String(row?.messageId || '').trim(),
        status: String(parsed?.status || '').trim().toLowerCase(),
        phase: String(parsed?.phase || '').trim().toLowerCase(),
        detail: String(parsed?.detail || '').trim(),
        resultSummary: String(parsed?.result?.summary || '').trim(),
        error: String(parsed?.error || row?.error || '').trim(),
        payment: payment
          ? {
              mode: String(payment.mode || '').trim().toLowerCase(),
              requestId: String(payment.requestId || '').trim(),
              txHash: String(payment.txHash || '').trim(),
              block: Number.isFinite(Number(payment.block)) ? Number(payment.block) : null,
              status: String(payment.status || '').trim().toLowerCase(),
              explorer: String(payment.explorer || '').trim(),
              verifiedAt: String(payment.verifiedAt || '').trim()
            }
          : null,
        receiptRef: receiptRef
          ? {
              requestId: String(receiptRef.requestId || '').trim(),
              txHash: String(receiptRef.txHash || '').trim(),
              block: Number.isFinite(Number(receiptRef.block)) ? Number(receiptRef.block) : null,
              status: String(receiptRef.status || '').trim().toLowerCase(),
              explorer: String(receiptRef.explorer || '').trim(),
              verifiedAt: String(receiptRef.verifiedAt || '').trim(),
              endpoint: String(receiptRef.endpoint || '').trim()
            }
          : null
      };
      const hopDigest = digestStableObject(buildXmtpHopDigestMaterial(hop));
      hop.hopDigest = hopDigest.value;
      return hop;
    })
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));

  const xmtpDigestInput = {
    scope: 'xmtp-hop-core-v1',
    traceId: normalizedTraceId,
    requestId: normalizedRequestId,
    taskId: normalizedTaskId,
    total: hops.length,
    hops: hops.map((hop) => buildXmtpHopDigestMaterial(hop))
  };
  const xmtpDigest = digestStableObject(xmtpDigestInput);
  const latestTaskResult = [...hops].reverse().find((row) => row.kind === 'task-result') || null;
  return {
    total: hops.length,
    digest: {
      algorithm: xmtpDigest.algorithm,
      canonicalization: xmtpDigest.canonicalization,
      scope: 'xmtp-hop-core-v1',
      value: xmtpDigest.value
    },
    integrity: {
      hopFields: XMTP_HOP_DIGEST_FIELDS,
      digestInput: {
        scope: 'xmtp-hop-core-v1',
        traceId: normalizedTraceId,
        requestId: normalizedRequestId,
        taskId: normalizedTaskId,
        total: hops.length
      }
    },
    hops,
    latestTaskResult: latestTaskResult
      ? {
          status: latestTaskResult.status || '',
          resultSummary: latestTaskResult.resultSummary || '',
          error: latestTaskResult.error || '',
          payment: latestTaskResult.payment || null,
          receiptRef: latestTaskResult.receiptRef || null
        }
      : null
  };
}

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
  const xmtpEvidence = buildTraceXmtpEvidence({
    traceId,
    requestId: String(workflow?.requestId || reqItem?.requestId || '').trim()
  });
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
    xmtp: xmtpEvidence,
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
  const xmtp = buildTraceXmtpEvidence({
    traceId,
    requestId: String(workflow?.requestId || reqItem?.requestId || '').trim()
  });

  const evidenceSchemaVersion = 'kiteclaw-evidence-v1.1.0';
  const digestInput = {
    scope: 'evidence-core-v1',
    schemaVersion: evidenceSchemaVersion,
    traceId,
    workflow: {
      traceId: String(workflow?.traceId || '').trim(),
      type: String(workflow?.type || '').trim(),
      state: String(workflow?.state || '').trim().toLowerCase(),
      requestId: String(workflow?.requestId || '').trim(),
      txHash: String(workflow?.txHash || '').trim(),
      userOpHash: String(workflow?.userOpHash || '').trim()
    },
    x402: reqItem
      ? {
          requestId: String(reqItem.requestId || '').trim(),
          status: String(reqItem.status || '').trim().toLowerCase(),
          action: String(reqItem.action || '').trim().toLowerCase(),
          amount: String(reqItem.amount || '').trim(),
          payer: String(reqItem.payer || '').trim(),
          recipient: String(reqItem.recipient || '').trim(),
          tokenAddress: String(reqItem.tokenAddress || '').trim(),
          paymentTxHash: String(reqItem.paymentTxHash || reqItem?.paymentProof?.txHash || '').trim()
        }
      : null,
    xmtp: {
      total: Number(xmtp?.total || 0),
      digest: String(xmtp?.digest?.value || '').trim()
    },
    paymentRecord: paymentRecord
      ? {
          txHash: String(paymentRecord.txHash || '').trim(),
          status: String(paymentRecord.status || '').trim().toLowerCase(),
          requestId: String(paymentRecord.requestId || '').trim()
        }
      : null,
    runtimeSnapshot: {
      aaWallet: runtime.aaWallet || '',
      sessionAddress: runtime.sessionAddress || '',
      sessionId: runtime.sessionId || '',
      maxPerTx: runtime.maxPerTx || 0,
      dailyLimit: runtime.dailyLimit || 0,
      gatewayRecipient: runtime.gatewayRecipient || ''
    }
  };
  const evidenceDigest = digestStableObject(digestInput);

  const exportPayload = {
    schemaVersion: evidenceSchemaVersion,
    traceId,
    exportedAt: new Date().toISOString(),
    digest: {
      algorithm: evidenceDigest.algorithm,
      canonicalization: evidenceDigest.canonicalization,
      scope: 'evidence-core-v1',
      value: evidenceDigest.value
    },
    integrity: {
      digestInput
    },
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
    xmtp,
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

  const shouldDownload = /^(1|true|yes|download)$/i.test(String(req.query.download || '').trim());
  if (shouldDownload) {
    const fileName = `kiteclaw_evidence_${traceId}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"${fileName}\"`);
  }

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
  if (!['x-reader-feed', 'info-analysis-feed'].includes(String(reqItem?.action || '').trim().toLowerCase())) {
    return res.status(400).json({
      ok: false,
      error: 'excerpt_not_supported',
      reason: 'only info-analysis-feed supports excerpt retrieval'
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
        topic:
          reqItem?.actionParams?.topic ||
          reqItem?.actionParams?.query ||
          reqItem?.actionParams?.keyword ||
          storedReader?.topic ||
          '',
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
  const prebindOnly = parseBooleanFlag(body.prebindOnly, false);
  const taskInput = body.task || {};
  const identityInput = body.identity || {};
  const requestedAction = String(body.action || 'risk-score-feed').trim().toLowerCase();
  const taskAction = requestedAction === 'technical-analysis-feed' ? 'technical-analysis-feed' : 'risk-score-feed';
  const serviceLabel = taskAction === 'technical-analysis-feed' ? 'A2A technical analysis' : 'A2A risk score';

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

  const actionCfg = getActionConfig(taskAction);
  const actionAmount = String(actionCfg?.amount || X402_RISK_SCORE_PRICE || '0.00002');
  const requests = readX402Requests();
  const a2aQuery = `${serviceLabel} ${task.symbol} horizon=${task.horizonMin} source=${task.source}`;

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
        action: `a2a-${taskAction}`,
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
      taskType: taskAction,
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
          taskType: taskAction,
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
    if (prebindOnly) {
      return {
        status: 200,
        body: {
          ok: true,
          mode: 'x402',
          requestId: reqItem.requestId,
          reused: true,
          prebindOnly: true,
          result: {
            summary: reqItem?.result?.summary || `${serviceLabel} payment settled (prebind-only)`,
            prebindOnly: true
          },
          a2a: reqItem.a2a || null,
          receipt: buildA2AReceipt(reqItem, null, {
            traceId,
            sourceAgentId,
            targetAgentId,
            capability: taskAction,
            phase: 'settled',
            state: 'success',
            summary: reqItem?.result?.summary || `${serviceLabel} payment settled (prebind-only)`
          })
        }
      };
    }
    let riskResult = reqItem?.result || null;
    const needsFreshResult =
      !riskResult ||
      parseBooleanFlag(riskResult?.prebindOnly, false) ||
      !String(riskResult?.summary || '').trim();
    if (needsFreshResult) {
      try {
        const computed = await runRiskScoreAnalysis(reqItem.actionParams || task);
        riskResult = {
          summary: `${serviceLabel} unlocked by x402 payment: ${computed.summary}`,
          ...computed
        };
        reqItem.result = riskResult;
        writeX402Requests(requests);
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
        result: riskResult || { summary: `${serviceLabel} already unlocked` },
        a2a: reqItem.a2a || null,
        receipt: buildA2AReceipt(reqItem, null, {
          traceId,
          sourceAgentId,
          targetAgentId,
          capability: taskAction,
          phase: 'settled',
          state: 'success',
          summary: reqItem?.result?.summary || `${serviceLabel} already unlocked`
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
    taskType: String(reqItem?.a2a?.taskType || taskAction).trim(),
    traceId: String(reqItem?.a2a?.traceId || traceId).trim()
  };
  if (prebindOnly) {
    reqItem.result = {
      summary: `${serviceLabel} payment settled (prebind-only)`,
      prebindOnly: true
    };
  } else {
    const riskResult = await runRiskScoreAnalysis(reqItem.actionParams || task);
    reqItem.result = {
      summary: `${serviceLabel} unlocked by x402 payment: ${riskResult.summary}`,
      ...riskResult
    };
  }
  writeX402Requests(requests);

  const receipt = buildA2AReceipt(reqItem, null, {
    traceId: reqItem?.a2a?.traceId || traceId,
    sourceAgentId,
    targetAgentId,
    capability: taskAction,
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
        taskType: taskAction
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
  const prebindOnly = parseBooleanFlag(body.prebindOnly, false);
  const taskInput = body.task || {};
  const identityInput = body.identity || {};
  const taskAction = 'info-analysis-feed';
  const serviceLabel = 'A2A info analysis';

  let task = null;
  try {
    task = normalizeXReaderParams({
      url: body.url || taskInput.url || taskInput.resourceUrl,
      topic:
        body.topic ||
        body.query ||
        body.keyword ||
        taskInput.topic ||
        taskInput.query ||
        taskInput.keyword,
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

  const actionCfg = getActionConfig(taskAction);
  const actionAmount = String(actionCfg?.amount || X402_INFO_PRICE || X402_X_READER_PRICE || '0.00001');
  const requests = readX402Requests();
  const a2aQuery = `${serviceLabel} ${task.url || task.topic || ''}`.trim();

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
        action: `a2a-${taskAction}`,
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
      taskType: taskAction,
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
          taskType: taskAction,
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
    if (prebindOnly) {
      return {
        status: 200,
        body: {
          ok: true,
          mode: 'x402',
          requestId: reqItem.requestId,
          reused: true,
          prebindOnly: true,
          result: {
            summary: reqItem?.result?.summary || `${serviceLabel} payment settled (prebind-only)`,
            prebindOnly: true
          },
          a2a: reqItem.a2a || null,
          receipt: buildA2AReceipt(reqItem, null, {
            traceId,
            sourceAgentId,
            targetAgentId,
            capability: taskAction,
            phase: 'settled',
            state: 'success',
            summary: reqItem?.result?.summary || `${serviceLabel} payment settled (prebind-only)`
          })
        }
      };
    }
    let reader = reqItem?.result?.reader || null;
    const needsFreshResult =
      !reader ||
      parseBooleanFlag(reqItem?.result?.prebindOnly, false) ||
      !String(reqItem?.result?.summary || '').trim();
    if (needsFreshResult) {
      try {
        reader = await fetchXReaderDigest(reqItem.actionParams || task);
        reqItem.result = {
          summary: `${serviceLabel} unlocked by x402 payment: ${reader.title || reader.url || task.topic || 'analysis result'}`,
          reader
        };
        writeX402Requests(requests);
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
          summary: reqItem?.result?.summary || `${serviceLabel} already unlocked`,
          reader
        },
        a2a: reqItem.a2a || null,
        receipt: buildA2AReceipt(reqItem, null, {
          traceId,
          sourceAgentId,
          targetAgentId,
          capability: taskAction,
          phase: 'settled',
          state: 'success',
          summary: reqItem?.result?.summary || `${serviceLabel} already unlocked`
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
    taskType: String(reqItem?.a2a?.taskType || taskAction).trim(),
    traceId: String(reqItem?.a2a?.traceId || traceId).trim()
  };
  let summaryTail = 'info analysis';
  if (prebindOnly) {
    reqItem.result = {
      summary: `${serviceLabel} payment settled (prebind-only)`,
      prebindOnly: true
    };
    summaryTail = `${serviceLabel} payment settled (prebind-only)`;
  } else {
    const reader = await fetchXReaderDigest(reqItem.actionParams || task);
    summaryTail = reader.title || reader.url || 'info analysis';
    reqItem.result = {
      summary: `${serviceLabel} unlocked by x402 payment: ${summaryTail}`,
      reader
    };
  }
  writeX402Requests(requests);

  const receipt = buildA2AReceipt(reqItem, null, {
    traceId: reqItem?.a2a?.traceId || traceId,
    sourceAgentId,
    targetAgentId,
    capability: taskAction,
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
        taskType: taskAction
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

app.post('/api/a2a/tasks/info', requireRole('agent'), async (req, res) => {
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
  if (!KITE_ALLOW_BACKEND_USEROP_SIGN) {
    return res.status(403).json({
      ok: false,
      error: 'backend_userop_sign_disabled',
      reason: 'Backend userOp signing is disabled by policy. Use session key signing path.'
    });
  }
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
  if (isTechnicalAnalysisAction(actionCfg.action)) {
    try {
      normalizedActionParams = normalizeRiskScoreParams(actionParamsInput || {});
    } catch (error) {
      return res.status(400).json({
        error: 'invalid_risk_score_params',
        reason: error.message
      });
    }
  }
  if (isInfoAnalysisAction(actionCfg.action)) {
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
    if (isTechnicalAnalysisAction(reqItem.action)) {
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
    if (isInfoAnalysisAction(reqItem.action)) {
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
  if (isTechnicalAnalysisAction(reqItem.action)) {
    const riskResult = await runRiskScoreAnalysis(reqItem.actionParams || {});
    finalResult = riskResult;
  }
  if (isInfoAnalysisAction(reqItem.action)) {
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
    authDisabled: AUTH_DISABLED,
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
  const runtimeStatuses = getAllXmtpRuntimeStatuses();
  const routerStatus = runtimeStatuses.router;
  const riskStatus = runtimeStatuses.risk;
  const readerStatus = runtimeStatuses.reader;
  const priceStatus = runtimeStatuses.price;
  const executorStatus = runtimeStatuses.executor;
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
        },
        reader: {
          enabled: readerStatus.enabled,
          running: readerStatus.running
        },
        price: {
          enabled: priceStatus.enabled,
          running: priceStatus.running
        },
        executor: {
          enabled: executorStatus.enabled,
          running: executorStatus.running
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
  const statuses = getAllXmtpRuntimeStatuses();
  const router = statuses.router;
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    xmtp: {
      env: router.env || XMTP_ENV,
      ...statuses
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

app.get('/api/xmtp/groups', requireRole('viewer'), (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 80), 300));
  const rows = readXmtpGroups()
    .map((item) => sanitizeXmtpGroupRecord(item))
    .filter((item) => item.groupId || item.label)
    .sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0))
    .slice(0, limit);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    total: rows.length,
    items: rows
  });
});

app.post('/api/xmtp/groups/ensure', requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  if (!xmtpRuntime.getStatus().running && body.autoStart !== false) {
    await startXmtpRuntimes();
  }
  if (!xmtpRuntime.getStatus().running) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'xmtp_router_not_running',
      reason: xmtpRuntime.getStatus().lastError || 'router runtime is not running'
    });
  }

  const label = String(body.label || XMTP_WORKERS_GROUP_LABEL || 'workers-group').trim();
  const existing = findXmtpGroupRecord({
    groupId: body.groupId,
    label
  });
  const memberAgentIds = parseAgentIdList(
    body.memberAgentIds || existing?.memberAgentIds || XMTP_WORKERS_GROUP_AGENT_IDS
  );
  const resolvedMembers = resolveAgentAddressesByIds(memberAgentIds);
  const memberAddresses = resolvedMembers.map((item) => item.address);
  const ensured = await xmtpRuntime.ensureGroup({
    groupId: String(body.groupId || existing?.groupId || '').trim(),
    groupName: String(body.groupName || existing?.groupName || XMTP_WORKERS_GROUP_NAME).trim(),
    groupDescription: String(body.description || existing?.description || 'Agent001 workers collaboration channel').trim(),
    memberAddresses
  });
  if (!ensured?.ok) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: ensured?.error || 'xmtp_group_ensure_failed',
      reason: ensured?.reason || 'xmtp_group_ensure_failed',
      details: ensured
    });
  }

  const record = upsertXmtpGroupRecord({
    groupId: ensured.groupId,
    label,
    groupName: ensured.groupName,
    description: String(body.description || existing?.description || '').trim(),
    runtimeName: 'router-runtime',
    memberAgentIds,
    memberAddresses: ensured.memberAddresses || memberAddresses,
    updatedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString()
  });
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    group: record,
    resolvedMembers,
    ensured
  });
});

app.post('/api/xmtp/groups/send', requireRole('agent'), async (req, res) => {
  const body = req.body || {};
  if (!xmtpRuntime.getStatus().running && body.autoStart === true) {
    await startXmtpRuntimes();
  }
  const label = String(body.label || '').trim();
  const known = findXmtpGroupRecord({
    groupId: body.groupId,
    label
  });
  const groupId = String(body.groupId || known?.groupId || '').trim();
  const result = await xmtpRuntime.sendGroup({
    groupId,
    createIfMissing: body.createIfMissing === true,
    groupName: body.groupName || known?.groupName || XMTP_WORKERS_GROUP_NAME,
    groupDescription: body.description || known?.description || 'Agent001 workers collaboration channel',
    memberAddresses: normalizeAddresses(body.memberAddresses || known?.memberAddresses || []),
    fromAgentId: body.fromAgentId || 'router-agent',
    channel: body.channel || 'group',
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
      error: result?.error || 'xmtp_group_send_failed',
      reason: result?.reason || 'xmtp_group_send_failed',
      details: result
    });
  }
  if (label || known) {
    upsertXmtpGroupRecord({
      ...(known || {}),
      groupId: result.groupId || groupId,
      label: label || known?.label || '',
      groupName: body.groupName || known?.groupName || '',
      runtimeName: 'router-runtime',
      memberAgentIds: parseAgentIdList(body.memberAgentIds || known?.memberAgentIds || []),
      memberAddresses: normalizeAddresses(body.memberAddresses || known?.memberAddresses || []),
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
  }
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    groupId: result.groupId || groupId,
    message: result
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

app.post('/api/network/demo/router-info-technical/run', requireRole('agent'), async (req, res) => {
  const body = req.body || {};
  const autoStart = body.autoStart !== false;
  const retryOnTimeout = body.retryOnTimeout !== false;
  if (autoStart) {
    await startXmtpRuntimes();
  }
  const isRuntimeUnhealthy = (status = {}) => {
    if (!status || typeof status !== 'object') return true;
    if (!status.enabled) return true;
    if (!status.configured) return true;
    if (!status.running) return true;
    const reason = String(status.lastError || '').trim().toLowerCase();
    if (!reason) return false;
    return (
      reason.includes('conversation streaming') ||
      reason.includes('streaming') ||
      reason.includes('incoming_handler') ||
      reason.includes('unhandled')
    );
  };
  const healRuntime = async (runtime, runtimeLabel) => {
    const before = runtime.getStatus();
    if (!isRuntimeUnhealthy(before)) {
      return {
        label: runtimeLabel,
        attempted: false,
        recovered: true,
        before,
        after: before
      };
    }
    await runtime.stop();
    const after = await runtime.start();
    return {
      label: runtimeLabel,
      attempted: true,
      recovered: Boolean(after?.running),
      before,
      after
    };
  };
  const recovery = [];
  recovery.push(await healRuntime(xmtpRuntime, 'router'));
  recovery.push(await healRuntime(xmtpReaderRuntime, 'reader'));
  recovery.push(await healRuntime(xmtpRiskRuntime, 'risk'));

  const routerStatus = xmtpRuntime.getStatus();
  const readerStatus = xmtpReaderRuntime.getStatus();
  const riskStatus = xmtpRiskRuntime.getStatus();
  if (!routerStatus.running) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'xmtp_router_not_running',
      reason: routerStatus.lastError || 'router runtime is not running',
      recovery
    });
  }
  if (!readerStatus.running) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'xmtp_reader_not_running',
      reason: readerStatus.lastError || 'reader runtime is not running',
      recovery
    });
  }
  if (!riskStatus.running) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'xmtp_risk_not_running',
      reason: riskStatus.lastError || 'risk runtime is not running',
      recovery
    });
  }

  const readerAgent = findNetworkAgentById('reader-agent');
  const technicalAgent = findNetworkAgentById('technical-agent') || findNetworkAgentById('risk-agent');
  const infoAddress = normalizeAddress(body.infoToAddress || readerAgent?.xmtpAddress || XMTP_READER_RESOLVED_ADDRESS);
  const technicalAddress = normalizeAddress(
    body.technicalToAddress || technicalAgent?.xmtpAddress || XMTP_RISK_RESOLVED_ADDRESS
  );
  if (!infoAddress || !technicalAddress) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'agent_address_missing',
      reason: 'Set reader/risk(technical) XMTP address mapping before running info-technical demo.'
    });
  }

  const traceId = String(body.traceId || createTraceId('router_it_trace')).trim();
  const requestId = String(body.requestId || createTraceId('router_it_req')).trim();
  const infoTaskId = String(body.infoTaskId || createTraceId('router_it_info')).trim();
  const technicalTaskId = String(body.technicalTaskId || createTraceId('router_it_tech')).trim();

  const infoBody = {
    ...body,
    action: String(body?.infoAction || body?.action || 'info-analysis-feed').trim().toLowerCase(),
    input:
      body?.infoInput && typeof body.infoInput === 'object' && !Array.isArray(body.infoInput)
        ? body.infoInput
        : {
            url: body?.url || body?.resourceUrl || 'https://newshacker.me/',
            mode: body?.mode || 'auto',
            maxChars: body?.maxChars ?? X_READER_MAX_CHARS_DEFAULT
          }
  };
  const technicalBody = {
    ...body,
    action: String(body?.technicalAction || body?.action || 'technical-analysis-feed').trim().toLowerCase(),
    input:
      body?.technicalInput && typeof body.technicalInput === 'object' && !Array.isArray(body.technicalInput)
        ? body.technicalInput
        : {
            symbol: body?.symbol || body?.pair || 'BTCUSDT',
            source: body?.source || 'hyperliquid',
            horizonMin: body?.horizonMin ?? 60
          }
  };

  let infoPaymentPlan = null;
  let technicalPaymentPlan = null;
  try {
    infoPaymentPlan = await buildXReaderPaymentIntentForTask({
      body: infoBody,
      traceId,
      fallbackRequestId: `${requestId}_info`,
      defaultTask: {
        url: 'https://newshacker.me/',
        mode: 'auto',
        maxChars: X_READER_MAX_CHARS_DEFAULT
      }
    });
    technicalPaymentPlan = await buildRiskScorePaymentIntentForTask({
      body: technicalBody,
      traceId,
      fallbackRequestId: `${requestId}_technical`,
      defaultTask: {
        symbol: 'BTCUSDT',
        source: 'hyperliquid',
        horizonMin: 60
      }
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'bind_real_x402_failed',
      reason: error?.message || 'bind_real_x402_failed'
    });
  }

  const buildTaskEnvelope = ({ taskId, toAgentId, capability, input, paymentIntent }) => ({
    kind: 'task-envelope',
    protocolVersion: 'kite-agent-task-v1',
    traceId,
    requestId,
    taskId,
    fromAgentId: 'router-agent',
    toAgentId,
    channel: 'dm',
    hopIndex: 1,
    mode: 'a2a',
    capability,
    input,
    paymentIntent,
    expectsReply: true,
    timestamp: new Date().toISOString()
  });

  const infoEnvelope = buildTaskEnvelope({
    taskId: infoTaskId,
    toAgentId: 'reader-agent',
    capability: String(body.infoCapability || 'info-analysis-feed').trim(),
    input: infoPaymentPlan.normalizedTask,
    paymentIntent: infoPaymentPlan.paymentIntent
  });
  const technicalEnvelope = buildTaskEnvelope({
    taskId: technicalTaskId,
    toAgentId: String(body.technicalAgentId || technicalAgent?.id || 'technical-agent').trim().toLowerCase(),
    capability: String(body.technicalCapability || 'technical-analysis-feed').trim(),
    input: technicalPaymentPlan.normalizedTask,
    paymentIntent: technicalPaymentPlan.paymentIntent
  });

  const infoSent = await xmtpRuntime.sendDm({
    fromAgentId: 'router-agent',
    toAgentId: infoEnvelope.toAgentId,
    toAddress: infoAddress,
    channel: 'dm',
    hopIndex: 1,
    envelope: infoEnvelope,
    traceId,
    requestId,
    taskId: infoTaskId
  });
  if (!infoSent?.ok) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: infoSent?.error || 'info_task_send_failed',
      reason: infoSent?.reason || 'info_task_send_failed',
      details: infoSent
    });
  }

  const technicalSent = await xmtpRuntime.sendDm({
    fromAgentId: 'router-agent',
    toAgentId: technicalEnvelope.toAgentId,
    toAddress: technicalAddress,
    channel: 'dm',
    hopIndex: 1,
    envelope: technicalEnvelope,
    traceId,
    requestId,
    taskId: technicalTaskId
  });
  if (!technicalSent?.ok) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: technicalSent?.error || 'technical_task_send_failed',
      reason: technicalSent?.reason || 'technical_task_send_failed',
      details: technicalSent
    });
  }

  const waitTaskResultEvent = async (taskId, timeoutMs = 15000) => {
    const deadline = Date.now() + Math.max(1000, Math.min(Number(timeoutMs || 15000), 60000));
    while (Date.now() <= deadline) {
      const hits = xmtpRuntime.listEvents({
        kind: 'task-result',
        taskId
      });
      const scoped = (Array.isArray(hits) ? hits : []).filter((row) => {
        const rowTraceId = String(row?.traceId || '').trim();
        const rowRequestId = String(row?.requestId || '').trim();
        if (rowTraceId && rowTraceId !== traceId) return false;
        if (rowRequestId && rowRequestId !== requestId) return false;
        return true;
      });
      if (scoped.length > 0) {
        const preferred =
          scoped.find(
            (row) =>
              String(row?.runtimeName || '').trim() === 'router-runtime' &&
              String(row?.direction || '').trim() === 'inbound'
          ) ||
          scoped.find((row) => {
            const runtimeName = String(row?.runtimeName || '').trim();
            const direction = String(row?.direction || '').trim();
            return direction === 'outbound' && ['reader-runtime', 'risk-runtime'].includes(runtimeName);
          }) ||
          scoped[0];
        return preferred || null;
      }
      await waitMs(350);
    }
    return null;
  };

  const waitMsLimit = Math.max(1000, Math.min(Number(body.waitMs || 15000), 60000));
  let [infoEvent, technicalEvent] = await Promise.all([
    waitTaskResultEvent(infoTaskId, waitMsLimit),
    waitTaskResultEvent(technicalTaskId, waitMsLimit)
  ]);
  let infoRetrySent = null;
  let technicalRetrySent = null;
  let infoRetryEvent = null;
  let technicalRetryEvent = null;
  let infoResolvedTaskId = infoTaskId;
  let technicalResolvedTaskId = technicalTaskId;
  const retryWarnings = [];

  const retryWaitMs = Math.max(1200, Math.min(Math.round(waitMsLimit * 0.6), 12000));
  if (retryOnTimeout && !infoEvent) {
    const infoRetryTaskId = `${infoTaskId}_r1`;
    const infoRetryEnvelope = {
      ...infoEnvelope,
      taskId: infoRetryTaskId,
      timestamp: new Date().toISOString()
    };
    infoRetrySent = await xmtpRuntime.sendDm({
      fromAgentId: 'router-agent',
      toAgentId: infoRetryEnvelope.toAgentId,
      toAddress: infoAddress,
      channel: 'dm',
      hopIndex: 1,
      envelope: infoRetryEnvelope,
      traceId,
      requestId,
      taskId: infoRetryTaskId
    });
    if (infoRetrySent?.ok) {
      infoRetryEvent = await waitTaskResultEvent(infoRetryTaskId, retryWaitMs);
      if (infoRetryEvent) {
        infoEvent = infoRetryEvent;
        infoResolvedTaskId = infoRetryTaskId;
      }
    } else {
      retryWarnings.push(`info_retry_send_failed:${String(infoRetrySent?.reason || infoRetrySent?.error || 'unknown').trim()}`);
    }
  }

  if (retryOnTimeout && !technicalEvent) {
    const technicalRetryTaskId = `${technicalTaskId}_r1`;
    const technicalRetryEnvelope = {
      ...technicalEnvelope,
      taskId: technicalRetryTaskId,
      timestamp: new Date().toISOString()
    };
    technicalRetrySent = await xmtpRuntime.sendDm({
      fromAgentId: 'router-agent',
      toAgentId: technicalRetryEnvelope.toAgentId,
      toAddress: technicalAddress,
      channel: 'dm',
      hopIndex: 1,
      envelope: technicalRetryEnvelope,
      traceId,
      requestId,
      taskId: technicalRetryTaskId
    });
    if (technicalRetrySent?.ok) {
      technicalRetryEvent = await waitTaskResultEvent(technicalRetryTaskId, retryWaitMs);
      if (technicalRetryEvent) {
        technicalEvent = technicalRetryEvent;
        technicalResolvedTaskId = technicalRetryTaskId;
      }
    } else {
      retryWarnings.push(
        `technical_retry_send_failed:${String(technicalRetrySent?.reason || technicalRetrySent?.error || 'unknown').trim()}`
      );
    }
  }

  const infoTaskResult =
    infoEvent?.parsed && typeof infoEvent.parsed === 'object' && !Array.isArray(infoEvent.parsed)
      ? infoEvent.parsed
      : null;
  const technicalTaskResult =
    technicalEvent?.parsed && typeof technicalEvent.parsed === 'object' && !Array.isArray(technicalEvent.parsed)
      ? technicalEvent.parsed
      : null;
  const infoAnalysis =
    infoTaskResult?.result?.info ||
    infoTaskResult?.result?.analysis ||
    null;
  const technicalAnalysis =
    technicalTaskResult?.result?.analysis ||
    technicalTaskResult?.result?.technical ||
    null;
  const infoConfidence = Number(infoAnalysis?.confidence);
  const technicalConfidence = Number(technicalAnalysis?.confidence);
  const confidenceCandidates = [infoConfidence, technicalConfidence].filter((item) => Number.isFinite(item));
  const confidenceBlend =
    confidenceCandidates.length > 0
      ? Number((confidenceCandidates.reduce((sum, item) => sum + item, 0) / confidenceCandidates.length).toFixed(4))
      : null;
  const failedStatuses = ['failed', 'error', 'rejected'];
  const buildTaskDispatchState = ({ label = 'task', event = null, taskResult = null, retrySent = null, retryEvent = null }) => {
    const resultReceived = Boolean(event);
    if (!resultReceived) {
      return {
        status: 'timeout',
        success: false,
        resultReceived: false,
        failure: {
          code: 'task_result_timeout',
          reason: `${label} no task-result within ${waitMsLimit}ms`,
          retryAttempted: Boolean(retrySent),
          retrySucceeded: Boolean(retryEvent)
        }
      };
    }
    if (!taskResult || typeof taskResult !== 'object' || Array.isArray(taskResult)) {
      return {
        status: 'failed',
        success: false,
        resultReceived: true,
        failure: {
          code: 'task_result_invalid',
          reason: `${label} returned invalid task-result payload`,
          retryAttempted: Boolean(retrySent),
          retrySucceeded: Boolean(retryEvent)
        }
      };
    }
    const statusRaw = String(taskResult?.status || '').trim().toLowerCase();
    if (failedStatuses.includes(statusRaw)) {
      const reason =
        String(taskResult?.error || taskResult?.result?.summary || '').trim() || `${label} returned failed task-result`;
      return {
        status: 'failed',
        success: false,
        resultReceived: true,
        failure: {
          code: 'task_result_failed',
          reason,
          retryAttempted: Boolean(retrySent),
          retrySucceeded: Boolean(retryEvent)
        }
      };
    }
    return {
      status: 'success',
      success: true,
      resultReceived: true,
      failure: null
    };
  };

  const infoState = buildTaskDispatchState({
    label: 'info',
    event: infoEvent,
    taskResult: infoTaskResult,
    retrySent: infoRetrySent,
    retryEvent: infoRetryEvent
  });
  const technicalState = buildTaskDispatchState({
    label: 'technical',
    event: technicalEvent,
    taskResult: technicalTaskResult,
    retrySent: technicalRetrySent,
    retryEvent: technicalRetryEvent
  });
  const successCount = Number(infoState.success) + Number(technicalState.success);
  const failureCount = 2 - successCount;
  const anyResultReceived = Boolean(infoState.resultReceived || technicalState.resultReceived);
  const partialFailure = successCount > 0 && failureCount > 0;
  const failReasons = [infoState.failure?.reason, technicalState.failure?.reason].filter(Boolean);

  const responsePayload = {
    traceId: req.traceId || '',
    command: {
      type: 'router-info-technical',
      traceId,
      requestId
    },
    resultReceived: anyResultReceived,
    partialFailure,
    tasks: {
      info: {
        taskId: infoResolvedTaskId,
        originalTaskId: infoTaskId,
        toAgentId: infoEnvelope.toAgentId,
        capability: infoEnvelope.capability,
        sent: infoSent,
        status: infoState.status,
        success: infoState.success,
        failure: infoState.failure,
        resultReceived: infoState.resultReceived,
        retrySent: infoRetrySent,
        retryResultEvent: infoRetryEvent,
        resultEvent: infoEvent,
        taskResult: infoTaskResult
      },
      technical: {
        taskId: technicalResolvedTaskId,
        originalTaskId: technicalTaskId,
        toAgentId: technicalEnvelope.toAgentId,
        capability: technicalEnvelope.capability,
        sent: technicalSent,
        status: technicalState.status,
        success: technicalState.success,
        failure: technicalState.failure,
        resultReceived: technicalState.resultReceived,
        retrySent: technicalRetrySent,
        retryResultEvent: technicalRetryEvent,
        resultEvent: technicalEvent,
        taskResult: technicalTaskResult
      }
    },
    summary: {
      infoSummary: String(infoTaskResult?.result?.summary || '').trim(),
      technicalSummary: String(technicalTaskResult?.result?.summary || '').trim(),
      confidenceBlend,
      successCount,
      failureCount
    },
    analysis: {
      info: infoAnalysis,
      technical: technicalAnalysis
    },
    paymentBinding: {
      info: infoPaymentPlan.workflowBinding || null,
      technical: technicalPaymentPlan.workflowBinding || null
    },
    warnings: [
      ...(Array.isArray(infoPaymentPlan.warnings) ? infoPaymentPlan.warnings : []),
      ...(Array.isArray(technicalPaymentPlan.warnings) ? technicalPaymentPlan.warnings : []),
      ...retryWarnings
    ],
    runtime: getAllXmtpRuntimeStatuses()
  };

  if (successCount <= 0) {
    return res.status(502).json({
      ok: false,
      ...responsePayload,
      error: 'all_tasks_failed',
      reason: failReasons.join(' | ') || `info/technical no task-result within ${waitMsLimit}ms`
    });
  }

  return res.json({
    ok: true,
    ...responsePayload
  });
});

app.get('/api/network/commands', requireRole('viewer'), (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
  const statusFilters = parseNetworkCommandFilterList(req.query.status);
  const typeFilters = parseNetworkCommandFilterList(req.query.type);
  let rows = readNetworkCommands();
  if (statusFilters.length > 0) {
    rows = rows.filter((item) => statusFilters.includes(String(item?.status || '').trim().toLowerCase()));
  }
  if (typeFilters.length > 0) {
    rows = rows.filter((item) => typeFilters.includes(String(item?.type || '').trim().toLowerCase()));
  }
  rows.sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0));
  const items = rows.slice(0, limit);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    total: rows.length,
    items
  });
});

app.get('/api/network/commands/:commandId', requireRole('viewer'), (req, res) => {
  const commandId = String(req.params.commandId || '').trim();
  if (!commandId) {
    return res.status(400).json({
      ok: false,
      error: 'commandId_required',
      reason: 'commandId is required.',
      traceId: req.traceId || ''
    });
  }
  const command = findNetworkCommandById(commandId);
  if (!command) {
    return res.status(404).json({
      ok: false,
      error: 'command_not_found',
      reason: 'command not found',
      commandId,
      traceId: req.traceId || ''
    });
  }
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    command
  });
});

app.post('/api/network/commands', requireRole('agent'), async (req, res) => {
  try {
    const body = req.body || {};
    const type = normalizeNetworkCommandType(body.type || 'router-info-technical');
    const label = String(body.label || '').trim() || type;
    const payload = normalizeNetworkCommandPayload(body.payload);
    const createdAt = new Date().toISOString();
    const commandId = String(body.commandId || createCommandId()).trim();
    const existing = findNetworkCommandById(commandId);
    const mode = existing ? 'updated' : 'created';
    const queuedEvents = appendNetworkCommandEvent(
      existing || {},
      'queued',
      existing ? 'updated' : 'created',
      existing ? `command updated: ${type}` : `command created: ${type}`,
      {
        source: 'api',
        runNow: body.runNow === true
      }
    );
    let command = upsertNetworkCommandRecord({
      ...existing,
      commandId,
      type,
      label,
      payload,
      status: existing?.status === 'running' ? 'running' : 'queued',
      error: existing?.status === 'running' ? existing.error || '' : '',
      result: existing?.status === 'running' ? existing.result || null : null,
      traceId: String(body.traceId || existing?.traceId || '').trim(),
      requestId: String(body.requestId || existing?.requestId || '').trim(),
      taskId: String(body.taskId || existing?.taskId || '').trim(),
      createdAt: existing?.createdAt || createdAt,
      updatedAt: createdAt,
      events: queuedEvents
    });

    if (body.runNow !== true) {
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        mode,
        command
      });
    }

    const runResult = await executeNetworkCommand(command, {
      source: 'api-create',
      payload: normalizeNetworkCommandPayload(body.runPayload)
    });
    if (!runResult.ok) {
      return res.status(runResult.statusCode || 502).json({
        ok: false,
        traceId: req.traceId || '',
        error: runResult.error || 'network_command_run_failed',
        reason: runResult.reason || 'network_command_run_failed',
        mode,
        command: runResult.command || command
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      mode,
      command: runResult.command,
      execution: runResult.execution
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'invalid_network_command',
      reason: error?.message || 'invalid network command payload'
    });
  }
});

app.post('/api/network/commands/:commandId/run', requireRole('agent'), async (req, res) => {
  const commandId = String(req.params.commandId || '').trim();
  if (!commandId) {
    return res.status(400).json({
      ok: false,
      error: 'commandId_required',
      reason: 'commandId is required.',
      traceId: req.traceId || ''
    });
  }
  const command = findNetworkCommandById(commandId);
  if (!command) {
    return res.status(404).json({
      ok: false,
      error: 'command_not_found',
      reason: 'command not found',
      commandId,
      traceId: req.traceId || ''
    });
  }

  const runResult = await executeNetworkCommand(command, {
    source: 'api-run',
    payload: normalizeNetworkCommandPayload(req.body?.payload)
  });
  if (!runResult.ok) {
    return res.status(runResult.statusCode || 502).json({
      ok: false,
      traceId: req.traceId || '',
      error: runResult.error || 'network_command_run_failed',
      reason: runResult.reason || 'network_command_run_failed',
      command: runResult.command || command
    });
  }
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    command: runResult.command,
    execution: runResult.execution
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

app.get('/api/message-providers/status', requireRole('viewer'), (req, res) => {
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    providers: {
      opennews: {
        enabled: true,
        baseUrl: OPENNEWS_API_BASE,
        tokenConfigured: Boolean(OPENNEWS_TOKEN),
        timeoutMs: OPENNEWS_TIMEOUT_MS,
        retries: OPENNEWS_RETRY,
        maxRows: OPENNEWS_MAX_ROWS
      },
      opentwitter: {
        enabled: true,
        baseUrl: OPENTWITTER_API_BASE,
        tokenConfigured: Boolean(OPENTWITTER_TOKEN),
        timeoutMs: OPENTWITTER_TIMEOUT_MS,
        retries: OPENTWITTER_RETRY,
        maxRows: OPENTWITTER_MAX_ROWS
      },
      clawfeed: {
        enabled: !MESSAGE_PROVIDER_DISABLE_CLAWFEED,
        reason: MESSAGE_PROVIDER_DISABLE_CLAWFEED ? 'disabled_by_policy' : 'not_integrated_for_realtime'
      }
    },
    defaults: {
      keywords: MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
      marketDataFallback: MESSAGE_PROVIDER_MARKET_DATA_FALLBACK
    }
  });
});

app.get('/api/hyperliquid/testnet/health', requireRole('viewer'), async (req, res) => {
  const adapterInfo = hyperliquidAdapter.info();
  const health = await hyperliquidAdapter.health();
  return res.status(health?.ok ? 200 : 503).json({
    ok: Boolean(health?.ok),
    traceId: req.traceId || '',
    adapter: adapterInfo,
    health
  });
});

app.get('/api/hyperliquid/testnet/mids', requireRole('viewer'), async (req, res) => {
  try {
    const mids = await hyperliquidAdapter.allMids();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      mode: 'testnet',
      total: mids && typeof mids === 'object' ? Object.keys(mids).length : 0,
      mids
    });
  } catch (error) {
    const detail = hyperliquidAdapter.buildAdapterError(error);
    return res.status(503).json({
      ok: false,
      traceId: req.traceId || '',
      error: detail.error || 'hyperliquid_mids_failed',
      reason: detail.reason || 'hyperliquid mids failed',
      response: detail.response || null
    });
  }
});

app.get('/api/hyperliquid/testnet/open-orders', requireRole('viewer'), async (req, res) => {
  try {
    const result = await hyperliquidAdapter.openOrders({
      user: req.query.user || '',
      symbol: req.query.symbol || ''
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      mode: 'testnet',
      ...result
    });
  } catch (error) {
    const detail = hyperliquidAdapter.buildAdapterError(error);
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: detail.error || 'hyperliquid_open_orders_failed',
      reason: detail.reason || 'hyperliquid open-orders failed',
      response: detail.response || null
    });
  }
});

app.get('/api/hyperliquid/testnet/order-status', requireRole('viewer'), async (req, res) => {
  try {
    const oid = req.query.oid || req.query.orderId || req.query.cloid || '';
    const result = await hyperliquidAdapter.orderStatus({
      user: req.query.user || '',
      oid
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      mode: 'testnet',
      ...result
    });
  } catch (error) {
    const detail = hyperliquidAdapter.buildAdapterError(error);
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: detail.error || 'hyperliquid_order_status_failed',
      reason: detail.reason || 'hyperliquid order-status failed',
      response: detail.response || null
    });
  }
});

app.post('/api/hyperliquid/testnet/order', requireRole('agent'), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await hyperliquidAdapter.placePerpOrder({
      symbol: body.symbol || body.coin || 'BTCUSDT',
      side: body.side || '',
      orderType: body.orderType || body.type || 'limit',
      size: body.size ?? body.sz ?? '',
      price: body.price ?? '',
      tif: body.tif || '',
      reduceOnly: body.reduceOnly === true || String(body.reduceOnly || '').trim().toLowerCase() === 'true',
      slippageBps: body.slippageBps ?? body.marketSlippageBps,
      cloid: body.cloid || body.clientOrderId || '',
      simulate: body.simulate === true || body.dryRun === true,
      reloadMeta: body.reloadMeta === true
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      mode: 'testnet',
      result
    });
  } catch (error) {
    const detail = hyperliquidAdapter.buildAdapterError(error);
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: detail.error || 'hyperliquid_order_failed',
      reason: detail.reason || 'hyperliquid order failed',
      response: detail.response || null
    });
  }
});

app.post('/api/hyperliquid/testnet/cancel', requireRole('agent'), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await hyperliquidAdapter.cancelPerpOrders({
      symbol: body.symbol || body.coin || 'BTCUSDT',
      oid: body.oid ?? body.orderId,
      oids: body.oids,
      simulate: body.simulate === true || body.dryRun === true,
      reloadMeta: body.reloadMeta === true
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      mode: 'testnet',
      result
    });
  } catch (error) {
    const detail = hyperliquidAdapter.buildAdapterError(error);
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: detail.error || 'hyperliquid_cancel_failed',
      reason: detail.reason || 'hyperliquid cancel failed',
      response: detail.response || null
    });
  }
});

app.get('/api/agent001/hyperliquid/status', requireRole('viewer'), async (req, res) => {
  const runtime = readSessionRuntime();
  const adapter = hyperliquidAdapter.info();
  const health = await hyperliquidAdapter.health();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    adapter,
    health,
    agent001: {
      payer: normalizeAddress(runtime?.aaWallet || ''),
      sessionAddress: normalizeAddress(runtime?.sessionAddress || ''),
      sessionId: String(runtime?.sessionId || '').trim()
    }
  });
});

app.post('/api/agent001/hyperliquid/order', requireRole('agent'), async (req, res) => {
  const body = req.body || {};
  const input = body?.plan && typeof body.plan === 'object' && !Array.isArray(body.plan) ? body.plan : body;
  const symbol = String(input.symbol || input.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
  const side = String(input.side || '').trim().toLowerCase();
  const orderType = String(input.orderType || input.type || 'limit').trim().toLowerCase() || 'limit';
  const tif = String(input.tif || (orderType === 'market' ? 'Ioc' : 'Gtc')).trim() || (orderType === 'market' ? 'Ioc' : 'Gtc');
  const size = Number(input.size ?? input.sz ?? NaN);
  const entryPrice = Number(input.entryPrice ?? input.price ?? NaN);
  const reduceOnly = input.reduceOnly === true || String(input.reduceOnly || '').trim().toLowerCase() === 'true';
  const simulate = input.simulate === true || input.dryRun === true;
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(body.payer || runtime?.aaWallet || '');
  const traceId = resolveWorkflowTraceId(body.traceId || createTraceId('agent001_api_hl_order'));

  if (!payer) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'payer_missing',
      reason: 'AA payer is required. Configure session runtime first.'
    });
  }
  if (!['buy', 'sell'].includes(side)) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'invalid_side',
      reason: 'side must be buy/sell'
    });
  }
  if (!['limit', 'market'].includes(orderType)) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'invalid_order_type',
      reason: 'orderType must be limit/market'
    });
  }
  if (!Number.isFinite(size) || size <= 0) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'invalid_size',
      reason: 'size must be a positive number'
    });
  }
  if (orderType === 'limit' && (!Number.isFinite(entryPrice) || entryPrice <= 0)) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'invalid_price',
      reason: 'limit order requires positive price'
    });
  }

  const plan = {
    canPlaceOrder: true,
    symbol,
    side,
    orderType,
    tif,
    size,
    entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
    reduceOnly,
    simulate
  };

  try {
    const result = await runAgent001HyperliquidOrderWorkflow({
      plan,
      payer,
      sourceAgentId: 'router-agent',
      targetAgentId: 'executor-agent',
      traceId
    });
    const payment = result?.payment || null;
    const receiptRef = result?.receiptRef || null;
    if (!hasStrictX402Evidence(payment)) {
      return res.status(502).json({
        ok: false,
        traceId: req.traceId || '',
        error: 'x402_evidence_missing',
        reason: 'hyperliquid workflow finished without strict x402 evidence',
        payment,
        workflow: result?.workflow || null
      });
    }
    const requestId = String(payment?.requestId || result?.requestId || '').trim();
    const txHash = String(payment?.txHash || result?.txHash || '').trim();
    const saved = upsertAgent001ResultRecord({
      requestId,
      capability: 'hyperliquid-order-testnet',
      stage: 'dispatch',
      status: 'done',
      toAgentId: 'executor-agent',
      payer,
      input: {
        symbol,
        side,
        orderType,
        tif,
        size,
        price: Number.isFinite(entryPrice) ? entryPrice : null,
        reduceOnly,
        simulate
      },
      payment,
      receiptRef,
      result: {
        summary: `Hyperliquid ${orderType} ${side} ${symbol} executed via agent001 api.`,
        workflowTraceId: String(result?.traceId || traceId).trim(),
        workflowState: String(result?.state || result?.workflow?.state || '').trim(),
        orderResult: result?.orderResult || null
      },
      source: 'agent001_api_order'
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      requestId,
      txHash,
      payment,
      receiptRef,
      workflow: result?.workflow || null,
      orderResult: result?.orderResult || null,
      agent001Result: saved
    });
  } catch (error) {
    const workflow = error?.workflow && typeof error.workflow === 'object' ? error.workflow : null;
    const requestId = String(error?.requestId || workflow?.requestId || '').trim();
    const workflowTraceId = String(error?.workflowTraceId || workflow?.traceId || '').trim();
    const failedStep = String(error?.failedStep || '').trim();
    const httpStatus = Number(error?.httpStatus || 0);
    const reason = String(error?.message || 'agent001 hyperliquid order failed').trim();
    return res.status(500).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'agent001_hyperliquid_order_failed',
      reason,
      statusCode: Number.isFinite(httpStatus) && httpStatus > 0 ? httpStatus : undefined,
      requestId: requestId || undefined,
      workflowTraceId: workflowTraceId || undefined,
      failedStep: failedStep || undefined,
      workflow
    });
  }
});

app.post('/api/agent001/chat/run', requireRole('agent'), async (req, res) => {
  const body = req.body || {};
  const text = String(body.text || body.message || '').trim();
  if (!text) {
    return res.status(400).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'text_required',
      reason: 'text is required'
    });
  }
  if (body.autoStart !== false) {
    await startXmtpRuntimes();
  }
  try {
    const reply = await handleRouterRuntimeTextMessage({ text });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      agentId: 'router-agent',
      reply
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      traceId: req.traceId || '',
      error: 'agent001_chat_failed',
      reason: error?.message || 'agent001 chat failed'
    });
  }
});

app.get('/api/agent001/results/:requestId', requireRole('viewer'), async (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  try {
    const resolved = await resolveAgent001ResultByRequestId(requestId);
    if (!resolved?.ok) {
      return res.status(Number(resolved?.statusCode || 400)).json({
        ok: false,
        traceId: req.traceId || '',
        requestId,
        error: resolved?.error || 'agent001_result_failed',
        reason: resolved?.reason || 'agent001 result query failed',
        payment: resolved?.payment || null
      });
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      requestId: resolved.requestId,
      capability: resolved.capability,
      status: resolved.status || 'done',
      source: resolved.source || 'stored',
      payment: resolved.payment || null,
      receiptRef: resolved.receiptRef || null,
      result: resolved.result || null,
      dm: resolved.dm || null,
      error: resolved.error || '',
      reason: resolved.reason || ''
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      traceId: req.traceId || '',
      requestId,
      error: 'agent001_result_failed',
      reason: error?.message || 'agent001 result query failed'
    });
  }
});

app.post('/api/analysis/info/run', requireRole('agent'), async (req, res) => {
  try {
    const body = req.body || {};
    const task = normalizeXReaderParams({
      url: body.url || body.resourceUrl || body.targetUrl,
      topic: body.topic || body.query || body.keyword,
      mode: body.mode || body.source || 'auto',
      maxChars: body.maxChars ?? X_READER_MAX_CHARS_DEFAULT
    });
    const result = await runInfoAnalysis({
      ...task,
      traceId: req.traceId || ''
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      provider: String(result?.provider || ANALYSIS_PROVIDER).trim() || ANALYSIS_PROVIDER,
      task,
      result
    });
  } catch (error) {
    return res.status(resolveAnalysisErrorStatus(error, 400)).json({
      ok: false,
      traceId: req.traceId || '',
      error: String(error?.code || 'info_analysis_failed').trim() || 'info_analysis_failed',
      reason: error?.message || 'info analysis failed'
    });
  }
});

app.post('/api/analysis/technical/run', requireRole('agent'), async (req, res) => {
  try {
    const body = req.body || {};
    const task = normalizeRiskScoreParams({
      symbol: body.symbol || body.pair || 'BTCUSDT',
      source: body.source || 'hyperliquid',
      horizonMin: body.horizonMin ?? 60
    });
    const result = await runRiskScoreAnalysis({
      ...task,
      traceId: req.traceId || ''
    });
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      provider: ANALYSIS_PROVIDER,
      task,
      result: result?.technical || result
    });
  } catch (error) {
    return res.status(resolveAnalysisErrorStatus(error, 400)).json({
      ok: false,
      traceId: req.traceId || '',
      error: String(error?.code || 'technical_analysis_failed').trim() || 'technical_analysis_failed',
      reason: error?.message || 'technical analysis failed'
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
  const effectiveAction = action === 'x-reader-feed' ? 'info-analysis-feed' : action;
  const supportedServiceActions = [
    'btc-price-feed',
    'risk-score-feed',
    'technical-analysis-feed',
    'x-reader-feed',
    'info-analysis-feed',
    'hyperliquid-order-testnet'
  ];
  if (!supportedServiceActions.includes(action)) {
    return res.status(400).json({
      ok: false,
      error: 'unsupported_service_action',
      reason: 'Supported action: btc-price-feed, risk-score-feed, technical-analysis-feed, x-reader-feed, info-analysis-feed, hyperliquid-order-testnet.'
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
    action: effectiveAction,
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
    const isTechnicalServiceAction = effectiveAction === 'risk-score-feed' || effectiveAction === 'technical-analysis-feed';
    const isInfoServiceAction = effectiveAction === 'info-analysis-feed';
    const invokePayload =
      isTechnicalServiceAction
        ? {
            traceId,
            sourceAgentId,
            targetAgentId,
            symbol: service.pair || 'BTCUSDT',
            horizonMin: Number(service.horizonMin || 60),
            source: service.source || 'hyperliquid',
            action: effectiveAction,
            payer
          }
        : isInfoServiceAction
          ? {
              traceId,
              sourceAgentId,
              targetAgentId,
              url: service.resourceUrl || service.exampleInput?.url || body.url || '',
              topic: body.topic || service.exampleInput?.topic || '',
              mode: service.source || service.mode || 'auto',
              maxChars: Number(service.maxChars || service.exampleInput?.maxChars || X_READER_MAX_CHARS_DEFAULT),
              action: effectiveAction,
              payer
            }
        : effectiveAction === 'hyperliquid-order-testnet'
          ? {
              traceId,
              sourceAgentId,
              targetAgentId,
              symbol: body.symbol || body.pair || service.pair || service.exampleInput?.symbol || 'BTCUSDT',
              side: body.side || service.exampleInput?.side || 'buy',
              orderType: body.orderType || body.type || service.exampleInput?.orderType || 'limit',
              price: body.price ?? service.exampleInput?.price ?? '',
              size: body.size ?? body.sz ?? service.exampleInput?.size ?? '',
              tif: body.tif || service.exampleInput?.tif || 'Gtc',
              reduceOnly:
                body.reduceOnly === true || String(body.reduceOnly || '').trim().toLowerCase() === 'true',
              slippageBps: body.slippageBps ?? body.marketSlippageBps,
              payer,
              bindRealX402: body.bindRealX402 !== false,
              strictBinding: body.strictBinding !== false,
              simulate: body.simulate === true || body.dryRun === true
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
      isTechnicalServiceAction
        ? '/api/workflow/risk-score/run'
        : isInfoServiceAction
          ? '/api/workflow/info/run'
          : effectiveAction === 'hyperliquid-order-testnet'
            ? '/api/workflow/hyperliquid-order/run'
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

app.get('/api/automation/trade-plan/status', requireRole('viewer'), (req, res) => {
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'agent001-trade-plan',
      ...getAutoTradePlanStatus()
    }
  });
});

app.post('/api/automation/trade-plan/start', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  startAutoTradePlanLoop({
    intervalMs: body.intervalMs,
    symbol: body.symbol,
    horizonMin: body.horizonMin,
    prompt: body.prompt,
    immediate: body.immediate !== false,
    reason: 'manual'
  });
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'agent001-trade-plan',
      ...getAutoTradePlanStatus()
    }
  });
});

app.post('/api/automation/trade-plan/stop', requireRole('admin'), (req, res) => {
  stopAutoTradePlanLoop();
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    automation: {
      type: 'agent001-trade-plan',
      ...getAutoTradePlanStatus()
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

app.get('/api/x402/maintenance/summary', requireRole('viewer'), (req, res) => {
  const now = Date.now();
  const rows = readX402Requests();
  const counts = computeX402StatusCounts(rows, now);
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    now,
    nowIso: new Date(now).toISOString(),
    storage: {
      cwd: process.cwd(),
      x402Path
    },
    persistence: persistenceStore.info(),
    counts
  });
});

app.post('/api/x402/maintenance/expire-stale', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const cleanup = expireStaleX402PendingRequests({
    dryRun: Boolean(body.dryRun),
    stalePendingMs: body.stalePendingMs,
    limit: body.limit,
    reason: String(body.reason || '').trim() || 'manual_cleanup'
  });
  return res.json({
    ok: true,
    traceId: req.traceId || '',
    cleanup
  });
});

// AA Session Payment Endpoint
app.post('/api/session/pay', requireRole('agent'), async (req, res) => {
  let failSessionPay = (status = 500, { error = 'payment_failed', reason = 'session pay failed', details = {} } = {}) =>
    res.status(status).json({ ok: false, error, reason, details });
  try {
    sessionPayMetrics.totalRequests += 1;
    failSessionPay = (status = 500, { error = 'payment_failed', reason = 'session pay failed', details = {} } = {}) => {
      const attemptsRaw = Number(details?.attempts || 0);
      const attempts = Number.isFinite(attemptsRaw) ? attemptsRaw : 0;
      const requestId = String(details?.requestId || '').trim();
      const category = markSessionPayFailure({
        errorCode: error,
        reason,
        traceId: req.traceId || '',
        requestId,
        attempts
      });
      return res.status(status).json({
        ok: false,
        error,
        reason,
        details: {
          ...details,
          reasonCategory: category
        }
      });
    };
    const runtime = readSessionRuntime();

    if (!runtime.sessionPrivateKey || !runtime.aaWallet) {
      return failSessionPay(400, {
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
      return failSessionPay(400, { error: 'invalid_tokenAddress', reason: 'tokenAddress must be a valid address.' });
    }
    const expectedSettlementToken = normalizeAddress(SETTLEMENT_TOKEN || '');
    if (
      expectedSettlementToken &&
      ethers.isAddress(expectedSettlementToken) &&
      normalizeAddress(tokenAddress) !== expectedSettlementToken
    ) {
      return failSessionPay(400, {
        error: 'unsupported_settlement_token',
        reason: `Unsupported settlement token. expected=${expectedSettlementToken}, got=${normalizeAddress(tokenAddress)}`
      });
    }
    if (!recipient || !ethers.isAddress(recipient)) {
      return failSessionPay(400, { error: 'invalid_recipient', reason: 'recipient must be a valid address.' });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return failSessionPay(400, { error: 'invalid_amount', reason: 'amount must be a positive number.' });
    }

    const decimals = 18;
    const amountRaw = ethers.parseUnits(String(amount), decimals);
    const sessionId = String(bodySessionId || runtime.sessionId || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
      return failSessionPay(400, {
        error: 'invalid_session_id',
        reason: 'sessionId is required. Sync runtime with sessionId from Agent Settings.',
        details: { requestId: String(requestId || '').trim() }
      });
    }

    const provider = new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const sessionWallet = new ethers.Wallet(runtime.sessionPrivateKey, provider);
    const sessionSignerAddress = await sessionWallet.getAddress();
    const serviceProvider = getServiceProviderBytes32(action);

    const accountCode = await provider.getCode(runtime.aaWallet);
    if (!accountCode || accountCode === '0x') {
      return failSessionPay(400, {
        error: 'aa_wallet_not_deployed_or_incompatible',
        reason: `No contract code found at runtime aaWallet: ${runtime.aaWallet}. Deploy AA account first, then recreate/sync session.`,
        details: {
          aaWallet: runtime.aaWallet,
          sessionId,
          requestId: String(requestId || '').trim()
        }
      });
    }
    let aaVersion = '';
    try {
      const versionReadAbi = ['function version() view returns (string)'];
      const versionContract = new ethers.Contract(runtime.aaWallet, versionReadAbi, provider);
      aaVersion = String(await versionContract.version()).trim();
    } catch {
      aaVersion = '';
    }
    if (KITE_REQUIRE_AA_V2 && aaVersion !== AA_V2_VERSION_TAG) {
      return failSessionPay(400, {
        error: 'aa_version_mismatch',
        reason: `AA must be upgraded to V2 for session-userop payments. required=${AA_V2_VERSION_TAG}, current=${aaVersion || 'unknown_or_legacy'}`,
        details: {
          aaWallet: runtime.aaWallet,
          requiredVersion: AA_V2_VERSION_TAG,
          currentVersion: aaVersion || '',
          requestId: String(requestId || '').trim()
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
      return failSessionPay(400, {
        error: 'session_not_found',
        reason: `Session not found on-chain: ${sessionId}`,
        details: { requestId: String(requestId || '').trim(), sessionId }
      });
    }
    if (String(agentAddr || '').toLowerCase() !== String(sessionSignerAddress).toLowerCase()) {
      return failSessionPay(400, {
        error: 'session_agent_mismatch',
        reason: `On-chain session agent mismatch. expected=${agentAddr}, current=${sessionSignerAddress}`,
        details: { requestId: String(requestId || '').trim(), sessionId }
      });
    }

    const erc20Abi = ['function balanceOf(address account) view returns (uint256)'];
    const tokenCode = await provider.getCode(tokenAddress);
    if (!tokenCode || tokenCode === '0x') {
      return failSessionPay(400, {
        error: 'invalid_token_contract',
        reason: `No contract code at tokenAddress: ${tokenAddress}`,
        details: { requestId: String(requestId || '').trim(), sessionId }
      });
    }
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    const aaBalance = await tokenContract.balanceOf(runtime.aaWallet);
    if (aaBalance < amountRaw) {
      return failSessionPay(400, {
        error: 'insufficient_funds',
        reason: `AA wallet ${runtime.aaWallet} has insufficient balance`,
        details: {
          aaWallet: runtime.aaWallet,
          balance: ethers.formatUnits(aaBalance, decimals),
          required: amount,
          requestId: String(requestId || '').trim(),
          sessionId
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
      return failSessionPay(400, {
        error: 'insufficient_kite_gas',
        reason: `AA wallet ${runtime.aaWallet} has insufficient KITE for gas. Need >= ${ethers.formatEther(minNativeGas)} KITE.`,
        details: {
          aaWallet: runtime.aaWallet,
          balance: ethers.formatEther(nativeBalance),
          required: ethers.formatEther(minNativeGas),
          requestId: String(requestId || '').trim(),
          sessionId
        }
      });
    }
    if (!rulePass) {
      return failSessionPay(400, {
        error: 'session_rule_failed',
        reason: 'Session spending rule precheck failed (amount/provider out of scope).',
        details: { requestId: String(requestId || '').trim(), sessionId }
      });
    }

    const sdk = new GokiteAASDK({
      network: 'kite_testnet',
      rpcUrl: BACKEND_RPC_URL,
      bundlerUrl: BACKEND_BUNDLER_URL,
      entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
      proxyAddress: runtime.aaWallet,
      bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS,
      bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
      bundlerRpcBackoffBaseMs: KITE_BUNDLER_RPC_BACKOFF_BASE_MS,
      bundlerRpcBackoffMaxMs: KITE_BUNDLER_RPC_BACKOFF_MAX_MS,
      bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS
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

    const maxAttempts = Math.max(1, Math.min(KITE_SESSION_PAY_RETRIES, 5));
    const payerLockKey = normalizeAddress(runtime.aaWallet || '') || String(runtime.aaWallet || '').trim().toLowerCase();
    const lockStartedAt = Date.now();
    const { result, attempts } = await withSessionUserOpLock(payerLockKey, async () => {
      let innerResult = null;
      let innerAttempts = 0;
      for (let i = 0; i < maxAttempts; i += 1) {
        innerAttempts = i + 1;
        innerResult = await sdk.sendSessionTransferWithAuthorizationAndProvider(
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
        if (innerResult?.status === 'success' && innerResult?.transactionHash) break;
        const reason = String(innerResult?.reason || '').trim();
        const retriable = isTransientTransportError(reason) || isUserOpReplacementFeeError(reason);
        if (!retriable || i >= maxAttempts - 1) break;
        markSessionPayRetry({ reason, errorCode: String(innerResult?.error || '').trim() });
        continue;
      }
      return { result: innerResult, attempts: innerAttempts };
    });
    const payElapsedMs = Math.max(0, Date.now() - lockStartedAt);
    const primaryReason = String(result?.reason || '').trim();
    const extractedUserOpHash = String(result?.userOpHash || extractUserOpHashFromReason(primaryReason)).trim();
    let finalResult = result;
    let signerMode = 'aa-session';
    let relaySender = '';
    let fallbackAttempted = false;
    let fallbackReason = '';

    if (!finalResult || finalResult.status !== 'success' || !finalResult.transactionHash) {
      if (KITE_ALLOW_EOA_RELAY_FALLBACK && shouldFallbackToEoaRelay(primaryReason)) {
        fallbackAttempted = true;
        const fallback = await sendSessionTransferViaEoaRelay({
          provider,
          aaWallet: runtime.aaWallet,
          sessionId,
          authPayload,
          authSignature,
          serviceProvider,
          metadata
        });
        if (fallback.ok && fallback.txHash) {
          signerMode = 'aa-session-eoa-relay';
          relaySender = String(fallback.relaySender || '').trim();
          finalResult = {
            status: 'success',
            transactionHash: fallback.txHash,
            userOpHash: extractedUserOpHash,
            receipt: {
              blockNumber: fallback.blockNumber || null
            }
          };
        } else {
          fallbackReason = String(fallback.reason || '').trim();
        }
      }
    }

    if (!finalResult || finalResult.status !== 'success' || !finalResult.transactionHash) {
      const reason = primaryReason || 'unknown';
      sessionPayMetrics.totalRetriesUsed += Math.max(0, Number(attempts || 1) - 1);
      if (fallbackAttempted) sessionPayMetrics.totalFallbackAttempted += 1;
      return failSessionPay(500, {
        error: 'aa_session_payment_failed',
        reason: fallbackReason
          ? `${reason}; eoa_relay_failed: ${fallbackReason}`
          : !KITE_ALLOW_EOA_RELAY_FALLBACK
            ? `${reason}; eoa_relay_disabled`
            : reason,
        details: {
          userOpHash: extractedUserOpHash,
          requestId: String(requestId || '').trim(),
          sessionId,
          payer: runtime.aaWallet,
          attempts,
          payElapsedMs,
          eoaRelayEnabled: KITE_ALLOW_EOA_RELAY_FALLBACK,
          fallbackAttempted,
          fallbackReason
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
      txHash: finalResult.transactionHash,
      userOpHash: extractedUserOpHash,
      status: 'success',
      requestId: requestId || '',
      signerMode,
      relaySender,
      agentId: ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : '',
      identityRegistry: ERC8004_IDENTITY_REGISTRY || '',
      aaWallet: runtime.aaWallet,
      sessionAddress: runtime.sessionAddress,
      sessionId,
      action
    };
    records.unshift(record);
    writeRecords(records);
    sessionPayMetrics.totalSuccess += 1;
    sessionPayMetrics.totalRetriesUsed += Math.max(0, Number(attempts || 1) - 1);
    if (fallbackAttempted) sessionPayMetrics.totalFallbackAttempted += 1;
    if (signerMode === 'aa-session-eoa-relay') sessionPayMetrics.totalFallbackSucceeded += 1;

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
        aaVersion,
        txHash: finalResult.transactionHash,
        userOpHash: extractedUserOpHash,
        payElapsedMs,
        eoaRelayEnabled: KITE_ALLOW_EOA_RELAY_FALLBACK,
        signerMode,
        relaySender,
        fallbackAttempted
      },
      message: 'AA session payment submitted and confirmed.'
    });

  } catch (error) {
    console.error('Session pay error:', error);
    return failSessionPay(500, {
      error: 'payment_failed',
      reason: error?.message || 'session pay failed'
    });
  }
});

let httpServer = null;

function logXmtpRuntimeStartup(name = '', runtimeStatus = null) {
  if (!runtimeStatus?.enabled) return;
  if (runtimeStatus?.running) {
    console.log(
      `[xmtp/${name}] env=${runtimeStatus.env} address=${runtimeStatus.address || '-'} inbox=${runtimeStatus.inboxId || '-'}`
    );
    return;
  }
  console.warn(`[xmtp/${name}] failed to start: ${runtimeStatus?.lastError || 'unknown_error'}`);
}

async function startServer() {
  await initializePersistence();
  ensureServiceCatalog();
  ensureNetworkAgents();
  httpServer = app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
    if (AUTO_TRADE_PLAN_ENABLED) {
      startAutoTradePlanLoop({
        intervalMs: AUTO_TRADE_PLAN_INTERVAL_MS,
        symbol: AUTO_TRADE_PLAN_SYMBOL,
        horizonMin: AUTO_TRADE_PLAN_HORIZON_MIN,
        prompt: AUTO_TRADE_PLAN_PROMPT,
        immediate: true,
        reason: 'startup'
      });
      console.log(
        `[auto-trade-plan] enabled intervalMs=${AUTO_TRADE_PLAN_INTERVAL_MS} symbol=${AUTO_TRADE_PLAN_SYMBOL} horizon=${AUTO_TRADE_PLAN_HORIZON_MIN}m`
      );
    }
  });
  if (XMTP_ANY_RUNTIME_ENABLED) {
    const status = await startXmtpRuntimes();
    logXmtpRuntimeStartup('router', status?.router);
    logXmtpRuntimeStartup('risk', status?.risk);
    logXmtpRuntimeStartup('reader', status?.reader);
    logXmtpRuntimeStartup('price', status?.price);
    logXmtpRuntimeStartup('executor', status?.executor);
    if (status?.router?.running && XMTP_AUTO_NETWORK_ENABLED) {
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
  }
}

async function shutdownServer() {
  stopAutoTradePlanLoop();
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


