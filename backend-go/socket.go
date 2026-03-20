package main

import (
	"fmt"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins
	},
	EnableCompression: true,
}

// startHeartbeat pings all connected players every 15s.
// Writes go through each player's ConnMu to avoid concurrent-write panics.
func startHeartbeat() {
	const interval = 15 * time.Second
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			allPlayersMu.RLock()
			tps := make([]*TrackedPlayer, 0, len(allPlayers))
			for _, tp := range allPlayers {
				tps = append(tps, tp)
			}
			allPlayersMu.RUnlock()

			for _, tp := range tps {
				tp.ConnMu.Lock()
				if tp.Conn != nil {
					_ = tp.Conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
					_ = tp.Conn.WriteMessage(websocket.PingMessage, nil)
				}
				tp.ConnMu.Unlock()
			}
		}
	}()
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Printf("⚠️ WebSocket upgrade error: %v\n", err)
		return
	}

	// Check capacity
	allPlayersMu.RLock()
	currentCount := len(allPlayers)
	allPlayersMu.RUnlock()
	if currentCount >= 200 {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "Server is full"))
		conn.Close()
		return
	}

	// Setup pong handler
	conn.SetReadLimit(1024)
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		return nil
	})

	// Send initial online count
	allPlayersMu.RLock()
	count := len(allPlayers)
	allPlayersMu.RUnlock()
	initMsg, _ := Serialize(map[string]interface{}{
		"type":  "onlineCount",
		"count": count,
	})
	conn.WriteMessage(websocket.BinaryMessage, initMsg)

	var player *Player
	var playerMu sync.Mutex // protects local player pointer

	// Cleanup on disconnect
	defer func() {
		playerMu.Lock()
		p := player
		playerMu.Unlock()

		if p != nil {
			fmt.Printf("👋 %s disconnected\n", p.Username)

			allPlayersMu.Lock()
			delete(allPlayers, p.ID)
			allPlayersMu.Unlock()

			debouncedBroadcastOnlineList()

			game := getPersistentGame()
			if game != nil {
				game.mu.Lock()
				removePlayerFromGame(p.ID, game)
				game.mu.Unlock()

				broadcast(game, map[string]interface{}{
					"type":     "playerDisconnected",
					"username": p.Username,
					"playerId": p.ID,
				})
			}

			broadcastOnlineList()
		}

		conn.Close()
	}()

	// Read loop
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		m, err := Deserialize(msg)
		if err != nil {
			continue
		}
		msgType := safeString(m, "type", "")
		if msgType == "" {
			continue
		}

		/* ================= RATE LIMITING ================= */
		playerMu.Lock()
		p := player
		playerMu.Unlock()

		if p != nil {
			now := unixMs()
			if now-p.MsgWindowStart > 1000 {
				p.MsgCount = 0
				p.MsgWindowStart = now
			}
			p.MsgCount++
			if p.MsgCount > 300 {
				p.Violations++
				if p.Violations >= 10 {
					fmt.Printf("🚫 Kicked %s for message flooding\n", p.Username)
					p.ConnMu.Lock()
					conn.WriteMessage(websocket.CloseMessage,
						websocket.FormatCloseMessage(4001, "Rate limit exceeded"))
					p.ConnMu.Unlock()
					break
				}
				continue
			}
		}

		/* ================= JOIN ================= */
		if msgType == "join" {
			playerMu.Lock()
			if player != nil {
				playerMu.Unlock()
				continue
			}
			playerMu.Unlock()

			username := strings.TrimSpace(safeString(m, "username", ""))
			if len(username) < GameConfig.UsernameMinLen ||
				len(username) > GameConfig.UsernameMaxLen ||
				!GameConfig.UsernamePattern.MatchString(username) {
				errMsg, _ := Serialize(map[string]interface{}{
					"type":    "error",
					"message": fmt.Sprintf("Username must be %d-%d characters (letters, numbers, _).", GameConfig.UsernameMinLen, GameConfig.UsernameMaxLen),
				})
				conn.WriteMessage(websocket.BinaryMessage, errMsg)
				continue
			}

			// Check duplicate username
			allPlayersMu.RLock()
			taken := false
			for _, tp := range allPlayers {
				if strings.EqualFold(tp.Username, username) {
					taken = true
					break
				}
			}
			allPlayersMu.RUnlock()

			if taken {
				errMsg, _ := Serialize(map[string]interface{}{
					"type":    "error",
					"message": "Name already in use.",
				})
				conn.WriteMessage(websocket.BinaryMessage, errMsg)
				continue
			}

			game := getPersistentGame()
			if game == nil {
				errMsg, _ := Serialize(map[string]interface{}{
					"type":    "error",
					"message": "Server starting up...",
				})
				conn.WriteMessage(websocket.BinaryMessage, errMsg)
				continue
			}

			skinVal := safeInt(m, "skin", 0)
			now := unixMs()

			game.mu.Lock()

			newPlayer := &Player{
				ID:       uuid.New().String(),
				ShortID:  game.NextShortID,
				Username: username,
				Conn:     conn,
				Team:     0,
				X:        0,
				Y:        0,
				HP:       GameConfig.PlayerHP,
				Shots:    GameConfig.ShotsPerMag,
				Reloading: false,
				LastShotTime:     0,
				Keys:             Keys{},
				LastProcessedInput: 0,
				Kills:  0,
				Deaths: 0,
				Score:  0,
				Ready:  true,
				AimAngle: 0,
				Weapon:   WeaponMachinegun,
				Skin:     skinVal,

				SpeedBoostUntil: 0,
				MinigunUntil:    0,
				KillStreak:      0,
				LastKilledBy:    "",
				ShieldUntil:     0,
				InvisibleUntil:  0,
				RegenUntil:      0,
				LastRegenTick:   0,
				Armor:           0,

				DashCooldownUntil: 0,
				DashUntil:         0,
				DashDirX:          0,
				DashDirY:          0,

				WaitingForRespawn: false,
				MsgCount:          0,
				MsgWindowStart:    now,
				Violations:        0,
				LastWeaponSwitch:  0,
			}
			game.NextShortID++

			// Add to allPlayers
			allPlayersMu.Lock()
			allPlayers[newPlayer.ID] = &TrackedPlayer{
				ID:       newPlayer.ID,
				Username: newPlayer.Username,
				Status:   "in-game",
				Conn:     conn,
				ConnMu:   &newPlayer.ConnMu,
			}
			allPlayersMu.Unlock()

			debouncedBroadcastOnlineList()

			addPlayerToGame(newPlayer, game)

			// Build shortIdMap
			shortIdMap := make(map[string]interface{})
			for _, gp := range game.Players {
				shortIdMap[fmt.Sprintf("%d", gp.ShortID)] = map[string]interface{}{
					"id":       gp.ID,
					"username": gp.Username,
				}
			}

			elapsed := now - game.MatchStartTime
			roundDurationMs := int64(GameConfig.RoundDuration) * 1000
			timerRemaining := int((roundDurationMs - elapsed) / 1000)
			if timerRemaining < 0 {
				timerRemaining = 0
			}

			joinedMsg, _ := Serialize(map[string]interface{}{
				"type":        "gameJoined",
				"playerId":    newPlayer.ID,
				"shortId":     newPlayer.ShortID,
				"username":    username,
				"players":     serializePlayers(game),
				"obstacles":   serializeObstacles(game.Obstacles),
				"orbs":        serializeOrbs(game.Orbs),
				"arenaWidth":  GameConfig.ArenaWidth,
				"arenaHeight": GameConfig.ArenaHeight,
				"maxHp":       GameConfig.PlayerHP,
				"shortIdMap":  shortIdMap,
				"timerRemaining": timerRemaining,
			})

			game.mu.Unlock()

			// Send to the joining player
			newPlayer.ConnMu.Lock()
			conn.WriteMessage(websocket.BinaryMessage, joinedMsg)
			newPlayer.ConnMu.Unlock()

			// Notify others
			broadcast(game, map[string]interface{}{
				"type":     "playerJoined",
				"username": newPlayer.Username,
				"playerId": newPlayer.ID,
				"shortId":  newPlayer.ShortID,
			})

			broadcastOnlineList()

			playerMu.Lock()
			player = newPlayer
			playerMu.Unlock()

			continue
		}

		/* ================= REQUIRE PLAYER ================= */
		if p == nil {
			continue
		}

		game := getPersistentGame()
		if game == nil {
			continue
		}

		/* ================= IN-GAME ACTIONS ================= */

		switch msgType {
		case "chat":
			chatMsg := strings.TrimSpace(safeString(m, "message", ""))
			if len(chatMsg) > 100 {
				chatMsg = chatMsg[:100]
			}
			if chatMsg == "" {
				continue
			}
			broadcast(game, map[string]interface{}{
				"type":     "chatMessage",
				"username": p.Username,
				"message":  chatMsg,
			})

		case "reload":
			game.mu.Lock()
			reloadWeapon(p)
			game.mu.Unlock()

		case "dash":
			game.mu.Lock()
			performDash(p)
			game.mu.Unlock()

		case "requestRespawn":
			game.mu.Lock()
			requestRespawn(p, game)
			game.mu.Unlock()

		case "selectSkin":
			skinIndex := safeInt(m, "skin", -1)
			if skinIndex >= 0 && skinIndex <= 7 {
				p.Skin = skinIndex
			}

		case "keydown":
			key := safeString(m, "key", "")
			seq := safeInt(m, "sequence", 0)
			switch key {
			case "w":
				p.Keys.W = true
			case "a":
				p.Keys.A = true
			case "s":
				p.Keys.S = true
			case "d":
				p.Keys.D = true
			}
			p.LastProcessedInput = seq

		case "keyup":
			key := safeString(m, "key", "")
			seq := safeInt(m, "sequence", 0)
			switch key {
			case "w":
				p.Keys.W = false
			case "a":
				p.Keys.A = false
			case "s":
				p.Keys.S = false
			case "d":
				p.Keys.D = false
			}
			p.LastProcessedInput = seq

		case "shoot":
			dirX := safeFloat(m, "dirX", 0)
			dirY := safeFloat(m, "dirY", -1)
			mag := math.Sqrt(dirX*dirX + dirY*dirY)
			if mag > 0.001 {
				dirX /= mag
				dirY /= mag
			} else {
				dirX = 0
				dirY = -1
			}
			game.mu.Lock()
			shoot(p, game, dirX, dirY)
			game.mu.Unlock()

		case "aim":
			angle := safeFloat(m, "aimAngle", 0)
			if !math.IsNaN(angle) && !math.IsInf(angle, 0) {
				p.AimAngle = angle
			}

		case "switchWeapon":
			now := unixMs()
			if now-p.LastWeaponSwitch < 250 {
				continue
			}
			p.LastWeaponSwitch = now

			requestedWeapon := WeaponType(safeString(m, "weapon", ""))
			if requestedWeapon != "" {
				// Check if the requested weapon is in the cycle
				found := false
				for _, w := range WeaponCycle {
					if w == requestedWeapon {
						found = true
						break
					}
				}
				if found {
					p.Weapon = requestedWeapon
				}
			} else {
				// Cycle to next weapon
				currentIdx := -1
				for i, w := range WeaponCycle {
					if w == p.Weapon {
						currentIdx = i
						break
					}
				}
				if currentIdx >= 0 {
					p.Weapon = WeaponCycle[(currentIdx+1)%len(WeaponCycle)]
				} else {
					p.Weapon = WeaponCycle[0]
				}
			}

			// Clamp ammo to new weapon's max
			var maxAmmo int
			switch p.Weapon {
			case WeaponShotgun:
				maxAmmo = GameConfig.ShotgunAmmo
			case WeaponSniper:
				maxAmmo = GameConfig.SniperAmmo
			default:
				maxAmmo = GameConfig.ShotsPerMag
			}
			if p.Shots > maxAmmo {
				p.Shots = maxAmmo
			}
		}
	}
}


