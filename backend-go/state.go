package main

import (
	"sync"
)

// Global mutable state
var (
	rooms   sync.Map // map[string]*Room
	games   sync.Map // map[string]*Game
	allPlayersMu sync.RWMutex
	allPlayers   = make(map[string]*TrackedPlayer)

	persistentGame   *Game
	persistentGameMu sync.RWMutex
)

func getPersistentGame() *Game {
	persistentGameMu.RLock()
	defer persistentGameMu.RUnlock()
	return persistentGame
}

func setPersistentGame(g *Game) {
	persistentGameMu.Lock()
	defer persistentGameMu.Unlock()
	persistentGame = g
}
