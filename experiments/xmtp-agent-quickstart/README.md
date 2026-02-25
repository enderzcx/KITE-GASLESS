# XMTP Agent Quickstart Sandbox

Standalone XMTP agent demo aligned with the official `build-an-agent` flow.

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

## 5) If no reply

1. Check env keys are correct: `XMTP_WALLET_KEY`, `XMTP_DB_ENCRYPTION_KEY`.
2. Keep `XMTP_DB_DIRECTORY` fixed (do not rotate every run).
3. Reuse one agent wallet instead of creating many installations.
4. Inspect terminal `unhandledError` logs.

