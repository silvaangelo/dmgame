package main

import (
	"math"
	"math/rand"
)

/* =====================================================================
   GRIM REAPER — RANDOM BOSS EVENT

   A server-controlled NPC that hunts and melees players. While active:
     - Player-vs-player damage is disabled (see game.go bullet loop).
     - Dead players do NOT respawn (see game.go auto-respawn).
   Outcomes:
     - Players kill the reaper  -> everyone who died during the event is
       revived and every still-alive player except the match leader gets +1.
     - Every player is wiped out -> the round ends as a shared game over.

   The reaper is transmitted to clients in the binary state frame
   (see protocol.go) and rendered in frontend/game.js.
   ===================================================================== */

// reaperScytheReach is how far in front of the reaper a melee swing connects,
// added on top of its body radius and the victim's radius.
const reaperScytheReach = 18.0

// aliveCount returns the number of players currently alive in the game.
func aliveCount(game *Game) int {
	n := 0
	for _, p := range game.Players {
		if p.HP > 0 {
			n++
		}
	}
	return n
}

// nearestAlivePlayer returns the closest living player to (x,y), or nil.
func nearestAlivePlayer(game *Game, x, y float64) *Player {
	var best *Player
	bestDistSq := math.Inf(1)
	for _, p := range game.Players {
		if p.HP <= 0 {
			continue
		}
		dx := p.X - x
		dy := p.Y - y
		d := dx*dx + dy*dy
		if d < bestDistSq {
			bestDistSq = d
			best = p
		}
	}
	return best
}

// maybeRollReaperSpawn is retained as a thin wrapper for spawning the reaper;
// the actual per-second roll and event selection lives in events.go
// (maybeRollRandomEvent), which keeps the two enemy events mutually exclusive.

// spawnReaper creates the boss, scaling its HP and damage to the number of
// living players, and broadcasts the spawn event. Caller must hold game.mu.
func spawnReaper(game *Game) {
	alive := aliveCount(game)
	if alive < 1 {
		return
	}

	maxHP := GameConfig.ReaperBaseHP + (alive-1)*GameConfig.ReaperHPPerPlayer
	atk := GameConfig.ReaperAttackBaseDamage + (alive-1)*GameConfig.ReaperAttackDmgPerPlr

	// Pick a spawn point clear of walls and as far as possible from players.
	bestX := GameConfig.ArenaWidth / 2
	bestY := GameConfig.ArenaHeight / 2
	bestDist := -1.0
	margin := GameConfig.ReaperRadius + 10
	for attempt := 0; attempt < 60; attempt++ {
		tx := margin + rand.Float64()*(GameConfig.ArenaWidth-2*margin)
		ty := margin + rand.Float64()*(GameConfig.ArenaHeight-2*margin)
		if !isPositionClear(tx, ty, game.Obstacles, GameConfig.ReaperRadius) {
			continue
		}
		minDist := math.Inf(1)
		for _, p := range game.Players {
			if p.HP <= 0 {
				continue
			}
			d := distance(tx, ty, p.X, p.Y)
			if d < minDist {
				minDist = d
			}
		}
		if minDist > bestDist {
			bestDist = minDist
			bestX = tx
			bestY = ty
		}
	}

	now := unixMs()
	game.Reaper = &Reaper{
		X:            bestX,
		Y:            bestY,
		HP:           maxHP,
		MaxHP:        maxHP,
		Radius:       GameConfig.ReaperRadius,
		State:        ReaperSpawning,
		StateStart:   now,
		AttackDamage: atk,
	}
	game.ReaperActive = true
	game.ReaperDoneThisRound = true

	broadcast(game, map[string]interface{}{
		"type":  "reaperSpawn",
		"x":     int(math.Round(bestX)),
		"y":     int(math.Round(bestY)),
		"maxHp": maxHP,
		"alive": alive,
	})
}

