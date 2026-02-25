# XMTP Agent Quickstart Sandbox

Standalone XMTP agent demo aligned with the official `build-an-agent` flow.
Current behavior: rule-based replies (not LLM).

## 1) Install

```powershell
npm install
```

## 2) Configure `.env`

Copy `.env.example` to `.env`, then fill:

- `XMTP_ENV=dev` (or `production` / `local`)
- `XMTP_WALLET_KEY=0x...` (agent wallet private key)
- `XMTP_DB_ENCRYPTION_KEY=<64 hex chars>`
- `XMTP_DB_DIRECTORY=.xmtp-db` (keep stable across restarts)
- `AGENT_SELF_HEAL_ENABLED=1` (auto-restart on stream transport errors)

## 3) Start

```powershell
npm start
```

Expected logs:

- `Agent started`
- `Address`
- `Inbox ID`
- `Test URL`
- `Waiting for messages...`

## 4) DM test checklist

1. Open `Test URL` in browser.
2. Send from a different wallet than the agent wallet.
3. Keep this process running and watch terminal logs:
   - `[text] from=... content="..."`
   - `[text] reply sent`

Rule examples:

- `hi` -> greeting
- `How are you?` -> status
- `time` -> UTC time
- `echo hello` -> `hello`
- `/help` -> command list

## 5) If no reply

1. Check env keys are correct: `XMTP_WALLET_KEY`, `XMTP_DB_ENCRYPTION_KEY`.
2. Keep `XMTP_DB_DIRECTORY` fixed (do not rotate every run).
3. Reuse one agent wallet instead of creating many installations.
4. Inspect terminal `unhandledError` logs.

## 6) Auto self-heal knobs

- `AGENT_SELF_HEAL_ENABLED` default `1`
- `AGENT_SELF_HEAL_COOLDOWN_MS` default `5000`
- `AGENT_SELF_HEAL_WINDOW_MS` default `600000` (10 min)
- `AGENT_SELF_HEAL_MAX_RESTARTS` default `8`
