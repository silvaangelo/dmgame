import { WebSocket } from "ws";

export type WeaponType = "machinegun" | "shotgun" | "knife" | "minigun" | "sniper" | "grenade_launcher" | "dual_pistols";

export type Player = {
  id: string;
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
  // Anti-cheat
  msgCount: number;
  msgWindowStart: number;
  violations: number;
  lastWeaponSwitch: number;
};

export type Bullet = {
  id: string;
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

export type Grenade = {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  playerId: string;
  createdAt: number;
};

export type Pickup = {
  id: string;
  x: number;
  y: number;
  type: "health" | "ammo" | "speed" | "minigun" | "shield" | "invisibility" | "regen";
  createdAt: number;
};

export type Game = {
  id: string;
  players: Player[];
  bullets: Bullet[];
  grenades: Grenade[];
  obstacles: Obstacle[];
  pickups: Pickup[];
  bombs: Bomb[];
  lightnings: Lightning[];
  started: boolean;
  lastBroadcastState?: Map<string, unknown>;
  stateSequence: number;
  obstacleSpawnInterval?: NodeJS.Timeout;
  pickupSpawnInterval?: NodeJS.Timeout;
  bombSpawnInterval?: NodeJS.Timeout;
  lightningSpawnInterval?: NodeJS.Timeout;
  preGameTimeout?: NodeJS.Timeout;
  preGameCountdownInterval?: NodeJS.Timeout;
};

export type Room = {
  id: string;
  name: string;
  players: Player[];
  countdownStarted: boolean;
  countdownInterval?: NodeJS.Timeout;
  countdownTimeout?: NodeJS.Timeout;
  timeRemaining: number;
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
  gamesPlayed: number;
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
