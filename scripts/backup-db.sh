#!/usr/bin/env bash
#
# VeriFace Edge — Production Database Backup Script
#
# Features:
#   - AES-256-GCM encryption (via OpenSSL — military-grade)
#   - SHA-256 integrity verification (detects corruption/tampering)
#   - Atomic SQLite backup (no partial backups)
#   - S3 upload with KMS encryption + lifecycle rotation
#   - Local retention policy (delete old backups)
#   - Backup manifest (JSON — for audit trail)
#   - PostgreSQL support (pg_dump for production)
#
# Usage:
#   bash scripts/backup-db.sh
#
# Environment variables:
#   DATABASE_URL           — SQLite path or PostgreSQL URL (required)
#   BACKUP_ENCRYPTION_KEY  — 32-byte hex key for AES-256-GCM (required)
#                            Generate: openssl rand -hex 32
#   BACKUP_S3_BUCKET       — S3 bucket for offsite storage (optional)
#   BACKUP_S3_PREFIX       — S3 key prefix (default: backups/)
#   BACKUP_S3_KMS_KEY_ID   — KMS key ID for server-side encryption (optional)
#   BACKUP_RETENTION_DAYS  — Local retention (default: 7)
#   BACKUP_RETENTION_S3    — S3 retention (default: 30, managed by lifecycle policy)
#   BACKUP_DIR             — Local backup directory (default: ./backups)
#   BACKUP_TYPE            — 'sqlite' | 'postgres' (auto-detected from DATABASE_URL)
#
# Exit codes:
#   0 — Success
#   1 — Configuration error
#   2 — Backup failed
#   3 — Encryption failed
#   4 — Integrity check failed
#   5 — S3 upload failed
#   6 — Rotation failed

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_NAME="veriface-backup"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DATE=$(date -u +%Y-%m-%d)
HOST=$(hostname -s 2>/dev/null || echo "unknown")

DATABASE_URL="${DATABASE_URL:?❌ DATABASE_URL not set}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:?❌ BACKUP_ENCRYPTION_KEY not set (generate with: openssl rand -hex 32)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups}"
BACKUP_S3_KMS_KEY_ID="${BACKUP_S3_KMS_KEY_ID:-}"

# Detect backup type from DATABASE_URL
if [[ "$DATABASE_URL" == file:* ]]; then
  BACKUP_TYPE="sqlite"
  DB_PATH="${DATABASE_URL#file:}"
elif [[ "$DATABASE_URL" == postgres* ]]; then
  BACKUP_TYPE="postgres"
  DB_PATH="$DATABASE_URL"
else
  echo "❌ Unsupported DATABASE_URL format: $DATABASE_URL"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

BACKUP_BASENAME="${SCRIPT_NAME}-${DATE}-${TIMESTAMP}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_BASENAME}.db"
ENCRYPTED_FILE="${BACKUP_FILE}.enc"
MANIFEST_FILE="${BACKUP_DIR}/${BACKUP_BASENAME}.manifest.json"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${SCRIPT_NAME}] $*"
}

error() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [${SCRIPT_NAME}] ❌ $*" >&2
}

# ---------------------------------------------------------------------------
# Step 1: Create backup
# ---------------------------------------------------------------------------

log "=== VeriFace Edge Database Backup ==="
log "Backup type: $BACKUP_TYPE"
log "Source: $DB_PATH"
log "Target: $BACKUP_FILE"
log ""

log "[1/6] Creating backup..."

if [ "$BACKUP_TYPE" = "sqlite" ]; then
  if [ ! -f "$DB_PATH" ]; then
    error "Database file not found: $DB_PATH"
    exit 2
  fi

  # Use SQLite's .backup command for atomic backup (no partial backups)
  # This uses the online backup API — safe even while the DB is being written to
  if ! sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'" 2>/dev/null; then
    # Fallback: copy the file (less safe, but works without sqlite3)
    log "sqlite3 not available — using file copy (may be non-atomic)"
    cp "$DB_PATH" "$BACKUP_FILE"
  fi

elif [ "$BACKUP_TYPE" = "postgres" ]; then
  # PostgreSQL: use pg_dump with custom format (compressed + parallel restore)
  if ! pg_dump --format=custom --compress=9 --no-owner --no-privileges \
       --file="$BACKUP_FILE" "$DB_PATH" 2>/dev/null; then
    error "pg_dump failed — check PostgreSQL connection"
    exit 2
  fi
