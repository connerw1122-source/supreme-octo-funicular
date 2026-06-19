# ===========================================================================
# MarqueeIT - Next.js App Dockerfile
# ===========================================================================
# Multi-stage build:
#   1. Go builder: cross-compiles the customer client binaries for
#      Linux/Windows/Mac so they can be served as static downloads
#   2. Next.js builder: compiles the standalone Next.js app
#   3. Runtime: minimal Node image with the standalone build + binaries
# ===========================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build the Go customer client binaries
# ---------------------------------------------------------------------------
FROM golang:1.23-bookworm AS go-builder

WORKDIR /src

# Cache module downloads
COPY customer-client-go/go.mod ./
RUN go mod download

# Copy the rest of the source
COPY customer-client-go/ ./

# Build for all three platforms. CGO is enabled for Linux (X11 input),
# disabled for Windows/Mac (input injection is stubbed in those builds).
# Windows uses -H windowsgui to hide the console window.
RUN mkdir -p /out && \
    CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/marqueeit-client-linux . && \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" -o /out/marqueeit-client-windows.exe . && \
    CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o /out/marqueeit-client-mac .

# ---------------------------------------------------------------------------
# Stage 2: Build the Next.js standalone app
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS next-builder

WORKDIR /app

# Install bun (used by the project's scripts) and openssl (for Prisma)
RUN npm install -g bun && \
    apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy lockfile and package.json first for cache
COPY package.json bun.lock* ./
COPY prisma ./prisma

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Generate Prisma client
RUN bun run db:generate

# Copy the rest of the source
COPY . .

# Copy the Go binaries into public/downloads so Next.js serves them
COPY --from=go-builder /out/marqueeit-client-linux ./public/downloads/marqueeit-client-linux
COPY --from=go-builder /out/marqueeit-client-windows.exe ./public/downloads/marqueeit-client-windows.exe
COPY --from=go-builder /out/marqueeit-client-mac ./public/downloads/marqueeit-client-mac

# Build the standalone Next.js app
RUN bun run build

# ---------------------------------------------------------------------------
# Stage 3: Runtime image
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Install openssl (Prisma needs it at runtime), curl (for healthchecks), and
# zip (for generating session-zip downloads)
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl ca-certificates curl zip && \
    rm -rf /var/lib/apt/lists/*

# Copy the standalone build
COPY --from=next-builder /app/.next/standalone ./
COPY --from=next-builder /app/.next/static ./.next/static
COPY --from=next-builder /app/public ./public

# Copy Prisma schema + migrations so we can run them at startup
COPY --from=next-builder /app/prisma ./prisma
COPY --from=next-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=next-builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy the entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Default to a sqlite db file inside the container. Mount a volume at /app/db
# to persist it across container restarts.
ENV DATABASE_URL="file:/app/db/marqueeit.db"

EXPOSE 3000

# Healthcheck: hit the home page
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/ || exit 1

# Create the db directory so the sqlite file can be created on first run
RUN mkdir -p /app/db

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
