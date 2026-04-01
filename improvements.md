# Deathmatch Arena — Improvements Roadmap

A prioritized roadmap for gameplay, physics, and visual effects improvements.
Items are grouped by category and ranked **P0** (critical/high-impact), **P1** (important), **P2** (polish).

---

## 1 · Movement, Physics & Mechanics

### P0 — Core Feel

| # | Improvement | Why | Details |
|---|-------------|-----|---------|
| 1.1 | **Movement acceleration / deceleration** | Movement is currently binary (0 → full speed instantly). This feels stiff and removes a skill layer. | Add `acceleration` and `friction` constants to `GameConfig`. Each tick, lerp velocity toward target speed. Must be mirrored in both `backend-go/game.go → updateGame()` and `frontend/game.js → applyInput()`. Suggested values: accel ~1.8, friction ~0.82, max speed stays at 10.5. |
| 1.2 | **Diagonal movement normalization** | Pressing W+D gives √2 speed (~14.85 px/tick vs 10.5). Players move ~41% faster diagonally. | Normalize the input vector before applying speed. The grenade throw code already does this (`0.7071` factor) but player movement does not. Both client and server must apply the same normalization. |
| 1.3 | **Time-based interpolation for remote players** | Other players' positions are lerped at a fixed ratio per frame (`lerpFactor`), meaning their smoothness is frame-rate dependent. At 144 FPS they move slower than at 60 FPS. | Replace the per-frame lerp with delta-time interpolation: `t = 1 - Math.pow(1 - baseLerp, dt * targetFPS)`. This ensures consistent visual movement across refresh rates. |
| 1.4 | **Fix damage direction indicators** | Damage arrows currently render at arena center (`GAME_CONFIG.ARENA_W/2`) instead of the local player's screen position. They point the wrong direction on most of the map. | Change the damage indicator origin from arena center to the local player's position (`myPlayer.x, myPlayer.y`), then project to screen space before drawing. |

### P1 — Competitive Edge

| # | Improvement | Why | Details |
|---|-------------|-----|---------|
| 1.5 | **Spray pattern / recoil reset** | Machinegun recoil is pure random per-shot. No learnable pattern means no spray-control skill ceiling (unlike CS2). | Implement a deterministic recoil pattern table (8–12 offsets) that cycles during sustained fire. Reset index after ~300ms of no shots. Pattern must live server-side; client can predict for visual feedback. |
| 1.6 | **Counter-strafing accuracy bonus** | In CS2, tapping the opposite movement key instantly zeroes your velocity for a frame of perfect accuracy. Currently there's no reward for this. | When a player releases a direction key while the opposite is pressed (e.g., release D while A is down), grant 1–2 ticks of "standing" accuracy even though they're technically still moving. Requires a small state flag per-axis on both client and server. |
| 1.7 | **Velocity-scaled spread (not binary)** | Accuracy is currently a step function — you're either "moving" or "standing". Real games use a gradient. | With accel/decel from 1.1, use `currentSpeed / maxSpeed` as a multiplier on `moveSpread` instead of the boolean `isPlayerMoving()`. |
| 1.8 | **Jump / dodge roll** | Arena combat benefits from a burst-mobility option to dodge grenades or cross open ground. | Add a short dash/roll (spacebar) with ~3s cooldown. ~150ms duration, double speed, reduced hitbox, no shooting. Requires: new field on `Player`, cooldown tracking, both client and server movement code, and a roll animation on the frontend. |
| 1.9 | **Extrapolation for remote players** | When a state packet is late, remote players freeze in place, then snap. This is especially visible at 40 Hz tick rate. | After receiving the last known velocity, extrapolate position forward for up to 2 ticks (~50ms). Clamp extrapolation to prevent phasing through walls. Snap back smoothly when the real position arrives. |
| 1.10 | **Camera aim-lookahead** | Camera is locked dead-center on the player. In a shooter, players need to see *ahead* of where they're aiming. | Offset the camera 15–20% toward the cursor direction. Lerp the offset so it doesn't jitter. This gives more viewport in the direction of engagement. |

