package main

import (
	"fmt"
	"log"
	"math"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// globalEntityID provides a fast, lock-free incrementing ID for all entities.
// Replaces uuid.New().String() to eliminate crypto/rand overhead (35 Hz × N entities).
var globalEntityID atomic.Uint64

// nextEntityID returns a unique string ID like "e1", "e2", etc.
func nextEntityID() string {
	return "e" + strconv.FormatUint(globalEntityID.Add(1), 10)
}

// unixMs returns the current time in milliseconds.
func unixMs() int64 {
	return time.Now().UnixMilli()
}

// broadcast sends a msgpack message to all players in a game.
func broadcast(game *Game, msg interface{}) {
	data, err := Serialize(msg)
	if err != nil {
		log.Printf("broadcast serialize error: %v", err)
		return
	}
	for _, p := range game.Players {
		sendRaw(p, data)
	}
}

// sendMsg sends a msgpack-encoded message to a single player.
func sendMsg(p *Player, msg interface{}) {
	data, err := Serialize(msg)
	if err != nil {
		log.Printf("sendMsg serialize error: %v", err)
		return
	}
	sendRaw(p, data)
}

// sendRaw sends pre-encoded bytes to a player's WebSocket.
func sendRaw(p *Player, data []byte) {
	p.ConnMu.Lock()
	defer p.ConnMu.Unlock()
	if p.Conn == nil {
		return
	}
	_ = p.Conn.SetWriteDeadline(time.Now().Add(10 * time.Millisecond))
	if err := p.Conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
		// Connection likely closed, will be cleaned up by read loop
	}
}

// sendBinary sends raw binary data to a player's WebSocket.
func sendBinary(p *Player, data []byte) {
	p.ConnMu.Lock()
	defer p.ConnMu.Unlock()
	if p.Conn == nil {
		return
	}
	_ = p.Conn.SetWriteDeadline(time.Now().Add(10 * time.Millisecond))
	if err := p.Conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
		// Connection likely closed
	}
}

// serializePlayers creates an array representation of players for the "gameJoined" message.
func serializePlayers(game *Game) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(game.Players))
	for _, p := range game.Players {
		result = append(result, map[string]interface{}{
			"id":       p.ID,
			"username": p.Username,
			"x":        p.X,
			"y":        p.Y,
			"hp":       p.HP,
			"kills":    p.Kills,
			"deaths":   p.Deaths,
			"weapon":   string(p.Weapon),
			"skin":     p.Skin,
		})
	}
	return result
}

// isPositionClear checks if a circular area is free of obstacles.
func isPositionClear(x, y float64, obstacles []*Obstacle, radius float64) bool {
	for _, o := range obstacles {
		if o.Destroyed {
			continue
		}
		// AABB vs circle check
		closestX := math.Max(o.X, math.Min(x, o.X+o.Size))
		closestY := math.Max(o.Y, math.Min(y, o.Y+o.Size))
		dx := x - closestX
		dy := y - closestY
		if dx*dx+dy*dy < radius*radius {
			return false
		}
	}
	return true
}

// isPositionClearGrid is the spatial-grid-accelerated version of isPositionClear.
// Uses O(1) grid lookups instead of iterating all obstacles.
func isPositionClearGrid(x, y float64, grid *SpatialGrid, radius float64) bool {
	nearby := grid.QueryRadius(x, y, radius+60) // 60 = max obstacle size margin
	rSq := radius * radius
	for _, e := range nearby {
		o := e.Data.(*Obstacle)
		if o.Destroyed {
			continue
		}
		closestX := math.Max(o.X, math.Min(x, o.X+o.Size))
		closestY := math.Max(o.Y, math.Min(y, o.Y+o.Size))
		dx := x - closestX
		dy := y - closestY
		if dx*dx+dy*dy < rSq {
			return false
		}
	}
	return true
}

// broadcastOnlineList sends the online player count to all connected players.
var (
	onlineListMu    sync.Mutex
	onlineListTimer *time.Timer
)

