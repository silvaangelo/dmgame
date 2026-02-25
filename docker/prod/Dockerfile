# ─── Production Dockerfile ────────────────────────────────
# Multi-stage build: compile TS → run plain JS
# ──────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Install ALL deps (including devDependencies for tsc)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy source
COPY tsconfig.json ./
COPY backend/ ./backend/

# Compile TypeScript
RUN pnpm build

# ── Stage 2: Production runtime ──────────────────────────
FROM node:20-slim AS runtime

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

ENV NODE_ENV=production

# Install only production deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod

# Copy compiled JS from builder
COPY --from=builder /app/dist/ ./dist/

# Copy frontend (static files, no build needed)
COPY frontend/ ./frontend/

# Create data directory for persistent stats (mount a volume here)
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Run compiled JavaScript
CMD ["node", "dist/backend/index.js"]
