# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

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
