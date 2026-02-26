import { describe, test, expect } from "bun:test";
import { GAME_CONFIG } from "../backend/config.js";
import type { Obstacle, Player } from "../backend/types.js";

// ===== COLLISION RESOLUTION (extracted from game.ts/game.js) =====
// Both client and server use identical axis-by-axis resolution.

function resolvePlayerMovement(
  player: { x: number; y: number; keys: { w: boolean; a: boolean; s: boolean; d: boolean } },
  obstacles: Obstacle[],
  speed: number,
  arenaW = GAME_CONFIG.ARENA_WIDTH,
  arenaH = GAME_CONFIG.ARENA_HEIGHT,
) {
  const playerRadius = GAME_CONFIG.PLAYER_RADIUS;
  const margin = playerRadius;

  // X axis
  const oldX = player.x;
  if (player.keys.a) player.x -= speed;
  if (player.keys.d) player.x += speed;
  player.x = Math.max(margin, Math.min(arenaW - margin, player.x));

  for (const obstacle of obstacles) {
    if (obstacle.destroyed) continue;
    const closestX = Math.max(obstacle.x, Math.min(player.x, obstacle.x + obstacle.size));
    const closestY = Math.max(obstacle.y, Math.min(player.y, obstacle.y + obstacle.size));
    const dx = player.x - closestX;
    const dy = player.y - closestY;
    if (dx * dx + dy * dy < playerRadius * playerRadius) {
      player.x = oldX;
      break;
    }
  }

  // Y axis
  const oldY = player.y;
  if (player.keys.w) player.y -= speed;
  if (player.keys.s) player.y += speed;
  player.y = Math.max(margin, Math.min(arenaH - margin, player.y));

  for (const obstacle of obstacles) {
    if (obstacle.destroyed) continue;
    const closestX = Math.max(obstacle.x, Math.min(player.x, obstacle.x + obstacle.size));
    const closestY = Math.max(obstacle.y, Math.min(player.y, obstacle.y + obstacle.size));
    const dx = player.x - closestX;
    const dy = player.y - closestY;
    if (dx * dx + dy * dy < playerRadius * playerRadius) {
      player.y = oldY;
      break;
    }
  }
}

describe("Player Collision Resolution", () => {
  test("player stays within arena bounds (left)", () => {
    const player = { x: 5, y: 450, keys: { w: false, a: true, s: false, d: false } };
    resolvePlayerMovement(player, [], GAME_CONFIG.PLAYER_SPEED);
    expect(player.x).toBeGreaterThanOrEqual(GAME_CONFIG.PLAYER_RADIUS);
  });

  test("player stays within arena bounds (right)", () => {
    const player = { x: GAME_CONFIG.ARENA_WIDTH - 5, y: 450, keys: { w: false, a: false, s: false, d: true } };
    resolvePlayerMovement(player, [], GAME_CONFIG.PLAYER_SPEED);
    expect(player.x).toBeLessThanOrEqual(GAME_CONFIG.ARENA_WIDTH - GAME_CONFIG.PLAYER_RADIUS);
  });

  test("player stays within arena bounds (top)", () => {
    const player = { x: 700, y: 5, keys: { w: true, a: false, s: false, d: false } };
    resolvePlayerMovement(player, [], GAME_CONFIG.PLAYER_SPEED);
    expect(player.y).toBeGreaterThanOrEqual(GAME_CONFIG.PLAYER_RADIUS);
  });

  test("player stays within arena bounds (bottom)", () => {
    const player = { x: 700, y: GAME_CONFIG.ARENA_HEIGHT - 5, keys: { w: false, a: false, s: true, d: false } };
    resolvePlayerMovement(player, [], GAME_CONFIG.PLAYER_SPEED);
    expect(player.y).toBeLessThanOrEqual(GAME_CONFIG.ARENA_HEIGHT - GAME_CONFIG.PLAYER_RADIUS);
  });

  test("player moves correctly with no obstacles", () => {
    const player = { x: 400, y: 400, keys: { w: false, a: false, s: false, d: true } };
    resolvePlayerMovement(player, [], GAME_CONFIG.PLAYER_SPEED);
    expect(player.x).toBe(400 + GAME_CONFIG.PLAYER_SPEED);
    expect(player.y).toBe(400);
  });

  test("diagonal movement applies both axes", () => {
    const player = { x: 400, y: 400, keys: { w: true, a: false, s: false, d: true } };
    resolvePlayerMovement(player, [], GAME_CONFIG.PLAYER_SPEED);
    expect(player.x).toBe(400 + GAME_CONFIG.PLAYER_SPEED);
    expect(player.y).toBe(400 - GAME_CONFIG.PLAYER_SPEED);
  });

  test("player is blocked by obstacle on X axis", () => {
    const obstacle: Obstacle = { id: "obs1", x: 410, y: 384, size: 30, destroyed: false };
    const player = { x: 400, y: 400, keys: { w: false, a: false, s: false, d: true } };
    resolvePlayerMovement(player, [obstacle], GAME_CONFIG.PLAYER_SPEED);
    // X should be reverted to oldX because collision detected
    expect(player.x).toBe(400);
  });

  test("player is blocked by obstacle on Y axis", () => {
    const obstacle: Obstacle = { id: "obs1", x: 384, y: 410, size: 30, destroyed: false };
    const player = { x: 400, y: 400, keys: { w: false, a: false, s: true, d: false } };
    resolvePlayerMovement(player, [obstacle], GAME_CONFIG.PLAYER_SPEED);
    // Y should be reverted to oldY because collision detected
    expect(player.y).toBe(400);
  });

  test("destroyed obstacle is ignored", () => {
    const obstacle: Obstacle = { id: "obs1", x: 410, y: 384, size: 30, destroyed: true };
    const player = { x: 400, y: 400, keys: { w: false, a: false, s: false, d: true } };
    resolvePlayerMovement(player, [obstacle], GAME_CONFIG.PLAYER_SPEED);
    expect(player.x).toBe(400 + GAME_CONFIG.PLAYER_SPEED);
  });

  test("player can slide along wall (X blocked, Y free)", () => {
    // Obstacle placed to the right and above — blocks rightward but not downward
    const obstacle: Obstacle = { id: "obs1", x: 416, y: 370, size: 20, destroyed: false };
    const player = { x: 400, y: 400, keys: { w: false, a: false, s: true, d: true } };
    const startX = player.x;
    resolvePlayerMovement(player, [obstacle], GAME_CONFIG.PLAYER_SPEED);
    // X reverted because moving right puts player in obstacle radius, Y allowed
    expect(player.x).toBe(startX);
    expect(player.y).toBe(400 + GAME_CONFIG.PLAYER_SPEED);
  });

  test("no movement when no keys pressed", () => {
    const player = { x: 500, y: 500, keys: { w: false, a: false, s: false, d: false } };
    resolvePlayerMovement(player, [], GAME_CONFIG.PLAYER_SPEED);
    expect(player.x).toBe(500);
    expect(player.y).toBe(500);
  });

  test("opposing keys cancel out movement", () => {
    const player = { x: 500, y: 500, keys: { w: true, a: false, s: true, d: false } };
    resolvePlayerMovement(player, [], GAME_CONFIG.PLAYER_SPEED);
    // Both W and S pressed: move up then down, net zero
    expect(player.y).toBe(500);
  });
});
