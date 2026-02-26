import { randomUUID as uuid } from "crypto";
import { WebSocket } from "ws";
import type { Player, Bullet, Game, Pickup, Bomb, Lightning, Grenade } from "./types.js";
import { GAME_CONFIG, OBSTACLE_CONFIG } from "./config.js";
import { games, allPlayers, rooms } from "./state.js";
import {
  broadcast,
  serializePlayersCompact,
  isPositionClear,
  debouncedBroadcastOnlineList,
} from "./utils.js";
import { updatePlayerStats, addMatchHistory } from "./database.js";
import { serialize } from "./protocol.js";

const WEAPON_CODE_MAP: Record<string, number> = { machinegun: 0, shotgun: 1, knife: 2, minigun: 3, sniper: 4, grenade_launcher: 5, dual_pistols: 6 };

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

    // Revenge tracking
    const isRevenge = victim.lastKilledBy === "" ? false : killer.lastKilledBy === victim.id;

    broadcast(game, {
      type: "kill",
      killer: killer.username,
      victim: victim.username,
      weapon,
      isRevenge,
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
    const hitRadiusSq = (GAME_CONFIG.PLAYER_RADIUS * 1.2) ** 2;
    const enemy = game.players.find(
      (p) => {
        if (p.id === bullet.playerId || p.hp <= 0) return false;
        const bdx = p.x - bullet.x;
        const bdy = p.y - bullet.y;
        return bdx * bdx + bdy * bdy < hitRadiusSq;
      }
    );

    if (enemy) {
      bulletsToRemove.add(bullet.id);

      // Shield absorption
      const shieldActive = Date.now() < enemy.shieldUntil;
      if (shieldActive) {
        // Shield absorbs damage — reduce shield time instead
        enemy.shieldUntil -= 1500; // each hit drains 1.5s of shield
        // Knockback still applies
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

  // Grenade physics
  const grenadesToExplode: Grenade[] = [];
  game.grenades.forEach((grenade) => {
    grenade.x += grenade.dx;
    grenade.y += grenade.dy;
    // Slow down (friction)
    grenade.dx *= 0.96;
    grenade.dy *= 0.96;

    // Bounce off walls
    if (grenade.x < 0 || grenade.x > GAME_CONFIG.ARENA_WIDTH) grenade.dx *= -0.5;
    if (grenade.y < 0 || grenade.y > GAME_CONFIG.ARENA_HEIGHT) grenade.dy *= -0.5;
    grenade.x = Math.max(0, Math.min(GAME_CONFIG.ARENA_WIDTH, grenade.x));
    grenade.y = Math.max(0, Math.min(GAME_CONFIG.ARENA_HEIGHT, grenade.y));

    if (now - grenade.createdAt >= GAME_CONFIG.GRENADE_FUSE_TIME) {
      grenadesToExplode.push(grenade);
    }
  });

  const grenadeRadiusSq = GAME_CONFIG.GRENADE_RADIUS * GAME_CONFIG.GRENADE_RADIUS;
  grenadesToExplode.forEach((grenade) => {
    const shooter = game.players.find((p) => p.id === grenade.playerId);
    game.players.forEach((player) => {
      if (player.hp <= 0) return;
      const dx = player.x - grenade.x;
      const dy = player.y - grenade.y;
      if (dx * dx + dy * dy < grenadeRadiusSq) {
        // Shield absorption
        if (Date.now() < player.shieldUntil) {
          player.shieldUntil -= 1500;
        } else {
          player.hp -= GAME_CONFIG.GRENADE_DAMAGE;
          if (player.hp <= 0) {
            player.hp = 0;
            handleKill(shooter, player, "grenade_launcher", game);
          }
        }
      }
    });

    // Destroy nearby obstacles
    game.obstacles.forEach((obs) => {
      if (obs.destroyed) return;
      const cx = obs.x + obs.size / 2;
      const cy = obs.y + obs.size / 2;
      const dx = cx - grenade.x;
      const dy = cy - grenade.y;
      if (dx * dx + dy * dy < grenadeRadiusSq) {
        obs.destroyed = true;
        broadcast(game, { type: "obstacleDestroyed", obstacleId: obs.id });
      }
    });

    broadcast(game, {
      type: "grenadeExploded",
      id: grenade.id,
      x: Math.round(grenade.x),
      y: Math.round(grenade.y),
      radius: GAME_CONFIG.GRENADE_RADIUS,
    });
  });

  if (grenadesToExplode.length > 0) {
    game.grenades = game.grenades.filter(
      (g) => !grenadesToExplode.some((e) => e.id === g.id)
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

  // Weapon code mapping (hoisted constant)
  const weaponCodeMap = WEAPON_CODE_MAP;

  // Delta detection
  const compactPlayers = serializePlayersCompact(game);
  const compactBullets = game.bullets.map((b) => [
    b.id,
    Math.round(b.x),
    Math.round(b.y),
    weaponCodeMap[b.weapon] ?? 0,
  ]);
  const compactPickups = game.pickups.map((pk) => {
    const PICKUP_TYPE_CODES: Record<string, number> = {
      health: 0, ammo: 1, speed: 2, minigun: 3, shield: 4, invisibility: 5, regen: 6,
    };
    return [pk.id, Math.round(pk.x), Math.round(pk.y), PICKUP_TYPE_CODES[pk.type] ?? 0];
  });
  const compactGrenades = game.grenades.map((g) => [
    g.id, Math.round(g.x), Math.round(g.y),
  ]);
  // Lightweight hash — avoid full JSON.stringify every tick
  let stateHash = game.bullets.length + ":" + game.pickups.length + ":" + game.grenades.length;
  for (const p of compactPlayers) {
    stateHash += ":" + (p as number[])[1] + "," + (p as number[])[2] + "," + (p as number[])[3] + "," + (p as number[])[9];
  }

  const lastHash = game.lastBroadcastState?.get("hash");
  if (stateHash === lastHash && compactBullets.length === 0 && compactGrenades.length === 0) {
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
    g: compactGrenades,
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
    const meleeRangeSq = meleeRange * meleeRange;
    game.players.forEach((target) => {
      if (target.id === player.id || target.hp <= 0) return;

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
      setTimeout(() => { player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE; player.reloading = false; }, GAME_CONFIG.RELOAD_TIME);
    }
    const bullet: Bullet = {
      id: uuid(), x: player.x, y: player.y,
      dx: dirX * GAME_CONFIG.SNIPER_BULLET_SPEED,
      dy: dirY * GAME_CONFIG.SNIPER_BULLET_SPEED,
      team: 0, playerId: player.id,
      damage: GAME_CONFIG.SNIPER_DAMAGE, weapon: "sniper",
      createdAt: Date.now(),
    };
    game.bullets.push(bullet);
    return;
  }

  // Grenade Launcher — lobs a grenade projectile
  if (player.weapon === "grenade_launcher") {
    const cooldown = GAME_CONFIG.GRENADE_COOLDOWN;
    if (now - player.lastShotTime < cooldown) return;
    if (player.shots <= 0) return;
    player.lastShotTime = now;
    player.shots--;
    if (player.shots === 0) {
      player.reloading = true;
      setTimeout(() => { player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE; player.reloading = false; }, GAME_CONFIG.RELOAD_TIME);
    }
    const grenade: Grenade = {
      id: uuid(), x: player.x, y: player.y,
      dx: dirX * GAME_CONFIG.GRENADE_SPEED,
      dy: dirY * GAME_CONFIG.GRENADE_SPEED,
      playerId: player.id, createdAt: Date.now(),
    };
    game.grenades.push(grenade);
    return;
  }

  // Dual Pistols — rapid fire with slight spread
  if (player.weapon === "dual_pistols") {
    const cooldown = GAME_CONFIG.DUAL_PISTOL_COOLDOWN;
    if (now - player.lastShotTime < cooldown) return;
    if (player.shots <= 0) return;
    player.lastShotTime = now;
    player.shots--;
    if (player.shots === 0) {
      player.reloading = true;
      setTimeout(() => { player.shots = GAME_CONFIG.SHOTS_PER_MAGAZINE; player.reloading = false; }, GAME_CONFIG.RELOAD_TIME);
    }
    // Fire two bullets with slight offset
    const baseAngle = Math.atan2(dirY, dirX);
    for (let i = 0; i < 2; i++) {
      const spread = (i === 0 ? -1 : 1) * GAME_CONFIG.DUAL_PISTOL_SPREAD;
      const angle = baseAngle + spread;
      const bullet: Bullet = {
        id: uuid(), x: player.x, y: player.y,
        dx: Math.cos(angle) * GAME_CONFIG.BULLET_SPEED,
        dy: Math.sin(angle) * GAME_CONFIG.BULLET_SPEED,
        team: 0, playerId: player.id,
        damage: GAME_CONFIG.DUAL_PISTOL_DAMAGE, weapon: "dual_pistols",
        createdAt: Date.now(),
      };
      game.bullets.push(bullet);
    }
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

  const types: Array<"health" | "ammo" | "speed" | "minigun" | "shield" | "invisibility" | "regen"> = ["health", "ammo", "speed", "minigun", "shield", "invisibility", "regen"];
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
      clearTimeout(game.bombSpawnInterval);
    }
    if (game.lightningSpawnInterval) {
      clearTimeout(game.lightningSpawnInterval);
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

    const endMessage = serialize({
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
    const roomListMsg = serialize({ type: "roomList", rooms: roomList });
    game.players.forEach((p) => {
      try {
        if (p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(roomListMsg);
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
  player.shieldUntil = 0;
  player.invisibleUntil = 0;
  player.regenUntil = 0;
  player.lastRegenTick = 0;

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
