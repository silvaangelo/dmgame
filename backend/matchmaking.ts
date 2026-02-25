import { v4 as uuid } from "uuid";
import type { Obstacle, Game, Room } from "./types.js";
import { GAME_CONFIG, OBSTACLE_CONFIG } from "./config.js";
import { rooms, games, allPlayers } from "./state.js";
import {
  broadcast,
  serializePlayers,
  isPositionClear,
  debouncedBroadcastOnlineList,
} from "./utils.js";
import { spawnRandomObstacle, spawnPickup, spawnBomb, spawnLightning } from "./game.js";
import { broadcastRoomList } from "./room.js";

/* ================= START GAME FROM ROOM ================= */

export function startGameFromRoom(room: Room) {
  // Filter out players with closed/closing WebSocket connections
  const players = room.players.filter((p) => p.ws.readyState === 1); // WebSocket.OPEN = 1

  if (players.length < GAME_CONFIG.MIN_PLAYERS) {
    console.log(`⚠️ Not enough connected players to start game from room "${room.name}" (${players.length}/${GAME_CONFIG.MIN_PLAYERS})`);
    return;
  }

  // Remove room
  rooms.delete(room.id);
  broadcastRoomList();

  // Generate random obstacles
  const obstacles: Obstacle[] = [];
  const wallCount =
    OBSTACLE_CONFIG.WALL_COUNT_MIN +
    Math.floor(
      Math.random() *
        (OBSTACLE_CONFIG.WALL_COUNT_MAX - OBSTACLE_CONFIG.WALL_COUNT_MIN + 1)
    );
  const treeCount =
    OBSTACLE_CONFIG.TREE_COUNT_MIN +
    Math.floor(
      Math.random() *
        (OBSTACLE_CONFIG.TREE_COUNT_MAX - OBSTACLE_CONFIG.TREE_COUNT_MIN + 1)
    );

  const usedAreas: {
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];

  for (let i = 0; i < wallCount; i++) {
    let attempts = 0;
    let validPosition = false;
    let startX = 0,
      startY = 0,
      isHorizontal = false,
      wallLength = 0;

    while (!validPosition && attempts < 20) {
      isHorizontal = Math.random() > 0.5;
      wallLength =
        OBSTACLE_CONFIG.WALL_LENGTH_MIN +
        Math.floor(
          Math.random() *
            (OBSTACLE_CONFIG.WALL_LENGTH_MAX -
              OBSTACLE_CONFIG.WALL_LENGTH_MIN +
              1)
        );

      startX = 120 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 340);
      startY = 120 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 340);

      const wallWidth = isHorizontal
        ? wallLength * OBSTACLE_CONFIG.WALL_BLOCK_SIZE
        : OBSTACLE_CONFIG.WALL_BLOCK_SIZE;
      const wallHeight = isHorizontal
        ? OBSTACLE_CONFIG.WALL_BLOCK_SIZE
        : wallLength * OBSTACLE_CONFIG.WALL_BLOCK_SIZE;

      validPosition = true;
      for (const area of usedAreas) {
        if (
          startX < area.x + area.width + OBSTACLE_CONFIG.WALL_SPACING &&
          startX + wallWidth + OBSTACLE_CONFIG.WALL_SPACING > area.x &&
          startY < area.y + area.height + OBSTACLE_CONFIG.WALL_SPACING &&
          startY + wallHeight + OBSTACLE_CONFIG.WALL_SPACING > area.y
        ) {
          validPosition = false;
          break;
        }
      }

      attempts++;
    }

    if (validPosition) {
      const blockSize = OBSTACLE_CONFIG.WALL_BLOCK_SIZE;
      usedAreas.push({
        x: startX,
        y: startY,
        width: isHorizontal ? wallLength * blockSize : blockSize,
        height: isHorizontal ? blockSize : wallLength * blockSize,
      });

      if (isHorizontal) {
        for (let j = 0; j < wallLength; j++) {
          obstacles.push({
            id: uuid(),
            x: startX + j * blockSize,
            y: startY,
            size: blockSize,
            destroyed: false,
            type: "wall",
          });
        }
      } else {
        for (let j = 0; j < wallLength; j++) {
          obstacles.push({
            id: uuid(),
            x: startX,
            y: startY + j * blockSize,
            size: blockSize,
            destroyed: false,
            type: "wall",
          });
        }
      }
    }
  }

  // Generate trees
  for (let i = 0; i < treeCount; i++) {
    let attempts = 0;
    let validPosition = false;
    let treeX = 0,
      treeY = 0;
    const treeSize = OBSTACLE_CONFIG.TREE_SIZE;

    while (!validPosition && attempts < 20) {
      treeX = 120 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 240);
      treeY = 120 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 240);

      validPosition = true;
      for (const area of usedAreas) {
        const dx = treeX - (area.x + area.width / 2);
        const dy = treeY - (area.y + area.height / 2);
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < OBSTACLE_CONFIG.TREE_SPACING) {
          validPosition = false;
          break;
        }
      }

      attempts++;
    }

    if (validPosition) {
      usedAreas.push({
        x: treeX - treeSize / 2,
        y: treeY - treeSize / 2,
        width: treeSize,
        height: treeSize,
      });

      obstacles.push({
        id: uuid(),
        x: treeX - treeSize / 2,
        y: treeY - treeSize / 2,
        size: treeSize,
        destroyed: false,
        type: "tree",
      });
    }
  }

  // Spawn players in clear positions
  const spawnedPositions: { x: number; y: number }[] = [];

  players.forEach((p, i) => {
    p.team = 0;

    let spawnX: number,
      spawnY: number;
    let attempts = 0;
    let bestDistance = 0;
    let bestX = 0,
      bestY = 0;
    const maxAttempts = 100;
    const spawnRadius = GAME_CONFIG.PLAYER_RADIUS;

    while (attempts < maxAttempts) {
      const testX = 50 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 100);
      const testY = 50 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 100);

      if (isPositionClear(testX, testY, obstacles, spawnRadius)) {
        let minDistToPlayers = Infinity;
        for (const pos of spawnedPositions) {
          const dist = Math.sqrt(
            (testX - pos.x) ** 2 + (testY - pos.y) ** 2
          );
          minDistToPlayers = Math.min(minDistToPlayers, dist);
        }

        if (minDistToPlayers > bestDistance) {
          bestDistance = minDistToPlayers;
          bestX = testX;
          bestY = testY;
        }
      }
      attempts++;
    }

    if (bestDistance > 0) {
      spawnX = bestX;
      spawnY = bestY;
    } else {
      const corners = [
        { x: 50, y: 50 },
        { x: GAME_CONFIG.ARENA_WIDTH - 50, y: 50 },
        { x: 50, y: GAME_CONFIG.ARENA_HEIGHT - 50 },
        { x: GAME_CONFIG.ARENA_WIDTH - 50, y: GAME_CONFIG.ARENA_HEIGHT - 50 },
      ];
      const corner = corners[i % corners.length];
      spawnX = corner.x;
      spawnY = corner.y;
    }

    spawnedPositions.push({ x: spawnX, y: spawnY });

    p.x = spawnX;
    p.y = spawnY;
    p.hp = GAME_CONFIG.PLAYER_HP;
    p.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE;
    p.reloading = false;
    p.lastShotTime = 0;
    p.keys = { w: false, a: false, s: false, d: false };
    p.lastProcessedInput = 0;
    p.kills = 0;
    p.deaths = 0;
    p.ready = false;
    p.aimAngle = 0;
    p.weapon = "machinegun";
  });

  const game: Game = {
    id: uuid(),
    players,
    bullets: [],
    obstacles,
    pickups: [],
    bombs: [],
    lightnings: [],
    started: false,
    lastBroadcastState: new Map(),
    stateSequence: 0,
  };

  games.set(game.id, game);

  players.forEach((p) => {
    const tracked = allPlayers.get(p.id);
    if (tracked) tracked.status = "in-game";
  });
  debouncedBroadcastOnlineList();

  console.log(`🎮 Game created from room "${room.name}"! Game ID: ${game.id}`);
  console.log(`   Players: ${players.map((p) => p.username).join(", ")}`);

  broadcast(game, {
    type: "start",
    gameId: game.id,
    players: serializePlayers(game),
    obstacles: game.obstacles,
    arenaWidth: GAME_CONFIG.ARENA_WIDTH,
    arenaHeight: GAME_CONFIG.ARENA_HEIGHT,
  });

  // Start the pre-game ready timeout (15s)
  startPreGameTimeout(game);
}

