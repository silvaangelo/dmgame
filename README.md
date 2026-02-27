# ⚔ Deathmatch Arena

Real-time multiplayer top-down shooter — play directly in your browser.

Server located in Brazil, ping may vary based on your location. Best played on desktop with keyboard and mouse, but mobile support is available with touch controls.

🎮 **Play now:** [https://biru-shooting-game.com](https://biru-shooting-game.com)

## About

Deathmatch Arena is a fast-paced browser game where players fight in a top-down arena. First to 5 kills wins. The server is authoritative — all game logic runs server-side to prevent cheating, its really neat.

### Features

- **3 weapons** — Machine Gun, Shotgun, and Knife (+ Minigun powerup)
- **Pickups** — Health, ammo, speed boosts, and minigun scattered across the arena
- **Bombs** — Randomly spawning explosives that keep you on your toes
- **Destructible obstacles** — Shoot through walls and trees
- **Kill streaks** — Get rewarded for consecutive kills
- **Mobile support** — Touch controls with virtual joystick
- **Real-time** — 50 Hz server tick rate with client-side prediction

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js ≥ 24 |
| Backend | TypeScript, Express 5, ws |
| Frontend | Vanilla JS, Canvas 2D, Web Audio API |
| Build | tsc (prod), tsx (dev) |
| Package | pnpm 10 |
| Container | Docker, docker-compose |
| CI/CD | GitHub Actions → DigitalOcean Droplet |

## Getting Started

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Open in browser
open http://localhost:3000
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (tsx, live reload) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run production build |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Auto-fix lint issues |

## Docker

```bash
# Development (hot reload)
docker compose --profile dev up --build

# Production
docker compose --profile prod up --build
```

## License

MIT
