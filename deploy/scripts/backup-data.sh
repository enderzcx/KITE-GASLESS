#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${DATA_ROOT:-/srv/kiteclaw/data}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/kiteclaw/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

if [[ ! -d "$DATA_ROOT" ]]; then
  echo "[ERROR] DATA_ROOT does not exist: $DATA_ROOT" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$BACKUP_ROOT/kiteclaw-data-$STAMP.tar.gz"

tar -C "$(dirname "$DATA_ROOT")" -czf "$ARCHIVE" "$(basename "$DATA_ROOT")"
find "$BACKUP_ROOT" -type f -name 'kiteclaw-data-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[OK] Backup created: $ARCHIVE"
