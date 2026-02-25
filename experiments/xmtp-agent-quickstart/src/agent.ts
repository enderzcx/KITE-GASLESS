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

agent.on("unhandledError", (error) => {
  console.error("[unhandledError]", error);
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