// updateReaper advances the reaper state machine for one tick. It runs whenever
// a reaper exists (including during its death animation). Caller must hold game.mu.
func updateReaper(game *Game, now int64) {
	r := game.Reaper
	if r == nil {
		return
	}

	switch r.State {
	case ReaperSpawning:
		// Telegraph / fade-in: invulnerable, stationary. Face nearest player.
		if t := nearestAlivePlayer(game, r.X, r.Y); t != nil {
			r.Facing = math.Atan2(t.Y-r.Y, t.X-r.X)
		}
		if now-r.StateStart >= GameConfig.ReaperSpawnDuration {
			r.State = ReaperChasing
			r.StateStart = now
		}
		decayReaperKnockback(r)
		applyReaperMovement(game, r, 0, 0)

	case ReaperChasing:
		// Always pursue the closest living player, re-evaluating every tick so
		// the reaper switches targets the moment someone else gets nearer.
		target := nearestAlivePlayer(game, r.X, r.Y)
		if target != nil {
			r.TargetID = target.ID
		}
		if target == nil {
			// No one left alive — the wipe check will end the event.
			decayReaperKnockback(r)
			applyReaperMovement(game, r, 0, 0)
			checkReaperWipe(game)
			return
		}

		dx := target.X - r.X
		dy := target.Y - r.Y
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist > 0.001 {
			r.Facing = math.Atan2(dy, dx)
		}

		if dist <= GameConfig.ReaperAttackRange && now-r.LastAttackTime >= GameConfig.ReaperAttackCooldown {
			// Begin a melee swing (windup telegraph).
			r.State = ReaperAttacking
			r.StateStart = now
			r.LastAttackTime = now
			broadcast(game, map[string]interface{}{
				"type":   "reaperAttack",
				"x":      int(math.Round(r.X)),
				"y":      int(math.Round(r.Y)),
				"facing": r.Facing,
			})
			decayReaperKnockback(r)
			applyReaperMovement(game, r, 0, 0)
			return
		}

		// Chase: move toward the target at full speed.
		var mvx, mvy float64
		if dist > 0.001 {
			mvx = (dx / dist) * GameConfig.ReaperSpeed
			mvy = (dy / dist) * GameConfig.ReaperSpeed
		}
		decayReaperKnockback(r)
		applyReaperMovement(game, r, mvx, mvy)

	case ReaperAttacking:
		// Planted during the windup; the strike lands at the end.
		decayReaperKnockback(r)
		applyReaperMovement(game, r, 0, 0)
		if now-r.StateStart >= GameConfig.ReaperAttackWindup {
			resolveReaperStrike(game, r, now)
			r.State = ReaperChasing
			r.StateStart = now
		}

	case ReaperDying:
		// Death animation plays out client-side; clear after the duration.
		if now-r.StateStart >= GameConfig.ReaperDeathDuration {
			game.Reaper = nil
		}
	}
}

// resolveReaperStrike applies melee damage to every living player within reach
// of the swing arc in front of the reaper.
func resolveReaperStrike(game *Game, r *Reaper, now int64) {
	reach := r.Radius + GameConfig.PlayerRadius + reaperScytheReach
	for _, p := range game.Players {
		if p.HP <= 0 {
			continue
		}
		dx := p.X - r.X
		dy := p.Y - r.Y
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist > reach {
			continue
		}
		// Require the victim to be within a frontal arc (~140° cone).
		if dist > 0.001 {
			ang := math.Atan2(dy, dx)
			diff := math.Abs(angleDiff(ang, r.Facing))
			if diff > 1.22 { // ~70° each side
				continue
			}
		}
		reaperKillOrHurt(game, r, p, now)
	}
}

