# AA V2 (Session UserOp Validation)

This folder contains a minimal V2 extension:

- `GokiteAccountV2.sol`
- copied baseline sources:
  - `GokiteAccount.sol`
  - `SessionManager.sol`
  - `callback/TokenCallbackHandler.sol`

## Purpose

Enable delegated session signer to pass `validateUserOp` for:

`executeTransferWithAuthorizationAndProvider(...)`

while keeping owner signature path backward-compatible.

## Notes

1. V2 is intentionally minimal.
2. V2 adds no new storage variable.
3. Upgrade safety still requires bytecode compile + test on testnet before switching production demo address.

## Current Flow after upgrade

1. User creates session and rules.
2. Session signer signs:
   - userOp signature (`eth_sign` over userOpHash)
   - transfer authorization EIP-712 payload
3. `validateUserOp` checks:
   - allowed selector
   - session signer == on-chain session agent
   - auth signature signer == session signer
   - token supported
   - master budget pass
   - session spending rules pass

## Upgrade process

Use scripts in `backend/scripts`:

- `npm run aa:preflight`
- deploy `GokiteAccountV2` implementation
- set env `KITECLAW_AA_NEW_IMPLEMENTATION`
- `npm run aa:upgrade`

Then re-run session creation and transfer tests in frontend.

