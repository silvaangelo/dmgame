import { describe, test, expect } from "bun:test";
import { GAME_CONFIG } from "../backend/config.js";
import type { Bullet, Obstacle, Player } from "../backend/types.js";

// ===== BULLET PHYSICS (extracted from game.ts updateGame) =====

function moveBullet(bullet: Bullet) {
  bullet.x += bullet.dx;
  bullet.y += bullet.dy;
}

function isBulletOutOfBounds(bullet: Bullet): boolean {
  return (
    bullet.x < 0 ||
    bullet.x > GAME_CONFIG.ARENA_WIDTH ||
    bullet.y < 0 ||
    bullet.y > GAME_CONFIG.ARENA_HEIGHT
  );
}

function checkBulletObstacleHit(bullet: Bullet, obstacles: Obstacle[]): Obstacle | undefined {
  return obstacles.find(
    (o) =>
      !o.destroyed &&
      bullet.x >= o.x &&
      bullet.x <= o.x + o.size &&
      bullet.y >= o.y &&
      bullet.y <= o.y + o.size,
  );
}

function checkBulletPlayerHit(
  bullet: Bullet,
  players: Array<{ id: string; x: number; y: number; hp: number }>,
): { id: string; x: number; y: number; hp: number } | undefined {
  const hitRadiusSq = (GAME_CONFIG.PLAYER_RADIUS * 1.2) ** 2;
  return players.find((p) => {
    if (p.id === bullet.playerId || p.hp <= 0) return false;
    const dx = p.x - bullet.x;
    const dy = p.y - bullet.y;
    return dx * dx + dy * dy < hitRadiusSq;
  });
}

