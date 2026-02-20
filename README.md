# KITE GASLESS

KITE GASLESS is an upgraded demo of **[Kite Bot](https://github.com/enderzcx/Kite-Bot-Seamless-Autonomous-Payment-AI-Agent)** built on **KiteAI Testnet**.

Current Version: `v1.5.2-stable`

Goal: build an **agent-native payment app** with:
- x402-style pay-per-action flow
- verifiable agent identity
- ERC-4337 account abstraction execution
- minimal human intervention after initial auth/session setup

## What this repo demonstrates

- Agent authentication (one-time wallet auth)
- AA lifecycle: address derivation + first-use auto deployment path
- Session-based delegated execution (rules + limits + scoped recipient)
- x402 flow: `402 -> on-chain pay -> proof verify -> 200 unlock`
- Verifiable identity read from ERC-8004-style registry
- On-chain confirmation and reconciliation UI
- Abuse/over-limit graceful failure with evidence logs

## ETHDenver KiteAI Requirement Mapping

| Requirement | Status | Evidence in this repo |
|---|---|---|
| Build on Kite AI Testnet/mainnet | Done | Kite testnet RPC/Bundler/USDT config in env + running flow |
| Use x402-style payment flows | Done | `402 -> pay -> proof -> 200` in Transfer page and backend `/api/x402/*` |
| Verifiable agent identity | Done | Backend identity endpoint + frontend identity card (`agentId/registry/wallet`) |
| Demonstrate autonomous execution | Done (demo scope) | One-time auth/session setup, then repeated paid actions without repeated wallet confirmation |
| Open-source core components | Done | Public repo structure + local reproducible setup |
| Correct x402 usage (action-payment mapping) | Done | x402 mapping panel, requestId/txHash linkage, records API |
| Graceful abuse/insufficient-funds handling | Done | Abuse page + policy failure logs + explicit rejection codes |
| Security controls (scope/limits/revocation) | Done | per-tx/daily limits, recipient scope, revoke/unrevoke kill switch |

## Bounty Requirement Alignment (detailed)

### 1) Build on Kite testnet/mainnet
Status: `Done`
- Network: KiteAI Testnet (`chainId=2368`)
- Uses Kite RPC + Bundler + USDT settlement token

### 2) x402-style payment flow (agent-to-API / agent-to-agent)
Status: `Done`
- Backend returns `402 Payment Required`
- Frontend pays on-chain through AA
- Proof is submitted and verified before `200` unlock
- Each paid action maps to one x402 request in logs/UI

### 3) Verifiable agent identity
Status: `Done`
- Backend reads identity profile from deployed identity registry
- Frontend displays agent ID / registry / agent wallet

### 4) Autonomous execution (minimal human clicking)
Status: `Done (demo scope)`
- One-time auth + session setup
- Subsequent payments run with session key path (no repeated wallet confirmation per payment)

### 5) Security and safety (scopes, limits, revocation)
Status: `Done`
- per-tx limit
- daily limit
- recipient scope allowlist
- payer revoke/unrevoke kill switch
- abuse case page with explicit failure reason and evidence

### 6) Open-source core components
Status: `Done`
- Public GitHub repo and reproducible local run instructions

## Architecture (high level)

1. User connects wallet and derives AA address.
2. User creates session + spending rules in Agent Settings.
3. Agent action request hits backend endpoint (`/api/x402/*`).
4. Backend returns 402 challenge with payment terms.
5. Frontend executes on-chain payment using AA + session path.
6. Frontend submits payment proof.
7. Backend verifies proof and unlocks resource with 200 response.
8. UI shows x402 mapping, on-chain confirmation, and records.

## Demo Walkthrough

For a complete end-to-end demonstration, follow this order:

1. `Transfer` page:
- request 402 challenge
- pay and submit proof
- display paid action result
2. `x402 Mapping` card on Transfer:
- requestId, payer, amount, txHash, policy decision
3. `On-chain Confirmation` page:
- indexed transfer rows + tx hash
4. `Abuse / Limit Cases` page:
- over-limit / scope violation / fake proof / expired / insufficient funds
- policy failure evidence logs
5. `Verifiable Agent Identity` card:
- identity registry + agent id + resolved wallet

## Stable Demo Baseline

Use the frozen baseline in `STABLE_BASELINE.md` for maximum success rate.

Quick defaults:
- `kol-score`: amount `0.05`
- `reactive-stop-orders`: amount `0.03`, `BTC-USDT / TP 70000 / SL 62000`
- policy: per-tx `0.20`, daily `0.60`

## Repository structure

```text
KITE GASLESS/
|- frontend/        # React + Vite UI
|- backend/         # Express API (x402 simulator + policy + identity + records)
|- goldsky/         # Subgraph assets for on-chain confirmation
```

## Quick Start

### 1) Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5173`

### 2) Backend

```bash
cd ../backend
npm install
cp .env.example .env
npm start
```

Backend: `http://localhost:3001`

## Environment Variables

### Frontend (`frontend/.env`)

```env
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
```

Notes:
- Backend signer key is optional in current session-key payment path.
- Never commit real private keys.

## Funding Prerequisites

Before demo:

1. Fund EOA with some `KITE` (needed for first-time actions and setup path).
2. Connect wallet once to derive predicted AA address.
3. Fund AA with test `USDT` (and optional `KITE` buffer).
4. If using Vault, fund Vault with USDT (EOA -> Vault transfer is most reliable).

KITE faucet: https://faucet.gokite.ai/

## Demo Steps (judge-friendly)

1. Open app and connect wallet.
2. Authenticate once.
3. Open `Agent Payment Settings` and create session + rules.
4. In `Transfer`, click `Request Payment Info (402)`.
5. Click `Pay & Submit Proof`.
6. Show:
   - x402 mapping panel
   - on-chain confirmation panel
   - transfer records page
   - abuse/limit graceful failure page

## Pre-demo Checklist

Run this quick check before recording or live demo:

1. `frontend/.env` and `backend/.env` point to Kite testnet RPC/Bundler
2. EOA has `KITE > 0`
3. AA wallet has enough `USDT` for planned actions
4. Complete one-time `Authentication`
5. In `Agent Payment Settings`, run `Generate Session Key & Apply Rules`
6. Keep policy aligned with selected action recipients
7. Backend and frontend are both restarted after env changes

## Security Notes

- Session key is scoped by rules (limits/scope/time window).
- Policy layer enforces off-chain gateway checks (scope, per-tx, daily, revoke).
- Root keys should stay in secure backend/KMS/HSM in production.
- This repo is a testnet MVP and not production audited.

## Production gap note (honest scope)

This project meets bounty demo requirements, but still has non-production parts:
- session delegation hardening and long-run lifecycle handling can be improved
- key management should move to managed KMS/HSM/MPC in production deployment
- additional monitoring/alerting and audits are required before mainnet-grade use

## Known Issues

For timeout and mapping edge cases, see `KNOWN_ISSUES.md`.

## Related Docs

- Demo script: `DEMO_X402_SCRIPT.md`
- ERC-8004 setup: `ERC8004_SETUP.md`
- Stable baseline: `STABLE_BASELINE.md`
- Known issues: `KNOWN_ISSUES.md`
- Changelog: `CHANGELOG.md`

## License

This project is licensed under the **MIT License**. See `LICENSE`.
