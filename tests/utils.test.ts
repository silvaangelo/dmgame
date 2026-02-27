import { describe, test, expect } from "bun:test";
import { isPositionClear } from "../backend/utils.js";
import { GAME_CONFIG } from "../backend/config.js";
import { serializePlayersCompact } from "../backend/utils.js";
import type { Obstacle, Player, Game } from "../backend/types.js";

describe("isPositionClear", () => {
  test("returns true with no obstacles", () => {
    expect(isPositionClear(400, 400, [])).toBe(true);
  });

  test("returns false when position overlaps obstacle", () => {
    const obstacle: Obstacle = { id: "o1", x: 390, y: 390, size: 20, destroyed: false };
    expect(isPositionClear(400, 400, [obstacle])).toBe(false);
  });

  test("returns true when position is far from obstacle", () => {
    const obstacle: Obstacle = { id: "o1", x: 100, y: 100, size: 20, destroyed: false };
    expect(isPositionClear(400, 400, [obstacle])).toBe(true);
  });

  test("returns true for destroyed obstacles", () => {
    const obstacle: Obstacle = { id: "o1", x: 395, y: 395, size: 20, destroyed: true };
    expect(isPositionClear(400, 400, [obstacle])).toBe(true);
  });

  test("respects custom radius", () => {
    const obstacle: Obstacle = { id: "o1", x: 430, y: 400, size: 20, destroyed: false };
    // Default radius (16) — should be clear
    expect(isPositionClear(400, 400, [obstacle], 16)).toBe(true);
    // Larger radius (40) — should collide
    expect(isPositionClear(400, 400, [obstacle], 40)).toBe(false);
  });
});

describe("serializePlayersCompact", () => {
  function createMockPlayer(overrides: Partial<Player> = {}): Player {
    return {
      id: "p1",
      username: "Test",
      ws: null as unknown as Player["ws"],
      team: 0,
      x: 100.123,
      y: 200.456,
      hp: 4,
      shots: 30,
      reloading: false,
      lastShotTime: 0,
      keys: { w: false, a: false, s: false, d: false },
      lastProcessedInput: 5,
      kills: 3,
      deaths: 1,
      ready: true,
      aimAngle: 1.2345,
      weapon: "machinegun",
      skin: 2,
      speedBoostUntil: 0,
      minigunUntil: 0,
      killStreak: 0,
      lastKilledBy: "",
      shieldUntil: 0,
      invisibleUntil: 0,
      regenUntil: 0,
      lastRegenTick: 0,
      armor: 0,
      dashCooldownUntil: 0,
      dashUntil: 0,
      dashDirX: 0,
      dashDirY: 0,
      msgCount: 0,
      msgWindowStart: 0,
      violations: 0,
      lastWeaponSwitch: 0,
      ...overrides,
    } as Player;
  }

  function createMockGame(players: Player[]): Game {
    return {
      id: "g1",
      players,
      bullets: [],
      obstacles: [],
      pickups: [],
      bombs: [],
      lightnings: [],
      lootCrates: [],
      started: true,
      stateSequence: 0,
      matchStartTime: 0,
      zoneX: 0,
      zoneY: 0,
      zoneW: GAME_CONFIG.ARENA_WIDTH,
      zoneH: GAME_CONFIG.ARENA_HEIGHT,
      zoneShrinking: false,
    };
  }

  test("produces correct compact array format", () => {
    const player = createMockPlayer();
    const game = createMockGame([player]);
    const result = serializePlayersCompact(game);
    expect(result.length).toBe(1);
    const p = result[0] as unknown[];
    expect(p[0]).toBe("p1");        // id
    expect(p[1]).toBe(100.1);       // x rounded
    expect(p[2]).toBe(200.5);       // y rounded
    expect(p[3]).toBe(4);           // hp
    expect(p[4]).toBe(30);          // shots
    expect(p[5]).toBe(0);           // not reloading
    expect(p[6]).toBe(5);           // lastProcessedInput
    expect(p[8]).toBe(0);           // machinegun code
    expect(p[9]).toBe(3);           // kills
    expect(p[10]).toBe(2);          // skin
  });

  test("weapon codes are correct", () => {
    const weapons = [
      { weapon: "machinegun", code: 0 },
      { weapon: "shotgun", code: 1 },
      { weapon: "knife", code: 2 },
      { weapon: "minigun", code: 3 },
      { weapon: "sniper", code: 4 },
    ] as const;

    for (const { weapon, code } of weapons) {
      const player = createMockPlayer({ weapon });
      const game = createMockGame([player]);
      const result = serializePlayersCompact(game);
      const p = result[0] as unknown[];
      expect(p[8]).toBe(code);
    }
  });

  test("reloading flag serializes correctly", () => {
    const player = createMockPlayer({ reloading: true });
    const game = createMockGame([player]);
    const result = serializePlayersCompact(game);
    const p = result[0] as unknown[];
    expect(p[5]).toBe(1);
  });

  test("powerup states serialize correctly", () => {
    const future = Date.now() + 10000;
    const player = createMockPlayer({
      speedBoostUntil: future,
      shieldUntil: future,
      invisibleUntil: future,
      regenUntil: future,
    });
    const game = createMockGame([player]);
    const result = serializePlayersCompact(game);
    const p = result[0] as unknown[];
    expect(p[11]).toBe(1); // speed boosted
    expect(p[12]).toBe(1); // shielded
    expect(p[13]).toBe(1); // invisible
    expect(p[14]).toBe(1); // regen
    expect(p[15]).toBe(0); // armor (default 0)
    expect(p[16]).toBe(0); // not dashing
  });

  test("expired powerups show as inactive", () => {
    const past = Date.now() - 1000;
    const player = createMockPlayer({
      speedBoostUntil: past,
      shieldUntil: past,
      invisibleUntil: past,
      regenUntil: past,
    });
    const game = createMockGame([player]);
    const result = serializePlayersCompact(game);
    const p = result[0] as unknown[];
    expect(p[11]).toBe(0);
    expect(p[12]).toBe(0);
    expect(p[13]).toBe(0);
    expect(p[14]).toBe(0);
  });

  test("armor serializes correctly", () => {
    const player = createMockPlayer({ armor: 2 });
    const game = createMockGame([player]);
    const result = serializePlayersCompact(game);
    const p = result[0] as unknown[];
    expect(p[15]).toBe(2);
  });

  test("dashing state serializes correctly", () => {
    const future = Date.now() + 5000;
    const player = createMockPlayer({ dashUntil: future });
    const game = createMockGame([player]);
    const result = serializePlayersCompact(game);
    const p = result[0] as unknown[];
    expect(p[16]).toBe(1);
  });
});
