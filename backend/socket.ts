import { v4 as uuid } from "uuid";
import type { Player } from "./types.js";
import { GAME_CONFIG, WEAPON_CYCLE } from "./config.js";
import { games, allPlayers, rooms } from "./state.js";
import { wss } from "./server.js";
import {
  broadcast,
  findGameByPlayer,
  debouncedBroadcastOnlineList,
} from "./utils.js";
import { shoot, checkVictory, reloadWeapon } from "./game.js";
import { checkAllReady } from "./matchmaking.js";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  markRoomReady,
  removePlayerFromRooms,
  findRoomByPlayer,
} from "./room.js";
import { WebSocket } from "ws";
import { getLeaderboard, getPlayerStats, getMatchHistory } from "./database.js";

export function setupSocket() {
  wss.on("connection", (ws) => {
    let player: Player | null = null;

    // Send online list on connection
    const onlineList = Array.from(allPlayers.values()).map((p) => ({
      id: p.id,
      username: p.username,
      status: p.status,
    }));
    ws.send(JSON.stringify({ type: "onlineList", players: onlineList }));

    ws.on("message", (msg) => {
      const data = JSON.parse(msg.toString());

      /* ================= LOGIN ================= */

      if (data.type === "login") {
        if (player !== null) return;
        if (!data.username || typeof data.username !== "string") return;

        const trimmed = data.username.trim();
        if (
          trimmed.length < GAME_CONFIG.USERNAME_MIN_LENGTH ||
          trimmed.length > GAME_CONFIG.USERNAME_MAX_LENGTH ||
          !GAME_CONFIG.USERNAME_PATTERN.test(trimmed)
        ) {
          ws.send(JSON.stringify({
            type: "error",
            message: `Username must be ${GAME_CONFIG.USERNAME_MIN_LENGTH}-${GAME_CONFIG.USERNAME_MAX_LENGTH} characters (letters, numbers, underscores only).`,
          }));
          return;
        }

        // Check for duplicate username (already online)
        const usernameTaken = Array.from(allPlayers.values()).some(
          (p) => p.username.toLowerCase() === trimmed.toLowerCase()
        );
        if (usernameTaken) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Este nome já está em uso. Escolha outro.",
          }));
          return;
        }

        player = {
          id: uuid(),
          username: trimmed,
          ws,
          team: 0,
          x: 0,
          y: 0,
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
        };

        allPlayers.set(player.id, {
          id: player.id,
          username: player.username,
          status: "online",
          ws: player.ws,
        });
        debouncedBroadcastOnlineList();

        console.log(`👤 ${trimmed} logged in`);

        // Send login success + room list
        ws.send(JSON.stringify({
          type: "loginSuccess",
          playerId: player.id,
          username: trimmed,
        }));

        const roomList = Array.from(rooms.values()).map((r) => ({
          id: r.id,
          name: r.name,
          playerCount: r.players.length,
          maxPlayers: GAME_CONFIG.ROOM_MAX_PLAYERS,
        }));
        ws.send(JSON.stringify({ type: "roomList", rooms: roomList }));

        // Send match history for this player
        const history = getMatchHistory(trimmed, 10);
        if (history.length > 0) {
          ws.send(JSON.stringify({ type: "matchHistory", history }));
        }

        return;
      }

      if (!player) return;

      /* ================= ROOM ACTIONS ================= */

      if (data.type === "createRoom") {
        createRoom(player);
        return;
      }

      if (data.type === "joinRoom") {
        if (!data.roomId) return;
        joinRoom(player, data.roomId);
        return;
      }

      if (data.type === "leaveRoom") {
        leaveRoom(player);
        // Send room list back to player
        const roomList = Array.from(rooms.values()).map((r) => ({
          id: r.id,
          name: r.name,
          playerCount: r.players.length,
          maxPlayers: GAME_CONFIG.ROOM_MAX_PLAYERS,
        }));
        ws.send(JSON.stringify({ type: "roomList", rooms: roomList }));
        return;
      }

      if (data.type === "roomReady") {
        markRoomReady(player);
        return;
      }

      if (data.type === "selectSkin") {
        const skinIndex = Number(data.skin);
        if (Number.isInteger(skinIndex) && skinIndex >= 0 && skinIndex <= 7) {
          // Check if skin is already taken in the room
          const room = findRoomByPlayer(player.id);
          if (room) {
            const skinTaken = room.players.some(
              (p) => p.id !== player!.id && p.skin === skinIndex
            );
            if (skinTaken) {
              ws.send(JSON.stringify({
                type: "skinTaken",
                message: "Essa skin já foi escolhida por outro jogador.",
              }));
              return;
            }
          }
          player.skin = skinIndex;
          // Broadcast room update so others see the skin change
          if (room) {
            const roomData = {
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
            const msg = JSON.stringify({ type: "roomUpdate", room: roomData });
            room.players.forEach((rp) => {
              try {
                if (rp.ws.readyState === WebSocket.OPEN) rp.ws.send(msg);
              } catch { /* ignore */ }
            });
          }
        }
        return;
      }

      if (data.type === "getLeaderboard") {
        const stats = getLeaderboard(10);
        ws.send(JSON.stringify({ type: "leaderboard", stats }));
        return;
      }

      if (data.type === "getMyStats") {
        const stats = getPlayerStats(player.username);
        ws.send(JSON.stringify({ type: "myStats", stats }));
        return;
      }

      if (data.type === "getMatchHistory") {
        const history = getMatchHistory(player.username, 10);
        ws.send(JSON.stringify({ type: "matchHistory", history }));
        return;
      }

      /* ================= IN-GAME ACTIONS ================= */

      const game = findGameByPlayer(player.id);

      // Chat works in-game
      if (data.type === "chat") {
        if (!game) return;
        const msg = String(data.message || "").trim().slice(0, 100);
        if (!msg) return;
        broadcast(game, {
          type: "chatMessage",
          username: player.username,
          message: msg,
        });
        return;
      }

      if (!game) return;

      if (data.type === "reload") {
        reloadWeapon(player);
        return;
      }

      const key = data.key as "w" | "a" | "s" | "d";
      const type = data.type as
        | "keydown"
        | "keyup"
        | "shoot"
        | "ready"
        | "aim"
        | "switchWeapon";

      if (
        type === "keydown" &&
        (key === "w" || key === "a" || key === "s" || key === "d")
      ) {
        player.keys[key] = true;
        player.lastProcessedInput = data.sequence || 0;
      }

      if (
        type === "keyup" &&
        (key === "w" || key === "a" || key === "s" || key === "d")
      ) {
        player.keys[key] = false;
        player.lastProcessedInput = data.sequence || 0;
      }

      if (type === "shoot") {
        shoot(player, game, data.dirX || 0, data.dirY || -1);
      }

      if (type === "aim") {
        player.aimAngle = data.aimAngle || 0;
      }

      if (type === "switchWeapon") {
        // Can't switch weapons while minigun powerup is active
        if (player.weapon === "minigun") return;
        if (data.weapon && WEAPON_CYCLE.includes(data.weapon)) {
          player.weapon = data.weapon;
        } else {
          const currentIndex = WEAPON_CYCLE.indexOf(player.weapon);
          player.weapon = WEAPON_CYCLE[(currentIndex + 1) % WEAPON_CYCLE.length];
        }
      }

      if (type === "ready") {
        player.ready = true;

        const readyCount = game.players.filter((p) => p.ready).length;
        const totalCount = game.players.length;

        broadcast(game, {
          type: "readyUpdate",
          readyCount,
          totalCount,
        });

        checkAllReady(game);
      }
    });

    ws.on("close", () => {
      if (!player) return;

      console.log(`👋 ${player.username} disconnected`);

      // Remove from room if in one
      removePlayerFromRooms(player.id);

      // Remove from allPlayers
      allPlayers.delete(player.id);
      debouncedBroadcastOnlineList();

      // Remove from game if in one
      const game = findGameByPlayer(player.id);
      if (game) {
        // Notify remaining players about the disconnect
        broadcast(game, {
          type: "playerDisconnected",
          username: player.username,
          playerId: player.id,
        });

        game.players = game.players.filter((p) => p.id !== player!.id);

        if (game.started) {
          // If only 1 or 0 players remain, end the game
          if (game.players.length <= 1) {
            if (game.players.length === 1) {
              const lastPlayer = game.players[0];
              // Award win to the last remaining player
              broadcast(game, {
                type: "end",
                winnerName: lastPlayer.username,
                scoreboard: game.players.map((p) => ({
                  username: p.username,
                  kills: p.kills,
                  deaths: p.deaths,
                  isWinner: p.id === lastPlayer.id,
                })),
              });

              const tracked = allPlayers.get(lastPlayer.id);
              if (tracked) tracked.status = "online";
              debouncedBroadcastOnlineList();

              // Send room list to remaining player
              const roomList = Array.from(rooms.values()).map((r) => ({
                id: r.id,
                name: r.name,
                playerCount: r.players.length,
                maxPlayers: GAME_CONFIG.ROOM_MAX_PLAYERS,
              }));
              try {
                if (lastPlayer.ws.readyState === WebSocket.OPEN) {
                  lastPlayer.ws.send(JSON.stringify({ type: "roomList", rooms: roomList }));
                }
              } catch { /* ignore */ }
            }

            if (game.obstacleSpawnInterval) clearInterval(game.obstacleSpawnInterval);
            if (game.pickupSpawnInterval) clearInterval(game.pickupSpawnInterval);
            games.delete(game.id);
          } else {
            checkVictory(game);
          }
        } else {
          // Pre-game: if not enough players, clean up
          if (game.players.length === 0) {
            if (game.obstacleSpawnInterval) clearInterval(game.obstacleSpawnInterval);
            if (game.pickupSpawnInterval) clearInterval(game.pickupSpawnInterval);
            games.delete(game.id);
          }
        }
      }
    });
  });
}
