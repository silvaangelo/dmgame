# ─── Dev Dockerfile ───────────────────────────────────────
# Uses ts-node to run TypeScript directly with hot-reload via --watch
FROM node:24-slim

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# Install deps first (cache layer)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy source (volumes will override in docker-compose)
COPY . .

EXPOSE 3000

# Run with tsx (source-level, no build step — handles ESM natively)
CMD ["./node_modules/.bin/tsx", "backend/index.ts"]
