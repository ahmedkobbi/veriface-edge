#!/bin/sh
# VeriFace Edge — Docker Entrypoint
#
# SECURITY FIX (Infra-03): Runs Prisma migration at container STARTUP,
# not at Docker build time. This ensures the migration connects to the
# production database (specified via DATABASE_URL env var) rather than
# baking the schema into the image.
#
# The migration is non-fatal — if it fails (e.g., DB not ready), the
# container still starts (the app will retry DB connections). For
# production, use a separate migration init container.

set -e

echo "[VeriFace Edge] Running database migration..."
bunx prisma migrate deploy 2>/dev/null || {
  echo "[VeriFace Edge] prisma migrate deploy failed (no migration files or DB not ready) — falling back to db push"
  bunx prisma db push --accept-data-loss 2>/dev/null || {
    echo "[VeriFace Edge] WARNING: DB migration failed — app will start but may fail on DB queries"
  }
}

echo "[VeriFace Edge] Starting server..."
exec "$@"
