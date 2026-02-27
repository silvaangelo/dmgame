import { WebSocket } from "ws";
import type { Game, Obstacle } from "./types.js";
import { GAME_CONFIG } from "./config.js";
import { games, allPlayers } from "./state.js";
import { wss } from "./server.js";
import { serialize } from "./protocol.js";

/* ================= BROADCAST ================= */

export function broadcast(game: Game, data: unknown) {
  const msg = serialize(data);
  game.players.forEach((p) => {
    try {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(msg);
      }
    } catch (error) {
      console.error(`Failed to send message to ${p.username}:`, error);
    }
  });
}

/* ================= SERIALIZATION ================= */

export function serializePlayers(game: Game) {
  return game.players.map((p) => ({
    id: p.id,
    username: p.username,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    hp: p.hp,
    team: p.team,
    shots: p.shots,
    reloading: p.reloading,
    lastShotTime: p.lastShotTime,
    lastProcessedInput: p.lastProcessedInput,
    kills: p.kills,
    deaths: p.deaths,
    aimAngle: Math.round(p.aimAngle * 100) / 100,
    weapon: p.weapon,
  }));
}

export function serializePlayersCompact(game: Game) {
  const now = Date.now();
  const WEAPON_CODES: Record<string, number> = {
    machinegun: 0, shotgun: 1, knife: 2, minigun: 3,
    sniper: 4,
  };
  return game.players.map((p) => [
    p.id,
    Math.round(p.x * 10) / 10,
    Math.round(p.y * 10) / 10,
    p.hp,
    p.shots,
    p.reloading ? 1 : 0,
    p.lastProcessedInput,
    Math.round(p.aimAngle * 100) / 100,
    WEAPON_CODES[p.weapon] ?? 0,
    p.kills,
    p.skin,
    now < p.speedBoostUntil ? 1 : 0,
    now < p.shieldUntil ? 1 : 0,
    now < p.invisibleUntil ? 1 : 0,
    now < p.regenUntil ? 1 : 0,
    p.armor,
    now < p.dashUntil ? 1 : 0,
  ]);
}

/* ================= LOOKUPS ================= */

export function findGameByPlayer(playerId: string) {
  for (const game of games.values()) {
    if (game.players.some((p) => p.id === playerId)) return game;
  }
}

export function isPositionClear(
  x: number,
  y: number,
  obstacles: Obstacle[],
  radius: number = GAME_CONFIG.PLAYER_RADIUS
): boolean {
  for (const obstacle of obstacles) {
    if (obstacle.destroyed) continue;
    const closestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.size));
    const closestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.size));
    const distanceX = x - closestX;
    const distanceY = y - closestY;
    const distanceSquared = distanceX * distanceX + distanceY * distanceY;
    if (distanceSquared < radius * radius) {
      return false;
    }
  }
  return true;
}

/* ================= GLOBAL BROADCASTS ================= */

let onlineListDebounceTimer: NodeJS.Timeout | null = null;
const SECONDARY_DEBOUNCE_MS = 250;

export function broadcastOnlineList() {
  const onlineList = Array.from(allPlayers.values()).map((p) => ({
    id: p.id,
    username: p.username,
    status: p.status,
  }));
  const msg = serialize({ type: "onlineList", players: onlineList });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

export function debouncedBroadcastOnlineList() {
  if (onlineListDebounceTimer) clearTimeout(onlineListDebounceTimer);
  onlineListDebounceTimer = setTimeout(() => {
    broadcastOnlineList();
    onlineListDebounceTimer = null;
  }, SECONDARY_DEBOUNCE_MS);
}
