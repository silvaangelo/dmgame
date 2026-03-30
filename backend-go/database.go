package main

import (
	"encoding/json"
	"log"
	"os"
	"sync"
	"time"
)

const (
	statsFile         = "data/stats.json"
	historyFile       = "data/history.json"
	maxHistoryEntries = 100
)

var (
	dbMu sync.RWMutex
	stats        = make(map[string]*PlayerStats)
	matchHistory []*MatchHistoryEntry

	statsSaveTimer   *time.Timer
	historySaveTimer *time.Timer
)

// initDatabase loads stats and history from disk.
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

	// KD bonus
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
