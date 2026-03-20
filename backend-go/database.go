package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	statsFile      = "data/stats.json"
	historyFile    = "data/history.json"
	usersFile      = "data/users.json"
	maxHistoryEntries = 100
)

var (
	dbMu         sync.RWMutex
	stats        = make(map[string]*PlayerStats)
	matchHistory []*MatchHistoryEntry
	users        = make(map[string]*RegisteredUser) // token -> user

	statsSaveTimer   *time.Timer
	historySaveTimer  *time.Timer
	usersSaveTimer    *time.Timer
)

// initDatabase loads stats, history, and users from disk.
func initDatabase() {
	if err := os.MkdirAll("data", 0o755); err != nil {
		log.Printf("⚠️ Failed to create data directory: %v", err)
	}

	// Load stats
	if data, err := os.ReadFile(statsFile); err == nil {
		var loaded map[string]*PlayerStats
		if err := json.Unmarshal(data, &loaded); err == nil {
			stats = loaded
			log.Printf("📊 Loaded %d player stats", len(stats))
		}
	}

	// Load history
	if data, err := os.ReadFile(historyFile); err == nil {
		if err := json.Unmarshal(data, &matchHistory); err != nil {
			matchHistory = nil
		} else {
			log.Printf("📜 Loaded %d match history entries", len(matchHistory))
		}
	}

	// Load users
	if data, err := os.ReadFile(usersFile); err == nil {
		var loaded map[string]*RegisteredUser
		if err := json.Unmarshal(data, &loaded); err == nil {
			users = loaded
			log.Printf("👤 Loaded %d registered users", len(users))
		}
	}
}

// updateStats updates or creates player stats after a game/round.
func updateStats(username string, kills, deaths int, won bool) {
	dbMu.Lock()
	defer dbMu.Unlock()

	existing, ok := stats[username]
	if !ok {
		existing = &PlayerStats{
			Username: username,
			MMR:      1000,
		}
		stats[username] = existing
	}

	existing.Kills += kills
	existing.Deaths += deaths
	existing.GamesPlayed++
	if won {
		existing.Wins++
		existing.MMR += 25
	} else {
		existing.Losses++
		existing.MMR -= 15
		if existing.MMR < 0 {
			existing.MMR = 0
		}
	}

	// KDE bonus
	kd := float64(existing.Kills)
	if existing.Deaths > 0 {
		kd = float64(existing.Kills) / float64(existing.Deaths)
	}
	existing.MMR += int(kd * 2)

	saveStats()
}

func saveStats() {
	if statsSaveTimer != nil {
		statsSaveTimer.Stop()
	}
	statsSaveTimer = time.AfterFunc(2*time.Second, func() {
		dbMu.RLock()
		data, err := json.Marshal(stats)
		dbMu.RUnlock()
		if err != nil {
			log.Printf("Failed to marshal stats: %v", err)
			return
		}
		if err := os.WriteFile(statsFile, data, 0o644); err != nil {
			log.Printf("Failed to save stats: %v", err)
		}
	})
}

// getLeaderboard returns the top players by MMR.
func getLeaderboard(limit int) []*PlayerStats {
	dbMu.RLock()
	defer dbMu.RUnlock()

	all := make([]*PlayerStats, 0, len(stats))
	for _, s := range stats {
		all = append(all, s)
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].MMR > all[j].MMR
	})
	if len(all) > limit {
		all = all[:limit]
	}
	return all
}

func saveHistory() {
	if historySaveTimer != nil {
		historySaveTimer.Stop()
	}
	historySaveTimer = time.AfterFunc(2*time.Second, func() {
		dbMu.RLock()
		data, err := json.Marshal(matchHistory)
		dbMu.RUnlock()
		if err != nil {
			log.Printf("Failed to marshal history: %v", err)
			return
		}
		if err := os.WriteFile(historyFile, data, 0o644); err != nil {
			log.Printf("Failed to save history: %v", err)
		}
	})
}

// addMatchHistory adds a match history entry.
func addMatchHistory(entry *MatchHistoryEntry) {
	dbMu.Lock()
	defer dbMu.Unlock()

	matchHistory = append([]*MatchHistoryEntry{entry}, matchHistory...)
	if len(matchHistory) > maxHistoryEntries {
		matchHistory = matchHistory[:maxHistoryEntries]
	}
	saveHistory()
}

// getMatchHistory returns match history for a specific player.
func getMatchHistory(username string, limit int) []*MatchHistoryEntry {
	dbMu.RLock()
	defer dbMu.RUnlock()

	var result []*MatchHistoryEntry
	for _, entry := range matchHistory {
		for _, p := range entry.Players {
			if p.Username == username {
				result = append(result, entry)
				break
			}
		}
		if len(result) >= limit {
			break
		}
	}
	return result
}

/* ================= USER REGISTRATION ================= */

func saveUsers() {
	if usersSaveTimer != nil {
		usersSaveTimer.Stop()
	}
	usersSaveTimer = time.AfterFunc(2*time.Second, func() {
		dbMu.RLock()
		data, err := json.Marshal(users)
		dbMu.RUnlock()
		if err != nil {
			log.Printf("Failed to marshal users: %v", err)
			return
		}
		if err := os.WriteFile(usersFile, data, 0o644); err != nil {
			log.Printf("Failed to save users: %v", err)
		}
	})
}

func generateToken(username string) string {
	h := sha256.New()
	h.Write([]byte(username + fmt.Sprintf("%d", time.Now().UnixNano())))
	return fmt.Sprintf("%x", h.Sum(nil))
}

// registerUser creates a new user account if the username isn't taken.
func registerUser(username string) *RegisteredUser {
	dbMu.Lock()
	defer dbMu.Unlock()

	// Check if username already exists
	lowerUsername := strings.ToLower(username)
	for _, user := range users {
		if strings.ToLower(user.Username) == lowerUsername {
			return nil // Username taken
		}
	}

	token := generateToken(username)
	user := &RegisteredUser{
		Username:  username,
		Token:     token,
		CreatedAt: time.Now().UnixMilli(),
		LastSeen:  time.Now().UnixMilli(),
	}
	users[token] = user
	saveUsers()
	log.Printf("👤 Registered new user: %s", username)
	return user
}

// getUserByToken retrieves a user by their token.
func getUserByToken(token string) *RegisteredUser {
	dbMu.RLock()
	defer dbMu.RUnlock()
	return users[token]
}
