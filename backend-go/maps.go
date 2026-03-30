package main

import "math/rand"

// MapDef defines a hand-designed arena map with fixed obstacle placements.
type MapDef struct {
	Name   string
	Width  float64
	Height float64
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

// mapDustyard — compact 1600×1600 arena with tactical cover.
//
// Layout guide (each unit = 40 px block):
//
//	 ┌──────────────────────────────────────────┐
//	 │           T        T                      │
//	 │     ████           ██████                 │
//	 │     ████                                  │
//	 │              ██                           │
//	 │        ████  ██         ████              │
//	 │                                           │
//	 │  ██              ████████                 │
//	 │  ██              ██    ██                 │
//	 │  ██                                       │
//	 │                                           │
//	 │        ████████                ██         │
//	 │                                ██         │
//	 │               ██████                      │
//	 │                                           │
//	 │     ██████              ████              │
//	 │                         ████              │
//	 │           T         T                     │
//	 └──────────────────────────────────────────┘
//
func mapDustyard() MapDef {
	b := BlockSize // 40 px per block

	return MapDef{
		Name:   "Dustyard",
		Width:  1600,
		Height: 1600,
		Walls: []MapRect{
			// ── Arena border walls (thin decorative inner border — optional) ──

			// ── TOP-LEFT CLUSTER: L-shaped cover ──
			{X: 120, Y: 120, W: 2 * b, H: 3 * b},   // vertical bar
			{X: 120, Y: 120, W: 4 * b, H: b},         // horizontal cap

			// ── TOP-CENTER: horizontal wall ──
			{X: 500, Y: 180, W: 5 * b, H: b},

			// ── TOP-RIGHT: corner box ──
			{X: 1200, Y: 100, W: 3 * b, H: 2 * b},

			// ── LEFT MID: tall vertical wall ──
			{X: 80, Y: 500, W: b, H: 4 * b},

			// ── CENTER-LEFT: cross-shaped cover ──
			{X: 380, Y: 480, W: 4 * b, H: b},         // horizontal
			{X: 460, Y: 400, W: b, H: 3 * b},          // vertical

			// ── CENTER: the "mid" crate cluster ──
			{X: 700, Y: 700, W: 2 * b, H: 2 * b},     // center box
			{X: 640, Y: 780, W: b, H: 2 * b},          // left pillar
			{X: 840, Y: 680, W: b, H: 2 * b},          // right pillar

			// ── CENTER-RIGHT: horizontal wall ──
			{X: 1000, Y: 600, W: 5 * b, H: b},

			// ── RIGHT MID: T-shaped cover ──
			{X: 1350, Y: 500, W: b, H: 3 * b},         // vertical
			{X: 1270, Y: 580, W: 3 * b, H: b},         // horizontal

			// ── BOTTOM-LEFT: box + wing ──
			{X: 160, Y: 1100, W: 3 * b, H: 2 * b},    // box
			{X: 280, Y: 1020, W: b, H: 2 * b},         // wing

			// ── BOTTOM-CENTER: long wall with gap ──
			{X: 500, Y: 1150, W: 4 * b, H: b},
			{X: 720, Y: 1150, W: 3 * b, H: b},

			// ── BOTTOM-RIGHT: L-shaped cover (mirror of top-left) ──
			{X: 1240, Y: 1280, W: 4 * b, H: b},        // horizontal
			{X: 1240, Y: 1280, W: b, H: 3 * b},         // vertical drop

			// ── LOWER-RIGHT: box ──
			{X: 1380, Y: 1050, W: 2 * b, H: 2 * b},

			// ── MID-LEFT: angled cover near spawn area ──
			{X: 260, Y: 740, W: 3 * b, H: b},
			{X: 260, Y: 780, W: b, H: 2 * b},

			// ── UPPER-RIGHT passage wall ──
			{X: 1050, Y: 280, W: b, H: 3 * b},

			// ── LOWER-LEFT passage wall ──
			{X: 480, Y: 1350, W: b, H: 3 * b},

			// ── Scattered pillars for quick peeks ──
			{X: 750, Y: 350, W: b, H: b},    // pillar NE of center
			{X: 350, Y: 1000, W: b, H: b},   // pillar SW
			{X: 1100, Y: 950, W: b, H: b},   // pillar SE
			{X: 900, Y: 1350, W: b, H: b},   // pillar S
		},
	}
}

// GenerateObstaclesFromMap converts a MapDef into the game's obstacle list.
// Each MapRect is broken into BlockSize×BlockSize tiles so the existing
// spatial-grid and collision code (which expects square obstacles) works unchanged.
func GenerateObstaclesFromMap(m MapDef) []*Obstacle {
	obstacles := make([]*Obstacle, 0, 256)

	for _, rect := range m.Walls {
		// How many tiles fit in this rect?
		cols := int(rect.W / BlockSize)
		rows := int(rect.H / BlockSize)
		if cols < 1 {
			cols = 1
		}
		if rows < 1 {
			rows = 1
		}

		groupID := nextEntityID() // group all tiles of one rect

		for r := 0; r < rows; r++ {
			for c := 0; c < cols; c++ {
				obstacles = append(obstacles, &Obstacle{
					ID:      nextEntityID(),
					X:       rect.X + float64(c)*BlockSize,
					Y:       rect.Y + float64(r)*BlockSize,
					Size:    BlockSize,
					Type:    "wall",
					GroupID: groupID,
				})
			}
		}
	}

	return obstacles
}
