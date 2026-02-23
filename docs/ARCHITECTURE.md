# Architecture Snapshot

```text
Browser UI (/ , /market , /ops)
        |
        v
Frontend (React + Vite)
        |
        v
Backend (Express)
  - Workflow orchestration
  - Service directory + invoke guards
  - x402 challenge/proof
  - ERC8004 identity checks
  - SSE stream + evidence APIs
        |
        +--> Kite testnet (payment tx + confirmation)
        +--> Price providers (Hyperliquid -> Binance -> OKX fallback)
```

## Core Data Objects
- `x402_requests.json`: challenge/payment/proof records
- `workflows.json`: workflow state machine timeline
- `services.json`: published services (market catalog)
- `service_invocations.json`: per-call invoke records

## Verification Trail
- `requestId` maps payment request to proof submit
- `txHash` maps payment to on-chain record
- `workflow.traceId` maps UI flow to backend execution
- explorer link provides independent on-chain visibility
