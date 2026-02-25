# KITE GASLESS Frontend

This frontend demonstrates an agent-native network flow on KiteAI Testnet using ERC8004 identity, XMTP evidence, and x402 settlement.

## What it includes

- Network overview page (`/`)
- Service market page (`/market`)
- Trace evidence page (`/trace/:requestId`)
- Ops page (`/ops`)
- Agent settings panel for runtime/session operations

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

## Runtime notes

- This frontend relies on backend APIs under `/api/*`.
- Use testnet-only wallets and funds.
- Do not commit `.env`.

## Backend dependency

This frontend expects backend service in `../backend`.

Start backend:

```bash
cd ../backend
npm install
npm start
```

Use two terminals:
- Terminal A: frontend (`npm run dev`) -> open `http://localhost:5173`
- Terminal B: backend (`npm start`) -> API at `http://localhost:3001`

## Notes

- Use testnet-only wallets and funds.
- Do not commit `.env`.
- For production, keep root keys in backend/KMS/HSM and use delegated/session execution.

## License

MIT License (see repository root `LICENSE`).