### P2 — Polish

| # | Improvement | Why | Details |
|---|-------------|-----|---------|
| 1.11 | **Crouch / slow-walk** | Adds a stealth/accuracy trade-off (Shift to walk at 40% speed with ~50% less spread and quieter footsteps). | New key binding, speed multiplier, footstep volume reduction, and a smaller sprite/hitbox option. |
| 1.12 | **Wall-sliding** | When running into a wall at an angle, the player stops dead. They should slide along the wall surface. | After resolving collision on one axis, preserve the perpendicular component of velocity. The current axis-by-axis resolution partially supports this, but the binary key input negates it. With velocity-based movement (1.1), this comes naturally. |
| 1.13 | **Grenade cooking indicator for enemies** | Players can see the "throwing" emoji but have no idea how long the grenade was cooked. | Show a subtle growing ring or glow on enemy grenades that scales with the charge ratio. Helps with counterplay ("it's cooked, run"). |
| 1.14 | **Bullet penetration (wallbang)** | Certain thin walls could allow reduced-damage bullet pass-through, adding map skill. | Tag thin obstacles (single-block walls). Bullets that hit them lose 60% damage and continue with a slight spread increase. Requires marking obstacle thickness in `maps.go` and adjusting bullet collision in `game.go`. |
| 1.15 | **Tagging (slow on hit)** | Getting shot should briefly slow you down, punishing players who run through open fire. | On bullet hit, set a `taggedUntil` timestamp on the victim. While tagged, `PlayerSpeed` is reduced by 30% for ~400ms. Must sync client and server. |

---

## 2 · Screen Effects — Damage & Death

### P0 — Immediate Impact

| # | Improvement | Why | Details |
|---|-------------|-----|---------|
| 2.1 | **Death screen desaturation + darkening** | When you die, the game world is still fully rendered in color under the DOM overlay. It doesn't *feel* like death. | On death: render the game to the canvas with a grayscale filter (`ctx.filter = 'saturate(0.15) brightness(0.5)'`) and slowly zoom the camera out by 10% over 1.5s. Clear the filter on respawn. |
| 2.2 | **Damage vignette (directional)** | The current red damage flash is a flat tint on the player sprite. There's no screen-space feedback indicating *where* damage came from. | On taking damage, render a red radial gradient on the screen edges, heavier on the side the damage came from. Use the attacker's angle relative to the player. Decay over ~600ms. Layer it under the existing low-HP vignette. |
| 2.3 | **Screen shake scaling with damage** | Screen shake is a fixed amount. A shotgun blast to the face should shake harder than a single machinegun tick. | Scale `screenShakeIntensity` by `damage / maxHP * baseShake`. Shotgun (5 pellets hitting) stacks up, sniper is one big jolt, grenade has its own shake profile (long, rumbling). Cap at ~25px. |
| 2.4 | **Chromatic aberration on heavy hits** | Large single hits (sniper, headshot, grenade) lack a visceral "punch". | On hits > 40 damage, briefly split the RGB channels by 2–4px (red left, blue right) for ~150ms. Achievable by rendering the scene three times with offset and `globalCompositeOperation: 'lighter'`, or via a CSS filter on the canvas element for simplicity. |

### P1 — Grenades & Flashbang

