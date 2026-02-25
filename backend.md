# Backend Documentation

The backend is a **server-authoritative** game server written in TypeScript (ESM). It handles matchmaking, physics, combat, and state broadcasting over WebSockets.

## Module Overview

```
backend/
├── index.ts          # Entry point
├── types.ts          # Type definitions
├── config.ts         # Game constants
├── server.ts         # HTTP + WebSocket server setup
├── state.ts          # Mutable shared state
├── utils.ts          # Broadcast & utility functions
├── game.ts           # Game loop, physics, combat
├── matchmaking.ts    # Queue, game creation, ready checks
└── socket.ts         # WebSocket message routing
```

---

## index.ts — Entry Point

The entry point imports Express, configures static file serving for the `frontend/` directory, and starts the server.

**Responsibilities:**
- Serve `frontend/` as static files via Express
- SPA fallback: any non-file route returns `index.html`
- Call `setupSocket()` to register WebSocket handlers
- Call `startGameLoop()` to begin the 40 Hz tick
- Listen on port `3000` (configurable via `PORT` env var)

---

## types.ts — Type Definitions

Defines the core data structures used throughout the backend.

### Player
```typescript
type Player = {
  id: string;              // UUID
  username: string;
  ws: WebSocket;           // Active connection
  team: number;            // Always 0 (FFA)
  x, y: number;            // Position
  hp: number;              // Health (max 4)
  shots: number;           // Ammo remaining (max 30)
  reloading: boolean;
  lastShotTime: number;    // Timestamp for cooldown
  keys: { w, a, s, d };    // Currently pressed movement keys
  lastProcessedInput: number; // Sequence number for reconciliation
  kills, deaths: number;
  ready: boolean;          // Ready-check flag
  aimAngle: number;        // Radians
  weapon: "fast" | "heavy" | "knife";
};
```

### Bullet
```typescript
type Bullet = {
  id: string;
  x, y: number;           // Current position
  dx, dy: number;          // Velocity vector (per tick)
  team: number;
  playerId: string;        // Shooter's ID
  damage: number;          // 1 (rifle) or 2 (sniper)
  weapon: "fast" | "heavy" | "knife";
  createdAt: number;       // Timestamp (for lifetime expiry)
};
```

### Obstacle
```typescript
type Obstacle = {
  id: string;
  x, y: number;           // Top-left corner
  size: number;            // Width & height (square)
  destroyed: boolean;
  type?: string;           // "tree" or "wall"
};
```

### Game
Represents an active match session. Contains the player list, bullet pool, obstacle array, and state for delta detection.

### TrackedPlayer
Lightweight entry in the global `allPlayers` map for online status tracking (independent of whether the player is in a game).

---

## config.ts — Game Constants

Two exported config objects:

### GAME_CONFIG
| Constant              | Value | Description                        |
| --------------------- | ----- | ---------------------------------- |
| `TICK_RATE`           | 40    | Server updates per second          |
| `MAX_PLAYERS`         | 10    | Max players per match              |
| `MIN_PLAYERS`         | 2     | Min to start countdown             |
| `QUEUE_COUNTDOWN`     | 10    | Seconds before auto-start          |
| `READY_COUNTDOWN`     | 3     | Countdown after all ready          |
| `PLAYER_HP`           | 4     | Starting health                    |
| `PLAYER_SPEED`        | 6     | Pixels per tick                    |
| `PLAYER_RADIUS`       | 15    | Collision radius                   |
| `SHOTS_PER_MAGAZINE`  | 30    | Ammo capacity                      |
| `RELOAD_TIME`         | 2000  | Reload duration (ms)               |
| `BULLET_SPEED`        | 12    | Base bullet speed (px/tick)        |
| `BULLET_LIFETIME`     | 2000  | Max bullet age (ms)                |
| `ARENA_WIDTH`         | 1400  | Arena width in pixels              |
| `ARENA_HEIGHT`        | 900   | Arena height in pixels             |
| `FAST_RIFLE_COOLDOWN` | 50    | Rifle fire rate (ms)               |
| `FAST_RIFLE_DAMAGE`   | 1     | Rifle damage per hit               |
| `FAST_RIFLE_RECOIL`   | 0.15  | Rifle recoil angle (radians)       |
| `HEAVY_RIFLE_COOLDOWN`| 800   | Sniper fire rate (ms)              |
| `HEAVY_RIFLE_DAMAGE`  | 2     | Sniper damage per hit              |
| `KNIFE_COOLDOWN`      | 300   | Knife attack cooldown (ms)         |
| `KNIFE_DAMAGE`        | 1     | Knife damage                       |
| `KNIFE_RANGE`         | 40    | Knife hit range (px)               |
| `KNIFE_SPEED_BONUS`   | 1.5   | Knife movement speed multiplier    |
| `KILLS_TO_WIN`        | 5     | First to N kills wins              |
| `RESPAWN_TIME`        | 1500  | Death-to-respawn delay (ms)        |
| `OBSTACLE_SPAWN_INTERVAL` | 8000 | New obstacle every N ms        |

