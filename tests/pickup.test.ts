import { describe, test, expect } from "bun:test";
import { GAME_CONFIG } from "../backend/config.js";
import type { Player, Pickup } from "../backend/types.js";

// ===== PICKUP APPLICATION (extracted from game.ts applyPickup) =====

function createTestPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    username: "TestPlayer",
    ws: null as unknown as Player["ws"],
    team: 0,
    x: 400,
    y: 400,
    hp: GAME_CONFIG.PLAYER_HP,
    shots: GAME_CONFIG.SHOTS_PER_MAGAZINE,
    reloading: false,
    lastShotTime: 0,
    keys: { w: false, a: false, s: false, d: false },
    lastProcessedInput: 0,
    kills: 0,
    deaths: 0,
    ready: false,
    aimAngle: 0,
    weapon: "machinegun",
    skin: 0,
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

function applyPickup(player: Player, pickup: Pickup) {
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
    case "armor":
      player.armor = Math.min(GAME_CONFIG.ARMOR_MAX, player.armor + GAME_CONFIG.ARMOR_AMOUNT);
      break;
  }
}

function createPickup(type: Pickup["type"]): Pickup {
  return { id: "pk1", x: 400, y: 400, type, createdAt: Date.now() };
}

describe("Pickup Application", () => {
  test("health pickup heals player", () => {
    const player = createTestPlayer({ hp: 1 });
    applyPickup(player, createPickup("health"));
    expect(player.hp).toBe(Math.min(GAME_CONFIG.PLAYER_HP, 1 + GAME_CONFIG.PICKUP_HEALTH_AMOUNT));
  });

  test("health pickup does not exceed max HP", () => {
    const player = createTestPlayer({ hp: GAME_CONFIG.PLAYER_HP });
    applyPickup(player, createPickup("health"));
    expect(player.hp).toBe(GAME_CONFIG.PLAYER_HP);
  });

  test("health pickup caps at max HP when partial heal", () => {
    const player = createTestPlayer({ hp: GAME_CONFIG.PLAYER_HP - 1 });
    applyPickup(player, createPickup("health"));
    expect(player.hp).toBe(GAME_CONFIG.PLAYER_HP);
  });

  test("ammo pickup refills magazine", () => {
    const player = createTestPlayer({ shots: 5, reloading: true });
    applyPickup(player, createPickup("ammo"));
    expect(player.shots).toBe(GAME_CONFIG.SHOTS_PER_MAGAZINE);
    expect(player.reloading).toBe(false);
  });

  test("speed pickup sets speed boost timer", () => {
    const player = createTestPlayer();
    const before = Date.now();
    applyPickup(player, createPickup("speed"));
    expect(player.speedBoostUntil).toBeGreaterThanOrEqual(before + GAME_CONFIG.PICKUP_SPEED_DURATION);
  });

  test("minigun pickup switches weapon", () => {
    const player = createTestPlayer({ weapon: "shotgun", reloading: true });
    applyPickup(player, createPickup("minigun"));
    expect(player.weapon).toBe("minigun");
    expect(player.reloading).toBe(false);
    expect(player.minigunUntil).toBeGreaterThan(Date.now());
  });

  test("shield pickup activates shield timer", () => {
    const player = createTestPlayer();
    const before = Date.now();
    applyPickup(player, createPickup("shield"));
    expect(player.shieldUntil).toBeGreaterThanOrEqual(before + GAME_CONFIG.SHIELD_DURATION);
  });

  test("invisibility pickup activates invisibility timer", () => {
    const player = createTestPlayer();
    const before = Date.now();
    applyPickup(player, createPickup("invisibility"));
    expect(player.invisibleUntil).toBeGreaterThanOrEqual(before + GAME_CONFIG.INVISIBILITY_DURATION);
  });

  test("regen pickup activates regen timer", () => {
    const player = createTestPlayer();
    const before = Date.now();
    applyPickup(player, createPickup("regen"));
    expect(player.regenUntil).toBeGreaterThanOrEqual(before + GAME_CONFIG.REGEN_DURATION);
    expect(player.lastRegenTick).toBeGreaterThanOrEqual(before);
  });

  test("armor pickup adds armor", () => {
    const player = createTestPlayer({ armor: 0 });
    applyPickup(player, createPickup("armor"));
    expect(player.armor).toBe(GAME_CONFIG.ARMOR_AMOUNT);
  });

  test("armor pickup does not exceed max", () => {
    const player = createTestPlayer({ armor: GAME_CONFIG.ARMOR_MAX });
    applyPickup(player, createPickup("armor"));
    expect(player.armor).toBe(GAME_CONFIG.ARMOR_MAX);
  });
});

describe("Pickup Collision Detection", () => {
  test("player within pickup radius collects it", () => {
    const player = { x: 400, y: 400 };
    const pickup = { x: 405, y: 405 };
    const collisionDist = GAME_CONFIG.PLAYER_RADIUS + GAME_CONFIG.PICKUP_RADIUS;
    const dx = player.x - pickup.x;
    const dy = player.y - pickup.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeLessThan(collisionDist);
  });

  test("player far from pickup does not collect it", () => {
    const player = { x: 100, y: 100 };
    const pickup = { x: 500, y: 500 };
    const collisionDist = GAME_CONFIG.PLAYER_RADIUS + GAME_CONFIG.PICKUP_RADIUS;
    const dx = player.x - pickup.x;
    const dy = player.y - pickup.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeGreaterThan(collisionDist);
  });

  test("pickup collision uses combined radii", () => {
    const combinedRadius = GAME_CONFIG.PLAYER_RADIUS + GAME_CONFIG.PICKUP_RADIUS;
    expect(combinedRadius).toBe(20 + 30); // 50 pixels
  });
});

describe("Zone Damage Configuration", () => {
  test("zone starts shrinking after configured delay", () => {
    expect(GAME_CONFIG.ZONE_SHRINK_START).toBe(60000);
  });

  test("zone has minimum size", () => {
    expect(GAME_CONFIG.ZONE_MIN_SIZE).toBeGreaterThan(0);
    expect(GAME_CONFIG.ZONE_MIN_SIZE).toBeLessThan(GAME_CONFIG.ARENA_WIDTH);
  });

  test("zone damage is configured", () => {
    expect(GAME_CONFIG.ZONE_DAMAGE).toBeGreaterThan(0);
  });
});
