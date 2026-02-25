import { v4 as uuid } from "uuid";
import { WebSocket } from "ws";
import type { Player, Bullet, Game, Pickup, Bomb } from "./types.js";
import { GAME_CONFIG, OBSTACLE_CONFIG } from "./config.js";
import { games, allPlayers, rooms } from "./state.js";
import {
  broadcast,
  serializePlayersCompact,
  isPositionClear,
  debouncedBroadcastOnlineList,
} from "./utils.js";
import { updatePlayerStats, addMatchHistory, getMatchHistory } from "./database.js";

/* ================= KILL STREAKS ================= */

const STREAK_THRESHOLDS = [
  { kills: 2, message: "DUPLO ABATE!" },
  { kills: 3, message: "MONSTRO!" },
  { kills: 5, message: "IMPARÁVEL!" },
  { kills: 7, message: "LENDÁRIO!" },
  { kills: 10, message: "DEUS DA ARENA!" },
];

function handleKill(
  killer: Player | undefined,
  victim: Player,
  weapon: string,
  game: Game,
) {
  victim.deaths++;
  victim.killStreak = 0;

  if (killer && killer.id !== victim.id) {
    killer.kills++;
    killer.killStreak++;

    // Heal on kill — recover 1 HP (capped at max)
    killer.hp = Math.min(GAME_CONFIG.PLAYER_HP, killer.hp + 1);

    broadcast(game, {
      type: "kill",
      killer: killer.username,
      victim: victim.username,
      weapon,
    });

    // Check for kill streak announcement
    const streak = STREAK_THRESHOLDS.find((s) => s.kills === killer.killStreak);
    if (streak) {
      broadcast(game, {
        type: "killStreak",
        player: killer.username,
        streak: killer.killStreak,
        message: streak.message,
      });
    }
  } else {
    broadcast(game, {
      type: "kill",
      killer: killer?.username || "Unknown",
      victim: victim.username,
      weapon,
    });
  }

  checkVictory(game);

  if (games.has(game.id)) {
    setTimeout(() => {
      if (games.has(game.id)) {
        respawnPlayer(victim, game);
      }
    }, GAME_CONFIG.RESPAWN_TIME);
  }
}

/* ================= HELPERS ================= */

function getPlayerSpeed(player: Player): number {
  const knifeBonus = player.weapon === "knife" ? GAME_CONFIG.KNIFE_SPEED_BONUS : 1;
  const speedBoost = Date.now() < player.speedBoostUntil ? GAME_CONFIG.PICKUP_SPEED_MULTIPLIER : 1;
  return GAME_CONFIG.PLAYER_SPEED * knifeBonus * speedBoost;
}

/* ================= GAME LOOP ================= */

