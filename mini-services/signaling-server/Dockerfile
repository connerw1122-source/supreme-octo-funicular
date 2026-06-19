# ===========================================================================
# MarqueeIT - Signaling Server Dockerfile
# ===========================================================================
# Bun-based signaling server (WebSocket relay for screen frames + input).
# Uses the official Bun image. Does NOT use --hot so file changes don't
# kill the server in production.
# ===========================================================================

FROM oven/bun:1.1-debian AS builder

WORKDIR /app

# Copy package.json and install deps
COPY package.json ./
RUN bun install --production

# Copy the server source
COPY index.ts ./

# ---------------------------------------------------------------------------
# Runtime stage: same image, just rename for clarity
# ---------------------------------------------------------------------------
FROM oven/bun:1.1-debian

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app ./

ENV PORT=3003
ENV HOSTNAME=0.0.0.0

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3003/health || exit 1

# Run with bun (NOT --hot) for production stability
CMD ["bun", "index.ts"]
