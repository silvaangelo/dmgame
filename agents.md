# AI Agent Instructions

Project-specific instructions for AI coding assistants working on Deathmatch Arena.

## Project Overview

This is a real-time multiplayer top-down shooter. The backend is server-authoritative — **all game logic runs on the server**. The frontend is a thin client that sends inputs and renders the state it receives.

## Critical Rules

### 1. Movement and Collision Must Stay Synchronized

The client (`frontend/game.js` → `applyInput()`) and server (`backend/game.ts` → `updateGame()`) both implement the same movement and collision logic. **Any change to one must be reflected in the other**, or players will experience desync (rubber-banding, position snapping).

The collision uses **axis-by-axis resolution** — X movement is resolved first against all obstacles, then Y movement. This is intentional and prevents corner-clipping bugs.

### 2. ESM Module System

The project uses **ES Modules** (`"type": "module"` in package.json). TypeScript is configured with `"module": "ESNext"` and `"moduleResolution": "bundler"`.

- All backend imports **must use `.js` extensions** (e.g., `import { foo } from "./bar.js"`) even though the source files are `.ts`
- This is required for compatibility with the TypeScript compiler and ESM resolution

### 3. State Mutation Pattern

Backend state in `state.ts` uses `Map` objects for shared state:
```typescript
export const rooms: Map<string, Room> = new Map();
export const games: Map<string, Game> = new Map();
```
Mutations on Map objects (`rooms.set()`, `rooms.delete()`) work directly.

### 4. Server.ts Type Annotation

The `app` export in `server.ts` must have an explicit `Express` type annotation:
```typescript
export const app: Express = express();
```
Without it, TypeScript error TS2742 occurs because the inferred type references internal Express types that aren't portable across modules.

### 5. Frontend Has No Build Step

`frontend/game.js` is served directly as a static file. It uses vanilla browser JavaScript (no modules, no imports). All functions are global. The `<script>` tag is at the end of the HTML body to ensure DOM elements exist when the script runs.

### 6. Compact State Format

The 40 Hz state broadcast uses **arrays instead of objects** to save bandwidth:
```
Player: [id, x, y, hp, shots, reloading, lastInput, aimAngle, weaponCode, kills]
Bullet: [id, x, y, weaponCode]
```
Weapon codes: `0 = machinegun`, `1 = shotgun`, `2 = knife`, `3 = minigun` (powerup)

If you add a field to the player state, you must update:
- `backend/utils.ts` → `serializePlayersCompact()`
- `frontend/game.js` → the `state` message handler (array index mapping)

## File Organization

### Backend Modules (`backend/`)

| File              | Responsibility                                   | Key Exports                        |
| ----------------- | ------------------------------------------------ | ---------------------------------- |
| `index.ts`        | Entry point, static files, startup               | (none — runs on import)            |
| `types.ts`        | Type definitions                                 | Player, Bullet, Obstacle, Game, Room |
| `config.ts`       | Constants                                        | GAME_CONFIG, OBSTACLE_CONFIG       |
| `database.ts`     | JSON file persistence for stats & match history  | initDatabase, updateStats          |
| `server.ts`       | Express + HTTP + WSS setup                       | app, server, wss                   |
| `state.ts`        | Mutable shared state                             | rooms, games, allPlayers           |
| `utils.ts`        | Broadcast, serialization, lookups                | broadcast, serializePlayersCompact |
| `game.ts`         | Game loop, physics, combat, respawn              | updateGame, shoot, startGameLoop   |
| `room.ts`         | Room creation, join/leave, room ready            | createRoom, joinRoom, leaveRoom    |
| `matchmaking.ts`  | Game creation from rooms, pre-game ready         | startGameFromRoom, checkAllReady   |
| `socket.ts`       | WebSocket message routing                        | setupSocket                        |

### Frontend Files (`frontend/`)

