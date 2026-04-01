package main

import (
	"math"
	"math/rand"
	"time"
)

/* ================= MUZZLE OFFSET ================= */

// Muzzle offsets in sprite-local coords (x=forward along gun, y=perpendicular).
// Derived from source sprite 283×160 rendered at 70×39.6, draw origin at (-24.5, -19.8).
// All weapons share the same muzzle pixel: (272, 118).
const (
	muzzleOffsetX = 42.8
	muzzleOffsetY = 9.4
)

/* ================= HEAD POSITION ================= */

// Head position offsets in sprite-local coords per weapon.
// Sprite pixel coords: sniper (67,88), shotgun (78,87), rifle (78,87).
// Conversion: localX = SPRITE_DRAW_OX + px * SPRITE_SCALE_X, localY = SPRITE_DRAW_OY + py * SPRITE_SCALE_Y
// SPRITE_DRAW_OX = -24.5, SPRITE_DRAW_OY = -19.788, SCALE_X = 70/283 ≈ 0.24735, SCALE_Y = 39.575/160 ≈ 0.24735
var headOffsets = map[WeaponType][2]float64{
	"machinegun": {-24.5 + 78*0.24735, -19.788 + 87*0.24735},  // rifle: (-5.21, 1.72)
	"shotgun":    {-24.5 + 78*0.24735, -19.788 + 87*0.24735},  // shotgun: same
	"sniper":     {-24.5 + 67*0.24735, -19.788 + 88*0.24735},  // sniper: (-7.93, 1.98)
}

const headHitRadius = 5.0 // 5px radius around head center counts as headshot

// headWorldPosition returns the world-space head point for a player.
func headWorldPosition(px, py, aimAngle float64, weapon WeaponType) (float64, float64) {
	ho, ok := headOffsets[weapon]
	if !ok {
		ho = headOffsets["machinegun"]
	}
	cos := math.Cos(aimAngle)
	sin := math.Sin(aimAngle)
	return px + ho[0]*cos - ho[1]*sin, py + ho[0]*sin + ho[1]*cos
}

// muzzlePosition returns the world-space muzzle point given player center and aim direction.
func muzzlePosition(px, py, dirX, dirY float64, weapon WeaponType) (float64, float64) {
	angle := math.Atan2(dirY, dirX)
	cos := math.Cos(angle)
	sin := math.Sin(angle)
	return px + muzzleOffsetX*cos - muzzleOffsetY*sin, py + muzzleOffsetX*sin + muzzleOffsetY*cos
}

// muzzleBlockedByWall checks whether any obstacle sits between the player
// center (px,py) and the computed muzzle point (mx,my). It steps along the
// line in small increments and queries the spatial grid at each point.
func muzzleBlockedByWall(px, py, mx, my float64) bool {
	dx := mx - px
	dy := my - py
	dist := math.Sqrt(dx*dx + dy*dy)
	if dist < 1 {
		return false
	}
	// Step in increments smaller than the smallest obstacle (BlockSize=40)
	stepSize := 10.0
	steps := int(math.Ceil(dist / stepSize))
	for i := 1; i <= steps; i++ {
		t := float64(i) / float64(steps)
		sx := px + dx*t
		sy := py + dy*t
		nearby := globalObstacleGrid.QueryRadius(sx, sy, 60)
		for _, e := range nearby {
			o := e.Data.(*Obstacle)
			if sx >= o.X && sx <= o.X+o.Size && sy >= o.Y && sy <= o.Y+o.Size {
				return true
			}
		}
	}
	return false
}

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