export function updateGame(game: Game) {
  game.players.forEach((player) => {
    if (player.hp <= 0) return;

    // Check minigun expiry
    if (player.weapon === "minigun" && Date.now() >= player.minigunUntil) {
      player.weapon = "machinegun";
      player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE;
      player.reloading = false;
    }

    const speed = getPlayerSpeed(player);
    const playerRadius = GAME_CONFIG.PLAYER_RADIUS;
    const margin = playerRadius;

    // Move X axis first, then resolve collisions on X
    const oldX = player.x;
    if (player.keys.a) player.x -= speed;
    if (player.keys.d) player.x += speed;
    player.x = Math.max(
      margin,
      Math.min(GAME_CONFIG.ARENA_WIDTH - margin, player.x)
    );

    for (const obstacle of game.obstacles) {
      if (obstacle.destroyed) continue;
      const closestX = Math.max(
        obstacle.x,
        Math.min(player.x, obstacle.x + obstacle.size)
      );
      const closestY = Math.max(
        obstacle.y,
        Math.min(player.y, obstacle.y + obstacle.size)
      );
      const distanceX = player.x - closestX;
      const distanceY = player.y - closestY;
      const distanceSquared = distanceX * distanceX + distanceY * distanceY;

      if (distanceSquared < playerRadius * playerRadius) {
        player.x = oldX;
        break;
      }
    }

    // Move Y axis, then resolve collisions on Y
    const oldY = player.y;
    if (player.keys.w) player.y -= speed;
    if (player.keys.s) player.y += speed;
    player.y = Math.max(
      margin,
      Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, player.y)
    );

    for (const obstacle of game.obstacles) {
      if (obstacle.destroyed) continue;
      const closestX = Math.max(
        obstacle.x,
        Math.min(player.x, obstacle.x + obstacle.size)
      );
      const closestY = Math.max(
        obstacle.y,
        Math.min(player.y, obstacle.y + obstacle.size)
      );
      const distanceX = player.x - closestX;
      const distanceY = player.y - closestY;
      const distanceSquared = distanceX * distanceX + distanceY * distanceY;

      if (distanceSquared < playerRadius * playerRadius) {
        player.y = oldY;
        break;
      }
    }
  });

  const bulletsToRemove = new Set<string>();

  game.bullets.forEach((bullet) => {
    bullet.x += bullet.dx;
    bullet.y += bullet.dy;

    if (
      bullet.x < 0 ||
      bullet.x > GAME_CONFIG.ARENA_WIDTH ||
      bullet.y < 0 ||
      bullet.y > GAME_CONFIG.ARENA_HEIGHT
    ) {
      bulletsToRemove.add(bullet.id);
      return;
    }

    const hitObstacle = game.obstacles.find(
      (o) =>
        !o.destroyed &&
        bullet.x >= o.x &&
        bullet.x <= o.x + o.size &&
        bullet.y >= o.y &&
        bullet.y <= o.y + o.size
    );

    if (hitObstacle) {
      hitObstacle.destroyed = true;
      bulletsToRemove.add(bullet.id);
      broadcast(game, {
        type: "obstacleDestroyed",
        obstacleId: hitObstacle.id,
      });
      return;
    }

    // Use slightly generous hit detection for bullets
    const hitRadius = GAME_CONFIG.PLAYER_RADIUS * 1.2;
    const enemy = game.players.find(
      (p) =>
        p.id !== bullet.playerId &&
        p.hp > 0 &&
        Math.hypot(p.x - bullet.x, p.y - bullet.y) < hitRadius
    );

    if (enemy) {
      bulletsToRemove.add(bullet.id);

      enemy.hp -= bullet.damage;
      const shooter = game.players.find((p) => p.id === bullet.playerId);

      if (enemy.hp <= 0) {
        console.log(
          `☠️  ${enemy.username} was killed by ${shooter?.username || "Unknown"}!`
        );
        handleKill(shooter, enemy, bullet.weapon, game);
      }
    }
  });

  if (bulletsToRemove.size > 0) {
    game.bullets = game.bullets.filter(
      (b) => !bulletsToRemove.has(b.id)
    );
  }

  // Remove expired bullets
  const now = Date.now();
  game.bullets = game.bullets.filter(
    (b) => now - b.createdAt < GAME_CONFIG.BULLET_LIFETIME
  );

  // Remove expired pickups
  game.pickups = game.pickups.filter(
    (pk) => now - pk.createdAt < GAME_CONFIG.PICKUP_LIFETIME
  );

  // Check pickup collisions
  game.players.forEach((player) => {
    if (player.hp <= 0) return;
    const pickupsToRemove: string[] = [];
    game.pickups.forEach((pickup) => {
      const dx = player.x - pickup.x;
      const dy = player.y - pickup.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < GAME_CONFIG.PLAYER_RADIUS + GAME_CONFIG.PICKUP_RADIUS) {
        pickupsToRemove.push(pickup.id);
        applyPickup(player, pickup, game);
      }
    });
    if (pickupsToRemove.length > 0) {
      game.pickups = game.pickups.filter((pk) => !pickupsToRemove.includes(pk.id));
    }
  });

  // Check for bomb explosions
  const bombsToExplode: Bomb[] = [];
  game.bombs.forEach((bomb) => {
    if (now - bomb.createdAt >= GAME_CONFIG.BOMB_FUSE_TIME) {
      bombsToExplode.push(bomb);
    }
  });

  bombsToExplode.forEach((bomb) => {
    // Damage players in radius
    game.players.forEach((player) => {
      if (player.hp <= 0) return;
      const dx = player.x - bomb.x;
      const dy = player.y - bomb.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < GAME_CONFIG.BOMB_RADIUS) {
        player.hp -= GAME_CONFIG.BOMB_DAMAGE;
        if (player.hp <= 0) {
          player.hp = 0;
          handleKill(undefined, player, "bomb", game);
        }
      }
    });

    // Broadcast explosion
    broadcast(game, {
      type: "bombExploded",
      id: bomb.id,
      x: Math.round(bomb.x),
      y: Math.round(bomb.y),
      radius: GAME_CONFIG.BOMB_RADIUS,
    });
  });

  if (bombsToExplode.length > 0) {
    game.bombs = game.bombs.filter(
      (b) => !bombsToExplode.some((e) => e.id === b.id)
    );
  }

  // Weapon code mapping
  const weaponCodeMap: Record<string, number> = { machinegun: 0, shotgun: 1, knife: 2, minigun: 3 };

  // Delta detection
  const compactPlayers = serializePlayersCompact(game);
  const compactBullets = game.bullets.map((b) => [
    b.id,
    Math.round(b.x),
    Math.round(b.y),
    weaponCodeMap[b.weapon] ?? 0,
  ]);
  const compactPickups = game.pickups.map((pk) => [
    pk.id,
    Math.round(pk.x),
    Math.round(pk.y),
    pk.type === "health" ? 0 : pk.type === "ammo" ? 1 : pk.type === "speed" ? 2 : 3,
  ]);
  // Lightweight hash — avoid full JSON.stringify every tick
  let stateHash = game.bullets.length + ":" + game.pickups.length;
  for (const p of compactPlayers) {
    stateHash += ":" + (p as number[])[1] + "," + (p as number[])[2] + "," + (p as number[])[3] + "," + (p as number[])[9];
  }

  const lastHash = game.lastBroadcastState?.get("hash");
  if (stateHash === lastHash && compactBullets.length === 0) {
    return;
  }
  game.lastBroadcastState?.set("hash", stateHash);

  game.stateSequence++;
  broadcast(game, {
    type: "state",
    seq: game.stateSequence,
    p: compactPlayers,
    b: compactBullets,
    pk: compactPickups,
  });
}

