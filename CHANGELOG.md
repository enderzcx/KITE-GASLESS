# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added
- Receipt export API for judge-friendly proof bundles:
  - `GET /api/receipt/:requestId`
  - optional `?download=1` to download `kiteclaw_receipt_<requestId>.json`.
- Receipt payload now includes:
  - `amount/tokenAddress/payer/payee`
  - `responseHash`
  - `responseSignature` (when backend signer is available).

### Changed
- Demo and Ops UI now provide `Download Receipt` action from API result panels.

## [v1.8.0] - 2026-02-22

### Added
- Strong identity gate before paid workflows:
  - `ERC8004` verification is now enforced before issuing x402 challenge in BTC/stop-order flows.
- One-click failure demo flow:
  - `Fail Demo` button for guardrail failure replay with auto recover (`revoke -> run -> unrevoke`).
- Branded browser identity:
  - updated title to `KiteTrace Platform`
  - new favicon `kite-trace.svg`.

### Changed
- BTC demo wording and focus:
  - home title simplified to `BTCUSD`
  - chart title simplified to `BTCUSD`
  - note now states `updates every minute`.
- Demo UX layout updates:
  - header action buttons are now horizontal on home page.
  - summary moved under chart area to avoid right-panel scrolling.
- On-chain confirmation display standardized:
  - explicit `txHash / block / status / explorer link` presentation.
- README aligned to platform positioning:
  - `KiteTrace Platform` naming and GitHub description/about section updated.

### Removed
- Removed Goldsky module from active frontend and repository:
  - deleted `frontend/src/OnChainPage.jsx`
  - deleted `frontend/src/transfer/services/confirmationService.js`
  - deleted `goldsky/*` config and ABI files.
- Removed Goldsky-dependent indexing confirmation path from transfer flow.

### Fixed
- Demo state reliability:
  - failed trace now stays selected after `Fail Demo` (no auto-jump back to latest success trace).
- Error visibility:
  - fail-demo outcome uses persistent red error banner (no transient green notice).
- Evidence readability:
  - full hashes/addresses displayed without ellipsis in evidence drawer.

## [v1.7.0] - 2026-02-22

### Added
- New demo data API for chart playback:
  - `GET /api/demo/price-series?limit=60`
  - returns only paid `btc-price-feed` points for judge-facing chart evidence.
- BTC workflow SSE payload enhancement:
  - `unlocked` event now includes optional `quote` payload.
- Frontend route split for clearer demo focus:
  - `/` => BTC line chart + ERC8004/x402 flow card + `Run Demo`
  - `/ops` => KPI, traces, event feed, evidence drawer, session setup
- Homepage chart features:
  - pure SVG line chart (no third-party chart lib)
  - latest point highlight + tooltip
  - flow-to-chart price fly-in animation.

### Changed
- BTC quote source flow aligned to production intent:
  - `hyperliquid` as primary source with `binance`/`okx` fallback in backend quote pipeline.
- UI scope reduced for judge-first opening experience:
  - removed setup/ops clutter from homepage and moved operational controls to `/ops`.

### Fixed
- Session payment compatibility for `btc-price-feed`:
  - mapped BTC service provider to session-compatible alias by default, with env override support.
- Reliability improvements for unstable testnet links:
  - retry logic added around session-pay workflow orchestration.
  - prevented premature abort of long confirmation waits.
- Frontend evidence consistency:
  - failed trace no longer shows stale quote values from previous successful runs.

## [v1.6.1] - 2026-02-21

### Added
- Packaged OpenClaw skill artifact:
  - `skills/releases/kiteclaw-stop-orders-v1.6.1.zip`

### Changed
- README rewritten to match the real current demo flow:
  - dashboard session setup
  - repeated autonomous x402-paid stop-order execution
  - insufficient-balance failure demonstration
  - explicit OpenClaw runtime configuration (`/v1/chat/completions`, `/v1/models`)
- README now includes skill packaging and script usage instructions.

### Removed
- Non-essential top-level docs removed to keep repository focused:
  - `AA_V2_UPGRADE_PLAYBOOK.md`
  - `DEMO_X402_SCRIPT.md`
  - `ERC8004_SETUP.md`
  - `KNOWN_ISSUES.md`
  - `OPENCLAW_SKILL_INTEGRATION.md`
  - `STABLE_BASELINE.md`
- Removed sample metadata directory:
  - `metadata/`

## [v1.6.0] - 2026-02-21

### Added
- Iteration-1 dashboard backend APIs:
  - `POST /api/chat/agent`
  - `GET /api/x402/mapping/latest?limit=20`
  - `GET /api/identity/current`
  - `GET /api/onchain/latest?limit=20`
- Iteration-1 dashboard frontend:
  - KPI cards (`Pending`, `Paid`, `Failed`, `Today Spend`)
  - Chat panel with trace-aware replies
  - status cards for `Session / x402 / On-chain / Identity`
  - 3-second polling loop for runtime/mapping/on-chain updates
- Iteration-2 workflow backend orchestration:
  - `POST /api/workflow/stop-order/run`
  - `GET /api/workflow/:traceId`
  - persisted workflow timeline in `data/workflows.json`
- Iteration-2 real-time event stream:
  - `GET /api/events/stream` (SSE)
  - events: `workflow_started`, `challenge_issued`, `payment_sent`, `proof_submitted`, `unlocked`, `failed`
- Iteration-2 dashboard workflow UI:
  - one-click `Place Stop Order` execution card
  - timeline rendering by `traceId`
  - failure reason visualization (`reason`)
  - live SSE event feed panel

