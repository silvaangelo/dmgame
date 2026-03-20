import { randomUUID as uuid } from "crypto";
import { WebSocket } from "ws";
import type { Player, Bullet, Game, Pickup, Bomb, Lightning, LootCrate, Orb, Obstacle } from "./types.js";
import { GAME_CONFIG, OBSTACLE_CONFIG } from "./config.js";
import { games, allPlayers, setPersistentGame, persistentGame } from "./state.js";
import {
  broadcast,
  isPositionClear,
  debouncedBroadcastOnlineList,
} from "./utils.js";
import { updatePlayerStats, addMatchHistory } from "./database.js";
import { serialize, encodeBinaryState } from "./protocol.js";
import { SpatialGrid } from "./spatial.js";

/* ================= SPATIAL GRIDS (reused each tick) ================= */
const CELL_SIZE = 200;
const obstacleGrid = new SpatialGrid<Obstacle>(CELL_SIZE, GAME_CONFIG.ARENA_WIDTH);
const playerGrid = new SpatialGrid<Player>(CELL_SIZE, GAME_CONFIG.ARENA_WIDTH);

/** The culling margin beyond each player's viewport in pixels. */
const CULL_MARGIN = 1400;

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

  // Drop half of victim's score as orbs on the ground
  dropScoreOrbs(victim, game);

  // Mark victim as waiting for manual respawn
  victim.waitingForRespawn = true;

  if (killer && killer.id !== victim.id) {
    killer.kills++;
    killer.killStreak++;
    killer.score += GAME_CONFIG.KILL_SCORE; // +10 points per kill

    // Heal on kill — recover 1 HP (capped at max)
    const maxHp = GAME_CONFIG.PLAYER_HP;
    killer.hp = Math.min(maxHp, killer.hp + 1);

    // Revenge tracking
    const isRevenge = victim.lastKilledBy === "" ? false : killer.lastKilledBy === victim.id;

    broadcast(game, {
      type: "kill",
      killer: killer.username,
      victim: victim.username,
      weapon,
      isRevenge,
      droppedScore: Math.floor(victim.score * GAME_CONFIG.DEATH_ORB_DROP_FRACTION),
    });

    // Track who killed this victim
    victim.lastKilledBy = killer.id;
    // Reset killer's revenge after they got it
    if (isRevenge) killer.lastKilledBy = "";

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
      isRevenge: false,
      droppedScore: Math.floor(victim.score * GAME_CONFIG.DEATH_ORB_DROP_FRACTION),
    });
  }

  // Deduct the dropped score from victim
  const dropped = Math.floor(victim.score * GAME_CONFIG.DEATH_ORB_DROP_FRACTION);
  victim.score = Math.max(0, victim.score - dropped);

  checkVictory(game);
}

/* ================= HELPERS ================= */

/** Drop a fraction of the victim's score as collectible orbs at their death position */
function dropScoreOrbs(victim: Player, game: Game) {
  const scoreToDrop = Math.floor(victim.score * GAME_CONFIG.DEATH_ORB_DROP_FRACTION);
  if (scoreToDrop <= 0) return;

  // Each orb is worth 1 point, spawn them in a cluster around death position
  const orbCount = Math.min(scoreToDrop, 30); // Cap at 30 orbs to avoid spam
  const spread = 60; // pixels spread radius

  for (let i = 0; i < orbCount; i++) {
    const angle = (i / orbCount) * Math.PI * 2;
    const dist = 15 + Math.random() * spread;
    const orbX = Math.max(20, Math.min(GAME_CONFIG.ARENA_WIDTH - 20, victim.x + Math.cos(angle) * dist));
    const orbY = Math.max(20, Math.min(GAME_CONFIG.ARENA_HEIGHT - 20, victim.y + Math.sin(angle) * dist));

    const orb: Orb = {
      id: uuid(),
      shortId: game.nextShortId++,
      x: orbX,
      y: orbY,
      createdAt: Date.now(),
    };
    game.orbs.push(orb);
  }
}

function getPlayerSpeed(player: Player): number {
  const knifeBonus = player.weapon === "knife" ? GAME_CONFIG.KNIFE_SPEED_BONUS : 1;
  const speedBoost = Date.now() < player.speedBoostUntil ? GAME_CONFIG.PICKUP_SPEED_MULTIPLIER : 1;
  return GAME_CONFIG.PLAYER_SPEED * knifeBonus * speedBoost;
}

/* ================= GAME LOOP ================= */

