package main

import (
	"fmt"
	"math"
	"time"
)

/* ================= SPATIAL GRIDS (reused each tick) ================= */

const cellSize = 200
const cullMargin = 2400.0

// Package-level grids — cleared and rebuilt each tick instead of reallocated,
// eliminating map allocations per second (3 grids × 35 Hz).
var (
	globalObstacleGrid = NewSpatialGrid(cellSize)
	globalPlayerGrid   = NewSpatialGrid(cellSize)
	globalCrateGrid    = NewSpatialGrid(cellSize)
)

/* ================= HELPERS ================= */

func getPlayerSpeed(player *Player) float64 {
	speedBoost := 1.0
	if unixMs() < player.SpeedBoostUntil {
		speedBoost = GameConfig.PickupSpeedMultiplier
	}
	return GameConfig.PlayerSpeed * speedBoost
}

/* ================= GAME LOOP ================= */

// playerStateSnapshot holds a pre-encoded binary state frame for one player.
// It is computed inside the game lock and sent after releasing it.
type playerStateSnapshot struct {
	player *Player
	data   []byte
}

func updateGame(game *Game) []playerStateSnapshot {
	// Skip all game logic when round has ended
	if game.RoundEnded {
		return nil
	}

	now := unixMs()

	// ── Comeback mechanic: mark the player with the lowest score as underdog ──
	{
		var lowestScore int = math.MaxInt32
		var alivePlayers int
		for _, p := range game.Players {
			if p.HP > 0 {
				alivePlayers++
				if p.Score < lowestScore {
					lowestScore = p.Score
				}
			}
		}
		for _, p := range game.Players {
			if alivePlayers >= 3 && p.HP > 0 && p.Score == lowestScore {
				p.IsUnderdog = true
			} else {
				p.IsUnderdog = false
			}
		}
	}

	// ── Check spawn timers ──
	checkSpawnTimers(game, now)

	// ── Build spatial grid for obstacles (disabled — no obstacles) ──
	globalObstacleGrid.Clear()

	// ── Player movement ──
	for _, player := range game.Players {
		if player.HP <= 0 {
			continue
		}

		playerRadius := GameConfig.PlayerRadius
		margin := playerRadius

		// Dash movement overrides normal movement
		isDashing := now < player.DashUntil
		if isDashing {
			dashSpeed := GameConfig.DashSpeed

			// Move X
			player.X += player.DashDirX * dashSpeed
			player.X = clamp(player.X, margin, GameConfig.ArenaWidth-margin)

			// Move Y
			player.Y += player.DashDirY * dashSpeed
			player.Y = clamp(player.Y, margin, GameConfig.ArenaHeight-margin)
			continue // Skip normal movement during dash
		}

		speed := getPlayerSpeed(player)

		// Move X axis first
		if player.Keys.A {
			player.X -= speed
		}
		if player.Keys.D {
			player.X += speed
		}
		player.X = clamp(player.X, margin, GameConfig.ArenaWidth-margin)

		// Move Y axis
		if player.Keys.W {
			player.Y -= speed
		}
		if player.Keys.S {
			player.Y += speed
		}
		player.Y = clamp(player.Y, margin, GameConfig.ArenaHeight-margin)
	}

	// Build player grid after movement
	globalPlayerGrid.Clear()
	playerGrid := globalPlayerGrid
	for _, p := range game.Players {
		if p.HP > 0 {
			playerGrid.Insert(&SpatialEntry{
				ID:   p.ID,
				X:    p.X - GameConfig.PlayerRadius,
				Y:    p.Y - GameConfig.PlayerRadius,
				Size: GameConfig.PlayerRadius * 2,
				Data: p,
			})
		}
	}

	// Build crate grid for bullet-vs-crate collision
	globalCrateGrid.Clear()
	crateGrid := globalCrateGrid
	for _, c := range game.LootCrates {
		crateGrid.Insert(&SpatialEntry{
			ID:   c.ID,
			X:    c.X - GameConfig.LootCrateSize/2,
			Y:    c.Y - GameConfig.LootCrateSize/2,
			Size: GameConfig.LootCrateSize,
			Data: c,
		})
	}

	// ── Auto-respawn dead players after 3 seconds ──
	for _, player := range game.Players {
		if player.WaitingForRespawn && player.DeathTime > 0 {
			if now-player.DeathTime >= 3000 {
				respawnPlayer(player, game)
			}
		}
	}

	// ── Bullet physics ──
	bulletsToRemove := make(map[string]bool)

	for _, bullet := range game.Bullets {
		bullet.X += bullet.DX
		bullet.Y += bullet.DY

		// Out of bounds
		if bullet.X < 0 || bullet.X > GameConfig.ArenaWidth ||
			bullet.Y < 0 || bullet.Y > GameConfig.ArenaHeight {
			bulletsToRemove[bullet.ID] = true
			continue
		}

		// Bullet-obstacle collision disabled (no obstacles)

		// Loot crate collision (spatial grid lookup)
		crateHalf := GameConfig.LootCrateSize / 2
		crateHitMargin := 6.0 // extra margin to make crates easier to hit
		var hitCrate *LootCrate
		nearbyCrates := crateGrid.QueryRadius(bullet.X, bullet.Y, crateHalf+crateHitMargin+5)
		for _, e := range nearbyCrates {
			c := e.Data.(*LootCrate)
			if bullet.X >= c.X-crateHalf-crateHitMargin && bullet.X <= c.X+crateHalf+crateHitMargin &&
				bullet.Y >= c.Y-crateHalf-crateHitMargin && bullet.Y <= c.Y+crateHalf+crateHitMargin {
				hitCrate = c
				break
			}
		}
		if hitCrate != nil {
			bulletsToRemove[bullet.ID] = true
			hitCrate.HP--
			if hitCrate.HP <= 0 {
				destroyLootCrate(hitCrate, game)
			} else {
				broadcast(game, map[string]interface{}{
					"type":    "crateHit",
					"crateId": hitCrate.ID,
					"hp":      hitCrate.HP,
				})
			}
			continue
		}

		// Player hit detection
		hitRadiusSq := math.Pow(GameConfig.PlayerRadius*1.05, 2)
		nearbyPlayers := playerGrid.QueryRadius(bullet.X, bullet.Y, GameConfig.PlayerRadius*1.3)
		var enemy *Player
		for _, e := range nearbyPlayers {
			p := e.Data.(*Player)
			if p.ID == bullet.PlayerID || p.HP <= 0 {
				continue
			}
			// Dash invincibility
			if GameConfig.DashInvincible && now < p.DashUntil {
				continue
			}
			bdx := p.X - bullet.X
			bdy := p.Y - bullet.Y
			if bdx*bdx+bdy*bdy < hitRadiusSq {
				enemy = p
				break
			}
		}

		if enemy != nil {
			bulletsToRemove[bullet.ID] = true

			// Comeback mechanic: underdog damage boost (+1)
			effectiveDamage := bullet.Damage
			for _, p := range game.Players {
				if p.ID == bullet.PlayerID && p.IsUnderdog {
					effectiveDamage++
					break
				}
			}

			// Shield absorption
			shieldActive := now < enemy.ShieldUntil
			if shieldActive {
				enemy.ShieldUntil -= 1500
			} else if enemy.Armor > 0 {
				armorAbsorb := min(enemy.Armor, effectiveDamage)
				enemy.Armor -= armorAbsorb
				remaining := effectiveDamage - armorAbsorb
				if remaining > 0 {
					enemy.HP -= remaining
				}
			} else {
				enemy.HP -= effectiveDamage
			}

			// Track damage for MVP
			for _, p := range game.Players {
				if p.ID == bullet.PlayerID {
					p.TotalDamage += effectiveDamage
					break
				}
			}

			// Knockback
			knockbackForce := 3.0
			bulletLen := math.Sqrt(bullet.DX*bullet.DX + bullet.DY*bullet.DY)
			if bulletLen > 0 {
				kbX := (bullet.DX / bulletLen) * knockbackForce
				kbY := (bullet.DY / bulletLen) * knockbackForce
				enemy.X = clamp(enemy.X+kbX, GameConfig.PlayerRadius, GameConfig.ArenaWidth-GameConfig.PlayerRadius)
				enemy.Y = clamp(enemy.Y+kbY, GameConfig.PlayerRadius, GameConfig.ArenaHeight-GameConfig.PlayerRadius)
			}

			if enemy.HP <= 0 {
				enemy.HP = 0
				var shooter *Player
				for _, p := range game.Players {
					if p.ID == bullet.PlayerID {
						shooter = p
						break
					}
				}
				handleKill(shooter, enemy, string(bullet.Weapon), game)
			}
		}
	}

	// Remove hit/OOB/expired bullets (single pass, in-place compaction)
	{
		n := 0
		for _, b := range game.Bullets {
			bulletLife := GameConfig.BulletLifetime
			if b.Weapon == WeaponShotgun {
				bulletLife = GameConfig.ShotgunBulletLifetime
			}
			if !bulletsToRemove[b.ID] && now-b.CreatedAt < bulletLife {
				game.Bullets[n] = b
				n++
			}
		}
		// Nil out trailing pointers so GC can collect them
		for i := n; i < len(game.Bullets); i++ {
			game.Bullets[i] = nil
		}
		game.Bullets = game.Bullets[:n]
	}

	// Remove expired pickups (in-place compaction)
	{
		n := 0
		for _, pk := range game.Pickups {
			if now-pk.CreatedAt < GameConfig.PickupLifetime {
				game.Pickups[n] = pk
				n++
			}
		}
		for i := n; i < len(game.Pickups); i++ {
			game.Pickups[i] = nil
		}
		game.Pickups = game.Pickups[:n]
	}

	// Pickup collisions (in-place removal)
	for _, player := range game.Players {
		if player.HP <= 0 {
			continue
		}
		pickupCollDist := GameConfig.PlayerRadius + GameConfig.PickupRadius
		pickupCollDistSq := pickupCollDist * pickupCollDist
		n := 0
		for _, pickup := range game.Pickups {
			dx := player.X - pickup.X
			dy := player.Y - pickup.Y
			if dx*dx+dy*dy < pickupCollDistSq {
				applyPickup(player, pickup, game)
			} else {
				game.Pickups[n] = pickup
				n++
			}
		}
		for i := n; i < len(game.Pickups); i++ {
			game.Pickups[i] = nil
		}
		game.Pickups = game.Pickups[:n]
	}

	// Remove expired orbs (in-place compaction)
	{
		n := 0
		for _, o := range game.Orbs {
			if now-o.CreatedAt < GameConfig.OrbLifetime {
				game.Orbs[n] = o
				n++
			}
		}
		for i := n; i < len(game.Orbs); i++ {
			game.Orbs[i] = nil
		}
		game.Orbs = game.Orbs[:n]
	}

	// Orb collisions (in-place removal, no per-orb broadcast — binary state handles it)
	orbCollDist := GameConfig.PlayerRadius + GameConfig.OrbRadius
	orbCollDistSq := orbCollDist * orbCollDist
	for _, player := range game.Players {
		if player.HP <= 0 {
			continue
		}
		n := 0
		for _, orb := range game.Orbs {
			dx := player.X - orb.X
			dy := player.Y - orb.Y
			if dx*dx+dy*dy < orbCollDistSq {
				player.Score += GameConfig.OrbScore
				player.OrbsCollected++
			} else {
				game.Orbs[n] = orb
				n++
			}
		}
		for i := n; i < len(game.Orbs); i++ {
			game.Orbs[i] = nil
		}
		game.Orbs = game.Orbs[:n]
	}

	// Bomb explosions (in-place compaction)
	bombRadiusSq := GameConfig.BombRadius * GameConfig.BombRadius
	{
		n := 0
		for _, bomb := range game.Bombs {
			if now-bomb.CreatedAt >= GameConfig.BombFuseTime {
				// Explode this bomb
				for _, player := range game.Players {
					if player.HP <= 0 {
						continue
					}
					dx := player.X - bomb.X
					dy := player.Y - bomb.Y
					if dx*dx+dy*dy < bombRadiusSq {
						if now < player.ShieldUntil {
							player.ShieldUntil -= 1500
						} else {
							player.HP -= GameConfig.BombDamage
							if player.HP <= 0 {
								player.HP = 0
								handleKill(nil, player, "bomb", game)
							}
						}
					}
				}
				broadcast(game, map[string]interface{}{
					"type":   "bombExploded",
					"id":     bomb.ID,
					"x":      int(math.Round(bomb.X)),
					"y":      int(math.Round(bomb.Y)),
					"radius": GameConfig.BombRadius,
				})
			} else {
				game.Bombs[n] = bomb
				n++
			}
		}
		for i := n; i < len(game.Bombs); i++ {
			game.Bombs[i] = nil
		}
		game.Bombs = game.Bombs[:n]
	}

	// Lightning strikes (in-place compaction)
	lightningRadiusSq := GameConfig.LightningRadius * GameConfig.LightningRadius
	{
		n := 0
		for _, lightning := range game.Lightnings {
			if now-lightning.CreatedAt >= GameConfig.LightningFuseTime {
				// Strike this lightning
				for _, player := range game.Players {
					if player.HP <= 0 {
						continue
					}
					dx := player.X - lightning.X
					dy := player.Y - lightning.Y
					if dx*dx+dy*dy < lightningRadiusSq {
						if now < player.ShieldUntil {
							player.ShieldUntil -= 1500
						} else {
							player.HP -= GameConfig.LightningDamage
							if player.HP <= 0 {
								player.HP = 0
								handleKill(nil, player, "lightning", game)
							}
						}
					}
				}
				broadcast(game, map[string]interface{}{
					"type":          "lightningStruck",
					"id":            lightning.ID,
					"x":             int(math.Round(lightning.X)),
					"y":             int(math.Round(lightning.Y)),
					"radius":        GameConfig.LightningRadius,
					"blindDuration": GameConfig.LightningBlindDuration,
				})
			} else {
				game.Lightnings[n] = lightning
				n++
			}
		}
		for i := n; i < len(game.Lightnings); i++ {
			game.Lightnings[i] = nil
		}
		game.Lightnings = game.Lightnings[:n]
	}

	// Health regen tick
	for _, player := range game.Players {
		if player.HP <= 0 {
			continue
		}
		if now < player.RegenUntil && now-player.LastRegenTick >= GameConfig.RegenTickInterval {
			player.HP = min(GameConfig.PlayerHP, player.HP+1)
			player.LastRegenTick = now
		}
	}

	// ── Per-player viewport-culled binary state broadcast ──
	// Snapshots are encoded here (inside the lock) and sent after the lock is released.
	game.StateSequence++
	seq := game.StateSequence

	var zone *Zone
	if game.ZoneShrinking {
		zone = &game.Zone
	}

	snapshots := make([]playerStateSnapshot, 0, len(game.Players))

	for _, viewer := range game.Players {
		if viewer.Conn == nil {
			continue
		}
		// Check connection is still open
		viewer.ConnMu.Lock()
		connOK := viewer.Conn != nil
		viewer.ConnMu.Unlock()
		if !connOK {
			continue
		}

		vx := viewer.X
		vy := viewer.Y
		half := cullMargin

		// Cull entities to viewer's viewport
		visPlayers := make([]*Player, 0)
		for _, p := range game.Players {
			if p.ID == viewer.ID || (math.Abs(p.X-vx) < half && math.Abs(p.Y-vy) < half) {
				visPlayers = append(visPlayers, p)
			}
		}
		visBullets := make([]*Bullet, 0)
		for _, b := range game.Bullets {
			if math.Abs(b.X-vx) < half && math.Abs(b.Y-vy) < half {
				visBullets = append(visBullets, b)
			}
		}
		visPickups := make([]*Pickup, 0)
		for _, pk := range game.Pickups {
			if math.Abs(pk.X-vx) < half && math.Abs(pk.Y-vy) < half {
				visPickups = append(visPickups, pk)
			}
		}
		visOrbs := make([]*Orb, 0)
		for _, o := range game.Orbs {
			if math.Abs(o.X-vx) < half && math.Abs(o.Y-vy) < half {
				visOrbs = append(visOrbs, o)
			}
		}
		visCrates := make([]*LootCrate, 0)
		for _, c := range game.LootCrates {
			if math.Abs(c.X-vx) < half && math.Abs(c.Y-vy) < half {
				visCrates = append(visCrates, c)
			}
		}

		buf := EncodeBinaryState(&BinaryStateInput{
			Seq:     seq,
			IsDelta: false,
			Players: visPlayers,
			Bullets: visBullets,
			Pickups: visPickups,
			Orbs:    visOrbs,
			Crates:  visCrates,
			Zone:    zone,
		})

		snapshots = append(snapshots, playerStateSnapshot{player: viewer, data: buf})
	}
	return snapshots
}

