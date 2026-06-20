#!/bin/sh
# ===========================================================================
# MarqueeIT - Next.js container entrypoint
# ===========================================================================
# Runs Prisma db push (creates tables from schema, no migration files needed)
# then starts the Next.js standalone server.
# ===========================================================================
set -e

echo "[entrypoint] MarqueeIT Next.js starting..."
echo "[entrypoint] DATABASE_URL=$DATABASE_URL"

# Ensure the db directory exists (for sqlite)
DB_DIR="$(dirname "$(echo "$DATABASE_URL" | sed 's/^file://')" )"
if [ -n "$DB_DIR" ] && [ "$DB_DIR" != "." ]; then
  mkdir -p "$DB_DIR" 2>/dev/null || true
fi

# Push the Prisma schema (creates tables if they don't exist).
# Using db push instead of migrate deploy because we don't ship migration
# files — the schema is the source of truth. --skip-generate because the
# client is already generated at build time. --accept-data-loss to allow
# schema changes that drop columns (acceptable for this app's data).
# (Hurdle #3 & #4: use npx prisma, not hardcoded node path)
echo "[entrypoint] Running prisma db push..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || {
  echo "[entrypoint] WARNING: prisma db push failed. Continuing anyway."
}

echo "[entrypoint] Starting Next.js on port $PORT..."
exec "$@"
