# ===========================================================================
# MarqueeIT - Next.js App Dockerfile
# ===========================================================================
# Multi-stage build:
#   1. Go builder: cross-compiles 5 binaries:
#      - marqueeit-client-linux (X11 input injection via CGO)
#      - marqueeit-client-linux-wayland (Wayland, view-only input)
#      - marqueeit-client-windows.exe (SendInput via MinGW CGO, no console)
#      - marqueeit-client-mac (view-only, input stubbed)
#      - marqueeit-launcher-windows.exe (tiny launcher that reads code from
#        its own filename)
#   2. Next.js builder: compiles the standalone Next.js app
#   3. Runtime: minimal Node image with the standalone build + binaries
# ===========================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build the Go customer client binaries + launcher
# ---------------------------------------------------------------------------
FROM golang:1.23-bookworm AS go-builder

WORKDIR /src

# Build arg for the server URL embedded in the launcher
ARG MARQUEEIT_SERVER_URL=https://support.wizardyoda.com

# Install system dependencies for CGo cross-compilation:
#   libx11-dev     — X11 client library headers (Linux X11 build)
#   libxtst-dev    — XTest extension headers (input injection)
#   libxrandr-dev  — XRandR headers (screen info)
#   gcc-mingw-w64-x86-64 — MinGW cross-compiler (Windows CGo build)
#   libpipewire-0.3-dev  — PipeWire headers (Wayland screen capture)
#   libspa-0.2-dev       — Simple Plugin API headers (PipeWire)
#   pkg-config           — Needed for PipeWire CGo #cgo pkg-config
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libx11-dev libxtst-dev libxrandr-dev \
        gcc-mingw-w64-x86-64 \
        libpipewire-0.3-dev libspa-0.2-dev \
        pkg-config && \
    rm -rf /var/lib/apt/lists/*

# Cache module downloads
COPY customer-client-go/go.mod ./
RUN go mod download

# Copy the rest of the source
COPY customer-client-go/ ./

# Build all binaries
RUN mkdir -p /out && \
    # 1. Linux X11 (CGO enabled for X11 input injection)
    CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/marqueeit-client-linux . && \
    # 2. Linux Wayland (view-only, no input injection)
    CGO_ENABLED=1 go build -tags wayland -ldflags="-s -w" -o /out/marqueeit-client-linux-wayland . && \
    # 3. Windows (CGO + MinGW for SendInput, static linking, no console window)
    CC=x86_64-w64-mingw32-gcc CGO_ENABLED=1 GOOS=windows GOARCH=amd64 \
        go build -ldflags="-s -w -H windowsgui -extldflags=-static -linkmode external" \
        -o /out/marqueeit-client-windows.exe . && \
    # 4. macOS (CGO disabled, input stubbed)
    CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o /out/marqueeit-client-mac . && \
    # 5. Windows launcher (pure Go, reads session code from filename)
    #    The server URL is embedded at build time. Override with:
    #    docker build --build-arg MARQUEEIT_SERVER_URL=https://your-domain.com
    cd launcher && \
    MARQUEEIT_SERVER_URL="${MARQUEEIT_SERVER_URL:-https://support.wizardyoda.com}" && \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
        go build -ldflags="-s -w -H windowsgui -X main.serverURL=$MARQUEEIT_SERVER_URL" \
        -o /out/marqueeit-launcher-windows.exe .

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
COPY --from=go-builder /out/marqueeit-client-linux-wayland ./public/downloads/marqueeit-client-linux-wayland
COPY --from=go-builder /out/marqueeit-client-windows.exe ./public/downloads/marqueeit-client-windows.exe
COPY --from=go-builder /out/marqueeit-client-mac ./public/downloads/marqueeit-client-mac
COPY --from=go-builder /out/marqueeit-launcher-windows.exe ./public/downloads/marqueeit-launcher-windows.exe

# Build the standalone Next.js app
RUN bun run build

# ---------------------------------------------------------------------------
# Stage 3: Runtime image
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Install openssl (Prisma), curl (healthchecks), zip (session-zip downloads)
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl ca-certificates curl zip && \
    rm -rf /var/lib/apt/lists/*

# IMPORTANT: Install Prisma CLI BEFORE copying @prisma from the builder,
# so npm can resolve @prisma/config and its dependencies cleanly.
# (Hurdle #5 & #6: install order matters.)
RUN npm install prisma@6.19.2

# Copy the standalone build
COPY --from=next-builder /app/.next/standalone ./
COPY --from=next-builder /app/.next/static ./.next/static
COPY --from=next-builder /app/public ./public

# Copy Prisma schema and generated client
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