/* ================= PRE-GAME READY CHECK ================= */

function startPreGameTimeout(game: Game) {
  let timeRemaining = GAME_CONFIG.PRE_GAME_READY_TIMEOUT;

  game.preGameCountdownInterval = setInterval(() => {
    timeRemaining--;

    broadcast(game, {
      type: "preGameCountdown",
      timeRemaining,
    });

    if (timeRemaining <= 0) {
      clearPreGameTimers(game);

      // Force-start the game regardless of who's ready
      console.log(`⏰ Pre-game timeout! Force-starting game ${game.id}`);
      game.players.forEach((p) => { p.ready = true; });
      beginMatch(game);
    }
  }, 1000);
}

function clearPreGameTimers(game: Game) {
  if (game.preGameCountdownInterval) {
    clearInterval(game.preGameCountdownInterval);
    game.preGameCountdownInterval = undefined;
  }
  if (game.preGameTimeout) {
    clearTimeout(game.preGameTimeout);
    game.preGameTimeout = undefined;
  }
}

export function checkAllReady(game: Game) {
  const allReady = game.players.every((p) => p.ready);
  if (!allReady || game.players.length === 0) return;

  clearPreGameTimers(game);

  console.log(
    `✅ All players ready! Starting in ${GAME_CONFIG.READY_COUNTDOWN} seconds...`
  );

  let countdown = GAME_CONFIG.READY_COUNTDOWN;
  broadcast(game, { type: "countdown", countdown });

  const cdInterval = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      broadcast(game, { type: "countdown", countdown });
    } else {
      clearInterval(cdInterval);
      beginMatch(game);
    }
  }, 1000);
}