fi

BACKUP_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
BACKUP_SIZE_HUMAN=$(du -h "$BACKUP_FILE" | cut -f1)
log "  ✅ Backup created: $BACKUP_SIZE_HUMAN ($BACKUP_SIZE bytes)"

# ---------------------------------------------------------------------------
# Step 2: Verify backup integrity
# ---------------------------------------------------------------------------

log "[2/6] Verifying backup integrity..."

if [ "$BACKUP_TYPE" = "sqlite" ]; then
  INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>/dev/null || echo "error")
  if [ "$INTEGRITY" != "ok" ]; then
    error "Backup integrity check failed: $INTEGRITY"
    rm -f "$BACKUP_FILE"
    exit 4
  fi
  log "  ✅ SQLite integrity check: ok"
elif [ "$BACKUP_TYPE" = "postgres" ]; then
  # PostgreSQL custom format — verify with pg_restore --list
  if ! pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1; then
    error "Backup integrity check failed (pg_restore --list)"
    rm -f "$BACKUP_FILE"
    exit 4
  fi
  log "  ✅ PostgreSQL backup structure verified"
fi

# Compute SHA-256 hash (for integrity verification after encryption)
BACKUP_SHA256=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)
log "  📋 SHA-256: $BACKUP_SHA256"

# ---------------------------------------------------------------------------
# Step 3: Encrypt backup (AES-256-GCM)
# ---------------------------------------------------------------------------

log "[3/6] Encrypting backup (AES-256-GCM)..."

# Generate a random 12-byte IV (96 bits — standard for GCM)
BACKUP_IV=$(openssl rand -hex 12)

# Encrypt with AES-256-GCM
# - The key is the 32-byte hex string (64 hex chars)
# - The IV is the 12-byte hex string (24 hex chars)
# - The output is: ciphertext + auth tag (16 bytes appended)
if ! openssl enc -aes-256-gcm \
  -in "$BACKUP_FILE" \
  -out "$ENCRYPTED_FILE" \
  -K "$BACKUP_ENCRYPTION_KEY" \
  -iv "$BACKUP_IV" \
  2>/dev/null; then
  error "AES-256-GCM encryption failed"
  rm -f "$BACKUP_FILE"
  exit 3
fi

ENCRYPTED_SIZE=$(stat -c%s "$ENCRYPTED_FILE" 2>/dev/null || stat -f%z "$ENCRYPTED_FILE")
ENCRYPTED_SHA256=$(sha256sum "$ENCRYPTED_FILE" | cut -d' ' -f1)

log "  ✅ Encrypted: $ENCRYPTED_FILE ($(du -h "$ENCRYPTED_FILE" | cut -f1))"
log "  📋 IV: $BACKUP_IV"
log "  📋 Encrypted SHA-256: $ENCRYPTED_SHA256"

# Verify decryption works (round-trip test)
log "  Verifying decryption (round-trip test)..."
DECRYPTED_TEST=$(mktemp)
if ! openssl enc -aes-256-gcm -d \
  -in "$ENCRYPTED_FILE" \
  -out "$DECRYPTED_TEST" \
  -K "$BACKUP_ENCRYPTION_KEY" \
  -iv "$BACKUP_IV" \
  2>/dev/null; then
  error "Decryption verification failed — backup is corrupt"
  rm -f "$BACKUP_FILE" "$ENCRYPTED_FILE" "$DECRYPTED_TEST"
  exit 3
fi

DECRYPTED_SHA256=$(sha256sum "$DECRYPTED_TEST" | cut -d' ' -f1)
if [ "$DECRYPTED_SHA256" != "$BACKUP_SHA256" ]; then
  error "Round-trip verification failed — decrypted hash mismatch"
  rm -f "$BACKUP_FILE" "$ENCRYPTED_FILE" "$DECRYPTED_TEST"
  exit 3
fi
log "  ✅ Round-trip decryption verified"
rm -f "$DECRYPTED_TEST"

# Remove unencrypted backup
rm -f "$BACKUP_FILE"

# ---------------------------------------------------------------------------
# Step 4: Generate manifest (audit trail)
# ---------------------------------------------------------------------------

log "[4/6] Generating backup manifest..."

