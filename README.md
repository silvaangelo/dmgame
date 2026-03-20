# ⚔ Deathmatch Arena

Real-time multiplayer top-down shooter — play directly in your browser.

Server located in Brazil, ping may vary based on your location. Best played on desktop with keyboard and mouse, but mobile support is available with touch controls.

🎮 **Play now:** [https://biru-shooting-game.com](https://biru-shooting-game.com)

## About

Deathmatch Arena is a fast-paced browser game where players fight in a top-down arena. First to 5 kills wins. The server is authoritative — all game logic runs server-side to prevent cheating.

### Features

- **4 weapons** — Machine Gun, Shotgun, Knife, and Sniper Rifle (+ Minigun powerup)
- **Powerups** — Health, ammo, speed boost, minigun, shield, invisibility, and health regen
- **Bombs & Lightning** — Randomly spawning explosives and lightning strikes
- **Dynamic zone** — Arena shrinks over time, forcing players together
- **Destructible obstacles** — Shoot through walls and trees
- **Kill streaks** — Get rewarded for consecutive kills
- **Mobile support** — Touch controls with virtual joystick
- **Real-time** — 35 Hz server tick rate
- **MessagePack protocol** — Binary WebSocket serialization for minimal bandwidth

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Go 1.23 |
| Backend | Go, gorilla/websocket |
| Frontend | Vanilla JS, Canvas 2D, Web Audio API |
| Protocol | MessagePack + custom binary state (gorilla/websocket) |
| Build | `go build` (backend), esbuild (frontend minification) |
| Container | Docker, docker-compose |
| CI/CD | GitHub Actions → DigitalOcean Droplet |

## Getting Started

### With Docker (recommended)

```bash
# Development — mounts source, restart to recompile Go changes
docker compose --profile dev up --build

# Production build — full minified image
docker compose --profile prod up --build
```

Open [http://localhost:3000](http://localhost:3000).

### Without Docker

```bash
# Make sure Go 1.23+ is installed
go version

# Build and run the backend (serves frontend too)
cd backend-go && go run .

# Or build a binary first
cd backend-go && go build -o ../dmgame-server . && cd .. && ./dmgame-server
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev:go` | Build Go binary and start the server |
| `bun run build:go` | Compile Go binary to `./dmgame-server` |
| `bun run start:go` | Run the compiled `./dmgame-server` binary |
| `bun run build:frontend` | Minify frontend JS/CSS to `dist/frontend/` |

## Project Structure

```
backend-go/     Go backend (single binary serves everything)
  main.go       HTTP server, static files, WebSocket upgrade
  socket.go     WebSocket connection handler, message routing
  game.go       Game loop, physics, combat, spawning, rounds
  types.go      All type definitions
  config.go     Game constants
  protocol.go   MessagePack + binary state encoding
  state.go      Global shared state
  utils.go      Broadcast, serialization helpers
  database.go   JSON persistence (stats, history)
  spatial.go    Spatial hash grid for collision queries
frontend/       Static frontend (served by the Go binary)
docker/         Dockerfiles for dev and prod
nginx/          Reverse proxy config (prod)
```

## Docker

```bash
# Development
docker compose --profile dev up --build

# Production
docker compose --profile prod up --build
```

## License

MIT
