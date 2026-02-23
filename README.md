# KiteTrace Platform

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-v1.8.0-blue)](./CHANGELOG.md)

KiteTrace Platform: agent-native micropayment rails on Kite Testnet, using ERC8004 identity + x402 for verifiable ATAPI/A2A interactions.

**About**:
- Enables agents to publish/consume services and settle per action with x402.
- Uses ERC8004 identity and direct on-chain confirmation (`requestId`, `txHash`, `block`, `status`, explorer link).
- BTCUSD minute-level loop is a live demo scenario; platform supports broader agent services.

Current Version: `v1.8.0`

## Availability

### Public Web Demo

- Live URL: `https://kiteclaw.duckdns.org`
- Status: publicly available deployment on Kite Testnet.
- Purpose: judge-facing online demo for end-to-end flow validation.
- Expected pages:
  - Demo Home (`/`) - paid BTC line chart + ERC8004/x402 flow card
  - Ops Console (`/ops`) - KPI/traces/events/evidence/session setup

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
- Paid BTC quote workflow (`btc-price-feed`) with quote provider attribution
- Agent-to-agent and agent-to-api flow evidence in one console
- BTC quote loop is a sample scenario; platform model supports publishing and consuming arbitrary agent services
- BTC demo summary wording uses `ATAPI` for the paid quote path to avoid A2A naming confusion.
- Verifiable agent identity (registry-backed)
- Auditable settlement mapping (`requestId <-> txHash`)
- Direct on-chain confirmation without indexer dependency:
  - `txHash`
  - `block`
  - `status`
  - `explorer link`
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

1. Open `/` and click `Run Demo` (success path) or `Fail Demo` (graceful failure path).
2. Backend runs BTC paid workflow:
   - ERC8004 identity
   - x402 challenge
   - session payment
   - proof verification
   - API result unlock (quote)
   - on-chain confirmation presentation (`txHash / block / status / explorer link`)
3. Homepage chart appends only paid/unlocked BTC points.
4. Open `/ops` for operational evidence:
   - recent traces
   - live event feed
   - evidence drawer
   - session setup panel
   - guardrail-driven failure replay (`Fail Demo`)
5. Optional continuous demo:
   - start automation to run BTC request every minute.

## Core API Endpoints (Current)

- `POST /api/workflow/btc-price/run`
- `GET /api/demo/price-series?limit=60`
- `GET /api/demo/trace/:traceId`
- `GET /api/demo/stream` (SSE)
- `GET /api/x402/mapping/latest`
- `GET /api/market/btc/price`
- `GET /api/automation/btc-price/status`
- `POST /api/automation/btc-price/start`
- `POST /api/automation/btc-price/stop`
- `POST /api/policy/revoke`
- `POST /api/policy/unrevoke`

## Runtime Notes (Testnet)

- Kite testnet RPC/bundler may occasionally return transient errors such as:
  - `request timeout (code=TIMEOUT, version=6.16.0)`
  - `read ECONNRESET`
  - `fetch failed`
- Workflow now includes retry logic for session-pay transient failures, but occasional failed traces are still possible on unstable network windows.
- For judge demos, pre-run a few traces so the chart already has successful paid points.

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
- `AUTO_BTC_PRICE_ENABLED=1`
- `AUTO_BTC_PRICE_INTERVAL_MS=60000`
- `AUTO_BTC_PRICE_PAYER=<your AA wallet>`
- `IDENTITY_VERIFY_MODE=registry_only` (recommended for public demo websites)
- OpenClaw remote API settings (`OPENCLAW_BASE_URL`, `OPENCLAW_MODEL`, etc.)

Validate production env before deploy:

```bash
bash deploy/scripts/validate-prod-env.sh backend/.env
```

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

`deploy.sh` now validates backend production env before build/restart. It will fail fast if key fields are missing or invalid.

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

### 4.1) Freeze PM2 startup on reboot

```bash
pm2 save
pm2 startup systemd -u root --hp /root
```

After running `pm2 startup`, copy and execute the generated command once.

### 5) Smoke checks

```bash
curl -sS https://your-subdomain.duckdns.org/api/chat/agent/health
curl -N https://your-subdomain.duckdns.org/api/events/stream?traceId=test
```

Expected:
- health endpoint returns `{"ok":true,...}`
- SSE endpoint returns `connected` and `ping` events

Check minute loop status (server-side ATAPI polling):

```bash
curl -sS https://your-subdomain.duckdns.org/api/automation/btc-price/status
```

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


