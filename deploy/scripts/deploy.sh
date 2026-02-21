#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/kiteclaw}"
APP_DIR="${APP_DIR:-$APP_ROOT/app}"
WEB_ROOT="${WEB_ROOT:-$APP_ROOT/www}"
DATA_ROOT="${DATA_ROOT:-$APP_ROOT/data}"
LOG_ROOT="${LOG_ROOT:-$APP_ROOT/logs}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[ERROR] command not found: $1" >&2
    exit 1
  }
}

require_cmd git
require_cmd npm
require_cmd node
require_cmd pm2

mkdir -p "$APP_ROOT" "$WEB_ROOT" "$DATA_ROOT" "$LOG_ROOT"

if [[ -d "$APP_DIR/.git" ]]; then
  echo "[INFO] Updating existing repo in $APP_DIR"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  if [[ -z "$REPO_URL" ]]; then
    echo "[ERROR] REPO_URL is required for first deploy." >&2
    exit 1
  fi
  echo "[INFO] Cloning $REPO_URL -> $APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "[ERROR] Missing $BACKEND_DIR/.env. Copy backend/.env.production.example first." >&2
  exit 1
fi

if [[ ! -f "$FRONTEND_DIR/.env.production" ]]; then
  echo "[ERROR] Missing $FRONTEND_DIR/.env.production. Copy frontend/.env.production.example first." >&2
  exit 1
fi

echo "[INFO] Preparing persistent data link"
if [[ -L "$BACKEND_DIR/data" ]]; then
  CURRENT_TARGET="$(readlink -f "$BACKEND_DIR/data" || true)"
  if [[ "$CURRENT_TARGET" != "$(readlink -f "$DATA_ROOT")" ]]; then
    rm -f "$BACKEND_DIR/data"
    ln -s "$DATA_ROOT" "$BACKEND_DIR/data"
  fi
elif [[ -d "$BACKEND_DIR/data" ]]; then
  cp -a "$BACKEND_DIR/data/." "$DATA_ROOT/" || true
  rm -rf "$BACKEND_DIR/data"
  ln -s "$DATA_ROOT" "$BACKEND_DIR/data"
else
  ln -s "$DATA_ROOT" "$BACKEND_DIR/data"
fi

echo "[INFO] Installing backend deps"
npm --prefix "$BACKEND_DIR" ci

echo "[INFO] Installing frontend deps"
npm --prefix "$FRONTEND_DIR" ci

echo "[INFO] Building frontend"
npm --prefix "$FRONTEND_DIR" run build

echo "[INFO] Publishing frontend dist to $WEB_ROOT"
rm -rf "$WEB_ROOT"/*
cp -a "$FRONTEND_DIR/dist/." "$WEB_ROOT/"

echo "[INFO] Starting/reloading PM2 app"
pm2 startOrReload "$APP_DIR/deploy/pm2/ecosystem.config.cjs" --update-env
pm2 save

echo "[OK] Deploy finished."
echo "[NEXT] If not done yet, apply nginx config and issue cert:"
echo "  sudo cp $APP_DIR/deploy/nginx/kiteclaw.conf /etc/nginx/sites-available/kiteclaw.conf"
echo "  sudo nginx -t && sudo systemctl reload nginx"
