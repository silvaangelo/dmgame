# AI Agent Instructions

Project-specific instructions for AI coding assistants working on Deathmatch Arena.

## Project Overview

This is a real-time multiplayer top-down shooter. The backend is server-authoritative — **all game logic runs on the server**. The frontend is a thin client that sends inputs and renders the state it receives.

## Tech Stack Reference

| Layer     | Technology                                          |
| --------- | --------------------------------------------------- |
| Runtime   | Go 1.23                                             |
| Backend   | Go, gorilla/websocket, vmihailenco/msgpack/v5        |
| Frontend  | Vanilla JS, Canvas 2D, Web Audio API                |
| Build     | `go build` (backend), esbuild (frontend minify)     |
| Container | Docker, docker-compose                              |
| CI/CD     | GitHub Actions → DigitalOcean Droplet               |

## Critical Rules

### 1. Movement and Collision Must Stay Synchronized

The client (`frontend/game.js` → `applyInput()`) and server (`backend-go/game.go` → `updateGame()`) both implement the same movement and collision logic. **Any change to one must be reflected in the other**, or players will experience desync (rubber-banding, position snapping).

The collision uses **axis-by-axis resolution** — X movement is resolved first against all obstacles, then Y movement. This is intentional and prevents corner-clipping bugs.

### 2. ESM Is Frontend-Only

The Go backend uses standard `package main` — no module system quirks. All backend files are in `backend-go/` as a single Go package.

The frontend (`frontend/game.js`) is served directly as a static file with no build step. It uses vanilla browser JavaScript (no modules, no imports). All functions are global.

### 3. Compact Binary State Format

The 35 Hz state broadcast uses a **custom binary protocol** (not MessagePack) for state frames, handled in `backend-go/protocol.go` → `EncodeBinaryState()`.

```
Marker byte: 0x42
Header:      [marker u8][flags u8][seq u32LE][playerCount u16LE]
Per player:  [shortId u16LE][x f32LE][y f32LE][hp u8][shots u8]
             [reloading u8][lastInput u16LE][aimAngle f32LE]
             [weaponCode u8][kills u16LE][skin u8]
             [speedBoosted u8][shielded u8][invisible u8][regen u8]
Per bullet:  [shortId u16LE][x f32LE][y f32LE][weaponCode u8]
Per pickup:  [shortId u16LE][x f32LE][y f32LE][typeCode u8]
Per orb:     [shortId u16LE][x f32LE][y f32LE]
Per crate:   [shortId u16LE][x f32LE][y f32LE]
Zone:        [x f32LE][y f32LE][w f32LE][h f32LE]  (optional, flags bit 0)
```

Weapon codes: `0=machinegun 1=shotgun 2=knife 3=minigun 4=sniper`
Pickup type codes: `0=health 1=ammo 2=speed 3=minigun 4=shield 5=invisibility 6=regen`

If you add a field to the player state, you must update:
- `backend-go/protocol.go` → `EncodeBinaryState()`
- `frontend/game.js` → `parseBinaryState()` (byte offset mapping)

### 4. Control/Msgpack Messages Use `map[string]interface{}`

All non-binary messages (join, gameJoined, chat, events, etc.) are encoded with **MessagePack** using `map[string]interface{}` with **string keys**. The Go library `vmihailenco/msgpack/v5` serializes Go string-keyed maps as msgpack str keys, which the frontend JS `MessagePack` library expects.

Never switch to struct-tagged msgpack encoding for these messages — it may encode integer keys.

### 5. Single Lock Per Tick

`game.mu sync.Mutex` is held for the **entire game tick** in `updateGame()`. Any goroutine that touches game state (e.g., reload timers via `time.AfterFunc`) must acquire `game.mu.Lock()` before reading or writing.

Per-player WebSocket writes use `player.ConnMu sync.Mutex` independently from the game lock.

### 6. Frontend Has No Build Step

`frontend/game.js` is served directly by the Go HTTP server as a static file. The `<script>` tag is at the end of the HTML body. No imports, no bundler.

## File Organization

### Backend Modules (`backend-go/`)