/* ================= COMBAT ================= */

export function shoot(player: Player, game: Game, dirX: number, dirY: number) {
  if (player.hp <= 0) return;
  if (player.reloading) return;

  const now = Date.now();

  // Knife
  if (player.weapon === "knife") {
    const cooldown = GAME_CONFIG.KNIFE_COOLDOWN;
    if (now - player.lastShotTime < cooldown) return;

    player.lastShotTime = now;

    const meleeRange = GAME_CONFIG.KNIFE_RANGE;
    game.players.forEach((target) => {
      if (target.id === player.id || target.hp <= 0) return;

      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= meleeRange) {
        const targetAngle = Math.atan2(dy, dx);
        const playerAngle = Math.atan2(dirY, dirX);
        let angleDiff = Math.abs(targetAngle - playerAngle);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

        if (angleDiff < Math.PI / 2) {
          target.hp -= GAME_CONFIG.KNIFE_DAMAGE;

          if (target.hp <= 0) {
            handleKill(player, target, "knife", game);
          }
        }
      }
    });

    return;
  }

  // Minigun — infinite ammo, just needs cooldown
  if (player.weapon === "minigun") {
    const cooldown = GAME_CONFIG.MINIGUN_COOLDOWN;
    if (now - player.lastShotTime < cooldown) return;
    player.lastShotTime = now;

    const recoil = GAME_CONFIG.MINIGUN_RECOIL;
    const recoilAngle = (Math.random() - 0.5) * 2 * recoil;
    const cos = Math.cos(recoilAngle);
    const sin = Math.sin(recoilAngle);
    const finalDirX = dirX * cos - dirY * sin;
    const finalDirY = dirX * sin + dirY * cos;

    const bullet: Bullet = {
      id: uuid(),
      x: player.x,
      y: player.y,
      dx: finalDirX * GAME_CONFIG.BULLET_SPEED,
      dy: finalDirY * GAME_CONFIG.BULLET_SPEED,
      team: 0,
      playerId: player.id,
      damage: GAME_CONFIG.MINIGUN_DAMAGE,
      weapon: "minigun",
      createdAt: Date.now(),
    };
    game.bullets.push(bullet);
    return;
  }

  // Guns (all ranged weapons)
  if (player.shots <= 0) return;

  // Get weapon-specific cooldown
  let cooldown: number;
  switch (player.weapon) {
    case "machinegun": cooldown = GAME_CONFIG.MACHINEGUN_COOLDOWN; break;
    case "shotgun": cooldown = GAME_CONFIG.SHOTGUN_COOLDOWN; break;
    default: cooldown = GAME_CONFIG.MACHINEGUN_COOLDOWN;
  }
  if (now - player.lastShotTime < cooldown) return;

  player.lastShotTime = now;
  player.shots--;

  if (player.shots === 0) {
    player.reloading = true;
    setTimeout(() => {
      player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE;
      player.reloading = false;
    }, GAME_CONFIG.RELOAD_TIME);
  }

  // Shotgun fires multiple pellets
  if (player.weapon === "shotgun") {
    const pelletCount = GAME_CONFIG.SHOTGUN_PELLETS;
    const baseAngle = Math.atan2(dirY, dirX);
    for (let i = 0; i < pelletCount; i++) {
      const spreadAngle = baseAngle + (Math.random() - 0.5) * 2 * GAME_CONFIG.SHOTGUN_SPREAD;
      const pelletDirX = Math.cos(spreadAngle);
      const pelletDirY = Math.sin(spreadAngle);
      const speed = GAME_CONFIG.BULLET_SPEED * 0.9;
      const bullet: Bullet = {
        id: uuid(),
        x: player.x,
        y: player.y,
        dx: pelletDirX * speed,
        dy: pelletDirY * speed,
        team: 0,
        playerId: player.id,
        damage: GAME_CONFIG.SHOTGUN_DAMAGE,
        weapon: "shotgun",
        createdAt: Date.now(),
      };
      game.bullets.push(bullet);
    }
    return;
  }

  // Machine gun - apply recoil
  const recoil = GAME_CONFIG.MACHINEGUN_RECOIL;
  const recoilAngle = (Math.random() - 0.5) * 2 * recoil;
  const cos = Math.cos(recoilAngle);
  const sin = Math.sin(recoilAngle);
  const finalDirX = dirX * cos - dirY * sin;
  const finalDirY = dirX * sin + dirY * cos;

  const bullet: Bullet = {
    id: uuid(),
    x: player.x,
    y: player.y,
    dx: finalDirX * GAME_CONFIG.BULLET_SPEED,
    dy: finalDirY * GAME_CONFIG.BULLET_SPEED,
    team: 0,
    playerId: player.id,
    damage: GAME_CONFIG.MACHINEGUN_DAMAGE,
    weapon: "machinegun",
    createdAt: Date.now(),
  };

  game.bullets.push(bullet);
}

