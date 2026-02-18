# KITECLAW x402 Demo Script (Judge Version)

## Goal
Show a complete x402 payment loop in one flow:
`402 Payment Required -> on-chain payment -> payment proof -> 200 response`.

## Preconditions
1. Backend is running: `cd backend && npm start`
2. Frontend is running: `cd frontend && npm run dev`
3. Wallet connected and authenticated once in Request page
4. AA wallet has enough test USDT and required test balances

## 90-second Demo Flow
1. Open **Request Page**.
2. Input example prompt:
   - `analyze top KOLs for AI payment campaign`
3. Click **Send**.
4. Explain the steps shown in UI status:
   - `Step 1/3`: client requests paid resource and gets `402`
   - `Step 2/3`: client pays challenge amount on-chain (AA transfer)
   - `Step 3/3`: client retries with payment proof and receives `200`
5. Show result card fields:
   - `x402 Request ID`
   - `Payment Tx Hash`
   - `Top KOLs`
6. Open **On-chain Confirmation** page:
   - query by tx hash
   - show indexed transfer + reconciliation card

## Judge Talking Points
1. This is not a plain transfer demo. It is an API payment protocol loop.
2. The paid action is cryptographically tied to the settlement tx hash.
3. The same flow can be reused for agent-to-API or agent-to-agent pricing.

## Failure Cases to Show (Optional Bonus)
1. Remove/modify proof fields -> backend returns `402` again with reason.
2. Use wrong amount or recipient in proof -> validation fails.
3. Insufficient balance -> transfer fails before proof step.

## Evidence Checklist
1. Request ID in UI
2. Payment tx hash in UI
3. Backend records entry (`/api/records`)
4. Goldsky/on-chain confirmation record
