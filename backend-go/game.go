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
)

/* ================= HELPERS ================= */

func getPlayerSpeed(player *Player) float64 {
	return GameConfig.PlayerSpeed
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

	// ── Comeback mechanic: mark the player with the fewest kills as underdog ──
	{
		var lowestKills int = math.MaxInt32
		var alivePlayers int
		for _, p := range game.Players {
			if p.HP > 0 {
				alivePlayers++
				if p.Kills < lowestKills {
					lowestKills = p.Kills
				}
			}
		}
		for _, p := range game.Players {
			if alivePlayers >= 3 && p.HP > 0 && p.Kills == lowestKills {
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

	// ── Auto-respawn dead players after configured respawn time ──
	for _, player := range game.Players {
		if player.WaitingForRespawn && player.DeathTime > 0 {
			if now-player.DeathTime >= GameConfig.RespawnTime {
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

			// CS2-style headshot detection: if bullet hits upper portion of player hitbox
			isHeadshot := false
			{
				// Calculate where in the hitbox the bullet struck
				// Bullet travel direction determines "up" — headshots happen when
				// the bullet hits the leading edge of the player sprite.
				// Simplified: use Y offset from player center. Negative Y = top = head.
				dy := bullet.Y - enemy.Y
				headThreshold := -GameConfig.PlayerRadius * GameConfig.HeadshotZone
				if dy < headThreshold {
					isHeadshot = true
				}
			}

			// Comeback mechanic: underdog damage boost (+25%)
			effectiveDamage := bullet.Damage
			for _, p := range game.Players {
				if p.ID == bullet.PlayerID && p.IsUnderdog {
					effectiveDamage = int(float64(effectiveDamage) * 1.25)
					break
				}
			}

			// Apply headshot multiplier
			if isHeadshot {
				effectiveDamage = int(float64(effectiveDamage) * GameConfig.HeadshotMultiplier)
			}

			// Apply damage
			enemy.HP -= effectiveDamage

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

			// Broadcast headshot event for client-side feedback
			if isHeadshot {
				broadcast(game, map[string]interface{}{
					"type":   "headshot",
					"victim": enemy.Username,
					"damage": effectiveDamage,
					"x":      int(math.Round(enemy.X)),
					"y":      int(math.Round(enemy.Y)),
				})
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
				handleKill(shooter, enemy, string(bullet.Weapon), game, isHeadshot)
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

	// ── Per-player viewport-culled binary state broadcast ──
	// Snapshots are encoded here (inside the lock) and sent after the lock is released.
	game.StateSequence++
	seq := game.StateSequence

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

		buf := EncodeBinaryState(&BinaryStateInput{
			Seq:     seq,
			IsDelta: false,
			Players: visPlayers,
			Bullets: visBullets,
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
		Started:     true,
		RoundEnded:  false,
		GameMode:    GameModeDeathmatch,
		MatchStartTime:     now,
		LastObstacleSpawn:  now,
		RoundStartTime:     now,
	}

	games.Store(game.ID, game)
	setPersistentGame(game)

	fmt.Printf("🌍 Persistent game world initialized (%d obstacles, arena %.0fx%.0f)\n",
		len(obstacles), GameConfig.ArenaWidth, GameConfig.ArenaHeight)

	// Start round timer
	startRoundTimer(game)

	// Start game tick loop
	startGameLoop(game)

	return game
}