/* ================= MANUAL RELOAD ================= */

export function reloadWeapon(player: Player) {
  if (player.reloading) return;
  if (player.hp <= 0) return;
  if (player.weapon === "knife" || player.weapon === "minigun") return;
  if (player.shots >= GAME_CONFIG.SHOTS_PER_MAGAZINE) return;

  player.reloading = true;
  setTimeout(() => {
    player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE;
    player.reloading = false;
  }, GAME_CONFIG.RELOAD_TIME);
}

/* ================= PICKUPS ================= */

function applyPickup(player: Player, pickup: Pickup, game: Game) {
  switch (pickup.type) {
    case "health":
      player.hp = Math.min(GAME_CONFIG.PLAYER_HP, player.hp + GAME_CONFIG.PICKUP_HEALTH_AMOUNT);
      break;
    case "ammo":
      player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE;
      player.reloading = false;
      break;
    case "speed":
      player.speedBoostUntil = Date.now() + GAME_CONFIG.PICKUP_SPEED_DURATION;
      break;
    case "minigun":
      player.weapon = "minigun";
      player.minigunUntil = Date.now() + GAME_CONFIG.MINIGUN_DURATION;
      player.reloading = false;
      break;
  }

  broadcast(game, {
    type: "pickupCollected",
    pickupId: pickup.id,
    pickupType: pickup.type,
    playerId: player.id,
    x: Math.round(pickup.x),
    y: Math.round(pickup.y),
  });
}

