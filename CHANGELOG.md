# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

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
