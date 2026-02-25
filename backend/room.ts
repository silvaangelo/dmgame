import { v4 as uuid } from "uuid";
import { WebSocket } from "ws";
import type { Player, Room } from "./types.js";
import { GAME_CONFIG } from "./config.js";
import { rooms, allPlayers } from "./state.js";
import { wss } from "./server.js";
import { debouncedBroadcastOnlineList } from "./utils.js";
import { startGameFromRoom } from "./matchmaking.js";

/* ================= ROOM NAME GENERATOR ================= */

const ADJECTIVES = [
  "Iron", "Shadow", "Red", "Steel", "Dark", "Fire", "Ice", "Thunder",
  "Silent", "Ghost", "Alpha", "Bravo", "Delta", "Omega", "Crimson",
  "Golden", "Silver", "Neon", "Cyber", "Savage", "Rapid", "Frost",
  "Storm", "Night", "Rogue",
];

const NOUNS = [
  "Phoenix", "Fortress", "Storm", "Wolf", "Viper", "Eagle", "Hawk",
  "Strike", "Raven", "Tiger", "Cobra", "Falcon", "Dragon", "Phantom",
  "Reaper", "Arena", "Bunker", "Outpost", "Squad", "Legion", "Blade",
  "Fang", "Claw", "Surge", "Fury",
];

function generateRoomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

/* ================= ROOM SERIALIZATION ================= */

function serializeRoom(room: Room) {
  return {
    id: room.id,
    name: room.name,
    players: room.players.map((p) => ({
      id: p.id,
      username: p.username,
      ready: p.ready,
      skin: p.skin,
    })),
    maxPlayers: GAME_CONFIG.ROOM_MAX_PLAYERS,
    timeRemaining: room.countdownStarted ? room.timeRemaining : null,
  };
}

function serializeRoomListItem(room: Room) {
  return {
    id: room.id,
    name: room.name,
    playerCount: room.players.length,
    maxPlayers: GAME_CONFIG.ROOM_MAX_PLAYERS,
  };
}

/* ================= BROADCAST ================= */

export function broadcastRoomList() {
  const roomList = Array.from(rooms.values()).map(serializeRoomListItem);
  const msg = JSON.stringify({ type: "roomList", rooms: roomList });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function broadcastRoomUpdate(room: Room) {
  const msg = JSON.stringify({ type: "roomUpdate", room: serializeRoom(room) });
  room.players.forEach((p) => {
    try {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(msg);
      }
    } catch (error) {
      console.error(`Failed to send room update to ${p.username}:`, error);
    }
  });
}

/* ================= ROOM COUNTDOWN ================= */

function clearRoomCountdown(room: Room) {
  if (room.countdownInterval) {
    clearInterval(room.countdownInterval);
    room.countdownInterval = undefined;
  }
  if (room.countdownTimeout) {
    clearTimeout(room.countdownTimeout);
    room.countdownTimeout = undefined;
  }
  room.countdownStarted = false;
  room.timeRemaining = GAME_CONFIG.ROOM_READY_TIMEOUT;
}

function startRoomCountdown(room: Room) {
  if (room.countdownStarted) return;

  room.countdownStarted = true;
  room.timeRemaining = GAME_CONFIG.ROOM_READY_TIMEOUT;

  console.log(`⏰ Room "${room.name}" countdown started (${room.timeRemaining}s)`);

  // Tick every second
  room.countdownInterval = setInterval(() => {
    room.timeRemaining--;

    // Broadcast countdown to room players
    const msg = JSON.stringify({
      type: "roomCountdown",
      timeRemaining: room.timeRemaining,
    });
    room.players.forEach((p) => {
      try {
        if (p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(msg);
        }
      } catch { /* ignore */ }
    });

    if (room.timeRemaining <= 0) {
      clearRoomCountdown(room);
      handleRoomTimeout(room);
    }
  }, 1000);
}

function handleRoomTimeout(room: Room) {
  if (room.players.length >= GAME_CONFIG.MIN_PLAYERS) {
    // Force all players to ready and start the game with everyone
    console.log(`⏰ Room "${room.name}" timeout — starting game with all ${room.players.length} players`);
    room.players.forEach((p) => { p.ready = true; });
    startGameFromRoom(room);
  } else {
    // Not enough players, reset countdown
    console.log(`⏰ Room "${room.name}" timeout — not enough players, resetting.`);

    room.players.forEach((p) => {
      p.ready = false;
    });

    broadcastRoomUpdate(room);

    // If still ≥2 players, restart countdown
    if (room.players.length >= GAME_CONFIG.MIN_PLAYERS) {
      startRoomCountdown(room);
    }
  }
}

