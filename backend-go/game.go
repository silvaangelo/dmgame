package main

import (
	"fmt"
	"math"
	"math/rand"
	"time"

	"github.com/google/uuid"
)

/* ================= SPATIAL GRIDS (reused each tick) ================= */

const cellSize = 200
const cullMargin = 2400.0

// Package-level grids — cleared and rebuilt each tick instead of reallocated,
// eliminating 70 map allocations per second (2 grids × 35 Hz).
var (
	globalObstacleGrid = NewSpatialGrid(cellSize)
	globalPlayerGrid   = NewSpatialGrid(cellSize)
)

/* ================= KILL STREAKS ================= */

var streakThresholds = []struct {
	Kills   int
	Message string
}{
	{2, "DUPLO ABATE!"},
	{3, "MONSTRO!"},
	{5, "IMPARÁVEL!"},
	{7, "LENDÁRIO!"},
	{10, "DEUS DA ARENA!"},
}

func handleKill(killer *Player, victim *Player, weapon string, game *Game) {
	victim.Deaths++
	victim.KillStreak = 0

	// Drop half of victim's score as orbs
	dropScoreOrbs(victim, game)

	// Mark victim as waiting for manual respawn
	victim.WaitingForRespawn = true

	if killer != nil && killer.ID != victim.ID {
		killer.Kills++
		killer.KillStreak++
		killer.Score += GameConfig.KillScore

		// Heal on kill — restore half of max HP
		maxHP := GameConfig.PlayerHP
		killer.HP = min(maxHP, killer.HP+(maxHP+1)/2)

		// Revenge tracking
		isRevenge := victim.LastKilledBy != "" && killer.LastKilledBy == victim.ID

		broadcast(game, map[string]interface{}{
			"type":         "kill",
			"killer":       killer.Username,
			"victim":       victim.Username,
			"weapon":       weapon,
			"isRevenge":    isRevenge,
			"droppedScore": int(float64(victim.Score) * GameConfig.DeathOrbDropFraction),
		})

		victim.LastKilledBy = killer.ID
		if isRevenge {
			killer.LastKilledBy = ""
		}

		// Check for kill streak announcement
		for _, s := range streakThresholds {
			if killer.KillStreak == s.Kills {
				broadcast(game, map[string]interface{}{
					"type":    "killStreak",
					"player":  killer.Username,
					"streak":  killer.KillStreak,
					"message": s.Message,
				})
				break
			}
		}
	} else {
		killerName := "Unknown"
		if killer != nil {
			killerName = killer.Username
		}
		broadcast(game, map[string]interface{}{
			"type":         "kill",
			"killer":       killerName,
			"victim":       victim.Username,
			"weapon":       weapon,
			"isRevenge":    false,
			"droppedScore": int(float64(victim.Score) * GameConfig.DeathOrbDropFraction),
		})
	}

	// Deduct dropped score
	dropped := int(float64(victim.Score) * GameConfig.DeathOrbDropFraction)
	victim.Score = max(0, victim.Score-dropped)
}

/* ================= HELPERS ================= */

func dropScoreOrbs(victim *Player, game *Game) {
	scoreToDrop := int(float64(victim.Score) * GameConfig.DeathOrbDropFraction)
	if scoreToDrop <= 0 {
		return
	}

	orbCount := min(scoreToDrop, 30)
	spread := 60.0

	for i := 0; i < orbCount; i++ {
		angle := (float64(i) / float64(orbCount)) * math.Pi * 2
		dist := 15 + rand.Float64()*spread
		orbX := clamp(victim.X+math.Cos(angle)*dist, 20, GameConfig.ArenaWidth-20)
		orbY := clamp(victim.Y+math.Sin(angle)*dist, 20, GameConfig.ArenaHeight-20)

		orb := &Orb{
			ID:        uuid.New().String(),
			ShortID:   game.NextShortID,
			X:         orbX,
			Y:         orbY,
			CreatedAt: unixMs(),
		}
		game.NextShortID++
		game.Orbs = append(game.Orbs, orb)
	}
}