| File          | Responsibility                                        | Key Exports                                   |
| ------------- | ----------------------------------------------------- | --------------------------------------------- |
| `main.go`     | HTTP server, static files, WebSocket upgrade, startup | `main()`                                      |
| `socket.go`   | WebSocket connection handler, message routing         | `handleWebSocket()`, `startHeartbeat()`       |
| `game.go`     | Game loop, physics, combat, spawning, round system    | `updateGame()`, `shoot()`, `startGameLoop()`  |
| `types.go`    | All type definitions                                  | `Player`, `Bullet`, `Game`, `Room`, …         |
| `config.go`   | All game constants                                    | `GameConfig`, `WeaponCycle`, `ObstacleConfig` |
| `protocol.go` | MessagePack + binary state encoding                   | `Serialize()`, `Deserialize()`, `EncodeBinaryState()` |
| `state.go`    | Global mutable state                                  | `getPersistentGame()`, `setPersistentGame()`  |
| `utils.go`    | Broadcast, serialization helpers                      | `broadcast()`, `sendMsg()`, `sendBinary()`    |
| `database.go` | JSON file persistence for stats & match history       | `initDatabase()`, `updateStats()`             |
| `spatial.go`  | Spatial hash grid for O(1) collision queries          | `SpatialGrid`, `Insert()`, `QueryRect()`      |

### Frontend Files (`frontend/`)

| File          | Content                                                |
| ------------- | ------------------------------------------------------ |
| `index.html`  | Slim HTML shell with DOM elements                      |
| `styles.css`  | All CSS (panels, HUD, kill feed, minimap, animations)  |
| `game.js`     | All JS (rendering, networking, audio, input, particles)|
| `assets/`     | Audio files (shot, reload, scream, etc.)               |
| `lib/`        | Vendor libraries (msgpack.min.js)                      |

## Common Tasks

### Adding a New Weapon

1. Add weapon constants to `backend-go/config.go` (`GameConfig`)
2. Add weapon to `WeaponCycle` in `backend-go/config.go` (unless powerup-only)
3. Add weapon code to `weaponCodes` map in `backend-go/protocol.go` → `EncodeBinaryState()`
4. Add weapon handling in `backend-go/game.go` → `shoot()` (cooldown, damage, behavior)
5. Add weapon cycling in `backend-go/socket.go` → `switchWeapon` handler
6. Add weapon code mapping in `frontend/game.js` → `BINARY_WEAPON_MAP` constant
7. Add weapon rendering in `frontend/game.js` → player draw section
8. Add weapon name/icon in `frontend/game.js` → `updateShotUI()` and `addKillFeedEntry()`

### Adding a New Game Event

1. Define the event in the backend where it occurs (e.g., `game.go`)
2. Call `broadcast(game, map[string]interface{}{"type": "myEvent", ...})` to send it
3. Handle in `frontend/game.js` → `ws.onmessage` handler with `if (data.type === "myEvent")`

### Changing Arena Size

1. Update `ArenaWidth` and `ArenaHeight` in `backend-go/config.go` (`GameConfig`)
2. The server sends these in the `gameJoined` message
3. The client updates its local `GAME_CONFIG` from the message and resizes canvas
4. No hardcoded arena sizes exist in the frontend

### Adding a New Particle Effect

1. Add arrays for the new effect at the top of `frontend/game.js`
2. Create `createMyEffect(x, y)`, `updateMyEffects()`, `renderMyEffects()` functions
3. Call `updateMyEffects()` in the render loop
4. Call `renderMyEffects()` at the appropriate z-layer in `render()`
5. Reset the array in the game-end cleanup block

## Development Workflow

```bash
# Run locally (no Docker)
export PATH=$PATH:/usr/local/go/bin
cd backend-go && go run .

# Or build a binary
cd backend-go && go build -o ../dmgame-server . && cd .. && ./dmgame-server

# Docker dev (mounts source, restart container to recompile)
docker compose --profile dev up --build

# Docker prod (full minified build)
docker compose --profile prod up --build

# Type-check / vet
cd backend-go && go vet ./...

# Go tests (if any)
cd backend-go && go test ./...
```

Open [http://localhost:3000](http://localhost:3000) in 2+ browser tabs to test multiplayer.

## Pitfalls to Avoid

- **Don't use `encoding/json` for WebSocket messages** — use `Serialize()`/`Deserialize()` from `protocol.go` (MessagePack)
- **Don't send full player objects in state updates** — use `EncodeBinaryState()` (compact binary)
- **Don't modify `GameConfig` at runtime** — it's a read-only global value literal
- **Don't touch game state outside `game.mu.Lock()`** — data races will corrupt state silently
- **Don't create frontend modules/imports** — `game.js` runs as a single global script
- **Don't add a build step to the frontend** — the Go binary serves `frontend/` directly
- **Don't use arrow keys for key names** — they're mapped to WASD internally in the frontend
- **Don't use `sync.Map` for per-tick hot paths** — use `game.mu` + plain slice/map instead
