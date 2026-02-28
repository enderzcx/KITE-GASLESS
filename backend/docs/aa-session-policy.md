# AA Session Policy (No Backend Private-Key Confirmation)

Last updated: 2026-03-01 (Asia/Shanghai)

## Scope / 范围
- Applies to `/api/session/pay` and all x402 settlement paths that use AA session execution.
- 适用于 `/api/session/pay` 及所有依赖 AA session 的 x402 结算路径。

## Mandatory Policy / 强制策略
1. Session key must be the signer for userOp path.
2. Backend private key must not be used to confirm or sign userOp in normal flow.
3. EOA relay fallback is disabled by default and only allowed for emergency troubleshooting with explicit env flag.

1. userOp 必须由 session key 签名。
2. 正常流程禁止使用后端私钥确认或签名 userOp。
3. EOA relay fallback 默认关闭，仅允许在显式开关下用于应急排障。

## Runtime Guards / 运行时防护
- `KITE_ALLOW_BACKEND_USEROP_SIGN=0` (default)
- `KITE_ALLOW_EOA_RELAY_FALLBACK=0` (default)
- Session prechecks in `/api/session/pay` must pass before submit:
  - session exists on-chain
  - session agent equals runtime session key address
  - session spending rule check passes
  - AA v2 version check passes when `KITE_REQUIRE_AA_V2=1`

## Bundler Transport Resilience / Bundler 传输抗抖动
- Retry path handles transient transport failures (`ECONNRESET`, `ETIMEDOUT`, `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`, `5xx`).
- Configurable env knobs:
  - `KITE_BUNDLER_RPC_TIMEOUT_MS` (default: `15000`)
  - `KITE_BUNDLER_RPC_RETRIES` (default: `3`)
  - `KITE_BUNDLER_RPC_BACKOFF_BASE_MS` (default: `650`)
  - `KITE_BUNDLER_RPC_BACKOFF_MAX_MS` (default: `6000`)
  - `KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS` (default: `3000`)

## Verification Checklist / 核对清单
1. Confirm policy flags:
   - `KITE_ALLOW_BACKEND_USEROP_SIGN=0`
   - `KITE_ALLOW_EOA_RELAY_FALLBACK=0`
2. Confirm runtime session material:
   - `GET /api/session/runtime` returns `hasSessionPrivateKey=true`
   - session address/sessionId are present
3. Trigger one settlement and verify response:
   - `signerMode` should be `aa-session`
   - no `eoa_relay_*` reason in failure path unless fallback is intentionally enabled

## Incident Handling / 故障处理
- If settlement fails with transport errors, tune retry/backoff first.
- Do not re-enable backend private-key confirmation as a quick fix.
- For production incidents, attach:
  - requestId
  - sessionId
  - userOpHash (if available)
  - full reason string with transport markers

