# Session Pay Reliability Runbook

Last updated: 2026-03-01 (Asia/Shanghai)

## Goal
- Reduce bundler transport flakiness impact on `/api/session/pay`.
- Make failure categories observable and actionable.

## Runtime Knobs
- `KITE_SESSION_PAY_RETRIES` (default: `3`)
- `KITE_SESSION_PAY_TRANSPORT_BACKOFF_BASE_MS` (default: `400`)
- `KITE_SESSION_PAY_TRANSPORT_BACKOFF_MAX_MS` (default: `2500`)
- `KITE_SESSION_PAY_TRANSPORT_BACKOFF_JITTER_MS` (default: `250`)
- `KITE_SESSION_PAY_TRANSPORT_BACKOFF_FACTOR` (default: `3`)
- `KITE_SESSION_PAY_REPLACEMENT_BACKOFF_BASE_MS` (default: `2000`)
- `KITE_SESSION_PAY_REPLACEMENT_BACKOFF_MAX_MS` (default: `6000`)
- `KITE_SESSION_PAY_REPLACEMENT_BACKOFF_JITTER_MS` (default: `500`)
- `KITE_SESSION_PAY_REPLACEMENT_BACKOFF_FACTOR` (default: `2`)
- `KITE_BUNDLER_RPC_TIMEOUT_MS` (default: `15000`)
- `KITE_BUNDLER_RPC_RETRIES` (default: `3`)
- `KITE_BUNDLER_RPC_BACKOFF_BASE_MS` (default: `650`)
- `KITE_BUNDLER_RPC_BACKOFF_MAX_MS` (default: `6000`)
- `KITE_BUNDLER_RPC_BACKOFF_FACTOR` (default: `2`)
- `KITE_BUNDLER_RPC_BACKOFF_JITTER_MS` (default: `max(80, base/2)`)
- `KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS` (default: `3000`)
- `KITE_SESSION_PAY_METRICS_RECENT_LIMIT` (default: `80`)

## Observability Endpoints
- `GET /api/session/pay/config`
  - returns effective runtime settings (post-clamp values).
- `GET /api/session/pay/metrics`
  - returns counters:
    - `totalRequests`, `totalSuccess`, `totalFailed`
    - `totalRetryAttempts`, `totalRetryDelayMs`, `averageRetryDelayMs`, `totalRetriesUsed`
    - `totalFallbackAttempted`, `totalFallbackSucceeded`
    - `failuresByCategory`, `retriesByCategory`, `retryDelayMsByCategory`
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
- Session pay retry path uses category-based wait strategy:
  - `transport`: exponential by `base/factor/max` (default 400ms -> 1200ms -> 2500ms cap, +jitter up to 250ms)
  - `replacement_fee`: exponential by `base/factor/max` (default 2000ms -> 4000ms -> 6000ms cap, +jitter up to 500ms)
  - non-retry categories: no wait, fail fast
- Track retry shape with `metrics.retriesByCategory` + `metrics.retryDelayMsByCategory`; if `replacement_fee` dominates, prioritize fee-bump and nonce/order diagnostics.

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
- Optional strict clean-worktree gates:
  - `node scripts/parity-hopledger-reference.mjs --require-clean-hop-ledger`
  - `node scripts/parity-hopledger-reference.mjs --require-clean-hop-ledger --require-clean-backend`
- Parity output now includes both `hopLedgerGit` and `backendGit` metadata (`branch`, `commit`, `dirty`) for evidence traceability.
