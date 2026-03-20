# ─── Dev Dockerfile (Go) ──────────────────────────────────
# go run recompiles on each start; restart the container to
# pick up backend changes. Frontend is served directly from
# the mounted ./frontend volume.
FROM golang:1.23-alpine

WORKDIR /workspace

# Pre-download module deps into the image cache.
# The volume mount at runtime overrides the source files but
# the module cache in /root/go/pkg/mod is preserved.
COPY backend-go/go.mod backend-go/go.sum ./backend-go/
RUN cd backend-go && go mod download

EXPOSE 3000

# CWD is /workspace/backend-go so the server finds frontend
# at ../frontend (the volume mount at /workspace/frontend).
CMD ["sh", "-c", "cd /workspace/backend-go && go run ."]