func debouncedBroadcastOnlineList() {
	onlineListMu.Lock()
	defer onlineListMu.Unlock()
	if onlineListTimer != nil {
		onlineListTimer.Stop()
	}
	onlineListTimer = time.AfterFunc(200*time.Millisecond, func() {
		broadcastOnlineList()
	})
}

func broadcastOnlineList() {
	allPlayersMu.RLock()
	count := len(allPlayers)
	allPlayersMu.RUnlock()

	msg := map[string]interface{}{
		"type":  "onlineCount",
		"count": count,
	}
	data, err := Serialize(msg)
	if err != nil {
		return
	}

	allPlayersMu.RLock()
	defer allPlayersMu.RUnlock()
	for _, tp := range allPlayers {
		tp.ConnMu.Lock()
		if tp.Conn != nil {
			_ = tp.Conn.SetWriteDeadline(time.Now().Add(50 * time.Millisecond))
			_ = tp.Conn.WriteMessage(websocket.BinaryMessage, data)
		}
		tp.ConnMu.Unlock()
	}
}

// findPlayerInGame finds a player in the game by ID.
func findPlayerInGame(game *Game, playerID string) *Player {
	for _, p := range game.Players {
		if p.ID == playerID {
			return p
		}
	}
	return nil
}

// removePlayerFromSlice removes a player from a slice by ID.
func removePlayerFromSlice(players []*Player, playerID string) []*Player {
	result := make([]*Player, 0, len(players))
	for _, p := range players {
		if p.ID != playerID {
			result = append(result, p)
		}
	}
	return result
}

// logf is a formatted logger.
func logf(format string, args ...interface{}) {
	log.Printf(format, args...)
}

// clamp restricts a value to a range.
func clamp(val, min, max float64) float64 {
	if val < min {
		return min
	}
	if val > max {
		return max
	}
	return val
}

// distance calculates Euclidean distance between two points.
func distance(x1, y1, x2, y2 float64) float64 {
	dx := x1 - x2
	dy := y1 - y2
	return math.Sqrt(dx*dx + dy*dy)
}

// formatMsg creates a message map with the given type.
func formatMsg(msgType string, fields ...interface{}) map[string]interface{} {
	msg := map[string]interface{}{
		"type": msgType,
	}
	for i := 0; i+1 < len(fields); i += 2 {
		if key, ok := fields[i].(string); ok {
			msg[key] = fields[i+1]
		}
	}
	return msg
}

// safeString returns a value from the map as string, or default.
func safeString(m map[string]interface{}, key string, def string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
}

// safeFloat returns a value from the map as float64, or default.
func safeFloat(m map[string]interface{}, key string, def float64) float64 {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return n
		case float32:
			return float64(n)
		case int64:
			return float64(n)
		case int:
			return float64(n)
		case uint64:
			return float64(n)
		case int8:
			return float64(n)
		case int16:
			return float64(n)
		case int32:
			return float64(n)
		case uint8:
			return float64(n)
		case uint16:
			return float64(n)
		case uint32:
			return float64(n)
		}
	}
	return def
}

// safeInt returns a value from the map as int, or default.
func safeInt(m map[string]interface{}, key string, def int) int {
	return int(safeFloat(m, key, float64(def)))
}

// safeBool returns a value from the map as bool, or default.
func safeBool(m map[string]interface{}, key string, def bool) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return def
}

// killStreakMessages - Portuguese kill streak messages
var killStreakMessages = []struct {
	Kills   int
	Message string
}{
	{3, "🔥 %s — Triplica! Tá pegando fogo!"},
	{5, "⚡ %s — Penta Kill! Imparável!"},
	{7, "💀 %s — Lendário! Ninguém segura!"},
	{10, "👑 %s — GODLIKE! %s é um DEUS!"},
}

func getKillStreakMessage(kills int, username string) string {
	var msg string
	for _, ks := range killStreakMessages {
		if kills >= ks.Kills {
			msg = fmt.Sprintf(ks.Message, username, username)
		}
	}
	return msg
}
