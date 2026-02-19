# KITE GASLESS

KITE GASLESS is an upgraded demo of **[Kite Bot](https://github.com/enderzcx/Kite-Bot-Seamless-Autonomous-Payment-AI-Agent)**, built for real-world AI Agent payment workflows on **KiteAI Testnet**.

Current Version: `v1.4.0`

This repo demonstrates how an AI Agent can:
- authenticate once,
- generate and use an Account Abstraction (AA) wallet,
- execute gasless-style ERC-4337 payments,
- manage vault limits and rules,
- and keep auditable transfer records.

## Why this project

This is the production-oriented evolution of a hackathon-winning prototype (Kite payment track runner-up), focused on practical deployment readiness for:
- KOL incentive distribution,
- autonomous agent checkout/payment,
- budget-controlled automated spending.

## Project structure

```text
KITE GASLESS/
├─ frontend/        # React + Vite UI (AA flow, transfer, vault, records)
├─ backend/         # Express API for transfer records
└─ .gitignore
```

## Key features

- Wallet login and AA address derivation (`getAccountAddress`)
- One-time Authentication UX before wallet-sign path sends
- Backend signer mode via `/api/signer/*` (no root private key in frontend runtime)
- Transfer page for manual AA token transfer
- Request page for agent-like purchase simulation
- x402-style paid resource flow (`402 -> pay -> proof -> 200`)
- Policy-enforced x402 transfer intent (scope + per-tx + daily limit)
- Gateway kill switch (revoke/unrevoke payer) for emergency guardrail demo
- Abuse/over-limit graceful-failure page with evidence logs
- Vault page for create/deposit/withdraw/rule updates
- Agent settings page for token + session/rule setup
- Record service (`/api/records`) for tx history playback
- On-chain Confirmation page backed by Goldsky subgraph queries
- Transfer page right-side real-time confirmation panel (submitted/indexing/confirmed)

## Quick start

### 1) Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Fill your own `.env` values (especially private key):

```env
VITE_KITEAI_RPC_URL=https://rpc-testnet.gokite.ai/
VITE_KITEAI_BUNDLER_URL=https://bundler-service.staging.gokite.ai/rpc/
VITE_KITEAI_SETTLEMENT_TOKEN=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
VITE_KITECLAW_VAULT_IMPLEMENTATION=0xB5AAFCC6DD4DFc2B80fb8BCcf406E1a2Fd559e23
VITE_KITECLAW_GOLDSKY_ENDPOINT=https://api.goldsky.com/api/public/project_cmlrmfrtks90001wg8goma8pv/subgraphs/kk/1.0.1/gn
```

Then run:

```bash
npm run dev
```

Frontend default URL: `http://localhost:5173`

### 2) Backend

```bash
cd ../backend
npm install
# optional: cp .env.example .env and fill backend signer key
npm start
```

Backend default: `http://localhost:3001`

Backend signer env (recommended for non-direct key access):

```env
KITEAI_RPC_URL=https://rpc-testnet.gokite.ai/
KITECLAW_BACKEND_SIGNER_PRIVATE_KEY=0x_your_test_private_key
# optional policy controls
KITE_POLICY_MAX_PER_TX=0.20
KITE_POLICY_DAILY_LIMIT=0.60
KITE_POLICY_ALLOWED_RECIPIENTS=0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29
```

### 3) Open the app

Run frontend and backend in two terminals, then open:

- App UI: `http://localhost:5173`
- Records API check: `http://localhost:3001/api/records`

## Funding prerequisites (important)

Before testing, prepare balances on KiteAI Testnet:

1. Fund your **EOA wallet** with some `KITE`.
   - Reason: your owner wallet still needs native gas for first-time on-chain actions (for example first AA deployment/initial setup tx).
2. Connect wallet in the app so the AA address is derived.
3. Fund your **AA wallet address** with:
   - `KITE` (for network-level execution scenarios),
   - `USDT` settlement token (for transfer/purchase/vault demo flows).
4. Use official KiteAI testnet faucet / token distribution channels to claim test assets.
   - KITE faucet: https://faucet.gokite.ai/
5. After Vault is created, fund it with some `USDT` as well.
   - Important: requesting USDT directly to the Vault address from faucet may fail or not arrive reliably.
   - Recommended path: claim USDT to your EOA first, then transfer USDT manually to your Vault address.
   - Alternative: try transferring from your AA wallet to the Vault address using your gasless flow.

## Demo flow (recommended)

1. Fund EOA with test `KITE`.
2. Connect wallet on Login page to derive AA address.
3. Fund AA address with test `KITE` and `USDT`.
4. Go to **Vault Page** and create vault (if not created).
5. Optionally set spending rules and fund vault.
6. On **Request** or **Transfer** page, run one-time Authentication.
7. On **Request** page, run x402 flow:
   - API returns `402 Payment Required`
   - Agent pays via AA transfer
   - Frontend retries with payment proof and receives `200`
8. Verify tx hash on KiteScan / Goldsky page.

Judge demo script: see `DEMO_X402_SCRIPT.md`.
9. Open **Records** page to show full operation history.
10. Open **Abuse / Limit Cases** page to demonstrate:
   - scope violation rejection,
   - over-limit rejection,
   - fake proof rejection,
   - expired request rejection,
   - insufficient funds graceful messaging.
11. In **Agent Payment Settings**, test kill switch:
   - `Revoke Current Payer (Kill Switch)` to block payer at gateway level
   - retry x402 intent and observe `payer_revoked` failure
   - `Unrevoke Current Payer` to restore flow

## Tech stack

- Frontend: React, Vite, ethers v6
- AA logic: local `gokite-aa-sdk.js` (ERC-4337 flow)
- Backend: Node.js, Express
- Network: KiteAI Testnet (Chain ID 2368)

## Security notes

- Use test keys only.
- Never commit `.env`.
- Root signing key is server-side only (`backend` env), not exposed to frontend.
- For production, use secure backend/HSM/KMS and strict rotation policies.

## ERC-8004 identity bootstrap

- Quick guide: `ERC8004_SETUP.md`
- Probe registry on Kite RPC:
  - `cd backend && npm run probe:erc8004`
- Register agent identity (once registry address is available):
  - `npm run erc8004:register`
- Read agent profile:
  - `npm run erc8004:read`

## Versioning

- We use Semantic Versioning (`MAJOR.MINOR.PATCH`).
- Stable baseline release: `v1.4.0`
- See `CHANGELOG.md` for release notes.
