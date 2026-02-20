# Stable Baseline (v1.5.2-stable)

This file defines the recommended demo baseline to maximize run stability.

## Environment baseline

- Chain: `KiteAI Testnet` (`chainId=2368`)
- RPC: `https://rpc-testnet.gokite.ai/`
- Bundler: `https://bundler-service.staging.gokite.ai/rpc/`
- Settlement token: `0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63` (USDT)

## Action baseline

### A) `kol-score` (primary stable path)
- Recommended challenge amount: `0.05`
- Query example: `KOL score report for AI payment campaign`
- Recipient: merchant address from backend policy allowlist

### B) `reactive-stop-orders` (secondary stable path)
- Recommended challenge amount: `0.03`
- Query example: `stop order`
- Required params:
  - `symbol`: `BTC-USDT`
  - `takeProfit`: `70000`
  - `stopLoss`: `62000`
- Recipient: `KITE_AGENT2_AA_ADDRESS`

## Policy baseline (recommended)

- Per-tx limit: `0.20`
- Daily limit: `0.60`
- Allowed recipients:
  - merchant address
  - agent2 AA address (for `reactive-stop-orders`)
- Revocation: disabled during normal demo

## Session baseline

- Generate session once in `Agent Payment Settings`
- Keep generated session key and session id unchanged during one demo run
- Regenerate session only when:
  - rules changed
  - session mismatch detected
  - storage was cleared

## Balance baseline (before demo)

- EOA:
  - `KITE > 0` (for setup/signing path)
- AA wallet:
  - enough `USDT` for all planned actions
  - optional `KITE` buffer to avoid edge gas/deposit issues

## Recommended demo order

1. Connect wallet
2. Authentication once
3. Generate session key + apply rules
4. Run one `kol-score` payment
5. Run one `reactive-stop-orders` payment
6. Show x402 mapping and on-chain confirmation
7. Show abuse/limit graceful failures