/* ================= ROOM OPERATIONS ================= */

export function createRoom(player: Player): Room | null {
  // If a room with free spots already exists, auto-join that room instead
  for (const existingRoom of rooms.values()) {
    if (existingRoom.players.length < GAME_CONFIG.ROOM_MAX_PLAYERS) {
      console.log(`🔀 Redirecting ${player.username} to existing room "${existingRoom.name}" instead of creating new one`);
      joinRoom(player, existingRoom.id);
      return null;
    }
  }

  const room: Room = {
    id: uuid(),
    name: generateRoomName(),
    players: [player],
    countdownStarted: false,
    timeRemaining: GAME_CONFIG.ROOM_READY_TIMEOUT,
  };

  rooms.set(room.id, room);

  const tracked = allPlayers.get(player.id);
  if (tracked) tracked.status = "in-room";
  debouncedBroadcastOnlineList();

  console.log(`🚪 Room "${room.name}" created by ${player.username}`);

  player.ws.send(JSON.stringify({
    type: "roomJoined",
    room: serializeRoom(room),
  }));

  broadcastRoomList();

  return room;
}

export function joinRoom(player: Player, roomId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) {
    player.ws.send(JSON.stringify({
      type: "error",
      message: "Room not found.",
    }));
    return false;
  }

  if (room.players.length >= GAME_CONFIG.ROOM_MAX_PLAYERS) {
    player.ws.send(JSON.stringify({
      type: "error",
      message: "Room is full.",
    }));
    return false;
  }

  room.players.push(player);
  player.ready = false;

  const tracked = allPlayers.get(player.id);
  if (tracked) tracked.status = "in-room";
  debouncedBroadcastOnlineList();

  console.log(`👤 ${player.username} joined room "${room.name}" (${room.players.length}/${GAME_CONFIG.ROOM_MAX_PLAYERS})`);

  player.ws.send(JSON.stringify({
    type: "roomJoined",
    room: serializeRoom(room),
  }));

  broadcastRoomUpdate(room);
  broadcastRoomList();

  // Start countdown when ≥2 players
  if (room.players.length >= GAME_CONFIG.MIN_PLAYERS && !room.countdownStarted) {
    startRoomCountdown(room);
  }

  return true;
}

export function leaveRoom(player: Player) {
  const room = findRoomByPlayer(player.id);
  if (!room) return;

  room.players = room.players.filter((p) => p.id !== player.id);

  const tracked = allPlayers.get(player.id);
  if (tracked) tracked.status = "online";
  debouncedBroadcastOnlineList();

  console.log(`👋 ${player.username} left room "${room.name}" (${room.players.length}/${GAME_CONFIG.ROOM_MAX_PLAYERS})`);

  if (room.players.length === 0) {
    // Room empty, delete it
    clearRoomCountdown(room);
    rooms.delete(room.id);
    console.log(`🗑️  Room "${room.name}" deleted (empty)`);
  } else {
    // If below min players, stop countdown
    if (room.players.length < GAME_CONFIG.MIN_PLAYERS) {
      clearRoomCountdown(room);
    }
    broadcastRoomUpdate(room);
  }

  broadcastRoomList();
}

export function markRoomReady(player: Player) {
  const room = findRoomByPlayer(player.id);
  if (!room) return;

  player.ready = true;
  broadcastRoomUpdate(room);

  console.log(`✅ ${player.username} is ready in room "${room.name}"`);

  // Check if all players are ready
  const allReady = room.players.every((p) => p.ready);
  if (allReady && room.players.length >= GAME_CONFIG.MIN_PLAYERS) {
    clearRoomCountdown(room);
    console.log(`🎮 All players ready in room "${room.name}"! Starting game...`);
    startGameFromRoom(room);
  }
}

export function findRoomByPlayer(playerId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === playerId)) return room;
  }
}

export function removePlayerFromRooms(playerId: string) {
  for (const room of rooms.values()) {
    const playerInRoom = room.players.some((p) => p.id === playerId);
    if (playerInRoom) {
      room.players = room.players.filter((p) => p.id !== playerId);

      if (room.players.length === 0) {
        clearRoomCountdown(room);
        rooms.delete(room.id);
      } else {
        if (room.players.length < GAME_CONFIG.MIN_PLAYERS) {
          clearRoomCountdown(room);
        }
        broadcastRoomUpdate(room);
      }
      broadcastRoomList();
      break;
    }
  }
}