export function spawnPickup(game: Game) {
  if (game.pickups.length >= GAME_CONFIG.MAX_PICKUPS) return;

  const types: Array<"health" | "ammo" | "speed" | "minigun"> = ["health", "ammo", "speed", "minigun"];
  const type = types[Math.floor(Math.random() * types.length)];

  let validPosition = false;
  let attempts = 0;
  let pickupX = 0;
  let pickupY = 0;

  while (!validPosition && attempts < 20) {
    pickupX = 60 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 120);
    pickupY = 60 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 120);

    validPosition = isPositionClear(pickupX, pickupY, game.obstacles, GAME_CONFIG.PICKUP_RADIUS * 2);

    // Don't spawn too close to players
    for (const player of game.players) {
      if (player.hp <= 0) continue;
      const dist = Math.sqrt((pickupX - player.x) ** 2 + (pickupY - player.y) ** 2);
      if (dist < 60) {
        validPosition = false;
        break;
      }
    }

    attempts++;
  }

  if (validPosition) {
    const pickup: Pickup = {
      id: uuid(),
      x: pickupX,
      y: pickupY,
      type,
      createdAt: Date.now(),
    };
    game.pickups.push(pickup);
  }
}

/* ================= BOMBS ================= */

export function spawnBomb(game: Game) {
  let validPosition = false;
  let attempts = 0;
  let bombX = 0;
  let bombY = 0;

  while (!validPosition && attempts < 20) {
    bombX = 60 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 120);
    bombY = 60 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 120);

    validPosition = isPositionClear(bombX, bombY, game.obstacles, 20);
    attempts++;
  }

  if (validPosition) {
    const bomb: Bomb = {
      id: uuid(),
      x: bombX,
      y: bombY,
      createdAt: Date.now(),
    };
    game.bombs.push(bomb);

    broadcast(game, {
      type: "bombSpawned",
      id: bomb.id,
      x: Math.round(bomb.x),
      y: Math.round(bomb.y),
    });
  }
}

/* ================= VICTORY ================= */

export function checkVictory(game: Game) {
  const winner = game.players.find(
    (p) => p.kills >= GAME_CONFIG.KILLS_TO_WIN
  );

  if (winner) {
    console.log(
      `🏆 ${winner.username} wins with ${winner.kills} kills! Game over.`
    );

    if (game.obstacleSpawnInterval) {
      clearInterval(game.obstacleSpawnInterval);
    }
    if (game.pickupSpawnInterval) {
      clearInterval(game.pickupSpawnInterval);
    }
    if (game.bombSpawnInterval) {
      clearInterval(game.bombSpawnInterval);
    }

    // Save stats for all players
    game.players.forEach((p) => {
      updatePlayerStats(p.username, p.kills, p.deaths, p.id === winner.id);
    });

    const scoreboard = game.players
      .map((p) => ({
        username: p.username,
        kills: p.kills,
        deaths: p.deaths,
        isWinner: p.id === winner.id,
      }))
      .sort((a, b) => b.kills - a.kills);

    // Save match history
    addMatchHistory({
      timestamp: Date.now(),
      players: scoreboard,
      winnerName: winner.username,
    });

    const endMessage = JSON.stringify({
      type: "end",
      winnerName: winner.username,
      scoreboard: scoreboard,
    });

    game.players.forEach((p) => {
      try {
        if (p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(endMessage);
        }
      } catch (error) {
        console.error(
          `Failed to send victory message to ${p.username}:`,
          error
        );
      }
    });

    game.players.forEach((p) => {
      const tracked = allPlayers.get(p.id);
      if (tracked) tracked.status = "online";
    });
    debouncedBroadcastOnlineList();

    // Send room list to all players so they can join a new room
    const roomList = Array.from(rooms.values()).map((r) => ({
      id: r.id,
      name: r.name,
      playerCount: r.players.length,
      maxPlayers: GAME_CONFIG.ROOM_MAX_PLAYERS,
    }));
    const roomListMsg = JSON.stringify({ type: "roomList", rooms: roomList });
    game.players.forEach((p) => {
      try {
        if (p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(roomListMsg);
          // Send updated match history
          const history = getMatchHistory(p.username, 10);
          if (history.length > 0) {
            p.ws.send(JSON.stringify({ type: "matchHistory", history }));
          }
        }
      } catch { /* ignore */ }
    });

    setTimeout(() => {
      games.delete(game.id);
    }, 2000);
  }
}

/* ================= RESPAWN ================= */