| File          | Content                                                |
| ------------- | ------------------------------------------------------ |
| `index.html`  | Slim HTML shell with DOM elements                      |
| `styles.css`  | All CSS (panels, HUD, kill feed, minimap, animations)  |
| `game.js`     | All JS (rendering, networking, audio, input, particles)|
| `assets/`     | Audio files (shot, reload, scream, etc.)               |

## Common Tasks

### Adding a New Weapon

1. Add weapon constants to `backend/config.ts` (`GAME_CONFIG`)
2. Add weapon to `WEAPON_CYCLE` in `backend/config.ts` (unless it's a powerup-only weapon)
3. Add weapon handling in `backend/game.ts` → `shoot()` (cooldown, damage, behavior)
4. Add weapon cycling in `backend/socket.ts` → `switchWeapon` handler
5. Add weapon rendering in `frontend/game.js` → player rendering section (draw the weapon sprite)
6. Add weapon name/icon in `frontend/game.js` → `updateShotUI()` and `addKillFeedEntry()`
7. Update compact serialization if needed (`utils.ts` + `game.js` state handler)

### Adding a New Game Event

1. Define the event in the backend where it occurs (e.g., `game.ts` or `matchmaking.ts`)
2. `broadcast(game, { type: "myEvent", ...data })` to send it
3. Handle in `frontend/game.js` → `ws.onmessage` handler with `if (data.type === "myEvent")`

### Changing Arena Size

1. Update `GAME_CONFIG.ARENA_WIDTH` and `GAME_CONFIG.ARENA_HEIGHT` in `backend/config.ts`
2. The server sends these values to clients in the `start` and `allReady` messages
3. The client updates its local `GAME_CONFIG` and resizes the canvas automatically
4. No hardcoded arena sizes exist in the frontend (all derived from config)

### Adding a New Particle Effect

1. Add arrays for the new effect at the top of `frontend/game.js` (e.g., `let myEffects = []`)
2. Create `createMyEffect(x, y)`, `updateMyEffects()`, `renderMyEffects()` functions
3. Call `updateMyEffects()` in the render loop (near the other update calls)
4. Call `renderMyEffects()` at the appropriate z-layer in `render()`
5. Reset the array in the game-end cleanup block

## Development Workflow

```bash
# Start dev server
bun run dev

# Type-check
bun run typecheck

# Lint
bun run lint

# Fix lint issues
bun run lint:fix

# Build for production
bun run build
```

The dev server uses Bun which runs TypeScript directly without a build step. The frontend files are served as-is from the `frontend/` directory.

## Testing Changes

There are no automated tests. To verify changes:

1. Run `pnpm typecheck` — ensure TypeScript compiles
2. Run `pnpm lint` — ensure no lint errors
3. Start the server with `pnpm dev`
4. Open `http://localhost:3000` in 2+ browser tabs
5. Join queue in both tabs, play through a match
6. Verify: movement feels responsive, bullets hit correctly, kill feed updates, sounds play, scoreboard is accurate

## Pitfalls to Avoid

- **Don't use `require()`** — the project is ESM, use `import`
- **Don't forget `.js` extensions** in backend imports
- **Don't add `type: "module"` to individual files** — it's set globally in package.json
- **Don't use arrow keys for key names** — they're mapped to WASD internally
- **Don't send full player objects in state updates** — use the compact array format
- **Don't modify obstacle positions after creation** — they're static until destroyed
- **Don't use `let` where `const` suffices** — ESLint will flag it
- **Don't create frontend modules/imports** — game.js runs as a single global script

## Tech Stack Reference

| Layer     | Technology                            |
| --------- | ------------------------------------- |
| Runtime   | Bun ≥ 1.2                             |
| Backend   | TypeScript, Express 5, ws             |
| Frontend  | Vanilla JS, Canvas 2D, Web Audio API  |
| Build     | tsc (typecheck), Bun (runtime)        |
| Package   | Bun (built-in package manager)        |
| Lint      | ESLint 10, typescript-eslint          |
| Container | Docker, docker-compose                |
| CI/CD     | GitHub Actions → DigitalOcean Droplet |
