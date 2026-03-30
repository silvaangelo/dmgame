package main

import (
	"math"
	"math/rand"
)

/* ================= SPAWN TIMERS (checked every tick) ================= */

func checkSpawnTimers(game *Game, now int64) {
	// All dynamic spawning removed — pure deathmatch
}

/* ================= OBSTACLE GENERATION ================= */

func generateObstacles() []*Obstacle {
	obstacles := make([]*Obstacle, 0)
	wallCount := ObstacleConfig.WallCountMin +
		rand.Intn(ObstacleConfig.WallCountMax-ObstacleConfig.WallCountMin+1)
	treeCount := ObstacleConfig.TreeCountMin +
		rand.Intn(ObstacleConfig.TreeCountMax-ObstacleConfig.TreeCountMin+1)

	type usedArea struct {
		x, y, width, height float64
	}
	usedAreas := make([]usedArea, 0)

	for i := 0; i < wallCount; i++ {
		validPosition := false
		var startX, startY float64
		var isHorizontal bool
		var wallLength int

		for attempts := 0; attempts < 20; attempts++ {
			isHorizontal = rand.Float64() > 0.5
			wallLength = ObstacleConfig.WallLengthMin +
				rand.Intn(ObstacleConfig.WallLengthMax-ObstacleConfig.WallLengthMin+1)
			startX = 120 + rand.Float64()*(GameConfig.ArenaWidth-340)
			startY = 120 + rand.Float64()*(GameConfig.ArenaHeight-340)

			wallWidth := ObstacleConfig.WallBlockSize
			wallHeight := float64(wallLength) * ObstacleConfig.WallBlockSize
			if isHorizontal {
				wallWidth = float64(wallLength) * ObstacleConfig.WallBlockSize
				wallHeight = ObstacleConfig.WallBlockSize
			}

			valid := true
			for _, area := range usedAreas {
				if startX < area.x+area.width+ObstacleConfig.WallSpacing &&
					startX+wallWidth+ObstacleConfig.WallSpacing > area.x &&
					startY < area.y+area.height+ObstacleConfig.WallSpacing &&
					startY+wallHeight+ObstacleConfig.WallSpacing > area.y {
					valid = false
					break
				}
			}
			if valid {
				validPosition = true
				break
			}
		}

		if validPosition {
			blockSize := ObstacleConfig.WallBlockSize
			ww := blockSize
			wh := float64(wallLength) * blockSize
			if isHorizontal {
				ww = float64(wallLength) * blockSize
				wh = blockSize
			}
			usedAreas = append(usedAreas, usedArea{startX, startY, ww, wh})

			gID := nextEntityID()
			for j := 0; j < wallLength; j++ {
				ox := startX
				oy := startY
				if isHorizontal {
					ox = startX + float64(j)*blockSize
				} else {
					oy = startY + float64(j)*blockSize
				}
				obstacles = append(obstacles, &Obstacle{
					ID:        nextEntityID(),
					X:         ox,
					Y:         oy,
					Size:      blockSize,
					Destroyed: false,
					Type:      "wall",
					GroupID:   gID,
				})
			}
		}
	}

	for i := 0; i < treeCount; i++ {
		treeSize := ObstacleConfig.TreeSize
		validPosition := false
		var treeX, treeY float64

		for attempts := 0; attempts < 20; attempts++ {
			treeX = 120 + rand.Float64()*(GameConfig.ArenaWidth-240)
			treeY = 120 + rand.Float64()*(GameConfig.ArenaHeight-240)

			valid := true
			for _, area := range usedAreas {
				dx := treeX - (area.x + area.width/2)
				dy := treeY - (area.y + area.height/2)
				if math.Sqrt(dx*dx+dy*dy) < ObstacleConfig.TreeSpacing {
					valid = false
					break
				}
			}
			if valid {
				validPosition = true
				break
			}
		}

		if validPosition {
			usedAreas = append(usedAreas, usedArea{
				treeX - treeSize/2, treeY - treeSize/2, treeSize, treeSize,
			})
			obstacles = append(obstacles, &Obstacle{
				ID:        nextEntityID(),
				X:         treeX - treeSize/2,
				Y:         treeY - treeSize/2,
				Size:      treeSize,
				Destroyed: false,
				Type:      "tree",
			})
		}
	}

	return obstacles
}
