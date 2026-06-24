package main

import (
	"math"
	"math/rand"
)

/* =====================================================================
   ZOMBIE INFESTATION — RANDOM HORDE EVENT

   Many server-controlled zombies spawn at once (ZombiesPerPlayer per living
   player). Each zombie shambles toward a randomly chosen player at player
   speed and bites on contact. While active:
     - Player-vs-player damage is disabled (shared with the reaper event).
     - Bullets damage zombies; each zombie kill counts as a kill for the shooter.
     - Players still respawn normally if a zombie kills them.
   The event ends once every zombie has been killed.

   Zombies are kept deliberately cheap (no zombie-zombie collision, a single
   obstacle query per tick, a random fixed target) so the horde scales.
   ===================================================================== */

// alivePlayers returns a slice of all living players.
func alivePlayers(game *Game) []*Player {
	out := make([]*Player, 0, len(game.Players))
	for _, p := range game.Players {
		if p.HP > 0 {
			out = append(out, p)
		}
	}
	return out
}

// minPlayerDist returns the distance from (x,y) to the nearest living player.
func minPlayerDist(game *Game, x, y float64) float64 {
	best := math.Inf(1)
	for _, p := range game.Players {
		if p.HP <= 0 {
			continue
		}
		if d := distance(x, y, p.X, p.Y); d < best {
			best = d
		}
	}
	return best
}

// spawnZombies starts the infestation, creating ZombiesPerPlayer zombies for
// each living player. Caller must hold game.mu.
func spawnZombies(game *Game) {
	targets := alivePlayers(game)
	if len(targets) == 0 {
		return
	}
	count := GameConfig.ZombiesPerPlayer * len(targets)
	now := unixMs()
	margin := GameConfig.ZombieRadius + 6

	game.Zombies = make([]*Zombie, 0, count)
	for i := 0; i < count; i++ {
		// Find a clear spawn point, preferably not on top of a player.
		var zx, zy float64
		for attempt := 0; attempt < 12; attempt++ {
			zx = margin + rand.Float64()*(GameConfig.ArenaWidth-2*margin)
			zy = margin + rand.Float64()*(GameConfig.ArenaHeight-2*margin)
			if isPositionClear(zx, zy, game.Obstacles, GameConfig.ZombieRadius) &&
				minPlayerDist(game, zx, zy) > 160 {
				break
			}
		}
		game.Zombies = append(game.Zombies, &Zombie{
			X:         zx,
			Y:         zy,
			HP:        GameConfig.ZombieHP,
			Radius:    GameConfig.ZombieRadius,
			ShortID:   game.NextShortID,
			Color:     uint8(rand.Intn(GameConfig.ZombieColorVariants)),
			TargetID:  targets[rand.Intn(len(targets))].ID,
			SpawnTime: now,
		})
		game.NextShortID++
	}

	game.ZombieActive = true
	game.ZombieDoneThisRound = true

	broadcast(game, map[string]interface{}{
		"type":  "zombieSpawn",
		"count": count,
	})
}

// zombieTarget returns the player a zombie is chasing, re-picking a new random
// living target if its current one is gone.
func zombieTarget(game *Game, z *Zombie) *Player {
	for _, p := range game.Players {
		if p.ID == z.TargetID && p.HP > 0 {
			return p
		}
	}
	living := alivePlayers(game)
	if len(living) == 0 {
		z.TargetID = ""
		return nil
	}
	t := living[rand.Intn(len(living))]
	z.TargetID = t.ID
	return t
}

// updateZombies advances every zombie one tick: compact the dead, end the event
// when the horde is cleared, then move/bite the survivors. Caller holds game.mu.
func updateZombies(game *Game, now int64) {
	if !game.ZombieActive {
		return
	}

	// Compact out dead zombies (killed by bullets last tick).
	if n := compactZombies(game); n == 0 {
		onZombiesCleared(game)
		return
	}

	speed := GameConfig.ZombieSpeed
	biteRange := GameConfig.ZombieAttackRange
	for _, z := range game.Zombies {
		if z.HP <= 0 {
			continue
		}
		t := zombieTarget(game, z)
		if t == nil {
			continue // no living players to chase
		}

		dx := t.X - z.X
		dy := t.Y - z.Y
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist > 0.001 {
			z.Facing = math.Atan2(dy, dx)
		}

		if dist <= biteRange {
			if now-z.LastAttackTime >= GameConfig.ZombieAttackCooldown {
				z.LastAttackTime = now
				zombieBite(game, z, t, now)
			}
			// Press right up against the target rather than overshooting.
			applyZombieMovement(game, z, 0, 0)
			continue
		}

		var mvx, mvy float64
		if dist > 0.001 {
			mvx = (dx / dist) * speed
			mvy = (dy / dist) * speed
		}
		applyZombieMovement(game, z, mvx, mvy)
	}
}

