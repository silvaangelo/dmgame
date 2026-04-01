package main

import "math/rand"

// MapDef defines a hand-designed arena map with fixed obstacle placements.
type MapDef struct {
	Name string
	// Walls are defined as rectangles: {X, Y, Width, Height}
	Walls []MapRect
}

// MapRect is a rectangle in world coordinates.
type MapRect struct {
	X, Y, W, H float64
}

// BlockSize is the atomic obstacle tile size (each wall segment = 1 block).
const BlockSize = 40.0

// AllMaps holds every available map. Currently one; add more for random selection.
var AllMaps = []MapDef{
	mapDustyard(),
}

// PickRandomMap returns a random map definition.
func PickRandomMap() MapDef {
	return AllMaps[rand.Intn(len(AllMaps))]
}

// mapDustyard — competitive 1600×1600 arena with 3-lane layout.
//
// Design: Mirror-symmetric about both axes for competitive fairness.
// Features: 3 distinct lanes (left, mid, right), chokepoints, peek pillars,
// a central contested zone, and rotational cover in corners.
//
//  ┌────────────────────────────────────────────┐
//  │  ┌──┐              ████              ┌──┐  │
//  │  └──┘   ▓▓                     ▓▓   └──┘  │
//  │         ▓▓    ██         ██    ▓▓         │
//  │                                            │
//  │    ██                             ██       │
//  │    ██   ████                ████   ██      │
//  │              ██  ┌────┐  ██                │
//  │              ██  │ MID│  ██                │
//  │              ██  └────┘  ██                │
//  │    ██   ████                ████   ██      │
//  │    ██                             ██       │
//  │                                            │
//  │         ▓▓    ██         ██    ▓▓         │
//  │  ┌──┐   ▓▓                     ▓▓   ┌──┐  │
//  │  └──┘              ████              └──┘  │
//  └────────────────────────────────────────────┘
//
func mapDustyard() MapDef {
	b := BlockSize // 40 px per block

	return MapDef{
		Name: "Dustyard",
		Walls: []MapRect{
			// ══════ CORNER BUNKERS (rotational symmetry) ══════
			// Top-left L-shaped bunker
			{X: 80, Y: 80, W: 3 * b, H: b},
			{X: 80, Y: 80, W: b, H: 3 * b},

			// Top-right L-shaped bunker (mirrored)
			{X: 1280, Y: 80, W: 3 * b, H: b},
			{X: 1440, Y: 80, W: b, H: 3 * b},

			// Bottom-left L-shaped bunker (mirrored)
			{X: 80, Y: 1400, W: b, H: 3 * b},
			{X: 80, Y: 1480, W: 3 * b, H: b},

			// Bottom-right L-shaped bunker (mirrored)
			{X: 1280, Y: 1480, W: 3 * b, H: b},
			{X: 1440, Y: 1400, W: b, H: 3 * b},

			// ══════ TOP & BOTTOM LANE WALLS (horizontal control) ══════
			// Top center wall (creates chokepoint)
			{X: 640, Y: 160, W: 4 * b, H: b},
			// Bottom center wall (mirror)
			{X: 640, Y: 1400, W: 4 * b, H: b},

			// ══════ LEFT & RIGHT LANE WALLS (vertical control) ══════
			// Left lane tall wall (north)
			{X: 280, Y: 400, W: b, H: 3 * b},
			// Left lane tall wall (south)
			{X: 280, Y: 1080, W: b, H: 3 * b},
			// Right lane tall wall (north)
			{X: 1280, Y: 400, W: b, H: 3 * b},
			// Right lane tall wall (south)
			{X: 1280, Y: 1080, W: b, H: 3 * b},

			// ══════ MID LANE INFRASTRUCTURE ══════
			// Left of mid — approach cover (north)
			{X: 480, Y: 520, W: 3 * b, H: b},
			// Left of mid — approach cover (south)
			{X: 480, Y: 1040, W: 3 * b, H: b},
			// Right of mid — approach cover (north)
			{X: 920, Y: 520, W: 3 * b, H: b},
			// Right of mid — approach cover (south)
			{X: 920, Y: 1040, W: 3 * b, H: b},

			// ══════ CENTER BOX (contested mid zone) ══════
			// Center box — left wall
			{X: 680, Y: 720, W: b, H: 2 * b},
			// Center box — right wall
			{X: 880, Y: 720, W: b, H: 2 * b},
			// Center box — top
			{X: 720, Y: 700, W: 2 * b, H: b},
			// Center box — bottom
			{X: 720, Y: 860, W: 2 * b, H: b},

			// ══════ INNER LANE CONNECTORS ══════
			// NW connector (between left & mid lane)
			{X: 400, Y: 320, W: 2 * b, H: b},
			// NE connector
			{X: 1080, Y: 320, W: 2 * b, H: b},
			// SW connector
			{X: 400, Y: 1240, W: 2 * b, H: b},
			// SE connector
			{X: 1080, Y: 1240, W: 2 * b, H: b},

			// ══════ PEEK PILLARS (quick peek / jiggle peek spots) ══════
			// NW pillar
			{X: 560, Y: 360, W: b, H: b},
			// NE pillar
			{X: 1000, Y: 360, W: b, H: b},
			// SW pillar
			{X: 560, Y: 1200, W: b, H: b},
			// SE pillar
			{X: 1000, Y: 1200, W: b, H: b},
			// Mid-left pillar
			{X: 600, Y: 780, W: b, H: b},
			// Mid-right pillar
			{X: 960, Y: 780, W: b, H: b},

			// ══════ SIDE COVER (prevents boring straight-line sightlines) ══════
			// Left side cover (mid height)
			{X: 120, Y: 700, W: 2 * b, H: b},
			{X: 120, Y: 860, W: 2 * b, H: b},
			// Right side cover (mid height)
			{X: 1360, Y: 700, W: 2 * b, H: b},
			{X: 1360, Y: 860, W: 2 * b, H: b},
		},
	}
}

// GenerateObstaclesFromMap converts a MapDef into the game's obstacle list.
// Each MapRect is broken into BlockSize×BlockSize tiles so the existing
// spatial-grid and collision code (which expects square obstacles) works unchanged.
func GenerateObstaclesFromMap(m MapDef) []*Obstacle {
	obstacles := make([]*Obstacle, 0, 256)

	for _, rect := range m.Walls {
		cols := int(rect.W / BlockSize)
		rows := int(rect.H / BlockSize)
		if cols < 1 {
			cols = 1
		}
		if rows < 1 {
			rows = 1
		}

		// 1.14: Mark single-block-thick walls as thin (allow bullet penetration)
		isThin := (cols == 1 || rows == 1)

		groupID := nextEntityID()

		for r := 0; r < rows; r++ {
			for c := 0; c < cols; c++ {
				obstacles = append(obstacles, &Obstacle{
					ID:      nextEntityID(),
					X:       rect.X + float64(c)*BlockSize,
					Y:       rect.Y + float64(r)*BlockSize,
					Size:    BlockSize,
					Type:    "wall",
					GroupID: groupID,
					Thin:    isThin,
				})
			}
		}
	}

	return obstacles
}
