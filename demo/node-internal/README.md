# Node Internal Demo

This folder contains a minimal internal-node demo for KITE-GASLESS.

## Goal
- Trigger one internal agent-network run.
- Pull run summary from `/api/network/runs`.
- Pull timeline + structured negotiation terms from `/api/network/audit/:traceId`.

## Prerequisites
- Backend is running (default `http://127.0.0.1:3001`).
- If auth is enabled, provide an agent/viewer API key.

## Run

```bash
node demo/node-internal/run-demo.mjs --base http://127.0.0.1:3001 --api-key <KITECLAW_API_KEY_AGENT>
```

Optional args:
- `--wait-ms 15000`
- `--no-retry-on-timeout`
- `--no-auto-start`

## Output
- Run trace id
- Run summary table
- Negotiation terms (Quote/SLA/Rationale)
- Timeline preview (first 12 events)