func handleKill(killer *Player, victim *Player, weapon string, game *Game, isHeadshot bool) {
	victim.Deaths++
	victim.KillStreak = 0

	// Mark victim as waiting for respawn (auto after 3s or manual click)
	victim.WaitingForRespawn = true
	victim.DeathTime = unixMs()

	if killer != nil && killer.ID != victim.ID {
		killer.Kills++
		killer.KillStreak++

		// Track max streak for MVP
		if killer.KillStreak > killer.MaxStreak {
			killer.MaxStreak = killer.KillStreak
		}

		// Heal on kill — restore half of max HP
		maxHP := GameConfig.PlayerHP
		killer.HP = min(maxHP, killer.HP+(maxHP+1)/2)

		// Revenge tracking
		isRevenge := victim.LastKilledBy != "" && killer.LastKilledBy == victim.ID

		broadcast(game, map[string]interface{}{
			"type":       "kill",
			"killer":     killer.Username,
			"victim":     victim.Username,
			"weapon":     weapon,
			"isRevenge":  isRevenge,
			"isHeadshot": isHeadshot,
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
			"type":       "kill",
			"killer":     killerName,
			"victim":     victim.Username,
			"weapon":     weapon,
			"isRevenge":  false,
			"isHeadshot": isHeadshot,
		})
	}
}

/* ================= SHOOTING ================= */

// playerSpeed returns the current speed of a player from their velocity.
func playerSpeed(p *Player) float64 {
	return math.Sqrt(p.VX*p.VX + p.VY*p.VY)
}

// isPlayerMoving returns true if the player has meaningful velocity.
func isPlayerMoving(p *Player) bool {
	return playerSpeed(p) > 0.5
}

// isCounterStrafing returns true if the player is in a counter-strafe window.
func isCounterStrafing(p *Player) bool {
	return p.CounterStrafeX > 0 || p.CounterStrafeY > 0
}

// Machinegun spray pattern (deterministic recoil offsets in radians)
var machinegunSprayPattern = []float64{
	0, 0.012, 0.025, 0.04, 0.06, 0.05, 0.03, 0.01,
	-0.02, -0.04, -0.03, -0.01,
}

