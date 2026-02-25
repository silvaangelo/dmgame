# Frontend Documentation

The frontend is a **vanilla HTML/CSS/JavaScript** application rendered on an HTML5 Canvas. It connects to the backend via WebSocket and handles rendering, input, audio, and client-side prediction.

## File Structure

```
frontend/
├── index.html    # HTML shell — DOM elements, links CSS and JS
├── styles.css    # All styling (panels, HUD, kill feed, minimap, animations)
├── game.js       # All game logic (rendering, networking, audio, input)
└── assets/       # Audio files
    ├── shot.wav
    ├── reload.ogg
    ├── scream.wav
    ├── matchstart.ogg
    ├── died.mp3
    └── readyalarm.wav
```

---

## index.html — HTML Shell

A slim HTML file that defines all DOM elements and loads the external CSS and JS files.

### Key DOM Elements

| ID                   | Type     | Purpose                                |
| -------------------- | -------- | -------------------------------------- |
| `globalOnlinePanel`  | `div`    | Always-visible online player list      |
| `globalControlsPanel`| `div`    | Always-visible controls reference      |
| `menu`               | `div`    | Join queue screen (username + button)  |
| `game`               | `canvas` | Main game canvas (1400×900)            |
| `playerList`         | `div`    | In-game scoreboard (right side)        |
| `readyScreen`        | `div`    | Ready-check overlay (pre-match)        |
| `victoryScreen`      | `div`    | Victory screen with final scoreboard   |
| `gameUI`             | `div`    | Bottom HUD bar (kills, ammo, health)   |
| `killFeed`           | `div`    | Top-center kill notifications          |
| `minimapContainer`   | `div`    | Bottom-right minimap                   |
| `minimap`            | `canvas` | Minimap canvas (180×116)               |

### Inline Event Handlers
- `onclick="joinQueue()"` — Join queue button
- `onclick="confirmReady()"` — Ready button

---

## styles.css — Styling

### Design Language
- **Dark military/tactical theme** with green-tinted panels
- Fonts: `Rajdhani` (headings, UI), `Share Tech Mono` (data, labels)
- `backdrop-filter: blur()` on overlays for frosted glass effect
- Subtle radial gradients on body background

### Key Style Rules

| Selector              | Description                                   |
| --------------------- | --------------------------------------------- |
| `#menu`               | Centered login panel with gradient button      |
| `#gameUI`             | Fixed bottom bar with HUD stats                |
| `#victoryScreen`      | Centered overlay with glow text shadow         |
| `#globalOnlinePanel`  | Fixed left panel with scrollable player list   |
| `#playerList`         | Fixed right panel (in-game scoreboard)         |
| `#killFeed`           | Fixed top-center, pointer-events: none         |
| `.kill-entry`         | Kill feed row with `killFadeIn` animation      |
| `#minimapContainer`   | Fixed bottom-right with border glow            |

---

## game.js — Game Logic

The main JavaScript file (~2100 lines) handles everything client-side. It's structured into logical sections:

### Configuration & State

```javascript
const GAME_CONFIG = {
  ARENA_WIDTH: 1400,     // Updated by server on match start
  ARENA_HEIGHT: 900,
  PLAYER_RADIUS: 15,
  PLAYER_SPEED: 6,
  KILLS_TO_WIN: 5,       // Updated by server
  // ... particle counts, flash durations, etc.
};
```

Global state variables: `ws`, `playerId`, `players[]`, `bullets[]`, `obstacles[]`, mouse position, particle arrays, prediction state, and interpolation targets.

### Responsive Canvas

The canvas internal resolution is always `ARENA_WIDTH × ARENA_HEIGHT` (set by the server). The CSS size is scaled to fit the viewport (92% width, 85% height) while maintaining aspect ratio. Mouse coordinates are converted from CSS space to canvas space using the scale ratio:

```javascript
mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
```

### Particle Systems

Six independent particle systems, all running on the client only:

| System          | Trigger                | Lifetime  | Visual                       |
| --------------- | ---------------------- | --------- | ---------------------------- |
| Explosions      | Player death           | ~50 frames| Orange/yellow fire burst     |
| Blood           | Player takes damage    | ~40 frames| Red particles with gravity   |
| Blood Stains    | Player takes damage    | Permanent | Dark red circles on ground   |
| Muzzle Flashes  | Gun fire               | 100ms     | Orange/yellow directional    |
| Knife Slashes   | Knife attack           | 250ms     | White arc sweep              |
| Shell Casings   | Gun fire               | ~80 frames| Brass rectangles with spin   |
| Impact Sparks   | Bullet hits wall/obs   | ~25 frames| Orange/grey sparks           |
| Dust Clouds     | Player movement        | ~50 frames| Brown expanding circles      |

Blood stains have a cap of 600 to prevent memory issues. Shell casings cap at 100.

### Client-Side Prediction

The client uses **input prediction with server reconciliation**:

1. On keydown/keyup → increment `inputSequence`, send input to server, store in `pendingInputs[]`
2. Immediately apply `applyInput()` to `predictedX/Y` (matches server movement logic exactly)
3. On `state` message → get `lastProcessedInput` from server, discard acknowledged inputs
4. Replay remaining unacknowledged inputs from the server's position
5. Update `predictedX/Y` to the reconciled result

The `applyInput()` function mirrors the server's axis-by-axis collision logic to prevent desync.

### Interpolation

Other players' positions are interpolated with a lerp factor of `0.45`:
```javascript
target.currentX += (target.targetX - target.currentX) * INTERPOLATION_SPEED;
```
This smooths out the 40 Hz server updates to the display's refresh rate.

