import { Agent, createSigner, createUser, getTestUrl } from "@xmtp/agent-sdk";

const walletKey = String(process.env.WALLET_KEY || "").trim();
const envRaw = String(process.env.XMTP_ENV || "dev").trim().toLowerCase();
const env = envRaw === "local" || envRaw === "production" ? envRaw : "dev";
const startTimeoutMs = Math.max(10_000, Number(process.env.AGENT_START_TIMEOUT_MS || 60_000));

if (!walletKey) {
  console.error("Missing WALLET_KEY. Set it in your shell env before running.");
  process.exit(1);
}

console.log(`Booting XMTP agent (env=${env}) ...`);
const signer = createSigner(createUser(walletKey as `0x${string}`));
const agent = await Promise.race([
  Agent.create(signer, { env }),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Agent.create timeout after ${startTimeoutMs}ms`)), startTimeoutMs)
  )
]);
await agent.start();

console.log("Agent started");
console.log("Address:", agent.address);
console.log("Inbox ID:", agent.client.inboxId);
console.log("Test URL:", getTestUrl(agent.client));
console.log("Waiting for messages...");

agent.on("message:text", async (context) => {
  const incoming = String(context.message.content || "").trim();
  console.log("Incoming:", incoming);
  await context.respond(`echo: ${incoming || "gm"}`);
});

process.on("SIGINT", async () => {
  await agent.stop();
  process.exit(0);
});
