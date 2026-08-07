#!/usr/bin/env bash
# VeriFace Edge — Database Backup Script
# Creates encrypted backups with integrity verification and rotation.

set -euo pipefail

DB_PATH="${DATABASE_URL:-file:./db/custom.db}"
DB_PATH="${DB_PATH#file:}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/veriface-${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

echo "[Backup] Starting database backup..."
echo "[Backup] Source: $DB_PATH"
echo "[Backup] Target: $BACKUP_FILE"

if [ ! -f "$DB_PATH" ]; then
  echo "[Backup] ERROR: Database file not found at $DB_PATH"
  exit 1
fi

sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

if ! sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" > /dev/null 2>&1; then
  echo "[Backup] ERROR: Backup integrity check failed"
  rm -f "$BACKUP_FILE"
  exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[Backup] Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

if [ -n "$BACKUP_ENCRYPTION_KEY" ]; then
  echo "[Backup] Encrypting backup..."
  if command -v age > /dev/null 2>&1; then
    age -r "$BACKUP_ENCRYPTION_KEY" "$BACKUP_FILE" > "$BACKUP_FILE.age"
    rm "$BACKUP_FILE"
    BACKUP_FILE="$BACKUP_FILE.age"
    echo "[Backup] Encrypted with age: $BACKUP_FILE"
  elif command -v gpg > /dev/null 2>&1; then
    gpg --encrypt --recipient "$BACKUP_ENCRYPTION_KEY" "$BACKUP_FILE"
    rm "$BACKUP_FILE"
    BACKUP_FILE="$BACKUP_FILE.gpg"
    echo "[Backup] Encrypted with GPG: $BACKUP_FILE"
  else
    echo "[Backup] WARNING: No encryption tool found."
  fi
fi

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[Backup] Uploading to S3..."
  aws s3 cp "$BACKUP_FILE" "s3://$BACKUP_S3_BUCKET/$(basename "$BACKUP_FILE")" --sse aws:kms
  echo "[Backup] S3 upload complete"
fi

find "$BACKUP_DIR" -name "veriface-*.db*" -mtime +$BACKUP_RETENTION_DAYS -delete
echo "[Backup] Done."
