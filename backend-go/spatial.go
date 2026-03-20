package main

import "math"

// SpatialGrid provides O(1) spatial queries using a hash grid.
type SpatialGrid struct {
	cellSize float64
	cells    map[int64][]*SpatialEntry
}

// SpatialEntry stores a reference with position and size.
type SpatialEntry struct {
	ID   string
	X    float64
	Y    float64
	Size float64 // used as both width and height for AABB
	Data interface{}
}

// NewSpatialGrid creates a new grid with the given cell size.
func NewSpatialGrid(cellSize float64) *SpatialGrid {
	return &SpatialGrid{
		cellSize: cellSize,
		cells:    make(map[int64][]*SpatialEntry),
	}
}

func (g *SpatialGrid) cellKey(cx, cy int) int64 {
	return int64(cx)*1000003 + int64(cy)
}

// Clear removes all entries.
func (g *SpatialGrid) Clear() {
	for k := range g.cells {
		delete(g.cells, k)
	}
}

// Insert adds an entry to the grid.
func (g *SpatialGrid) Insert(e *SpatialEntry) {
	minCX := int(math.Floor(e.X / g.cellSize))
	minCY := int(math.Floor(e.Y / g.cellSize))
	maxCX := int(math.Floor((e.X + e.Size) / g.cellSize))
	maxCY := int(math.Floor((e.Y + e.Size) / g.cellSize))

	for cx := minCX; cx <= maxCX; cx++ {
		for cy := minCY; cy <= maxCY; cy++ {
			key := g.cellKey(cx, cy)
			g.cells[key] = append(g.cells[key], e)
		}
	}
}

// QueryRect returns all entries overlapping the given rectangle.
func (g *SpatialGrid) QueryRect(x, y, w, h float64) []*SpatialEntry {
	minCX := int(math.Floor(x / g.cellSize))
	minCY := int(math.Floor(y / g.cellSize))
	maxCX := int(math.Floor((x + w) / g.cellSize))
	maxCY := int(math.Floor((y + h) / g.cellSize))

	seen := make(map[string]bool)
	var result []*SpatialEntry

	for cx := minCX; cx <= maxCX; cx++ {
		for cy := minCY; cy <= maxCY; cy++ {
			key := g.cellKey(cx, cy)
			for _, e := range g.cells[key] {
				if !seen[e.ID] {
					seen[e.ID] = true
					result = append(result, e)
				}
			}
		}
	}
	return result
}

// QueryRadius returns all entries within the given radius from center.
func (g *SpatialGrid) QueryRadius(cx, cy, radius float64) []*SpatialEntry {
	return g.QueryRect(cx-radius, cy-radius, radius*2, radius*2)
}