### OBSTACLE_CONFIG
Controls procedural map generation — wall segment lengths, block sizes, tree counts, and spacing.

---

## server.ts — Server Setup

Creates and exports three singletons:
- `app` — Express application (typed as `Express` to avoid TS2742)
- `server` — Node.js HTTP server wrapping the Express app
- `wss` — WebSocketServer attached to the HTTP server at path `/socket`

---

## state.ts — Mutable State

Exports shared mutable state with setter functions:

| Export             | Type                            | Description                    |
| ------------------ | ------------------------------- | ------------------------------ |
| `queue`            | `Player[]`                      | Players waiting for a match    |
| `games`            | `Map<string, Game>`             | Active game sessions           |
| `allPlayers`       | `Map<string, TrackedPlayer>`    | All connected players          |
| `countdownTimer`   | `NodeJS.Timeout \| null`        | Queue countdown timeout        |
| `countdownInterval`| `NodeJS.Timeout \| null`        | Queue countdown interval       |
| `currentCountdown` | `number`                        | Seconds remaining in countdown |

Setter functions (`setQueue`, `setCountdownTimer`, etc.) are used because ESM exports are read-only bindings.

---

## utils.ts — Broadcast & Utilities

### Broadcasting
- `broadcast(game, data)` — Send JSON to all players in a game
- `broadcastOnlineList()` — Send online player list to all connected clients
- `broadcastQueueToAll()` — Send queue info to all connected clients
- `debouncedBroadcastOnlineList()` — Debounced version (250ms) to avoid spam on rapid connect/disconnect
- `debouncedBroadcastQueueToAll()` — Debounced queue broadcast

### Serialization
- `serializePlayers(game)` — Full player data (used for `start` message)
- `serializePlayersCompact(game)` — Array-of-arrays format for bandwidth optimization in `state` messages:
  ```
  [id, x, y, hp, shots, reloading, lastProcessedInput, aimAngle, weaponCode, kills]
  ```

### Lookups
- `findGameByPlayer(playerId)` — Find which game a player belongs to
- `isPositionClear(x, y, obstacles, radius)` — Check if a position is free of obstacles

---

## game.ts — Game Loop & Combat

### updateGame(game)
Called 40 times per second for each active game:

1. **Movement** — Process each player's `keys` state, apply speed (with knife bonus), clamp to arena bounds
2. **Collision** — Axis-by-axis resolution against obstacles (X first, then Y). Uses closest-point-on-rectangle distance check
3. **Bullets** — Move all bullets by their velocity vector, check for:
   - Wall bounds → remove
   - Obstacle hit → destroy obstacle, broadcast `obstacleDestroyed`
   - Player hit → apply damage, on kill: increment kills/deaths, broadcast `kill`, schedule respawn