function beginMatch(game: Game) {
  game.started = true;

  broadcast(game, {
    type: "allReady",
    killsToWin: GAME_CONFIG.KILLS_TO_WIN,
    arenaWidth: GAME_CONFIG.ARENA_WIDTH,
    arenaHeight: GAME_CONFIG.ARENA_HEIGHT,
  });

  console.log(
    `🎮 Deathmatch starting NOW! First to ${GAME_CONFIG.KILLS_TO_WIN} kills wins!`
  );

  game.obstacleSpawnInterval = setInterval(() => {
    if (games.has(game.id)) {
      spawnRandomObstacle(game);
    } else {
      clearInterval(game.obstacleSpawnInterval);
    }
  }, GAME_CONFIG.OBSTACLE_SPAWN_INTERVAL);

  game.pickupSpawnInterval = setInterval(() => {
    if (games.has(game.id)) {
      spawnPickup(game);
    } else {
      clearInterval(game.pickupSpawnInterval);
    }
  }, GAME_CONFIG.PICKUP_SPAWN_INTERVAL);

  // Schedule bombs with randomized timing (0.5x–1.5x base interval)
  const scheduleBomb = () => {
    const delay = GAME_CONFIG.BOMB_SPAWN_INTERVAL * (0.5 + Math.random());
    game.bombSpawnInterval = setTimeout(() => {
      if (!games.has(game.id)) return;
      spawnBomb(game);
      scheduleBomb();
    }, delay);
  };
  scheduleBomb();

  // Schedule lightning with randomized timing (0.5x–1.5x base interval)
  const scheduleLightning = () => {
    const delay = GAME_CONFIG.LIGHTNING_SPAWN_INTERVAL * (0.5 + Math.random());
    game.lightningSpawnInterval = setTimeout(() => {
      if (!games.has(game.id)) return;
      spawnLightning(game);
      scheduleLightning();
    }, delay);
  };
  scheduleLightning();
}
