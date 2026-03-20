import { WebSocket } from "ws";

export type WeaponType = "machinegun" | "shotgun" | "knife" | "minigun" | "sniper";

export type GameMode = "deathmatch";
export type GameModeVote = "deathmatch";

export type Player = {
  id: string;
  shortId: number; // Compact numeric ID for binary state protocol
  username: string;
  ws: WebSocket;
  team: number;
  x: number;
  y: number;
  hp: number;
  shots: number;
  reloading: boolean;
  lastShotTime: number;
  keys: { w: boolean; a: boolean; s: boolean; d: boolean };
  lastProcessedInput: number;
  kills: number;
  deaths: number;
  score: number;
  ready: boolean;
  aimAngle: number;
  weapon: WeaponType;
  skin: number;
  speedBoostUntil: number;
  minigunUntil: number;
  killStreak: number;
  lastKilledBy: string;
  // Powerup states
  shieldUntil: number;
  invisibleUntil: number;
  regenUntil: number;
  lastRegenTick: number;
  // Armor (temporary extra HP above max)
  armor: number;
  // Respawn
  waitingForRespawn: boolean;
  // Dash ability
  dashCooldownUntil: number;
  dashUntil: number;
  dashDirX: number;
  dashDirY: number;
  // Anti-cheat
  msgCount: number;
  msgWindowStart: number;
  violations: number;
  lastWeaponSwitch: number;
};

export type Bullet = {
  id: string;
  shortId: number; // Compact numeric ID for binary state protocol
  x: number;
  y: number;
  dx: number;
  dy: number;
  team: number;
  playerId: string;
  damage: number;
  weapon: WeaponType;
  createdAt: number;
};

export type Obstacle = {
  id: string;
  x: number;
  y: number;
  size: number;
  destroyed: boolean;
  type?: string;
  groupId?: string;  // wall segments sharing a groupId get destroyed together
};

export type Bomb = {
  id: string;
  x: number;
  y: number;
  createdAt: number;
};

export type Lightning = {
  id: string;
  x: number;
  y: number;
  createdAt: number;
};

export type Pickup = {
  id: string;
  shortId: number;
  x: number;
  y: number;
  type: "health" | "ammo" | "speed" | "minigun" | "shield" | "invisibility" | "regen" | "armor";
  createdAt: number;
};

export type Orb = {
  id: string;
  shortId: number;
  x: number;
  y: number;
  createdAt: number;
};

export type LootCrate = {
  id: string;
  shortId: number;
  x: number;
  y: number;
  hp: number;
  createdAt: number;
};

export type Game = {
  id: string;
  nextShortId: number; // Counter for binary protocol short IDs
  players: Player[];
  bullets: Bullet[];
  obstacles: Obstacle[];
  pickups: Pickup[];
  orbs: Orb[];
  bombs: Bomb[];
  lightnings: Lightning[];
  lootCrates: LootCrate[];
  started: boolean;
  gameMode: GameMode;
  lastBroadcastState?: Map<string, unknown>;
  stateSequence: number;
  obstacleSpawnInterval?: NodeJS.Timeout;
  pickupSpawnInterval?: NodeJS.Timeout;
  orbSpawnInterval?: NodeJS.Timeout;
  bombSpawnInterval?: NodeJS.Timeout;
  lightningSpawnInterval?: NodeJS.Timeout;
  lootCrateSpawnInterval?: NodeJS.Timeout;
  preGameTimeout?: NodeJS.Timeout;
  preGameCountdownInterval?: NodeJS.Timeout;
  gameTimerTimeout?: NodeJS.Timeout;
  gameTimerInterval?: NodeJS.Timeout;
  // Dynamic arena shrinking
  matchStartTime: number;
  zoneShrinkInterval?: NodeJS.Timeout;
  zoneDamageInterval?: NodeJS.Timeout;
  zoneX: number;
  zoneY: number;
  zoneW: number;
  zoneH: number;
  zoneShrinking: boolean;
};

export type Room = {
  id: string;
  name: string;
  players: Player[];
  countdownStarted: boolean;
  countdownInterval?: NodeJS.Timeout;
  countdownTimeout?: NodeJS.Timeout;
  timeRemaining: number;
  gameModeVotes: Map<string, GameModeVote>;
};

export type TrackedPlayer = {
  id: string;
  username: string;
  status: "online" | "in-room" | "in-game";
  ws: WebSocket;
};

export type PlayerStats = {
  username: string;
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  mmr: number;
};

export type MatchHistoryEntry = {
  timestamp: number;
  players: { username: string; kills: number; deaths: number; isWinner: boolean }[];
  winnerName: string;
};

export type RegisteredUser = {
  username: string;
  token: string;
  createdAt: number;
  lastSeen: number;
};