### Changed
- README updated to align with dashboard-first setup and workflow-first demo path.
- OpenClaw integration docs aligned with orchestrated workflow endpoints.

## [v1.5.4] - 2026-02-20

### Changed
- Transfer UX simplification:
  - removed duplicated connect button in transfer action area
  - moved wallet connection status into `Balance` card for cleaner workflow focus.
- Product naming and hero copy updated in app shell:
  - primary title now uses `KITECLAW`.
- Transfer page layout upgraded to full website-style workspace:
  - branded header + hero + structured content zones.

## [v1.5.3-stable] - 2026-02-20

### Added
- A2A evidence fields in x402 mapping views:
  - `Flow Mode`
  - `Source Agent`
  - `Target Agent`
- README A2A demo evidence checklist for judge walkthrough.

### Changed
- Transfer error messaging improved for request stage:
  - policy rejections now show readable reason/code instead of generic `Expected 402 ...`.
- On-chain x402 mapping table layout stabilized:
  - horizontal scroll wrapper for wide columns
  - hash/link cells now use ellipsis and tooltip instead of vertical overflow.
- Frontend visual theme updated to a Kite homepage-like light style:
  - warm light background
  - olive primary buttons
  - softer card shadows and borders.

## [v1.5.2-stable] - 2026-02-20

### Added
- `reactive-stop-orders` action now supports explicit order parameters:
  - `symbol`
  - `takeProfit`
  - `stopLoss`
- Transfer UI now shows reactive order parameters in:
  - x402 challenge section
  - paid result section
- Backend validation for reactive action params before issuing/confirming paid flow.

### Changed
- README restructured for judge-facing clarity:
  - requirement-to-evidence mapping table
  - explicit demo evidence path
  - production-gap disclosure section
- Success card behavior refined:
  - `reactive-stop-orders` displays order plan details
  - `Top KOLs` only shown for `kol-score`

## [v1.5.0] - 2026-02-19

### Added
- Action-based x402 flow on Transfer page:
  - `Request Payment Info (402)` -> `Pay & Submit Proof`
  - challenge details displayed before payment.
- New paid action:
  - `reactive-stop-orders` bound to `agent2` AA recipient.
- Fast pre-check for action recipient validity:
  - explicit `invalid_action_recipient` error path.
- Environment loading in backend runtime via `dotenv`:
  - backend signer `.env` now loaded reliably.

### Changed
- Removed duplicated Request page and switched to Transfer-first app entry.
- Updated top navigation to keep all demo pages reachable from Transfer.
- Applied policy guardrails to action flow (`kol-score` and `reactive-stop-orders`) before issuing 402 challenge.
- Payment signing preference updated for stable no-popup flow:
  - prefer backend signer after one-time auth, fallback to owner signer only if backend signer is unavailable.

## [v1.4.0] - 2026-02-19

### Added
- Gateway revoke guardrail for payer-level kill switch:
  - `POST /api/x402/policy/revoke`
  - `POST /api/x402/policy/unrevoke`
- Revoked payer policy enforcement with explicit `payer_revoked` rejection path.
- Agent Settings UI controls for:
  - revoke current payer
  - unrevoke current payer
  - revoked payer list visualization

### Changed
- Security guardrails expanded from `limits + scope` to `limits + scope + revocation`.
- README demo flow updated with kill-switch walkthrough.

## [v1.3.0] - 2026-02-19

### Added
- New Abuse/Over-limit demo page for graceful-failure cases:
  - over-limit per tx
  - scope violation
  - fake proof
  - expired request
  - insufficient funds (demo)
- Policy enforcement evidence logs API:
  - `GET /api/x402/policy-failures`
- Backend policy config persistence (`data/policy_config.json`).

### Changed
- Backend x402 policy became runtime-configurable:
  - `GET /api/x402/policy`
  - `POST /api/x402/policy`
- Agent Settings page now syncs policy to backend gateway after session/rule setup.
- Transfer page x402 mapping card now displays policy decision/snapshot evidence.
- README updated with policy controls and abuse-case demo flow.

## [v1.2.0] - 2026-02-18

### Added
- x402 demo backend route: `POST /api/x402/kol-score`.
- End-to-end x402 flow in Request page:
  - `402 Payment Required`
  - AA payment execution
  - proof retry and `200` unlock
- `DEMO_X402_SCRIPT.md` for judge-facing walkthrough.

### Changed
- Request page result card now includes:
  - `x402 Request ID`
  - `Payment Tx Hash`
  - sample unlocked payload
- README updated for x402 flow and demo script reference.

## [v1.1.0] - 2026-02-18

### Added
- Goldsky-backed `On-chain Confirmation` page.
- Tx-hash focused on-chain query mode with latest-10 default listing.
- Reconciliation card:
  - `app record found`
  - `on-chain record found`
  - `amount/address match`
- `Source` label for app-level record vs on-chain indexed record.
- Transfer page real-time confirmation panel showing submit/index/confirm phases.

### Changed
- Default RPC/Bundler fallbacks now use full KiteAI URLs (no relative `/rpc` fallback).
- Documentation updated with Goldsky endpoint env variable.

## [v1.0.0] - 2026-02-18

### Added
- Initial public release of KITE GASLESS.
- KiteAI testnet integration with AA wallet derivation and ERC-4337-style flow.
- Frontend modules: Login, Request, Transfer, Vault, Agent Settings, Records.
- Backend records API for transfer/action logs.
- English documentation for setup, funding prerequisites, and demo flow.

### Notes
- Baseline release for the KITECLAW skill roadmap.
