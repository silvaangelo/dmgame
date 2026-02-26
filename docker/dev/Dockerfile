# ─── Dev Dockerfile ───────────────────────────────────────
# Bun runs TypeScript directly with --watch for hot-reload
FROM oven/bun:1

WORKDIR /app

# Install deps first (cache layer)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source (volumes will override in docker-compose)
COPY . .

EXPOSE 3000

# Run with Bun's built-in watch mode
CMD ["bun", "run", "--watch", "backend/index.ts"]
