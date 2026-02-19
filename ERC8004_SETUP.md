# ERC-8004 Setup (KITECLAW)

This document explains how to bootstrap **Verifiable Agent Identity** for KITECLAW.

## 1) Probe whether Kite Testnet already has a usable ERC-8004 Identity Registry

From `backend/`:

```bash
npm run probe:erc8004
```

If all candidates show `code=false`, Kite Testnet does not have the probed registry addresses.

## 2) Register identity (after you have a valid Identity Registry address on your target chain)

Set env in `backend/.env`:

```env
KITEAI_RPC_URL=https://rpc-testnet.gokite.ai/
ERC8004_IDENTITY_REGISTRY=0xYourIdentityRegistry
ERC8004_AGENT_URI=https://your-domain/agent.json
ERC8004_REGISTRAR_PRIVATE_KEY=0xYourPrivateKey
```

Run:

```bash
npm run erc8004:register
```

Output includes:
- `agentId`
- `owner`
- `agentWallet`
- `txHash`

## 3) Read identity profile

Set:

```env
ERC8004_AGENT_ID=123
```

Run:

```bash
npm run erc8004:read
```

## 4) About Kite Testnet support

Current repo includes probe tooling and identity scripts.
If no official Kite ERC-8004 registry address is available, you have two options:

1. Deploy ERC-8004 registries on Kite Testnet yourself, then use those addresses.
2. Register identity on a supported network (e.g., Sepolia) and bind payment actions via signed proof in KITE GASLESS.