// resolveCollisions pushes a player out of overlapping obstacles.
// If xAxis is true, resolves X; otherwise resolves Y.
func resolveCollisions(player *Player, grid *SpatialGrid, playerRadius float64, xAxis bool) {
	radiusSq := playerRadius * playerRadius
	queryR := playerRadius + 60
	nearby := grid.QueryRadius(player.X, player.Y, queryR)

	for _, e := range nearby {
		o := e.Data.(*Obstacle)
		closestX := clamp(player.X, o.X, o.X+o.Size)
		closestY := clamp(player.Y, o.Y, o.Y+o.Size)
		distX := player.X - closestX
		distY := player.Y - closestY
		dSq := distX*distX + distY*distY

		if dSq < radiusSq {
			if dSq > 0.0001 {
				dist := math.Sqrt(dSq)
				if xAxis {
					player.X += (distX / dist) * (playerRadius - dist)
				} else {
					player.Y += (distY / dist) * (playerRadius - dist)
				}
			} else {
				if xAxis {
					if o.X+o.Size/2 < player.X {
						player.X = o.X + o.Size + playerRadius
					} else {
						player.X = o.X - playerRadius
					}
				} else {
					if o.Y+o.Size/2 < player.Y {
						player.Y = o.Y + o.Size + playerRadius
					} else {
						player.Y = o.Y - playerRadius
					}
				}
			}
		}
	}
}

