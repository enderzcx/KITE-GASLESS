# KITECLAW

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-v1.6.1-blue)](./CHANGELOG.md)

KITECLAW is an agent-native payment app on Kite AI Testnet. It demonstrates how an autonomous agent can authenticate, pay with x402, and unlock services with verifiable on-chain proof.

Current Version: `v1.6.1`

## Availability

### Public Web Demo

- Live URL (testing): `https://kiteclaw.duckdns.org`
- Status: public deployment is under active testing; some flows may still be unstable on cloud runtime.
- Purpose: judge-facing online demo for end-to-end flow validation.
- Expected pages:
  - Dashboard (`/`)
  - Transfer Records
  - Audit / On-chain confirmation

### Local Reproducible Version

- This repository can be run fully on local machine for reproducible review.
- Status: local end-to-end flow is validated and runnable.
- Use `frontend/.env.example` + `backend/.env.example` for local startup.
- Core local entrypoints:
  - frontend: `npm run dev` (Vite)
  - backend: `npm start` (Express)

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

Others can reuse our `GokiteAccountV2` implementation address to upgrade their own owner-controlled proxies.
Upgrade authority remains with each proxy owner; this project does not grant permission to upgrade third-party proxies.

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
5. Send second request to show no repeated payment-authorization popup.
   - Note: if signature-based identity verification is enabled, wallet signature popup may still appear for identity proof.
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
|- deploy/       # Nginx + PM2 + deploy/backup scripts for cloud rollout
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
OPENCLAW_MODEL=<your_model_id>
# e.g. kimi-coding/k2p5 | qwen2.5-coder | deepseek-chat
```

Notes:
- `OPENCLAW_CHAT_PROTOCOL` and `OPENCLAW_CHAT_PATH` must match your runtime API shape.
- `OPENCLAW_MODEL` should be your local/remote model id (do not hardcode one contributor's model in shared deployments).
- If `OPENCLAW_HEALTH_PATH=/v1/models` returns HTML instead of JSON, you likely hit a control UI route instead of an OpenAI-compatible API route.

## Tencent Lighthouse Web Deployment (Low Cost)

Target stack: `Nginx + Node backend + React dist` on one host, same domain for `/` and `/api`.

### 1) Prepare server

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo npm i -g pm2
```

Install Node.js 20 if needed:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Create runtime folders:

```bash
sudo mkdir -p /srv/kiteclaw/{app,data,logs,www,backups}
sudo chown -R $USER:$USER /srv/kiteclaw
```

### 2) Configure env files

```bash
cp backend/.env.production.example backend/.env
cp frontend/.env.production.example frontend/.env.production
```

Fill `backend/.env` with real values:
- `KITECLAW_BACKEND_SIGNER_PRIVATE_KEY`
- `ERC8004_IDENTITY_REGISTRY`
- `ERC8004_AGENT_ID`
- `IDENTITY_VERIFY_MODE=registry_only` (recommended for public demo websites)
- OpenClaw remote API settings (`OPENCLAW_BASE_URL`, `OPENCLAW_MODEL`, etc.)

If session payment fails with `sessionExists BAD_DATA`, ensure AA account is deployed first:

```bash
cd backend
npm run aa:ensure -- --owner 0xYourOwnerEOA
```

### 3) Deploy app

```bash
export REPO_URL=https://github.com/enderzcx/KITE-GASLESS.git
export BRANCH=main
bash deploy/scripts/deploy.sh
```

Apply nginx site:

```bash
sudo cp deploy/nginx/kiteclaw.conf /etc/nginx/sites-available/kiteclaw.conf
sudo sed -i 's/__SERVER_NAME__/your-subdomain.duckdns.org/g' /etc/nginx/sites-available/kiteclaw.conf
sudo ln -sf /etc/nginx/sites-available/kiteclaw.conf /etc/nginx/sites-enabled/kiteclaw.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 4) Enable HTTPS (DuckDNS + Let's Encrypt)

```bash
sudo certbot --nginx -d your-subdomain.duckdns.org
```

### 5) Smoke checks

```bash
curl -sS https://your-subdomain.duckdns.org/api/chat/agent/health
curl -N https://your-subdomain.duckdns.org/api/events/stream?traceId=test
```

Expected:
- health endpoint returns `{"ok":true,...}`
- SSE endpoint returns `connected` and `ping` events

### 6) Data backup

```bash
bash deploy/scripts/backup-data.sh
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
