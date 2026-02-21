# OpenClaw Skill Integration (KITECLAW)

This document gives a copy-paste integration flow for OpenClaw to run the full pipeline:

`intent -> x402 challenge -> on-chain payment -> proof submit -> result + evidence`

Base URL (local):

`http://localhost:3001`

## 1) Discover skill

`GET /api/skill/openclaw/manifest`

```bash
curl http://localhost:3001/api/skill/openclaw/manifest
```

## 2) First invoke (expect 402 challenge)

Send payer + stop-order task. Backend returns `status: 402` + `requestId` + payment requirement.

`POST /api/skill/openclaw/invoke`

```bash
curl -X POST http://localhost:3001/api/skill/openclaw/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "payer": "0x88E1E1A56cCdbDbfE40C889DE66E7415FA7C6Cfc",
    "sourceAgentId": "1",
    "targetAgentId": "2",
    "task": {
      "symbol": "BTC-USDT",
      "takeProfit": 70000,
      "stopLoss": 62000
    }
  }'
```

Key fields from response:
- `status: 402`
- `x402.requestId`
- `x402.accepts[0].tokenAddress`
- `x402.accepts[0].amount`
- `x402.accepts[0].recipient`

## 3) Do payment on chain (frontend or wallet)

Use challenge fields to pay the exact amount/token/recipient and wait for tx hash.

## 4) Second invoke (submit proof)

Submit same task + `requestId` + `paymentProof`.

```bash
curl -X POST http://localhost:3001/api/skill/openclaw/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "payer": "0x88E1E1A56cCdbDbfE40C889DE66E7415FA7C6Cfc",
    "sourceAgentId": "1",
    "targetAgentId": "2",
    "task": {
      "symbol": "BTC-USDT",
      "takeProfit": 70000,
      "stopLoss": 62000
    },
    "requestId": "x402_1771234567890_abcd1234",
    "paymentProof": {
      "requestId": "x402_1771234567890_abcd1234",
      "txHash": "0xYOUR_TX_HASH",
      "payer": "0x88E1E1A56cCdbDbfE40C889DE66E7415FA7C6Cfc",
      "tokenAddress": "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
      "recipient": "0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8",
      "amount": "0.03"
    }
  }'
```

Success result contains:
- `status: 200`
- `payment.txHash`
- `result.orderPlan` (symbol/takeProfit/stopLoss/provider)
- `a2a` metadata

## 5) Poll status

`GET /api/skill/openclaw/status/:requestId`

```bash
curl http://localhost:3001/api/skill/openclaw/status/x402_1771234567890_abcd1234
```

Possible statuses:
- `pending`
- `paid`
- `expired`

## 6) Fetch evidence

`GET /api/skill/openclaw/evidence/:requestId`

```bash
curl http://localhost:3001/api/skill/openclaw/evidence/x402_1771234567890_abcd1234
```

Evidence includes:
- full request snapshot
- payment fields
- matched transfer record (if found)
- policy / identity / a2a fields

## OpenClaw skill adapter (minimal pseudocode)

```js
// step A: invoke once
const first = await post('/api/skill/openclaw/invoke', payload);
if (first.status === 402) {
  const challenge = first.x402;
  // step B: perform chain payment from your payment engine
  const txHash = await payOnKite(challenge);

  // step C: submit proof
  const second = await post('/api/skill/openclaw/invoke', {
    ...payload,
    requestId: challenge.requestId,
    paymentProof: {
      requestId: challenge.requestId,
      txHash,
      payer: payload.payer,
      tokenAddress: challenge.accepts[0].tokenAddress,
      recipient: challenge.accepts[0].recipient,
      amount: challenge.accepts[0].amount
    }
  });

  return second;
}
return first;
```

## Notes
- The proof verification checks local transfer records (`backend/data/records.json`).
- Payment must match challenge exactly (`tokenAddress/recipient/amount/requestId`).
- For production, keep the same API shape and switch to robust tx/index verification backend.
