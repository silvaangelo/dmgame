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

// muzzlePosition returns the world-space muzzle point given player center and aim direction.
func muzzlePosition(px, py, dirX, dirY float64, weapon WeaponType) (float64, float64) {
	angle := math.Atan2(dirY, dirX)
	cos := math.Cos(angle)
	sin := math.Sin(angle)
	return px + muzzleOffsetX*cos - muzzleOffsetY*sin, py + muzzleOffsetX*sin + muzzleOffsetY*cos
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

// isPlayerMoving returns true if any movement key is pressed (CS2-style: moving = inaccurate).
func isPlayerMoving(p *Player) bool {
	return p.Keys.W || p.Keys.A || p.Keys.S || p.Keys.D
}

// applySpread adds weapon base spread + movement spread to a direction vector.
func applySpread(dirX, dirY float64, baseSpread, moveSpread float64, moving bool) (float64, float64) {
	totalSpread := baseSpread
	if moving {
		totalSpread += moveSpread
	}
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

	now := unixMs()
	moving := isPlayerMoving(player)

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
		finalDirX, finalDirY := applySpread(dirX, dirY, GameConfig.SniperBaseSpread, GameConfig.SniperMoveSpread, moving)

		mzX, mzY := muzzlePosition(player.X, player.Y, finalDirX, finalDirY, WeaponSniper)
		bullet := &Bullet{
			ID:            nextEntityID(),
			ShortID:       game.NextShortID,
			X:             mzX,
			Y:             mzY,
			DX:            finalDirX * GameConfig.SniperBulletSpeed,
			DY:            finalDirY * GameConfig.SniperBulletSpeed,
			Team:          0,
			PlayerID:      player.ID,
			Damage:        GameConfig.SniperDamage,
			Weapon:        WeaponSniper,
			CreatedAt:     now,
			ShooterMoving: moving,
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
		// Movement adds extra spread to shotgun
		spreadBase := GameConfig.ShotgunSpread
		if moving {
			spreadBase += GameConfig.ShotgunMoveSpread
		}
		for i := 0; i < pelletCount; i++ {
			spreadAngle := baseAngle + (rand.Float64()-0.5)*2*spreadBase
			pelletDirX := math.Cos(spreadAngle)
			pelletDirY := math.Sin(spreadAngle)
			speed := GameConfig.BulletSpeed * GameConfig.ShotgunBulletSpeed

			bullet := &Bullet{
				ID:            nextEntityID(),
				ShortID:       game.NextShortID,
				X:             mzX,
				Y:             mzY,
				DX:            pelletDirX * speed,
				DY:            pelletDirY * speed,
				Team:          0,
				PlayerID:      player.ID,
				Damage:        GameConfig.ShotgunDamage,
				Weapon:        WeaponShotgun,
				CreatedAt:     now,
				ShooterMoving: moving,
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

	finalDirX, finalDirY := applySpread(dirX, dirY, baseSpread, moveSpread, moving)

	// Also apply recoil on top of accuracy spread
	recoil := GameConfig.MachinegunRecoil
	recoilAngle := (rand.Float64() - 0.5) * 2 * recoil
	cos := math.Cos(recoilAngle)
	sin := math.Sin(recoilAngle)
	finalDirX, finalDirY = finalDirX*cos-finalDirY*sin, finalDirX*sin+finalDirY*cos

	mzX, mzY := muzzlePosition(player.X, player.Y, finalDirX, finalDirY, WeaponMachinegun)
	bullet := &Bullet{
		ID:            nextEntityID(),
		ShortID:       game.NextShortID,
		X:             mzX,
		Y:             mzY,
		DX:            finalDirX * GameConfig.BulletSpeed,
		DY:            finalDirY * GameConfig.BulletSpeed,
		Team:          0,
		PlayerID:      player.ID,
		Damage:        damage,
		Weapon:        WeaponMachinegun,
		CreatedAt:     now,
		ShooterMoving: moving,
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
	if player.ReloadTimer != nil {
		player.ReloadTimer.Stop()
	}
	player.ReloadTimer = time.AfterFunc(time.Duration(actualReload)*time.Millisecond, func() {
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

func reloadWeapon(player *Player) {
	if player.Reloading || player.HP <= 0 {
		return
	}
	if player.Weapon == WeaponKnife {
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
