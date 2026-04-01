package main

import (
	"fmt"
	"math"
	"math/rand"
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

	// ── Build spatial grid for obstacles ──
	globalObstacleGrid.Clear()
	for _, o := range game.Obstacles {
		globalObstacleGrid.Insert(&SpatialEntry{
			ID:   o.ID,
			X:    o.X,
			Y:    o.Y,
			Size: o.Size,
			Data: o,
		})
	}

	// ── Player movement (velocity-based with acceleration/friction) ──
	for _, player := range game.Players {
		if player.HP <= 0 {
			continue
		}

		playerRadius := GameConfig.PlayerRadius
		margin := playerRadius
		speed := GameConfig.PlayerSpeed

		// Tagging slow (reduced speed when recently hit)
		if now < player.TaggedUntil {
			speed *= GameConfig.TagSpeedMult
		}

		// Crouch slow
		if player.Crouching {
			speed *= GameConfig.CrouchSpeedMult
		}

		// Counter-strafe detection: releasing a key while opposite is pressed
		if !player.Keys.A && player.PrevKeysA && player.Keys.D {
			player.CounterStrafeX = GameConfig.CounterStrafeFrames
		}
		if !player.Keys.D && player.PrevKeysD && player.Keys.A {
			player.CounterStrafeX = GameConfig.CounterStrafeFrames
		}
		if !player.Keys.W && player.PrevKeysW && player.Keys.S {
			player.CounterStrafeY = GameConfig.CounterStrafeFrames
		}
		if !player.Keys.S && player.PrevKeysS && player.Keys.W {
			player.CounterStrafeY = GameConfig.CounterStrafeFrames
		}
		player.PrevKeysA = player.Keys.A
		player.PrevKeysD = player.Keys.D
		player.PrevKeysW = player.Keys.W
		player.PrevKeysS = player.Keys.S
		if player.CounterStrafeX > 0 {
			player.CounterStrafeX--
		}
		if player.CounterStrafeY > 0 {
			player.CounterStrafeY--
		}

		// Dodge roll override — bypass normal movement
		if player.DodgeRolling {
			if now >= player.DodgeRollEnd {
				player.DodgeRolling = false
			} else {
				player.VX = player.DodgeRollDirX * GameConfig.DodgeRollSpeed
				player.VY = player.DodgeRollDirY * GameConfig.DodgeRollSpeed
			}
		}

		if !player.DodgeRolling {
			// Compute desired direction
			var inputDirX, inputDirY float64
			if player.Keys.A {
				inputDirX -= 1
			}
			if player.Keys.D {
				inputDirX += 1
			}
			if player.Keys.W {
				inputDirY -= 1
			}
			if player.Keys.S {
				inputDirY += 1
			}

			// Diagonal normalization (prevents √2 speed boost)
			inputLen := math.Sqrt(inputDirX*inputDirX + inputDirY*inputDirY)
			if inputLen > 1.0 {
				inputDirX /= inputLen
				inputDirY /= inputLen
			}

			// Acceleration / friction
			targetVX := inputDirX * speed
			targetVY := inputDirY * speed
			accel := GameConfig.PlayerAcceleration

			if inputLen > 0 {
				player.VX += (targetVX - player.VX) * accel
				player.VY += (targetVY - player.VY) * accel
			} else {
				player.VX *= GameConfig.PlayerFriction
				player.VY *= GameConfig.PlayerFriction
			}

			// Clamp to max speed
			vLen := math.Sqrt(player.VX*player.VX + player.VY*player.VY)
			if vLen > speed {
				player.VX = player.VX / vLen * speed
				player.VY = player.VY / vLen * speed
			}
			// Zero out very small velocities
			if math.Abs(player.VX) < 0.01 {
				player.VX = 0
			}
			if math.Abs(player.VY) < 0.01 {
				player.VY = 0
			}
		}

		// Apply X movement
		player.X += player.VX
		player.X = clamp(player.X, margin, GameConfig.ArenaWidth-margin)
		resolveCollisions(player, globalObstacleGrid, playerRadius, true)

		// Apply Y movement
		player.Y += player.VY
		player.Y = clamp(player.Y, margin, GameConfig.ArenaHeight-margin)
		resolveCollisions(player, globalObstacleGrid, playerRadius, false)
	}

	// ── Player-player collision (push apart so they can't overlap) ──
	{
		pr := GameConfig.PlayerRadius
		minDist := pr * 2 // two radii
		for i := 0; i < len(game.Players); i++ {
			a := game.Players[i]
			if a.HP <= 0 {
				continue
			}
			for j := i + 1; j < len(game.Players); j++ {
				b := game.Players[j]
				if b.HP <= 0 {
					continue
				}
				dx := a.X - b.X
				dy := a.Y - b.Y
				distSq := dx*dx + dy*dy
				if distSq < minDist*minDist && distSq > 0.0001 {
					dist := math.Sqrt(distSq)
					overlap := minDist - dist
					// Push each player half the overlap
					nx := dx / dist
					ny := dy / dist
					half := overlap / 2
					a.X += nx * half
					a.Y += ny * half
					b.X -= nx * half
					b.Y -= ny * half
					// Clamp to arena
					a.X = clamp(a.X, pr, GameConfig.ArenaWidth-pr)
					a.Y = clamp(a.Y, pr, GameConfig.ArenaHeight-pr)
					b.X = clamp(b.X, pr, GameConfig.ArenaWidth-pr)
					b.Y = clamp(b.Y, pr, GameConfig.ArenaHeight-pr)
				}
			}
		}
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
		// Auto-clear throwing indicator after 500ms
		if player.ThrowingGrenade && now-player.ThrowStartTime > 500 {
			player.ThrowingGrenade = false
		}
	}

	// ── Bullet physics ──
	// Use a slice-based set for O(1) removal lookups without map allocation
	bulletRemoved := make([]bool, len(game.Bullets))

	for bi, bullet := range game.Bullets {
		// Save previous position for swept collision
		prevX := bullet.X
		prevY := bullet.Y

		bullet.X += bullet.DX
		bullet.Y += bullet.DY

		// Out of bounds
		if bullet.X < 0 || bullet.X > GameConfig.ArenaWidth ||
			bullet.Y < 0 || bullet.Y > GameConfig.ArenaHeight {
			bulletRemoved[bi] = true
			continue
		}

		// Swept bullet-obstacle collision: check the line from prevPos to curPos
		// This prevents fast bullets (sniper=48px/tick) from phasing through 40px walls.
		sweptMinX := math.Min(prevX, bullet.X) - 2
		sweptMinY := math.Min(prevY, bullet.Y) - 2
		sweptMaxX := math.Max(prevX, bullet.X) + 2
		sweptMaxY := math.Max(prevY, bullet.Y) + 2
		sweptW := sweptMaxX - sweptMinX
		sweptH := sweptMaxY - sweptMinY
		nearbyObs := globalObstacleGrid.QueryRect(sweptMinX, sweptMinY, sweptW, sweptH)
		hitObstacle := false
		var hitX, hitY float64
		var hitThinWall bool
		for _, e := range nearbyObs {
			o := e.Data.(*Obstacle)
			if segmentIntersectsAABB(prevX, prevY, bullet.X, bullet.Y, o.X, o.Y, o.X+o.Size, o.Y+o.Size) {
				hitObstacle = true
				hitThinWall = o.Thin
				hitX = clamp(bullet.X, o.X, o.X+o.Size)
				hitY = clamp(bullet.Y, o.Y, o.Y+o.Size)
				break
			}
		}
		if hitObstacle {
			// 1.14: Bullet penetration — thin walls allow pass-through with 60% damage loss
			if hitThinWall && bullet.Penetrated == 0 {
				bullet.Penetrated++
				bullet.Damage = int(float64(bullet.Damage) * 0.4) // 60% loss
				if bullet.Damage < 1 {
					bullet.Damage = 1
				}
				// Slight spread increase after penetration
				spreadAngle := (rand.Float64() - 0.5) * 0.08
				cos := math.Cos(spreadAngle)
				sin := math.Sin(spreadAngle)
				bullet.DX, bullet.DY = bullet.DX*cos-bullet.DY*sin, bullet.DX*sin+bullet.DY*cos
				// Broadcast wallbang event for visual feedback
				broadcast(game, map[string]interface{}{
					"type": "bulletHitWall",
					"x":    int(math.Round(hitX)),
					"y":    int(math.Round(hitY)),
				})
				// Don't remove bullet — it continues through
			} else {
				bulletRemoved[bi] = true
				broadcast(game, map[string]interface{}{
					"type": "bulletHitWall",
					"x":    int(math.Round(hitX)),
					"y":    int(math.Round(hitY)),
				})
				continue
			}
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
			bdx := p.X - bullet.X
			bdy := p.Y - bullet.Y
			if bdx*bdx+bdy*bdy < hitRadiusSq {
				// Line-of-sight check: make sure there's no wall between
				// the bullet's previous position and the target player.
				if hasLineOfSight(prevX, prevY, p.X, p.Y, globalObstacleGrid) {
					enemy = p
					break
				}
			}
		}

		if enemy != nil {
			bulletRemoved[bi] = true

			// Headshot detection: check if bullet is within 5px of the enemy's
			// sprite head position (varies by weapon, rotated by aim angle).
			isHeadshot := false
			{
				hx, hy := headWorldPosition(enemy.X, enemy.Y, enemy.AimAngle, enemy.Weapon)
				hdx := bullet.X - hx
				hdy := bullet.Y - hy
				if hdx*hdx+hdy*hdy <= headHitRadius*headHitRadius {
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

			// Tagging: slow enemy on hit
			enemy.TaggedUntil = now + GameConfig.TagDuration

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
		for bi, b := range game.Bullets {
			if !bulletRemoved[bi] && now-b.CreatedAt < GameConfig.BulletLifetime {
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

	// ── Grenade physics ──
	updateGrenades(game, now)

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

		// Cull entities to viewer's viewport (pre-allocate with estimated capacity)
		visPlayers := make([]*Player, 0, len(game.Players))
		for _, p := range game.Players {
			if p.ID == viewer.ID || (math.Abs(p.X-vx) < half && math.Abs(p.Y-vy) < half) {
				visPlayers = append(visPlayers, p)
			}
		}
		visBullets := make([]*Bullet, 0, len(game.Bullets))
		for _, b := range game.Bullets {
			if math.Abs(b.X-vx) < half && math.Abs(b.Y-vy) < half {
				visBullets = append(visBullets, b)
			}
		}
		visGrenades := make([]*Grenade, 0, len(game.Grenades))
		for _, g := range game.Grenades {
			if math.Abs(g.X-vx) < half && math.Abs(g.Y-vy) < half {
				visGrenades = append(visGrenades, g)
			}
		}

		buf := EncodeBinaryState(&BinaryStateInput{
			Seq:      seq,
			Players:  visPlayers,
			Bullets:  visBullets,
			Grenades: visGrenades,
		})

		snapshots = append(snapshots, playerStateSnapshot{player: viewer, data: buf})
	}
	return snapshots
}

// segmentIntersectsAABB tests whether the line segment (x1,y1)→(x2,y2)
// intersects the axis-aligned bounding box [minX,minY]–[maxX,maxY].
// Uses the slab method (Liang–Barsky variant).
func segmentIntersectsAABB(x1, y1, x2, y2, minX, minY, maxX, maxY float64) bool {
	dx := x2 - x1
	dy := y2 - y1

	tMin := 0.0
	tMax := 1.0

	// X slab
	if math.Abs(dx) < 1e-12 {
		if x1 < minX || x1 > maxX {
			return false
		}
	} else {
		ivd := 1.0 / dx
		t0 := (minX - x1) * ivd
		t1 := (maxX - x1) * ivd
		if t0 > t1 {
			t0, t1 = t1, t0
		}
		if t0 > tMin {
			tMin = t0
		}
		if t1 < tMax {
			tMax = t1
		}
		if tMin > tMax {
			return false
		}
	}

	// Y slab
	if math.Abs(dy) < 1e-12 {
		if y1 < minY || y1 > maxY {
			return false
		}
	} else {
		ivd := 1.0 / dy
		t0 := (minY - y1) * ivd
		t1 := (maxY - y1) * ivd
		if t0 > t1 {
			t0, t1 = t1, t0
		}
		if t0 > tMin {
			tMin = t0
		}
		if t1 < tMax {
			tMax = t1
		}
		if tMin > tMax {
			return false
		}
	}

	return true
}

// hasLineOfSight checks whether a straight line from (ax,ay) to (bx,by)
// is unobstructed by any obstacle in the given spatial grid.
func hasLineOfSight(ax, ay, bx, by float64, grid *SpatialGrid) bool {
	minX := math.Min(ax, bx) - 2
	minY := math.Min(ay, by) - 2
	maxX := math.Max(ax, bx) + 2
	maxY := math.Max(ay, by) + 2
	nearby := grid.QueryRect(minX, minY, maxX-minX, maxY-minY)
	for _, e := range nearby {
		o := e.Data.(*Obstacle)
		if segmentIntersectsAABB(ax, ay, bx, by, o.X, o.Y, o.X+o.Size, o.Y+o.Size) {
			return false
		}
	}
	return true
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
	chosenMap := PickRandomMap()
	CurrentMapName = chosenMap.Name
	obstacles := GenerateObstaclesFromMap(chosenMap)
	now := unixMs()

	game := &Game{
		ID:          "persistent",
		NextShortID: 1,
		Players:     make([]*Player, 0),
		Bullets:     make([]*Bullet, 0),
		Grenades:    make([]*Grenade, 0),
		Obstacles:   obstacles,
		Started:     true,
		RoundEnded:  false,
		MatchStartTime: now,
		RoundStartTime: now,
	}

	setPersistentGame(game)

	fmt.Printf("🌍 Persistent game world initialized — map %q (%d obstacles, arena %.0fx%.0f)\n",
		chosenMap.Name, len(obstacles), GameConfig.ArenaWidth, GameConfig.ArenaHeight)

	// Start round timer
	startRoundTimer(game)

	// Start game tick loop
	startGameLoop(game)

	return game
}