export function respawnPlayer(player: Player, game: Game) {
  let bestX = GAME_CONFIG.ARENA_WIDTH / 2;
  let bestY = GAME_CONFIG.ARENA_HEIGHT / 2;
  let bestDistance = 0;

  const alivePlayers = game.players.filter(
    (p) => p.hp > 0 && p.id !== player.id
  );

  for (let attempt = 0; attempt < 50; attempt++) {
    const testX = 50 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 100);
    const testY = 50 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 100);

    if (
      !isPositionClear(testX, testY, game.obstacles, GAME_CONFIG.PLAYER_RADIUS)
    ) {
      continue;
    }

    let minDist = Infinity;
    for (const other of alivePlayers) {
      const dist = Math.sqrt(
        (testX - other.x) ** 2 + (testY - other.y) ** 2
      );
      minDist = Math.min(minDist, dist);
    }

    if (minDist > bestDistance) {
      bestDistance = minDist;
      bestX = testX;
      bestY = testY;
    }
  }

  player.x = bestX;
  player.y = bestY;
  player.hp = GAME_CONFIG.PLAYER_HP;
  player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE;
  player.reloading = false;
  player.keys = { w: false, a: false, s: false, d: false };
  player.weapon = "machinegun";
  player.speedBoostUntil = 0;
  player.minigunUntil = 0;

  // Safety: push player out of any overlapping obstacles
  const pr = GAME_CONFIG.PLAYER_RADIUS;
  for (const obstacle of game.obstacles) {
    if (obstacle.destroyed) continue;
    const closestX = Math.max(obstacle.x, Math.min(player.x, obstacle.x + obstacle.size));
    const closestY = Math.max(obstacle.y, Math.min(player.y, obstacle.y + obstacle.size));
    const dx = player.x - closestX;
    const dy = player.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < pr) {
      if (dist === 0) {
        const ocx = obstacle.x + obstacle.size / 2;
        const ocy = obstacle.y + obstacle.size / 2;
        const awayX = player.x - ocx;
        const awayY = player.y - ocy;
        const awayDist = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
        player.x += (awayX / awayDist) * (pr + obstacle.size / 2);
        player.y += (awayY / awayDist) * (pr + obstacle.size / 2);
      } else {
        const overlap = pr - dist;
        player.x += (dx / dist) * overlap;
        player.y += (dy / dist) * overlap;
      }
    }
  }
  // Clamp to arena bounds
  player.x = Math.max(pr, Math.min(GAME_CONFIG.ARENA_WIDTH - pr, player.x));
  player.y = Math.max(pr, Math.min(GAME_CONFIG.ARENA_HEIGHT - pr, player.y));

  console.log(
    `🔄 ${player.username} respawned at (${Math.round(player.x)}, ${Math.round(player.y)})`
  );

  broadcast(game, {
    type: "respawn",
    playerId: player.id,
    x: Math.round(bestX),
    y: Math.round(bestY),
  });
}

/* ================= OBSTACLE SPAWNING ================= */

export function spawnRandomObstacle(game: Game) {
  const isTree = Math.random() > 0.6;
  let validPosition = false;
  let attempts = 0;
  let obstacleX = 0,
    obstacleY = 0;
  const size = isTree
    ? OBSTACLE_CONFIG.TREE_SIZE
    : OBSTACLE_CONFIG.WALL_BLOCK_SIZE;

  while (!validPosition && attempts < 20) {
    obstacleX = 80 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 160);
    obstacleY = 80 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 160);

    validPosition = true;

    for (const player of game.players) {
      const dist = Math.sqrt(
        (obstacleX - player.x) ** 2 + (obstacleY - player.y) ** 2
      );
      if (dist < 80) {
        validPosition = false;
        break;
      }
    }

    for (const obs of game.obstacles) {
      if (obs.destroyed) continue;
      const dist = Math.sqrt(
        (obstacleX - obs.x) ** 2 + (obstacleY - obs.y) ** 2
      );
      if (dist < 40) {
        validPosition = false;
        break;
      }
    }

    attempts++;
  }

  if (validPosition) {
    const newObstacle = {
      id: uuid(),
      x: obstacleX,
      y: obstacleY,
      size: size,
      destroyed: false,
      type: isTree ? "tree" : "wall",
    };

    game.obstacles.push(newObstacle);

    broadcast(game, {
      type: "newObstacle",
      obstacle: newObstacle,
    });
  }
}

/* ================= GAME TICK ================= */

export function startGameLoop() {
  setInterval(() => {
    games.forEach((game) => {
      if (game.started) {
        updateGame(game);
      }
    });
  }, 1000 / GAME_CONFIG.TICK_RATE);
}