| # | Improvement | Why | Details |
|---|-------------|-----|---------|
| 2.5 | **Flashbang: progressive recovery with visual noise** | The current flashbang is a simple white overlay that decays at a constant rate. It feels cheap and flat. | Phase 1 (0–500ms): full white. Phase 2 (500ms–2s): white slowly fades, add animated TV-static noise texture over the screen at 30% opacity. Phase 3 (2s–3.5s): noise fades, colors desaturated, hearing muffled (reduce audio gain to 20%). Phase 4: full recovery. Closer = longer phases. |
| 2.6 | **Flashbang: looking-away reduction** | There's currently no way to mitigate a flashbang by turning away from it. | When the flash detonates, compute the angle between the player's aim direction and the vector toward the flash. If they're facing away (>110°), reduce intensity by 60%. If perpendicular, reduce by 30%. Server already sends `intensity` per player — factor in angle before sending. |
| 2.7 | **HE Grenade: screen shake + camera jolt** | Grenade explosions currently have a red pulse vignette but no physical camera disruption proportional to distance. | On `grenadeExplosion` event: apply a large directional screen shake (pushes camera away from the blast). Intensity = `(1 - dist/radius) * 30`. Add a brief 100ms zoom-punch (camera zooms in 3% then snaps back). |
| 2.8 | **HE Grenade: screen-edge fire lick** | Damage from grenades should feel different from bullets. | When hit by a grenade, render animated orange/red flame particles crawling in from screen edges for ~800ms. Use 6–8 flame sprites that float inward and fade. This replaces the current flat red pulse. |
| 2.9 | **Flashbang: ear-ringing audio effect** | Being flashed should also affect audio, making it disorienting. | On flash hit, reduce the global `AudioContext` gain to ~0.1 over 200ms, add a high-pitch sine-wave "tinnitus" oscillator (2800 Hz, gain 0.15), and slowly restore both over the flash duration. Use existing Web Audio API infrastructure. |

### P2 — Juice & Polish

| # | Improvement | Why | Details |
|---|-------------|-----|---------|
| 2.10 | **Kill-confirmed screen flash** | When you kill someone, there's no visceral screen-level feedback — just a kill feed entry and sound. | Brief golden/green full-screen flash at 10% opacity for 150ms + slight camera zoom-out pulse (2%). Headshot kills get a more intense version with white flash. |
| 2.11 | **Low HP heartbeat vignette pulse** | The current low-HP vignette is a static pulsing red. It could be tied to the existing heartbeat audio. | Sync the vignette pulse intensity to the heartbeat oscillator. When the heartbeat "beats", the vignette should pulse brighter. Between beats, it dims. Creates a unified audio-visual danger signal. |
| 2.12 | **Sniper scope overlay** | When using the sniper, there's just a camera zoom but no scope visual. It feels incomplete. | Overlay a circular scope reticle in the center of the screen with a dark vignette outside. Add subtle lens distortion (slight barrel effect via a radial gradient). Show scope glint on enemy snipers (visible to others). |
| 2.13 | **Respawn invulnerability shimmer** | After respawning, the brief invulnerability period (if any) has no visual indicator. | Add a 1.5s shimmer/transparency pulse on the player sprite post-respawn. Alternate between 40% and 90% opacity at 8 Hz. Other players see this too (encode in binary state as a flag). |
| 2.14 | **Hit-stop (micro-freeze) on headshots** | Headshots should feel punchy. A 30–50ms pause in the victim's animation sells the impact. | On receiving a headshot event, freeze the victim's interpolation for 2 frames, then resume. The camera also pauses. This is purely visual — server simulation is unaffected. |
| 2.15 | **Damage number improvements** | Damage numbers float up but have no variance or emphasis for crits. | Headshot numbers: 2× size, gold with black outline, slight horizontal scatter. Multi-pellet shotgun: show combined damage in one number instead of 5 separate ones. Grenade damage: orange color with 💥 prefix. |
| 2.16 | **Death cam (brief killer-follow)** | After dying, the camera stays on your corpse. Showing who killed you adds drama and learning. | On death, smoothly pan the camera to the killer's position over 1.5s, hold for 1s, then show the respawn overlay. Skip if killed by self-grenade. |
| 2.17 | **Bullet tracers** | Bullets are rendered as sprites with no trail. Fast bullets (sniper) are nearly invisible. | Draw a fading line from the bullet's previous position to current position each frame. Sniper tracers: bright white-yellow, 40px trail. Machinegun: subtle yellow, 15px trail. Shotgun: short orange sparks. |
| 2.18 | **Environmental hit feedback** | Bullets hitting walls produce small spark impacts but no debris or dust. | On `bulletHitWall` event: spawn 3–5 small stone-colored particles that fall with gravity + a small dust puff (expanding circle that fades). Vary color based on obstacle type if type data is available. |

