import { randomUUID as uuid } from "crypto";
import type { Player } from "./types.js";
import { GAME_CONFIG, WEAPON_CYCLE } from "./config.js";
import { allPlayers, persistentGame } from "./state.js";
import { wss } from "./server.js";
import {
  broadcast,
  debouncedBroadcastOnlineList,
  serializePlayers,
} from "./utils.js";
import { shoot, reloadWeapon, performDash, addPlayerToGame, removePlayerFromGame, requestRespawn } from "./game.js";
import { WebSocket } from "ws";
import { serialize, deserialize } from "./protocol.js";

export function setupSocket() {
  const HEARTBEAT_INTERVAL = 15_000;

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const ext = ws as WebSocket & { isAlive?: boolean };
      if (ext.isAlive === false) {
        ext.terminate();
        return;
      }
      ext.isAlive = false;
      ext.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws) => {
    let player: Player | null = null;

    const ext = ws as WebSocket & { isAlive?: boolean };
    ext.isAlive = true;
    ws.on("pong", () => { ext.isAlive = true; });

    if (wss.clients.size > 200) {
      ws.close(1013, "Server is full");
      return;
    }

    // Send online player count
    ws.send(serialize({ type: "onlineCount", count: allPlayers.size }));

    ws.on("message", (msg) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = deserialize(msg as Buffer);
      } catch {
        return;
      }
      if (!data || typeof data.type !== "string") return;

      /* ================= ANTI-CHEAT: RATE LIMITING ================= */
      if (player) {
        const now = Date.now();
        if (now - player.msgWindowStart > 1000) {
          player.msgCount = 0;
          player.msgWindowStart = now;
        }
        player.msgCount++;
        if (player.msgCount > 300) {
          player.violations++;
          if (player.violations >= 10) {
            console.log(`🚫 Kicked ${player.username} for message flooding`);
            ws.close(4001, "Rate limit exceeded");
            return;
          }
          return;
        }
      }

      /* ================= JOIN (enter game immediately) ================= */

      if (data.type === "join") {
        if (player !== null) return;

        if (!data.username || typeof data.username !== "string") return;
        const username = data.username.trim();

        if (
          username.length < GAME_CONFIG.USERNAME_MIN_LENGTH ||
          username.length > GAME_CONFIG.USERNAME_MAX_LENGTH ||
          !GAME_CONFIG.USERNAME_PATTERN.test(username)
        ) {
          ws.send(serialize({
            type: "error",
            message: `Username must be ${GAME_CONFIG.USERNAME_MIN_LENGTH}-${GAME_CONFIG.USERNAME_MAX_LENGTH} characters (letters, numbers, _).`,
          }));
          return;
        }

        const usernameTaken = Array.from(allPlayers.values()).some(
          (p) => p.username.toLowerCase() === username.toLowerCase()
        );
        if (usernameTaken) {
          ws.send(serialize({ type: "error", message: "Name already in use." }));
          return;
        }

        if (!persistentGame) {
          ws.send(serialize({ type: "error", message: "Server starting up..." }));
          return;
        }

        player = {
          id: uuid(),
          shortId: persistentGame.nextShortId++,
          username,
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
          score: 0,
          ready: true,
          aimAngle: 0,
          weapon: "machinegun",
          skin: Number(data.skin) || 0,
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
          waitingForRespawn: false,
          msgCount: 0,
          msgWindowStart: Date.now(),
          violations: 0,
          lastWeaponSwitch: 0,
        };

        allPlayers.set(player.id, {
          id: player.id,
          username: player.username,
          status: "in-game",
          ws: player.ws,
        });
        debouncedBroadcastOnlineList();

        addPlayerToGame(player, persistentGame);

        // Send full game state to joining player
        // Include shortId map so the frontend can decode binary state messages
        const shortIdMap: Record<number, { id: string; username: string }> = {};
        for (const p of persistentGame.players) {
          shortIdMap[p.shortId] = { id: p.id, username: p.username };
        }
        const elapsed = Date.now() - persistentGame.matchStartTime;
        const timerRemaining = Math.max(0, Math.ceil((GAME_CONFIG.ROUND_DURATION - elapsed) / 1000));
        ws.send(serialize({
          type: "gameJoined",
          playerId: player.id,
          shortId: player.shortId,
          username,
          players: serializePlayers(persistentGame),
          obstacles: persistentGame.obstacles,
          orbs: persistentGame.orbs.map((o) => [o.id, o.x, o.y]),
          arenaWidth: GAME_CONFIG.ARENA_WIDTH,
          arenaHeight: GAME_CONFIG.ARENA_HEIGHT,
          maxHp: GAME_CONFIG.PLAYER_HP,
          shortIdMap,
          timerRemaining,
        }));

        // Notify others
        broadcast(persistentGame, {
          type: "playerJoined",
          username: player.username,
          playerId: player.id,
          shortId: player.shortId,
        });

        // Broadcast updated count
        const countMsg = serialize({ type: "onlineCount", count: allPlayers.size });
        wss.clients.forEach((c) => {
          try { if (c.readyState === WebSocket.OPEN) c.send(countMsg); } catch { /* ignore */ }
        });

        return;
      }

      if (!player) return;

      /* ================= IN-GAME ACTIONS ================= */

      const game = persistentGame;
      if (!game) return;
      if (!game.players.some((p) => p.id === player!.id)) return;

      if (data.type === "chat") {
        const chatMsg = String(data.message || "").trim().slice(0, 100);
        if (!chatMsg) return;
        broadcast(game, { type: "chatMessage", username: player.username, message: chatMsg });
        return;
      }

      if (data.type === "reload") { reloadWeapon(player); return; }
      if (data.type === "dash") { performDash(player); return; }
      if (data.type === "requestRespawn") {
        if (game) requestRespawn(player, game);
        return;
      }

      if (data.type === "selectSkin") {
        const skinIndex = Number(data.skin);
        if (Number.isInteger(skinIndex) && skinIndex >= 0 && skinIndex <= 7) {
          player.skin = skinIndex;
        }
        return;
      }

      const key = data.key as "w" | "a" | "s" | "d";
      const type = data.type as "keydown" | "keyup" | "shoot" | "aim" | "switchWeapon";

      if (type === "keydown" && (key === "w" || key === "a" || key === "s" || key === "d")) {
        player.keys[key] = true;
        player.lastProcessedInput = data.sequence || 0;
      }
      if (type === "keyup" && (key === "w" || key === "a" || key === "s" || key === "d")) {
        player.keys[key] = false;
        player.lastProcessedInput = data.sequence || 0;
      }

      if (type === "shoot") {
        let dirX = Number(data.dirX) || 0;
        let dirY = Number(data.dirY) || -1;
        const mag = Math.sqrt(dirX * dirX + dirY * dirY);
        if (mag > 0.001) { dirX /= mag; dirY /= mag; }
        else { dirX = 0; dirY = -1; }
        shoot(player, game, dirX, dirY);
      }

      if (type === "aim") {
        const angle = Number(data.aimAngle);
        if (Number.isFinite(angle)) player.aimAngle = angle;
      }

      if (type === "switchWeapon") {
        if (player.weapon === "minigun") return;
        const now = Date.now();
        if (now - player.lastWeaponSwitch < 250) return;
        player.lastWeaponSwitch = now;
        if (data.weapon && WEAPON_CYCLE.includes(data.weapon)) {
          player.weapon = data.weapon;
        } else {
          const currentIndex = WEAPON_CYCLE.indexOf(player.weapon);
          player.weapon = WEAPON_CYCLE[(currentIndex + 1) % WEAPON_CYCLE.length];
        }
        const maxAmmo =
          player.weapon === "shotgun" ? GAME_CONFIG.SHOTGUN_AMMO :
          player.weapon === "sniper" ? GAME_CONFIG.SNIPER_AMMO :
          GAME_CONFIG.SHOTS_PER_MAGAZINE;
        if (player.shots > maxAmmo) player.shots = maxAmmo;
      }
    });

    ws.on("error", (err) => {
      console.error(`⚠️ WebSocket error for ${player?.username || "unknown"}:`, err.message);
    });

    ws.on("close", () => {
      if (!player) return;
      console.log(`👋 ${player.username} disconnected`);

      allPlayers.delete(player.id);
      debouncedBroadcastOnlineList();

      if (persistentGame) {
        removePlayerFromGame(player.id, persistentGame);
        broadcast(persistentGame, {
          type: "playerDisconnected",
          username: player.username,
          playerId: player.id,
        });
      }

      const countMsg = serialize({ type: "onlineCount", count: allPlayers.size });
      wss.clients.forEach((c) => {
        try { if (c.readyState === WebSocket.OPEN) c.send(countMsg); } catch { /* ignore */ }
      });
    });
  });
}