// applySpread adds weapon base spread + velocity-scaled movement spread to a direction vector.
// Counter-strafing grants standing accuracy; crouching reduces spread.
func applySpread(dirX, dirY float64, baseSpread, moveSpread float64, player *Player) (float64, float64) {
	speedRatio := playerSpeed(player) / GameConfig.PlayerSpeed
	if speedRatio > 1.0 {
		speedRatio = 1.0
	}
	// Counter-strafing: treat as standing for spread purposes
	if isCounterStrafing(player) {
		speedRatio = 0
	}
	// Crouching reduces spread
	crouchMult := 1.0
	if player.Crouching {
		crouchMult = GameConfig.CrouchSpreadMult
	}
	totalSpread := (baseSpread + moveSpread*speedRatio) * crouchMult
	if totalSpread > 0 {
		spreadAngle := (rand.Float64() - 0.5) * 2 * totalSpread
		cos := math.Cos(spreadAngle)
		sin := math.Sin(spreadAngle)
		return dirX*cos - dirY*sin, dirX*sin + dirY*cos
	}
	return dirX, dirY
}

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

	// Ensure WeaponAmmo map exists
	if player.WeaponAmmo == nil {
		player.WeaponAmmo = make(map[WeaponType]int)
	}

	now := unixMs()

	// Reset spray pattern after 300ms of no shots
	if now-player.LastSprayReset > 300 {
		player.SprayIndex = 0
	}

	// Sniper (AWP-like: extremely accurate when still, terrible when moving)
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

		// Apply accuracy (CS2: sniper is pinpoint when still, very inaccurate when moving)
		finalDirX, finalDirY := applySpread(dirX, dirY, GameConfig.SniperBaseSpread, GameConfig.SniperMoveSpread, player)

		mzX, mzY := muzzlePosition(player.X, player.Y, finalDirX, finalDirY, WeaponSniper)
		// Block shot if muzzle is inside/behind a wall
		if muzzleBlockedByWall(player.X, player.Y, mzX, mzY) {
			// Refund the shot
			player.Shots++
			player.LastShotTime = 0
			if player.Reloading {
				player.Reloading = false
				if player.ReloadTimer != nil {
					player.ReloadTimer.Stop()
				}
			}
			return
		}
		bullet := &Bullet{
			ID:        nextEntityID(),
			ShortID:   game.NextShortID,
			X:         mzX,
			Y:         mzY,
			DX:        finalDirX * GameConfig.SniperBulletSpeed,
			DY:        finalDirY * GameConfig.SniperBulletSpeed,
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

	// Shotgun fires multiple pellets (CS2-style: tighter spread when still)
	if player.Weapon == WeaponShotgun {
		pelletCount := GameConfig.ShotgunPellets
		baseAngle := math.Atan2(dirY, dirX)
		mzX, mzY := muzzlePosition(player.X, player.Y, dirX, dirY, WeaponShotgun)
		// Block shot if muzzle is inside/behind a wall
		if muzzleBlockedByWall(player.X, player.Y, mzX, mzY) {
			player.Shots++
			player.LastShotTime = 0
			if player.Reloading {
				player.Reloading = false
				if player.ReloadTimer != nil {
					player.ReloadTimer.Stop()
				}
			}
			return
		}
		// Movement adds extra spread to shotgun (velocity-scaled)
		speedRatio := playerSpeed(player) / GameConfig.PlayerSpeed
		if isCounterStrafing(player) {
			speedRatio = 0
		}
		spreadBase := GameConfig.ShotgunSpread + GameConfig.ShotgunMoveSpread*speedRatio
		if player.Crouching {
			spreadBase *= GameConfig.CrouchSpreadMult
		}
		for i := 0; i < pelletCount; i++ {
			spreadAngle := baseAngle + (rand.Float64()-0.5)*2*spreadBase
			pelletDirX := math.Cos(spreadAngle)
			pelletDirY := math.Sin(spreadAngle)
			speed := GameConfig.BulletSpeed * GameConfig.ShotgunBulletSpeed

			bullet := &Bullet{
					ID:        nextEntityID(),
					ShortID:   game.NextShortID,
					X:         mzX,
					Y:         mzY,
					DX:        pelletDirX * speed,
					DY:        pelletDirY * speed,
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

	// Machine gun — apply CS2-style accuracy
	var baseSpread, moveSpread float64
	var damage int
	baseSpread = GameConfig.MachinegunBaseSpread
	moveSpread = GameConfig.MachinegunMoveSpread
	damage = GameConfig.MachinegunDamage

	finalDirX, finalDirY := applySpread(dirX, dirY, baseSpread, moveSpread, player)

	// Also apply recoil on top of accuracy spread
	recoil := GameConfig.MachinegunRecoil
	recoilAngle := (rand.Float64() - 0.5) * 2 * recoil
	cos := math.Cos(recoilAngle)
	sin := math.Sin(recoilAngle)
	finalDirX, finalDirY = finalDirX*cos-finalDirY*sin, finalDirX*sin+finalDirY*cos

	// Spray pattern: deterministic recoil offset based on consecutive shots
	if player.SprayIndex < len(machinegunSprayPattern) {
		patternAngle := machinegunSprayPattern[player.SprayIndex]
		pCos := math.Cos(patternAngle)
		pSin := math.Sin(patternAngle)
		finalDirX, finalDirY = finalDirX*pCos-finalDirY*pSin, finalDirX*pSin+finalDirY*pCos
	}
	player.SprayIndex++
	player.LastSprayReset = now

	mzX, mzY := muzzlePosition(player.X, player.Y, finalDirX, finalDirY, WeaponMachinegun)
	// Block shot if muzzle is inside/behind a wall
	if muzzleBlockedByWall(player.X, player.Y, mzX, mzY) {
		player.Shots++
		player.LastShotTime = 0
		if player.Reloading {
			player.Reloading = false
			if player.ReloadTimer != nil {
				player.ReloadTimer.Stop()
			}
		}
		return
	}
	bullet := &Bullet{
		ID:        nextEntityID(),
		ShortID:   game.NextShortID,
		X:         mzX,
		Y:         mzY,
		DX:        finalDirX * GameConfig.BulletSpeed,
		DY:        finalDirY * GameConfig.BulletSpeed,
		PlayerID:  player.ID,
		Damage:    damage,
		Weapon:    WeaponMachinegun,
		CreatedAt: now,
	}
	game.NextShortID++
	game.Bullets = append(game.Bullets, bullet)
}

/* ================= RELOAD ================= */

// startReload begins a timed reload using a goroutine.
func startReload(player *Player, reloadTimeMs int64, refillAmount int) {
	// Comeback mechanic: underdog gets 20% faster reload
	actualReload := reloadTimeMs
	if player.IsUnderdog {
		actualReload = int64(float64(reloadTimeMs) * 0.8)
	}
	player.Reloading = true
	player.ReloadingWeapon = player.Weapon
	if player.ReloadTimer != nil {
		player.ReloadTimer.Stop()
	}
	reloadWeapon := player.Weapon
	player.ReloadTimer = time.AfterFunc(time.Duration(actualReload)*time.Millisecond, func() {
		game := getPersistentGame()
		if game == nil {
			return
		}
		game.mu.Lock()
		defer game.mu.Unlock()
		// Only apply reload if player still has the same weapon
		if player.Weapon == reloadWeapon {
			player.Shots = refillAmount
			player.Reloading = false
		}
		// Always update the WeaponAmmo for the weapon that was reloading
		if player.WeaponAmmo == nil {
			player.WeaponAmmo = make(map[WeaponType]int)
		}
		player.WeaponAmmo[reloadWeapon] = refillAmount
	})
}

func reloadWeapon(player *Player) {
	if player.Reloading || player.HP <= 0 {
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

/* ================= GRENADES ================= */

// throwGrenade creates a grenade/flashbang and adds it to the game.
// chargeMs is how long the player held the key (determines fuse/distance).
func throwGrenade(player *Player, game *Game, grenadeType GrenadeType, chargeMs int64) {
	if game.RoundEnded || player.HP <= 0 {
		return
	}

	now := unixMs()

	// Check cooldown
	switch grenadeType {
	case GrenadeHE:
		if now-player.LastGrenadeTime < GameConfig.GrenadeCooldown {
			return
		}
		player.LastGrenadeTime = now
	case GrenadeFlash:
		if now-player.LastFlashbangTime < GameConfig.GrenadeCooldown {
			return
		}
		player.LastFlashbangTime = now
	}

	// Mark player as throwing (for visual indicator, auto-clears after 500ms)
	player.ThrowingGrenade = true
	player.ThrowingGrenadeType = grenadeType
	player.ThrowStartTime = now

	// Clamp charge time: min 100ms, max 1500ms
	if chargeMs < 100 {
		chargeMs = 100
	}
	if chargeMs > 1500 {
		chargeMs = 1500
	}

	// Charge ratio 0..1: longer press = farther travel (longer fuse)
	chargeRatio := float64(chargeMs) / 1500.0

	// Fuse time scales with charge: short press = short fuse (explodes near), long press = long fuse (travels far)
	fuseTime := GameConfig.GrenadeFuseMin + int64(float64(GameConfig.GrenadeFuseMax-GameConfig.GrenadeFuseMin)*chargeRatio)

	// Throw direction = player aim angle
	dirX := math.Cos(player.AimAngle)
	dirY := math.Sin(player.AimAngle)

	// Speed scales slightly with charge too
	speed := GameConfig.GrenadeSpeed * (0.6 + 0.4*chargeRatio)

	// Movement momentum: if the player is moving, add their velocity to the throw
	var moveVX, moveVY float64
	if player.Keys.A {
		moveVX -= GameConfig.PlayerSpeed
	}
	if player.Keys.D {
		moveVX += GameConfig.PlayerSpeed
	}
	if player.Keys.W {
		moveVY -= GameConfig.PlayerSpeed
	}
	if player.Keys.S {
		moveVY += GameConfig.PlayerSpeed
	}
	// Normalize diagonal movement
	if moveVX != 0 && moveVY != 0 {
		moveVX *= 0.7071
		moveVY *= 0.7071
	}
	// Add 40% of player movement velocity to grenade launch
	momentumFactor := 0.4

	grenade := &Grenade{
		ID:        nextEntityID(),
		ShortID:   game.NextShortID,
		X:         player.X + dirX*25, // start slightly in front of player
		Y:         player.Y + dirY*25,
		DX:        dirX*speed + moveVX*momentumFactor,
		DY:        dirY*speed + moveVY*momentumFactor,
		PlayerID:  player.ID,
		GType:     grenadeType,
		CreatedAt: now,
		FuseTime:  fuseTime,
		Friction:  GameConfig.GrenadeFriction,
	}
	game.NextShortID++
	game.Grenades = append(game.Grenades, grenade)

	// Broadcast throw confirmation so clients can play sounds & show visual
	gTypeStr := "grenade"
	if grenadeType == GrenadeFlash {
		gTypeStr = "flashbang"
	}
	broadcast(game, map[string]interface{}{
		"type":     "grenadeThrown",
		"playerId": player.ID,
		"username": player.Username,
		"gType":    gTypeStr,
		"x":        int(math.Round(player.X)),
		"y":        int(math.Round(player.Y)),
	})
}

// updateGrenades moves grenades, applies friction, checks collisions, and detonates expired ones.
// Returns lists of explosion events to broadcast.
func updateGrenades(game *Game, now int64) {
	if len(game.Grenades) == 0 {
		return
	}

	grenadeRemoved := make([]bool, len(game.Grenades))

	for gi, g := range game.Grenades {
		// Apply friction (deceleration)
		g.DX *= g.Friction
		g.DY *= g.Friction

		// Move
		g.X += g.DX
		g.Y += g.DY

		// Bounce off arena walls
		if g.X < 0 {
			g.X = 0
			g.DX = -g.DX * 0.5
		}
		if g.X > GameConfig.ArenaWidth {
			g.X = GameConfig.ArenaWidth
			g.DX = -g.DX * 0.5
		}
		if g.Y < 0 {
			g.Y = 0
			g.DY = -g.DY * 0.5
		}
		if g.Y > GameConfig.ArenaHeight {
			g.Y = GameConfig.ArenaHeight
			g.DY = -g.DY * 0.5
		}

		// Bounce off obstacles
		nearby := globalObstacleGrid.QueryRadius(g.X, g.Y, 60)
		for _, e := range nearby {
			o := e.Data.(*Obstacle)
			// Simple AABB collision
			closestX := clamp(g.X, o.X, o.X+o.Size)
			closestY := clamp(g.Y, o.Y, o.Y+o.Size)
			dx := g.X - closestX
			dy := g.Y - closestY
			distSq := dx*dx + dy*dy
			if distSq < 10*10 { // 10px radius for grenade
				if distSq > 0.001 {
					dist := math.Sqrt(distSq)
					// Push out
					g.X += (dx / dist) * (10 - dist)
					g.Y += (dy / dist) * (10 - dist)
					// Reflect velocity
					nx := dx / dist
					ny := dy / dist
					dot := g.DX*nx + g.DY*ny
					g.DX -= 2 * dot * nx * 0.5
					g.DY -= 2 * dot * ny * 0.5
				}
			}
		}

		// Check fuse
		if now-g.CreatedAt >= g.FuseTime {
			grenadeRemoved[gi] = true
			detonateGrenade(g, game)
		}
	}

	// Remove detonated grenades (in-place compaction)
	n := 0
	for gi, g := range game.Grenades {
		if !grenadeRemoved[gi] {
			game.Grenades[n] = g
			n++
		}
	}
	for i := n; i < len(game.Grenades); i++ {
		game.Grenades[i] = nil
	}
	game.Grenades = game.Grenades[:n]
}

// detonateGrenade handles the explosion of a grenade.
func detonateGrenade(g *Grenade, game *Game) {
	switch g.GType {
	case GrenadeHE:
		// HE grenade: damage players in radius, damage falls off with distance
		radius := GameConfig.GrenadeRadius
		for _, p := range game.Players {
			if p.HP <= 0 {
				continue
			}
			dx := p.X - g.X
			dy := p.Y - g.Y
			dist := math.Sqrt(dx*dx + dy*dy)
			if dist < radius {
				// Check line of sight (walls block grenade damage)
				if !hasLineOfSight(g.X, g.Y, p.X, p.Y, globalObstacleGrid) {
					continue
				}
				// Damage falloff: full damage at center, 20% at edge
				falloff := 1.0 - (dist/radius)*0.8
				dmg := int(float64(GameConfig.GrenadeDamage) * falloff)
				if dmg < 1 {
					dmg = 1
				}
				p.HP -= dmg

				// Track damage for MVP
				for _, shooter := range game.Players {
					if shooter.ID == g.PlayerID {
						shooter.TotalDamage += dmg
						break
					}
				}

				// Knockback away from explosion
				if dist > 1 {
					kbForce := 8.0 * falloff
					p.X += (dx / dist) * kbForce
					p.Y += (dy / dist) * kbForce
					p.X = clamp(p.X, GameConfig.PlayerRadius, GameConfig.ArenaWidth-GameConfig.PlayerRadius)
					p.Y = clamp(p.Y, GameConfig.PlayerRadius, GameConfig.ArenaHeight-GameConfig.PlayerRadius)
				}

				if p.HP <= 0 {
					p.HP = 0
					var thrower *Player
					for _, pp := range game.Players {
						if pp.ID == g.PlayerID {
							thrower = pp
							break
						}
					}
					handleKill(thrower, p, "grenade", game, false)

					// Self-kill: auto-respawn quickly (1s instead of normal 5s)
					if g.PlayerID == p.ID {
						p.DeathTime = unixMs() - GameConfig.RespawnTime + 1000
					}
				}
			}
		}

		// Broadcast HE explosion event
		broadcast(game, map[string]interface{}{
			"type": "grenadeExplosion",
			"x":    int(math.Round(g.X)),
			"y":    int(math.Round(g.Y)),
			"gType": "grenade",
		})

	case GrenadeFlash:
		// Flashbang: blind players in radius who have line of sight
		radius := GameConfig.FlashbangRadius
		for _, p := range game.Players {
			if p.HP <= 0 {
				continue
			}
			dx := p.X - g.X
			dy := p.Y - g.Y
			dist := math.Sqrt(dx*dx + dy*dy)
			if dist < radius {
				// Check line of sight
				if !hasLineOfSight(g.X, g.Y, p.X, p.Y, globalObstacleGrid) {
					continue
				}
				// Flash intensity based on distance (closer = stronger)
				intensity := 1.0 - (dist/radius)*0.7

				// Look-away reduction: facing away reduces flash effect
				aimDirX := math.Cos(p.AimAngle)
				aimDirY := math.Sin(p.AimAngle)
				toFlashX := g.X - p.X
				toFlashY := g.Y - p.Y
				toFlashDist := math.Sqrt(toFlashX*toFlashX + toFlashY*toFlashY)
				if toFlashDist > 0 {
					toFlashX /= toFlashDist
					toFlashY /= toFlashDist
				}
				dot := aimDirX*toFlashX + aimDirY*toFlashY
				// dot: 1 = facing flash, -1 = facing away
				if dot < -0.34 { // >110° away
					intensity *= 0.4
				} else if dot < 0.17 { // roughly perpendicular
					intensity *= 0.7
				}

				// Send per-player flash effect
				flashMsg, _ := Serialize(map[string]interface{}{
					"type":      "flashbangHit",
					"x":         int(math.Round(g.X)),
					"y":         int(math.Round(g.Y)),
					"intensity": intensity,
				})
				sendRaw(p, flashMsg)
			}
		}

		// Broadcast flashbang explosion event (for visual/sound effects)
		broadcast(game, map[string]interface{}{
			"type": "grenadeExplosion",
			"x":    int(math.Round(g.X)),
			"y":    int(math.Round(g.Y)),
			"gType": "flashbang",
		})
	}
}
