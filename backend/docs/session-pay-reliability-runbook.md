# Session Pay Reliability Runbook

Last updated: 2026-03-01 (Asia/Shanghai)

## Goal
- Reduce bundler transport flakiness impact on `/api/session/pay`.
- Make failure categories observable and actionable.

## Runtime Knobs
- `KITE_SESSION_PAY_RETRIES` (default: `3`)
- `KITE_BUNDLER_RPC_TIMEOUT_MS` (default: `15000`)
- `KITE_BUNDLER_RPC_RETRIES` (default: `3`)
- `KITE_BUNDLER_RPC_BACKOFF_BASE_MS` (default: `650`)
- `KITE_BUNDLER_RPC_BACKOFF_MAX_MS` (default: `6000`)
- `KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS` (default: `3000`)
- `KITE_SESSION_PAY_METRICS_RECENT_LIMIT` (default: `80`)

## Observability Endpoints
- `GET /api/session/pay/config`
  - returns effective runtime settings (post-clamp values).
- `GET /api/session/pay/metrics`
  - returns counters:
    - `totalRequests`, `totalSuccess`, `totalFailed`
    - `totalRetryAttempts`, `totalRetriesUsed`
    - `totalFallbackAttempted`, `totalFallbackSucceeded`
    - `failuresByCategory`, `retriesByCategory`
    - `recentFailures[]`

## Failure Categories
- `transport`
- `replacement_fee`
- `session_validation`
- `funding`
- `policy`
- `aa_version`
- `config`
- `unknown`

## Retry Governance Notes
- Session pay retry path is **no-backoff** by design (immediate retry on retryable failures).
- Track retry shape with `metrics.retriesByCategory`; if `replacement_fee` dominates, prioritize fee-bump and nonce/order diagnostics.

## Operational Checks
1. Verify config:
   - `curl -sS http://127.0.0.1:3001/api/session/pay/config -H "x-api-key: <viewer_or_agent_key>"`
2. Trigger at least one payment flow.
3. Inspect metrics:
   - `curl -sS http://127.0.0.1:3001/api/session/pay/metrics -H "x-api-key: <viewer_or_agent_key>"`
4. Prioritize fixes by `failuresByCategory`.

## Reference Sync Check (HopLedger)
- Run parity sync from backend repo:
  - `npm run parity:hopledger`
- Optional explicit artifact:
  - `node scripts/parity-hopledger-reference.mjs --artifact artifacts/pilot/<timestamp>`
- Parity output now includes `hopLedgerGit` metadata (`branch`, `commit`, `dirty`) for evidence traceability.