function createTestBullet(overrides: Partial<Bullet> = {}): Bullet {
  return {
    id: "b1",
    x: 400,
    y: 400,
    dx: GAME_CONFIG.BULLET_SPEED,
    dy: 0,
    team: 0,
    playerId: "player1",
    damage: GAME_CONFIG.MACHINEGUN_DAMAGE,
    weapon: "machinegun",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("Bullet Physics", () => {
  test("bullet moves by dx/dy each tick", () => {
    const bullet = createTestBullet({ x: 100, y: 100, dx: 15, dy: 0 });
    moveBullet(bullet);
    expect(bullet.x).toBe(115);
    expect(bullet.y).toBe(100);
  });

  test("bullet moves diagonally", () => {
    const bullet = createTestBullet({ x: 100, y: 100, dx: 10, dy: -5 });
    moveBullet(bullet);
    expect(bullet.x).toBe(110);
    expect(bullet.y).toBe(95);
  });

  test("bullet is out of bounds at left edge", () => {
    const bullet = createTestBullet({ x: -1, y: 100 });
    expect(isBulletOutOfBounds(bullet)).toBe(true);
  });

  test("bullet is out of bounds at right edge", () => {
    const bullet = createTestBullet({ x: GAME_CONFIG.ARENA_WIDTH + 1, y: 100 });
    expect(isBulletOutOfBounds(bullet)).toBe(true);
  });

  test("bullet is out of bounds at top edge", () => {
    const bullet = createTestBullet({ x: 100, y: -1 });
    expect(isBulletOutOfBounds(bullet)).toBe(true);
  });

  test("bullet is out of bounds at bottom edge", () => {
    const bullet = createTestBullet({ x: 100, y: GAME_CONFIG.ARENA_HEIGHT + 1 });
    expect(isBulletOutOfBounds(bullet)).toBe(true);
  });

  test("bullet within arena is not out of bounds", () => {
    const bullet = createTestBullet({ x: 700, y: 450 });
    expect(isBulletOutOfBounds(bullet)).toBe(false);
  });

  test("bullet at arena origin is not out of bounds", () => {
    const bullet = createTestBullet({ x: 0, y: 0 });
    expect(isBulletOutOfBounds(bullet)).toBe(false);
  });

  test("bullet hits obstacle it overlaps", () => {
    const obstacle: Obstacle = { id: "o1", x: 395, y: 395, size: 20, destroyed: false };
    const bullet = createTestBullet({ x: 400, y: 400 });
    const hit = checkBulletObstacleHit(bullet, [obstacle]);
    expect(hit).toBeDefined();
    expect(hit!.id).toBe("o1");
  });

  test("bullet misses obstacle it doesn't overlap", () => {
    const obstacle: Obstacle = { id: "o1", x: 100, y: 100, size: 20, destroyed: false };
    const bullet = createTestBullet({ x: 400, y: 400 });
    const hit = checkBulletObstacleHit(bullet, [obstacle]);
    expect(hit).toBeUndefined();
  });

  test("bullet ignores destroyed obstacle", () => {
    const obstacle: Obstacle = { id: "o1", x: 395, y: 395, size: 20, destroyed: true };
    const bullet = createTestBullet({ x: 400, y: 400 });
    const hit = checkBulletObstacleHit(bullet, [obstacle]);
    expect(hit).toBeUndefined();
  });

  test("bullet hits enemy player within hit radius", () => {
    const enemy = { id: "enemy1", x: 405, y: 400, hp: 4 };
    const bullet = createTestBullet({ x: 400, y: 400, playerId: "player1" });
    const hit = checkBulletPlayerHit(bullet, [enemy]);
    expect(hit).toBeDefined();
    expect(hit!.id).toBe("enemy1");
  });

  test("bullet does not hit its own shooter", () => {
    const shooter = { id: "player1", x: 400, y: 400, hp: 4 };
    const bullet = createTestBullet({ x: 400, y: 400, playerId: "player1" });
    const hit = checkBulletPlayerHit(bullet, [shooter]);
    expect(hit).toBeUndefined();
  });

  test("bullet does not hit dead player", () => {
    const dead = { id: "enemy1", x: 405, y: 400, hp: 0 };
    const bullet = createTestBullet({ x: 400, y: 400, playerId: "player1" });
    const hit = checkBulletPlayerHit(bullet, [dead]);
    expect(hit).toBeUndefined();
  });

  test("bullet misses player outside hit radius", () => {
    const far = { id: "enemy1", x: 500, y: 400, hp: 4 };
    const bullet = createTestBullet({ x: 400, y: 400, playerId: "player1" });
    const hit = checkBulletPlayerHit(bullet, [far]);
    expect(hit).toBeUndefined();
  });

  test("sniper bullet has higher speed", () => {
    const sniper = createTestBullet({ dx: GAME_CONFIG.SNIPER_BULLET_SPEED, dy: 0 });
    const machinegun = createTestBullet({ dx: GAME_CONFIG.BULLET_SPEED, dy: 0 });
    expect(sniper.dx).toBeGreaterThan(machinegun.dx);
  });

  test("bullet lifetime filtering works", () => {
    const fresh = createTestBullet({ createdAt: Date.now() });
    const expired = createTestBullet({ createdAt: Date.now() - GAME_CONFIG.BULLET_LIFETIME - 100 });
    const now = Date.now();
    const alive = [fresh, expired].filter((b) => now - b.createdAt < GAME_CONFIG.BULLET_LIFETIME);
    expect(alive.length).toBe(1);
    expect(alive[0]).toBe(fresh);
  });
});

describe("Weapon Configuration", () => {
  test("sniper has highest damage", () => {
    expect(GAME_CONFIG.SNIPER_DAMAGE).toBeGreaterThan(GAME_CONFIG.MACHINEGUN_DAMAGE);
    expect(GAME_CONFIG.SNIPER_DAMAGE).toBeGreaterThan(GAME_CONFIG.SHOTGUN_DAMAGE);
    expect(GAME_CONFIG.SNIPER_DAMAGE).toBeGreaterThan(GAME_CONFIG.MINIGUN_DAMAGE);
  });

  test("machinegun fires faster than shotgun", () => {
    expect(GAME_CONFIG.MACHINEGUN_COOLDOWN).toBeLessThan(GAME_CONFIG.SHOTGUN_COOLDOWN);
  });

  test("minigun fires fastest", () => {
    expect(GAME_CONFIG.MINIGUN_COOLDOWN).toBeLessThan(GAME_CONFIG.MACHINEGUN_COOLDOWN);
  });

  test("sniper has slowest fire rate", () => {
    expect(GAME_CONFIG.SNIPER_COOLDOWN).toBeGreaterThan(GAME_CONFIG.SHOTGUN_COOLDOWN);
  });

  test("shotgun fires multiple pellets", () => {
    expect(GAME_CONFIG.SHOTGUN_PELLETS).toBeGreaterThan(1);
  });
});
