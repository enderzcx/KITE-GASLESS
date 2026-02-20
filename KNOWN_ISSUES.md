# Known Issues & Workarounds

This page documents current testnet MVP issues and quick workarounds.

## 1) Timeout waiting for UserOperation

### Symptom
- UI shows: `Transfer failed: Timeout waiting for UserOperation ...`

### Common causes
- Session/rule mismatch after settings changed
- Bundler/indexing delay on testnet
- Recipient/scope not aligned with action policy
- Insufficient token balance for the selected action

### Workaround
1. Re-open `Agent Payment Settings`
2. Click `Generate Session Key & Apply Rules` again
3. Retry with stable baseline amount (`0.05` / `0.03`)
4. Confirm recipient is in allowed list
5. Verify AA `USDT` balance

## 2) x402 mapping shows not found

### Symptom
- `x402 Mapping` card says `not found` after transfer

### Common causes
- Transfer was not executed through x402 flow
- Request/proof not submitted for this tx hash
- Querying before backend record write completed

### Workaround
1. Ensure flow is: `Request Payment Info (402)` -> `Pay & Submit Proof`
2. Use the tx hash from paid action result card
3. Refresh once after backend confirms `200` unlock

## 3) Policy snapshot empty or unexpected

### Symptom
- Policy or limits not matching expected values in UI

### Common causes
- Old local storage values
- Backend policy changed but session not regenerated

### Workaround
1. Re-apply policy in `Agent Payment Settings`
2. Regenerate session key
3. Hard refresh page

## 4) Verifiable identity not configured

### Symptom
- Identity card shows `not configured`

### Common causes
- Missing backend env:
  - `ERC8004_IDENTITY_REGISTRY`
  - `ERC8004_AGENT_ID`

### Workaround
1. Set both variables in `backend/.env`
2. Restart backend
3. Refresh frontend

## 5) Goldsky data delay

### Symptom
- On-chain confirmation page does not immediately show latest tx

### Common causes
- Indexing lag on subgraph endpoint

### Workaround
1. Wait and refresh `On-chain Confirmation`
2. Verify tx first on Kite explorer
3. Use tx hash exact filter for faster matching