// compactZombies removes zombies with HP<=0 in place and returns the count left.
func compactZombies(game *Game) int {
	n := 0
	for _, z := range game.Zombies {
		if z.HP > 0 {
			game.Zombies[n] = z
			n++
		}
	}
	for i := n; i < len(game.Zombies); i++ {
		game.Zombies[i] = nil
	}
	game.Zombies = game.Zombies[:n]
	return n
}

// onZombiesCleared ends the infestation once the last zombie dies.
func onZombiesCleared(game *Game) {
	if !game.ZombieActive {
		return
	}
	game.ZombieActive = false
	game.Zombies = nil
	broadcast(game, map[string]interface{}{
		"type": "zombieCleared",
	})
}

// zombieBite damages a player on contact and handles their death/respawn.
func zombieBite(game *Game, z *Zombie, p *Player, now int64) {
	if p.HP <= 0 {
		return
	}
	p.HP -= GameConfig.ZombieAttackDamage

	// Small shove away from the zombie.
	dx := p.X - z.X
	dy := p.Y - z.Y
	d := math.Sqrt(dx*dx + dy*dy)
	if d > 0.001 {
		kb := 6.0
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
		broadcast(game, map[string]interface{}{
			"type":       "kill",
			"killer":     "🧟 Zombie",
			"victim":     p.Username,
			"weapon":     "zombie",
			"isRevenge":  false,
			"isHeadshot": false,
		})
	}
}

// zombieTakeDamage applies bullet damage to a zombie. On death it credits the
// shooter with a kill and broadcasts an effect event. Caller holds game.mu.
func zombieTakeDamage(game *Game, z *Zombie, dmg int, shooterID string) {
	if z.HP <= 0 {
		return
	}
	z.HP -= dmg
	if z.HP > 0 {
		return
	}
	z.HP = 0

	var killerName string
	for _, p := range game.Players {
		if p.ID == shooterID {
			p.Kills++
			p.TotalDamage += dmg
			killerName = p.Username
			break
		}
	}

	broadcast(game, map[string]interface{}{
		"type":   "zombieKilled",
		"x":      int(math.Round(z.X)),
		"y":      int(math.Round(z.Y)),
		"killer": killerName,
	})
}

// applyZombieMovement moves the zombie by (mvx,mvy), resolving obstacle overlap.
// A single grid query is reused for both axes to keep the horde cheap.
func applyZombieMovement(game *Game, z *Zombie, mvx, mvy float64) {
	r := z.Radius
	nearby := globalObstacleGrid.QueryRadius(z.X, z.Y, r+50)

	z.X = clamp(z.X+mvx, r, GameConfig.ArenaWidth-r)
	resolveZombieAxis(z, nearby, true)

	z.Y = clamp(z.Y+mvy, r, GameConfig.ArenaHeight-r)
	resolveZombieAxis(z, nearby, false)
}

// resolveZombieAxis pushes the zombie out of overlapping obstacles on one axis.
func resolveZombieAxis(z *Zombie, nearby []*SpatialEntry, xAxis bool) {
	radius := z.Radius
	radiusSq := radius * radius
	for _, e := range nearby {
		o := e.Data.(*Obstacle)
		closestX := clamp(z.X, o.X, o.X+o.Size)
		closestY := clamp(z.Y, o.Y, o.Y+o.Size)
		distX := z.X - closestX
		distY := z.Y - closestY
		dSq := distX*distX + distY*distY
		if dSq >= radiusSq {
			continue
		}
		if dSq > 0.0001 {
			dist := math.Sqrt(dSq)
			if xAxis {
				z.X += (distX / dist) * (radius - dist)
			} else {
				z.Y += (distY / dist) * (radius - dist)
			}
		} else {
			if xAxis {
				if o.X+o.Size/2 < z.X {
					z.X = o.X + o.Size + radius
				} else {
					z.X = o.X - radius
				}
			} else {
				if o.Y+o.Size/2 < z.Y {
					z.Y = o.Y + o.Size + radius
				} else {
					z.Y = o.Y - radius
				}
			}
		}
	}
}
