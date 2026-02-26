# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added
- Added AGENT001 paid-result pull API:
  - `GET /api/agent001/results/:requestId`
  - supports requestId-based retrieval when DM delivery fails after x402 payment.
- Added AGENT001 closed-loop trade orchestration:
  - service discovery (`ERC8004 identity preferred + local service catalog fallback`)
  - XMTP quote negotiation capability `service-quote`
  - strict x402 binding for technical/info analysis stage
  - strict x402 binding + Hyperliquid testnet order execution stage
  - final DM now includes analysis/payment/order evidence refs.
- Added new trade workflow API:
  - `POST /api/workflow/hyperliquid-order/run`
  - flow: `x402 challenge -> session pay -> proof verify -> Hyperliquid order`.
- Added new market action type:
  - `hyperliquid-order-testnet` (publish/invoke/reputation/receipt compatible).
- Added local one-click verification script:
  - `backend/scripts/run-agent001-closed-loop-demo.ps1`
  - runs AGENT001 trade-intent chat and prints x402 + open-orders evidence.
- Added Hyperliquid testnet trading adapter and API endpoints:
  - `GET /api/hyperliquid/testnet/health`
  - `GET /api/hyperliquid/testnet/mids`
  - `GET /api/hyperliquid/testnet/open-orders`
  - `GET /api/hyperliquid/testnet/order-status`
  - `POST /api/hyperliquid/testnet/order`
  - `POST /api/hyperliquid/testnet/cancel`
  - supports dry-run (`simulate=true`) and live order/cancel with testnet API wallet.
- Receipt export API for judge-friendly proof bundles:
  - `GET /api/receipt/:requestId`
  - optional `?download=1` to download `kiteclaw_receipt_<requestId>.json`.
- Receipt payload now includes:
  - `amount/tokenAddress/payer/payee`
  - `responseHash`
  - `responseSignature` (when backend signer is available).
- Added `x-reader-feed` service action end-to-end:
  - `POST /api/workflow/x-reader/run`
  - `POST /api/a2a/tasks/x-reader`
  - market publish/invoke support with x402 settlement.
- XMTP task result evidence for router-risk demo:
  - risk runtime now replies with `task-result` (instead of ack-only) for `task-envelope`.
  - `task-result` includes `status/result/error` and mock-bind fields:
    - `payment.mode/requestId/txHash`
    - `receiptRef.requestId/txHash/endpoint`.
- Trace evidence API now includes XMTP hop payload:
  - `GET /api/demo/trace/:traceId` returns `xmtp.total/xmtp.hops/xmtp.latestTaskResult`.
- Added XMTP workers-group runtime APIs:
  - `GET /api/xmtp/groups`
  - `POST /api/xmtp/groups/ensure`
  - `POST /api/xmtp/groups/send`
  - `POST /api/network/demo/router-risk-group/run`
  - flow rule: `DM task-envelope -> Group task-phase broadcast -> DM task-result`.
- Added 5-agent XMTP runtime bootstrap support:
  - new optional runtimes: `reader-runtime`, `price-runtime`, `executor-runtime`
  - `POST /api/xmtp/start` and `POST /api/xmtp/stop` now include all runtimes in response.
  - `GET /api/xmtp/status` and `GET /api/network/agents` now expose all runtime states.
- Added worker runtime task handlers (DM/group auto task-result):
  - `risk-agent`: `risk-score-feed`, `volatility-snapshot`
  - `price-agent`: `btc-price-feed`, `market-quote`
  - `reader-agent`: `x-reader-feed`, `url-digest`
  - `executor-agent`: `execute-plan`, `result-aggregation` (quote+risk+optional reader aggregation).
- Router-risk demos now support real x402 payment binding:
  - request field: `bindRealX402=true`
  - when enabled, backend runs risk-score workflow and injects verified payment proof into task-result:
    - `payment.mode/requestId/txHash/block/status/explorer/verifiedAt`
    - `receiptRef.requestId/txHash/block/status/explorer/endpoint`.
