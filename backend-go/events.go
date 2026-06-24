package main

import "math/rand"

/* =====================================================================
   RANDOM EVENTS — shared orchestration

   The game has two mutually-exclusive enemy events: the Grim Reaper boss
   (reaper.go) and the Zombie Infestation horde (zombie.go). Rules:
     - At most one enemy event is active at any time.
     - Each event triggers at most once per round.
     - When an event fires, the type is chosen uniformly at random among the
       events that have not yet happened this round (equal chance).
     - While any enemy event is active, player-vs-player damage is disabled.

   The per-second roll reuses the reaper's spawn-chance tuning so both events
   share the same pacing.
   ===================================================================== */

// enemyEventActive reports whether any co-op enemy event is currently running.
// While true, players cannot damage each other (see game.go bullet loop).
func enemyEventActive(game *Game) bool {
	return game.ReaperActive || game.ZombieActive
}

// maybeRollRandomEvent performs the per-second probability check that can start
// an enemy event. The longer the round runs, the more likely a spawn becomes.
// When it fires, one of the still-available events is chosen at random.
// Caller must hold game.mu.
func maybeRollRandomEvent(game *Game, elapsed int64) {
	if game.RoundEnded || enemyEventActive(game) {
		return
	}
	if elapsed < GameConfig.ReaperMinMatchTime {
		return
	}
	if aliveCount(game) < GameConfig.ReaperMinPlayers {
		return
	}

	// Collect the events that have not yet happened this round.
	available := make([]string, 0, 2)
	if !game.ReaperDoneThisRound {
		available = append(available, "reaper")
	}
	if !game.ZombieDoneThisRound {
		available = append(available, "zombie")
	}
	if len(available) == 0 {
		return
	}

	secondsPast := float64(elapsed-GameConfig.ReaperMinMatchTime) / 1000.0
	chance := GameConfig.ReaperSpawnChanceBase + secondsPast*GameConfig.ReaperSpawnChanceRamp
	if chance > GameConfig.ReaperSpawnChanceMax {
		chance = GameConfig.ReaperSpawnChanceMax
	}
	if rand.Float64() >= chance {
		return
	}

	// Equal chance among the available events.
	switch available[rand.Intn(len(available))] {
	case "reaper":
		spawnReaper(game)
	case "zombie":
		spawnZombies(game)
	}
}
