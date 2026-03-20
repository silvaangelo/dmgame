export const GAME_CONFIG = {
  TICK_RATE: 35,
  MAX_PLAYERS: 10,
  MIN_PLAYERS: 2,
  QUEUE_COUNTDOWN: 10,
  READY_COUNTDOWN: 3,
  PLAYER_HP: 4,
  LMS_PLAYER_HP: 20,         // Last Man Standing — players start with 20 HP
  PLAYER_SPEED: 8,
  PLAYER_RADIUS: 20,
  SHOTS_PER_MAGAZINE: 35,
  SHOT_COOLDOWN: 35,
  RELOAD_TIME: 1950,
  // Weapon-specific reload times
  MACHINEGUN_RELOAD_TIME: 1800,
  SHOTGUN_RELOAD_TIME: 2800,
  SNIPER_RELOAD_TIME: 3000,
  BULLET_SPEED: 22,
  BULLET_LIFETIME: 2500,
  ARENA_WIDTH: 4000,
  ARENA_HEIGHT: 4000,
  // Machine Gun (automatic)
  MACHINEGUN_COOLDOWN: 35,
  MACHINEGUN_DAMAGE: 1,
  MACHINEGUN_RECOIL: 0.06,
  // Shotgun — powerful close-range
  SHOTGUN_COOLDOWN: 600,
  SHOTGUN_DAMAGE: 3,
  SHOTGUN_PELLETS: 7,
  SHOTGUN_SPREAD: 0.35,
  SHOTGUN_AMMO: 10,          // shells per magazine
  // Knife
  KNIFE_COOLDOWN: 200,
  KNIFE_DAMAGE: 4,
  KNIFE_RANGE: 55,
  KNIFE_SPEED_BONUS: 1.5,
  // Pickups — less frequent, more powerful
  PICKUP_SPAWN_INTERVAL: 18000,
  PICKUP_LIFETIME: 30000,
  PICKUP_RADIUS: 40,
  PICKUP_HEALTH_AMOUNT: 5,
  PICKUP_SPEED_DURATION: 12000,
  PICKUP_SPEED_MULTIPLIER: 2.0,
  MAX_PICKUPS: 4,
  // Minigun (powerup)
  MINIGUN_COOLDOWN: 14,
  MINIGUN_DAMAGE: 2,
  MINIGUN_RECOIL: 0.06,
  MINIGUN_DURATION: 15000,
  // Sniper Rifle
  SNIPER_COOLDOWN: 1100,
  SNIPER_DAMAGE: 8,
  SNIPER_BULLET_SPEED: 44,
  SNIPER_AMMO: 7,            // rounds per magazine
  // Shield powerup — more powerful
  SHIELD_DURATION: 15000,
  SHIELD_ABSORB: 5, // absorbs 5 HP worth of damage
  // Invisibility powerup — more powerful
  INVISIBILITY_DURATION: 12000,
  // Health Regen powerup — more powerful
  REGEN_DURATION: 16000,
  REGEN_TICK_INTERVAL: 1200, // heal 1 HP every 1.2 seconds
  // Armor pickup
  ARMOR_AMOUNT: 3,           // +3 temporary HP above max
  ARMOR_MAX: 3,              // max armor a player can have
  // Dash ability
  DASH_COOLDOWN: 1000,       // 1s between dashes
  DASH_DURATION: 150,        // dash lasts 150ms
  DASH_SPEED: 28,            // pixels per tick during dash
  DASH_INVINCIBLE: true,     // i-frames during dash
  // Bombs
  BOMB_SPAWN_INTERVAL: 3000,
  BOMB_FUSE_TIME: 1000,
  BOMB_DAMAGE: 1,
  BOMB_RADIUS: 80,
  // Lightning strikes
  LIGHTNING_SPAWN_INTERVAL: 5000,
  LIGHTNING_FUSE_TIME: 250,
  LIGHTNING_DAMAGE: 2,
  LIGHTNING_RADIUS: 150,
  KILLS_TO_WIN: 999,          // Not used — persistent world
  GAME_DURATION: 0,            // No timer — persistent world
  ROUND_DURATION: 300000,      // 5 minutes per round (ms)
  ROUND_RESTART_DELAY: 10000,  // 10s scoreboard before next round
  KILL_SCORE: 10,              // Points per kill
  ORB_SCORE: 1,                // Points per orb collected
  // Orbs (slither-style collectible points)
  ORB_SPAWN_INTERVAL: 1500,    // Spawn new orbs every 1.5s
  ORB_RADIUS: 16,
  ORB_MAX: 250,                // Max orbs on map at once
  ORB_LIFETIME: 45000,         // Orbs last 45s
  DEATH_ORB_DROP_FRACTION: 0.5, // Drop half points on death
  RESPAWN_TIME: 2000,
  OBSTACLE_SPAWN_INTERVAL: 8000,
  // Dynamic arena shrinking — disabled in persistent mode
  ZONE_SHRINK_START: 999999999,  // Effectively never
  ZONE_SHRINK_INTERVAL: 100,
  ZONE_SHRINK_RATE: 0.3,
  ZONE_DAMAGE_INTERVAL: 1000,
  ZONE_DAMAGE: 1,
  ZONE_MIN_SIZE: 200,
  // Loot crates
  LOOT_CRATE_HP: 3,             // hits to destroy a crate
  LOOT_CRATE_SIZE: 28,          // collision size
  LOOT_CRATE_COUNT: 6,          // initial crates per match
  LOOT_CRATE_RESPAWN_INTERVAL: 20000, // respawn a crate every 20s
  LOOT_CRATE_MAX: 8,            // max crates on map
  ROOM_MAX_PLAYERS: 10,
  ROOM_READY_TIMEOUT: 45,
  PRE_GAME_READY_TIMEOUT: 15,
  USERNAME_MIN_LENGTH: 2,
  USERNAME_MAX_LENGTH: 16,
  USERNAME_PATTERN: /^[a-zA-Z0-9_]+$/,
};

export const WEAPON_CYCLE = ["machinegun", "shotgun", "knife", "sniper"] as const;

export const OBSTACLE_CONFIG = {
  WALL_COUNT_MIN: 40,
  WALL_COUNT_MAX: 60,
  WALL_LENGTH_MIN: 2,
  WALL_LENGTH_MAX: 10,
  WALL_BLOCK_SIZE: 14,
  WALL_SPACING: 60,
  TREE_COUNT_MIN: 20,
  TREE_COUNT_MAX: 35,
  TREE_SIZE: 24,             // smaller collision box to avoid getting stuck
  TREE_SPACING: 70,
};
