#!/bin/sh
# ===========================================================================
# MarqueeIT - Next.js container entrypoint
# ===========================================================================
# Runs Prisma migrations (creates the sqlite db if needed) and then starts
# the Next.js standalone server.
# ===========================================================================
set -e

echo "[entrypoint] MarqueeIT Next.js starting..."
echo "[entrypoint] DATABASE_URL=$DATABASE_URL"

# Ensure the db directory exists (for sqlite)
DB_DIR="$(dirname "$(echo "$DATABASE_URL" | sed 's/^file://')" )"
if [ -n "$DB_DIR" ] && [ "$DB_DIR" != "." ]; then
  mkdir -p "$DB_DIR" 2>/dev/null || true
fi

# Push the Prisma schema (creates tables if they don't exist)
echo "[entrypoint] Running prisma db push..."
node ./node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>&1 || {
  echo "[entrypoint] WARNING: prisma db push failed. Continuing anyway."
}

echo "[entrypoint] Starting Next.js on port $PORT..."
exec "$@"
