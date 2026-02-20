# AA V2 Upgrade Playbook

This playbook is for upgrading your existing AA proxy to a new implementation (V2) for session-userOp validation.

## 1) Preflight (must pass first)

Set env in `backend/.env`:

```env
KITEAI_RPC_URL=https://rpc-testnet.gokite.ai/
KITECLAW_AA_PROXY=0x88E1E1A56cCdbDbfE40C889DE66E7415FA7C6Cfc
```

Run:

```bash
cd backend
npm run aa:preflight
```

Check output:
- `implementation`: current implementation address
- `owner`: should match your EOA/signer
- `likelyUUPS`: should be `true` for this path

## 2) Deploy new implementation (V2)

Use your Solidity toolchain (Hardhat/Foundry) to deploy `GokiteAccountV2`.

Record the new implementation address:

```text
KITECLAW_AA_NEW_IMPLEMENTATION=0xYourNewImplementation
```

## 3) Upgrade proxy

Set env in `backend/.env`:

```env
PRIVATE_KEY=0x_your_owner_private_key
KITECLAW_AA_PROXY=0x88E1E1A56cCdbDbfE40C889DE66E7415FA7C6Cfc
KITECLAW_AA_NEW_IMPLEMENTATION=0xYourNewImplementation
KITECLAW_AA_UPGRADE_CALLDATA=0x
```

Run:

```bash
cd backend
npm run aa:upgrade
```

Expected:
- tx submitted
- tx confirmed
- proxy now points to new implementation

## 4) Post-upgrade checks

1. Check explorer `Upgraded(address implementation)` event.
2. Verify new implementation address is active.
3. Re-run session creation and transfer test.

## 5) Rollback strategy

Keep a stable baseline before upgrade.
If V2 fails in demo:
- switch back to stable branch/tag
- keep V2 work in a feature branch.

