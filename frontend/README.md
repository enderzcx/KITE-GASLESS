# KITE GASLESS Frontend

This frontend demonstrates an AI-agent-friendly payment flow on KiteAI Testnet using Account Abstraction (ERC-4337).

## What it includes

- Wallet login and AA wallet derivation
- One-time Authentication UX
- Request page (agent-style purchase simulation)
- Transfer page (manual token transfer)
- Vault management (create, deposit, withdraw, spending rules)
- Agent payment settings
- Transfer records viewer

## Setup

1. Install dependencies

```bash
npm install
```

2. Create your env file

```bash
cp .env.example .env
```

3. Fill your own values in `.env`

```env
VITE_KITEAI_RPC_URL=https://rpc-testnet.gokite.ai/
VITE_KITEAI_BUNDLER_URL=https://bundler-service.staging.gokite.ai/rpc/
VITE_KITECLAW_PRIVATE_KEY=0x_your_test_private_key
VITE_KITEAI_SETTLEMENT_TOKEN=0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63
VITE_KITECLAW_VAULT_IMPLEMENTATION=0xB5AAFCC6DD4DFc2B80fb8BCcf406E1a2Fd559e23
VITE_KITECLAW_AA_WALLET_ADDRESS=
VITE_KITECLAW_VAULT_ADDRESS=0x_your_vault_address
```

4. Start dev server

```bash
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Funding prerequisites (important)

Before using the demo, prepare test balances:

1. Add `KITE` to your owner EOA wallet first.
   - This is needed for first-time setup/deployment related transactions.
2. Connect wallet once to derive the AA wallet address.
3. Fund the derived AA wallet with:
   - `KITE`
   - `USDT` (settlement token used by this demo)
4. Use KiteAI official testnet faucet/token channels to get test assets.
   - KITE faucet: https://faucet.gokite.ai/
5. After creating Vault, transfer some `USDT` into the Vault.
   - Faucet -> Vault address may not always deliver USDT reliably.
   - Best practice: claim USDT to EOA first, then manually transfer USDT to Vault address.
   - Or test AA gasless transfer from AA wallet to Vault address.

## Backend dependency

This frontend expects `/api/records` from the backend service in `../backend`.

Start backend:

```bash
cd ../backend
npm install
npm start
```

Use two terminals:
- Terminal A: frontend (`npm run dev`) -> open `http://localhost:5173`
- Terminal B: backend (`npm start`) -> API at `http://localhost:3001/api/records`

## Notes

- Use testnet-only wallets and funds.
- Do not commit `.env`.
- For production, move signing to backend/HSM instead of frontend private keys.