- Added persistent network command orchestration state machine (`data/network_commands.json`):
  - `POST /api/network/commands`
  - `POST /api/network/commands/:commandId/run`
  - `GET /api/network/commands`
  - `GET /api/network/commands/:commandId`
  - command status flow: `queued -> running -> done|failed`, with `attempts/events` and task refs (`traceId/requestId/taskId`).
- Added OpenAlice sidecar analysis integration (info + technical):
  - `GET /api/openalice/health`
  - `POST /api/analysis/info/run`
  - `POST /api/analysis/technical/run`
  - new env flags: `ANALYSIS_PROVIDER`, `OPENALICE_*`.
- Added XMTP info+technical orchestration demo endpoint:
  - `POST /api/network/demo/router-info-technical/run`
  - supports dual task dispatch (`info-analysis-feed` + `technical-analysis-feed`) and aggregated summary output.
- Added isolated XMTP quickstart sandbox (`experiments/xmtp-agent-quickstart`) to run the official Build-an-Agent flow independently from project backend.
- Added local OpenBB Docker ops scripts:
  - `backend/scripts/start-openbb-local.ps1`
  - `backend/scripts/stop-openbb-local.ps1`
  - `backend/scripts/verify-openbb-local.ps1`
  - `backend/docker/openbb/Dockerfile`

### Changed
- AGENT001 analysis path is now quote-first (`service-quote`) before strict x402 prebind for both:
  - `technical-analysis-feed`
  - `info-analysis-feed`
- AGENT001 prebind execution now retries transient failures (`timeout`/`ECONNRESET`/bundler revert windows) before failing.
- AGENT001 main path no longer depends on `x-reader` naming; user-facing flow is `info-analysis-feed`.
- AGENT001 strict x402 is now hard-enforced in router text flow:
  - non-`help/status` requests no longer allow free analysis/chat path.
- AGENT001 prebind now uses payment-first fast path:
  - risk/x-reader workflow prebind supports `prebindOnly=true` to settle x402 evidence first, skipping slow analysis in bind stage.
- AGENT001 bind timeout default aligned with session-pay path:
  - `AGENT001_BIND_TIMEOUT_MS` default raised from `45s` to `210s` to avoid premature prebind timeout under queued session userOps.

### Fixed
- AGENT001 paid-but-no-DM gap:
  - paid analysis request is persisted by `requestId` with status/result/error,
  - dispatch timeout now returns structured failure with pull endpoint hint.
- AGENT001 timeout/failure replies are now structured in DM:
  - include `stage + capability + code + reason`,
  - and provide explicit `need` hints for session sync / balance / queue-timeout diagnostics.
- `network_agents` schema extended with optional identity fields:
  - `identityRegistry`
  - `identityAgentId`
- Reader/Risk XMTP runtimes now support `service-quote` task capability.
- Demo and Ops UI now provide `Download Receipt` action from API result panels.
- Market form now supports x-reader fields (`url/mode/maxChars`) and service details render x-reader metadata.
- Info-analysis runtime path is now OpenAlice-first only:
  - `ANALYSIS_PROVIDER` is fixed to `openalice` in backend runtime.
  - legacy Jina x-reader fetch path is removed from active execution.
  - old `x-reader` mode values are treated as compatibility aliases to OpenAlice mode.
- Frontend removed SSE connection indicator and live event panel; polling-only UX for stable demos.
- `POST /api/network/demo/router-risk/run` now waits for `task-result` and returns:
  - `resultReceived/resultEvent/taskResult/payment/receiptRef`
  - keeps `ackReceived/ackEvent` as compatibility fields.
- Trace page (`/trace/:requestId`) now shows XMTP hop-by-hop evidence and task-result payment binding.
- Trace evidence mapping now includes x402 binding fields from XMTP task-result:
  - `payment.block/status/explorer/verifiedAt`
  - `receiptRef.block/status/explorer/verifiedAt`.
