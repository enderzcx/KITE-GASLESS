# KITECLAW

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-v1.6.0-blue)](./CHANGELOG.md)
[![Demo Status](https://img.shields.io/badge/demo-ready-brightgreen)](#demo-walkthrough-for-humans)

KITECLAW (formerly KITE GASLESS) is an agent-native payment demo on **KiteAI Testnet**.

Current Version: `v1.6.0`

## Why this project is different (Core Innovations)

### 1) Upgraded AA contract path (built on Kite testnet AA stack)
We did not stay at plain wallet transfer.

KITECLAW uses Kite testnet AA (ERC-4337 account abstraction flow) and extends it with **session-scoped delegated payment execution**:
- one-time owner auth/session setup
- repeated paid actions without repeated wallet popups
- rule-constrained execution (per-tx limit, daily limit, recipient scope)
- provider-aware authorization path for paid actions

In short: **ERC-4337 + session delegation + rule enforcement** to approach one-time authorization UX.

### AA evolution: from old insecure shortcut to scoped delegation

Previous demo shortcut (legacy path):
- used EIP-3009-style transfer authorization for convenience
- to avoid repeated popup confirmations, backend signer/private key custody was introduced
- this is practical for demo speed, but **not a secure production posture** (custodial key risk)

Current KITECLAW path:
- one-time owner authorization creates a **session key + scoped rules** on AA account
- subsequent payments are signed by the session key under enforced constraints:
  - recipient allowlist
  - per-tx limit
  - daily limit
  - time window / session validity
- this achieves “one-time setup, repeated execution” without repeated owner confirmations in normal flow

Important scope note:
- this is still a testnet MVP
- production-grade custody should move to KMS/HSM/MPC and stronger session lifecycle controls

### 2) Self-deployed ERC-8004-style identity registry on Kite testnet
Because Kite testnet did not provide a ready ERC-8004 identity contract for this demo path, we deployed our own registry-compatible identity contract and integrated:
- agent registration
- identity lookup and verification in backend
- identity evidence rendering in frontend (`agentId / registry / wallet`)

Anyone can read and integrate this registry/identity flow from this repo.

### 3) Self-hosted x402 gateway server (not vendor black-box)
KITECLAW runs its own x402-style gateway and policy engine:
- `402 -> pay -> submit proof -> 200 unlock`
- strict action-payment mapping (`requestId <-> txHash`)
- proof verification upgraded to on-chain transfer-log matching (not local record-only)
- graceful failure paths (expired proof, fake proof, insufficient funds, scope violation)
- policy kill switch (revoke/unrevoke payer)
- auditable evidence records

This makes the flow transparent, reproducible, and judge-verifiable.

### 4) Security model highlights
- no repeated root-key signing after session setup (demo scope)
- rule-based delegation (scope/limit/window)
- on-chain payment proof verification before unlock (receipt + ERC20 Transfer log checks)
- explicit abuse/failure logs for safety evidence

## What this repo demonstrates

- Agent authentication (one-time wallet auth)
- AA lifecycle: address derivation + first-use deployment path
- Session-based delegated execution (rules + limits + recipient scope)
- x402 flow: `402 -> on-chain pay -> on-chain proof verify -> 200 unlock`
- Verifiable identity read from ERC-8004-style registry
- On-chain confirmation and reconciliation UI
- Abuse/over-limit graceful failure with evidence logs

## Why x402 and Goldsky are both shown (not duplicate)

- `x402 settlement confirmation` answers: **"Did this paid action actually settle and unlock?"**
  - source: challenge/proof/payment mapping (`requestId <-> txHash`)
  - used for action-level payment correctness
- `Goldsky audit evidence` answers: **"Can an independent indexer observe and verify this on-chain transfer?"**
  - source: indexed on-chain transfer data (subgraph)
  - used for third-party auditability and reconciliation

In short: x402 is the payment-unlock execution truth, Goldsky is independent indexed audit truth.

## x402 Layer Mapping (this project)

| x402 Layer | This project |
|---|---|
| Application | Paid agent actions (`kol-score`, `reactive-stop-orders`) |
| Declaration | x402 challenge + proof payload (`requestId`, token, amount, recipient, action) |
| Transport | HTTP APIs between frontend and backend |
| Scheme | exact-style per-action payment |
| Network | KiteAI Testnet |
| Asset | USDT settlement token (KITE used for testnet operation path) |
| Mechanism | ERC-4337 AA + session/rule checks + transfer authorization path |

## Action Implementation Status

| Action | Type | Current status |
|---|---|---|
| `kol-score` | agent-to-API reference action | Implemented as demo/mock paid API. Full x402 flow is live (`402 -> pay -> proof -> 200`). Business payload is sample data. |
| `reactive-stop-orders` | agent-to-agent demo action | Payment + parameter flow implemented (`symbol`, `takeProfit`, `stopLoss`). This is used as a workflow demo carrier; full trading strategy engine is intentionally out of current scope. |

---

## OpenClaw First: Integration Guide (for agents)

If your goal is autonomous execution via OpenClaw, start here first.

### Local Native Mode (recommended for current phase)
- UI chat is native React (no iframe/widget)
- Frontend talks only to your backend
- Backend proxies/adapts OpenClaw runtime via adapter layer

Flow:
`Frontend -> /api/chat/agent -> OpenClaw Adapter -> OpenClaw Runtime/Gateway (optional)`

Health endpoint:
- `GET /api/chat/agent/health`
  - returns `connected`, `mode`, `reason`

### 1) Skill package
- Skill folder: `skills/kiteclaw-stop-orders/`
- Packaged zip example: `kiteclaw-v1.0.1-*.zip`

### 2) Required backend endpoints
- `POST /api/skill/openclaw/invoke`
- `GET /api/skill/openclaw/status/:requestId`
- `GET /api/skill/openclaw/evidence/:requestId`
- `GET /api/session/runtime/secret` (runtime session source)
- `POST /api/workflow/stop-order/run` (one-click orchestration)
- `GET /api/workflow/:traceId` (timeline/status fetch)

### 3) One-time human setup (for agent autonomy)
Before OpenClaw runs fully autonomous:
1. Open frontend `/dashboard`
2. Click `Generate Session Key & Apply Rules`
3. Confirm runtime is marked ready in status card

Then OpenClaw scripts can read latest runtime session and execute without re-entering payer/session parameters.

### 4) OpenClaw flow
1. Request challenge (`invoke`, phase-1) -> expect `402`
2. Pay on-chain with challenge fields
3. Submit proof (`invoke`, phase-2)
4. Poll status + fetch evidence

Or use orchestrated flow:
1. Call `POST /api/workflow/stop-order/run`
2. Backend runs `challenge -> pay -> proof -> unlock`
3. Poll `GET /api/workflow/:traceId` for timeline

### 5) Script helpers
In `skills/kiteclaw-stop-orders/scripts/`:
- `request-challenge.ps1`
- `submit-proof.ps1`
- `get-status.ps1`
- `get-evidence.ps1`
- `get-runtime.ps1`
- `run-stop-order-flow.ps1`

Detailed format: `OPENCLAW_SKILL_INTEGRATION.md`

---

## Human UI Guide (for manual demo)

### Quick Start

#### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Frontend: `http://localhost:5173`

#### Backend
```bash
cd ../backend
npm install
cp .env.example .env
npm start
```
Backend: `http://localhost:3001`

### Demo walkthrough (for humans)
1. Open app and connect wallet
2. Authenticate once
3. Open `Dashboard` and create session + rules
4. In `Dashboard`, run `Place Stop Order (One-click Workflow)`
5. Show workflow timeline (`challenge_issued -> payment_sent -> proof_submitted -> unlocked`)
6. Optionally show manual path in `Transfer`:
   - click `Request Payment Info (402)`
   - click `Pay & Submit Proof`
7. Show:
   - x402 settlement mapping panel
   - Goldsky audit evidence page
   - transfer records page
   - abuse/limit graceful failure page

## Iteration Progress

| Iteration | Status | Notes |
|---|---|---|
| Iteration 1 (MVP dashboard) | Mostly Done | `/dashboard`, KPI, Chat panel, Session/x402/On-chain/Identity cards, 3s polling, `GET /api/session/runtime`, `GET /api/x402/mapping/latest`, `GET /api/identity/current`, `GET /api/onchain/latest`, `POST /api/chat/agent` |
| Iteration 2 (automation core) | Done | `POST /api/workflow/stop-order/run`, `GET /api/workflow/:traceId`, real `POST /api/session/pay`, `GET /api/events/stream` (SSE), timeline + failure reason + live event feed UI |
| Iteration 3 (productization/multi-agent) | In Progress | `GET /api/evidence/export` + Dashboard export button done; API key role auth is now added (`admin/agent/viewer`) + policy aliases (`/api/policy/update|revoke|unrevoke`) done; multi-agent admin and request signing/rate-limit still pending |

---

## ETHDenver KiteAI Requirement Mapping

| Requirement | Status | Evidence in this repo |
|---|---|---|
| Build on Kite AI Testnet/mainnet | Done | Kite testnet RPC/Bundler/USDT config + running flow |
| Use x402-style payment flows | Done | `402 -> pay -> on-chain proof verify -> 200` in Transfer and `/api/x402/*` |
| Verifiable agent identity | Done | ERC-8004-style identity endpoint + identity card |
| Demonstrate autonomous execution | Done (demo scope) | One-time setup then repeated paid actions without repeated confirmation |
| Open-source core components | Done | Public repo + reproducible local setup |
| Correct x402 action-payment mapping | Done | `requestId <-> txHash` mapping in logs/UI |
| Graceful abuse/insufficient-funds handling | Done | Abuse page + policy failure logs + explicit rejection |
| Security controls (scope/limits/revocation) | Done | per-tx/daily limits, recipient scope, revoke/unrevoke |

## A2A Demo Evidence Checklist

For `reactive-stop-orders`:
1. Transfer page: select action and fill `symbol/takeProfit/stopLoss`
2. Click `Request Payment Info (402)`
3. Confirm x402 mapping: flow mode, source/target agent, requestId
4. Click `Pay & Submit Proof`
5. Show on-chain confirmation + records + evidence

## Environment Variables

### Frontend (`frontend/.env`)
```env
VITE_API_BASE_URL=http://localhost:3001
VITE_KITEAI_RPC_URL=https://rpc-testnet.gokite.ai/
VITE_KITEAI_BUNDLER_URL=https://bundler-service.staging.gokite.ai/rpc/
VITE_KITEAI_SETTLEMENT_TOKEN=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
VITE_KITECLAW_VAULT_IMPLEMENTATION=0xB5AAFCC6DD4DFc2B80fb8BCcf406E1a2Fd559e23
VITE_KITECLAW_GOLDSKY_ENDPOINT=https://api.goldsky.com/api/public/project_cmlrmfrtks90001wg8goma8pv/subgraphs/kk/1.0.1/gn
```

### Backend (`backend/.env`)
```env
PORT=3001
KITEAI_RPC_URL=https://rpc-testnet.gokite.ai/
KITE_SETTLEMENT_TOKEN=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
KITE_MERCHANT_ADDRESS=0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29
X402_PRICE=0.05
X402_REACTIVE_PRICE=0.03
KITE_AGENT2_AA_ADDRESS=0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8
KITE_POLICY_MAX_PER_TX=0.20
KITE_POLICY_DAILY_LIMIT=0.60
KITE_POLICY_ALLOWED_RECIPIENTS=0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29
ERC8004_IDENTITY_REGISTRY=0x_your_identity_registry
ERC8004_AGENT_ID=0
KITECLAW_API_KEY_ADMIN=
KITECLAW_API_KEY_AGENT=
KITECLAW_API_KEY_VIEWER=
KITECLAW_RATE_LIMIT_WINDOW_MS=60000
KITECLAW_RATE_LIMIT_MAX=240
OPENCLAW_BASE_URL=
OPENCLAW_CHAT_PATH=/api/v1/chat
OPENCLAW_HEALTH_PATH=/health
OPENCLAW_API_KEY=
OPENCLAW_TIMEOUT_MS=12000
```

Notes:
- Never commit real private keys
- Use local-only runtime/session secrets
- API key auth is auto-enabled if any key is set.
- When enabled, call APIs with `x-api-key: <key>` (or `Authorization: Bearer <key>`).

## Funding Prerequisites

Before demo:
1. Fund EOA with `KITE`
2. Connect wallet once and derive AA address
3. Fund AA with test `USDT`
4. If using Vault, fund Vault with USDT

KITE faucet: https://faucet.gokite.ai/

## Security Notes

- Session key is scoped by rules (limits/scope/time window)
- Gateway policy enforces off-chain checks (scope, per-tx, daily, revoke)
- Proof verification is required before action unlock
- Root keys should move to KMS/HSM/MPC in production
- This repo is a testnet MVP and not production audited

## Production Gap (honest scope)

- full production-grade key custody (KMS/HSM/MPC) not completed
- long-term session lifecycle hardening can be improved
- `reactive-stop-orders` strategy execution backend is still evolving
- additional monitoring and audits required for mainnet-grade launch

## Repository Structure

```text
KITE GASLESS/
|- frontend/        # React + Vite UI
|- backend/         # Express API (x402 gateway + policy + identity + records)
|- goldsky/         # Subgraph assets for on-chain confirmation
|- skills/          # OpenClaw skill packages and scripts
```

## Related Docs

- `OPENCLAW_SKILL_INTEGRATION.md`
- `DEMO_X402_SCRIPT.md`
- `ERC8004_SETUP.md`
- `STABLE_BASELINE.md`
- `KNOWN_ISSUES.md`
- `CHANGELOG.md`

## License

MIT License. See `LICENSE`.
