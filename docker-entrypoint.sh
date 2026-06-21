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
# client is already generated at build time.
# NOTE: We do NOT use --accept-data-loss. If the schema changed in a way
# that would drop columns/data, the push will fail safely and the container
# will start with the OLD schema (better than silently losing data).
# To apply breaking schema changes, manually run prisma db push --accept-data-loss.
echo "[entrypoint] Running prisma db push..."
npx prisma db push --skip-generate 2>&1 || {
  echo "[entrypoint] WARNING: prisma db push failed. Continuing anyway."
  echo "[entrypoint] If you changed the schema, you may need to run:"
  echo "[entrypoint]   docker compose exec nextjs npx prisma db push --accept-data-loss"
}

echo "[entrypoint] Starting Next.js on port $PORT..."
exec "$@"
