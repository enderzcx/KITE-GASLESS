# API Reference for kiteclaw-stop-orders

Base URL: `http://localhost:3001`

## Endpoints

- `GET /api/skill/openclaw/manifest`
- `POST /api/skill/openclaw/invoke`
- `GET /api/skill/openclaw/status/:requestId`
- `GET /api/skill/openclaw/evidence/:requestId`
- `GET /api/session/runtime/secret`
- `POST /api/session/pay`

## Invoke (phase 1: challenge)

Request body:

```json
{
  "payer": "0x...",
  "sourceAgentId": "1",
  "targetAgentId": "2",
  "task": {
    "symbol": "BTC-USDT",
    "takeProfit": 70000,
    "stopLoss": 62000
  }
}
```

Expected response: HTTP `402` with x402 challenge.

## Invoke (phase 2: proof)

Request body:

```json
{
  "payer": "0x...",
  "sourceAgentId": "1",
  "targetAgentId": "2",
  "task": {
    "symbol": "BTC-USDT",
    "takeProfit": 70000,
    "stopLoss": 62000
  },
  "requestId": "x402_...",
  "paymentProof": {
    "requestId": "x402_...",
    "txHash": "0x...",
    "payer": "0x...",
    "tokenAddress": "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63",
    "recipient": "0xEd335560178B85f0524FfFf3372e9Bf45aB42aC8",
    "amount": "0.03"
  }
}
```

Expected response: HTTP `200` with unlocked task result.

## Failure handling

- `403`: policy failure (scope / limit / revoked)
- `402`: payment required / expired / proof mismatch / proof not found

Use status/evidence endpoints for follow-up diagnostics.

## Runtime source (optional)

If your skill runner does not pass `payer`, read synced runtime:

`GET /api/session/runtime/secret`

Response:

```json
{
  "ok": true,
  "runtime": {
    "aaWallet": "0x...",
    "owner": "0x...",
    "sessionAddress": "0x...",
    "sessionPrivateKey": "0x...",
    "sessionId": "0x..."
  }
}
```
