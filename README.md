# KITE GASLESS

KITE GASLESS is an upgraded demo of **[Kite Bot](https://github.com/enderzcx/Kite-Bot-Seamless-Autonomous-Payment-AI-Agent)**, built for real-world AI Agent payment workflows on **KiteAI Testnet**.

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
- Auto-sign mode via `VITE_KITECLAW_PRIVATE_KEY` for demo automation
- Transfer page for manual AA token transfer
- Request page for agent-like purchase simulation
- Vault page for create/deposit/withdraw/rule updates
- Agent settings page for token + session/rule setup
- Record service (`/api/records`) for tx history playback

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
VITE_KITECLAW_PRIVATE_KEY=0x_your_test_private_key
VITE_KITEAI_SETTLEMENT_TOKEN=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
VITE_KITECLAW_VAULT_IMPLEMENTATION=0xB5AAFCC6DD4DFc2B80fb8BCcf406E1a2Fd559e23
```

Then run:

```bash
npm run dev
```

### 2) Backend

```bash
cd ../backend
npm install
npm start
```

Backend default: `http://localhost:3001`

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
7. Send payment and verify tx hash on KiteScan.
8. Open **Records** page to show full operation history.

## Tech stack

- Frontend: React, Vite, ethers v6
- AA logic: local `gokite-aa-sdk.js` (ERC-4337 flow)
- Backend: Node.js, Express
- Network: KiteAI Testnet (Chain ID 2368)

## Security notes

- Use test keys only.
- Never commit `.env`.
- For production, move signing to secure backend/HSM; do not keep private keys in frontend runtime.
