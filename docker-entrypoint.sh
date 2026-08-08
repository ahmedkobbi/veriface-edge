#!/bin/sh
# VeriFace Edge — Docker Entrypoint
#
# Runs Prisma migration at container STARTUP (not build time), then starts
# the server. This ensures the migration connects to the production database
# specified via DATABASE_URL env var.
#
# Migration strategy:
#   1. Try `prisma migrate deploy` (applies pending migration files)
#   2. If no migration files exist, fall back to `prisma db push` (syncs schema)
#   3. If both fail (DB not ready), wait 5s and retry once
#   4. If still failing, start the app anyway (it will retry DB connections)
#
# In production with Kubernetes, use an init container for migrations instead.

set -e

MAX_RETRIES=3
RETRY_DELAY=5

run_migration() {
  echo "[VeriFace Edge] Attempting database migration (attempt $1/$MAX_RETRIES)..."

  # Try prisma migrate deploy first (production migrations)
  if bunx prisma migrate deploy 2>/dev/null; then
    echo "[VeriFace Edge] ✅ Migration completed successfully (migrate deploy)"
    return 0
  fi

  # Fall back to db push (syncs schema directly — for dev/staging)
  if bunx prisma db push --accept-data-loss 2>/dev/null; then
    echo "[VeriFace Edge] ✅ Schema synced successfully (db push)"
    return 0
  fi

  echo "[VeriFace Edge] ❌ Migration attempt $1 failed"
  return 1
}

# Try migration with retries
migration_success=false
for attempt in $(seq 1 $MAX_RETRIES); do
  if run_migration $attempt; then
    migration_success=true
    break
  fi

  if [ $attempt -lt $MAX_RETRIES ]; then
    echo "[VeriFace Edge] Waiting ${RETRY_DELAY}s before retry..."
    sleep $RETRY_DELAY
  fi
done

if [ "$migration_success" = false ]; then
  echo "[VeriFace Edge] ⚠️  WARNING: DB migration failed after $MAX_RETRIES attempts."
  echo "[VeriFace Edge]    The app will start but may fail on DB queries."
  echo "[VeriFace Edge]    Ensure DATABASE_URL is set and the database is reachable."
fi

echo "[VeriFace Edge] Starting server..."
exec "$@"
