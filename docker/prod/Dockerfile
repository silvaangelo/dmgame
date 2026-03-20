# ─── Production Dockerfile (Go) ──────────────────────────
# Three-stage build:
#   1. Minify frontend JS/CSS with esbuild (via Bun)
#   2. Compile Go binary (static, no CGO)
#   3. Minimal Alpine runtime — binary + frontend only
# ──────────────────────────────────────────────────────────

# ── Stage 1: Minify frontend ──────────────────────────────
FROM oven/bun:1 AS frontend-builder

WORKDIR /build

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY scripts/ ./scripts/
COPY frontend/ ./frontend/
RUN node scripts/build-frontend.js

# ── Stage 2: Build Go binary ──────────────────────────────
FROM golang:1.23-alpine AS go-builder

WORKDIR /build

COPY backend-go/go.mod backend-go/go.sum ./
RUN go mod download

COPY backend-go/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o dmgame-server .

# ── Stage 3: Minimal runtime ──────────────────────────────
FROM alpine:3.21

RUN apk add --no-cache wget ca-certificates

WORKDIR /app

# Copy Go binary
COPY --from=go-builder /build/dmgame-server .

# Copy minified frontend
COPY --from=frontend-builder /build/dist/frontend/ ./frontend/

# Non-root user + writable data directory
RUN addgroup -S appgroup && adduser -S -G appgroup appuser && \
    mkdir -p /app/data && \
    chown -R appuser:appgroup /app/data

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:3000 || exit 1

CMD ["./dmgame-server"]