// reaperKillOrHurt deals the reaper's melee damage to a player and, if lethal,
// marks them as having died during the event (so they can be revived on victory).
func reaperKillOrHurt(game *Game, r *Reaper, p *Player, now int64) {
	p.HP -= r.AttackDamage

	// Knockback the victim away from the reaper.
	dx := p.X - r.X
	dy := p.Y - r.Y
	d := math.Sqrt(dx*dx + dy*dy)
	if d > 0.001 {
		kb := 16.0
		pr := GameConfig.PlayerRadius
		p.X = clamp(p.X+(dx/d)*kb, pr, GameConfig.ArenaWidth-pr)
		p.Y = clamp(p.Y+(dy/d)*kb, pr, GameConfig.ArenaHeight-pr)
	}
	p.TaggedUntil = now + GameConfig.TagDuration

	if p.HP <= 0 {
		p.HP = 0
		p.Deaths++
		p.KillStreak = 0
		p.WaitingForRespawn = true
		p.DeathTime = now
		p.DiedDuringReaper = true
		broadcast(game, map[string]interface{}{
			"type":       "kill",
			"killer":     "☠ The Reaper",
			"victim":     p.Username,
			"weapon":     "reaper",
			"isRevenge":  false,
			"isHeadshot": false,
		})
		checkReaperWipe(game)
	}
}

// reaperTakeDamage applies bullet damage and capped knockback to the reaper.
// dirX/dirY is the (normalized or unnormalized) bullet travel direction.
// Returns true if the hit was registered. Caller must hold game.mu.
func reaperTakeDamage(game *Game, dmg int, dirX, dirY float64) bool {
	r := game.Reaper
	if r == nil || (r.State != ReaperChasing && r.State != ReaperAttacking) {
		return false
	}

	r.HP -= dmg
	if r.HP < 0 {
		r.HP = 0
	}

	// Apply capped knockback in the bullet's direction.
	l := math.Sqrt(dirX*dirX + dirY*dirY)
	if l > 0.001 {
		r.VX += (dirX / l) * GameConfig.ReaperKnockbackPerHit
		r.VY += (dirY / l) * GameConfig.ReaperKnockbackPerHit
		kbLen := math.Sqrt(r.VX*r.VX + r.VY*r.VY)
		if kbLen > GameConfig.ReaperKnockbackMax {
			r.VX = r.VX / kbLen * GameConfig.ReaperKnockbackMax
			r.VY = r.VY / kbLen * GameConfig.ReaperKnockbackMax
		}
	}

	if r.HP <= 0 {
		onReaperDefeated(game)
	}
	return true
}

// onReaperDefeated handles a successful boss kill: revive the fallen, reward the
// survivors (everyone but the match leader), and end the event. Caller holds game.mu.
func onReaperDefeated(game *Game) {
	r := game.Reaper
	if r != nil {
		r.State = ReaperDying
		r.StateStart = unixMs()
	}
	game.ReaperActive = false

	// Revive everyone who fell to the reaper during this event.
	for _, p := range game.Players {
		if p.DiedDuringReaper {
			respawnPlayer(p, game)
			p.DiedDuringReaper = false
		}
	}

	// Determine the current match leader (most kills) to exclude from the reward.
	var leader *Player
	for _, p := range game.Players {
		if leader == nil || p.Kills > leader.Kills {
			leader = p
		}
	}

	// Award +1 to every living player except the leader.
	rewarded := make([]string, 0, len(game.Players))
	for _, p := range game.Players {
		if p.HP > 0 && p != leader {
			p.Kills++
			rewarded = append(rewarded, p.Username)
		}
	}

	broadcast(game, map[string]interface{}{
		"type":     "reaperDefeated",
		"x":        int(math.Round(reaperXOrZero(r))),
		"y":        int(math.Round(reaperYOrZero(r))),
		"rewarded": rewarded,
	})
}

// checkReaperWipe flags a shared game over if the event is active and no
// players remain alive. The round itself is ended by the game loop after the
// tick completes (so game.mu is never released mid-tick). Caller must hold game.mu.
func checkReaperWipe(game *Game) {
	if !game.ReaperActive || game.RoundEnded || game.ReaperWipePending {
		return
	}
	if aliveCount(game) > 0 {
		return
	}
	game.ReaperActive = false
	if game.Reaper != nil {
		game.Reaper.State = ReaperDying
		game.Reaper.StateStart = unixMs()
	}
	// Defer the actual round end to the game loop, which calls endRound after
	// releasing game.mu (endRoundInternal acquires the lock itself).
	game.ReaperWipePending = true
}