- `reader-agent` now accepts `info-analysis-feed`; `risk-agent` now accepts `technical-analysis-feed`.
- Network agents bootstrap now includes `technical-agent` facade (capability-level compatibility over risk/price internals).
- `router-info-technical` now uses longer wait window (`30s` default, up to `60s`) and waits info/technical task results in parallel.
- XMTP worker runtimes now support rule-based plain-text DM replies (greeting/help/status/pricing hints) while keeping `task-envelope -> task-result` behavior unchanged.
- OpenAlice adapter now supports dual endpoints (`message/info` + `technical`) and can fallback to `/api/chat` with strict JSON contracts when dedicated analysis endpoints are unavailable.
- Added local ops scripts for dual OpenAlice runtime management:
  - `backend/scripts/start-openalice-dual.ps1`
  - `backend/scripts/stop-openalice-dual.ps1`
  - `backend/scripts/verify-openalice-dual.ps1`
- `start-openalice-dual.ps1` now supports outbound proxy (`OPENALICE_PROXY_URL` / `OPENALICE_NO_PROXY`) for model API access behind restricted networks.
- OpenAlice technical prompt now explicitly requires tool usage (`calculateIndicator`) before returning JSON, reducing placeholder-only technical replies.
- Risk-score pipeline now classifies low-signal OpenAlice technical outputs as weak and automatically falls back to local deterministic analysis.
- OpenAlice timeout handling is now safer for tool-calling workloads:
  - backend enforces `OPENALICE_TIMEOUT_MS >= 30000` to avoid premature aborts on `/api/chat`.
- Low-signal detection for technical analysis now treats stale `asOf/quote.fetchedAt` timestamps (>7 days old) and `TOOL_ERROR` summaries as fallback triggers.
- Low-signal detection for info analysis now falls back when OpenAlice returns stale timestamps or "cannot retrieve information" placeholder summaries.
- Technical analysis normalization now rewrites stale/future OpenAlice timestamps to a fresh ISO time window, preventing false `low-signal` fallback when indicators are otherwise valid.
- Info-analysis input normalization now accepts either `http/https` URL or topic/query text (e.g. `btc market sentiment today`), enabling DM keyword tests without hard URL validation failures.
- OpenAlice info chat prompt now includes explicit `inputType/topic` semantics so topic-mode requests are handled without webpage fetch dependency.
- Info-analysis timestamp normalization now rewrites stale/future OpenAlice `asOf` to a fresh ISO time window, preventing false fallback on otherwise usable topic analysis.
- Info-analysis now performs one delayed retry before fallback when first OpenAlice result is low-signal, improving DM stability during warm-up/transient model responses.
- Router runtime (`AGENT001`) now supports LLM-assisted direct DM orchestration:
  - plain-text DM to `router-agent` is classified into `technical/info/both/chat/help`,
  - router dispatches XMTP `task-envelope` to `technical-agent`/`message-agent`,
  - aggregates `task-result` and replies to user in Chinese.
- Network agent defaults updated:
  - `router-agent` display name is now `AGENT001`,
  - added `message-agent` alias (mapped to reader runtime facade).
- Added debug endpoint for AGENT001 behavior without xmtp.chat:
  - `POST /api/agent001/chat/run`
- OpenAlice adapter now exposes generic message chat bridge:
  - `chatMessage({ role, message })`
- XMTP runtime now supports explicit network endpoint overrides:
  - `XMTP_API_URL`
  - `XMTP_HISTORY_SYNC_URL` (supports `null` to disable history sync endpoint)
  - `XMTP_GATEWAY_HOST`
- README now documents `xmtpd-1.1.1/doc/deploy.md` based local XMTP backend setup (`XMTP_ENV=local`).
- Added local helper scripts:
  - `backend/scripts/start-xmtp-local-env.ps1`
  - `backend/scripts/stop-xmtp-local-env.ps1`

### Removed
- Removed backend SSE stream endpoints:
  - `GET /api/demo/stream`
  - `GET /api/events/stream`
- SSE broadcast internals removed from active runtime (workflow broadcast kept as no-op for compatibility).
- Removed `experiments/xmtp-agent-quickstart` from version control;
  keep it as local-only sandbox and do not upload.

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
