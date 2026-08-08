#!/usr/bin/env bash
#
# VeriFace Edge — Database Restore Script
#
# Decrypts + restores an encrypted backup.
#
# Usage:
#   bash scripts/restore-db.sh <backup-file.enc>
#   bash scripts/restore-db.sh s3://bucket/path/to/backup.enc
#
# Features:
#   - Decrypts AES-256-GCM encrypted backup
#   - Verifies SHA-256 integrity (detects tampering)
#   - Supports both local files + S3 URIs
#   - Atomic restore (backup current DB before overwriting)
#   - SQLite + PostgreSQL support
#
# Environment variables:
#   BACKUP_ENCRYPTION_KEY  — 32-byte hex key (required, must match backup)
#   DATABASE_URL           — Target database (required)
#   RESTORE_BACKUP_CURRENT — If 'true', backs up current DB before restore (default: true)
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_NAME="veriface-restore"

BACKUP_FILE="${1:?❌ Usage: bash scripts/restore-db.sh <backup-file.enc|s3://bucket/path>}"
DATABASE_URL="${DATABASE_URL:?❌ DATABASE_URL not set}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:?❌ BACKUP_ENCRYPTION_KEY not set}"
RESTORE_BACKUP_CURRENT="${RESTORE_BACKUP_CURRENT:-true}"

# Detect database type
if [[ "$DATABASE_URL" == file:* ]]; then
  DB_TYPE="sqlite"
  DB_PATH="${DATABASE_URL#file:}"
elif [[ "$DATABASE_URL" == postgres* ]]; then
  DB_TYPE="postgres"
  DB_PATH="$DATABASE_URL"
else
  echo "❌ Unsupported DATABASE_URL format"
  exit 1
fi

# Logging
log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${SCRIPT_NAME}] $*"
}
error() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${SCRIPT_NAME}] ❌ $*" >&2
}

# ---------------------------------------------------------------------------
# Step 1: Download backup (if S3 URI)
# ---------------------------------------------------------------------------

log "=== VeriFace Edge Database Restore ==="
log "Source: $BACKUP_FILE"
log "Target: $DB_PATH ($DB_TYPE)"
log ""

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

LOCAL_BACKUP=""

