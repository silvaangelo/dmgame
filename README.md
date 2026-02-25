# ⚔ Deathmatch Arena

A real-time multiplayer top-down deathmatch game built with **Node.js**, **WebSockets**, and **HTML5 Canvas**.

![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?logo=node.js)
![TypeScript](https://img.shields.io/badge/Backend-TypeScript-3178C6?logo=typescript)
![pnpm](https://img.shields.io/badge/pnpm-9.15.4-F69220?logo=pnpm)

## Overview

Players join a queue, get matched into games of 2–10, and fight in a top-down arena. First to **5 kills** wins. The server is fully authoritative — all physics, collision, and combat run on the backend with a 40 Hz tick rate. The client uses prediction and reconciliation for responsive gameplay.

### Features

- **3 weapons** — Rifle (fast, spray with recoil), Sniper (slow, high damage), Knife (melee, +50% move speed)
- **Destructible obstacles** — walls and trees that break on bullet impact
- **Positional audio** — Web Audio API with stereo panning based on distance
- **Client-side prediction** — instant movement with server reconciliation
- **Particle systems** — muzzle flashes, shell casings, blood splatter, dust clouds, impact sparks
- **Kill feed & minimap** — HUD overlay with real-time events and radar
- **Auto-matchmaking** — queue with countdown timer, ready-check before match start
- **Respawn system** — smart spawn placement away from enemies
- **Dynamic obstacles** — new obstacles spawn every 8 seconds during gameplay

## Project Structure

```
├── backend/              # Server (TypeScript, ESM)
│   ├── index.ts          # Entry point — static files & startup
│   ├── types.ts          # Type definitions (Player, Bullet, Game, etc.)
│   ├── config.ts         # Game constants (speeds, cooldowns, arena size)
│   ├── server.ts         # Express app, HTTP server, WebSocket server
│   ├── state.ts          # Mutable game state (queue, games, timers)
│   ├── utils.ts          # Broadcast, serialization, lookups
│   ├── game.ts           # Game loop, physics, combat, respawn
│   ├── matchmaking.ts    # Queue management, game creation, ready checks
│   └── socket.ts         # WebSocket connection handler & message routing
├── frontend/             # Client (vanilla HTML/CSS/JS)
│   ├── index.html        # Slim HTML shell
│   ├── styles.css        # All styling (panels, HUD, kill feed, minimap)
│   ├── game.js           # Game logic (rendering, audio, networking, input)
│   └── assets/           # Audio files (.wav, .ogg, .mp3)
├── docker/
│   ├── dev/Dockerfile    # Dev image (tsx, hot-reload)
│   └── prod/Dockerfile   # Production image (multi-stage, compiled JS)
├── docker-compose.yml    # Dev & prod profiles
├── eslint.config.js      # ESLint flat config (TS + JS)
├── tsconfig.json         # TypeScript config
└── package.json          # Scripts, dependencies
```

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** (enabled via `corepack enable`)

### Install & Run

```bash
# Install dependencies
pnpm install

# Start dev server (tsx, no build step)
pnpm dev

# Open in browser
open http://localhost:3000
```

### Production Build

```bash
# Compile TypeScript
pnpm build

# Run compiled output
pnpm start
```

### Docker

```bash
# Development (hot-reload via volume mounts)
docker compose --profile dev up --build

# Production (multi-stage build)
docker compose --profile prod up --build
```

## Scripts

| Script          | Command                       | Description                          |
| --------------- | ----------------------------- | ------------------------------------ |
| `pnpm dev`      | `tsx backend/index.ts`        | Start dev server (source-level)      |
| `pnpm build`    | `tsc`                         | Compile TypeScript to `dist/`        |
| `pnpm start`    | `node dist/backend/index.js`  | Run production build                 |
| `pnpm typecheck`| `tsc --noEmit`                | Type-check without emitting          |
| `pnpm lint`     | `eslint .`                    | Lint all backend & frontend code     |
| `pnpm lint:fix` | `eslint . --fix`              | Auto-fix lint issues                 |

## Architecture

```
Browser ──── WebSocket ──── Node.js Server
  │                            │
  ├─ Canvas 2D rendering       ├─ Express (static files)
  ├─ Client prediction         ├─ WebSocketServer (ws)
  ├─ Input capture             ├─ 40 Hz game loop
  ├─ Positional audio          ├─ Server-authoritative physics
  └─ Particle effects          └─ Matchmaking + ready checks
```

The server runs a **40 Hz tick loop** that processes movement, bullet physics, collisions, and combat. Game state is broadcast to clients in a **compact array format** to minimize bandwidth. The client renders at the display refresh rate using `requestAnimationFrame`, interpolating remote player positions and applying local prediction for the current player.

## Networking Protocol

All messages are JSON over WebSocket. Key message types:

| Direction | Type             | Purpose                              |
| --------- | ---------------- | ------------------------------------ |
| C → S     | `join`           | Join queue with username             |
| C → S     | `keydown/keyup`  | Movement input with sequence number  |
| C → S     | `shoot`          | Fire weapon with direction vector    |
| C → S     | `aim`            | Update aim angle                     |
| C → S     | `switchWeapon`   | Cycle weapon (rifle → sniper → knife)|
| C → S     | `ready`          | Confirm ready for match              |
| S → C     | `state`          | Compact game state (40 Hz)           |
| S → C     | `start`          | Match started with initial state     |
| S → C     | `kill`           | Kill event for kill feed             |
| S → C     | `respawn`        | Player respawned at new position     |
| S → C     | `end`            | Game over with final scoreboard      |

See [backend.md](backend.md) and [frontend.md](frontend.md) for detailed module documentation.

## Tech Stack

- **Runtime**: Node.js 20+
- **Backend**: TypeScript, Express 5, ws (WebSocket)
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (Canvas 2D, Web Audio API)
- **Build**: TypeScript compiler (`tsc`), tsx (dev)
- **Package Manager**: pnpm 9
- **Linting**: ESLint 10 with typescript-eslint
- **Containerization**: Docker with multi-stage production builds

## License

Private project.
