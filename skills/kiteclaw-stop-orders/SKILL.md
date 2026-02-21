---
name: kiteclaw-stop-orders
description: Use this skill for KITECLAW reactive stop-orders when an agent needs A2A+x402 end-to-end flow (request 402 challenge, pay on-chain, submit proof, fetch status/evidence). 适用于止盈止损任务的自动支付执行与证据回收。
---

# KITECLAW Stop Orders Skill

Use this skill when OpenClaw needs to run the full stop-order paid-action flow on Kite testnet.

## Trigger phrases (recommended)

- "place stop order via KITECLAW"
- "run reactive stop-orders"
- "pay x402 and unlock stop-order action"
- "submit payment proof for stop-order request"
- "查询止盈止损支付状态/证据"

## Inputs expected from caller

- `payer`: payer AA address (optional if runtime is synced)
- `task.symbol`: trading pair, e.g. `BTC-USDT`
- `task.takeProfit`: numeric take-profit price
- `task.stopLoss`: numeric stop-loss price
- Optional: `sourceAgentId` (default `1`), `targetAgentId` (default `2`)

If `payer` is not provided, scripts read it from:
- `GET /api/session/runtime/secret`
- field: `runtime.aaWallet`

## Workflow

1. Request challenge
- Call `POST /api/skill/openclaw/invoke` without `requestId` and `paymentProof`.
- Expect HTTP `402` and parse:
  - `x402.requestId`
  - `x402.accepts[0].tokenAddress`
  - `x402.accepts[0].recipient`
  - `x402.accepts[0].amount`

2. Perform payment
- Preferred: call `POST /api/session/pay` with challenge fields (backend session signer path).
- Alternative: execute payment manually and capture `txHash`.

3. Submit proof
- Call same `invoke` endpoint with:
  - `requestId`
  - `paymentProof.requestId`
  - `paymentProof.txHash`
  - exact token/recipient/amount

4. Poll status/evidence
- `GET /api/skill/openclaw/status/:requestId`
- `GET /api/skill/openclaw/evidence/:requestId`

## Guardrails

- If response is `403`, treat it as policy/scope/limit failure and stop retrying automatic payment.
- If response is `402` with reason `expired`, request a new challenge.
- Proof must match challenge exactly, otherwise backend returns `402` again.

## Script helpers

Use bundled scripts in `scripts/` for deterministic calls:
- `request-challenge.ps1`
- `submit-proof.ps1`
- `get-status.ps1`
- `get-evidence.ps1`
- `get-runtime.ps1`
- `run-stop-order-flow.ps1` (challenge + optional proof submit)

See endpoint and payload reference in `references/api.md`.