### Web Audio System

Uses the **Web Audio API** for spatial sound:

| Sound        | File              | Usage                                   |
| ------------ | ----------------- | --------------------------------------- |
| `shot`       | `shot.wav`        | Gunfire (pitch varies by weapon type)   |
| `reload`     | `reload.ogg`      | Magazine reload                         |
| `scream`     | `scream.wav`      | Player takes damage                     |
| `matchstart` | `matchstart.ogg`  | Match begins                            |
| `died`       | `died.mp3`        | Player death                            |
| `readyalarm` | `readyalarm.wav`  | Looping alarm during ready check        |

**Positional audio** calculates volume and stereo pan based on distance from the local player:
- Volume: `0.3 + 0.7 * (1 - distance / maxDist)`
- Pan: clamped `dx / (ARENA_WIDTH * 0.4)` to [-1, 1]

**Knife sound** is synthesized using an oscillator (sawtooth wave, 200→80 Hz sweep) rather than a sample.

### Networking

#### Connection Flow
1. Player enters username and clicks "Entrar na Fila"
2. WebSocket connects to `ws(s)://host/socket`
3. Sends `{ type: "join", username }` on open
4. Receives queue updates, online list, then eventually `start`

#### Message Handling (ws.onmessage)

| Type              | Action                                                  |
| ----------------- | ------------------------------------------------------- |
| `queueList`       | (no-op, handled by online panel)                        |
| `onlineList`      | Update global online panel with player statuses         |
| `queue`           | Show queue count and countdown timer                    |
| `start`           | Show game UI, init audio, set player positions          |
| `readyUpdate`     | Update "waiting for players" text                       |
| `countdown`       | Show pre-match countdown (3, 2, 1...)                   |
| `allReady`        | Hide ready screen, start gameplay                       |
| `respawn`         | Reset player position and HP                            |
| `newObstacle`     | Add dynamically spawned obstacle                        |
| `obstacleDestroyed`| Mark obstacle destroyed, show sparks                   |
| `kill`            | Add entry to kill feed                                  |
| `state`           | Parse compact arrays, detect deaths/damage, reconcile   |
| `end`             | Show victory screen, 5s countdown, return to menu       |

#### Compact State Parsing
The `state` message uses arrays for efficiency:
```
Player: [id, x, y, hp, shots, reloading, lastInput, aimAngle, weapon, kills]
Bullet: [id, x, y, weapon]
```
Weapon codes: `0 = fast`, `1 = heavy`, `2 = knife`

### Input Handling

| Input           | Action                                          |
| --------------- | ----------------------------------------------- |
| WASD / Arrows   | Movement (with prediction)                      |
| Mouse move      | Aim (throttled at 30 Hz to server)              |
| Left click      | Hold-to-shoot (auto-fire from render loop)      |
| Space           | Single-shot fire                                |
| Q               | Cycle weapon                                    |

A `keysPressed` Set prevents duplicate keydown events. Arrow keys are mapped to WASD internally.

### Kill Feed

Maintains an array of `{ killer, victim, icon, timestamp }` entries (max 5). Entries fade out after 4 seconds. The last 500ms uses opacity interpolation for smooth fade.

### Minimap

Renders a 180×116 pixel overview of the arena:
- Scales all positions by `MINIMAP_W / ARENA_WIDTH`
- Draws grid, obstacles (trees as circles, walls as rects), bullets, and player dots
- Local player has a glow effect and aim direction line
- Each player gets a unique color from `MINIMAP_PLAYER_COLORS`

### Render Loop

The `render()` function runs via `requestAnimationFrame` and draws in this order:

1. **Floor** — Dark green background with grid
2. **Blood stains** — Permanent ground marks
3. **Dust clouds** — Ground-level movement particles
4. **Obstacles** — Trees (trunk + foliage circles) and walls (blocks with cracks)
5. **Players** — Weapon sprite → outer ring → inner circle → highlight → health bar → username
6. **Bullets** — Yellow tracers (rifle) or red glow tracers (sniper) with predicted movement
7. **Shell casings** — Brass ejected from guns
8. **Explosions & blood** — Death and damage particle effects
9. **Muzzle flashes** — Directional orange/yellow flash
10. **Knife slashes** — White arc sweep animation
11. **Impact sparks** — Orange/grey from bullet wall hits
12. **Crosshair** — Tactical cross with center dot
13. **Minimap & kill feed** — HUD overlays (only when `gameReady`)

### Bullet Prediction

When the player fires, a predicted bullet is created locally with `predicted: true` and rendered immediately. It's removed after 100ms — by then the server has sent the real bullet in the next `state` update. This gives instant visual feedback without waiting for a network round-trip.

---

## Key Design Decisions

1. **No build step for frontend**: The frontend is vanilla JS served as static files. No bundler, no framework — keeps deployment simple and eliminates build tooling.

2. **CSS-scaled canvas**: The canvas resolution stays constant (1400×900) while CSS scales it to fit the viewport. This avoids resolution-dependent rendering while remaining responsive.

3. **Prediction mirrors server exactly**: The `applyInput()` function in `game.js` replicates the server's movement and collision logic identically. Any change to server physics must be reflected here.

4. **Positional audio without a library**: Uses raw Web Audio API nodes (BufferSource → Gain → StereoPanner → Destination) for lightweight spatial sound.

5. **All rendering in one file**: Despite its length, keeping all rendering logic in one file avoids module loading complexity for browser-side vanilla JS.