/* ================= MOVEMENT HELPERS ================= */

// decayReaperKnockback bleeds off accumulated knockback velocity each tick.
func decayReaperKnockback(r *Reaper) {
	r.VX *= 0.82
	r.VY *= 0.82
	if math.Abs(r.VX) < 0.01 {
		r.VX = 0
	}
	if math.Abs(r.VY) < 0.01 {
		r.VY = 0
	}
}

// applyReaperMovement moves the reaper by (mvx,mvy) plus its knockback velocity,
// resolving obstacle collisions axis-by-axis (mirrors player movement).
func applyReaperMovement(game *Game, r *Reaper, mvx, mvy float64) {
	margin := r.Radius
	r.X += mvx + r.VX
	r.X = clamp(r.X, margin, GameConfig.ArenaWidth-margin)
	reaperResolveObstacles(game, r, true)

	r.Y += mvy + r.VY
	r.Y = clamp(r.Y, margin, GameConfig.ArenaHeight-margin)
	reaperResolveObstacles(game, r, false)
}

// reaperResolveObstacles pushes the reaper out of overlapping obstacles on one axis.
func reaperResolveObstacles(game *Game, r *Reaper, xAxis bool) {
	radius := r.Radius
	radiusSq := radius * radius
	nearby := globalObstacleGrid.QueryRadius(r.X, r.Y, radius+60)
	for _, e := range nearby {
		o := e.Data.(*Obstacle)
		closestX := clamp(r.X, o.X, o.X+o.Size)
		closestY := clamp(r.Y, o.Y, o.Y+o.Size)
		distX := r.X - closestX
		distY := r.Y - closestY
		dSq := distX*distX + distY*distY
		if dSq < radiusSq {
			if dSq > 0.0001 {
				dist := math.Sqrt(dSq)
				if xAxis {
					r.X += (distX / dist) * (radius - dist)
				} else {
					r.Y += (distY / dist) * (radius - dist)
				}
			} else {
				if xAxis {
					if o.X+o.Size/2 < r.X {
						r.X = o.X + o.Size + radius
					} else {
						r.X = o.X - radius
					}
				} else {
					if o.Y+o.Size/2 < r.Y {
						r.Y = o.Y + o.Size + radius
					} else {
						r.Y = o.Y - radius
					}
				}
			}
		}
	}
}

/* ================= SMALL HELPERS ================= */

// angleDiff returns the signed smallest difference a-b wrapped to [-π, π].
func angleDiff(a, b float64) float64 {
	d := a - b
	for d > math.Pi {
		d -= 2 * math.Pi
	}
	for d < -math.Pi {
		d += 2 * math.Pi
	}
	return d
}

func reaperXOrZero(r *Reaper) float64 {
	if r == nil {
		return 0
	}
	return r.X
}

func reaperYOrZero(r *Reaper) float64 {
	if r == nil {
		return 0
	}
	return r.Y
}

// segmentHitsCircle reports whether the segment (x1,y1)->(x2,y2) comes within
// `radius` of the circle centred at (cx,cy). Used for swept bullet-vs-reaper hits.
func segmentHitsCircle(x1, y1, x2, y2, cx, cy, radius float64) bool {
	dx := x2 - x1
	dy := y2 - y1
	lenSq := dx*dx + dy*dy
	var t float64
	if lenSq > 0.0001 {
		t = ((cx-x1)*dx + (cy-y1)*dy) / lenSq
		if t < 0 {
			t = 0
		} else if t > 1 {
			t = 1
		}
	}
	closestX := x1 + t*dx
	closestY := y1 + t*dy
	ddx := cx - closestX
	ddy := cy - closestY
	return ddx*ddx+ddy*ddy <= radius*radius
}

