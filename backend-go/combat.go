package main

import (
	"math"
	"math/rand"
	"time"
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

	// Mark victim as waiting for respawn (auto after 3s or manual click)
	victim.WaitingForRespawn = true
	victim.DeathTime = unixMs()

	if killer != nil && killer.ID != victim.ID {
		killer.Kills++
		killer.KillStreak++
		killer.Score += GameConfig.KillScore

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
			ID:        nextEntityID(),
			ShortID:   game.NextShortID,
			X:         orbX,
			Y:         orbY,
			CreatedAt: unixMs(),
		}
		game.NextShortID++
		game.Orbs = append(game.Orbs, orb)
	}
}

/* ================= SHOOTING ================= */

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
			ID:        nextEntityID(),
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
			speed := GameConfig.BulletSpeed * GameConfig.ShotgunBulletSpeed

			bullet := &Bullet{
				ID:        nextEntityID(),
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
		ID:        nextEntityID(),
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