---

## 3 · Implementation Priority & Dependencies

```
Phase 1 — "Feels Right" (1–2 weeks)
├── 1.2  Diagonal normalization         (trivial, both sides)
├── 1.4  Fix damage indicators          (bug fix, frontend only)
├── 2.1  Death screen desaturation      (frontend only)
├── 2.2  Directional damage vignette    (frontend only)
├── 2.3  Scaled screen shake            (frontend only)
└── 2.17 Bullet tracers                 (frontend only)

Phase 2 — "Skill Ceiling" (2–3 weeks)
├── 1.1  Acceleration/deceleration      (both sides, gated)
│   └── 1.7  Velocity-scaled spread     (depends on 1.1)
│   └── 1.12 Wall-sliding               (depends on 1.1)
├── 1.3  Time-based interpolation       (frontend only)
├── 1.5  Spray patterns                 (both sides)
├── 1.6  Counter-strafing bonus         (both sides)
└── 1.10 Camera aim-lookahead           (frontend only)

Phase 3 — "Grenade Overhaul" (1–2 weeks)
├── 2.5  Flashbang progressive recovery (frontend + minor server)
├── 2.6  Flashbang look-away reduction  (server-side angle calc)
├── 2.7  HE screen shake + jolt         (frontend only)
├── 2.8  HE fire lick effect            (frontend only)
├── 2.9  Flashbang tinnitus audio       (frontend only)
└── 1.13 Grenade cook indicator         (both sides)

Phase 4 — "Polish & Juice" (2–3 weeks)
├── 2.4  Chromatic aberration           (frontend only)
├── 2.10 Kill-confirmed flash           (frontend only)
├── 2.11 Synced heartbeat vignette      (frontend only)
├── 2.12 Sniper scope overlay           (frontend only)
├── 2.14 Hit-stop on headshots          (frontend only)
├── 2.15 Damage number improvements     (frontend only)
├── 2.16 Death cam                      (frontend only)
└── 2.18 Environmental hit feedback     (frontend only)

Phase 5 — "New Mechanics" (3–4 weeks)
├── 1.8  Dodge roll                     (both sides, new ability)
├── 1.9  Extrapolation                  (frontend only, complex)
├── 1.11 Crouch / slow-walk             (both sides, new key)
├── 1.14 Bullet penetration             (both sides, map data)
├── 1.15 Tagging (slow on hit)          (both sides)
└── 2.13 Respawn shimmer                (both sides, protocol)
```

---

## 4 · Known Bugs to Fix Alongside

| Bug | File | Notes |
|-----|------|-------|
| Damage indicators use arena center as origin instead of player position | `frontend/game.js` | Arrows point wrong on most of the map. Fix in Phase 1 (item 1.4). |
| Screen shake decay is frame-rate-dependent (`*= 0.92` per frame) | `frontend/game.js` | Use `Math.pow(0.92, dt * targetFPS)` to normalize. Fix alongside 2.3. |
| Camera lerp is frame-rate-dependent | `frontend/game.js` | Same delta-time fix as 1.3. |
| Grenade debris uses `splice()` instead of in-place compaction | `frontend/game.js` | Minor perf issue. Switch to swap-and-pop during Phase 3 work. |
| No particle object pooling | `frontend/game.js` | Allocates fresh objects per effect. Add a simple pool for blood, sparks, casings during Phase 4. |

---

## 5 · Sync Checklist

Any item touching movement or combat physics **must** be updated in both:

- **Server**: `backend-go/game.go` (movement), `backend-go/combat.go` (shooting/grenades)
- **Client**: `frontend/game.js` → `applyInput()` (prediction), `parseBinaryState()` (if new fields)

If a new player field is added to the binary protocol:
1. `backend-go/protocol.go` → `EncodeBinaryState()` (update `playerBytes`)
2. `frontend/game.js` → `parseBinaryState()` (update byte offsets)
3. `backend-go/types.go` → `Player` struct

---

*Last updated: 2025-04-01*