4. **Lifetime** — Remove bullets older than `BULLET_LIFETIME`
5. **Delta detection** — Hash the state; skip broadcast if nothing changed
6. **Broadcast** — Send compact `state` message with player array and bullet array

### shoot(player, game, dirX, dirY)
Handles weapon firing:
- **Knife**: check all enemies within `KNIFE_RANGE` and within 60° arc of aim direction
- **Guns**: consume ammo, apply recoil to rifle, create `Bullet` entity with appropriate speed/damage

### checkVictory(game)
Check if any player has ≥ `KILLS_TO_WIN` kills. If so:
- Clear obstacle spawn interval
- Build scoreboard
- Broadcast `end` message
- Reset player statuses to "online"
- Delete game after 2s delay

### respawnPlayer(player, game)
Find the best spawn point (farthest from all alive enemies) over 50 random attempts, with fallback to arena center. Pushes player out of overlapping obstacles and clamps to bounds.

### spawnRandomObstacle(game)
Spawns a random tree or wall block during gameplay, checking minimum distance from players (80px) and other obstacles (40px).

### startGameLoop()
Starts a `setInterval` at `1000 / TICK_RATE` (25ms) that calls `updateGame` for every active game.

---

## matchmaking.ts — Queue & Game Creation

### tryStartGame()
Called when a player joins the queue:
- If queue has ≥ `MAX_PLAYERS` → start immediately
- If queue has ≥ `MIN_PLAYERS` → start `QUEUE_COUNTDOWN` (10s) with live updates to clients
- If queue drops below `MIN_PLAYERS` → cancel countdown

### startGame()
Creates a new game from queued players:

1. **Map Generation** — Procedurally generates walls (horizontal/vertical segments of blocks) and trees with spacing constraints
2. **Player Spawning** — Spawns each player at the position farthest from all already-spawned players, with obstacle clearance checking
3. **Game Object** — Creates `Game` instance with all state, adds to `games` map
4. **Broadcast** — Sends `start` message with full player data, obstacle list, and arena dimensions

### checkAllReady(game)
When all players have clicked "Ready", starts a 3-second countdown, then broadcasts `allReady` and begins the obstacle spawn interval.

---

## socket.ts — WebSocket Handler

### setupSocket()
Registers a `connection` handler on the WebSocketServer. For each connection:

**On connect:**
- Send current queue list and online player list

**Message handlers:**

| Type            | Action                                                        |
| --------------- | ------------------------------------------------------------- |
| `join`          | Create Player, add to queue, register in allPlayers, tryStart |
| `keydown`       | Set `player.keys[key] = true`, update input sequence          |
| `keyup`         | Set `player.keys[key] = false`, update input sequence         |
| `shoot`         | Call `shoot()` with direction vector                          |
| `aim`           | Update `player.aimAngle`                                      |
| `switchWeapon`  | Cycle: fast → heavy → knife → fast                           |
| `ready`         | Set `player.ready = true`, broadcast update, checkAllReady    |

**On close:**
- Remove from queue
- Remove from allPlayers
- Remove from game (if in one)
- Check victory (in case remaining player wins by default)
- Clean up empty games

---

## Key Design Decisions

1. **Server-authoritative**: All movement, collision, and hit detection happen server-side. The client only sends inputs (key state changes with sequence numbers) and receives results.

2. **Compact state format**: The `state` message uses arrays instead of objects to reduce JSON payload size. A full update for 10 players with bullets is ~1–2 KB instead of ~5 KB.

3. **Delta detection**: The game loop skips broadcasting if the state hash hasn't changed (no movement, no bullets), saving bandwidth during idle moments.

4. **Axis-by-axis collision**: Movement resolves X and Y independently against obstacles, preventing corner-clipping bugs common with simultaneous resolution.

5. **ESM with `.js` extensions**: TypeScript uses `NodeNext` module resolution, requiring `.js` extensions in imports even for `.ts` source files.

6. **Debounced global broadcasts**: Online list and queue updates are debounced at 250ms to prevent message storms during rapid connect/disconnect events.