/* ================= GAME TICK ================= */

func startGameLoop(game *Game) {
	ticker := time.NewTicker(time.Second / time.Duration(GameConfig.TickRate))
	game.ticker = ticker
	game.stopCh = make(chan struct{})

	go func() {
		for {
			select {
			case <-ticker.C:
				game.mu.Lock()
				var snapshots []playerStateSnapshot
				if game.Started {
					snapshots = updateGame(game)
				}
				game.mu.Unlock()
				// Send binary state frames OUTSIDE the game lock so a slow
				// client can never stall the game loop.
				for _, snap := range snapshots {
					sendBinary(snap.player, snap.data)
				}
			case <-game.stopCh:
				ticker.Stop()
				return
			}
		}
	}()
}

/* ================= PERSISTENT GAME WORLD ================= */

func initPersistentGame() *Game {
	obstacles := generateObstacles()
	now := unixMs()

	game := &Game{
		ID:          "persistent",
		NextShortID: 1,
		Players:     make([]*Player, 0),
		Bullets:     make([]*Bullet, 0),
		Obstacles:   obstacles,
		Pickups:     make([]*Pickup, 0),
		Orbs:        make([]*Orb, 0),
		Bombs:       make([]*Bomb, 0),
		Lightnings:  make([]*Lightning, 0),
		LootCrates:  make([]*LootCrate, 0),
		Started:     true,
		RoundEnded:  false,
		GameMode:    GameModeDeathmatch,
		Zone: Zone{
			X: 0, Y: 0,
			W: GameConfig.ArenaWidth,
			H: GameConfig.ArenaHeight,
		},
		ZoneShrinking:      false,
		MatchStartTime:     now,
		LastObstacleSpawn:  now,
		LastPickupSpawn:    now,
		LastOrbSpawn:       now,
		LastBombSpawn:      now,
		LastLightningSpawn: now,
		LastCrateSpawn:     now,
		RoundStartTime:     now,
	}

	games.Store(game.ID, game)
	setPersistentGame(game)

	// Spawn initial entities
	game.mu.Lock()
	spawnInitialOrbs(game)
	spawnInitialLootCrates(game)
	game.mu.Unlock()

	fmt.Printf("🌍 Persistent game world initialized (%d obstacles, arena %.0fx%.0f)\n",
		len(obstacles), GameConfig.ArenaWidth, GameConfig.ArenaHeight)

	// Start round timer
	startRoundTimer(game)

	// Start game tick loop
	startGameLoop(game)

	return game
}
