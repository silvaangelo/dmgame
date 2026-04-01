package main

import (
	"fmt"
	"math"
	"math/rand"
	"time"
)

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
	}
	scoreboard := make([]scoreEntry, 0, len(game.Players))
	for _, p := range game.Players {
		scoreboard = append(scoreboard, scoreEntry{
			Username: p.Username,
			Kills:    p.Kills,
			Deaths:   p.Deaths,
		})
	}
	// Sort by kills desc
	for i := 0; i < len(scoreboard); i++ {
		for j := i + 1; j < len(scoreboard); j++ {
			if scoreboard[j].Kills > scoreboard[i].Kills {
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

	// Compute MVP awards
	type mvpAward struct {
		Category string `msgpack:"category"`
		Label    string `msgpack:"label"`
		Player   string `msgpack:"player"`
		Value    int    `msgpack:"value"`
	}
	mvpAwards := make([]mvpAward, 0, 4)

	var mostKillsP, longestStreakP, mostDamageP *Player
	for _, p := range game.Players {
		if mostKillsP == nil || p.Kills > mostKillsP.Kills {
			mostKillsP = p
		}
		if longestStreakP == nil || p.MaxStreak > longestStreakP.MaxStreak {
			longestStreakP = p
		}
		if mostDamageP == nil || p.TotalDamage > mostDamageP.TotalDamage {
			mostDamageP = p
		}
	}
	if mostKillsP != nil && mostKillsP.Kills > 0 {
		mvpAwards = append(mvpAwards, mvpAward{"mostKills", "Most Kills", mostKillsP.Username, mostKillsP.Kills})
	}
	if longestStreakP != nil && longestStreakP.MaxStreak >= 2 {
		mvpAwards = append(mvpAwards, mvpAward{"longestStreak", "Longest Streak", longestStreakP.Username, longestStreakP.MaxStreak})
	}
	if mostDamageP != nil && mostDamageP.TotalDamage > 0 {
		mvpAwards = append(mvpAwards, mvpAward{"mostDamage", "Most Damage", mostDamageP.Username, mostDamageP.TotalDamage})
	}

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
			"mvpAwards":    mvpAwards,
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

	// Reload map obstacles for the new round
	chosenMap := PickRandomMap()
	CurrentMapName = chosenMap.Name
	game.Obstacles = GenerateObstaclesFromMap(chosenMap)
	game.Bullets = make([]*Bullet, 0)
	game.Grenades = make([]*Grenade, 0)
	game.StateSequence = 0

	// Reset all player stats
	for _, p := range game.Players {
		p.Kills = 0
		p.Deaths = 0
		p.KillStreak = 0
		p.LastKilledBy = ""
		p.WaitingForRespawn = false
		p.HP = GameConfig.PlayerHP
		p.Shots = GameConfig.ShotsPerMag
		p.Reloading = false
		p.Weapon = WeaponMachinegun
		p.Keys = Keys{}
		p.WeaponAmmo = map[WeaponType]int{
			WeaponMachinegun: GameConfig.ShotsPerMag,
			WeaponShotgun:    GameConfig.ShotgunAmmo,
			WeaponSniper:     GameConfig.SniperAmmo,
		}

		// Reset MVP tracking
		p.TotalDamage = 0
		p.MaxStreak = 0
		p.IsUnderdog = false

		// Reset grenade cooldowns
		p.LastGrenadeTime = 0
		p.LastFlashbangTime = 0
		p.ChargingGrenade = ""
		p.ThrowingGrenade = false
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
			"id":   o.ID,
			"x":    o.X,
			"y":    o.Y,
			"size": o.Size,
			"type": o.Type,
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

	// Center-biased spawn: average of 2 randoms + blend toward center
	spawnMargin := 50.0
	centerX := GameConfig.ArenaWidth / 2
	centerY := GameConfig.ArenaHeight / 2
	spanX := GameConfig.ArenaWidth - 2*spawnMargin
	spanY := GameConfig.ArenaHeight - 2*spawnMargin

	for attempt := 0; attempt < 50; attempt++ {
		rx := (rand.Float64() + rand.Float64()) / 2
		ry := (rand.Float64() + rand.Float64()) / 2
		testX := spawnMargin + rx*spanX
		testY := spawnMargin + ry*spanY
		testX = testX*0.6 + centerX*0.4
		testY = testY*0.6 + centerY*0.4
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
	player.Weapon = WeaponMachinegun
	player.Keys = Keys{}
	player.WaitingForRespawn = false
	player.WeaponAmmo = map[WeaponType]int{
		WeaponMachinegun: GameConfig.ShotsPerMag,
		WeaponShotgun:    GameConfig.ShotgunAmmo,
		WeaponSniper:     GameConfig.SniperAmmo,
	}

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
		fmt.Printf("➖ %s left the arena (%dK/%dD)\n", player.Username, player.Kills, player.Deaths)
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

	// Remove their grenades
	filteredGrenades := make([]*Grenade, 0, len(game.Grenades))
	for _, g := range game.Grenades {
		if g.PlayerID != playerID {
			filteredGrenades = append(filteredGrenades, g)
		}
	}
	game.Grenades = filteredGrenades
}

/* ================= RESPAWN ================= */

func respawnPlayer(player *Player, game *Game) {
	player.WaitingForRespawn = false
	player.ThrowingGrenade = false
	player.ChargingGrenade = ""

	bestX := GameConfig.ArenaWidth / 2
	bestY := GameConfig.ArenaHeight / 2
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

	// Center-biased spawn: average of 2 random values tends toward center
	centerX := (spawnMinX + spawnMaxX) / 2
	centerY := (spawnMinY + spawnMaxY) / 2
	spanX := math.Max(0, spawnMaxX-spawnMinX)
	spanY := math.Max(0, spawnMaxY-spawnMinY)

	for attempt := 0; attempt < 50; attempt++ {
		rx := (rand.Float64() + rand.Float64()) / 2
		ry := (rand.Float64() + rand.Float64()) / 2
		testX := spawnMinX + rx*spanX
		testY := spawnMinY + ry*spanY
		testX = testX*0.6 + centerX*0.4
		testY = testY*0.6 + centerY*0.4

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
	player.WeaponAmmo = map[WeaponType]int{
		WeaponMachinegun: GameConfig.ShotsPerMag,
		WeaponShotgun:    GameConfig.ShotgunAmmo,
		WeaponSniper:     GameConfig.SniperAmmo,
	}

	// Push out of obstacles
	pr := GameConfig.PlayerRadius
	for _, obs := range game.Obstacles {
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
	player.X = clamp(player.X, pr, GameConfig.ArenaWidth-pr)
	player.Y = clamp(player.Y, pr, GameConfig.ArenaHeight-pr)

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