if [[ "$BACKUP_FILE" == s3://* ]]; then
  log "[1/6] Downloading from S3..."
  LOCAL_BACKUP="$TEMP_DIR/backup.enc"
  if ! aws s3 cp "$BACKUP_FILE" "$LOCAL_BACKUP" 2>/dev/null; then
    error "S3 download failed"
    exit 2
  fi
  log "  ✅ Downloaded ($(du -h "$LOCAL_BACKUP" | cut -f1))"

  # Try to download manifest too
  MANIFEST_S3="${BACKUP_FILE}.manifest.json"
  if aws s3 ls "$MANIFEST_S3" >/dev/null 2>&1; then
    aws s3 cp "$MANIFEST_S3" "$TEMP_DIR/backup.manifest.json" 2>/dev/null || true
  fi
else
  if [ ! -f "$BACKUP_FILE" ]; then
    error "Backup file not found: $BACKUP_FILE"
    exit 2
  fi
  LOCAL_BACKUP="$BACKUP_FILE"
  log "[1/6] Using local backup file"
fi

# ---------------------------------------------------------------------------
# Step 2: Read manifest (if available)
# ---------------------------------------------------------------------------

log "[2/6] Reading backup manifest..."

ENCRYPTED_SHA256=""
ORIGINAL_SHA256=""
BACKUP_IV=""

if [ -f "$TEMP_DIR/backup.manifest.json" ]; then
  # Parse manifest JSON (requires jq or python3)
  if command -v jq >/dev/null 2>&1; then
    ENCRYPTED_SHA256=$(jq -r '.encryptedSha256' "$TEMP_DIR/backup.manifest.json")
    ORIGINAL_SHA256=$(jq -r '.originalSha256' "$TEMP_DIR/backup.manifest.json")
    BACKUP_IV=$(jq -r '.encryption.iv' "$TEMP_DIR/backup.manifest.json")
  elif command -v python3 >/dev/null 2>&1; then
    ENCRYPTED_SHA256=$(python3 -c "import json; m=json.load(open('$TEMP_DIR/backup.manifest.json')); print(m.get('encryptedSha256',''))")
    ORIGINAL_SHA256=$(python3 -c "import json; m=json.load(open('$TEMP_DIR/backup.manifest.json')); print(m.get('originalSha256',''))")
    BACKUP_IV=$(python3 -c "import json; m=json.load(open('$TEMP_DIR/backup.manifest.json')); print(m.get('encryption',{}).get('iv',''))")
  fi
  log "  ✅ Manifest loaded"
  log "  📋 Original SHA-256: $ORIGINAL_SHA256"
  log "  📋 IV: $BACKUP_IV"
else
  log "  ⚠️  No manifest found — will need IV as BACKUP_IV env var"
  BACKUP_IV="${BACKUP_IV:-}"
fi

if [ -z "$BACKUP_IV" ]; then
  error "No IV found. Set BACKUP_IV env var or provide manifest."
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Verify encrypted backup integrity
# ---------------------------------------------------------------------------

log "[3/6] Verifying encrypted backup integrity..."

ACTUAL_ENCRYPTED_SHA256=$(sha256sum "$LOCAL_BACKUP" | cut -d' ' -f1)
if [ -n "$ENCRYPTED_SHA256" ] && [ "$ACTUAL_ENCRYPTED_SHA256" != "$ENCRYPTED_SHA256" ]; then
  error "Encrypted backup SHA-256 mismatch!"
  error "  Expected: $ENCRYPTED_SHA256"
  error "  Actual:   $ACTUAL_ENCRYPTED_SHA256"
  error "  The backup may be corrupted or tampered with."
  exit 3
fi
log "  ✅ Encrypted SHA-256 verified: $ACTUAL_ENCRYPTED_SHA256"

# ---------------------------------------------------------------------------
# Step 4: Decrypt backup
# ---------------------------------------------------------------------------

log "[4/6] Decrypting backup (AES-256-GCM)..."

DECRYPTED_FILE="$TEMP_DIR/backup.db"
if ! openssl enc -aes-256-gcm -d \
  -in "$LOCAL_BACKUP" \
  -out "$DECRYPTED_FILE" \
  -K "$BACKUP_ENCRYPTION_KEY" \
  -iv "$BACKUP_IV" \
  2>/dev/null; then
  error "Decryption failed — wrong key, wrong IV, or corrupted data"
  exit 4
fi
log "  ✅ Decrypted ($(du -h "$DECRYPTED_FILE" | cut -f1))"

# Verify decrypted SHA-256
ACTUAL_ORIGINAL_SHA256=$(sha256sum "$DECRYPTED_FILE" | cut -d' ' -f1)
if [ -n "$ORIGINAL_SHA256" ] && [ "$ACTUAL_ORIGINAL_SHA256" != "$ORIGINAL_SHA256" ]; then
  error "Decrypted backup SHA-256 mismatch!"
  error "  Expected: $ORIGINAL_SHA256"
  error "  Actual:   $ACTUAL_ORIGINAL_SHA256"
  error "  The backup may be corrupted or the key is wrong."
  exit 4
fi
log "  ✅ Decrypted SHA-256 verified: $ACTUAL_ORIGINAL_SHA256"

# Verify backup integrity
if [ "$DB_TYPE" = "sqlite" ]; then
  INTEGRITY=$(sqlite3 "$DECRYPTED_FILE" "PRAGMA integrity_check;" 2>/dev/null || echo "error")
  if [ "$INTEGRITY" != "ok" ]; then
    error "Decrypted backup failed integrity check: $INTEGRITY"
    exit 4
  fi
  log "  ✅ SQLite integrity check: ok"
fi

# ---------------------------------------------------------------------------
# Step 5: Backup current database (safety net)
# ---------------------------------------------------------------------------

if [ "$RESTORE_BACKUP_CURRENT" = "true" ]; then
  log "[5/6] Backing up current database (safety net)..."

  PRE_RESTORE_BACKUP="${DB_PATH}.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)"

  if [ "$DB_TYPE" = "sqlite" ]; then
    if [ -f "$DB_PATH" ]; then
      cp "$DB_PATH" "$PRE_RESTORE_BACKUP"
      log "  ✅ Current DB backed up: $PRE_RESTORE_BACKUP"
    fi
  elif [ "$DB_TYPE" = "postgres" ]; then
    pg_dump --format=custom --compress=9 "$DB_PATH" > "$PRE_RESTORE_BACKUP" 2>/dev/null || true
    log "  ✅ Current DB backed up: $PRE_RESTORE_BACKUP"
  fi
else
  log "[5/6] Skipping pre-restore backup (RESTORE_BACKUP_CURRENT=false)"
fi

# ---------------------------------------------------------------------------
# Step 6: Restore database
# ---------------------------------------------------------------------------

log "[6/6] Restoring database..."

if [ "$DB_TYPE" = "sqlite" ]; then
  # Stop the app server before restoring (to avoid write conflicts)
  log "  ⚠️  Ensure the app server is stopped before continuing."
  read -p "  Is the app server stopped? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    error "Restore aborted — app server must be stopped"
    exit 1
  fi

  # Replace the database file
  cp "$DECRYPTED_FILE" "$DB_PATH"
  log "  ✅ Database restored: $DB_PATH"

  # Verify restored database
  INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>/dev/null || echo "error")
  if [ "$INTEGRITY" != "ok" ]; then
    error "Restored database failed integrity check!"
    error "Restore the pre-restore backup: $PRE_RESTORE_BACKUP"
    exit 6
  fi
  log "  ✅ Restored database integrity verified"

elif [ "$DB_TYPE" = "postgres" ]; then
  # Drop + recreate the database, then restore
  log "  ⚠️  This will DROP and recreate the database: $DB_PATH"
  read -p "  Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    error "Restore aborted"
    exit 1
  fi

  if ! pg_restore --clean --if-exists --no-owner --no-privileges \
       --dbname="$DB_PATH" "$DECRYPTED_FILE" 2>/dev/null; then
    error "pg_restore failed"
    exit 6
  fi
  log "  ✅ Database restored (PostgreSQL)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

log ""
log "=== Restore Complete ==="
log "  Source:   $BACKUP_FILE"
log "  Target:   $DB_PATH"
log "  Decrypted SHA-256: $ACTUAL_ORIGINAL_SHA256"
if [ "$RESTORE_BACKUP_CURRENT" = "true" ]; then
  log "  Pre-restore backup: $PRE_RESTORE_BACKUP"
fi
log ""
log "  Next steps:"
log "    1. Restart the app server"
log "    2. Verify data integrity (check audit log, user count, etc.)"
log "    3. Monitor for errors in the first 24 hours"
if [ "$RESTORE_BACKUP_CURRENT" = "true" ]; then
  log "    4. If issues found, restore from: $PRE_RESTORE_BACKUP"
fi
log ""
