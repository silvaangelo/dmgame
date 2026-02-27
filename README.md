# ⚔ Deathmatch Arena

Real-time multiplayer top-down shooter — play directly in your browser.

Server located in Brazil, ping may vary based on your location. Best played on desktop with keyboard and mouse, but mobile support is available with touch controls.

🎮 **Play now:** [https://biru-shooting-game.com](https://biru-shooting-game.com)

## About

Deathmatch Arena is a fast-paced browser game where players fight in a top-down arena. First to 5 kills wins. The server is authoritative — all game logic runs server-side to prevent cheating, its really neat.

### Features

- **4 weapons** — Machine Gun, Shotgun, Knife, and Sniper Rifle (+ Minigun powerup)
- **Powerups** — Health, ammo, speed boost, minigun, shield, invisibility, and health regen
- **Bombs & Lightning** — Randomly spawning explosives and lightning strikes
- **Dynamic zone** — Arena shrinks over time, forcing players together
- **Destructible obstacles** — Shoot through walls and trees
- **Kill streaks** — Get rewarded for consecutive kills
- **Mobile support** — Touch controls with virtual joystick
- **Real-time** — 35 Hz server tick rate with client-side prediction
- **MessagePack protocol** — Binary WebSocket serialization for minimal bandwidth

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun ≥ 1.2 |
| Backend | TypeScript, Express 5, ws |
| Frontend | Vanilla JS, Canvas 2D, Web Audio API |
| Protocol | MessagePack (binary WebSocket) |
| Build | tsc (typecheck), Bun (runtime) |
| Package | Bun (built-in package manager) |
| Lint | ESLint 10, typescript-eslint |
| Container | Docker, docker-compose |
| CI/CD | GitHub Actions → DigitalOcean Droplet |

## Getting Started

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Open in browser
open http://localhost:3000
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server (hot reload via `--watch`) |
| `bun run build` | Compile TypeScript + bundle frontend |
| `bun run start` | Run production build |
| `bun run typecheck` | Type-check without emitting |
| `bun run lint` | Run ESLint |
| `bun run lint:fix` | Auto-fix lint issues |
| `bun test` | Run unit tests |

## Docker

```bash
# Development (hot reload)
docker compose --profile dev up --build

# Production
docker compose --profile prod up --build
```

## License

MIT
