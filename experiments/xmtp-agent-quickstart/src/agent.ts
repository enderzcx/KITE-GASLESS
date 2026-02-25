import fs from "node:fs";
import path from "node:path";
import { Agent, getTestUrl, logDetails } from "@xmtp/agent-sdk";

if (typeof process.loadEnvFile === "function") {
  const envFile = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

const normalizeEnv = (value: string): "local" | "dev" | "production" => {
  const text = String(value || "").trim().toLowerCase();
  if (text === "local" || text === "production") return text;
  return "dev";
};

const walletFromLegacy = String(process.env.WALLET_KEY || "").trim();
if (!process.env.XMTP_WALLET_KEY && walletFromLegacy) {
  process.env.XMTP_WALLET_KEY = walletFromLegacy;
}
if (!process.env.XMTP_DB_DIRECTORY) {
  process.env.XMTP_DB_DIRECTORY = path.resolve(process.cwd(), ".xmtp-db");
}

const env = normalizeEnv(String(process.env.XMTP_ENV || "dev"));
process.env.XMTP_ENV = env;

const walletKeyRaw = String(process.env.XMTP_WALLET_KEY || "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(walletKeyRaw)) {
  console.error("Missing or invalid XMTP_WALLET_KEY (must be 0x + 64 hex).");
  process.exit(1);
}

const dbEncryptionRaw = String(process.env.XMTP_DB_ENCRYPTION_KEY || "").trim();
const dbEncryptionHex = dbEncryptionRaw.startsWith("0x")
  ? dbEncryptionRaw.slice(2)
  : dbEncryptionRaw;
if (!/^[0-9a-fA-F]{64}$/.test(dbEncryptionHex)) {
  console.error("Missing or invalid XMTP_DB_ENCRYPTION_KEY (must be 64 hex chars).");
  process.exit(1);
}
process.env.XMTP_DB_ENCRYPTION_KEY = dbEncryptionHex;

const startTimeoutMs = Math.max(
  10_000,
  Number(process.env.AGENT_START_TIMEOUT_MS || 60_000)
);
const selfHealEnabled = !/^(0|false|no|off)$/i.test(
  String(process.env.AGENT_SELF_HEAL_ENABLED || "1").trim()
);
const selfHealCooldownMs = Math.max(
  1_000,
  Number(process.env.AGENT_SELF_HEAL_COOLDOWN_MS || 5_000)
);
const selfHealWindowMs = Math.max(
  60_000,
  Number(process.env.AGENT_SELF_HEAL_WINDOW_MS || 600_000)
);
const selfHealMaxRestarts = Math.max(
  1,
  Number(process.env.AGENT_SELF_HEAL_MAX_RESTARTS || 8)
);

const waitMs = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

const isStreamingTransportError = (error: unknown) => {
  const text = String(
    (error as { message?: string })?.message || error || ""
  ).toLowerCase();
  return (
    text.includes("agentstreamingerror") ||
    text.includes("conversation streaming") ||
    text.includes("subscribewelcomemessages") ||
    text.includes("h2 protocol error") ||
    text.includes("error reading a body from connection") ||
    text.includes("genericfailure") ||
    text.includes("stream")
  );
};

console.log(`Booting XMTP agent (env=${env}) ...`);
console.log(`DB directory: ${process.env.XMTP_DB_DIRECTORY}`);

const agent = await Promise.race([
  Agent.createFromEnv(),
  new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Agent.createFromEnv timeout after ${startTimeoutMs}ms`)),
      startTimeoutMs
    )
  ),
]);

let selfHealInProgress = false;
let selfHealLastAt = 0;
const selfHealAttemptAt: number[] = [];

const selfHealStreaming = async (trigger: unknown) => {
  if (!selfHealEnabled) return;
  if (selfHealInProgress) return;

  const now = Date.now();
  if (now - selfHealLastAt < selfHealCooldownMs) {
    return;
  }
  while (
    selfHealAttemptAt.length > 0 &&
    now - selfHealAttemptAt[0] > selfHealWindowMs
  ) {
    selfHealAttemptAt.shift();
  }
  if (selfHealAttemptAt.length >= selfHealMaxRestarts) {
    console.error(
      `[self-heal] skipped: restart limit reached (${selfHealMaxRestarts}/${Math.round(
        selfHealWindowMs / 1000
      )}s)`
    );
    return;
  }

  selfHealInProgress = true;
  selfHealLastAt = now;
  selfHealAttemptAt.push(now);
  console.warn("[self-heal] streaming error detected, restarting agent...");
  console.warn(
    "[self-heal] trigger:",
    String((trigger as { message?: string })?.message || trigger || "")
  );
  try {
    await agent.stop().catch(() => {});
    await waitMs(800);
    await agent.start();
    console.log("[self-heal] agent restarted");
  } catch (error) {
    console.error("[self-heal] restart failed:", error);
  } finally {
    selfHealInProgress = false;
  }
};

agent.on("unhandledError", (error) => {
  console.error("[unhandledError]", error);
  if (isStreamingTransportError(error)) {
    void selfHealStreaming(error);
  }
});

agent.on("unknownMessage", (ctx) => {
  console.warn("[unknownMessage]", {
    conversationId: String(ctx.conversation?.id || ""),
    senderInboxId: String(ctx.message?.senderInboxId || ""),
  });
});

agent.on("dm", (ctx) => {
  console.log("[dm] new conversation:", String(ctx.conversation?.id || "-"));
});

agent.on("text", async (ctx) => {
  const incoming = String(ctx.message?.content || "").trim();
  const senderAddress = await ctx
    .getSenderAddress()
    .catch(() => "");
  const sender = String(senderAddress || "").trim().toLowerCase();
  const selfAddress = String(agent.address || "").trim().toLowerCase();
  console.log(`[text] from=${sender || "unknown"} content="${incoming}"`);

  if (sender && selfAddress && sender === selfAddress) {
    console.log("[text] ignore self message");
    return;
  }

  const reply = `echo: ${incoming || "gm"}`;
  try {
    await ctx.sendTextReply(reply);
    console.log("[text] reply sent");
  } catch (error) {
    console.error("[text] reply failed:", error);
  }
});

await agent.start();

console.log("Agent started");
console.log("Address:", agent.address);
console.log("Inbox ID:", agent.client.inboxId);
console.log("Test URL:", getTestUrl(agent.client));
console.log("Waiting for messages...");
await logDetails(agent).catch(() => {});

const shutdown = async () => {
  await agent.stop().catch(() => {});
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