export function updateGame(game: Game) {
  // ── Build spatial grids for this tick ──
  obstacleGrid.clear();
  for (const obs of game.obstacles) {
    if (!obs.destroyed) obstacleGrid.insert(obs);
  }

  game.players.forEach((player) => {
    if (player.hp <= 0) return;

    // Check minigun expiry
    if (player.weapon === "minigun" && Date.now() >= player.minigunUntil) {
      player.weapon = "machinegun";
      player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE;
      player.reloading = false;
    }

    const playerRadius = GAME_CONFIG.PLAYER_RADIUS;
    const margin = playerRadius;

    // Dash movement overrides normal movement
    const isDashing = Date.now() < player.dashUntil;
    const radiusSqDash = playerRadius * playerRadius;
    if (isDashing) {
      const dashSpeed = GAME_CONFIG.DASH_SPEED;
      // Move in dash direction with push-out collision
      player.x += player.dashDirX * dashSpeed;
      player.x = Math.max(margin, Math.min(GAME_CONFIG.ARENA_WIDTH - margin, player.x));
      const dashNearbyX = obstacleGrid.queryRadius(player.x, player.y, playerRadius + 60);
      for (const obstacle of dashNearbyX) {
        const closestX = Math.max(obstacle.x, Math.min(player.x, obstacle.x + obstacle.size));
        const closestY = Math.max(obstacle.y, Math.min(player.y, obstacle.y + obstacle.size));
        const distanceX = player.x - closestX;
        const distanceY = player.y - closestY;
        const dSq = distanceX * distanceX + distanceY * distanceY;
        if (dSq < radiusSqDash) {
          if (dSq > 0.0001) {
            const dist = Math.sqrt(dSq);
            player.x += (distanceX / dist) * (playerRadius - dist);
          } else {
            player.x = obstacle.x + obstacle.size / 2 < player.x
              ? obstacle.x + obstacle.size + playerRadius
              : obstacle.x - playerRadius;
          }
        }
      }
      player.x = Math.max(margin, Math.min(GAME_CONFIG.ARENA_WIDTH - margin, player.x));

      player.y += player.dashDirY * dashSpeed;
      player.y = Math.max(margin, Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, player.y));
      const dashNearbyY = obstacleGrid.queryRadius(player.x, player.y, playerRadius + 60);
      for (const obstacle of dashNearbyY) {
        const closestX = Math.max(obstacle.x, Math.min(player.x, obstacle.x + obstacle.size));
        const closestY = Math.max(obstacle.y, Math.min(player.y, obstacle.y + obstacle.size));
        const distanceX = player.x - closestX;
        const distanceY = player.y - closestY;
        const dSq = distanceX * distanceX + distanceY * distanceY;
        if (dSq < radiusSqDash) {
          if (dSq > 0.0001) {
            const dist = Math.sqrt(dSq);
            player.y += (distanceY / dist) * (playerRadius - dist);
          } else {
            player.y = obstacle.y + obstacle.size / 2 < player.y
              ? obstacle.y + obstacle.size + playerRadius
              : obstacle.y - playerRadius;
          }
        }
      }
      player.y = Math.max(margin, Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, player.y));
      return; // Skip normal movement during dash
    }

    const speed = getPlayerSpeed(player);
    const radiusSq = playerRadius * playerRadius;

    // Move X axis first, then resolve collisions on X (push-out)
    if (player.keys.a) player.x -= speed;
    if (player.keys.d) player.x += speed;
    player.x = Math.max(
      margin,
      Math.min(GAME_CONFIG.ARENA_WIDTH - margin, player.x)
    );

    const nearbyObsX = obstacleGrid.queryRadius(player.x, player.y, playerRadius + 50);
    for (const obstacle of nearbyObsX) {
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

      if (distanceSquared < radiusSq) {
        if (distanceSquared > 0.0001) {
          const dist = Math.sqrt(distanceSquared);
          player.x += (distanceX / dist) * (playerRadius - dist);
        } else {
          // Exactly overlapping — push away from obstacle center
          player.x = obstacle.x + obstacle.size / 2 < player.x
            ? obstacle.x + obstacle.size + playerRadius
            : obstacle.x - playerRadius;
        }
      }
    }
    player.x = Math.max(
      margin,
      Math.min(GAME_CONFIG.ARENA_WIDTH - margin, player.x)
    );

    // Move Y axis, then resolve collisions on Y (push-out)
    if (player.keys.w) player.y -= speed;
    if (player.keys.s) player.y += speed;
    player.y = Math.max(
      margin,
      Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, player.y)
    );

    const nearbyObsY = obstacleGrid.queryRadius(player.x, player.y, playerRadius + 50);
    for (const obstacle of nearbyObsY) {
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

      if (distanceSquared < radiusSq) {
        if (distanceSquared > 0.0001) {
          const dist = Math.sqrt(distanceSquared);
          player.y += (distanceY / dist) * (playerRadius - dist);
        } else {
          player.y = obstacle.y + obstacle.size / 2 < player.y
            ? obstacle.y + obstacle.size + playerRadius
            : obstacle.y - playerRadius;
        }
      }
    }
    player.y = Math.max(
      margin,
      Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, player.y)
    );
  });

  // Build player grid after all movement is resolved
  playerGrid.clear();
  for (const p of game.players) {
    if (p.hp > 0) playerGrid.insert(p);
  }

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

    // Swept collision: check the line segment from previous to current position
    // so fast bullets can't tunnel through small obstacles.
    const prevBx = bullet.x - bullet.dx;
    const prevBy = bullet.y - bullet.dy;
    const sweepMinX = Math.min(prevBx, bullet.x);
    const sweepMinY = Math.min(prevBy, bullet.y);
    const sweepMaxX = Math.max(prevBx, bullet.x);
    const sweepMaxY = Math.max(prevBy, bullet.y);
    const sweepR = Math.max(Math.abs(bullet.dx), Math.abs(bullet.dy)) + 40;
    const nearbyObs = obstacleGrid.queryRadius(
      (prevBx + bullet.x) * 0.5, (prevBy + bullet.y) * 0.5, sweepR
    );
    let hitObstacle: Obstacle | undefined;
    for (const o of nearbyObs) {
      // Broad-phase: AABB overlap between swept bullet rect and obstacle rect
      if (
        sweepMaxX >= o.x && sweepMinX <= o.x + o.size &&
        sweepMaxY >= o.y && sweepMinY <= o.y + o.size
      ) {
        hitObstacle = o;
        break;
      }
    }

    if (hitObstacle) {
      hitObstacle.destroyed = true;
      bulletsToRemove.add(bullet.id);
      const destroyedIds = [hitObstacle.id];

      // If this wall block belongs to a group, check if the remaining group is ≤ 1 block
      if (hitObstacle.groupId) {
        const groupSiblings = game.obstacles.filter(
          (o) => o.groupId === hitObstacle.groupId && !o.destroyed && o.id !== hitObstacle.id
        );
        if (groupSiblings.length <= 1) {
          // Destroy remaining sibling(s) too — no single-block walls
          groupSiblings.forEach((o) => {
            o.destroyed = true;
            destroyedIds.push(o.id);
          });
        }
      }

      broadcast(game, {
        type: "obstacleDestroyed",
        obstacleId: hitObstacle.id,
        destroyedIds,
      });
      return;
    }

    // Loot crate bullet collision
    const crateHalf = GAME_CONFIG.LOOT_CRATE_SIZE / 2;
    const hitCrate = game.lootCrates.find(
      (c) =>
        bullet.x >= c.x - crateHalf &&
        bullet.x <= c.x + crateHalf &&
        bullet.y >= c.y - crateHalf &&
        bullet.y <= c.y + crateHalf
    );
    if (hitCrate) {
      bulletsToRemove.add(bullet.id);
      hitCrate.hp--;
      if (hitCrate.hp <= 0) {
        destroyLootCrate(hitCrate, game);
      } else {
        broadcast(game, {
          type: "crateHit",
          crateId: hitCrate.id,
          hp: hitCrate.hp,
        });
      }
      return;
    }

    // Use slightly generous hit detection for bullets
    const hitRadiusSq = (GAME_CONFIG.PLAYER_RADIUS * 1.2) ** 2;
    const nearbyPlayers = playerGrid.queryRadius(bullet.x, bullet.y, GAME_CONFIG.PLAYER_RADIUS * 1.5);
    let enemy: Player | undefined;
    for (const p of nearbyPlayers) {
      if (p.id === bullet.playerId || p.hp <= 0) continue;
      // Dash invincibility — can't be hit while dashing
      if (GAME_CONFIG.DASH_INVINCIBLE && Date.now() < p.dashUntil) continue;
      const bdx = p.x - bullet.x;
      const bdy = p.y - bullet.y;
      if (bdx * bdx + bdy * bdy < hitRadiusSq) {
        enemy = p;
        break;
      }
    }

    if (enemy) {
      bulletsToRemove.add(bullet.id);

      // Shield absorption
      const shieldActive = Date.now() < enemy.shieldUntil;
      if (shieldActive) {
        // Shield absorbs damage — reduce shield time instead
        enemy.shieldUntil -= 1500; // each hit drains 1.5s of shield
        // Knockback still applies
      } else if (enemy.armor > 0) {
        // Armor absorbs damage first
        const armorAbsorb = Math.min(enemy.armor, bullet.damage);
        enemy.armor -= armorAbsorb;
        const remaining = bullet.damage - armorAbsorb;
        if (remaining > 0) {
          enemy.hp -= remaining;
        }
      } else {
        enemy.hp -= bullet.damage;
      }

      // Knockback — small push away from bullet direction
      const knockbackForce = 3;
      const bulletLen = Math.sqrt(bullet.dx * bullet.dx + bullet.dy * bullet.dy);
      if (bulletLen > 0) {
        const kbX = (bullet.dx / bulletLen) * knockbackForce;
        const kbY = (bullet.dy / bulletLen) * knockbackForce;
        enemy.x = Math.max(GAME_CONFIG.PLAYER_RADIUS, Math.min(GAME_CONFIG.ARENA_WIDTH - GAME_CONFIG.PLAYER_RADIUS, enemy.x + kbX));
        enemy.y = Math.max(GAME_CONFIG.PLAYER_RADIUS, Math.min(GAME_CONFIG.ARENA_HEIGHT - GAME_CONFIG.PLAYER_RADIUS, enemy.y + kbY));
      }

      const shooter = game.players.find((p) => p.id === bullet.playerId);

      if (enemy.hp <= 0) {
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
    const pickupCollisionDist = GAME_CONFIG.PLAYER_RADIUS + GAME_CONFIG.PICKUP_RADIUS;
    const pickupCollisionDistSq = pickupCollisionDist * pickupCollisionDist;
    game.pickups.forEach((pickup) => {
      const dx = player.x - pickup.x;
      const dy = player.y - pickup.y;
      if (dx * dx + dy * dy < pickupCollisionDistSq) {
        pickupsToRemove.push(pickup.id);
        applyPickup(player, pickup, game);
      }
    });
    if (pickupsToRemove.length > 0) {
      game.pickups = game.pickups.filter((pk) => !pickupsToRemove.includes(pk.id));
    }
  });

  // Remove expired orbs
  game.orbs = game.orbs.filter(
    (orb) => now - orb.createdAt < GAME_CONFIG.ORB_LIFETIME
  );

  // Check orb collisions
  const orbCollisionDist = GAME_CONFIG.PLAYER_RADIUS + GAME_CONFIG.ORB_RADIUS;
  const orbCollisionDistSq = orbCollisionDist * orbCollisionDist;
  game.players.forEach((player) => {
    if (player.hp <= 0) return;
    const orbsToRemove: string[] = [];
    game.orbs.forEach((orb) => {
      const dx = player.x - orb.x;
      const dy = player.y - orb.y;
      if (dx * dx + dy * dy < orbCollisionDistSq) {
        orbsToRemove.push(orb.id);
        player.score += GAME_CONFIG.ORB_SCORE;
        broadcast(game, {
          type: "orbCollected",
          orbId: orb.id,
          playerId: player.id,
        });
      }
    });
    if (orbsToRemove.length > 0) {
      game.orbs = game.orbs.filter((o) => !orbsToRemove.includes(o.id));
    }
  });

  // Check for bomb explosions
  const bombsToExplode: Bomb[] = [];
  game.bombs.forEach((bomb) => {
    if (now - bomb.createdAt >= GAME_CONFIG.BOMB_FUSE_TIME) {
      bombsToExplode.push(bomb);
    }
  });

  const bombRadiusSq = GAME_CONFIG.BOMB_RADIUS * GAME_CONFIG.BOMB_RADIUS;
  bombsToExplode.forEach((bomb) => {
    // Damage players in radius
    game.players.forEach((player) => {
      if (player.hp <= 0) return;
      const dx = player.x - bomb.x;
      const dy = player.y - bomb.y;
      if (dx * dx + dy * dy < bombRadiusSq) {
        if (Date.now() < player.shieldUntil) {
          player.shieldUntil -= 1500;
        } else {
          player.hp -= GAME_CONFIG.BOMB_DAMAGE;
          if (player.hp <= 0) {
            player.hp = 0;
            handleKill(undefined, player, "bomb", game);
          }
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

  // Check for lightning strikes
  const lightningsToStrike: Lightning[] = [];
  game.lightnings.forEach((lightning) => {
    if (now - lightning.createdAt >= GAME_CONFIG.LIGHTNING_FUSE_TIME) {
      lightningsToStrike.push(lightning);
    }
  });

  const lightningRadiusSq = GAME_CONFIG.LIGHTNING_RADIUS * GAME_CONFIG.LIGHTNING_RADIUS;
  lightningsToStrike.forEach((lightning) => {
    // Damage players in radius
    game.players.forEach((player) => {
      if (player.hp <= 0) return;
      const dx = player.x - lightning.x;
      const dy = player.y - lightning.y;
      if (dx * dx + dy * dy < lightningRadiusSq) {
        if (Date.now() < player.shieldUntil) {
          player.shieldUntil -= 1500;
        } else {
          player.hp -= GAME_CONFIG.LIGHTNING_DAMAGE;
          if (player.hp <= 0) {
            player.hp = 0;
            handleKill(undefined, player, "lightning", game);
          }
        }
      }
    });

    // Broadcast lightning strike
    broadcast(game, {
      type: "lightningStruck",
      id: lightning.id,
      x: Math.round(lightning.x),
      y: Math.round(lightning.y),
      radius: GAME_CONFIG.LIGHTNING_RADIUS,
    });
  });

  if (lightningsToStrike.length > 0) {
    game.lightnings = game.lightnings.filter(
      (l) => !lightningsToStrike.some((e) => e.id === l.id)
    );
  }

  // Health regen tick
  game.players.forEach((player) => {
    if (player.hp <= 0) return;
    if (now < player.regenUntil && now - player.lastRegenTick >= GAME_CONFIG.REGEN_TICK_INTERVAL) {
      player.hp = Math.min(GAME_CONFIG.PLAYER_HP, player.hp + 1);
      player.lastRegenTick = now;
    }
  });

  // ── Per-player viewport-culled binary state broadcast ──
  game.stateSequence++;
  const seq = game.stateSequence;
  const zone = game.zoneShrinking ? {
    x: game.zoneX, y: game.zoneY, w: game.zoneW, h: game.zoneH,
  } : null;

  for (const viewer of game.players) {
    if (viewer.ws.readyState !== WebSocket.OPEN) continue;

    const vx = viewer.x;
    const vy = viewer.y;
    const half = CULL_MARGIN;

    // Cull entities to viewer's viewport
    const visPlayers = game.players.filter((p) => {
      // Always include the viewer themselves
      if (p.id === viewer.id) return true;
      return Math.abs(p.x - vx) < half && Math.abs(p.y - vy) < half;
    });
    const visBullets = game.bullets.filter((b) =>
      Math.abs(b.x - vx) < half && Math.abs(b.y - vy) < half
    );
    const visPickups = game.pickups.filter((pk) =>
      Math.abs(pk.x - vx) < half && Math.abs(pk.y - vy) < half
    );
    const visOrbs = game.orbs.filter((o) =>
      Math.abs(o.x - vx) < half && Math.abs(o.y - vy) < half
    );
    const visCrates = game.lootCrates.filter((c) =>
      Math.abs(c.x - vx) < half && Math.abs(c.y - vy) < half
    );

    const buf = encodeBinaryState({
      seq,
      isDelta: false,
      players: visPlayers,
      bullets: visBullets,
      pickups: visPickups,
      orbs: visOrbs,
      crates: visCrates,
      zone,
    });

    try {
      viewer.ws.send(buf);
    } catch { /* socket closed between readyState check and send */ }
  }
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
    const meleeRangeSq = meleeRange * meleeRange;
    game.players.forEach((target) => {
      if (target.id === player.id || target.hp <= 0) return;
      // Dash invincibility — can't be hit while dashing
      if (GAME_CONFIG.DASH_INVINCIBLE && Date.now() < target.dashUntil) return;

      const dx = target.x - player.x;
      const dy = target.y - player.y;

      if (dx * dx + dy * dy <= meleeRangeSq) {
        const targetAngle = Math.atan2(dy, dx);
        const playerAngle = Math.atan2(dirY, dirX);
        let angleDiff = Math.abs(targetAngle - playerAngle);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

        if (angleDiff < Math.PI / 2) {
          // Shield absorption for knife
          if (Date.now() < target.shieldUntil) {
            target.shieldUntil -= 1500;
          } else if (target.armor > 0) {
            const armorAbsorb = Math.min(target.armor, GAME_CONFIG.KNIFE_DAMAGE);
            target.armor -= armorAbsorb;
            const remaining = GAME_CONFIG.KNIFE_DAMAGE - armorAbsorb;
            if (remaining > 0) target.hp -= remaining;
          } else {
            target.hp -= GAME_CONFIG.KNIFE_DAMAGE;
          }

          // Knockback — push target away from attacker
          const knifeKnockback = 5;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          target.x = Math.max(GAME_CONFIG.PLAYER_RADIUS, Math.min(GAME_CONFIG.ARENA_WIDTH - GAME_CONFIG.PLAYER_RADIUS, target.x + (dx / dist) * knifeKnockback));
          target.y = Math.max(GAME_CONFIG.PLAYER_RADIUS, Math.min(GAME_CONFIG.ARENA_HEIGHT - GAME_CONFIG.PLAYER_RADIUS, target.y + (dy / dist) * knifeKnockback));

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
      shortId: game.nextShortId++,
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

  // Sniper — high damage, slow fire, fast bullet
  if (player.weapon === "sniper") {
    const cooldown = GAME_CONFIG.SNIPER_COOLDOWN;
    if (now - player.lastShotTime < cooldown) return;
    if (player.shots <= 0) return;
    player.lastShotTime = now;
    player.shots--;
    if (player.shots === 0) {
      player.reloading = true;
      setTimeout(() => { player.shots = GAME_CONFIG.SNIPER_AMMO; player.reloading = false; }, GAME_CONFIG.SNIPER_RELOAD_TIME);
    }
    const bullet: Bullet = {
      id: uuid(), shortId: game.nextShortId++, x: player.x, y: player.y,
      dx: dirX * GAME_CONFIG.SNIPER_BULLET_SPEED,
      dy: dirY * GAME_CONFIG.SNIPER_BULLET_SPEED,
      team: 0, playerId: player.id,
      damage: GAME_CONFIG.SNIPER_DAMAGE, weapon: "sniper",
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
    const reloadTime = player.weapon === "shotgun" ? GAME_CONFIG.SHOTGUN_RELOAD_TIME : GAME_CONFIG.MACHINEGUN_RELOAD_TIME;
    const refillAmount = player.weapon === "shotgun" ? GAME_CONFIG.SHOTGUN_AMMO : GAME_CONFIG.SHOTS_PER_MAGAZINE;
    setTimeout(() => {
      player.shots = refillAmount;
      player.reloading = false;
    }, reloadTime);
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
        shortId: game.nextShortId++,
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
    shortId: game.nextShortId++,
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

  // Check if already full
  const maxAmmo = player.weapon === "shotgun" ? GAME_CONFIG.SHOTGUN_AMMO
    : player.weapon === "sniper" ? GAME_CONFIG.SNIPER_AMMO
    : GAME_CONFIG.SHOTS_PER_MAGAZINE;
  if (player.shots >= maxAmmo) return;

  player.reloading = true;
  let reloadTime: number;
  switch (player.weapon) {
    case "sniper": reloadTime = GAME_CONFIG.SNIPER_RELOAD_TIME; break;
    case "shotgun": reloadTime = GAME_CONFIG.SHOTGUN_RELOAD_TIME; break;
    case "machinegun": reloadTime = GAME_CONFIG.MACHINEGUN_RELOAD_TIME; break;
    default: reloadTime = GAME_CONFIG.RELOAD_TIME;
  }
  setTimeout(() => {
    player.shots = maxAmmo;
    player.reloading = false;
  }, reloadTime);
}

/* ================= PICKUPS ================= */

function applyPickup(player: Player, pickup: Pickup, game: Game) {
  const maxHp = GAME_CONFIG.PLAYER_HP;
  switch (pickup.type) {
    case "health":
      player.hp = Math.min(maxHp, player.hp + GAME_CONFIG.PICKUP_HEALTH_AMOUNT);
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
    case "shield":
      player.shieldUntil = Date.now() + GAME_CONFIG.SHIELD_DURATION;
      break;
    case "invisibility":
      player.invisibleUntil = Date.now() + GAME_CONFIG.INVISIBILITY_DURATION;
      break;
    case "regen":
      player.regenUntil = Date.now() + GAME_CONFIG.REGEN_DURATION;
      player.lastRegenTick = Date.now();
      break;
    case "armor":
      player.armor = Math.min(GAME_CONFIG.ARMOR_MAX, player.armor + GAME_CONFIG.ARMOR_AMOUNT);
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

  const types: Array<"health" | "ammo" | "speed" | "minigun" | "shield" | "invisibility" | "regen" | "armor"> = ["health", "ammo", "speed", "minigun", "shield", "invisibility", "regen", "armor"];
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
      shortId: game.nextShortId++,
      x: pickupX,
      y: pickupY,
      type,
      createdAt: Date.now(),
    };
    game.pickups.push(pickup);
  }
}

/* ================= ORBS (Slither-style points) ================= */

export function spawnOrb(game: Game) {
  if (game.orbs.length >= GAME_CONFIG.ORB_MAX) return;

  // Spawn a batch of 3-5 orbs at once for slither feel
  const batchSize = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < batchSize; i++) {
    if (game.orbs.length >= GAME_CONFIG.ORB_MAX) break;

    let validPosition = false;
    let attempts = 0;
    let orbX = 0;
    let orbY = 0;

    while (!validPosition && attempts < 20) {
      orbX = 40 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 80);
      orbY = 40 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 80);
      validPosition = isPositionClear(orbX, orbY, game.obstacles, GAME_CONFIG.ORB_RADIUS);
      attempts++;
    }

    if (validPosition) {
      const orb: Orb = {
        id: uuid(),
        shortId: game.nextShortId++,
        x: orbX,
        y: orbY,
        createdAt: Date.now(),
      };
      game.orbs.push(orb);
    }
  }
}

export function spawnInitialOrbs(game: Game) {
  for (let i = 0; i < 15; i++) {
    spawnOrb(game);
  }
}

/* ================= LOOT CRATES ================= */

function destroyLootCrate(crate: LootCrate, game: Game) {
  game.lootCrates = game.lootCrates.filter((c) => c.id !== crate.id);

  // Drop a random pickup at the crate's position
  const types: Array<Pickup["type"]> = ["health", "ammo", "speed", "minigun", "shield", "invisibility", "regen", "armor"];
  const type = types[Math.floor(Math.random() * types.length)];
  const pickup: Pickup = {
    id: uuid(),
    shortId: game.nextShortId++,
    x: crate.x,
    y: crate.y,
    type,
    createdAt: Date.now(),
  };
  game.pickups.push(pickup);

  broadcast(game, {
    type: "crateDestroyed",
    crateId: crate.id,
    pickup: { id: pickup.id, x: Math.round(pickup.x), y: Math.round(pickup.y), type: pickup.type },
  });
}

export function spawnLootCrate(game: Game) {
  if (game.lootCrates.length >= GAME_CONFIG.LOOT_CRATE_MAX) return;

  let validPosition = false;
  let attempts = 0;
  let crateX = 0;
  let crateY = 0;

  while (!validPosition && attempts < 20) {
    crateX = 80 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 160);
    crateY = 80 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 160);

    validPosition = isPositionClear(crateX, crateY, game.obstacles, GAME_CONFIG.LOOT_CRATE_SIZE);

    // Don't spawn too close to players
    for (const player of game.players) {
      if (player.hp <= 0) continue;
      const dist = Math.sqrt((crateX - player.x) ** 2 + (crateY - player.y) ** 2);
      if (dist < 80) {
        validPosition = false;
        break;
      }
    }

    attempts++;
  }

  if (validPosition) {
    const crate: LootCrate = {
      id: uuid(),
      shortId: game.nextShortId++,
      x: crateX,
      y: crateY,
      hp: GAME_CONFIG.LOOT_CRATE_HP,
      createdAt: Date.now(),
    };
    game.lootCrates.push(crate);

    broadcast(game, {
      type: "crateSpawned",
      crate: { id: crate.id, x: Math.round(crate.x), y: Math.round(crate.y), hp: crate.hp },
    });
  }
}

export function spawnInitialLootCrates(game: Game) {
  for (let i = 0; i < GAME_CONFIG.LOOT_CRATE_COUNT; i++) {
    spawnLootCrate(game);
  }
}

/* ================= DASH ================= */

export function performDash(player: Player) {
  const now = Date.now();
  if (player.hp <= 0) return;
  if (now < player.dashCooldownUntil) return;

  // Determine dash direction from current movement keys, or aim direction as fallback
  let dirX = 0;
  let dirY = 0;
  if (player.keys.a) dirX -= 1;
  if (player.keys.d) dirX += 1;
  if (player.keys.w) dirY -= 1;
  if (player.keys.s) dirY += 1;

  if (dirX === 0 && dirY === 0) {
    // Dash in aim direction
    dirX = Math.cos(player.aimAngle);
    dirY = Math.sin(player.aimAngle);
  }

  // Normalize
  const mag = Math.sqrt(dirX * dirX + dirY * dirY);
  if (mag > 0) {
    dirX /= mag;
    dirY /= mag;
  }

  player.dashDirX = dirX;
  player.dashDirY = dirY;
  player.dashUntil = now + GAME_CONFIG.DASH_DURATION;
  player.dashCooldownUntil = now + GAME_CONFIG.DASH_COOLDOWN;
}

/* ================= BOMBS ================= */

export function spawnBomb(game: Game) {
  const count = 1 + Math.floor(Math.random() * 2); // 1–2 bombs per spawn
  for (let i = 0; i < count; i++) {
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
}

/* ================= LIGHTNING STRIKES ================= */

export function spawnLightning(game: Game) {
  let validPosition = false;
  let attempts = 0;
  let lightningX = 0;
  let lightningY = 0;

  while (!validPosition && attempts < 20) {
    lightningX = 60 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 120);
    lightningY = 60 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 120);

    validPosition = isPositionClear(lightningX, lightningY, game.obstacles, 20);
    attempts++;
  }

  if (validPosition) {
    const lightning: Lightning = {
      id: uuid(),
      x: lightningX,
      y: lightningY,
      createdAt: Date.now(),
    };
    game.lightnings.push(lightning);

    broadcast(game, {
      type: "lightningWarning",
      id: lightning.id,
      x: Math.round(lightning.x),
      y: Math.round(lightning.y),
      radius: GAME_CONFIG.LIGHTNING_RADIUS,
    });
  }
}

/* ================= VICTORY ================= */

function clearGameIntervals(game: Game) {
  if (game.obstacleSpawnInterval) clearInterval(game.obstacleSpawnInterval);
  if (game.pickupSpawnInterval) clearInterval(game.pickupSpawnInterval);
  if (game.orbSpawnInterval) clearInterval(game.orbSpawnInterval);
  if (game.bombSpawnInterval) clearTimeout(game.bombSpawnInterval);
  if (game.lightningSpawnInterval) clearTimeout(game.lightningSpawnInterval);
  if (game.zoneShrinkInterval) clearInterval(game.zoneShrinkInterval);
  if (game.zoneDamageInterval) clearInterval(game.zoneDamageInterval);
  if (game.lootCrateSpawnInterval) clearInterval(game.lootCrateSpawnInterval);
  if (game.gameTimerTimeout) clearTimeout(game.gameTimerTimeout);
  if (game.gameTimerInterval) clearInterval(game.gameTimerInterval);
}

function endGame(game: Game, winner: Player) {
  clearGameIntervals(game);

  // Save stats for all players
  game.players.forEach((p) => {
    updatePlayerStats(p.username, p.kills, p.deaths, p.id === winner.id);
  });

  const scoreboard = game.players
    .map((p) => ({
      username: p.username,
      kills: p.kills,
      deaths: p.deaths,
      score: p.score,
      isWinner: p.id === winner.id,
    }))
    .sort((a, b) => b.score - a.score);

  // Save match history
  addMatchHistory({
    timestamp: Date.now(),
    players: scoreboard,
    winnerName: winner.username,
  });

  // Pick a random win sound index (1-8)
  const winAudioIndex = Math.floor(Math.random() * 8) + 1;

  // Assign unique lose sound indices (1-9) to each loser
  const loseIndices = Array.from({ length: 9 }, (_, i) => i + 1);
  for (let i = loseIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [loseIndices[i], loseIndices[j]] = [loseIndices[j], loseIndices[i]];
  }
  let loseIdx = 0;

  // Send per-player end message so each loser gets a different sound
  game.players.forEach((p) => {
    const isWinner = p.id === winner.id;
    const audioIndex = isWinner ? winAudioIndex : loseIndices[loseIdx++ % loseIndices.length];
    const endMessage = serialize({
      type: "end",
      winnerName: winner.username,
      scoreboard: scoreboard,
      audioIndex,
      gameMode: game.gameMode,
    });
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

  setTimeout(() => {
    games.delete(game.id);
  }, 2000);
}

export function checkVictory(game: Game) {
  // Persistent game never ends
  if (game.id === "persistent") return;
  if (!game.started) return;
  if (game.players.length <= 0) {
    endGameByScore(game);
  }
}

export function endGameByScore(game: Game) {
  if (!games.has(game.id)) return;
  // Find winner by highest score
  const winner = game.players.reduce(
    (best, p) => (p.score > best.score ? p : best),
    game.players[0]
  );
  if (!winner) return;
  console.log(`🏆 ${winner.username} wins with ${winner.score} points! Game over.`);
  endGame(game, winner);
}

/* ================= RESPAWN ================= */

export function respawnPlayer(player: Player, game: Game) {
  player.waitingForRespawn = false;
  // Default to zone center when shrinking, otherwise arena center
  let bestX = game.zoneShrinking ? game.zoneX + game.zoneW / 2 : GAME_CONFIG.ARENA_WIDTH / 2;
  let bestY = game.zoneShrinking ? game.zoneY + game.zoneH / 2 : GAME_CONFIG.ARENA_HEIGHT / 2;
  let bestDistance = 0;

  const alivePlayers = game.players.filter(
    (p) => p.hp > 0 && p.id !== player.id
  );

  // When zone is shrinking, constrain spawns to inside the safe zone
  const spawnMargin = 50;
  const spawnMinX = game.zoneShrinking ? game.zoneX + spawnMargin : spawnMargin;
  const spawnMinY = game.zoneShrinking ? game.zoneY + spawnMargin : spawnMargin;
  const spawnMaxX = game.zoneShrinking ? game.zoneX + game.zoneW - spawnMargin : GAME_CONFIG.ARENA_WIDTH - spawnMargin;
  const spawnMaxY = game.zoneShrinking ? game.zoneY + game.zoneH - spawnMargin : GAME_CONFIG.ARENA_HEIGHT - spawnMargin;

  for (let attempt = 0; attempt < 50; attempt++) {
    const testX = spawnMinX + Math.random() * Math.max(0, spawnMaxX - spawnMinX);
    const testY = spawnMinY + Math.random() * Math.max(0, spawnMaxY - spawnMinY);

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
  player.shieldUntil = 0;
  player.invisibleUntil = 0;
  player.regenUntil = 0;
  player.lastRegenTick = 0;
  player.armor = 0;
  player.dashCooldownUntil = 0;
  player.dashUntil = 0;
  player.dashDirX = 0;
  player.dashDirY = 0;

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
  // Clamp to arena bounds (and to safe zone if shrinking)
  const clampMinX = game.zoneShrinking ? Math.max(pr, game.zoneX + pr) : pr;
  const clampMinY = game.zoneShrinking ? Math.max(pr, game.zoneY + pr) : pr;
  const clampMaxX = game.zoneShrinking ? Math.min(GAME_CONFIG.ARENA_WIDTH - pr, game.zoneX + game.zoneW - pr) : GAME_CONFIG.ARENA_WIDTH - pr;
  const clampMaxY = game.zoneShrinking ? Math.min(GAME_CONFIG.ARENA_HEIGHT - pr, game.zoneY + game.zoneH - pr) : GAME_CONFIG.ARENA_HEIGHT - pr;
  player.x = Math.max(clampMinX, Math.min(clampMaxX, player.x));
  player.y = Math.max(clampMinY, Math.min(clampMaxY, player.y));

  broadcast(game, {
    type: "respawn",
    playerId: player.id,
    x: Math.round(bestX),
    y: Math.round(bestY),
  });
}

/** Manual respawn — called when the player clicks the respawn button */
export function requestRespawn(player: Player, game: Game) {
  if (player.hp > 0) return;            // Not dead
  if (!player.waitingForRespawn) return; // Already respawning
  respawnPlayer(player, game);
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
    // Update persistent game
    if (persistentGame && persistentGame.started) {
      updateGame(persistentGame);
    }
    // Update any other games (legacy, if any)
    games.forEach((game) => {
      if (game.started) {
        updateGame(game);
      }
    });
  }, 1000 / GAME_CONFIG.TICK_RATE);
}

/* ================= PERSISTENT GAME WORLD ================= */

export function generateObstacles(): import("./types.js").Obstacle[] {
  const obstacles: import("./types.js").Obstacle[] = [];
  const wallCount =
    OBSTACLE_CONFIG.WALL_COUNT_MIN +
    Math.floor(Math.random() * (OBSTACLE_CONFIG.WALL_COUNT_MAX - OBSTACLE_CONFIG.WALL_COUNT_MIN + 1));
  const treeCount =
    OBSTACLE_CONFIG.TREE_COUNT_MIN +
    Math.floor(Math.random() * (OBSTACLE_CONFIG.TREE_COUNT_MAX - OBSTACLE_CONFIG.TREE_COUNT_MIN + 1));

  const usedAreas: { x: number; y: number; width: number; height: number }[] = [];

  for (let i = 0; i < wallCount; i++) {
    let attempts = 0;
    let validPosition = false;
    let startX = 0, startY = 0, isHorizontal = false, wallLength = 0;

    while (!validPosition && attempts < 20) {
      isHorizontal = Math.random() > 0.5;
      wallLength = OBSTACLE_CONFIG.WALL_LENGTH_MIN +
        Math.floor(Math.random() * (OBSTACLE_CONFIG.WALL_LENGTH_MAX - OBSTACLE_CONFIG.WALL_LENGTH_MIN + 1));
      startX = 120 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 340);
      startY = 120 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 340);
      const wallWidth = isHorizontal ? wallLength * OBSTACLE_CONFIG.WALL_BLOCK_SIZE : OBSTACLE_CONFIG.WALL_BLOCK_SIZE;
      const wallHeight = isHorizontal ? OBSTACLE_CONFIG.WALL_BLOCK_SIZE : wallLength * OBSTACLE_CONFIG.WALL_BLOCK_SIZE;
      validPosition = true;
      for (const area of usedAreas) {
        if (
          startX < area.x + area.width + OBSTACLE_CONFIG.WALL_SPACING &&
          startX + wallWidth + OBSTACLE_CONFIG.WALL_SPACING > area.x &&
          startY < area.y + area.height + OBSTACLE_CONFIG.WALL_SPACING &&
          startY + wallHeight + OBSTACLE_CONFIG.WALL_SPACING > area.y
        ) { validPosition = false; break; }
      }
      attempts++;
    }

    if (validPosition) {
      const blockSize = OBSTACLE_CONFIG.WALL_BLOCK_SIZE;
      usedAreas.push({
        x: startX, y: startY,
        width: isHorizontal ? wallLength * blockSize : blockSize,
        height: isHorizontal ? blockSize : wallLength * blockSize,
      });
      const gId = uuid();
      const count = wallLength;
      for (let j = 0; j < count; j++) {
        obstacles.push({
          id: uuid(),
          x: isHorizontal ? startX + j * blockSize : startX,
          y: isHorizontal ? startY : startY + j * blockSize,
          size: blockSize,
          destroyed: false,
          type: "wall",
          groupId: gId,
        });
      }
    }
  }

  for (let i = 0; i < treeCount; i++) {
    let attempts = 0;
    let validPosition = false;
    let treeX = 0, treeY = 0;
    const treeSize = OBSTACLE_CONFIG.TREE_SIZE;
    while (!validPosition && attempts < 20) {
      treeX = 120 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 240);
      treeY = 120 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 240);
      validPosition = true;
      for (const area of usedAreas) {
        const dx = treeX - (area.x + area.width / 2);
        const dy = treeY - (area.y + area.height / 2);
        if (Math.sqrt(dx * dx + dy * dy) < OBSTACLE_CONFIG.TREE_SPACING) { validPosition = false; break; }
      }
      attempts++;
    }
    if (validPosition) {
      usedAreas.push({ x: treeX - treeSize / 2, y: treeY - treeSize / 2, width: treeSize, height: treeSize });
      obstacles.push({ id: uuid(), x: treeX - treeSize / 2, y: treeY - treeSize / 2, size: treeSize, destroyed: false, type: "tree" });
    }
  }
  return obstacles;
}

export function initPersistentGame(): Game {
  const obstacles = generateObstacles();

  const game: Game = {
    id: "persistent",
    nextShortId: 1,
    players: [],
    bullets: [],
    obstacles,
    pickups: [],
    orbs: [],
    bombs: [],
    lightnings: [],
    lootCrates: [],
    started: true, // Always running
    gameMode: "deathmatch",
    lastBroadcastState: new Map(),
    stateSequence: 0,
    matchStartTime: Date.now(),
    zoneX: 0,
    zoneY: 0,
    zoneW: GAME_CONFIG.ARENA_WIDTH,
    zoneH: GAME_CONFIG.ARENA_HEIGHT,
    zoneShrinking: false,
  };

  games.set(game.id, game);
  setPersistentGame(game);

  // Start continuous spawning intervals
  game.obstacleSpawnInterval = setInterval(() => {
    spawnRandomObstacle(game);
  }, GAME_CONFIG.OBSTACLE_SPAWN_INTERVAL);

  game.pickupSpawnInterval = setInterval(() => {
    spawnPickup(game);
  }, GAME_CONFIG.PICKUP_SPAWN_INTERVAL);

  spawnInitialOrbs(game);
  game.orbSpawnInterval = setInterval(() => {
    spawnOrb(game);
  }, GAME_CONFIG.ORB_SPAWN_INTERVAL);

  const scheduleBomb = () => {
    const delay = GAME_CONFIG.BOMB_SPAWN_INTERVAL * (0.5 + Math.random());
    game.bombSpawnInterval = setTimeout(() => {
      spawnBomb(game);
      scheduleBomb();
    }, delay);
  };
  scheduleBomb();

  const scheduleLightning = () => {
    const delay = GAME_CONFIG.LIGHTNING_SPAWN_INTERVAL * (0.5 + Math.random());
    game.lightningSpawnInterval = setTimeout(() => {
      spawnLightning(game);
      scheduleLightning();
    }, delay);
  };
  scheduleLightning();

  spawnInitialLootCrates(game);
  game.lootCrateSpawnInterval = setInterval(() => {
    spawnLootCrate(game);
  }, GAME_CONFIG.LOOT_CRATE_RESPAWN_INTERVAL);

  console.log(`🌍 Persistent game world initialized (${obstacles.length} obstacles, arena ${GAME_CONFIG.ARENA_WIDTH}x${GAME_CONFIG.ARENA_HEIGHT})`);

  // Start round timer (5 minutes)
  startRoundTimer(game);

  return game;
}

/* ================= ROUND TIMER ================= */

function startRoundTimer(game: Game) {
  const roundDuration = GAME_CONFIG.ROUND_DURATION; // 5 minutes
  game.matchStartTime = Date.now();

  // Broadcast timer every second
  game.gameTimerInterval = setInterval(() => {
    const elapsed = Date.now() - game.matchStartTime;
    const remaining = Math.max(0, Math.ceil((roundDuration - elapsed) / 1000));
    broadcast(game, { type: "gameTimer", remaining });

    if (remaining <= 0) {
      clearInterval(game.gameTimerInterval!);
      endRound(game);
    }
  }, 1000);
}

function endRound(game: Game) {
  // Build scoreboard
  const scoreboard = game.players
    .map((p) => ({
      username: p.username,
      kills: p.kills,
      deaths: p.deaths,
      score: p.score,
    }))
    .sort((a, b) => b.score - a.score);

  const winnerName = scoreboard.length > 0 ? scoreboard[0].username : "Nobody";

  // Save stats for all players
  game.players.forEach((p) => {
    updatePlayerStats(p.username, p.kills, p.deaths, p.username === winnerName);
  });

  // Save match history
  addMatchHistory({
    timestamp: Date.now(),
    players: scoreboard.map((s) => ({ ...s, isWinner: s.username === winnerName })),
    winnerName,
  });

  // Pick a random win sound index (1-8)
  const winAudioIndex = Math.floor(Math.random() * 8) + 1;
  // Assign unique lose sound indices (1-9) to each loser
  const loseIndices = Array.from({ length: 9 }, (_, i) => i + 1);
  for (let i = loseIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [loseIndices[i], loseIndices[j]] = [loseIndices[j], loseIndices[i]];
  }
  let loseIdx = 0;

  // Send per-player roundEnd message
  game.players.forEach((p) => {
    const isWinner = p.username === winnerName;
    const audioIndex = isWinner ? winAudioIndex : loseIndices[loseIdx++ % loseIndices.length];
    const msg = serialize({
      type: "roundEnd",
      winnerName,
      scoreboard,
      audioIndex,
      restartDelay: GAME_CONFIG.ROUND_RESTART_DELAY,
    });
    try {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
    } catch { /* ignore */ }
  });

  // Schedule new round
  setTimeout(() => {
    resetPersistentRound(game);
  }, GAME_CONFIG.ROUND_RESTART_DELAY);
}

function resetPersistentRound(game: Game) {
  // Clear all intervals before resetting
  clearGameIntervals(game);

  // Regenerate obstacles
  game.obstacles = generateObstacles();
  game.bullets = [];
  game.pickups = [];
  game.orbs = [];
  game.bombs = [];
  game.lightnings = [];
  game.lootCrates = [];
  game.stateSequence = 0;
  game.zoneX = 0;
  game.zoneY = 0;
  game.zoneW = GAME_CONFIG.ARENA_WIDTH;
  game.zoneH = GAME_CONFIG.ARENA_HEIGHT;
  game.zoneShrinking = false;

  // Reset all player stats and respawn them
  game.players.forEach((p) => {
    p.kills = 0;
    p.deaths = 0;
    p.score = 0;
    p.killStreak = 0;
    p.lastKilledBy = "";
    p.waitingForRespawn = false;
    p.hp = GAME_CONFIG.PLAYER_HP;
    p.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE;
    p.reloading = false;
    p.weapon = "machinegun";
    p.speedBoostUntil = 0;
    p.minigunUntil = 0;
    p.shieldUntil = 0;
    p.invisibleUntil = 0;
    p.regenUntil = 0;
    p.lastRegenTick = 0;
    p.armor = 0;
    p.dashCooldownUntil = 0;
    p.dashUntil = 0;
    p.keys = { w: false, a: false, s: false, d: false };
  });

  // Respawn all players at random positions
  game.players.forEach((p) => {
    let bestX = GAME_CONFIG.ARENA_WIDTH / 2;
    let bestY = GAME_CONFIG.ARENA_HEIGHT / 2;
    let bestDistance = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
      const testX = 50 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 100);
      const testY = 50 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 100);
      if (!isPositionClear(testX, testY, game.obstacles, GAME_CONFIG.PLAYER_RADIUS)) continue;
      let minDist = Infinity;
      for (const other of game.players) {
        if (other.id === p.id || other.hp <= 0) continue;
        const dist = Math.sqrt((testX - other.x) ** 2 + (testY - other.y) ** 2);
        minDist = Math.min(minDist, dist);
      }
      if (minDist > bestDistance) { bestDistance = minDist; bestX = testX; bestY = testY; }
    }
    p.x = bestX;
    p.y = bestY;
  });

  // Restart spawn intervals
  game.obstacleSpawnInterval = setInterval(() => spawnRandomObstacle(game), GAME_CONFIG.OBSTACLE_SPAWN_INTERVAL);
  game.pickupSpawnInterval = setInterval(() => spawnPickup(game), GAME_CONFIG.PICKUP_SPAWN_INTERVAL);
  spawnInitialOrbs(game);
  game.orbSpawnInterval = setInterval(() => spawnOrb(game), GAME_CONFIG.ORB_SPAWN_INTERVAL);

  const scheduleBomb2 = () => {
    const delay = GAME_CONFIG.BOMB_SPAWN_INTERVAL * (0.5 + Math.random());
    game.bombSpawnInterval = setTimeout(() => { spawnBomb(game); scheduleBomb2(); }, delay);
  };
  scheduleBomb2();

  const scheduleLightning2 = () => {
    const delay = GAME_CONFIG.LIGHTNING_SPAWN_INTERVAL * (0.5 + Math.random());
    game.lightningSpawnInterval = setTimeout(() => { spawnLightning(game); scheduleLightning2(); }, delay);
  };
  scheduleLightning2();

  spawnInitialLootCrates(game);
  game.lootCrateSpawnInterval = setInterval(() => spawnLootCrate(game), GAME_CONFIG.LOOT_CRATE_RESPAWN_INTERVAL);

  // Build shortIdMap for all currently connected players
  const shortIdMap: Record<number, { id: string; username: string }> = {};
  for (const p of game.players) {
    shortIdMap[p.shortId] = { id: p.id, username: p.username };
  }

  // Notify all players of new round
  game.players.forEach((p) => {
    const msg = serialize({
      type: "roundStart",
      obstacles: game.obstacles,
      orbs: game.orbs.map((o) => [o.id, o.x, o.y]),
      arenaWidth: GAME_CONFIG.ARENA_WIDTH,
      arenaHeight: GAME_CONFIG.ARENA_HEIGHT,
      maxHp: GAME_CONFIG.PLAYER_HP,
      shortIdMap,
      playerX: Math.round(p.x),
      playerY: Math.round(p.y),
    });
    try {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
    } catch { /* ignore */ }
  });

  // Start new round timer
  startRoundTimer(game);

  console.log(`🔄 New round started! (${game.players.length} players)`);
}

