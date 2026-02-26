# ─── Production Dockerfile ────────────────────────────────
# Bun runs TypeScript directly — no build step needed
# ──────────────────────────────────────────────────────────

FROM oven/bun:1 AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Install production deps only
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production

# Copy backend source (Bun runs TS directly)
COPY backend/ ./backend/
COPY tsconfig.json ./

# Copy frontend (static files, no build needed)
COPY frontend/ ./frontend/

# Create non-root user and data directory
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser && \
    mkdir -p /app/data && \
    chown -R appuser:appgroup /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Run as non-root
USER appuser

CMD ["bun", "backend/index.ts"]
