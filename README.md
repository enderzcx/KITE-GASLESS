# KITECLAW

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-v1.6.1-blue)](./CHANGELOG.md)

KITECLAW is an agent-native payment app on Kite AI Testnet. It demonstrates how an autonomous agent can authenticate, pay with x402, and unlock services with verifiable on-chain proof.

Current Version: `v1.6.1`

## What This Project Demonstrates

- ERC-4337 AA account flow on Kite testnet
- Session-scoped delegated execution (one-time setup, repeated payments)
- x402 lifecycle: `402 -> pay -> submit proof -> 200 unlock`
- Verifiable agent identity (registry-backed)
- Auditable settlement mapping (`requestId <-> txHash`)
- Graceful failures (insufficient funds, scope violation, expired/fake proof)

## Kite Testnet Contribution (ERC-8004 Registries)

KITECLAW deployed and integrated 3 ERC-8004 registry contracts on Kite Testnet through a proxy-upgrade deployment flow:

- IdentityRegistry: `0x196cD2F30dF3dFA3ecD7D536db43e98Fd97fcC5f`
- ReputationRegistry: `0xD288Ce02a27f77Dc61Ce40FDa81F3dD6D51FF353`
- ValidationRegistry: `0xFEfcE81bCFA79130a60CD60D69336dadF3bb1569`

These contracts are part of our open implementation contribution for verifiable agent identity and registry-based agent trust signals on Kite Testnet.

## AA-v2 Security Note

`aa-v2` is not only a development process artifact; it is the implementation path that produces the final result:

- One-time owner authorization to create a scoped session key
- Repeated transfers/payments without repeated wallet confirmation
- Enforced boundaries: recipient scope, per-tx limit, daily limit, session window

So for this project, `aa-v2` represents both the secure implementation mechanism and the achieved UX outcome (single authorization, then autonomous constrained execution).

## Real Demo Flow (Current Implementation)

1. Open app and connect wallet.
2. In Dashboard, create session key and apply policy rules.
3. Send paid request in Chat Agent:
   - Example: `A2A stop-order BTC-USDT TP 70000 SL 62000 QTY 0.1`
4. Backend runs workflow automatically:
   - identity verification
   - challenge issued
   - payment sent
   - proof submitted
   - unlock returned
5. Send second request to show no repeated wallet popup.
6. Send high-amount request to show failure handling:
   - Example: `A2A stop-order BTC-USDT TP 70000 SL 62000 QTY 1000`
   - Expected: insufficient balance path (clear error + red failed state)
7. Verify records in:
   - x402 settlement mapping table
   - Goldsky on-chain audit page

## Architecture

`Frontend (React) -> Backend (Express) -> OpenClaw Adapter -> OpenClaw`

`Backend also provides x402 gateway + policy engine + workflow orchestration + SSE events`

## Repository Structure (Minimal Kept Set)

```text
KITE GASLESS/
|- frontend/     # React + Vite UI
|- backend/      # Express API + x402 + workflow + identity
|- aa-v2/        # AA security implementation for one-time auth + constrained no-popup execution
|- skills/       # OpenClaw skill source + packaged skill
|- goldsky/      # Goldsky subgraph config/ABI used for audit flow
|- README.md
|- CHANGELOG.md
|- LICENSE
```

## Quick Start

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Frontend URL: `http://localhost:5173`

### Backend
```bash
cd backend
npm install
cp .env.example .env
npm start
```
Backend URL: `http://localhost:3001`

## OpenClaw Runtime Configuration (Recommended)

Set in `backend/.env`:

```env
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_CHAT_PROTOCOL=openai
OPENCLAW_CHAT_PATH=/v1/chat/completions
OPENCLAW_HEALTH_PATH=/v1/models
OPENCLAW_TIMEOUT_MS=12000
OPENCLAW_MODEL=kimi-coding/k2p5
```

## OpenClaw Skill Package

### Source Skill
- Folder: `skills/kiteclaw-stop-orders/`

### Packaged Skill
- Zip: `skills/releases/kiteclaw-stop-orders-v1.6.1.zip`

### Install Packaged Skill
1. Unzip `skills/releases/kiteclaw-stop-orders-v1.6.1.zip`.
2. Place the extracted `kiteclaw-stop-orders` folder into your OpenClaw/Codex skills directory.
3. Restart the runtime so the skill is indexed.

### Rebuild Skill Package
From repo root (PowerShell):

```powershell
New-Item -ItemType Directory -Force -Path skills/releases | Out-Null
Compress-Archive -Path "skills/kiteclaw-stop-orders/*" -DestinationPath "skills/releases/kiteclaw-stop-orders-v1.6.1.zip" -Force
```

### Skill Usage (Scripted Flow)

Inside the skill package/scripts, run:

1. `request-challenge.ps1` (expect x402 challenge)
2. `run-stop-order-flow.ps1` (or pay + submit proof manually)
3. `get-status.ps1` (workflow/status)
4. `get-evidence.ps1` (payment evidence)

All scripts target backend endpoints documented in `skills/kiteclaw-stop-orders/references/api.md`.

## License

MIT License. See `LICENSE`.