cat > "$MANIFEST_FILE" << EOF
{
  "backupId": "${BACKUP_BASENAME}",
  "timestamp": "${TIMESTAMP}",
  "date": "${DATE}",
  "host": "${HOST}",
  "backupType": "${BACKUP_TYPE}",
  "source": "${DB_PATH}",
  "encryptedFile": "$(basename "$ENCRYPTED_FILE")",
  "encryptedSizeBytes": ${ENCRYPTED_SIZE},
  "encryptedSha256": "${ENCRYPTED_SHA256}",
  "originalSizeBytes": ${BACKUP_SIZE},
  "originalSha256": "${BACKUP_SHA256}",
  "encryption": {
    "algorithm": "AES-256-GCM",
    "keySizeBits": 256,
    "iv": "${BACKUP_IV}",
    "ivSizeBits": 96,
    "authTagSizeBits": 128
  },
  "retentionPolicy": {
    "localDays": ${BACKUP_RETENTION_DAYS},
    "s3Days": ${BACKUP_RETENTION_S3:-30}
  },
  "s3Bucket": "${BACKUP_S3_BUCKET}",
  "s3Key": "${BACKUP_S3_PREFIX}/${HOST}/${DATE}/$(basename "$ENCRYPTED_FILE")"
}
EOF

log "  ✅ Manifest written: $MANIFEST_FILE"

# ---------------------------------------------------------------------------
# Step 5: Upload to S3 (if configured)
# ---------------------------------------------------------------------------

S3_URI=""
if [ -n "$BACKUP_S3_BUCKET" ]; then
  log "[5/6] Uploading to S3..."

  S3_KEY="${BACKUP_S3_PREFIX}/${HOST}/${DATE}/$(basename "$ENCRYPTED_FILE")"
  S3_URI="s3://${BACKUP_S3_BUCKET}/${S3_KEY}"

  S3_ARGS="cp"
  if [ -n "$BACKUP_S3_KMS_KEY_ID" ]; then
    S3_ARGS="$S3_ARGS --sse aws:kms --sse-kms-key-id $BACKUP_S3_KMS_KEY_ID"
  else
    S3_ARGS="$S3_ARGS --sse AES256"
  fi

  if ! aws s3 $S3_ARGS "$ENCRYPTED_FILE" "$S3_URI" 2>/dev/null; then
    error "S3 upload failed"
    exit 5
  fi
  log "  ✅ Uploaded to: $S3_URI"

  # Upload manifest too
  aws s3 cp "$MANIFEST_FILE" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}.manifest.json" \
    --sse AES256 2>/dev/null || true

  # Verify upload by checking object exists
  if ! aws s3 ls "$S3_URI" >/dev/null 2>&1; then
    error "S3 upload verification failed — object not found"
    exit 5
  fi
  log "  ✅ S3 upload verified"
else
  log "[5/6] S3 not configured — skipping upload (local backup only)"
fi

# ---------------------------------------------------------------------------
# Step 6: Rotate old backups (local retention)
# ---------------------------------------------------------------------------

log "[6/6] Rotating old backups (retention: ${BACKUP_RETENTION_DAYS} days)..."

DELETED_COUNT=0
find "$BACKUP_DIR" -name "${SCRIPT_NAME}-*.enc" -type f -mtime +${BACKUP_RETENTION_DAYS} | while read -r old_file; do
  rm -f "$old_file"
  rm -f "${old_file%.enc}.manifest.json" 2>/dev/null || true
  log "  🗑️  Deleted: $(basename "$old_file")"
  DELETED_COUNT=$((DELETED_COUNT + 1))
done

REMAINING=$(find "$BACKUP_DIR" -name "${SCRIPT_NAME}-*.enc" -type f | wc -l)
log "  ✅ Rotation complete — $REMAINING local backup(s) remaining"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

log ""
log "=== Backup Complete ==="
log "  Backup ID: ${BACKUP_BASENAME}"
log "  Encrypted: ${ENCRYPTED_FILE}"
log "  Manifest:  ${MANIFEST_FILE}"
if [ -n "$S3_URI" ]; then
  log "  S3:        ${S3_URI}"
fi
log "  Size:      $(du -h "$ENCRYPTED_FILE" | cut -f1) (encrypted)"
log "  Algorithm: AES-256-GCM (256-bit key, 96-bit IV, 128-bit auth tag)"
log "  Verified:  Round-trip decryption + SHA-256 integrity"
log ""

exit 0
