package main

import (
	"math"
	"math/rand"
)

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

	types := []PickupType{PickupHealth, PickupAmmo, PickupSpeed, PickupShield, PickupInvisibility, PickupRegen, PickupArmor}
	ptype := types[rand.Intn(len(types))]

	var pickupX, pickupY float64
	validPosition := false
	for attempts := 0; attempts < 20; attempts++ {
		pickupX = 60 + rand.Float64()*(GameConfig.ArenaWidth-120)
		pickupY = 60 + rand.Float64()*(GameConfig.ArenaHeight-120)

		if !isPositionClearGrid(pickupX, pickupY, globalObstacleGrid, GameConfig.PickupRadius*2) {
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
			ID:        nextEntityID(),
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
			if isPositionClearGrid(orbX, orbY, globalObstacleGrid, GameConfig.OrbRadius) {
				validPosition = true
				break
			}
		}

		if validPosition {
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
	types := []PickupType{PickupHealth, PickupAmmo, PickupSpeed, PickupShield, PickupInvisibility, PickupRegen, PickupArmor}
	ptype := types[rand.Intn(len(types))]
	pickup := &Pickup{
		ID:        nextEntityID(),
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

		if !isPositionClearGrid(crateX, crateY, globalObstacleGrid, GameConfig.LootCrateSize) {
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
			ID:        nextEntityID(),
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

/* ================= BOMBS ================= */

func spawnBomb(game *Game) {
	count := 1 + rand.Intn(2) // 1-2
	for i := 0; i < count; i++ {
		var bombX, bombY float64
		validPosition := false
		for attempts := 0; attempts < 20; attempts++ {
			bombX = 60 + rand.Float64()*(GameConfig.ArenaWidth-120)
			bombY = 60 + rand.Float64()*(GameConfig.ArenaHeight-120)
			if isPositionClearGrid(bombX, bombY, globalObstacleGrid, 20) {
				validPosition = true
				break
			}
		}

		if validPosition {
			bomb := &Bomb{
				ID:        nextEntityID(),
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
		if isPositionClearGrid(lightningX, lightningY, globalObstacleGrid, 20) {
			validPosition = true
			break
		}
	}

	if validPosition {
		lightning := &Lightning{
			ID:        nextEntityID(),
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
			ID:        nextEntityID(),
			X:         obstX,
			Y:         obstY,
			Size:      size,
			Destroyed: false,
			Type:      obsType,
		}
		game.Obstacles = append(game.Obstacles, newObs)

		broadcast(game, map[string]interface{}{
			"type": "newObstacle",
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

/* ================= OBSTACLE GENERATION ================= */

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

			gID := nextEntityID()
			for j := 0; j < wallLength; j++ {
				ox := startX
				oy := startY
				if isHorizontal {
					ox = startX + float64(j)*blockSize
				} else {
					oy = startY + float64(j)*blockSize
				}
				obstacles = append(obstacles, &Obstacle{
					ID:        nextEntityID(),
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
				ID:        nextEntityID(),
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