func getPlayerSpeed(player *Player) float64 {
	knifeBonus := 1.0
	if player.Weapon == WeaponKnife {
		knifeBonus = GameConfig.KnifeSpeedBonus
	}
	speedBoost := 1.0
	if unixMs() < player.SpeedBoostUntil {
		speedBoost = GameConfig.PickupSpeedMultiplier
	}
	return GameConfig.PlayerSpeed * knifeBonus * speedBoost
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

	// ── Check spawn timers ──
	checkSpawnTimers(game, now)

	// ── Build spatial grid for obstacles ──
	globalObstacleGrid.Clear()
	obstacleGrid := globalObstacleGrid
	for _, obs := range game.Obstacles {
		if !obs.Destroyed {
			obstacleGrid.Insert(&SpatialEntry{
				ID:   obs.ID,
				X:    obs.X,
				Y:    obs.Y,
				Size: obs.Size,
				Data: obs,
			})
		}
	}

	// ── Player movement ──
	for _, player := range game.Players {
		if player.HP <= 0 {
			continue
		}

		// Check minigun expiry
		if player.Weapon == WeaponMinigun && now >= player.MinigunUntil {
			player.Weapon = WeaponMachinegun
			player.Shots = GameConfig.ShotsPerMag
			player.Reloading = false
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
			resolveCollisions(player, obstacleGrid, playerRadius, true)
			player.X = clamp(player.X, margin, GameConfig.ArenaWidth-margin)

			// Move Y
			player.Y += player.DashDirY * dashSpeed
			player.Y = clamp(player.Y, margin, GameConfig.ArenaHeight-margin)
			resolveCollisions(player, obstacleGrid, playerRadius, false)
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
		resolveCollisions(player, obstacleGrid, playerRadius, true)
		player.X = clamp(player.X, margin, GameConfig.ArenaWidth-margin)

		// Move Y axis
		if player.Keys.W {
			player.Y -= speed
		}
		if player.Keys.S {
			player.Y += speed
		}
		player.Y = clamp(player.Y, margin, GameConfig.ArenaHeight-margin)
		resolveCollisions(player, obstacleGrid, playerRadius, false)
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

		// Swept collision with obstacles
		prevBx := bullet.X - bullet.DX
		prevBy := bullet.Y - bullet.DY
		sweepMinX := math.Min(prevBx, bullet.X)
		sweepMinY := math.Min(prevBy, bullet.Y)
		sweepMaxX := math.Max(prevBx, bullet.X)
		sweepMaxY := math.Max(prevBy, bullet.Y)
		sweepR := math.Max(math.Abs(bullet.DX), math.Abs(bullet.DY)) + 40
		nearbyObs := obstacleGrid.QueryRadius(
			(prevBx+bullet.X)*0.5, (prevBy+bullet.Y)*0.5, sweepR,
		)

		var hitObstacle *Obstacle
		for _, e := range nearbyObs {
			o := e.Data.(*Obstacle)
			if sweepMaxX >= o.X && sweepMinX <= o.X+o.Size &&
				sweepMaxY >= o.Y && sweepMinY <= o.Y+o.Size {
				hitObstacle = o
				break
			}
		}

		if hitObstacle != nil {
			hitObstacle.Destroyed = true
			bulletsToRemove[bullet.ID] = true
			destroyedIDs := []string{hitObstacle.ID}

			// Group wall cleanup
			if hitObstacle.GroupID != "" {
				siblings := 0
				var lastSibling *Obstacle
				for _, o := range game.Obstacles {
					if o.GroupID == hitObstacle.GroupID && !o.Destroyed && o.ID != hitObstacle.ID {
						siblings++
						lastSibling = o
					}
				}
				if siblings <= 1 && lastSibling != nil {
					lastSibling.Destroyed = true
					destroyedIDs = append(destroyedIDs, lastSibling.ID)
				}
			}

			broadcast(game, map[string]interface{}{
				"type":         "obstacleDestroyed",
				"obstacleId":   hitObstacle.ID,
				"destroyedIds": destroyedIDs,
			})
			continue
		}

		// Loot crate collision
		crateHalf := GameConfig.LootCrateSize / 2
		var hitCrate *LootCrate
		for _, c := range game.LootCrates {
			if bullet.X >= c.X-crateHalf && bullet.X <= c.X+crateHalf &&
				bullet.Y >= c.Y-crateHalf && bullet.Y <= c.Y+crateHalf {
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
		hitRadiusSq := math.Pow(GameConfig.PlayerRadius*1.2, 2)
		nearbyPlayers := playerGrid.QueryRadius(bullet.X, bullet.Y, GameConfig.PlayerRadius*1.5)
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

			// Shield absorption
			shieldActive := now < enemy.ShieldUntil
			if shieldActive {
				enemy.ShieldUntil -= 1500
			} else if enemy.Armor > 0 {
				armorAbsorb := min(enemy.Armor, bullet.Damage)
				enemy.Armor -= armorAbsorb
				remaining := bullet.Damage - armorAbsorb
				if remaining > 0 {
					enemy.HP -= remaining
				}
			} else {
				enemy.HP -= bullet.Damage
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

	// Remove hit/OOB bullets
	if len(bulletsToRemove) > 0 {
		filtered := make([]*Bullet, 0, len(game.Bullets))
		for _, b := range game.Bullets {
			if !bulletsToRemove[b.ID] {
				filtered = append(filtered, b)
			}
		}
		game.Bullets = filtered
	}

	// Remove expired bullets
	{
		filtered := make([]*Bullet, 0, len(game.Bullets))
		for _, b := range game.Bullets {
			if now-b.CreatedAt < GameConfig.BulletLifetime {
				filtered = append(filtered, b)
			}
		}
		game.Bullets = filtered
	}

	// Remove expired pickups
	{
		filtered := make([]*Pickup, 0, len(game.Pickups))
		for _, pk := range game.Pickups {
			if now-pk.CreatedAt < GameConfig.PickupLifetime {
				filtered = append(filtered, pk)
			}
		}
		game.Pickups = filtered
	}

	// Pickup collisions
	for _, player := range game.Players {
		if player.HP <= 0 {
			continue
		}
		pickupCollDist := GameConfig.PlayerRadius + GameConfig.PickupRadius
		pickupCollDistSq := pickupCollDist * pickupCollDist
		pickupsToRemove := make(map[string]bool)
		for _, pickup := range game.Pickups {
			dx := player.X - pickup.X
			dy := player.Y - pickup.Y
			if dx*dx+dy*dy < pickupCollDistSq {
				pickupsToRemove[pickup.ID] = true
				applyPickup(player, pickup, game)
			}
		}
		if len(pickupsToRemove) > 0 {
			filtered := make([]*Pickup, 0, len(game.Pickups))
			for _, pk := range game.Pickups {
				if !pickupsToRemove[pk.ID] {
					filtered = append(filtered, pk)
				}
			}
			game.Pickups = filtered
		}
	}

	// Remove expired orbs
	{
		filtered := make([]*Orb, 0, len(game.Orbs))
		for _, o := range game.Orbs {
			if now-o.CreatedAt < GameConfig.OrbLifetime {
				filtered = append(filtered, o)
			}
		}
		game.Orbs = filtered
	}

	// Orb collisions
	orbCollDist := GameConfig.PlayerRadius + GameConfig.OrbRadius
	orbCollDistSq := orbCollDist * orbCollDist
	for _, player := range game.Players {
		if player.HP <= 0 {
			continue
		}
		orbsToRemove := make(map[string]bool)
		for _, orb := range game.Orbs {
			dx := player.X - orb.X
			dy := player.Y - orb.Y
			if dx*dx+dy*dy < orbCollDistSq {
				orbsToRemove[orb.ID] = true
				player.Score += GameConfig.OrbScore
				broadcast(game, map[string]interface{}{
					"type":     "orbCollected",
					"orbId":    orb.ID,
					"playerId": player.ID,
				})
			}
		}
		if len(orbsToRemove) > 0 {
			filtered := make([]*Orb, 0, len(game.Orbs))
			for _, o := range game.Orbs {
				if !orbsToRemove[o.ID] {
					filtered = append(filtered, o)
				}
			}
			game.Orbs = filtered
		}
	}

	// Bomb explosions
	bombRadiusSq := GameConfig.BombRadius * GameConfig.BombRadius
	var bombsToExplode []*Bomb
	for _, bomb := range game.Bombs {
		if now-bomb.CreatedAt >= GameConfig.BombFuseTime {
			bombsToExplode = append(bombsToExplode, bomb)
		}
	}
	for _, bomb := range bombsToExplode {
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
	}
	if len(bombsToExplode) > 0 {
		explodeIDs := make(map[string]bool)
		for _, b := range bombsToExplode {
			explodeIDs[b.ID] = true
		}
		filtered := make([]*Bomb, 0, len(game.Bombs))
		for _, b := range game.Bombs {
			if !explodeIDs[b.ID] {
				filtered = append(filtered, b)
			}
		}
		game.Bombs = filtered
	}

	// Lightning strikes
	lightningRadiusSq := GameConfig.LightningRadius * GameConfig.LightningRadius
	var lightningsToStrike []*Lightning
	for _, l := range game.Lightnings {
		if now-l.CreatedAt >= GameConfig.LightningFuseTime {
			lightningsToStrike = append(lightningsToStrike, l)
		}
	}
	for _, lightning := range lightningsToStrike {
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
	}
	if len(lightningsToStrike) > 0 {
		strikeIDs := make(map[string]bool)
		for _, l := range lightningsToStrike {
			strikeIDs[l.ID] = true
		}
		filtered := make([]*Lightning, 0, len(game.Lightnings))
		for _, l := range game.Lightnings {
			if !strikeIDs[l.ID] {
				filtered = append(filtered, l)
			}
		}
		game.Lightnings = filtered
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

/* ================= COMBAT ================= */

func shoot(player *Player, game *Game, dirX, dirY float64) {
	if game.RoundEnded {
		return
	}
	if player.HP <= 0 {
		return
	}
	if player.Reloading {
		return
	}

	now := unixMs()

	// Knife
	if player.Weapon == WeaponKnife {
		cooldown := GameConfig.KnifeCooldown
		if now-player.LastShotTime < cooldown {
			return
		}
		player.LastShotTime = now

		meleeRangeSq := GameConfig.KnifeRange * GameConfig.KnifeRange
		for _, target := range game.Players {
			if target.ID == player.ID || target.HP <= 0 {
				continue
			}
			if GameConfig.DashInvincible && now < target.DashUntil {
				continue
			}
			dx := target.X - player.X
			dy := target.Y - player.Y
			if dx*dx+dy*dy <= meleeRangeSq {
				targetAngle := math.Atan2(dy, dx)
				playerAngle := math.Atan2(dirY, dirX)
				angleDiff := math.Abs(targetAngle - playerAngle)
				if angleDiff > math.Pi {
					angleDiff = 2*math.Pi - angleDiff
				}
				if angleDiff < math.Pi/2 {
					// Apply damage
					if now < target.ShieldUntil {
						target.ShieldUntil -= 1500
					} else if target.Armor > 0 {
						armorAbsorb := min(target.Armor, GameConfig.KnifeDamage)
						target.Armor -= armorAbsorb
						remaining := GameConfig.KnifeDamage - armorAbsorb
						if remaining > 0 {
							target.HP -= remaining
						}
					} else {
						target.HP -= GameConfig.KnifeDamage
					}

					// Knockback
					knifeKnockback := 5.0
					dist := math.Sqrt(dx*dx+dy*dy) + 0.001
					target.X = clamp(target.X+(dx/dist)*knifeKnockback, GameConfig.PlayerRadius, GameConfig.ArenaWidth-GameConfig.PlayerRadius)
					target.Y = clamp(target.Y+(dy/dist)*knifeKnockback, GameConfig.PlayerRadius, GameConfig.ArenaHeight-GameConfig.PlayerRadius)

					if target.HP <= 0 {
						target.HP = 0
						handleKill(player, target, "knife", game)
					}
				}
			}
		}
		return
	}

	// Minigun
	if player.Weapon == WeaponMinigun {
		cooldown := GameConfig.MinigunCooldown
		if now-player.LastShotTime < cooldown {
			return
		}
		player.LastShotTime = now

		recoil := GameConfig.MinigunRecoil
		recoilAngle := (rand.Float64() - 0.5) * 2 * recoil
		cos := math.Cos(recoilAngle)
		sin := math.Sin(recoilAngle)
		finalDirX := dirX*cos - dirY*sin
		finalDirY := dirX*sin + dirY*cos

		bullet := &Bullet{
			ID:        uuid.New().String(),
			ShortID:   game.NextShortID,
			X:         player.X,
			Y:         player.Y,
			DX:        finalDirX * GameConfig.BulletSpeed,
			DY:        finalDirY * GameConfig.BulletSpeed,
			Team:      0,
			PlayerID:  player.ID,
			Damage:    GameConfig.MinigunDamage,
			Weapon:    WeaponMinigun,
			CreatedAt: now,
		}
		game.NextShortID++
		game.Bullets = append(game.Bullets, bullet)
		return
	}

	// Sniper
	if player.Weapon == WeaponSniper {
		cooldown := GameConfig.SniperCooldown
		if now-player.LastShotTime < cooldown {
			return
		}
		if player.Shots <= 0 {
			return
		}
		player.LastShotTime = now
		player.Shots--
		if player.Shots == 0 {
			startReload(player, GameConfig.SniperReloadTime, GameConfig.SniperAmmo)
		}

		bullet := &Bullet{
			ID:        uuid.New().String(),
			ShortID:   game.NextShortID,
			X:         player.X,
			Y:         player.Y,
			DX:        dirX * GameConfig.SniperBulletSpeed,
			DY:        dirY * GameConfig.SniperBulletSpeed,
			Team:      0,
			PlayerID:  player.ID,
			Damage:    GameConfig.SniperDamage,
			Weapon:    WeaponSniper,
			CreatedAt: now,
		}
		game.NextShortID++
		game.Bullets = append(game.Bullets, bullet)
		return
	}

	// Guns (machinegun, shotgun)
	if player.Shots <= 0 {
		return
	}

	var cooldown int64
	switch player.Weapon {
	case WeaponShotgun:
		cooldown = GameConfig.ShotgunCooldown
	default:
		cooldown = GameConfig.MachinegunCooldown
	}
	if now-player.LastShotTime < cooldown {
		return
	}

	player.LastShotTime = now
	player.Shots--

	if player.Shots == 0 {
		switch player.Weapon {
		case WeaponShotgun:
			startReload(player, GameConfig.ShotgunReloadTime, GameConfig.ShotgunAmmo)
		default:
			startReload(player, GameConfig.MachinegunReloadTime, GameConfig.ShotsPerMag)
		}
	}

	// Shotgun fires multiple pellets
	if player.Weapon == WeaponShotgun {
		pelletCount := GameConfig.ShotgunPellets
		baseAngle := math.Atan2(dirY, dirX)
		for i := 0; i < pelletCount; i++ {
			spreadAngle := baseAngle + (rand.Float64()-0.5)*2*GameConfig.ShotgunSpread
			pelletDirX := math.Cos(spreadAngle)
			pelletDirY := math.Sin(spreadAngle)
			speed := GameConfig.BulletSpeed * 0.9

			bullet := &Bullet{
				ID:        uuid.New().String(),
				ShortID:   game.NextShortID,
				X:         player.X,
				Y:         player.Y,
				DX:        pelletDirX * speed,
				DY:        pelletDirY * speed,
				Team:      0,
				PlayerID:  player.ID,
				Damage:    GameConfig.ShotgunDamage,
				Weapon:    WeaponShotgun,
				CreatedAt: now,
			}
			game.NextShortID++
			game.Bullets = append(game.Bullets, bullet)
		}
		return
	}

	// Machine gun — apply recoil
	recoil := GameConfig.MachinegunRecoil
	recoilAngle := (rand.Float64() - 0.5) * 2 * recoil
	cos := math.Cos(recoilAngle)
	sin := math.Sin(recoilAngle)
	finalDirX := dirX*cos - dirY*sin
	finalDirY := dirX*sin + dirY*cos

	bullet := &Bullet{
		ID:        uuid.New().String(),
		ShortID:   game.NextShortID,
		X:         player.X,
		Y:         player.Y,
		DX:        finalDirX * GameConfig.BulletSpeed,
		DY:        finalDirY * GameConfig.BulletSpeed,
		Team:      0,
		PlayerID:  player.ID,
		Damage:    GameConfig.MachinegunDamage,
		Weapon:    WeaponMachinegun,
		CreatedAt: now,
	}
	game.NextShortID++
	game.Bullets = append(game.Bullets, bullet)
}

// startReload begins a timed reload using a goroutine.
func startReload(player *Player, reloadTimeMs int64, refillAmount int) {
	player.Reloading = true
	if player.ReloadTimer != nil {
		player.ReloadTimer.Stop()
	}
	player.ReloadTimer = time.AfterFunc(time.Duration(reloadTimeMs)*time.Millisecond, func() {
		game := getPersistentGame()
		if game == nil {
			return
		}
		game.mu.Lock()
		defer game.mu.Unlock()
		player.Shots = refillAmount
		player.Reloading = false
	})
}

/* ================= MANUAL RELOAD ================= */

func reloadWeapon(player *Player) {
	if player.Reloading || player.HP <= 0 {
		return
	}
	if player.Weapon == WeaponKnife || player.Weapon == WeaponMinigun {
		return
	}

	var maxAmmo int
	var reloadTime int64
	switch player.Weapon {
	case WeaponShotgun:
		maxAmmo = GameConfig.ShotgunAmmo
		reloadTime = GameConfig.ShotgunReloadTime
	case WeaponSniper:
		maxAmmo = GameConfig.SniperAmmo
		reloadTime = GameConfig.SniperReloadTime
	default:
		maxAmmo = GameConfig.ShotsPerMag
		reloadTime = GameConfig.MachinegunReloadTime
	}

	if player.Shots >= maxAmmo {
		return
	}

	startReload(player, reloadTime, maxAmmo)
}

/* ================= PICKUPS ================= */

func applyPickup(player *Player, pickup *Pickup, game *Game) {
	now := unixMs()
	maxHP := GameConfig.PlayerHP
	switch pickup.Type {
	case PickupHealth:
		player.HP = min(maxHP, player.HP+GameConfig.PickupHealthAmount)
	case PickupAmmo:
		player.Shots = GameConfig.ShotsPerMag
		player.Reloading = false
	case PickupSpeed:
		player.SpeedBoostUntil = now + GameConfig.PickupSpeedDuration
	case PickupMinigun:
		player.Weapon = WeaponMinigun
		player.MinigunUntil = now + GameConfig.MinigunDuration
		player.Reloading = false
	case PickupShield:
		player.ShieldUntil = now + GameConfig.ShieldDuration
	case PickupInvisibility:
		player.InvisibleUntil = now + GameConfig.InvisibilityDuration
	case PickupRegen:
		player.RegenUntil = now + GameConfig.RegenDuration
		player.LastRegenTick = now
	case PickupArmor:
		player.Armor = min(GameConfig.ArmorMax, player.Armor+GameConfig.ArmorAmount)
	}

	broadcast(game, map[string]interface{}{
		"type":       "pickupCollected",
		"pickupId":   pickup.ID,
		"pickupType": string(pickup.Type),
		"playerId":   player.ID,
		"x":          int(math.Round(pickup.X)),
		"y":          int(math.Round(pickup.Y)),
	})
}

func spawnPickup(game *Game) {
	if len(game.Pickups) >= GameConfig.MaxPickups {
		return
	}

	types := []PickupType{PickupHealth, PickupAmmo, PickupSpeed, PickupMinigun, PickupShield, PickupInvisibility, PickupRegen, PickupArmor}
	ptype := types[rand.Intn(len(types))]

	var pickupX, pickupY float64
	validPosition := false
	for attempts := 0; attempts < 20; attempts++ {
		pickupX = 60 + rand.Float64()*(GameConfig.ArenaWidth-120)
		pickupY = 60 + rand.Float64()*(GameConfig.ArenaHeight-120)

		if !isPositionClear(pickupX, pickupY, game.Obstacles, GameConfig.PickupRadius*2) {
			continue
		}

		tooClose := false
		for _, p := range game.Players {
			if p.HP <= 0 {
				continue
			}
			if distance(pickupX, pickupY, p.X, p.Y) < 60 {
				tooClose = true
				break
			}
		}
		if tooClose {
			continue
		}

		validPosition = true
		break
	}

	if validPosition {
		pickup := &Pickup{
			ID:        uuid.New().String(),
			ShortID:   game.NextShortID,
			X:         pickupX,
			Y:         pickupY,
			Type:      ptype,
			CreatedAt: unixMs(),
		}
		game.NextShortID++
		game.Pickups = append(game.Pickups, pickup)
	}
}

/* ================= ORBS ================= */

func spawnOrb(game *Game) {
	if len(game.Orbs) >= GameConfig.OrbMax {
		return
	}

	batchSize := 3 + rand.Intn(3)
	for i := 0; i < batchSize; i++ {
		if len(game.Orbs) >= GameConfig.OrbMax {
			break
		}

		var orbX, orbY float64
		validPosition := false
		for attempts := 0; attempts < 20; attempts++ {
			orbX = 40 + rand.Float64()*(GameConfig.ArenaWidth-80)
			orbY = 40 + rand.Float64()*(GameConfig.ArenaHeight-80)
			if isPositionClear(orbX, orbY, game.Obstacles, GameConfig.OrbRadius) {
				validPosition = true
				break
			}
		}

		if validPosition {
			orb := &Orb{
				ID:        uuid.New().String(),
				ShortID:   game.NextShortID,
				X:         orbX,
				Y:         orbY,
				CreatedAt: unixMs(),
			}
			game.NextShortID++
			game.Orbs = append(game.Orbs, orb)
		}
	}
}

func spawnInitialOrbs(game *Game) {
	for i := 0; i < 15; i++ {
		spawnOrb(game)
	}
}

/* ================= LOOT CRATES ================= */

func destroyLootCrate(crate *LootCrate, game *Game) {
	filtered := make([]*LootCrate, 0, len(game.LootCrates))
	for _, c := range game.LootCrates {
		if c.ID != crate.ID {
			filtered = append(filtered, c)
		}
	}
	game.LootCrates = filtered

	// Drop a random pickup
	types := []PickupType{PickupHealth, PickupAmmo, PickupSpeed, PickupMinigun, PickupShield, PickupInvisibility, PickupRegen, PickupArmor}
	ptype := types[rand.Intn(len(types))]
	pickup := &Pickup{
		ID:        uuid.New().String(),
		ShortID:   game.NextShortID,
		X:         crate.X,
		Y:         crate.Y,
		Type:      ptype,
		CreatedAt: unixMs(),
	}
	game.NextShortID++
	game.Pickups = append(game.Pickups, pickup)

	broadcast(game, map[string]interface{}{
		"type":    "crateDestroyed",
		"crateId": crate.ID,
		"pickup": map[string]interface{}{
			"id":   pickup.ID,
			"x":    int(math.Round(pickup.X)),
			"y":    int(math.Round(pickup.Y)),
			"type": string(pickup.Type),
		},
	})
}

func spawnLootCrate(game *Game) {
	if len(game.LootCrates) >= GameConfig.LootCrateMax {
		return
	}

	var crateX, crateY float64
	validPosition := false
	for attempts := 0; attempts < 20; attempts++ {
		crateX = 80 + rand.Float64()*(GameConfig.ArenaWidth-160)
		crateY = 80 + rand.Float64()*(GameConfig.ArenaHeight-160)

		if !isPositionClear(crateX, crateY, game.Obstacles, GameConfig.LootCrateSize) {
			continue
		}

		tooClose := false
		for _, p := range game.Players {
			if p.HP <= 0 {
				continue
			}
			if distance(crateX, crateY, p.X, p.Y) < 80 {
				tooClose = true
				break
			}
		}
		if tooClose {
			continue
		}

		validPosition = true
		break
	}

	if validPosition {
		crate := &LootCrate{
			ID:        uuid.New().String(),
			ShortID:   game.NextShortID,
			X:         crateX,
			Y:         crateY,
			HP:        GameConfig.LootCrateHP,
			CreatedAt: unixMs(),
		}
		game.NextShortID++
		game.LootCrates = append(game.LootCrates, crate)

		broadcast(game, map[string]interface{}{
			"type": "crateSpawned",
			"crate": map[string]interface{}{
				"id": crate.ID,
				"x":  int(math.Round(crate.X)),
				"y":  int(math.Round(crate.Y)),
				"hp": crate.HP,
			},
		})
	}
}

func spawnInitialLootCrates(game *Game) {
	for i := 0; i < GameConfig.LootCrateCount; i++ {
		spawnLootCrate(game)
	}
}

/* ================= DASH ================= */

func performDash(player *Player) {
	now := unixMs()
	if player.HP <= 0 {
		return
	}
	if now < player.DashCooldownUntil {
		return
	}

	dirX := 0.0
	dirY := 0.0
	if player.Keys.A {
		dirX -= 1
	}
	if player.Keys.D {
		dirX += 1
	}
	if player.Keys.W {
		dirY -= 1
	}
	if player.Keys.S {
		dirY += 1
	}

	if dirX == 0 && dirY == 0 {
		dirX = math.Cos(player.AimAngle)
		dirY = math.Sin(player.AimAngle)
	}

	mag := math.Sqrt(dirX*dirX + dirY*dirY)
	if mag > 0 {
		dirX /= mag
		dirY /= mag
	}

	player.DashDirX = dirX
	player.DashDirY = dirY
	player.DashUntil = now + GameConfig.DashDuration
	player.DashCooldownUntil = now + GameConfig.DashCooldown
}

/* ================= BOMBS ================= */

func spawnBomb(game *Game) {
	count := 1 + rand.Intn(2) // 1-2
	for i := 0; i < count; i++ {
		var bombX, bombY float64
		validPosition := false
		for attempts := 0; attempts < 20; attempts++ {
			bombX = 60 + rand.Float64()*(GameConfig.ArenaWidth-120)
			bombY = 60 + rand.Float64()*(GameConfig.ArenaHeight-120)
			if isPositionClear(bombX, bombY, game.Obstacles, 20) {
				validPosition = true
				break
			}
		}

		if validPosition {
			bomb := &Bomb{
				ID:        uuid.New().String(),
				X:         bombX,
				Y:         bombY,
				CreatedAt: unixMs(),
			}
			game.Bombs = append(game.Bombs, bomb)

			broadcast(game, map[string]interface{}{
				"type": "bombSpawned",
				"id":   bomb.ID,
				"x":    int(math.Round(bomb.X)),
				"y":    int(math.Round(bomb.Y)),
			})
		}
	}
}

/* ================= LIGHTNING ================= */

func spawnLightning(game *Game) {
	var lightningX, lightningY float64
	validPosition := false
	for attempts := 0; attempts < 20; attempts++ {
		lightningX = 60 + rand.Float64()*(GameConfig.ArenaWidth-120)
		lightningY = 60 + rand.Float64()*(GameConfig.ArenaHeight-120)
		if isPositionClear(lightningX, lightningY, game.Obstacles, 20) {
			validPosition = true
			break
		}
	}

	if validPosition {
		lightning := &Lightning{
			ID:        uuid.New().String(),
			X:         lightningX,
			Y:         lightningY,
			CreatedAt: unixMs(),
		}
		game.Lightnings = append(game.Lightnings, lightning)

		broadcast(game, map[string]interface{}{
			"type":   "lightningWarning",
			"id":     lightning.ID,
			"x":      int(math.Round(lightning.X)),
			"y":      int(math.Round(lightning.Y)),
			"radius": GameConfig.LightningRadius,
		})
	}
}

/* ================= SPAWN TIMERS (checked every tick) ================= */

func checkSpawnTimers(game *Game, now int64) {
	// Obstacle spawn
	if now-game.LastObstacleSpawn >= GameConfig.ObstacleSpawnInterval {
		game.LastObstacleSpawn = now
		spawnRandomObstacle(game)
	}

	// Pickup spawn
	if now-game.LastPickupSpawn >= GameConfig.PickupSpawnInterval {
		game.LastPickupSpawn = now
		spawnPickup(game)
	}

	// Orb spawn
	if now-game.LastOrbSpawn >= GameConfig.OrbSpawnInterval {
		game.LastOrbSpawn = now
		spawnOrb(game)
	}

	// Bomb spawn (randomized delay)
	if game.NextBombDelay == 0 {
		game.NextBombDelay = int64(float64(GameConfig.BombSpawnInterval) * (0.5 + rand.Float64()))
	}
	if now-game.LastBombSpawn >= game.NextBombDelay {
		game.LastBombSpawn = now
		game.NextBombDelay = int64(float64(GameConfig.BombSpawnInterval) * (0.5 + rand.Float64()))
		spawnBomb(game)
	}

	// Lightning spawn (randomized delay)
	if game.NextLightningDelay == 0 {
		game.NextLightningDelay = int64(float64(GameConfig.LightningSpawnInterval) * (0.5 + rand.Float64()))
	}
	if now-game.LastLightningSpawn >= game.NextLightningDelay {
		game.LastLightningSpawn = now
		game.NextLightningDelay = int64(float64(GameConfig.LightningSpawnInterval) * (0.5 + rand.Float64()))
		spawnLightning(game)
	}

	// Loot crate spawn
	if now-game.LastCrateSpawn >= GameConfig.LootCrateRespawnInterval {
		game.LastCrateSpawn = now
		spawnLootCrate(game)
	}
}

/* ================= OBSTACLE SPAWNING ================= */

func spawnRandomObstacle(game *Game) {
	isTree := rand.Float64() > 0.6
	size := ObstacleConfig.WallBlockSize
	if isTree {
		size = ObstacleConfig.TreeSize
	}

	var obstX, obstY float64
	validPosition := false
	for attempts := 0; attempts < 20; attempts++ {
		obstX = 80 + rand.Float64()*(GameConfig.ArenaWidth-160)
		obstY = 80 + rand.Float64()*(GameConfig.ArenaHeight-160)

		valid := true
		for _, p := range game.Players {
			if distance(obstX, obstY, p.X, p.Y) < 80 {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}

		for _, obs := range game.Obstacles {
			if obs.Destroyed {
				continue
			}
			if distance(obstX, obstY, obs.X, obs.Y) < 40 {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}

		validPosition = true
		break
	}

	if validPosition {
		obsType := "wall"
		if isTree {
			obsType = "tree"
		}
		newObs := &Obstacle{
			ID:        uuid.New().String(),
			X:         obstX,
			Y:         obstY,
			Size:      size,
			Destroyed: false,
			Type:      obsType,
		}
		game.Obstacles = append(game.Obstacles, newObs)

		broadcast(game, map[string]interface{}{
			"type":     "newObstacle",
			"obstacle": map[string]interface{}{
				"id":        newObs.ID,
				"x":         newObs.X,
				"y":         newObs.Y,
				"size":      newObs.Size,
				"destroyed": false,
				"type":      newObs.Type,
			},
		})
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

func generateObstacles() []*Obstacle {
	obstacles := make([]*Obstacle, 0)
	wallCount := ObstacleConfig.WallCountMin +
		rand.Intn(ObstacleConfig.WallCountMax-ObstacleConfig.WallCountMin+1)
	treeCount := ObstacleConfig.TreeCountMin +
		rand.Intn(ObstacleConfig.TreeCountMax-ObstacleConfig.TreeCountMin+1)

	type usedArea struct {
		x, y, width, height float64
	}
	usedAreas := make([]usedArea, 0)

	for i := 0; i < wallCount; i++ {
		validPosition := false
		var startX, startY float64
		var isHorizontal bool
		var wallLength int

		for attempts := 0; attempts < 20; attempts++ {
			isHorizontal = rand.Float64() > 0.5
			wallLength = ObstacleConfig.WallLengthMin +
				rand.Intn(ObstacleConfig.WallLengthMax-ObstacleConfig.WallLengthMin+1)
			startX = 120 + rand.Float64()*(GameConfig.ArenaWidth-340)
			startY = 120 + rand.Float64()*(GameConfig.ArenaHeight-340)

			wallWidth := ObstacleConfig.WallBlockSize
			wallHeight := float64(wallLength) * ObstacleConfig.WallBlockSize
			if isHorizontal {
				wallWidth = float64(wallLength) * ObstacleConfig.WallBlockSize
				wallHeight = ObstacleConfig.WallBlockSize
			}

			valid := true
			for _, area := range usedAreas {
				if startX < area.x+area.width+ObstacleConfig.WallSpacing &&
					startX+wallWidth+ObstacleConfig.WallSpacing > area.x &&
					startY < area.y+area.height+ObstacleConfig.WallSpacing &&
					startY+wallHeight+ObstacleConfig.WallSpacing > area.y {
					valid = false
					break
				}
			}
			if valid {
				validPosition = true
				break
			}
		}

		if validPosition {
			blockSize := ObstacleConfig.WallBlockSize
			ww := blockSize
			wh := float64(wallLength) * blockSize
			if isHorizontal {
				ww = float64(wallLength) * blockSize
				wh = blockSize
			}
			usedAreas = append(usedAreas, usedArea{startX, startY, ww, wh})

			gID := uuid.New().String()
			for j := 0; j < wallLength; j++ {
				ox := startX
				oy := startY
				if isHorizontal {
					ox = startX + float64(j)*blockSize
				} else {
					oy = startY + float64(j)*blockSize
				}
				obstacles = append(obstacles, &Obstacle{
					ID:        uuid.New().String(),
					X:         ox,
					Y:         oy,
					Size:      blockSize,
					Destroyed: false,
					Type:      "wall",
					GroupID:   gID,
				})
			}
		}
	}

	for i := 0; i < treeCount; i++ {
		treeSize := ObstacleConfig.TreeSize
		validPosition := false
		var treeX, treeY float64

		for attempts := 0; attempts < 20; attempts++ {
			treeX = 120 + rand.Float64()*(GameConfig.ArenaWidth-240)
			treeY = 120 + rand.Float64()*(GameConfig.ArenaHeight-240)

			valid := true
			for _, area := range usedAreas {
				dx := treeX - (area.x + area.width/2)
				dy := treeY - (area.y + area.height/2)
				if math.Sqrt(dx*dx+dy*dy) < ObstacleConfig.TreeSpacing {
					valid = false
					break
				}
			}
			if valid {
				validPosition = true
				break
			}
		}

		if validPosition {
			usedAreas = append(usedAreas, usedArea{
				treeX - treeSize/2, treeY - treeSize/2, treeSize, treeSize,
			})
			obstacles = append(obstacles, &Obstacle{
				ID:        uuid.New().String(),
				X:         treeX - treeSize/2,
				Y:         treeY - treeSize/2,
				Size:      treeSize,
				Destroyed: false,
				Type:      "tree",
			})
		}
	}

	return obstacles
}

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

/* ================= ROUND TIMER ================= */

func startRoundTimer(game *Game) {
	roundDuration := GameConfig.RoundDuration
	game.MatchStartTime = unixMs()

	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			// Compute remaining time inside the lock, then release before broadcasting.
			game.mu.Lock()
			elapsed := unixMs() - game.MatchStartTime
			remaining := max(0, int((roundDuration-elapsed+999)/1000)) // ceil
			game.mu.Unlock()

			broadcast(game, map[string]interface{}{
				"type":      "gameTimer",
				"remaining": remaining,
			})

			if remaining <= 0 {
				endRound(game)
				return
			}
		}
	}()
}

func endRound(game *Game) {
	game.mu.Lock()
	game.RoundEnded = true

	// Build scoreboard
	type scoreEntry struct {
		Username string `msgpack:"username"`
		Kills    int    `msgpack:"kills"`
		Deaths   int    `msgpack:"deaths"`
		Score    int    `msgpack:"score"`
	}
	scoreboard := make([]scoreEntry, 0, len(game.Players))
	for _, p := range game.Players {
		scoreboard = append(scoreboard, scoreEntry{
			Username: p.Username,
			Kills:    p.Kills,
			Deaths:   p.Deaths,
			Score:    p.Score,
		})
	}
	// Sort by score desc
	for i := 0; i < len(scoreboard); i++ {
		for j := i + 1; j < len(scoreboard); j++ {
			if scoreboard[j].Score > scoreboard[i].Score {
				scoreboard[i], scoreboard[j] = scoreboard[j], scoreboard[i]
			}
		}
	}

	winnerName := "Nobody"
	if len(scoreboard) > 0 {
		winnerName = scoreboard[0].Username
	}

	// Save stats
	for _, p := range game.Players {
		updateStats(p.Username, p.Kills, p.Deaths, p.Username == winnerName)
	}

	// Save match history
	historyPlayers := make([]MatchHistoryPlayer, 0)
	for _, s := range scoreboard {
		historyPlayers = append(historyPlayers, MatchHistoryPlayer{
			Username: s.Username,
			Kills:    s.Kills,
			Deaths:   s.Deaths,
			IsWinner: s.Username == winnerName,
		})
	}
	addMatchHistory(&MatchHistoryEntry{
		Timestamp:  unixMs(),
		Players:    historyPlayers,
		WinnerName: winnerName,
	})

	// Collect per-player roundEnd messages inside the lock, send after unlocking.
	type pendingMsg struct {
		player *Player
		data   []byte
	}
	pendingMsgs := make([]pendingMsg, 0, len(game.Players))

	// Sound indices
	winAudioIndex := rand.Intn(8) + 1
	loseIndices := []int{1, 2, 3, 4, 5, 6, 7, 8, 9}
	rand.Shuffle(len(loseIndices), func(i, j int) {
		loseIndices[i], loseIndices[j] = loseIndices[j], loseIndices[i]
	})
	loseIdx := 0

	for _, p := range game.Players {
		isWinner := p.Username == winnerName
		audioIndex := winAudioIndex
		if !isWinner {
			audioIndex = loseIndices[loseIdx%len(loseIndices)]
			loseIdx++
		}
		msg, _ := Serialize(map[string]interface{}{
			"type":         "roundEnd",
			"winnerName":   winnerName,
			"scoreboard":   scoreboard,
			"audioIndex":   audioIndex,
			"restartDelay": GameConfig.RoundRestartDelay,
		})
		pendingMsgs = append(pendingMsgs, pendingMsg{player: p, data: msg})
	}
	game.mu.Unlock()

	// Send outside the lock so a slow client doesn't stall the server.
	for _, pm := range pendingMsgs {
		sendRaw(pm.player, pm.data)
	}

	// Schedule new round
	time.AfterFunc(time.Duration(GameConfig.RoundRestartDelay)*time.Millisecond, func() {
		resetPersistentRound(game)
	})
}

func resetPersistentRound(game *Game) {
	game.mu.Lock()

	game.RoundEnded = false

	// Regenerate obstacles
	game.Obstacles = generateObstacles()
	game.Bullets = make([]*Bullet, 0)
	game.Pickups = make([]*Pickup, 0)
	game.Orbs = make([]*Orb, 0)
	game.Bombs = make([]*Bomb, 0)
	game.Lightnings = make([]*Lightning, 0)
	game.LootCrates = make([]*LootCrate, 0)
	game.StateSequence = 0
	game.Zone = Zone{X: 0, Y: 0, W: GameConfig.ArenaWidth, H: GameConfig.ArenaHeight}
	game.ZoneShrinking = false

	now := unixMs()
	game.LastObstacleSpawn = now
	game.LastPickupSpawn = now
	game.LastOrbSpawn = now
	game.LastBombSpawn = now
	game.LastLightningSpawn = now
	game.LastCrateSpawn = now
	game.NextBombDelay = 0
	game.NextLightningDelay = 0

	// Reset all player stats
	for _, p := range game.Players {
		p.Kills = 0
		p.Deaths = 0
		p.Score = 0
		p.KillStreak = 0
		p.LastKilledBy = ""
		p.WaitingForRespawn = false
		p.HP = GameConfig.PlayerHP
		p.Shots = GameConfig.ShotsPerMag
		p.Reloading = false
		p.Weapon = WeaponMachinegun
		p.SpeedBoostUntil = 0
		p.MinigunUntil = 0
		p.ShieldUntil = 0
		p.InvisibleUntil = 0
		p.RegenUntil = 0
		p.LastRegenTick = 0
		p.Armor = 0
		p.DashCooldownUntil = 0
		p.DashUntil = 0
		p.Keys = Keys{}
	}

	// Respawn all players
	for _, p := range game.Players {
		bestX := GameConfig.ArenaWidth / 2
		bestY := GameConfig.ArenaHeight / 2
		bestDistance := 0.0
		for attempt := 0; attempt < 50; attempt++ {
			testX := 50 + rand.Float64()*(GameConfig.ArenaWidth-100)
			testY := 50 + rand.Float64()*(GameConfig.ArenaHeight-100)
			if !isPositionClear(testX, testY, game.Obstacles, GameConfig.PlayerRadius) {
				continue
			}
			minDist := math.Inf(1)
			for _, other := range game.Players {
				if other.ID == p.ID || other.HP <= 0 {
					continue
				}
				d := distance(testX, testY, other.X, other.Y)
				if d < minDist {
					minDist = d
				}
			}
			if minDist > bestDistance {
				bestDistance = minDist
				bestX = testX
				bestY = testY
			}
		}
		p.X = bestX
		p.Y = bestY
	}

	// Spawn initial entities
	spawnInitialOrbs(game)
	spawnInitialLootCrates(game)

	// Build shortIdMap
	shortIDMap := make(map[uint16]map[string]string)
	for _, p := range game.Players {
		shortIDMap[p.ShortID] = map[string]string{
			"id":       p.ID,
			"username": p.Username,
		}
	}

	// Collect per-player roundStart messages inside the lock, send after unlocking.
	type pendingMsg struct {
		player *Player
		data   []byte
	}
	pendingMsgs := make([]pendingMsg, 0, len(game.Players))
	for _, p := range game.Players {
		msg, _ := Serialize(map[string]interface{}{
			"type":        "roundStart",
			"obstacles":   serializeObstacles(game.Obstacles),
			"orbs":        serializeOrbs(game.Orbs),
			"arenaWidth":  GameConfig.ArenaWidth,
			"arenaHeight": GameConfig.ArenaHeight,
			"maxHp":       GameConfig.PlayerHP,
			"shortIdMap":  shortIDMap,
			"playerX":     int(math.Round(p.X)),
			"playerY":     int(math.Round(p.Y)),
		})
		pendingMsgs = append(pendingMsgs, pendingMsg{player: p, data: msg})
	}

	playerCount := len(game.Players)
	game.mu.Unlock()

	// Send outside the lock so a slow client doesn't stall the server.
	for _, pm := range pendingMsgs {
		sendRaw(pm.player, pm.data)
	}

	fmt.Printf("🔄 New round started! (%d players)\n", playerCount)

	// Start new round timer (in a new goroutine, from outside lock)
	go func() {
		startRoundTimer(game)
	}()
}

// serializeObstacles converts obstacles for msgpack transmission.
func serializeObstacles(obstacles []*Obstacle) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(obstacles))
	for _, o := range obstacles {
		entry := map[string]interface{}{
			"id":        o.ID,
			"x":         o.X,
			"y":         o.Y,
			"size":      o.Size,
			"destroyed": o.Destroyed,
			"type":      o.Type,
		}
		if o.GroupID != "" {
			entry["groupId"] = o.GroupID
		}
		result = append(result, entry)
	}
	return result
}

/* ================= PLAYER JOIN/LEAVE ================= */

func addPlayerToGame(player *Player, game *Game) {
	bestX := GameConfig.ArenaWidth / 2
	bestY := GameConfig.ArenaHeight / 2
	bestDistance := 0.0

	for attempt := 0; attempt < 50; attempt++ {
		testX := 50 + rand.Float64()*(GameConfig.ArenaWidth-100)
		testY := 50 + rand.Float64()*(GameConfig.ArenaHeight-100)
		if !isPositionClear(testX, testY, game.Obstacles, GameConfig.PlayerRadius) {
			continue
		}

		minDist := math.Inf(1)
		for _, other := range game.Players {
			if other.HP <= 0 {
				continue
			}
			d := distance(testX, testY, other.X, other.Y)
			if d < minDist {
				minDist = d
			}
		}
		if len(game.Players) == 0 {
			minDist = 1000
		}
		if minDist > bestDistance {
			bestDistance = minDist
			bestX = testX
			bestY = testY
		}
	}

	player.X = bestX
	player.Y = bestY
	player.HP = GameConfig.PlayerHP
	player.Shots = GameConfig.ShotsPerMag
	player.Reloading = false
	player.Kills = 0
	player.Deaths = 0
	player.Score = 0
	player.Weapon = WeaponMachinegun
	player.Keys = Keys{}
	player.LastProcessedInput = 0
	player.AimAngle = 0
	player.LastKilledBy = ""
	player.ShieldUntil = 0
	player.InvisibleUntil = 0
	player.RegenUntil = 0
	player.LastRegenTick = 0
	player.Armor = 0
	player.DashCooldownUntil = 0
	player.DashUntil = 0
	player.DashDirX = 0
	player.DashDirY = 0
	player.KillStreak = 0
	player.WaitingForRespawn = false
	player.Ready = true

	game.Players = append(game.Players, player)

	fmt.Printf("➕ %s joined the arena (%d players)\n", player.Username, len(game.Players))
}

func removePlayerFromGame(playerID string, game *Game) {
	var player *Player
	for _, p := range game.Players {
		if p.ID == playerID {
			player = p
			break
		}
	}

	if player != nil {
		updateStats(player.Username, player.Kills, player.Deaths, false)
		fmt.Printf("➖ %s left the arena (score: %d)\n", player.Username, player.Score)
	}

	game.Players = removePlayerFromSlice(game.Players, playerID)

	// Remove their bullets
	filtered := make([]*Bullet, 0, len(game.Bullets))
	for _, b := range game.Bullets {
		if b.PlayerID != playerID {
			filtered = append(filtered, b)
		}
	}
	game.Bullets = filtered
}

/* ================= RESPAWN ================= */

func respawnPlayer(player *Player, game *Game) {
	player.WaitingForRespawn = false

	bestX := GameConfig.ArenaWidth / 2
	bestY := GameConfig.ArenaHeight / 2
	if game.ZoneShrinking {
		bestX = game.Zone.X + game.Zone.W/2
		bestY = game.Zone.Y + game.Zone.H/2
	}
	bestDistance := 0.0

	alivePlayers := make([]*Player, 0)
	for _, p := range game.Players {
		if p.HP > 0 && p.ID != player.ID {
			alivePlayers = append(alivePlayers, p)
		}
	}

	spawnMargin := 50.0
	spawnMinX := spawnMargin
	spawnMinY := spawnMargin
	spawnMaxX := GameConfig.ArenaWidth - spawnMargin
	spawnMaxY := GameConfig.ArenaHeight - spawnMargin
	if game.ZoneShrinking {
		spawnMinX = game.Zone.X + spawnMargin
		spawnMinY = game.Zone.Y + spawnMargin
		spawnMaxX = game.Zone.X + game.Zone.W - spawnMargin
		spawnMaxY = game.Zone.Y + game.Zone.H - spawnMargin
	}

	for attempt := 0; attempt < 50; attempt++ {
		testX := spawnMinX + rand.Float64()*math.Max(0, spawnMaxX-spawnMinX)
		testY := spawnMinY + rand.Float64()*math.Max(0, spawnMaxY-spawnMinY)

		if !isPositionClear(testX, testY, game.Obstacles, GameConfig.PlayerRadius) {
			continue
		}

		minDist := math.Inf(1)
		for _, other := range alivePlayers {
			d := distance(testX, testY, other.X, other.Y)
			if d < minDist {
				minDist = d
			}
		}
		if minDist > bestDistance {
			bestDistance = minDist
			bestX = testX
			bestY = testY
		}
	}

	player.X = bestX
	player.Y = bestY
	player.HP = GameConfig.PlayerHP
	player.Shots = GameConfig.ShotsPerMag
	player.Reloading = false
	player.Keys = Keys{}
	player.Weapon = WeaponMachinegun
	player.SpeedBoostUntil = 0
	player.MinigunUntil = 0
	player.ShieldUntil = 0
	player.InvisibleUntil = 0
	player.RegenUntil = 0
	player.LastRegenTick = 0
	player.Armor = 0
	player.DashCooldownUntil = 0
	player.DashUntil = 0
	player.DashDirX = 0
	player.DashDirY = 0

	// Push out of obstacles
	pr := GameConfig.PlayerRadius
	for _, obs := range game.Obstacles {
		if obs.Destroyed {
			continue
		}
		closestX := clamp(player.X, obs.X, obs.X+obs.Size)
		closestY := clamp(player.Y, obs.Y, obs.Y+obs.Size)
		dx := player.X - closestX
		dy := player.Y - closestY
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist < pr {
			if dist == 0 {
				ocx := obs.X + obs.Size/2
				ocy := obs.Y + obs.Size/2
				awayX := player.X - ocx
				awayY := player.Y - ocy
				awayDist := math.Sqrt(awayX*awayX+awayY*awayY) + 0.001
				player.X += (awayX / awayDist) * (pr + obs.Size/2)
				player.Y += (awayY / awayDist) * (pr + obs.Size/2)
			} else {
				overlap := pr - dist
				player.X += (dx / dist) * overlap
				player.Y += (dy / dist) * overlap
			}
		}
	}

	// Clamp to arena
	clampMinX := pr
	clampMinY := pr
	clampMaxX := GameConfig.ArenaWidth - pr
	clampMaxY := GameConfig.ArenaHeight - pr
	if game.ZoneShrinking {
		clampMinX = math.Max(pr, game.Zone.X+pr)
		clampMinY = math.Max(pr, game.Zone.Y+pr)
		clampMaxX = math.Min(GameConfig.ArenaWidth-pr, game.Zone.X+game.Zone.W-pr)
		clampMaxY = math.Min(GameConfig.ArenaHeight-pr, game.Zone.Y+game.Zone.H-pr)
	}
	player.X = clamp(player.X, clampMinX, clampMaxX)
	player.Y = clamp(player.Y, clampMinY, clampMaxY)

	broadcast(game, map[string]interface{}{
		"type":     "respawn",
		"playerId": player.ID,
		"x":        int(math.Round(bestX)),
		"y":        int(math.Round(bestY)),
	})
}

func requestRespawn(player *Player, game *Game) {
	if player.HP > 0 {
		return
	}
	if !player.WaitingForRespawn {
		return
	}
	respawnPlayer(player, game)
}

/* ================= ZONE SHRINK (disabled) ================= */

func startZoneShrink(game *Game) {
	if game.ZoneShrinking {
		return
	}
	game.ZoneShrinking = true
	broadcast(game, map[string]interface{}{"type": "zoneWarning"})
	// Zone shrinking is effectively disabled via config
}

// min/max helpers for int
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
