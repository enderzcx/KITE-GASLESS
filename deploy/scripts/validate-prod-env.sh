#!/usr/bin/env bash
set -euo pipefail

BACKEND_ENV="${1:-/srv/kiteclaw/app/backend/.env}"

if [[ ! -f "$BACKEND_ENV" ]]; then
  echo "[ERROR] backend env file not found: $BACKEND_ENV" >&2
  exit 1
fi

read_env() {
  local key="$1"
  grep -E "^${key}=" "$BACKEND_ENV" | tail -n1 | cut -d= -f2- || true
}

is_true() {
  local value
  value="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

require_non_empty() {
  local key="$1"
  local value
  value="$(read_env "$key")"
  if [[ -z "$value" ]]; then
    echo "[ERROR] $key is required in $BACKEND_ENV" >&2
    exit 1
  fi
}

require_hex_address() {
  local key="$1"
  local value
  value="$(read_env "$key")"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "[ERROR] $key must be a valid 0x address, got: ${value:-<empty>}" >&2
    exit 1
  fi
}

require_hex_key() {
  local key="$1"
  local value
  value="$(read_env "$key")"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "[ERROR] $key must be a 32-byte hex private key, got: ${value:-<empty>}" >&2
    exit 1
  fi
}

echo "[INFO] validating backend env: $BACKEND_ENV"

require_non_empty "KITEAI_RPC_URL"
require_non_empty "KITEAI_BUNDLER_URL"
require_non_empty "KITE_ENTRYPOINT_ADDRESS"
require_non_empty "KITE_SETTLEMENT_TOKEN"
require_non_empty "KITE_MERCHANT_ADDRESS"
require_non_empty "ERC8004_AGENT_ID"
require_non_empty "ERC8004_IDENTITY_REGISTRY"

require_hex_key "KITECLAW_BACKEND_SIGNER_PRIVATE_KEY"
require_hex_address "KITE_SETTLEMENT_TOKEN"
require_hex_address "KITE_MERCHANT_ADDRESS"
require_hex_address "ERC8004_IDENTITY_REGISTRY"

IDENTITY_MODE="$(read_env "IDENTITY_VERIFY_MODE")"
if [[ "$IDENTITY_MODE" != "signature" && "$IDENTITY_MODE" != "registry_only" ]]; then
  echo "[ERROR] IDENTITY_VERIFY_MODE must be signature or registry_only (got: ${IDENTITY_MODE:-<empty>})" >&2
  exit 1
fi

AUTO_ENABLED="$(read_env "AUTO_BTC_PRICE_ENABLED")"
AUTO_INTERVAL="$(read_env "AUTO_BTC_PRICE_INTERVAL_MS")"
AUTO_SOURCE="$(read_env "AUTO_BTC_PRICE_SOURCE")"
AUTO_PAYER="$(read_env "AUTO_BTC_PRICE_PAYER")"

if [[ -z "$AUTO_INTERVAL" ]]; then
  echo "[ERROR] AUTO_BTC_PRICE_INTERVAL_MS is required." >&2
  exit 1
fi
if ! [[ "$AUTO_INTERVAL" =~ ^[0-9]+$ ]]; then
  echo "[ERROR] AUTO_BTC_PRICE_INTERVAL_MS must be integer milliseconds (got: $AUTO_INTERVAL)." >&2
  exit 1
fi
if (( AUTO_INTERVAL < 60000 )); then
  echo "[ERROR] AUTO_BTC_PRICE_INTERVAL_MS must be >= 60000 for production minute loop." >&2
  exit 1
fi

if [[ "$AUTO_SOURCE" != "hyperliquid" ]]; then
  echo "[WARN] AUTO_BTC_PRICE_SOURCE is '$AUTO_SOURCE' (recommended: hyperliquid with runtime fallback)." >&2
fi

if is_true "$AUTO_ENABLED"; then
  if [[ ! "$AUTO_PAYER" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "[ERROR] AUTO_BTC_PRICE_ENABLED=1 requires valid AUTO_BTC_PRICE_PAYER." >&2
    exit 1
  fi
fi

echo "[OK] production env validation passed."