/** Add a player to the persistent game world */
export function addPlayerToGame(player: Player, game: Game) {
  // Find a clear spawn position
  let bestX = GAME_CONFIG.ARENA_WIDTH / 2;
  let bestY = GAME_CONFIG.ARENA_HEIGHT / 2;
  let bestDistance = 0;

  for (let attempt = 0; attempt < 50; attempt++) {
    const testX = 50 + Math.random() * (GAME_CONFIG.ARENA_WIDTH - 100);
    const testY = 50 + Math.random() * (GAME_CONFIG.ARENA_HEIGHT - 100);
    if (!isPositionClear(testX, testY, game.obstacles, GAME_CONFIG.PLAYER_RADIUS)) continue;

    let minDist = Infinity;
    for (const other of game.players) {
      if (other.hp <= 0) continue;
      const dist = Math.sqrt((testX - other.x) ** 2 + (testY - other.y) ** 2);
      minDist = Math.min(minDist, dist);
    }
    if (game.players.length === 0) minDist = 1000;

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
  player.kills = 0;
  player.deaths = 0;
  player.score = 0;
  player.weapon = "machinegun";
  player.keys = { w: false, a: false, s: false, d: false };
  player.lastProcessedInput = 0;
  player.aimAngle = 0;
  player.lastKilledBy = "";
  player.shieldUntil = 0;
  player.invisibleUntil = 0;
  player.regenUntil = 0;
  player.lastRegenTick = 0;
  player.armor = 0;
  player.dashCooldownUntil = 0;
  player.dashUntil = 0;
  player.dashDirX = 0;
  player.dashDirY = 0;
  player.killStreak = 0;
  player.waitingForRespawn = false;
  player.ready = true;

  game.players.push(player);

  console.log(`➕ ${player.username} joined the arena (${game.players.length} players)`);
}

/** Remove a player from the persistent game world */
export function removePlayerFromGame(playerId: string, game: Game) {
  const player = game.players.find((p) => p.id === playerId);
  if (player) {
    // Save stats
    updatePlayerStats(player.username, player.kills, player.deaths, false);
    console.log(`➖ ${player.username} left the arena (score: ${player.score})`);
  }
  game.players = game.players.filter((p) => p.id !== playerId);
  // Remove their bullets too
  game.bullets = game.bullets.filter((b) => b.playerId !== playerId);
}

/* ================= DYNAMIC ARENA SHRINKING ================= */

export function startZoneShrink(game: Game) {
  if (game.zoneShrinking || !games.has(game.id)) return;
  game.zoneShrinking = true;

  broadcast(game, { type: "zoneWarning" });

  // Shrink the zone every ZONE_SHRINK_INTERVAL ms
  game.zoneShrinkInterval = setInterval(() => {
    if (!games.has(game.id)) {
      clearInterval(game.zoneShrinkInterval);
      return;
    }

    const rate = GAME_CONFIG.ZONE_SHRINK_RATE;
    const minSize = GAME_CONFIG.ZONE_MIN_SIZE;

    if (game.zoneW > minSize) {
      game.zoneX += rate;
      game.zoneW -= rate * 2;
      if (game.zoneW < minSize) game.zoneW = minSize;
    }
    if (game.zoneH > minSize) {
      game.zoneY += rate;
      game.zoneH -= rate * 2;
      if (game.zoneH < minSize) game.zoneH = minSize;
    }

    // Stop shrinking when minimum reached
    if (game.zoneW <= minSize && game.zoneH <= minSize) {
      clearInterval(game.zoneShrinkInterval);
    }
  }, GAME_CONFIG.ZONE_SHRINK_INTERVAL);

  // Damage players outside the zone every ZONE_DAMAGE_INTERVAL ms
  game.zoneDamageInterval = setInterval(() => {
    if (!games.has(game.id)) {
      clearInterval(game.zoneDamageInterval);
      return;
    }

    game.players.forEach((player) => {
      if (player.hp <= 0) return;
      const inZone =
        player.x >= game.zoneX &&
        player.x <= game.zoneX + game.zoneW &&
        player.y >= game.zoneY &&
        player.y <= game.zoneY + game.zoneH;

      if (!inZone) {
        // Progressive damage — the further outside the zone, the more damage
        const distLeft = Math.max(0, game.zoneX - player.x);
        const distRight = Math.max(0, player.x - (game.zoneX + game.zoneW));
        const distTop = Math.max(0, game.zoneY - player.y);
        const distBottom = Math.max(0, player.y - (game.zoneY + game.zoneH));
        const maxDist = Math.max(distLeft, distRight, distTop, distBottom);
        // Base 1 damage, +1 per 80px outside the zone (max 4)
        const zoneDmg = Math.min(4, GAME_CONFIG.ZONE_DAMAGE + Math.floor(maxDist / 80));

        if (Date.now() < player.shieldUntil) {
          player.shieldUntil -= 1500;
        } else {
          player.hp -= zoneDmg;
          if (player.hp <= 0) {
            player.hp = 0;
            handleKill(undefined, player, "zone", game);
          }
        }
      }
    });
  }, GAME_CONFIG.ZONE_DAMAGE_INTERVAL);
}
