export const GAME_CONFIG = {
  TICK_RATE: 35,
  MAX_PLAYERS: 10,
  MIN_PLAYERS: 2,
  QUEUE_COUNTDOWN: 10,
  READY_COUNTDOWN: 3,
  PLAYER_HP: 4,
  PLAYER_SPEED: 8,
  PLAYER_RADIUS: 20,
  SHOTS_PER_MAGAZINE: 30,
  SHOT_COOLDOWN: 35,
  RELOAD_TIME: 1950,
  // Weapon-specific reload times
  MACHINEGUN_RELOAD_TIME: 1800,
  SHOTGUN_RELOAD_TIME: 2400,
  SNIPER_RELOAD_TIME: 2800,
  BULLET_SPEED: 15,
  BULLET_LIFETIME: 2000,
  ARENA_WIDTH: 1400,
  ARENA_HEIGHT: 900,
  // Machine Gun (automatic)
  MACHINEGUN_COOLDOWN: 30,
  MACHINEGUN_DAMAGE: 2,
  MACHINEGUN_RECOIL: 0.05,
  // Shotgun
  SHOTGUN_COOLDOWN: 500,
  SHOTGUN_DAMAGE: 1,
  SHOTGUN_PELLETS: 6,
  SHOTGUN_SPREAD: 0.4,
  // Knife
  KNIFE_COOLDOWN: 200,
  KNIFE_DAMAGE: 2,
  KNIFE_RANGE: 55,
  KNIFE_SPEED_BONUS: 1.5,
  // Pickups
  PICKUP_SPAWN_INTERVAL: 10000,
  PICKUP_LIFETIME: 25000,
  PICKUP_RADIUS: 30,
  PICKUP_HEALTH_AMOUNT: 3,
  PICKUP_SPEED_DURATION: 8000,
  PICKUP_SPEED_MULTIPLIER: 1.8,
  MAX_PICKUPS: 6,
  // Minigun (powerup)
  MINIGUN_COOLDOWN: 14,
  MINIGUN_DAMAGE: 2,
  MINIGUN_RECOIL: 0.06,
  MINIGUN_DURATION: 12000,
  // Sniper Rifle
  SNIPER_COOLDOWN: 1200,
  SNIPER_DAMAGE: 4,
  SNIPER_BULLET_SPEED: 30,
  // Shield powerup
  SHIELD_DURATION: 10000,
  SHIELD_ABSORB: 3, // absorbs 3 HP worth of damage
  // Invisibility powerup
  INVISIBILITY_DURATION: 8000,
  // Health Regen powerup
  REGEN_DURATION: 12000,
  REGEN_TICK_INTERVAL: 1500, // heal 1 HP every 1.5 seconds
  // Armor pickup
  ARMOR_AMOUNT: 2,           // +2 temporary HP above max
  ARMOR_MAX: 2,              // max armor a player can have
  // Dash ability
  DASH_COOLDOWN: 3000,       // 3s between dashes
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
  KILLS_TO_WIN: 5,
  RESPAWN_TIME: 1500,
  OBSTACLE_SPAWN_INTERVAL: 8000,
  // Dynamic arena shrinking
  ZONE_SHRINK_START: 60000,     // 60s after match start
  ZONE_SHRINK_INTERVAL: 100,    // Tick every 100ms
  ZONE_SHRINK_RATE: 0.3,        // Pixels per tick to shrink each edge
  ZONE_DAMAGE_INTERVAL: 1000,   // Damage every 1s
  ZONE_DAMAGE: 1,               // 1 HP per tick outside zone
  ZONE_MIN_SIZE: 200,           // Minimum zone size (width/height)
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
  WALL_COUNT_MIN: 14,
  WALL_COUNT_MAX: 22,
  WALL_LENGTH_MIN: 4,
  WALL_LENGTH_MAX: 10,
  WALL_BLOCK_SIZE: 14,
  WALL_SPACING: 60,
  TREE_COUNT_MIN: 7,
  TREE_COUNT_MAX: 12,
  TREE_SIZE: 30,
  TREE_SPACING: 70,
};
