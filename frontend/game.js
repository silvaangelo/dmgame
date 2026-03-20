// ===== MSGPACK PROTOCOL WRAPPERS =====
function serialize(data) {
  return MessagePack.encode(data);
}
function deserialize(raw) {
  return MessagePack.decode(new Uint8Array(raw));
}

// ===== BINARY STATE PROTOCOL PARSER =====
// Maps shortId → { id, username } for all known players/entities
var shortIdMap = {};
var myShortId = 0;

var BINARY_MARKER = 0x42;
var BINARY_WEAPON_MAP = { 0: "machinegun", 1: "shotgun", 2: "knife", 3: "minigun", 4: "sniper" };
var BINARY_PICKUP_MAP = { 0: "health", 1: "ammo", 2: "speed", 3: "minigun", 4: "shield", 5: "invisibility", 6: "regen", 7: "armor" };

function isBinaryState(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 8) return false;
  return new Uint8Array(buf)[0] === BINARY_MARKER;
}

function parseBinaryState(buf) {
  var dv = new DataView(buf);
  var off = 0;

  // Header
  off += 1; // skip marker
  var flags = dv.getUint8(off); off += 1;
  var hasZone = (flags & 2) !== 0;
  var seq = dv.getUint32(off, true); off += 4;
  var playerCount = dv.getUint16(off, true); off += 2;

  // Players
  var parsedPlayers = [];
  for (var i = 0; i < playerCount; i++) {
    var sid = dv.getUint16(off, true); off += 2;
    var px = dv.getFloat32(off, true); off += 4;
    var py = dv.getFloat32(off, true); off += 4;
    var hp = dv.getInt8(off); off += 1;
    var shots = dv.getUint8(off); off += 1;
    var reloading = dv.getUint8(off) === 1; off += 1;
    var lastInput = dv.getUint32(off, true); off += 4;
    var aimAngle = dv.getFloat32(off, true); off += 4;
    var weaponCode = dv.getUint8(off); off += 1;
    var kills = dv.getUint16(off, true); off += 2;
    var skin = dv.getUint8(off); off += 1;
    var powerFlags = dv.getUint8(off); off += 1;
    var armor = dv.getUint8(off); off += 1;
    var score = dv.getUint16(off, true); off += 2;

    var info = shortIdMap[sid] || { id: "unknown-" + sid, username: "Player" };
    parsedPlayers.push({
      id: info.id,
      username: info.username,
      x: px, y: py, hp: hp, shots: shots,
      reloading: reloading,
      lastProcessedInput: lastInput,
      aimAngle: aimAngle,
      weapon: BINARY_WEAPON_MAP[weaponCode] || "machinegun",
      kills: kills, skin: skin,
      speedBoosted: (powerFlags & 1) !== 0,
      shielded: (powerFlags & 2) !== 0,
      invisible: (powerFlags & 4) !== 0,
      regen: (powerFlags & 8) !== 0,
      dashing: (powerFlags & 16) !== 0,
      armor: armor, score: score,
    });
  }

  // Bullets
  var bulletCount = dv.getUint16(off, true); off += 2;
  var parsedBullets = [];
  for (var j = 0; j < bulletCount; j++) {
    var bsid = dv.getUint16(off, true); off += 2;
    var bx = dv.getInt16(off, true); off += 2;
    var by = dv.getInt16(off, true); off += 2;
    var bw = dv.getUint8(off); off += 1;
    parsedBullets.push({ id: "b" + bsid, x: bx, y: by, weapon: BINARY_WEAPON_MAP[bw] || "machinegun" });
  }

  // Pickups
  var pickupCount = dv.getUint16(off, true); off += 2;
  var parsedPickups = [];
  for (var k = 0; k < pickupCount; k++) {
    var pksid = dv.getUint16(off, true); off += 2;
    var pkx = dv.getInt16(off, true); off += 2;
    var pky = dv.getInt16(off, true); off += 2;
    var pkt = dv.getUint8(off); off += 1;
    parsedPickups.push({ id: "pk" + pksid, x: pkx, y: pky, type: BINARY_PICKUP_MAP[pkt] || "health" });
  }

  // Orbs
  var orbCount = dv.getUint16(off, true); off += 2;
  var parsedOrbs = [];
  for (var m = 0; m < orbCount; m++) {
    var osid = dv.getUint16(off, true); off += 2;
    var ox = dv.getInt16(off, true); off += 2;
    var oy = dv.getInt16(off, true); off += 2;
    parsedOrbs.push({ id: "o" + osid, x: ox, y: oy });
  }

  // Crates
  var crateCount = dv.getUint16(off, true); off += 2;
  var parsedCrates = [];
  for (var n = 0; n < crateCount; n++) {
    var csid = dv.getUint16(off, true); off += 2;
    var cx = dv.getInt16(off, true); off += 2;
    var cy = dv.getInt16(off, true); off += 2;
    var chp = dv.getUint8(off); off += 1;
    parsedCrates.push({ id: "c" + csid, x: cx, y: cy, hp: chp });
  }

  // Zone
  var zone = null;
  if (hasZone) {
    zone = {
      x: dv.getInt16(off, true), y: dv.getInt16(off + 2, true),
      w: dv.getInt16(off + 4, true), h: dv.getInt16(off + 6, true),
    };
  }

  return {
    seq: seq,
    players: parsedPlayers,
    bullets: parsedBullets,
    pickups: parsedPickups,
    orbs: parsedOrbs,
    crates: parsedCrates,
    zone: zone,
  };
}

/**
 * Handle a binary state message — same logic as the msgpack "state" handler
 * but using the binary-parsed data.
 */
function handleBinaryState(buf) {
  var s = parseBinaryState(buf);

  // Binary state is always a full snapshot (no delta)
  var parsedPlayers = s.players;
  var parsedBullets = s.bullets;

  // Pickups, orbs, crates — replace entirely (viewport-culled)
  pickups = s.pickups;
  orbs = s.orbs;
  lootCrates = s.crates;

  // Zone
  if (s.zone) {
    arenaZone = s.zone;
  }

  // Death/damage detection
  parsedPlayers.forEach(function(p) {
    var prevState = previousPlayerStates.get(p.id);
    if (prevState && prevState.hp > 0 && p.hp <= 0) {
      createDeathAnimation(p.x, p.y, p.skin || 0);
      var deathWeapon = pendingDeathWeapon.get(p.username) || "machinegun";
      pendingDeathWeapon.delete(p.username);

      if (deathWeapon === "shotgun") {
        for (var i = 0; i < 12; i++) {
          var angle = Math.random() * Math.PI * 2;
          var speed = 3 + Math.random() * 4;
          bloodParticles.push({
            particles: [{ x: p.x, y: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2, life: 1.0, size: 3 + Math.random() * 4, color: "rgb(" + (139 + Math.floor(Math.random() * 116)) + ", 0, 0)" }],
            frame: 0,
          });
        }
        createBloodStain(p.x, p.y); createBloodStain(p.x, p.y);
        createKillEffect(p.x, p.y, "fire");
      } else if (deathWeapon === "sniper") {
        createKillEffect(p.x, p.y, "lightning"); createBlood(p.x, p.y);
      } else {
        createBlood(p.x, p.y); createBloodStain(p.x, p.y); createKillEffect(p.x, p.y, "lightning");
      }

      createFloatingNumber(p.x, p.y, prevState.hp);
      if (p.id === playerId) { triggerScreenShake(12); stopHeartbeat(); }
      else { triggerScreenShake(5); }
      playPositionalSound("died", p.x, p.y, 0.3);
      if (p.id !== playerId) createHitMarker();
    } else if (prevState && prevState.hp > p.hp && p.hp > 0) {
      createBlood(p.x, p.y);
      createBloodStain(p.x, p.y);
      createFloatingNumber(p.x, p.y, prevState.hp - p.hp);
      if (p.id !== playerId) createHitMarker();
      if (p.id === playerId) {
        createDamageIndicator(p.x, p.y);
        triggerScreenShake(6);
        if (p.hp === 1) startHeartbeat();
      }
    } else if (prevState && p.hp > prevState.hp && p.id === playerId) {
      if (p.hp > 1) stopHeartbeat();
    }
    previousPlayerStates.set(p.id, { hp: p.hp, x: p.x, y: p.y });

    if (p.id !== playerId) {
      var current = playerTargets.get(p.id);
      if (current) {
        playerTargets.set(p.id, { currentX: current.currentX, currentY: current.currentY, targetX: p.x, targetY: p.y });
      } else {
        playerTargets.set(p.id, { currentX: p.x, currentY: p.y, targetX: p.x, targetY: p.y });
      }
    }
  });

  // Bullet impact detection
  var newBulletPositions = new Map();
  parsedBullets.forEach(function(b) { newBulletPositions.set(b.id, { x: b.x, y: b.y }); });
  previousBulletPositions.forEach(function(prev, id) {
    if (!newBulletPositions.has(id)) {
      createImpactSparks(prev.x, prev.y);
    }
  });

  var currentBulletCount = parsedBullets.length;
  if (currentBulletCount > previousBulletCount) {
    var newBullets = parsedBullets.filter(function(b) { return !previousBulletPositions.has(b.id); });
    newBullets.forEach(function(b) {
      if (b.weapon === "shotgun") {
        playPositionalSound("shotgun-shot", b.x, b.y, 0.25);
      } else if (b.weapon === "sniper") {
        playPositionalSound("sniper-shot", b.x, b.y, 0.25);
      } else {
        var idx = Math.floor(Math.random() * 5) + 1;
        playPositionalSound("machinegun-" + idx, b.x, b.y, 0.12);
      }
    });
  }
  previousBulletCount = currentBulletCount;
  previousBulletPositions = newBulletPositions;

  players = parsedPlayers;
  bullets = parsedBullets.concat(bullets.filter(function(b) { return b.predicted; }));
  bullets = bullets.filter(function(b) {
    if (!b.predicted) return true;
    return !parsedBullets.some(function(sb) {
      var dx = sb.x - b.x, dy = sb.y - b.y;
      return dx * dx + dy * dy < 2500;
    });
  });

  // Client-side prediction reconciliation
  var currentPlayer = players.find(function(p) { return p.id === playerId; });
  if (currentPlayer) {
    if (currentPlayer.hp < previousHP) {
      playPositionalSound("scream", predictedX, predictedY, 0.25);
    }
    previousHP = currentPlayer.hp;

    if (currentPlayer.dashing) dashCooldownUntil = Date.now() + 1000;

    var lastProcessed = currentPlayer.lastProcessedInput || 0;
    pendingInputs = pendingInputs.filter(function(inp) { return inp.sequence > lastProcessed; });

    var reconciledX = currentPlayer.x;
    var reconciledY = currentPlayer.y;
    pendingInputs.forEach(function(input) {
      var result = applyInput(reconciledX, reconciledY, input.keys, currentPlayer.weapon, currentPlayer.speedBoosted);
      reconciledX = result.x;
      reconciledY = result.y;
    });
    // Smooth correction: snap large errors (real collisions/respawns), blend small drift (network jitter)
    var errX = reconciledX - predictedX;
    var errY = reconciledY - predictedY;
    var errDist = Math.sqrt(errX * errX + errY * errY);
    if (errDist > 80) {
      predictedX = reconciledX;
      predictedY = reconciledY;
    } else if (errDist > 0.5) {
      predictedX += errX * 0.25;
      predictedY += errY * 0.25;
    }

    var now = Date.now();
    pendingInputs = pendingInputs.filter(function(inp) { return now - inp.timestamp < 1000; });
  }

  // Throttle leaderboard DOM rebuild to ~5 Hz (was 35 Hz — causing layout thrash every tick)
  if (Date.now() - lastLeaderboardUpdate > 200) {
    lastLeaderboardUpdate = Date.now();
    updateLeaderboardOverlay();
  }
}

// ===== HTML ESCAPING (XSS prevention) =====
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Game configuration constants
const GAME_CONFIG = {
  ARENA_WIDTH: 4000,
  ARENA_HEIGHT: 4000,
  PLAYER_RADIUS: 20,
  PLAYER_SPEED: 7,
  SHOTS_PER_MAGAZINE: 25,
  MAX_BLOOD_STAINS: 150,
  MAX_PARTICLES: 100,
  MAX_EXPLOSIONS: 8,
  MAX_BLOOD_EFFECTS: 10,
  MAX_IMPACT_SPARKS: 12,
  MUZZLE_FLASH_DURATION: 100,
  EXPLOSION_PARTICLE_COUNT: 12,
  BLOOD_PARTICLE_COUNT: 8,
  KILLS_TO_WIN: 999,
  KNIFE_SPEED_BONUS: 1.6,
  PICKUP_SPEED_MULTIPLIER: 1.5,
  VIEWPORT_WIDTH: window.innerWidth,
  VIEWPORT_HEIGHT: window.innerHeight,
};

// Camera state
let cameraX = 0;
let cameraY = 0;
const CAMERA_SCALE = 0.65; // Zoom out to see more of the arena

// ===== OBJECT POOLING & IN-PLACE COMPACTION =====
// Avoid GC pressure from creating new arrays every frame with .filter()

/** Compact array in-place, keeping only elements that pass the predicate. */
function compactInPlace(arr, predicate) {
  let write = 0;
  for (let read = 0; read < arr.length; read++) {
    if (predicate(arr[read])) {
      if (write !== read) arr[write] = arr[read];
      write++;
    }
  }
  arr.length = write;
}

/** Cap array length in-place (remove oldest entries from the front). */
function capInPlace(arr, max) {
  if (arr.length > max) {
    const excess = arr.length - max;
    arr.copyWithin(0, excess);
    arr.length = max;
  }
}

/** Simple object pool — acquire reuses recycled objects, release returns them. */
function createPool(factory) {
  const free = [];
  return {
    acquire() { return free.length > 0 ? free.pop() : factory(); },
    release(obj) { free.push(obj); },
    releaseAll(arr) { for (let i = 0; i < arr.length; i++) free.push(arr[i]); },
    size() { return free.length; },
  };
}

// Particle pools for the most-allocated types
const particlePool = createPool(() => ({
  x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0, color: "", rotation: 0, rotSpeed: 0, effectType: "", opacity: 0,
}));

function acquireParticle(x, y, vx, vy, life, size, color) {
  const p = particlePool.acquire();
  p.x = x; p.y = y; p.vx = vx; p.vy = vy;
  p.life = life; p.size = size; p.color = color;
  p.rotation = 0; p.rotSpeed = 0; p.effectType = ""; p.opacity = 0;
  return p;
}

// ===== OFFSCREEN CULLING HELPERS =====
// Camera-based culling: only render entities visible in viewport

const CULL_MARGIN = 30; // Extra pixels beyond viewport edge before culling

function isOnScreen(x, y) {
  return x >= cameraX - CULL_MARGIN && x <= cameraX + GAME_CONFIG.VIEWPORT_WIDTH + CULL_MARGIN &&
         y >= cameraY - CULL_MARGIN && y <= cameraY + GAME_CONFIG.VIEWPORT_HEIGHT + CULL_MARGIN;
}

// Skin definitions
const SKINS = [
  { name: "Olive", primary: "#4a7a3a", secondary: "#2a5a2a" },
  { name: "Desert", primary: "#c4a035", secondary: "#8a7025" },
  { name: "Ocean", primary: "#4a90d9", secondary: "#2a5a8a" },
  { name: "Crimson", primary: "#d94a4a", secondary: "#8a2a2a" },
  { name: "Violet", primary: "#9a4ad9", secondary: "#5a2a8a" },
  { name: "Gold", primary: "#d9a04a", secondary: "#8a6a2a" },
  { name: "Arctic", primary: "#b0c8d0", secondary: "#708898" },
  { name: "Shadow", primary: "#4a4a5a", secondary: "#2a2a3a" },
];

// Weapon definitions
const WEAPON_CYCLE = ["machinegun", "shotgun", "sniper"];
const WEAPON_NAMES = {
  machinegun: "🔫 Metralhadora",
  shotgun: "🔫 Shotgun",
  sniper: "🎯 Sniper",
};
const WEAPON_COOLDOWNS = {
  machinegun: 60,
  shotgun: 500,
  sniper: 1200,
};
const WEAPON_KILL_ICONS = {
  machinegun: "🔫",
  shotgun: "🔫",
  sniper: "🎯"
};

let ws;
let playerId;
let loggedInUsername = "";
let players = [];
let bullets = [];
let obstacles = [];
let pickups = [];
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let previousBulletCount = 0;
let wasReloading = false;
let explosions = [];
let bloodParticles = [];
let bloodStains = [];
let muzzleFlashes = [];
let knifeSlashes = [];
let shellCasings = [];
let impactSparks = [];
let dustClouds = [];
let lastDustTime = 0;
let hitMarkers = [];
let damageIndicators = [];
let previousBulletPositions = new Map();
let activeBombs = [];
let activeLightnings = [];
let flashbangOverlay = { alpha: 0, flicker: 0 }; // White screen flash for lightning

// Low HP vignette + heartbeat
let lowHPPulseTime = 0;
let heartbeatActive = false;

// Floating damage numbers
let floatingNumbers = [];

// Revenge tracking — store last killer username for local player
let lastKilledByUsername = "";
// Last kill weapon per victim (from "kill" messages) for weapon-specific death effects
let pendingDeathWeapon = new Map(); // victimUsername -> weapon

// Kill effect particles (fire, ice, lightning)
let killEffects = [];

// Death animation particles (replaces instant despawn)
let deathAnimations = [];

// Dynamic arena zone (shrinking safe zone)
let arenaZone = null; // { x, y, w, h } or null if not active
let zoneWarningShown = false;

// Zone clouds (floating outside safe zone)
let zoneClouds = [];

// Loot crates
let lootCrates = [];
let crateDestroyEffects = [];

// Dash
let dashCooldownUntil = 0;
let dashTrails = [];

// Orbs (slither-style collectible points)
let orbs = [];

// Round timer
let roundTimeRemaining = 300; // seconds

// Cached DOM elements (avoid getElementById in hot paths)
let _cachedDOM = null;
function getCachedDOM() {
  if (!_cachedDOM) {
    _cachedDOM = {
      killFeed: document.getElementById("killFeed"),
      playerListContent: document.getElementById("playerListContent"),
      timerDisplay: document.getElementById("timerDisplay"),
    };
  }
  return _cachedDOM;
}

// Pre-rendered obstacle canvas (viewport-sized with padding, ~4× less VRAM than full arena)
let obstacleCanvas = null;
let obstacleCanvasDirty = true;
const OBS_CANVAS_PAD = 400; // extra pixels around viewport before re-render
let obsCanvasCamX = -9999; // camera pos used for last obstacle render
let obsCanvasCamY = -9999;

// Kill feed dirty flag (avoid innerHTML comparison)
let killFeedDirty = true;

// Screen shake
let screenShake = { intensity: 0, decay: 0.92 };
let killFeedEntries = [];

// Cached grid canvas (used in resizeCanvas and render)
let gridCanvas = null;
let gridPatternCache = null;
const KILL_FEED_DURATION = 4000;
const KILL_FEED_MAX = 5;

// Skins
let selectedSkin = 0;
let currentGameMode = "deathmatch"; // single mode
let maxHp = 8; // updated from server on game start

// Viral phrases
const WINNER_PHRASES = [
  "{winner} AMASSOU GERAL! 💀",
  "{winner} DEU SHOW DE HORRORES! 🔥",
  "{winner} É O BRABO! 👑",
  "{winner} DESTRUIU TODO MUNDO! 💣",
  "{winner} SIMPLESMENTE IMPARÁVEL! ⚡",
  "{winner} PASSOU O RODO! 🧹",
  "{winner} É CRAQUE DEMAIS! 🎯",
  "{winner} COMEU TODO MUNDO! 😤",
];
const LOSER_PHRASES = [
  "Você foi amassado por {winner} 😭",
  "Que surra! {winner} te humilhou 💀",
  "{winner} passou por cima de você 🚜",
  "Tenta de novo... {winner} te destruiu 😈",
  "{winner} te fez de saco de pancada 🥊",
  "GG! {winner} é bom demais pra você 🫠",
  "Volta pro tutorial! {winner} te amassou 📚",
];
const KILL_PHRASES = [
  "{killer} eliminou {victim}",
  "{killer} destruiu {victim}",
  "{killer} detonou {victim}",
  "{killer} acabou com {victim}",
];
const SELF_KILL_PHRASES = [
  "Você eliminou {victim}! 🔥",
  "{victim} não teve chance! 💀",
  "Mais um pro caixão! ⚰️ {victim} caiu!",
];
const DEATH_PHRASES = [
  "{killer} te pegou! 😵",
  "Você foi eliminado por {killer}! 💀",
  "{killer} te destruiu! Volta mais forte! 💪",
];
const RESPAWN_PHRASES = [
  "💀 Respawnando...",
  "💀 Voltando pra luta...",
  "💀 Aguenta aí...",
];

// Client-side prediction variables
let inputSequence = 0;
let pendingInputs = [];
let predictedX = 0;
let predictedY = 0;
const currentKeys = { w: false, a: false, s: false, d: false };
let previousPlayerStates = new Map();
let gameReady = false;
let isMouseDown = false;
let roundEnded = false;

// Interpolation for smooth movement
const playerTargets = new Map(); // Store target positions for other players
let lastStateTime = 0;
const INTERPOLATION_SPEED = 0.45; // How fast to interpolate (0-1)
let lastShootTime = 0;
let lastLeaderboardUpdate = 0;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Responsive canvas sizing — canvas fills the entire screen
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  // Logical viewport is bigger than screen pixels because we zoom out
  GAME_CONFIG.VIEWPORT_WIDTH = Math.ceil(window.innerWidth / CAMERA_SCALE);
  GAME_CONFIG.VIEWPORT_HEIGHT = Math.ceil(window.innerHeight / CAMERA_SCALE);
  gridCanvas = null; // Invalidate cached grid
  gridPatternCache = null;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ===== MOUSE INPUT — aiming and shooting =====
let lastAimSendTime = 0;
canvas.addEventListener("mousemove", function(e) {
  // Convert screen coords to world coords via camera scale + offset
  mouseX = e.clientX / CAMERA_SCALE + cameraX;
  mouseY = e.clientY / CAMERA_SCALE + cameraY;
  if (ws && gameReady) {
    const now = performance.now();
    if (now - lastAimSendTime >= 33) { // Throttle aim to ~30 msg/sec
      lastAimSendTime = now;
      const dx = mouseX - predictedX;
      const dy = mouseY - predictedY;
      const aimAngle = Math.atan2(dy, dx);
      ws.send(serialize({ type: "aim", aimAngle: aimAngle }));
    }
  }
});

canvas.addEventListener("mousedown", function(e) {
  if (e.button === 0) {
    if (!gameReady || roundEnded) return;
    var lp = players.find(function(p) { return p.id === playerId; });
    if (!lp || lp.hp <= 0) return;
    isMouseDown = true;
  }
});

canvas.addEventListener("mouseup", function(e) {
  if (e.button === 0) {
    isMouseDown = false;
  }
});

// Catch mouse releases outside the canvas (prevents stuck shooting on drag-out)
window.addEventListener("mouseup", function(e) {
  if (e.button === 0) isMouseDown = false;
});

// Prevent context menu on right-click
canvas.addEventListener("contextmenu", function(e) { e.preventDefault(); });

// Auto-detect host — works for localhost, ngrok, or any domain
const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${wsProtocol}//${location.host}/socket`;
const assetBase = location.origin;

// ===== PARTICLE SYSTEMS =====

// Explosion system
function createExplosion(x, y) {
  const particles = [];
  const particleCount = GAME_CONFIG.EXPLOSION_PARTICLE_COUNT;

  for (let i = 0; i < particleCount; i++) {
    const angle = (Math.PI * 2 * i) / particleCount;
    const speed = 2 + Math.random() * 3;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      size: 3 + Math.random() * 3,
      color: `hsl(${Math.random() * 60 + 10}, 100%, 50%)`,
    });
  }

  explosions.push({
    particles: particles,
    frame: 0,
  });
}

// Blood particle system
function createBlood(x, y) {
  const particles = [];
  const particleCount = GAME_CONFIG.BLOOD_PARTICLE_COUNT;

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 2;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1, // Slight upward bias
      life: 1.0,
      size: 2 + Math.random() * 2,
      color: `rgb(${139 + Math.random() * 116}, 0, 0)`, // Dark to bright red
    });
  }

  bloodParticles.push({
    particles: particles,
    frame: 0,
  });
}

// Blood stain system (permanent marks on ground)
function createBloodStain(x, y) {
  const stainCount = 5 + Math.floor(Math.random() * 5); // 5-9 stains

  for (let i = 0; i < stainCount; i++) {
    const offsetX = (Math.random() - 0.5) * 30;
    const offsetY = (Math.random() - 0.5) * 30;
    const size = 3 + Math.random() * 6;
    const opacity = 0.3 + Math.random() * 0.4;
    const color = Math.floor(Math.random() * 3); // Vary red shades

    bloodStains.push({
      x: x + offsetX,
      y: y + offsetY,
      size: size,
      opacity: opacity,
      color: color,
    });
  }

  // Limit total blood stains to prevent memory issues
  if (bloodStains.length > GAME_CONFIG.MAX_BLOOD_STAINS) {
    capInPlace(bloodStains, GAME_CONFIG.MAX_BLOOD_STAINS);
  }
}

// Kill effect particle system (fire, ice, lightning)
function createKillEffect(x, y, effectType) {
  const particles = [];
  const count = 16;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3;
    let color, size;

    if (effectType === "fire") {
      color = `hsl(${Math.random() * 40 + 10}, 100%, ${40 + Math.random() * 40}%)`;
      size = 3 + Math.random() * 5;
    } else if (effectType === "ice") {
      color = `hsl(${190 + Math.random() * 30}, 80%, ${60 + Math.random() * 30}%)`;
      size = 2 + Math.random() * 4;
    } else {
      // lightning
      color = `hsl(${50 + Math.random() * 20}, 100%, ${70 + Math.random() * 30}%)`;
      size = 2 + Math.random() * 3;
    }

    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (effectType === "fire" ? 2 : 0),
      life: 1.0,
      size,
      color,
      effectType,
    });
  }

  killEffects.push({ particles, frame: 0, effectType });
  capInPlace(killEffects, 15);
}

function updateKillEffects() {
  for (let i = 0; i < killEffects.length; i++) {
    const effect = killEffects[i];
    effect.frame++;
    for (let j = 0; j < effect.particles.length; j++) {
      const p = effect.particles[j];
      p.x += p.vx;
      p.y += p.vy;
      if (effect.effectType === "fire") {
        p.vy -= 0.05; // Fire rises
        p.vx *= 0.97;
      } else if (effect.effectType === "ice") {
        p.vy += 0.1; // Ice falls
        p.vx *= 0.96;
      } else {
        // Lightning jitters
        p.vx += (Math.random() - 0.5) * 0.5;
        p.vy += (Math.random() - 0.5) * 0.5;
        p.vx *= 0.94;
        p.vy *= 0.94;
      }
      p.life -= 0.02;
    }
  }
  compactInPlace(killEffects, (e) => e.particles.some((p) => p.life > 0));
}

function renderKillEffects() {
  for (let i = 0; i < killEffects.length; i++) {
    const effect = killEffects[i];
    for (let j = 0; j < effect.particles.length; j++) {
      const p = effect.particles[j];
      if (p.life <= 0 || !isOnScreen(p.x, p.y)) continue;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();

      // Glow effect
      if (effect.effectType === "lightning") {
        ctx.globalAlpha = Math.max(0, p.life * 0.3);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1.0;
}

// Death animation system (ragdoll explosion particles — dramatic burst)
function createDeathAnimation(x, y, skinIndex) {
  const skin = SKINS[skinIndex] || SKINS[0];
  const particles = [];

  // --- Body chunks (skin-colored, larger, tumbling) ---
  const bodyCount = 6;
  for (let i = 0; i < bodyCount; i++) {
    const angle = (Math.PI * 2 * i) / bodyCount + (Math.random() - 0.5) * 0.5;
    const speed = 3 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2.5,
      life: 1.0,
      size: 5 + Math.random() * 5,
      color: i % 2 === 0 ? skin.primary : skin.secondary,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.5,
    });
  }

  // --- Bone/white fragments (small, fast) ---
  const boneCount = 4;
  for (let i = 0; i < boneCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 1.0,
      size: 2 + Math.random() * 2,
      color: "#e8dcc8",
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.8,
    });
  }

  // --- Blood splatter burst (red particles, many, slower) ---
  const bloodCount = 10;
  for (let i = 0; i < bloodCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.5;
    const shade = 100 + Math.floor(Math.random() * 120);
    particles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      life: 1.0,
      size: 2 + Math.random() * 3,
      color: `rgb(${shade}, 0, 0)`,
      rotation: 0,
      rotSpeed: 0,
    });
  }

  // --- Central flash particle (bright, fades fast) ---
  particles.push({
    x, y,
    vx: 0, vy: 0,
    life: 1.0,
    size: 16,
    color: "#ffffff",
    rotation: 0,
    rotSpeed: 0,
  });

  deathAnimations.push({ particles, frame: 0 });
  capInPlace(deathAnimations, 10);
}

function updateDeathAnimations() {
  for (let i = 0; i < deathAnimations.length; i++) {
    const anim = deathAnimations[i];
    anim.frame++;
    for (let j = 0; j < anim.particles.length; j++) {
      const p = anim.particles[j];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // Gravity
      p.vx *= 0.97;
      p.rotation += p.rotSpeed;
      p.life -= 0.012;
    }
  }
  compactInPlace(deathAnimations, (a) => a.particles.some((p) => p.life > 0));
}

function renderDeathAnimations() {
  for (let i = 0; i < deathAnimations.length; i++) {
    const anim = deathAnimations[i];
    for (let j = 0; j < anim.particles.length; j++) {
      const p = anim.particles[j];
      if (p.life <= 0 || !isOnScreen(p.x, p.y)) continue;
      ctx.globalAlpha = Math.max(0, p.life);

      // Flash particle — large fading circle
      if (p.color === "#ffffff" && p.size >= 14) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      // Blood particles — circles
      if (p.rotSpeed === 0 && p.rotation === 0) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * Math.max(0.3, p.life), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      // Body chunks and bone fragments — tumbling rectangles
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      const sz = p.size * Math.max(0.2, p.life);
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz * 0.6);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1.0;
}

function updateExplosions() {
  for (let i = 0; i < explosions.length; i++) {
    const explosion = explosions[i];
    explosion.frame++;
    for (let j = 0; j < explosion.particles.length; j++) {
      const p = explosion.particles[j];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // Gravity
      p.vx *= 0.98; // Air resistance
      p.life -= 0.02;
    }
  }

  // Remove dead explosions (in-place)
  compactInPlace(explosions, (e) => e.particles.some((p) => p.life > 0));
  capInPlace(explosions, GAME_CONFIG.MAX_EXPLOSIONS);

  // Update blood particles
  for (let i = 0; i < bloodParticles.length; i++) {
    const blood = bloodParticles[i];
    blood.frame++;
    for (let j = 0; j < blood.particles.length; j++) {
      const p = blood.particles[j];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2; // Gravity
      p.vx *= 0.95; // Air resistance
      p.life -= 0.025;
    }
  }

  // Remove dead blood effects (in-place)
  compactInPlace(bloodParticles, (b) => b.particles.some((p) => p.life > 0));
  capInPlace(bloodParticles, GAME_CONFIG.MAX_BLOOD_EFFECTS);
}

// Muzzle flash system
function createMuzzleFlash(x, y, dirX, dirY) {
  muzzleFlashes.push({
    x: x + dirX * 15,
    y: y + dirY * 15,
    life: 1.0,
    angle: Math.atan2(dirY, dirX),
    timestamp: Date.now(),
  });
}

function updateMuzzleFlashes() {
  const now = Date.now();
  compactInPlace(muzzleFlashes, (flash) => now - flash.timestamp < GAME_CONFIG.MUZZLE_FLASH_DURATION);
}

function renderMuzzleFlashes() {
  muzzleFlashes.forEach((flash) => {
    const age = Date.now() - flash.timestamp;
    const alpha = 1 - age / 100;

    ctx.save();
    ctx.translate(flash.x, flash.y);
    ctx.rotate(flash.angle);
    ctx.globalAlpha = alpha;

    // Draw muzzle flash
    ctx.fillStyle = "#FFA500";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(12, -4);
    ctx.lineTo(10, 0);
    ctx.lineTo(12, 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#FFFF00";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(8, -2);
    ctx.lineTo(6, 0);
    ctx.lineTo(8, 2);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1.0;
    ctx.restore();
  });
}

// Knife slash effect system
function createKnifeSlash(x, y, angle) {
  knifeSlashes.push({
    x: x,
    y: y,
    angle: angle,
    timestamp: Date.now(),
    duration: 250,
  });
}

function renderKnifeSlashes() {
  const now = Date.now();
  compactInPlace(knifeSlashes, (slash) => now - slash.timestamp < slash.duration);

  knifeSlashes.forEach((slash) => {
    const progress = (now - slash.timestamp) / slash.duration;
    const alpha = (1 - progress) * 0.8;
    const sweepAngle = Math.PI * 0.7;
    const baseAngle = slash.angle - sweepAngle / 2;
    const currentSweep = sweepAngle * Math.min(progress * 2, 1);
    const radius = 22 + progress * 14;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Outer slash arc
    ctx.strokeStyle = "#dde0e0";
    ctx.lineWidth = 3 * (1 - progress) + 1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(slash.x, slash.y, radius, baseAngle, baseAngle + currentSweep);
    ctx.stroke();

    // Inner bright arc
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5 * (1 - progress);
    ctx.beginPath();
    ctx.arc(
      slash.x,
      slash.y,
      radius - 3,
      baseAngle + currentSweep * 0.1,
      baseAngle + currentSweep * 0.9,
    );
    ctx.stroke();

    // Slash tip spark
    if (progress < 0.5) {
      const tipAngle = baseAngle + currentSweep;
      const tipX = slash.x + Math.cos(tipAngle) * radius;
      const tipY = slash.y + Math.sin(tipAngle) * radius;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2 * (1 - progress * 2), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
    ctx.restore();
  });
}

// Shell casing system (top-down: eject sideways, slide with friction)
function createShellCasing(x, y, angle) {
  const ejectAngle = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.8;
  const speed = 1.5 + Math.random() * 2;
  shellCasings.push({
    x: x + Math.cos(angle) * 8,
    y: y + Math.sin(angle) * 8,
    vx: Math.cos(ejectAngle) * speed,
    vy: Math.sin(ejectAngle) * speed,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.4,
    life: 1.0,
    size: 3,
  });
  capInPlace(shellCasings, 50);
}

function updateShellCasings() {
  for (let i = 0; i < shellCasings.length; i++) {
    const s = shellCasings[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vx *= 0.92;
    s.vy *= 0.92;
    s.rotation += s.rotSpeed;
    s.rotSpeed *= 0.95;
    s.life -= 0.012;
  }
  compactInPlace(shellCasings, (s) => s.life > 0);
}

function renderShellCasings() {
  for (let i = 0; i < shellCasings.length; i++) {
    const s = shellCasings[i];
    if (!isOnScreen(s.x, s.y)) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(1, s.life * 2);
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rotation);
    ctx.fillStyle = "#c8a832";
    ctx.fillRect(-s.size, -1, s.size * 2, 2);
    ctx.fillStyle = "#b89828";
    ctx.fillRect(-s.size, -1, s.size * 0.6, 2);
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }
}

// Bullet impact spark system
function createImpactSparks(x, y) {
  const count = 6 + Math.floor(Math.random() * 6);
  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      size: 1 + Math.random() * 2,
      color: Math.random() > 0.5 ? "#ffaa22" : "#ffdd44",
    });
  }
  for (let i = 0; i < 4; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 1.5;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      size: 2 + Math.random() * 3,
      color: "#888877",
    });
  }
  impactSparks.push({ particles, frame: 0 });
}

function updateImpactSparks() {
  for (let i = 0; i < impactSparks.length; i++) {
    const impact = impactSparks[i];
    impact.frame++;
    for (let j = 0; j < impact.particles.length; j++) {
      const p = impact.particles[j];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.vx *= 0.96;
      p.life -= 0.04;
    }
  }
  compactInPlace(impactSparks, (i) => i.particles.some((p) => p.life > 0));
  capInPlace(impactSparks, GAME_CONFIG.MAX_IMPACT_SPARKS);
}

function renderImpactSparks() {
  for (let i = 0; i < impactSparks.length; i++) {
    const impact = impactSparks[i];
    for (let j = 0; j < impact.particles.length; j++) {
      const p = impact.particles[j];
      if (p.life > 0 && isOnScreen(p.x, p.y)) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1.0;
}

// Dust cloud system (top-down: expands around player feet)
function createDustCloud(x, y) {
  const count = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    dustClouds.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * 0.3,
      vy: Math.sin(angle) * 0.3,
      life: 1.0,
      size: 2 + Math.random() * 3,
      opacity: 0.2 + Math.random() * 0.15,
    });
  }
  capInPlace(dustClouds, 40);
}

function updateDustClouds() {
  for (let i = 0; i < dustClouds.length; i++) {
    const d = dustClouds[i];
    d.x += d.vx;
    d.y += d.vy;
    d.size += 0.1;
    d.life -= 0.02;
    d.vx *= 0.98;
  }
  compactInPlace(dustClouds, (d) => d.life > 0);
}

function renderDustClouds() {
  for (let i = 0; i < dustClouds.length; i++) {
    const d = dustClouds[i];
    if (!isOnScreen(d.x, d.y)) continue;
    ctx.globalAlpha = d.opacity * d.life;
    ctx.fillStyle = "#8a7a60";
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;
}

// Hit marker system — visual feedback when you hit an enemy
function createHitMarker() {
  hitMarkers.push({ life: 1.0, timestamp: Date.now() });
  if (hitMarkers.length > 5) hitMarkers.shift();
}

function updateHitMarkers() {
  for (let i = 0; i < hitMarkers.length; i++) hitMarkers[i].life -= 0.04;
  compactInPlace(hitMarkers, (h) => h.life > 0);
}

function renderHitMarkers() {
  if (hitMarkers.length === 0) return;
  const cx = GAME_CONFIG.ARENA_WIDTH / 2;
  const cy = GAME_CONFIG.ARENA_HEIGHT / 2;
  // We draw at crosshair position instead of center
  hitMarkers.forEach((h) => {
    ctx.save();
    ctx.translate(mouseX, mouseY);
    ctx.rotate(Math.PI / 4);
    const alpha = h.life;
    const size = 8 + (1 - h.life) * 4;
    ctx.strokeStyle = `rgba(255, 60, 60, ${alpha})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-size, 0); ctx.lineTo(-size * 0.4, 0);
    ctx.moveTo(size, 0); ctx.lineTo(size * 0.4, 0);
    ctx.moveTo(0, -size); ctx.lineTo(0, -size * 0.4);
    ctx.moveTo(0, size); ctx.lineTo(0, size * 0.4);
    ctx.stroke();
    ctx.restore();
  });
}

// Damage indicator system — red flash on screen edges when taking damage
function createDamageIndicator(fromX, fromY) {
  const angle = Math.atan2(fromY - predictedY, fromX - predictedX);
  damageIndicators.push({ angle, life: 1.0 });
  if (damageIndicators.length > 4) damageIndicators.shift();
}

function updateDamageIndicators() {
  for (let i = 0; i < damageIndicators.length; i++) damageIndicators[i].life -= 0.025;
  compactInPlace(damageIndicators, (d) => d.life > 0);
}

function renderDamageIndicators() {
  if (damageIndicators.length === 0) return;
  const cx = GAME_CONFIG.ARENA_WIDTH / 2;
  const cy = GAME_CONFIG.ARENA_HEIGHT / 2;
  const radius = Math.min(cx, cy) * 0.85;
  damageIndicators.forEach((d) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(d.angle);
    ctx.globalAlpha = d.life * 0.6;
    ctx.fillStyle = "#ff2222";
    ctx.beginPath();
    ctx.moveTo(radius, -12);
    ctx.lineTo(radius + 30, 0);
    ctx.lineTo(radius, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  ctx.globalAlpha = 1.0;
}

// Floating damage numbers system
function createFloatingNumber(x, y, amount) {
  floatingNumbers.push({
    x: x + (Math.random() - 0.5) * 10,
    y: y - 10,
    vy: -1.5,
    life: 1.0,
    text: "-" + amount,
  });
  if (floatingNumbers.length > 20) floatingNumbers.shift();
}

function updateFloatingNumbers() {
  for (let i = 0; i < floatingNumbers.length; i++) {
    const f = floatingNumbers[i];
    f.y += f.vy;
    f.vy -= 0.02; // Slow upward acceleration
    f.life -= 0.02;
  }
  compactInPlace(floatingNumbers, (f) => f.life > 0);
}

function renderFloatingNumbers() {
  if (floatingNumbers.length === 0) return;
  for (let i = 0; i < floatingNumbers.length; i++) {
    const f = floatingNumbers[i];
    if (!isOnScreen(f.x, f.y)) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, f.life);
    const scale = 1 + (1 - f.life) * 0.3; // Slight grow as it fades
    ctx.font = `bold ${Math.round(18 * scale)}px 'Rajdhani', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Red text with dark outline
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = "#ff3333";
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
  ctx.globalAlpha = 1.0;
}

// Low HP vignette rendering
let lowHPVignetteGradient = null;
let lowHPVignetteW = 0;
let lowHPVignetteH = 0;

// Arena zone rendering (shrinking safe zone)
function ensureZoneClouds() {
  if (!arenaZone || zoneClouds.length > 0) return;
  // Spawn clouds in the danger zone around the edges
  const count = 30;
  for (let i = 0; i < count; i++) {
    zoneClouds.push({
      x: Math.random() * GAME_CONFIG.ARENA_WIDTH,
      y: Math.random() * GAME_CONFIG.ARENA_HEIGHT,
      size: 40 + Math.random() * 80,
      opacity: 0.15 + Math.random() * 0.25,
      speed: 0.2 + Math.random() * 0.4,
      angle: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 0.005,
    });
  }
}

function updateZoneClouds() {
  if (!arenaZone) return;
  zoneClouds.forEach((c) => {
    c.x += Math.cos(c.angle) * c.speed;
    c.y += Math.sin(c.angle) * c.speed;
    c.angle += c.drift;
    // Wrap around arena edges
    if (c.x < -c.size) c.x = GAME_CONFIG.ARENA_WIDTH + c.size;
    if (c.x > GAME_CONFIG.ARENA_WIDTH + c.size) c.x = -c.size;
    if (c.y < -c.size) c.y = GAME_CONFIG.ARENA_HEIGHT + c.size;
    if (c.y > GAME_CONFIG.ARENA_HEIGHT + c.size) c.y = -c.size;
  });
}

// Cached cloud sprite for zone rendering (avoids createRadialGradient per cloud per frame)
let _cloudSprite = null;
let _cloudSpriteSize = 0;

function getCloudSprite(size) {
  // Re-use if size is close enough (within 20%)
  if (_cloudSprite && Math.abs(_cloudSpriteSize - size) < size * 0.2) return _cloudSprite;
  const s = Math.ceil(size * 2);
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const gc = c.getContext("2d");
  const r = s / 2;
  const g = gc.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(200, 60, 60, 0.6)");
  g.addColorStop(0.5, "rgba(150, 40, 40, 0.3)");
  g.addColorStop(1, "rgba(100, 20, 20, 0)");
  gc.fillStyle = g;
  gc.beginPath();
  gc.arc(r, r, r, 0, Math.PI * 2);
  gc.fill();
  _cloudSprite = c;
  _cloudSpriteSize = size;
  return c;
}

function renderZoneClouds() {
  if (!arenaZone || zoneClouds.length === 0) return;
  const z = arenaZone;
  ctx.save();
  // Only draw clouds outside the safe zone using clipping
  ctx.beginPath();
  ctx.rect(0, 0, GAME_CONFIG.ARENA_WIDTH, GAME_CONFIG.ARENA_HEIGHT);
  ctx.rect(z.x + z.w, z.y, -z.w, z.h); // counter-clockwise to cut out safe zone
  ctx.clip("evenodd");

  zoneClouds.forEach((c) => {
    const sprite = getCloudSprite(c.size);
    ctx.globalAlpha = c.opacity;
    ctx.drawImage(sprite, c.x - c.size, c.y - c.size, c.size * 2, c.size * 2);
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}

function renderZone() {
  if (!arenaZone) return;
  const z = arenaZone;

  ensureZoneClouds();
  updateZoneClouds();

  // Draw red danger overlay outside the safe zone using clipping
  ctx.save();

  // Fill entire arena with danger color, then clip out the safe zone
  // Stronger red the further the zone has shrunk
  const shrinkRatio = 1 - (z.w * z.h) / (GAME_CONFIG.ARENA_WIDTH * GAME_CONFIG.ARENA_HEIGHT);
  const dangerAlpha = 0.12 + shrinkRatio * 0.18;
  ctx.fillStyle = `rgba(180, 30, 30, ${dangerAlpha})`;

  // Top strip
  if (z.y > 0) ctx.fillRect(0, 0, GAME_CONFIG.ARENA_WIDTH, z.y);
  // Bottom strip
  const bottomY = z.y + z.h;
  if (bottomY < GAME_CONFIG.ARENA_HEIGHT) ctx.fillRect(0, bottomY, GAME_CONFIG.ARENA_WIDTH, GAME_CONFIG.ARENA_HEIGHT - bottomY);
  // Left strip (between top and bottom)
  if (z.x > 0) ctx.fillRect(0, z.y, z.x, z.h);
  // Right strip
  const rightX = z.x + z.w;
  if (rightX < GAME_CONFIG.ARENA_WIDTH) ctx.fillRect(rightX, z.y, GAME_CONFIG.ARENA_WIDTH - rightX, z.h);

  // Render floating danger clouds
  renderZoneClouds();

  // Pulsing border for the safe zone
  const pulse = 0.5 + 0.3 * Math.sin(Date.now() / 400);
  ctx.strokeStyle = `rgba(255, 60, 60, ${pulse})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 6]);
  ctx.strokeRect(z.x, z.y, z.w, z.h);
  ctx.setLineDash([]);

  // Inner glow on the safe zone border
  ctx.strokeStyle = `rgba(255, 100, 100, ${pulse * 0.3})`;
  ctx.lineWidth = 8;
  ctx.strokeRect(z.x - 2, z.y - 2, z.w + 4, z.h + 4);

  ctx.restore();
}

function renderLowHPVignette() {
  const localPlayer = players.find((p) => p.id === playerId);
  if (!localPlayer || localPlayer.hp <= 0 || localPlayer.hp > 1) return;

  lowHPPulseTime += 0.06;
  const pulse = 0.25 + 0.15 * Math.sin(lowHPPulseTime * 2); // Pulsing alpha

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const w = canvas.width;
  const h = canvas.height;
  // Cache gradient — only recreate on canvas resize
  if (!lowHPVignetteGradient || lowHPVignetteW !== w || lowHPVignetteH !== h) {
    lowHPVignetteGradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.min(w, h) * 0.7);
    lowHPVignetteGradient.addColorStop(0, "rgba(255,0,0,0)");
    lowHPVignetteGradient.addColorStop(1, "rgba(180,0,0,1)");
    lowHPVignetteW = w;
    lowHPVignetteH = h;
  }
  ctx.globalAlpha = pulse;
  ctx.fillStyle = lowHPVignetteGradient;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

// Heartbeat sound for low HP
let heartbeatTimerId = null;

function startHeartbeat() {
  if (heartbeatActive || !audioCtx) return;
  heartbeatActive = true;
  playHeartbeatLoop();
}

function stopHeartbeat() {
  heartbeatActive = false;
  if (heartbeatTimerId) { clearTimeout(heartbeatTimerId); heartbeatTimerId = null; }
}

function playHeartbeatLoop() {
  if (!heartbeatActive || !audioCtx) return;
  // Double-thump heartbeat pattern using oscillator
  const now = audioCtx.currentTime;

  // First thump
  const osc1 = audioCtx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(55, now);
  osc1.frequency.exponentialRampToValueAtTime(35, now + 0.1);
  const g1 = audioCtx.createGain();
  g1.gain.setValueAtTime(0.3, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc1.connect(g1);
  g1.connect(audioCtx.destination);
  osc1.start(now);
  osc1.stop(now + 0.15);

  // Second thump (slightly quieter, slightly delayed)
  const osc2 = audioCtx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(50, now + 0.18);
  osc2.frequency.exponentialRampToValueAtTime(30, now + 0.28);
  const g2 = audioCtx.createGain();
  g2.gain.setValueAtTime(0.2, now + 0.18);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
  osc2.connect(g2);
  g2.connect(audioCtx.destination);
  osc2.start(now + 0.18);
  osc2.stop(now + 0.32);

  // Schedule next heartbeat (tracked so we can cancel)
  heartbeatTimerId = setTimeout(() => { heartbeatTimerId = null; playHeartbeatLoop(); }, 800);
}

// Screen shake system
function triggerScreenShake(intensity) {
  screenShake.intensity = Math.min(screenShake.intensity + intensity, 18);
}

function getScreenShakeOffset() {
  if (screenShake.intensity < 0.3) return { x: 0, y: 0 };
  const angle = Math.random() * Math.PI * 2;
  const magnitude = screenShake.intensity * (0.5 + Math.random() * 0.5);
  return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
}

function updateScreenShake() {
  if (screenShake.intensity > 0.3) {
    screenShake.intensity *= screenShake.decay;
  } else {
    screenShake.intensity = 0;
  }
}

function renderExplosions() {
  for (let i = 0; i < explosions.length; i++) {
    const explosion = explosions[i];
    for (let j = 0; j < explosion.particles.length; j++) {
      const p = explosion.particles[j];
      if (p.life > 0 && isOnScreen(p.x, p.y)) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    }
  }

  // Render blood particles
  for (let i = 0; i < bloodParticles.length; i++) {
    const blood = bloodParticles[i];
    for (let j = 0; j < blood.particles.length; j++) {
      const p = blood.particles[j];
      if (p.life > 0 && isOnScreen(p.x, p.y)) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    }
  }
}

// ===== MOVEMENT PREDICTION =====

// Movement prediction function (matches server logic)
function applyInput(x, y, keys, weapon, speedBoosted) {
  const boostMultiplier = speedBoosted ? GAME_CONFIG.PICKUP_SPEED_MULTIPLIER : 1;
  const speed = GAME_CONFIG.PLAYER_SPEED * boostMultiplier;
  const playerRadius = GAME_CONFIG.PLAYER_RADIUS;
  const radiusSq = playerRadius * playerRadius;
  const margin = playerRadius;
  let newX = x;
  let newY = y;

  // X axis movement + collision (push-out resolution)
  if (keys.a) newX -= speed;
  if (keys.d) newX += speed;
  newX = Math.max(margin, Math.min(GAME_CONFIG.ARENA_WIDTH - margin, newX));
  for (const obs of obstacles) {
    if (obs.destroyed) continue;
    const cx = Math.max(obs.x, Math.min(newX, obs.x + obs.size));
    const cy = Math.max(obs.y, Math.min(newY, obs.y + obs.size));
    const dx = newX - cx;
    const dy = newY - cy;
    const distSq = dx * dx + dy * dy;
    if (distSq < radiusSq) {
      if (distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        newX += (dx / dist) * (playerRadius - dist);
      } else {
        // Exactly overlapping — push away from obstacle center
        newX = obs.x + obs.size / 2 < newX
          ? obs.x + obs.size + playerRadius
          : obs.x - playerRadius;
      }
    }
  }
  newX = Math.max(margin, Math.min(GAME_CONFIG.ARENA_WIDTH - margin, newX));

  // Y axis movement + collision (push-out resolution)
  if (keys.w) newY -= speed;
  if (keys.s) newY += speed;
  newY = Math.max(margin, Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, newY));
  for (const obs of obstacles) {
    if (obs.destroyed) continue;
    const cx = Math.max(obs.x, Math.min(newX, obs.x + obs.size));
    const cy = Math.max(obs.y, Math.min(newY, obs.y + obs.size));
    const dx = newX - cx;
    const dy = newY - cy;
    const distSq = dx * dx + dy * dy;
    if (distSq < radiusSq) {
      if (distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        newY += (dy / dist) * (playerRadius - dist);
      } else {
        newY = obs.y + obs.size / 2 < newY
          ? obs.y + obs.size + playerRadius
          : obs.y - playerRadius;
      }
    }
  }
  newY = Math.max(margin, Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, newY));

  return { x: newX, y: newY };
}

// ===== WEB AUDIO SYSTEM =====

let audioCtx = null;
const audioBuffers = {};
let readyAlarmSource = null;
let readyAlarmGain = null;
const activeGameSources = [];
let masterVolume = 0.7; // 0.0 – 1.0, persisted in localStorage
let gameEnded = false; // prevents new game sounds after match ends
try { const saved = localStorage.getItem("masterVolume"); if (saved !== null) masterVolume = parseFloat(saved); } catch (_) { /* ignore */ }
let machinegunSoundIndex = 0;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  loadAudioBuffer("shot", `${assetBase}/assets/shot.wav`);
  for (let i = 1; i <= 4; i++) loadAudioBuffer(`machinegun-${i}`, `${assetBase}/assets/shot/machinegun-${i}.mp3`);
  loadAudioBuffer("machinegun-5", `${assetBase}/assets/shot/machinegun-5.wav`);
  loadAudioBuffer("shotgun-shot", `${assetBase}/assets/shot/shotgun.mp3`);
  loadAudioBuffer("sniper-shot", `${assetBase}/assets/shot/sniper.mp3`);
  loadAudioBuffer("reload", `${assetBase}/assets/reload.ogg`);
  loadAudioBuffer("scream", `${assetBase}/assets/scream.wav`);
  loadAudioBuffer("matchstart", `${assetBase}/assets/matchstart.ogg`);
  loadAudioBuffer("died", `${assetBase}/assets/died.mp3`);
  loadAudioBuffer("readyalarm", `${assetBase}/assets/readyalarm.wav`);
  loadAudioBuffer("lightning", `${assetBase}/assets/lightning-strike.mp3`);
  for (let i = 1; i <= 8; i++) loadAudioBuffer(`win-${i}`, `${assetBase}/assets/match-win/win-${i}.mp3`);
  for (let i = 1; i <= 9; i++) loadAudioBuffer(`lose-${i}`, `${assetBase}/assets/match-lose/lose-${i}.mp3`);
  loadAudioBuffer("bomb-1", `${assetBase}/assets/bombs/bomb-1.mp3`);
  loadAudioBuffer("bomb-2", `${assetBase}/assets/bombs/bomb-2.mp3`);
  loadAudioBuffer("bomb-3", `${assetBase}/assets/bombs/bomb-3.mp3`);
  loadAudioBuffer("bomb-4", `${assetBase}/assets/bombs/bomb-4.mp3`);
  loadAudioBuffer("bomb-5", `${assetBase}/assets/bombs/bomb-5.mp3`);
}

async function loadAudioBuffer(name, url) {
  try {
    const response = await fetch(url, {
      headers: { "ngrok-skip-browser-warning": "1" }
    });
    const arrayBuffer = await response.arrayBuffer();
    audioBuffers[name] = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.log("Failed to load audio:", name, e);
  }
}

function playSound(bufferName, volume = 1.0, playbackRate = 1.0) {
  if (!audioCtx || !audioBuffers[bufferName]) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffers[bufferName];
  source.playbackRate.value = playbackRate;
  const gain = audioCtx.createGain();
  gain.gain.value = volume * masterVolume;
  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start(0);
  activeGameSources.push(source);
  source.onended = () => {
    const idx = activeGameSources.indexOf(source);
    if (idx !== -1) activeGameSources.splice(idx, 1);
  };
}

function playPositionalSound(
  bufferName,
  sourceX,
  sourceY,
  volume = 1.0,
  playbackRate = 1.0,
) {
  if (!audioCtx || !audioBuffers[bufferName]) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const dx = sourceX - predictedX;
  const dy = sourceY - predictedY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  // Use a shorter hearing range for more noticeable spatial effect
  const maxHearingDist = 600;
  const distanceFactor = Math.max(0, 1 - distance / maxHearingDist);
  // Quadratic falloff for more realistic attenuation
  const attenuation = distanceFactor * distanceFactor;
  const finalVolume = volume * masterVolume * (0.05 + 0.95 * attenuation);
  // Stronger panning for clearer left/right separation
  const pan = Math.max(
    -1,
    Math.min(1, dx / (GAME_CONFIG.ARENA_WIDTH * 0.25)),
  );
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffers[bufferName];
  source.playbackRate.value = playbackRate;
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = finalVolume;
  const panner = audioCtx.createStereoPanner();
  panner.pan.value = pan;
  source.connect(gainNode);
  gainNode.connect(panner);
  panner.connect(audioCtx.destination);
  source.start(0);
  activeGameSources.push(source);
  source.onended = () => {
    const idx = activeGameSources.indexOf(source);
    if (idx !== -1) activeGameSources.splice(idx, 1);
  };
}

function stopAllGameSounds() {
  for (const src of activeGameSources) {
    try { src.stop(); } catch (_) { /* already stopped */ }
  }
  activeGameSources.length = 0;
}

function playKnifeSound(x, y) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const osc = audioCtx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(200, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.12);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
  const dx = x - predictedX;
  const panVal = Math.max(
    -1,
    Math.min(1, dx / (GAME_CONFIG.ARENA_WIDTH * 0.25)),
  );
  const panner = audioCtx.createStereoPanner();
  panner.pan.value = panVal;
  osc.connect(gain);
  gain.connect(panner);
  panner.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.12);
}

function startReadyAlarm() {
  if (!audioCtx || !audioBuffers.readyalarm) return;
  stopReadyAlarm();
  readyAlarmSource = audioCtx.createBufferSource();
  readyAlarmSource.buffer = audioBuffers.readyalarm;
  readyAlarmSource.loop = true;
  readyAlarmGain = audioCtx.createGain();
  readyAlarmGain.gain.value = 0.4;
  readyAlarmSource.connect(readyAlarmGain);
  readyAlarmGain.connect(audioCtx.destination);
  readyAlarmSource.start(0);
}

function stopReadyAlarm() {
  if (readyAlarmSource) {
    try {
      readyAlarmSource.stop();
    } catch (e) {
      /* already stopped */
    }
    readyAlarmSource = null;
    readyAlarmGain = null;
  }
}

// ===== UI FUNCTIONS =====

let previousHP = 8;

// ===== SHOW/HIDE SCREENS =====

function showStartScreen() {
  document.getElementById("startScreen").style.display = "flex";
  canvas.style.display = "none";
  document.getElementById("gameUI").style.display = "none";
  document.getElementById("leaderboard").style.display = "none";
  document.getElementById("killFeed").style.display = "none";
  document.getElementById("playerList").style.display = "none";
  const deathOv = document.getElementById("deathOverlay");
  if (deathOv) deathOv.style.display = "none";
  const roundOv = document.getElementById("roundEndOverlay");
  if (roundOv) roundOv.style.display = "none";
  const mobileCtrl = document.getElementById("mobileControls");
  if (mobileCtrl) mobileCtrl.classList.remove("active");

  // Reset game state
  players = [];
  bullets = [];
  pickups = [];
  explosions = [];
  bloodParticles = [];
  bloodStains = [];
  muzzleFlashes = [];
  knifeSlashes = [];
  shellCasings = [];
  impactSparks = [];
  dustClouds = [];
  hitMarkers = [];
  damageIndicators = [];
  activeBombs = [];
  activeLightnings = [];
  killEffects = [];
  deathAnimations = [];
  flashbangOverlay = { alpha: 0, flicker: 0, flickerVal: 0 };
  previousBulletPositions.clear();
  screenShake = { intensity: 0, decay: 0.92 };
  killFeedEntries = [];
  killFeedDirty = true;
  obstacleCanvasDirty = true;
  _cachedDOM = null;
  previousPlayerStates.clear();
  gameReady = false;
  roundEnded = false;
  floatingNumbers = [];
  lowHPPulseTime = 0;
  arenaZone = null;
  zoneWarningShown = false;
  zoneClouds = [];
  lootCrates = [];
  crateDestroyEffects = [];
  dashCooldownUntil = 0;
  dashTrails = [];
  orbs = [];
  stopHeartbeat();
  stopAllGameSounds();
  lastKilledByUsername = "";
  pendingDeathWeapon.clear();
}

function enterGame(data) {
  // Hide start screen, show game
  document.getElementById("startScreen").style.display = "none";
  canvas.style.display = "block";
  document.getElementById("gameUI").style.display = "block";
  document.getElementById("leaderboard").style.display = "block";
  document.getElementById("killFeed").style.display = "flex";

  // Set up game state from server
  playerId = data.playerId;
  loggedInUsername = data.username;

  // Binary state protocol: populate shortId map
  if (data.shortId) myShortId = data.shortId;
  if (data.shortIdMap) {
    shortIdMap = {};
    for (var key in data.shortIdMap) {
      shortIdMap[Number(key)] = data.shortIdMap[key];
    }
  }

  // Save username for convenience (auto-fill on next visit)
  try { localStorage.setItem("dm_username", data.username); } catch { /* private browsing */ }

  players = data.players || [];
  obstacles = data.obstacles || [];
  orbs = (data.orbs || []).map(function(o) {
    if (Array.isArray(o)) return { id: o[0], x: o[1], y: o[2] };
    return o;
  });

  if (data.arenaWidth) GAME_CONFIG.ARENA_WIDTH = data.arenaWidth;
  if (data.arenaHeight) GAME_CONFIG.ARENA_HEIGHT = data.arenaHeight;
  if (data.maxHp) maxHp = data.maxHp;
  if (data.timerRemaining != null) roundTimeRemaining = data.timerRemaining;

  obstacleCanvasDirty = true;
  _cachedDOM = null;
  gameReady = true;

  resizeCanvas();

  // Initialize audio system on first user interaction
  initAudio();

  // Find local player and set predicted position
  const localP = players.find(function(p) { return p.id === playerId; });
  if (localP) {
    predictedX = localP.x;
    predictedY = localP.y;
  }

  // Initialize mobile controls
  initMobileControls();

  playSound("matchstart", 0.5);
  showToast("🔥 ENTERED THE ARENA! 🔥", "#ff6b35");
}

// ===== SCOREBOARD =====

function updatePlayerList() {
  const content = document.getElementById("playerListContent");
  if (!content) return;

  const sorted = [...players]
    .filter(function(p) { return p.username; })
    .sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

  const medals = ["🥇", "🥈", "🥉"];
  content.innerHTML = sorted
    .map(function(p, i) {
      const isMe = p.id === playerId;
      const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(1) : p.kills.toFixed(1);
      const hpPct = Math.round((p.hp / maxHp) * 100);
      const dead = p.hp <= 0;
      const medal = i < 3 ? medals[i] : (i + 1) + ".";
      return '<div class="pl-row' + (isMe ? " me" : "") + (dead ? " dead" : "") + '">' +
        '<span class="pl-rank">' + medal + '</span>' +
        '<span class="pl-name">' + esc(p.username) + '</span>' +
        '<span class="pl-stats">⭐' + (p.score || 0) + ' | ' + p.kills + 'K/' + p.deaths + 'D (' + kd + ') | ' + (dead ? '💀' : '❤️' + hpPct + '%') + '</span>' +
        '</div>';
    })
    .join("");
}

// ===== IN-GAME LEADERBOARD OVERLAY =====

function updateLeaderboardOverlay() {
  if (!gameReady) return;
  const list = document.getElementById("leaderboardList");
  if (!list) return;

  const sorted = [...players]
    .filter(function(p) { return p.username && p.hp !== undefined; })
    .sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

  const top = sorted.slice(0, 10);
  const localIdx = sorted.findIndex(function(p) { return p.id === playerId; });

  let html = "";
  top.forEach(function(p, i) {
    const isMe = p.id === playerId;
    html += '<div class="lb-row' + (isMe ? " lb-me" : "") + '">' +
      '<span class="lb-rank">' + (i + 1) + '.</span>' +
      '<span class="lb-name">' + esc(p.username) + '</span>' +
      '<span class="lb-score">' + (p.score || 0) + '</span>' +
      '</div>';
  });

  // Show local player position if not in top 10
  if (localIdx >= 10) {
    const me = sorted[localIdx];
    html += '<div class="lb-divider">···</div>';
    html += '<div class="lb-row lb-me">' +
      '<span class="lb-rank">' + (localIdx + 1) + '.</span>' +
      '<span class="lb-name">' + esc(me.username) + '</span>' +
      '<span class="lb-score">' + (me.score || 0) + '</span>' +
      '</div>';
  }

  list.innerHTML = html;
}

// ===== SHOOTING =====

function tryShoot() {
  if (!isMouseDown || !gameReady || roundEnded) return;
  const localPlayer = players.find(function(p) { return p.id === playerId; });
  if (!localPlayer || localPlayer.hp <= 0) return;
  if (localPlayer.reloading) return;

  const weapon = localPlayer.weapon || "machinegun";
  const cooldowns = WEAPON_COOLDOWNS;
  const cooldown = cooldowns[weapon] || 100;
  const now = Date.now();
  if (now - lastShootTime < cooldown) return;
  lastShootTime = now;

  let dirX = mouseX - predictedX;
  let dirY = mouseY - predictedY;
  const mag = Math.sqrt(dirX * dirX + dirY * dirY);
  if (mag > 0.001) { dirX /= mag; dirY /= mag; }
  else { dirX = 0; dirY = -1; }

  // Apply aim assist
  const rawAngle = Math.atan2(dirY, dirX);
  const assistedAngle = getAimAssistAngle(rawAngle);
  dirX = Math.cos(assistedAngle);
  dirY = Math.sin(assistedAngle);

  ws.send(serialize({ type: "shoot", dirX: dirX, dirY: dirY }));

  // Client-side muzzle flash and effects
  const flashX = predictedX + dirX * 30;
  const flashY = predictedY + dirY * 30;
  createMuzzleFlash(flashX, flashY, dirX, dirY);

  // Shell casing
  const casingAngle = Math.atan2(dirY, dirX) + Math.PI / 2;
  createShellCasing(predictedX, predictedY, casingAngle);

  // Client-side predicted bullet (removed on next server state)
  const bulletSpeed = weapon === "sniper" ? 30 : 15;
  bullets.push({
    id: "predicted-" + Math.random().toString(36).slice(2),
    x: predictedX + dirX * 20,
    y: predictedY + dirY * 20,
    dx: dirX * bulletSpeed,
    dy: dirY * bulletSpeed,
    weapon: weapon,
    predicted: true,
  });

  // Screen shake
  const shakeAmount = weapon === "shotgun" ? 5 : weapon === "sniper" ? 4 : 2;
  triggerScreenShake(shakeAmount);

  // Shot sound
  if (weapon === "shotgun") {
    playPositionalSound("shotgun-shot", predictedX, predictedY, 0.6);
  } else if (weapon === "sniper") {
    playPositionalSound("sniper-shot", predictedX, predictedY, 0.6);
  } else {
    const shotIdx = Math.floor(Math.random() * 5) + 1;
    playPositionalSound("machinegun-" + shotIdx, predictedX, predictedY, 0.35);
  }
}

// ===== WEBSOCKET CONNECTION =====

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = function() {
    console.log("WebSocket connected");
  };

  ws.onmessage = function(e) {
    // ===== BINARY STATE MESSAGE (fast path) =====
    if (isBinaryState(e.data)) {
      handleBinaryState(e.data);
      return;
    }

    const data = deserialize(e.data);
    if (!data || !data.type) return;

    // ===== ONLINE COUNT =====
    if (data.type === "onlineCount") {
      const el = document.getElementById("onlineNumber");
      if (el) el.textContent = data.count || 0;
      return;
    }

    // ===== ERROR =====
    if (data.type === "error") {
      const errorEl = document.getElementById("usernameError");
      if (errorEl) {
        errorEl.textContent = "⚠ " + data.message;
        errorEl.style.display = "block";
      }
      const playBtn = document.getElementById("playBtn");
      if (playBtn) {
        playBtn.disabled = false;
        playBtn.style.opacity = "1";
        playBtn.textContent = "▶ PLAY";
      }
      return;
    }

    // ===== GAME JOINED (enter the arena) =====
    if (data.type === "gameJoined") {
      enterGame(data);
      return;
    }

    // ===== PLAYER JOINED/LEFT =====
    if (data.type === "playerJoined") {
      showToast("➕ " + esc(data.username) + " joined", "#44bbff");
      // Update shortId map for the new player
      if (data.shortId) {
        shortIdMap[data.shortId] = { id: data.playerId, username: data.username };
      }
      return;
    }

    if (data.type === "playerDisconnected") {
      showToast("⚠️ " + esc(data.username) + " left", "#ff6b35");
      // Remove from players array
      players = players.filter(function(p) { return p.id !== data.playerId; });
      playerTargets.delete(data.playerId);
      previousPlayerStates.delete(data.playerId);
      return;
    }

    // ===== RESPAWN =====
    if (data.type === "respawn") {
      const respawnedPlayer = players.find(function(p) { return p.id === data.playerId; });
      if (respawnedPlayer) {
        respawnedPlayer.x = data.x;
        respawnedPlayer.y = data.y;
        respawnedPlayer.hp = maxHp;

        if (data.playerId !== playerId) {
          playerTargets.set(data.playerId, {
            currentX: data.x, currentY: data.y,
            targetX: data.x, targetY: data.y,
          });
        } else {
          // Local player respawned
          predictedX = data.x;
          predictedY = data.y;
          flashbangOverlay = { alpha: 0, flicker: 0, flickerVal: 0 };
          lightningBolts = [];
          pageFlashIntensity = 0;
          document.body.style.filter = "";
          // Hide death overlay
          const deathOv = document.getElementById("deathOverlay");
          if (deathOv) deathOv.style.display = "none";
          showToast("🔄 Respawned!", "#44ff44");
        }
      }
      return;
    }

    // ===== OBSTACLES =====
    if (data.type === "newObstacle") {
      if (data.obstacle) {
        obstacles.push(data.obstacle);
        obstacleCanvasDirty = true;
      }
      return;
    }

    if (data.type === "obstacleDestroyed") {
      const ids = data.destroyedIds || [data.obstacleId];
      for (const oid of ids) {
        const obstacle = obstacles.find(function(o) { return o.id === oid; });
        if (obstacle) {
          createImpactSparks(obstacle.x + obstacle.size / 2, obstacle.y + obstacle.size / 2);
          obstacle.destroyed = true;
        }
      }
      obstacleCanvasDirty = true;
      return;
    }

    // ===== ZONE WARNING =====
    if (data.type === "zoneWarning") {
      zoneWarningShown = true;
      showToast("⚠️ ZONE SHRINKING!", "#ff4444");
      return;
    }

    // ===== ORB COLLECTED =====
    if (data.type === "orbCollected") {
      // Could add particle effect
      return;
    }

    // ===== KILLS =====
    if (data.type === "kill") {
      addKillFeedEntry(data.killer, data.victim, data.weapon);
      pendingDeathWeapon.set(data.victim, data.weapon);

      const localPlayer = players.find(function(p) { return p.id === playerId; });
      if (localPlayer) {
        if (data.killer === localPlayer.username) {
          if (data.isRevenge) {
            showRevengeAnimation();
          } else {
            const phrase = SELF_KILL_PHRASES[Math.floor(Math.random() * SELF_KILL_PHRASES.length)]
              .replace("{victim}", data.victim);
            showToast(phrase, "#4ad94a");
          }
        } else if (data.victim === localPlayer.username) {
          lastKilledByUsername = data.killer;
          // Show death overlay with respawn button
          const deathOv = document.getElementById("deathOverlay");
          if (deathOv) {
            deathOv.style.display = "flex";
            const killerEl = document.getElementById("deathKiller");
            if (killerEl) killerEl.textContent = "Killed by " + data.killer;
            const droppedEl = document.getElementById("deathDroppedScore");
            if (droppedEl) {
              if (data.droppedScore > 0) {
                droppedEl.textContent = "-" + data.droppedScore + " points dropped!";
                droppedEl.style.display = "block";
              } else {
                droppedEl.style.display = "none";
              }
            }
          }
          const phrase = DEATH_PHRASES[Math.floor(Math.random() * DEATH_PHRASES.length)]
            .replace("{killer}", data.killer);
          showToast(phrase, "#d94a4a");
        }
      }
      return;
    }

    if (data.type === "killStreak") {
      const streakColors = { 2: "#ffaa00", 3: "#ff6600", 5: "#ff2222", 7: "#ff00ff", 10: "#00ffff" };
      const color = streakColors[data.streak] || "#ffaa00";
      showToast("🔥 " + data.player + ": " + data.message, color);
      addKillFeedEntry(data.player, data.message, "streak");
      return;
    }

    // ===== PICKUPS =====
    if (data.type === "pickupCollected") {
      createPickupEffect(data.x, data.y, data.pickupType);
      if (data.playerId === playerId) {
        playPickupSound();
        const pickupMessages = {
          health: "❤️ Health restored!",
          ammo: "🎯 Full ammo!",
          speed: "⚡ Speed boost!",
          shield: "🛡️ Shield active!",
          invisibility: "👻 Invisible!",
          regen: "💚 Regenerating!",
          armor: "🛡️ Armor up!",
        };
        showToast(pickupMessages[data.pickupType] || "✨ Bonus!", "#44bbff");
      }
      return;
    }

    // ===== BOMBS =====
    if (data.type === "bombSpawned") {
      activeBombs.push({ id: data.id, x: data.x, y: data.y, spawnTime: Date.now() });
      return;
    }

    if (data.type === "bombExploded") {
      activeBombs = activeBombs.filter(function(b) { return b.id !== data.id; });
      createBombExplosion(data.x, data.y, data.radius || 80);
      const dx = data.x - predictedX;
      const dy = data.y - predictedY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      triggerScreenShake(Math.max(2, 15 - dist / 50));
      if (dist < 120) {
        flashbangOverlay.alpha = Math.max(flashbangOverlay.alpha, 0.3 * (1 - dist / 120));
      }
      playExplosionSound(data.x, data.y);
      return;
    }

    // ===== LIGHTNING =====
    if (data.type === "lightningWarning") {
      activeLightnings.push({
        id: data.id, x: data.x, y: data.y,
        radius: data.radius || 100, spawnTime: Date.now(), fuseTime: 250,
      });
      return;
    }

    if (data.type === "lightningStruck") {
      activeLightnings = activeLightnings.filter(function(l) { return l.id !== data.id; });
      const lx = data.x, ly = data.y, lRadius = data.radius || 100;
      const ldx = lx - predictedX, ldy = ly - predictedY;
      const ldist = Math.sqrt(ldx * ldx + ldy * ldy);
      if (ldist < lRadius) {
        const proximity = 1.0 - ldist / lRadius;
        playSound("lightning", 0.3 + proximity * 0.35, 0.9 + Math.random() * 0.2);
        triggerScreenShake(5 + proximity * 13);
        flashbangOverlay.alpha = 0.9 + proximity * 0.1;
        flashbangOverlay.flicker = 1;
        // Use server blindDuration for longer lightning blind
        var blindDurationMs = data.blindDuration || 3000;
        flashbangOverlay.decayRate = 1.0 / (blindDurationMs / 1000 * 60);
        flashbangOverlay.pageDecayRate = 1.0 / (blindDurationMs / 1000 * 60);
        applyPageFlash(0.8 + proximity * 0.2);
      } else if (ldist < lRadius * 2.5) {
        const nearFactor = 1.0 - (ldist - lRadius) / (lRadius * 1.5);
        triggerScreenShake(2 + nearFactor * 5);
        playSound("lightning", nearFactor * 0.2, 0.7 + Math.random() * 0.2);
        if (nearFactor > 0.3) applyPageFlash(nearFactor * 0.4);
      }
      createLightningStrike(lx, ly, lRadius);
      return;
    }

    // ===== LOOT CRATES =====
    if (data.type === "crateSpawned") {
      const c = data.crate;
      if (!lootCrates.find(function(lc) { return lc.id === c.id; })) {
        lootCrates.push({ id: c.id, x: c.x, y: c.y, hp: c.hp });
      }
      return;
    }

    if (data.type === "crateHit") {
      const crate = lootCrates.find(function(c) { return c.id === data.crateId; });
      if (crate) { crate.hp = data.hp; crate.hitFlash = Date.now(); }
      return;
    }

    if (data.type === "crateDestroyed") {
      lootCrates = lootCrates.filter(function(c) { return c.id !== data.crateId; });
      crateDestroyEffects.push({ x: data.pickup.x, y: data.pickup.y, time: Date.now() });
      return;
    }

    // ===== CHAT =====
    if (data.type === "chatMessage") {
      addKillFeedEntry(data.username, data.message, "chat");
      return;
    }

    // ===== EMOTE =====
    if (data.type === "emote") {
      var emIdx = data.emote;
      if (emIdx >= 0 && emIdx < EMOTE_LIST.length) {
        playerEmotes[data.playerId] = { emoji: EMOTE_LIST[emIdx], time: Date.now() };
      }
      return;
    }

    // ===== STATE UPDATE (35 Hz) =====
    if (data.type === "state") {
      const weaponCodeMap = { 0: "machinegun", 1: "shotgun", 2: "knife", 3: "minigun", 4: "sniper" };
      const usernameMap = new Map();
      players.forEach(function(pl) { usernameMap.set(pl.id, pl.username); });

      const prevPlayerMap = new Map();
      players.forEach(function(pl) { prevPlayerMap.set(pl.id, pl); });

      function parseCompactPlayer(p) {
        return {
          id: p[0], x: p[1], y: p[2], hp: p[3], shots: p[4],
          reloading: p[5] === 1, lastProcessedInput: p[6],
          aimAngle: p[7], weapon: weaponCodeMap[p[8]] || "machinegun",
          kills: p[9], skin: p[10] || 0,
          speedBoosted: p[11] === 1, shielded: p[12] === 1,
          invisible: p[13] === 1, regen: p[14] === 1,
          armor: p[15] || 0, dashing: p[16] === 1, score: p[17] || 0,
          username: usernameMap.get(p[0]) || "Player",
        };
      }

      const incoming = (data.p || data.players || []).map(function(p) {
        if (Array.isArray(p)) return parseCompactPlayer(p);
        return p;
      });

      let parsedPlayers;
      if (data.df) {
        const updatedMap = new Map(prevPlayerMap);
        for (const pl of incoming) updatedMap.set(pl.id, pl);
        parsedPlayers = Array.from(updatedMap.values());
      } else {
        parsedPlayers = incoming;
      }

      // Parse bullets
      const parsedBullets = (data.b || data.bullets || []).map(function(b) {
        if (Array.isArray(b)) return { id: b[0], x: b[1], y: b[2], weapon: weaponCodeMap[b[3]] || "machinegun" };
        return b;
      });

      // Parse pickups
      const pickupTypeMap = { 0: "health", 1: "ammo", 2: "speed", 3: "minigun", 4: "shield", 5: "invisibility", 6: "regen", 7: "armor" };
      pickups = (data.pk || []).map(function(pk) {
        if (Array.isArray(pk)) return { id: pk[0], x: pk[1], y: pk[2], type: pickupTypeMap[pk[3]] || "health" };
        return pk;
      });

      // Update orbs
      if (data.orbs) {
        orbs = data.orbs.map(function(o) {
          if (Array.isArray(o)) return { id: o[0], x: o[1], y: o[2] };
          return o;
        });
      }

      // Zone
      if (data.z) {
        arenaZone = { x: data.z[0], y: data.z[1], w: data.z[2], h: data.z[3] };
      }

      // Loot crates
      if (data.cr) {
        lootCrates = data.cr.map(function(c) {
          if (Array.isArray(c)) return { id: c[0], x: c[1], y: c[2], hp: c[3] };
          return c;
        });
      }

      // Death/damage detection
      parsedPlayers.forEach(function(p) {
        const prevState = previousPlayerStates.get(p.id);
        if (prevState && prevState.hp > 0 && p.hp <= 0) {
          createDeathAnimation(p.x, p.y, p.skin || 0);
          const deathWeapon = pendingDeathWeapon.get(p.username) || "machinegun";
          pendingDeathWeapon.delete(p.username);

          if (deathWeapon === "shotgun") {
            for (let i = 0; i < 12; i++) {
              const angle = Math.random() * Math.PI * 2;
              const speed = 3 + Math.random() * 4;
              bloodParticles.push({
                particles: [{ x: p.x, y: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2, life: 1.0, size: 3 + Math.random() * 4, color: "rgb(" + (139 + Math.floor(Math.random() * 116)) + ", 0, 0)" }],
                frame: 0,
              });
            }
            createBloodStain(p.x, p.y); createBloodStain(p.x, p.y);
            createKillEffect(p.x, p.y, "fire");
          } else if (deathWeapon === "sniper") {
            createKillEffect(p.x, p.y, "lightning"); createBlood(p.x, p.y);
          } else {
            createBlood(p.x, p.y); createBloodStain(p.x, p.y); createKillEffect(p.x, p.y, "lightning");
          }

          createFloatingNumber(p.x, p.y, prevState.hp);
          if (p.id === playerId) { triggerScreenShake(12); stopHeartbeat(); }
          else { triggerScreenShake(5); }
          playPositionalSound("died", p.x, p.y, 0.3);
          if (p.id !== playerId) createHitMarker();
        } else if (prevState && prevState.hp > p.hp && p.hp > 0) {
          createBlood(p.x, p.y);
          createBloodStain(p.x, p.y);
          createFloatingNumber(p.x, p.y, prevState.hp - p.hp);
          if (p.id !== playerId) createHitMarker();
          if (p.id === playerId) {
            createDamageIndicator(p.x, p.y);
            triggerScreenShake(6);
            if (p.hp === 1) startHeartbeat();
          }
        } else if (prevState && p.hp > prevState.hp && p.id === playerId) {
          if (p.hp > 1) stopHeartbeat();
        }
        previousPlayerStates.set(p.id, { hp: p.hp, x: p.x, y: p.y });

        if (p.id !== playerId) {
          const current = playerTargets.get(p.id);
          if (current) {
            playerTargets.set(p.id, { currentX: current.currentX, currentY: current.currentY, targetX: p.x, targetY: p.y });
          } else {
            playerTargets.set(p.id, { currentX: p.x, currentY: p.y, targetX: p.x, targetY: p.y });
          }
        }
      });

      // Bullet impact detection
      const newBulletPositions = new Map();
      parsedBullets.forEach(function(b) { newBulletPositions.set(b.id, { x: b.x, y: b.y }); });
      previousBulletPositions.forEach(function(prev, id) {
        if (!newBulletPositions.has(id)) {
          createImpactSparks(prev.x, prev.y);
        }
      });

      const currentBulletCount = parsedBullets.length;
      if (currentBulletCount > previousBulletCount) {
        const newBullets = parsedBullets.filter(function(b) { return !previousBulletPositions.has(b.id); });
        newBullets.forEach(function(b) {
          const shooter = players.find(function(p) { return p.id !== playerId; });
          if (shooter) {
            if (b.weapon === "shotgun") {
              playPositionalSound("shotgun-shot", b.x, b.y, 0.25);
            } else if (b.weapon === "sniper") {
              playPositionalSound("sniper-shot", b.x, b.y, 0.25);
            } else {
              const idx = Math.floor(Math.random() * 5) + 1;
              playPositionalSound("machinegun-" + idx, b.x, b.y, 0.12);
            }
          }
        });
      }
      previousBulletCount = currentBulletCount;
      previousBulletPositions = newBulletPositions;

      players = parsedPlayers;
      bullets = parsedBullets.concat(bullets.filter(function(b) { return b.predicted; }));
      bullets = bullets.filter(function(b) {
        if (!b.predicted) return true;
        return !parsedBullets.some(function(sb) {
          const dx = sb.x - b.x, dy = sb.y - b.y;
          return dx * dx + dy * dy < 2500;
        });
      });

      // Client-side prediction reconciliation
      const currentPlayer = players.find(function(p) { return p.id === playerId; });
      if (currentPlayer) {
        // Update HUD HP tracking
        if (currentPlayer.hp < previousHP) {
          playPositionalSound("scream", predictedX, predictedY, 0.25);
        }
        previousHP = currentPlayer.hp;

        // Dash cooldown from server
        if (currentPlayer.dashing) dashCooldownUntil = Date.now() + 1000;

        const lastProcessed = currentPlayer.lastProcessedInput || 0;
        pendingInputs = pendingInputs.filter(function(i) { return i.sequence > lastProcessed; });

        let reconciledX = currentPlayer.x;
        let reconciledY = currentPlayer.y;
        pendingInputs.forEach(function(input) {
          const result = applyInput(reconciledX, reconciledY, input.keys, currentPlayer.weapon, currentPlayer.speedBoosted);
          reconciledX = result.x;
          reconciledY = result.y;
        });
        // Smooth correction: snap large errors, blend small drift
        const errX2 = reconciledX - predictedX;
        const errY2 = reconciledY - predictedY;
        const errDist2 = Math.sqrt(errX2 * errX2 + errY2 * errY2);
        if (errDist2 > 80) {
          predictedX = reconciledX;
          predictedY = reconciledY;
        } else if (errDist2 > 0.5) {
          predictedX += errX2 * 0.25;
          predictedY += errY2 * 0.25;
        }

        const now = Date.now();
        pendingInputs = pendingInputs.filter(function(i) { return now - i.timestamp < 1000; });
      }

      // Throttle leaderboard DOM rebuild to ~5 Hz
      if (Date.now() - lastLeaderboardUpdate > 200) {
        lastLeaderboardUpdate = Date.now();
        updateLeaderboardOverlay();
      }
      return;
    }

    // ===== GAME TIMER =====
    if (data.type === "gameTimer") {
      roundTimeRemaining = data.remaining;
      var timerEl = document.getElementById("timerDisplay");
      if (timerEl) {
        var mins = Math.floor(data.remaining / 60);
        var secs = data.remaining % 60;
        timerEl.textContent = "\u23f1 " + mins + ":" + (secs < 10 ? "0" : "") + secs;
        if (data.remaining <= 30) {
          timerEl.classList.add("timer-warning");
        } else {
          timerEl.classList.remove("timer-warning");
        }
      }
      return;
    }

    // ===== ROUND END =====
    if (data.type === "roundEnd") {
      roundEnded = true;
      isMouseDown = false;
      // Release all movement keys
      for (var rk in currentKeys) currentKeys[rk] = false;
      keysPressed.clear();

      var overlay = document.getElementById("roundEndOverlay");
      if (overlay) {
        overlay.style.display = "flex";
        var winnerEl = document.getElementById("roundEndWinner");
        if (winnerEl) winnerEl.textContent = "\ud83c\udfc6 " + esc(data.winnerName) + " wins!";

        var sbEl = document.getElementById("roundEndScoreboard");
        if (sbEl && data.scoreboard) {
          var medals = ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"];
          var html = "";

          // MVP Awards section
          if (data.mvpAwards && data.mvpAwards.length > 0) {
            var mvpIcons = { mostKills: "\ud83d\udde1\ufe0f", mostOrbs: "\ud83d\udd2e", longestStreak: "\ud83d\udd25", mostDamage: "\ud83d\udca5" };
            html += '<div class="mvp-section">';
            html += '<div class="mvp-title">\u2b50 MVP AWARDS \u2b50</div>';
            data.mvpAwards.forEach(function(award) {
              var icon = mvpIcons[award.category] || "\ud83c\udfc6";
              var isMe = award.player === loggedInUsername;
              html += '<div class="mvp-award' + (isMe ? ' mvp-me' : '') + '">';
              html += '<span class="mvp-icon">' + icon + '</span>';
              html += '<span class="mvp-label">' + esc(award.label) + '</span>';
              html += '<span class="mvp-player">' + esc(award.player) + '</span>';
              html += '<span class="mvp-value">' + award.value + '</span>';
              html += '</div>';
            });
            html += '</div>';
          }

          // Scoreboard
          html += '<div class="round-end-scores">';
          html += data.scoreboard.map(function(s, i) {
            var isMe = s.username === loggedInUsername;
            var isWinner = i === 0;
            var cls = "round-end-row" + (isWinner ? " winner" : "") + (isMe ? " me" : "");
            var medal = i < 3 ? medals[i] : (i + 1) + ".";
            return '<div class="' + cls + '"><span>' + medal + " " + esc(s.username) + '</span><span>\u2b50' + s.score + ' | ' + s.kills + 'K/' + s.deaths + 'D</span></div>';
          }).join("");
          html += '</div>';
          sbEl.innerHTML = html;
        }

        var countdownEl = document.getElementById("roundEndCountdown");
        var restartSec = Math.ceil((data.restartDelay || 10000) / 1000);
        function tickCountdown() {
          if (restartSec > 0) {
            countdownEl.textContent = "Next round in " + restartSec + "s...";
            restartSec--;
            setTimeout(tickCountdown, 1000);
          }
        }
        tickCountdown();

        // Play win/lose sound
        var localP = players.find(function(p) { return p.id === playerId; });
        if (localP && localP.username === data.winnerName) {
          playSound("match-win/match-win-" + data.audioIndex, 0.6);
        } else {
          playSound("match-lose/match-lose-" + data.audioIndex, 0.6);
        }
      }
      // Hide death overlay if shown
      var deathOv = document.getElementById("deathOverlay");
      if (deathOv) deathOv.style.display = "none";
      return;
    }

    // ===== ROUND START (new round) =====
    if (data.type === "roundStart") {
      roundEnded = false;

      // Hide round end overlay
      var roundOv = document.getElementById("roundEndOverlay");
      if (roundOv) roundOv.style.display = "none";
      // Hide death overlay
      var deathOv2 = document.getElementById("deathOverlay");
      if (deathOv2) deathOv2.style.display = "none";

      // Reset game state for new round
      obstacles = data.obstacles || [];
      orbs = (data.orbs || []).map(function(o) {
        if (Array.isArray(o)) return { id: o[0], x: o[1], y: o[2] };
        return o;
      });
      bullets = [];
      pickups = [];
      lootCrates = [];
      explosions = [];
      bloodParticles = [];
      bloodStains = [];
      muzzleFlashes = [];
      knifeSlashes = [];
      shellCasings = [];
      impactSparks = [];
      dustClouds = [];
      hitMarkers = [];
      damageIndicators = [];
      activeBombs = [];
      activeLightnings = [];
      killEffects = [];
      deathAnimations = [];
      flashbangOverlay = { alpha: 0, flicker: 0, flickerVal: 0 };
      previousBulletPositions.clear();
      screenShake = { intensity: 0, decay: 0.92 };
      killFeedEntries = [];
      killFeedDirty = true;
      obstacleCanvasDirty = true;
      _cachedDOM = null;
      previousPlayerStates.clear();
      floatingNumbers = [];
      lowHPPulseTime = 0;
      arenaZone = null;
      roundTimeRemaining = 300;
      playerEmotes = {};

      if (data.arenaWidth) GAME_CONFIG.ARENA_WIDTH = data.arenaWidth;
      if (data.arenaHeight) GAME_CONFIG.ARENA_HEIGHT = data.arenaHeight;
      if (data.maxHp) maxHp = data.maxHp;

      // Update shortId map
      if (data.shortIdMap) {
        shortIdMap = {};
        for (var key in data.shortIdMap) {
          shortIdMap[Number(key)] = data.shortIdMap[key];
        }
      }

      // Set local player position
      predictedX = data.playerX;
      predictedY = data.playerY;

      resizeCanvas();
      playSound("matchstart", 0.5);
      showToast("\ud83d\udd04 NEW ROUND! \ud83d\udd04", "#ffcc00");
      return;
    }
  };

  ws.onerror = function(error) {
    console.error("WebSocket error:", error);
  };

  ws.onclose = function() {
    console.log("WebSocket closed");
    ws = null;
    // Show start screen again
    showStartScreen();
    // Reconnect after delay
    setTimeout(connect, 3000);
  };
}

// ===== JOIN GAME =====

function doJoin() {
  const usernameInput = document.getElementById("username");
  const playBtn = document.getElementById("playBtn");
  const errorEl = document.getElementById("usernameError");

  const trimmed = (usernameInput.value || "").trim();
  const usernamePattern = /^[a-zA-Z0-9_]+$/;

  if (!trimmed) {
    errorEl.textContent = "⚠ Enter a name!";
    errorEl.style.display = "block";
    return;
  }
  if (trimmed.length < 2 || trimmed.length > 16) {
    errorEl.textContent = "⚠ Name must be 2-16 characters.";
    errorEl.style.display = "block";
    return;
  }
  if (!usernamePattern.test(trimmed)) {
    errorEl.textContent = "⚠ Only letters, numbers and underscore allowed.";
    errorEl.style.display = "block";
    return;
  }
  errorEl.style.display = "none";

  playBtn.disabled = true;
  playBtn.style.opacity = "0.6";
  playBtn.textContent = "Connecting...";

  loggedInUsername = trimmed;

  // Send join directly via WebSocket (no registration needed)
  function sendJoin() {
    ws.send(serialize({ type: "join", username: trimmed, skin: selectedSkin }));
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    sendJoin();
  } else {
    connect();
    const waitForOpen = setInterval(function() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(waitForOpen);
        sendJoin();
      }
    }, 100);
    setTimeout(function() { clearInterval(waitForOpen); }, 10000);
  }
}

// ===== RESPAWN =====

function doRespawn() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(serialize({ type: "requestRespawn" }));
}

// On page load: connect WebSocket + listen for Enter
(function init() {
  connect();

  // Restore last used username from localStorage (convenience, not auth)
  try {
    const saved = localStorage.getItem("dm_username");
    if (saved) {
      const usernameInput = document.getElementById("username");
      if (usernameInput) usernameInput.value = saved;
    }
  } catch { /* private browsing */ }

  // Listen for Enter key on username input
  const usernameInput = document.getElementById("username");
  if (usernameInput) {
    usernameInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") doJoin();
    });
  }
})();

// ===== HUD DISPLAY =====
// HUD removed — score/ammo now rendered on canvas above player.
// updateShotUI is kept as a no-op for any callers.

let lastShotUIUpdate = 0;
function updateShotUI() {
  // No-op: HUD elements removed. Info is drawn on canvas directly.
}

// ===== INPUT =====

const keysPressed = new Set();

document.addEventListener("keydown", (e) => {
  if (!ws || !gameReady || roundEnded) return;

  // Tab to show scoreboard (only needed on small screens; large screens always show it)
  if (e.key === "Tab") {
    e.preventDefault();
    if (window.innerWidth <= 1200) {
      const pl = document.getElementById("playerList");
      if (pl) pl.style.display = "block";
    }
    return;
  }

  // Spacebar to shoot (same as mouse click)
  if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    isMouseDown = true;
    return;
  }

  // Prevent duplicate events — use e.code (Shift-invariant) to avoid stuck keys
  const keyCode = e.code || e.key;
  if (keysPressed.has(keyCode)) return;
  keysPressed.add(keyCode);

  // Map arrow keys to WASD (and prevent default to stop page scrolling in-game)
  // Normalize to lowercase so Shift+D ("D") still maps to "d"
  let mappedKey = e.key.toLowerCase();
  if (e.code === "ArrowUp" || e.key === "ArrowUp") { mappedKey = "w"; e.preventDefault(); }
  if (e.code === "ArrowDown" || e.key === "ArrowDown") { mappedKey = "s"; e.preventDefault(); }
  if (e.code === "ArrowLeft" || e.key === "ArrowLeft") { mappedKey = "a"; e.preventDefault(); }
  if (e.code === "ArrowRight" || e.key === "ArrowRight") { mappedKey = "d"; e.preventDefault(); }

  // Q key to cycle weapons
  if (mappedKey === "q") {
    ws.send(serialize({ type: "switchWeapon" }));
    return;
  }

  // Number keys 1-3 to select weapon directly
  if (e.key >= "1" && e.key <= "3") {
    const weapons = ["machinegun", "shotgun", "sniper"];
    const weaponIndex = parseInt(e.key) - 1;
    ws.send(serialize({ type: "switchWeapon", weapon: weapons[weaponIndex] }));
    return;
  }

  // R key to manually reload
  if (mappedKey === "r") {
    ws.send(serialize({ type: "reload" }));
    return;
  }

  // T key for emote wheel
  if (mappedKey === "t") {
    showEmoteWheel();
    return;
  }

  // Shift or Z key to dash
  if (e.key === "Shift" || e.code === "KeyZ") {
    e.preventDefault();
    if (Date.now() >= dashCooldownUntil) {
      ws.send(serialize({ type: "dash" }));
      dashCooldownUntil = Date.now() + 1000; // mirror server cooldown (1s)
      // Create dash trail for local player
      const localP = players.find((p) => p.id === playerId);
      if (localP) {
        for (let i = 0; i < 5; i++) {
          dashTrails.push({
            x: predictedX + (Math.random() - 0.5) * 6,
            y: predictedY + (Math.random() - 0.5) * 6,
            alpha: 0.7,
            skin: localP.skin || 0,
          });
        }
      }
    }
    return;
  }

  if (
    mappedKey === "w" ||
    mappedKey === "a" ||
    mappedKey === "s" ||
    mappedKey === "d"
  ) {
    inputSequence++;

    // Update current keys state
    currentKeys[mappedKey] = true;

    const input = {
      type: "keydown",
      key: mappedKey,
      sequence: inputSequence,
      timestamp: Date.now(),
    };

    ws.send(serialize(input));

    // Store for reconciliation
    pendingInputs.push({
      sequence: inputSequence,
      keys: { ...currentKeys }, // Copy current key state
      timestamp: Date.now(),
    });

    // Predict immediately
    const player = players.find((p) => p.id === playerId);
    if (player) {
      const predicted = applyInput(
        predictedX,
        predictedY,
        currentKeys,
        player.weapon,
        player.speedBoosted,
      );
      predictedX = predicted.x;
      predictedY = predicted.y;
    }
  }

});

document.addEventListener("keyup", (e) => {
  // Tab release hides scoreboard (only on small screens)
  if (e.key === "Tab") {
    e.preventDefault();
    if (window.innerWidth <= 1200) {
      const pl = document.getElementById("playerList");
      if (pl) pl.style.display = "none";
    }
    return;
  }

  if (e.key === " " || e.code === "Space") {
    isMouseDown = false;
    return;
  }

  // Use e.code (Shift-invariant) to match the keydown entry
  const keyCode = e.code || e.key;
  keysPressed.delete(keyCode);

  // Map arrow keys to WASD, normalize to lowercase
  let mappedKey = e.key.toLowerCase();
  if (e.code === "ArrowUp" || e.key === "ArrowUp") mappedKey = "w";
  if (e.code === "ArrowDown" || e.key === "ArrowDown") mappedKey = "s";
  if (e.code === "ArrowLeft" || e.key === "ArrowLeft") mappedKey = "a";
  if (e.code === "ArrowRight" || e.key === "ArrowRight") mappedKey = "d";

  if (
    mappedKey === "w" ||
    mappedKey === "a" ||
    mappedKey === "s" ||
    mappedKey === "d"
  ) {
    // Always release the key locally — prevents stuck movement when WS drops
    currentKeys[mappedKey] = false;

    if (!ws || !gameReady) return;

    inputSequence++;

    const input = {
      type: "keyup",
      key: mappedKey,
      sequence: inputSequence,
      timestamp: Date.now(),
    };

    ws.send(serialize(input));

    // Store for reconciliation
    pendingInputs.push({
      sequence: inputSequence,
      keys: { ...currentKeys }, // Copy current key state
      timestamp: Date.now(),
    });

    // Predict immediately
    const player = players.find((p) => p.id === playerId);
    if (player) {
      const predicted = applyInput(
        predictedX,
        predictedY,
        currentKeys,
        player.weapon,
        player.speedBoosted,
      );
      predictedX = predicted.x;
      predictedY = predicted.y;
    }
  }
});

// ===== WINDOW FOCUS LOSS — RELEASE ALL KEYS =====
// Fixes the stuck-movement bug: if the window loses focus while a key is held,
// keyup never fires. We detect blur / visibility-change and release everything.

function releaseAllKeys() {
  // Always clear local state first — prevents stuck keys/shooting even if WS is down
  keysPressed.clear();
  isMouseDown = false;
  for (const key of ["w", "a", "s", "d"]) {
    if (currentKeys[key]) {
      currentKeys[key] = false;
      if (ws && gameReady) {
        inputSequence++;
        ws.send(serialize({ type: "keyup", key, sequence: inputSequence, timestamp: Date.now() }));
        pendingInputs.push({ sequence: inputSequence, keys: { ...currentKeys }, timestamp: Date.now() });
      }
    }
  }
}

window.addEventListener("blur", releaseAllKeys);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseAllKeys();
});

// ===== MOBILE TOUCH CONTROLS =====

const isTouchDevice = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
let joystickActive = false;
let joystickTouchId = null;
let joystickCenterX = 0;
let joystickCenterY = 0;
const JOYSTICK_MAX_RADIUS = 55;
const AIM_ASSIST_ANGLE = 0.35; // ~20 degrees snap cone

// Find nearest enemy within an angle threshold of the aim direction
function getAimAssistAngle(aimAngle) {
  if (!players || !playerId) return aimAngle;
  const localP = players.find((p) => p.id === playerId);
  if (!localP) return aimAngle;

  let bestAngle = aimAngle;
  let bestDist = Infinity;

  for (const p of players) {
    if (p.id === playerId || p.hp <= 0) continue;
    const dx = p.x - predictedX;
    const dy = p.y - predictedY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 10 || dist > 500) continue; // ignore very close or very far

    const enemyAngle = Math.atan2(dy, dx);
    let diff = enemyAngle - aimAngle;
    // Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    if (Math.abs(diff) < AIM_ASSIST_ANGLE && dist < bestDist) {
      bestDist = dist;
      bestAngle = enemyAngle;
    }
  }
  return bestAngle;
}

function initMobileControls() {
  const mobileControls = document.getElementById("mobileControls");
  if (!mobileControls) return;
  if (!isTouchDevice) return;

  mobileControls.classList.add("active");

  const joystickArea = document.getElementById("joystickArea");
  const joystickThumb = document.getElementById("joystickThumb");
  const joystickBase = document.getElementById("joystickBase");
  const weaponBtn = document.getElementById("touchWeaponBtn");
  const reloadBtn = document.getElementById("touchReloadBtn");

  // Joystick touch handling — dynamic center on touch start
  joystickArea.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (joystickTouchId !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    // Center the joystick at the touch point for ergonomic reach
    const rect = joystickArea.getBoundingClientRect();
    joystickCenterX = touch.clientX;
    joystickCenterY = touch.clientY;
    // Clamp center so the base stays within the area
    const baseR = 70; // half of base size
    joystickCenterX = Math.max(rect.left + baseR, Math.min(rect.right - baseR, joystickCenterX));
    joystickCenterY = Math.max(rect.top + baseR, Math.min(rect.bottom - baseR, joystickCenterY));
    // Move the visual base to the touch point
    joystickBase.style.left = (joystickCenterX - rect.left - baseR) + "px";
    joystickBase.style.top = (joystickCenterY - rect.top - baseR) + "px";
    joystickBase.style.bottom = "auto";
    joystickActive = true;
    joystickThumb.classList.add("active");
    updateJoystick(touch.clientX, touch.clientY);
  }, { passive: false });

  joystickArea.addEventListener("touchmove", (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickTouchId) {
        updateJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }, { passive: false });

  const endJoystick = (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickTouchId) {
        joystickTouchId = null;
        joystickActive = false;
        joystickThumb.classList.remove("active");
        // Reset thumb to center
        joystickThumb.style.left = "50%";
        joystickThumb.style.top = "50%";
        joystickThumb.style.transform = "translate(-50%, -50%)";
        // Release all movement keys
        releaseAllMoveKeys();
        break;
      }
    }
  };

  joystickArea.addEventListener("touchend", endJoystick);
  joystickArea.addEventListener("touchcancel", endJoystick);

  function updateJoystick(touchX, touchY) {
    let dx = touchX - joystickCenterX;
    let dy = touchY - joystickCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > JOYSTICK_MAX_RADIUS) {
      dx = (dx / dist) * JOYSTICK_MAX_RADIUS;
      dy = (dy / dist) * JOYSTICK_MAX_RADIUS;
    }
    // Update thumb visual position (offset from center)
    joystickThumb.style.left = "calc(50% + " + dx + "px)";
    joystickThumb.style.top = "calc(50% + " + dy + "px)";
    joystickThumb.style.transform = "translate(-50%, -50%)";

    // Map to WASD with deadzone
    const deadzone = 15;
    const newKeys = { w: false, a: false, s: false, d: false };
    if (dy < -deadzone) newKeys.w = true;
    if (dy > deadzone) newKeys.s = true;
    if (dx < -deadzone) newKeys.a = true;
    if (dx > deadzone) newKeys.d = true;

    // Send key changes to server
    applyMobileKeys(newKeys);
  }

  // Right-side aim joystick — aims + auto-fires while touched (with aim assist)
  const aimArea = document.getElementById("aimJoystickArea");
  const aimBase = document.getElementById("aimJoystickBase");
  const aimThumb = document.getElementById("aimJoystickThumb");
  let aimTouchId = null;
  let aimCenterX = 0;
  let aimCenterY = 0;
  const AIM_JOYSTICK_MAX = 55;

  aimArea.addEventListener("touchstart", (e) => {
    e.preventDefault();
    initAudio();
    if (aimTouchId !== null) return;
    const touch = e.changedTouches[0];
    aimTouchId = touch.identifier;
    // Dynamic center for aim joystick
    const rect = aimArea.getBoundingClientRect();
    aimCenterX = touch.clientX;
    aimCenterY = touch.clientY;
    const baseR = 70;
    aimCenterX = Math.max(rect.left + baseR, Math.min(rect.right - baseR, aimCenterX));
    aimCenterY = Math.max(rect.top + baseR, Math.min(rect.bottom - baseR, aimCenterY));
    aimBase.style.right = "auto";
    aimBase.style.bottom = "auto";
    aimBase.style.left = (aimCenterX - rect.left - baseR) + "px";
    aimBase.style.top = (aimCenterY - rect.top - baseR) + "px";
    aimThumb.classList.add("active");
    isMouseDown = true; // Start firing
    updateAimJoystick(touch.clientX, touch.clientY);
  }, { passive: false });

  aimArea.addEventListener("touchmove", (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier === aimTouchId) {
        updateAimJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }, { passive: false });

  const endAim = (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === aimTouchId) {
        aimTouchId = null;
        aimThumb.classList.remove("active");
        aimThumb.classList.remove("aim-assisted");
        aimThumb.style.left = "50%";
        aimThumb.style.top = "50%";
        aimThumb.style.transform = "translate(-50%, -50%)";
        isMouseDown = false; // Stop firing
        break;
      }
    }
  };
  aimArea.addEventListener("touchend", endAim);
  aimArea.addEventListener("touchcancel", endAim);

  function updateAimJoystick(touchX, touchY) {
    let dx = touchX - aimCenterX;
    let dy = touchY - aimCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > AIM_JOYSTICK_MAX) {
      dx = (dx / dist) * AIM_JOYSTICK_MAX;
      dy = (dy / dist) * AIM_JOYSTICK_MAX;
    }
    // Update thumb visual
    aimThumb.style.left = "calc(50% + " + dx + "px)";
    aimThumb.style.top = "calc(50% + " + dy + "px)";
    aimThumb.style.transform = "translate(-50%, -50%)";

    // Convert joystick direction to aim angle (only if moved past deadzone)
    const deadzone = 8;
    if (dist > deadzone) {
      let aimAngle = Math.atan2(dy, dx);

      // Apply aim assist — snap to nearest enemy if close to aim direction
      const assistedAngle = getAimAssistAngle(aimAngle);
      const wasAssisted = assistedAngle !== aimAngle;
      aimAngle = assistedAngle;

      // Visual feedback for aim assist
      if (wasAssisted) {
        aimThumb.classList.add("aim-assisted");
      } else {
        aimThumb.classList.remove("aim-assisted");
      }

      // Project aim far from player so the crosshair is in the right direction
      const aimDist = 300;
      mouseX = predictedX + Math.cos(aimAngle) * aimDist;
      mouseY = predictedY + Math.sin(aimAngle) * aimDist;

      // Send aim angle to server
      if (ws && playerId && gameReady) {
        ws.send(serialize({ type: "aim", aimAngle }));
      }
    }
  }

  // Weapon switch button
  weaponBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    weaponBtn.classList.add("pressed");
    if (ws && gameReady) {
      ws.send(serialize({ type: "switchWeapon" }));
    }
    setTimeout(() => weaponBtn.classList.remove("pressed"), 150);
  }, { passive: false });

  // Reload button
  reloadBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    reloadBtn.classList.add("pressed");
    if (ws && gameReady) {
      ws.send(serialize({ type: "reload" }));
    }
    setTimeout(() => reloadBtn.classList.remove("pressed"), 150);
  }, { passive: false });
}

// Track which mobile keys are currently pressed to send only changes
const mobileKeys = { w: false, a: false, s: false, d: false };

function applyMobileKeys(newKeys) {
  if (!ws || !gameReady) return;

  for (const key of ["w", "a", "s", "d"]) {
    if (newKeys[key] !== mobileKeys[key]) {
      mobileKeys[key] = newKeys[key];
      inputSequence++;

      currentKeys[key] = newKeys[key];

      const input = {
        type: newKeys[key] ? "keydown" : "keyup",
        key: key,
        sequence: inputSequence,
        timestamp: Date.now(),
      };
      ws.send(serialize(input));

      pendingInputs.push({
        sequence: inputSequence,
        keys: { ...currentKeys },
        timestamp: Date.now(),
      });

      const player = players.find((p) => p.id === playerId);
      if (player) {
        const predicted = applyInput(
          predictedX,
          predictedY,
          currentKeys,
          player.weapon,
          player.speedBoosted,
        );
        predictedX = predicted.x;
        predictedY = predicted.y;
      }
    }
  }
}

function releaseAllMoveKeys() {
  applyMobileKeys({ w: false, a: false, s: false, d: false });
}

// Initialize mobile controls on page load
if (isTouchDevice) {
  // Prevent double-tap zoom and pull-to-refresh on mobile
  document.addEventListener("touchmove", (e) => {
    if (gameReady) e.preventDefault();
  }, { passive: false });
}

// ===== KILL FEED =====

function addKillFeedEntry(killer, victim, weapon) {
  const icon = weapon === "streak" ? "🔥" : weapon === "zone" ? "🔴" : weapon === "bomb" ? "💣" : weapon === "lightning" ? "⚡" : (WEAPON_KILL_ICONS[weapon] || "💀");
  const entry = { killer, victim, icon, timestamp: Date.now() };
  killFeedEntries.push(entry);
  if (killFeedEntries.length > KILL_FEED_MAX) killFeedEntries.shift();
  killFeedDirty = true;
  renderKillFeed();
}

let lastKillFeedRender = 0;
function renderKillFeed() {
  const now = Date.now();
  if (now - lastKillFeedRender < 250) return;
  lastKillFeedRender = now;

  const container = getCachedDOM().killFeed;
  if (!container) return;
  const prevLen = killFeedEntries.length;
  killFeedEntries = killFeedEntries.filter(
    (e) => now - e.timestamp < KILL_FEED_DURATION,
  );
  const entriesChanged = killFeedEntries.length !== prevLen;

  // Only rebuild if entries changed
  if (!killFeedDirty && !entriesChanged) return;
  killFeedDirty = false;

  const newHTML = killFeedEntries
    .map((e) => {
      const age = now - e.timestamp;
      const opacity =
        age > KILL_FEED_DURATION - 500
          ? Math.max(0, (KILL_FEED_DURATION - age) / 500)
          : 1;
      const isStreak = e.icon === "🔥";
      if (isStreak) {
        return (
          `<div class="kill-entry streak-entry" style="opacity:${opacity}">` +
          `<span class="streak-text">🔥 ${esc(e.killer)}: ${esc(e.victim)}</span></div>`
        );
      }
      return (
        `<div class="kill-entry" style="opacity:${opacity}">` +
        `<span class="killer">${esc(e.killer)}</span>` +
        `<span class="weapon-icon">${e.icon}</span>` +
        `<span class="victim">${esc(e.victim)}</span></div>`
      );
    })
    .join("");

  container.innerHTML = newHTML;
}

// ===== TOAST NOTIFICATIONS =====

let activeToasts = [];
let toastSlotCounter = 0;

function showToast(text, color) {
  const toast = document.createElement("div");
  toast.textContent = text;

  // Stack toasts vertically so they don't overlap
  const slot = toastSlotCounter++;
  const yOffset = 35 + (activeToasts.length * 50);

  // Pick a random entrance animation
  const animations = ["toastSlideUp", "toastBounce"];
  const anim = animations[Math.floor(Math.random() * animations.length)];

  toast.style.cssText = `
    position: fixed;
    top: ${yOffset}px;
    left: 50%;
    transform: translate(-50%, 0) scale(0.8);
    color: ${color || "#f0f0f0"};
    font-family: 'Rajdhani', sans-serif;
    font-size: 26px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    text-shadow: 0 0 20px ${color || "#f0f0f0"}44, 0 2px 4px rgba(0,0,0,0.8);
    z-index: 1050;
    pointer-events: none;
    opacity: 0;
    white-space: nowrap;
    animation: ${anim} 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  `;
  document.body.appendChild(toast);
  activeToasts.push(toast);

  // Shake effect after entering for kill/death toasts
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = `toastShake 0.4s ease-out`;
      toast.style.opacity = "0.55";
    }
  }, 600);

  // Animate out
  setTimeout(() => {
    toast.style.animation = `toastSlideOut 0.5s cubic-bezier(0.55, 0, 1, 0.45) forwards`;
    setTimeout(() => {
      toast.remove();
      activeToasts = activeToasts.filter((t) => t !== toast);
    }, 500);
  }, 2200);
}

// ===== REVENGE ANIMATION =====
function showRevengeAnimation() {
  // Screen flash
  var flash = document.createElement("div");
  flash.style.cssText = "position:fixed;inset:0;background:rgba(255,68,0,0.3);z-index:1100;pointer-events:none;animation:revengeFlash 0.6s ease-out forwards;";
  document.body.appendChild(flash);
  setTimeout(function() { flash.remove(); }, 700);

  // Big centered text
  var revenge = document.createElement("div");
  revenge.innerHTML = "\ud83d\udd25 REVENGE! \ud83d\udd25";
  revenge.style.cssText = [
    "position:fixed;top:50%;left:50%;z-index:1150;pointer-events:none;",
    "transform:translate(-50%,-50%) scale(0);",
    "font-family:'Rajdhani',sans-serif;font-size:72px;font-weight:900;",
    "color:#ff4400;text-transform:uppercase;letter-spacing:6px;",
    "text-shadow:0 0 40px rgba(255,68,0,0.8),0 0 80px rgba(255,68,0,0.4),0 4px 12px rgba(0,0,0,0.8);",
    "animation:revengeSlam 0.6s cubic-bezier(0.16,1,0.3,1) forwards;",
    "white-space:nowrap;"
  ].join("");
  document.body.appendChild(revenge);

  // Shake effect
  setTimeout(function() {
    if (revenge.parentNode) {
      revenge.style.animation = "revengeShake 0.5s ease-out";
      revenge.style.transform = "translate(-50%,-50%) scale(1)";
      revenge.style.opacity = "1";
    }
  }, 650);

  // Fade out
  setTimeout(function() {
    if (revenge.parentNode) {
      revenge.style.transition = "opacity 0.5s ease-out, transform 0.5s ease-out";
      revenge.style.opacity = "0";
      revenge.style.transform = "translate(-50%,-50%) scale(1.3)";
    }
    setTimeout(function() { revenge.remove(); }, 600);
  }, 2000);

  // Trigger screen shake
  if (typeof triggerScreenShake === "function") {
    triggerScreenShake(12);
  }
}

// ===== EMOTE SYSTEM =====
var playerEmotes = {}; // { playerId: { emoji, time } }
var EMOTE_LIST = ["\ud83d\ude02", "\ud83d\udc4f", "\ud83d\udc80", "\ud83d\udd25", "\ud83d\udcaa"];
var EMOTE_DURATION = 2500;

function showEmoteWheel() {
  var existing = document.getElementById("emoteWheel");
  if (existing) { existing.remove(); return; }

  var wheel = document.createElement("div");
  wheel.id = "emoteWheel";
  wheel.style.cssText = [
    "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:1050;",
    "display:flex;gap:8px;padding:10px 16px;",
    "background:rgba(10,15,10,0.9);border:1px solid rgba(74,106,74,0.5);border-radius:8px;",
    "backdrop-filter:blur(8px);animation:screenFadeIn 0.2s ease-out;"
  ].join("");

  EMOTE_LIST.forEach(function(emoji, i) {
    var btn = document.createElement("div");
    btn.textContent = emoji;
    btn.style.cssText = "font-size:32px;cursor:pointer;padding:6px 10px;border-radius:6px;transition:all 0.15s;user-select:none;";
    btn.onmouseenter = function() { btn.style.background = "rgba(255,107,53,0.3)"; btn.style.transform = "scale(1.2)"; };
    btn.onmouseleave = function() { btn.style.background = "transparent"; btn.style.transform = "scale(1)"; };
    btn.onclick = function() {
      if (ws && ws.readyState === 1) {
        ws.send(serialize({ type: "emote", emote: i }));
        // Show locally immediately
        var lp = players.find(function(p) { return p.id === playerId; });
        if (lp) playerEmotes[playerId] = { emoji: emoji, time: Date.now() };
      }
      wheel.remove();
    };
    wheel.appendChild(btn);
  });

  document.body.appendChild(wheel);
  // Auto-close after 3 seconds
  setTimeout(function() { if (wheel.parentNode) wheel.remove(); }, 3000);
}

function renderEmotes(ctx) {
  var now = Date.now();
  for (var pid in playerEmotes) {
    var em = playerEmotes[pid];
    if (now - em.time > EMOTE_DURATION) { delete playerEmotes[pid]; continue; }
    var p = players.find(function(pl) { return pl.id === pid; });
    if (!p || p.hp <= 0) continue;

    var elapsed = now - em.time;
    var alpha = elapsed < 300 ? elapsed / 300 : elapsed > EMOTE_DURATION - 500 ? (EMOTE_DURATION - elapsed) / 500 : 1;
    var bobY = Math.sin(elapsed * 0.003) * 3;
    var sx = p.x;
    var sy = p.y - 45 + bobY;

    ctx.save();
    ctx.globalAlpha = alpha;
    // Bubble background
    ctx.fillStyle = "rgba(10,15,10,0.75)";
    var bx = sx - 20, by = sy - 18, bw = 40, bh = 36, br = 10;
    ctx.beginPath();
    ctx.moveTo(bx + br, by);
    ctx.lineTo(bx + bw - br, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
    ctx.lineTo(bx + bw, by + bh - br);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
    ctx.lineTo(bx + br, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
    ctx.lineTo(bx, by + br);
    ctx.quadraticCurveTo(bx, by, bx + br, by);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(74,106,74,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Emoji
    ctx.font = "24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(em.emoji, sx, sy);
    ctx.restore();
  }
}

// ===== VOLUME CONTROL =====

function initVolumeSlider() {
  const slider = document.getElementById("volumeSlider");
  const label = document.getElementById("volumeLabel");
  const icon = document.getElementById("volumeIcon");
  if (!slider) return;
  slider.value = Math.round(masterVolume * 100);
  if (label) label.textContent = Math.round(masterVolume * 100) + "%";
  if (icon) icon.textContent = masterVolume === 0 ? "🔇" : masterVolume < 0.4 ? "🔉" : "🔊";
  slider.addEventListener("input", () => {
    masterVolume = parseInt(slider.value) / 100;
    try { localStorage.setItem("masterVolume", String(masterVolume)); } catch (_) { /* ignore */ }
    syncVolumeControls();
  });
}

let preMuteVolume = 0.7;
function toggleMute() {
  if (masterVolume > 0) {
    preMuteVolume = masterVolume;
    masterVolume = 0;
  } else {
    masterVolume = preMuteVolume || 0.7;
  }
  try { localStorage.setItem("masterVolume", String(masterVolume)); } catch (_) { /* ignore */ }
  syncVolumeControls();
}

// Initialize volume slider on page load
document.addEventListener("DOMContentLoaded", () => {
  initVolumeSlider();
  // HUD in-game volume slider
  const hudSlider = document.getElementById("hudVolumeSlider");
  if (hudSlider) {
    hudSlider.value = Math.round(masterVolume * 100);
    hudSlider.addEventListener("input", () => {
      masterVolume = parseInt(hudSlider.value) / 100;
      try { localStorage.setItem("masterVolume", String(masterVolume)); } catch (_) { /* ignore */ }
      syncVolumeControls();
    });
  }
});

function syncVolumeControls() {
  const lobbySlider = document.getElementById("volumeSlider");
  const lobbyLabel = document.getElementById("volumeLabel");
  const lobbyIcon = document.getElementById("volumeIcon");
  const hudSlider = document.getElementById("hudVolumeSlider");
  const hudIcon = document.getElementById("hudVolumeIcon");
  const val = Math.round(masterVolume * 100);
  const iconStr = masterVolume === 0 ? "🔇" : masterVolume < 0.4 ? "🔉" : "🔊";
  if (lobbySlider) lobbySlider.value = val;
  if (lobbyLabel) lobbyLabel.textContent = val + "%";
  if (lobbyIcon) lobbyIcon.textContent = iconStr;
  if (hudSlider) hudSlider.value = val;
  if (hudIcon) hudIcon.textContent = iconStr;
}

// ===== SKINS =====

function initSkinSelector() {
  const container = document.getElementById("skinOptions");
  if (!container) return;
  container.innerHTML = SKINS.map((skin, i) => {
    const isSelected = i === selectedSkin;
    return `<div class="skin-option ${isSelected ? "selected" : ""}" style="background: ${skin.primary};" onclick="selectSkin(${i})" title="${skin.name}"></div>`;
  }).join("");
}

function selectSkin(index) {
  selectedSkin = index;
  if (ws) ws.send(serialize({ type: "selectSkin", skin: index }));
  initSkinSelector();
}

// ===== LEADERBOARD =====
// Leaderboard overlay is handled by updateLeaderboardOverlay() in the game loop

// ===== EXPLOSION & PICKUP EFFECTS =====

function playExplosionSound(x, y) {
  const bombIndex = 1 + Math.floor(Math.random() * 5); // 1–5
  const soundName = "bomb-" + bombIndex;
  const rate = 0.9 + Math.random() * 0.2; // slight pitch variation
  playPositionalSound(soundName, x, y, 0.8, rate);
}

function playPickupSound() {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(440, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
}

let pickupEffects = [];

function createPickupEffect(x, y, pickupType) {
  const colors = { health: "#ff4444", ammo: "#44ff44", speed: "#4488ff" };
  const icons = { health: "❤️", ammo: "📦", speed: "⚡" };
  pickupEffects.push({
    x, y,
    color: colors[pickupType] || "#ffffff",
    icon: icons[pickupType] || "✨",
    life: 1.0,
    timestamp: Date.now(),
  });
  if (pickupEffects.length > 20) capInPlace(pickupEffects, 20);
}

function updatePickupEffects() {
  for (let i = 0; i < pickupEffects.length; i++) {
    pickupEffects[i].y -= 0.5;
    pickupEffects[i].life -= 0.015;
  }
  compactInPlace(pickupEffects, (e) => e.life > 0);
}

function renderPickupEffects() {
  pickupEffects.forEach((e) => {
    ctx.globalAlpha = e.life;
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(e.icon, e.x, e.y);
    ctx.textAlign = "start";
    ctx.globalAlpha = 1.0;
  });
}

// ============ ORB RENDERING ============
// Pre-rendered orb sprite — radial gradient created ONCE instead of once per orb per frame.
let _orbSprite = null;
const _ORB_SPRITE_SIZE = 42; // 2 * (orbRadius 13 + glowRing 8)

function _ensureOrbSprite() {
  if (_orbSprite) return;
  _orbSprite = document.createElement("canvas");
  _orbSprite.width = _ORB_SPRITE_SIZE;
  _orbSprite.height = _ORB_SPRITE_SIZE;
  const oc = _orbSprite.getContext("2d");
  const c = _ORB_SPRITE_SIZE / 2; // centre = 21
  const r = 13;
  // Outer glow ring
  oc.globalAlpha = 0.3;
  oc.fillStyle = "#00ffcc";
  oc.beginPath();
  oc.arc(c, c, r + 8, 0, Math.PI * 2);
  oc.fill();
  // Inner orb with radial gradient (built once)
  oc.globalAlpha = 0.9;
  const g = oc.createRadialGradient(c, c, 0, c, c, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.4, "#66ffdd");
  g.addColorStop(1, "#00cc99");
  oc.fillStyle = g;
  oc.beginPath();
  oc.arc(c, c, r, 0, Math.PI * 2);
  oc.fill();
}

function renderOrbs() {
  if (orbs.length === 0) return;
  _ensureOrbSprite();
  const now = Date.now();
  for (let i = 0; i < orbs.length; i++) {
    const orb = orbs[i];
    if (!isOnScreen(orb.x, orb.y)) continue;
    const pulse = 0.7 + 0.3 * Math.sin(now * 0.004 + orb.x * 0.1 + orb.y * 0.1);
    const sz = _ORB_SPRITE_SIZE * pulse;
    ctx.drawImage(_orbSprite, orb.x - sz * 0.5, orb.y - sz * 0.5, sz, sz);
  }
}

function renderPickups() {
  const pickupColors = {
    health: "#ff4444", ammo: "#44bb44", speed: "#4488ff",
    shield: "#44ddff", invisibility: "#aa66ff", regen: "#44ff88", armor: "#ddaa22",
  };
  const pickupIcons = {
    health: "+", ammo: "A", speed: "S",
    shield: "🛡", invisibility: "👻", regen: "♥", armor: "V",
  };
  const now = Date.now();

  pickups.forEach((pk) => {
    const color = pickupColors[pk.type] || "#ffffff";
    const icon = pickupIcons[pk.type] || "?";

    // Floating animation
    const floatY = Math.sin(now / 400 + pk.x) * 3;

    // Glow
    ctx.globalAlpha = 0.2 + Math.sin(now / 300) * 0.1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + floatY, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Pickup body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + floatY, 16, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + floatY, 16, 0, Math.PI * 2);
    ctx.stroke();

    // Icon
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 17px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, pk.x, pk.y + floatY);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  });
}

// ===== LOOT CRATE RENDERING =====

function renderLootCrates() {
  const now = Date.now();
  lootCrates.forEach((crate) => {
    const half = 14;

    // Hit flash effect
    const flashActive = crate.hitFlash && now - crate.hitFlash < 150;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(crate.x - half + 2, crate.y - half + 2, half * 2, half * 2);

    // Crate body
    ctx.fillStyle = flashActive ? "#ffeeaa" : "#8B6914";
    ctx.fillRect(crate.x - half, crate.y - half, half * 2, half * 2);

    // Border
    ctx.strokeStyle = flashActive ? "#fff" : "#5a4010";
    ctx.lineWidth = 2;
    ctx.strokeRect(crate.x - half, crate.y - half, half * 2, half * 2);

    // Cross planks
    ctx.strokeStyle = "#6B5010";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(crate.x - half, crate.y - half);
    ctx.lineTo(crate.x + half, crate.y + half);
    ctx.moveTo(crate.x + half, crate.y - half);
    ctx.lineTo(crate.x - half, crate.y + half);
    ctx.stroke();

    // HP indicator (small circles)
    for (let i = 0; i < crate.hp; i++) {
      ctx.fillStyle = "#44ff44";
      ctx.beginPath();
      ctx.arc(crate.x - 6 + i * 6, crate.y + half + 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // "?" icon
    ctx.fillStyle = "#ffdd44";
    ctx.font = "bold 14px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", crate.x, crate.y);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  });
}

function updateCrateDestroyEffects() {
  const now = Date.now();
  compactInPlace(crateDestroyEffects, (e) => now - e.time < 500);
}

function renderCrateDestroyEffects() {
  const now = Date.now();
  crateDestroyEffects.forEach((e) => {
    const t = (now - e.time) / 500;
    const alpha = 1 - t;
    // Expanding ring
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = "#ddaa22";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 10 + t * 30, 0, Math.PI * 2);
    ctx.stroke();

    // Wood splinters
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const dist = t * 25;
      const sx = e.x + Math.cos(angle) * dist;
      const sy = e.y + Math.sin(angle) * dist;
      ctx.fillStyle = "#8B6914";
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillRect(sx - 2, sy - 2, 4, 4);
    }
    ctx.globalAlpha = 1.0;
  });
}

// ===== DASH TRAIL RENDERING =====

function updateDashTrails() {
  for (let i = dashTrails.length - 1; i >= 0; i--) {
    dashTrails[i].alpha -= 0.04;
    if (dashTrails[i].alpha <= 0) {
      dashTrails.splice(i, 1);
    }
  }
}

function renderDashTrails() {
  dashTrails.forEach((trail) => {
    const skin = SKINS[trail.skin] || SKINS[0];
    ctx.globalAlpha = trail.alpha * 0.5;
    ctx.fillStyle = skin.primary;
    ctx.beginPath();
    ctx.arc(trail.x, trail.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  });
}

// ===== BOMB SYSTEM =====

function renderBombs() {
  const now = Date.now();
  activeBombs.forEach((bomb) => {
    const elapsed = now - bomb.spawnTime;
    const fuseProgress = Math.min(elapsed / 1000, 1); // 1 second fuse

    // Pulsing danger radius (grows as fuse progresses)
    const pulseSpeed = 6 + fuseProgress * 14; // Pulse faster near explosion
    const pulse = Math.sin(now / (1000 / pulseSpeed)) * 0.15 + 0.85;
    const dangerRadius = 80 * fuseProgress * pulse;

    // Danger zone circle
    ctx.globalAlpha = 0.08 + fuseProgress * 0.15;
    ctx.fillStyle = "#ff2200";
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y, dangerRadius, 0, Math.PI * 2);
    ctx.fill();

    // Danger zone border
    ctx.globalAlpha = 0.3 + fuseProgress * 0.5;
    ctx.strokeStyle = "#ff4400";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y, dangerRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bomb body
    ctx.globalAlpha = 1.0;
    const bombSize = 10 + fuseProgress * 3;

    // Bomb shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(bomb.x + 2, bomb.y + 3, bombSize, bombSize * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bomb body (dark sphere)
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y, bombSize, 0, Math.PI * 2);
    ctx.fill();

    // Bomb highlight
    ctx.fillStyle = "#444";
    ctx.beginPath();
    ctx.arc(bomb.x - 3, bomb.y - 3, bombSize * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Fuse spark (blinks faster as time runs out)
    const sparkBlink = Math.sin(now / (60 - fuseProgress * 40)) > 0;
    if (sparkBlink) {
      const sparkX = bomb.x + Math.cos(-Math.PI / 4) * bombSize;
      const sparkY = bomb.y + Math.sin(-Math.PI / 4) * bombSize;

      // Spark glow
      ctx.fillStyle = "rgba(255, 200, 50, 0.6)";
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, 5 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();

      // Spark core
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Warning text
    ctx.globalAlpha = 0.5 + fuseProgress * 0.5;
    ctx.fillStyle = "#ff3300";
    ctx.font = "bold 16px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("💣", bomb.x, bomb.y - bombSize - 8);
    ctx.textAlign = "start";
    ctx.globalAlpha = 1.0;
  });
}

let bombExplosions = [];

function createBombExplosion(x, y, radius) {
  const particles = [];
  const particleCount = 24;

  for (let i = 0; i < particleCount; i++) {
    const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.3;
    const speed = 3 + Math.random() * 5;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      size: 4 + Math.random() * 6,
      color: `hsl(${Math.random() * 40 + 10}, 100%, ${40 + Math.random() * 30}%)`,
    });
  }

  // Add smoke particles
  for (let i = 0; i < 12; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 2;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      size: 8 + Math.random() * 10,
      color: `rgba(80, 70, 60, 0.6)`,
    });
  }

  bombExplosions.push({
    x, y, radius,
    particles: particles,
    frame: 0,
    shockwave: 0,
  });
  capInPlace(bombExplosions, 12);
}

function updateBombExplosions() {
  for (let i = 0; i < bombExplosions.length; i++) {
    const exp = bombExplosions[i];
    exp.frame++;
    exp.shockwave += 8;
    for (let j = 0; j < exp.particles.length; j++) {
      const p = exp.particles[j];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.vx *= 0.97;
      p.life -= 0.02;
    }
  }
  compactInPlace(bombExplosions, (e) => e.particles.some((p) => p.life > 0));
}

function renderBombExplosions() {
  bombExplosions.forEach((exp) => {
    // Shockwave ring
    if (exp.shockwave < exp.radius * 1.5) {
      const alpha = Math.max(0, 1 - exp.shockwave / (exp.radius * 1.5));
      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeStyle = "#ff6600";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, exp.shockwave, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Particles
    exp.particles.forEach((p) => {
      if (p.life <= 0) return;
      ctx.globalAlpha = Math.min(1, p.life * 1.5);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;
  });
}

// ===== LIGHTNING STRIKE SYSTEM =====

let lightningBolts = [];

function createLightningStrike(x, y, radius) {
  // Create bolt segments for visual effect
  const bolts = [];
  const boltCount = 3 + Math.floor(Math.random() * 3);
  for (let b = 0; b < boltCount; b++) {
    const segments = [];
    let sx = x + (Math.random() - 0.5) * radius * 0.4;
    let sy = y - 200; // Start from above
    const targetX = x + (Math.random() - 0.5) * radius * 0.5;
    const targetY = y + (Math.random() - 0.5) * radius * 0.3;
    const steps = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bx = sx + (targetX - sx) * t + (Math.random() - 0.5) * 30 * (1 - t);
      const by = sy + (targetY - sy) * t + (Math.random() - 0.5) * 15;
      segments.push({ x: bx, y: by });
    }
    bolts.push(segments);
  }

  lightningBolts.push({
    x, y, radius,
    bolts,
    timestamp: Date.now(),
    duration: 400,
  });
  capInPlace(lightningBolts, 8);
}

function renderLightningWarnings() {
  const now = Date.now();
  activeLightnings.forEach((lightning) => {
    const elapsed = now - lightning.spawnTime;
    const progress = Math.min(elapsed / lightning.fuseTime, 1);

    // Flickering warning circle that gets brighter
    const flicker = Math.sin(now / 30) * 0.3 + 0.7;
    const urgency = progress * flicker;

    // Warning zone — pulsing electric blue circle
    ctx.globalAlpha = 0.05 + urgency * 0.2;
    ctx.fillStyle = "#88ccff";
    ctx.beginPath();
    ctx.arc(lightning.x, lightning.y, lightning.radius * progress, 0, Math.PI * 2);
    ctx.fill();

    // Warning border — dashed electric ring
    ctx.globalAlpha = 0.4 + urgency * 0.6;
    ctx.strokeStyle = "#55aaff";
    ctx.lineWidth = 2 + progress * 2;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.arc(lightning.x, lightning.y, lightning.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Inner crackling ring
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.globalAlpha = urgency * 0.5 * flicker;
    ctx.beginPath();
    ctx.arc(lightning.x, lightning.y, lightning.radius * 0.5 * progress, 0, Math.PI * 2);
    ctx.stroke();

    // Warning icon
    ctx.globalAlpha = 0.6 + urgency * 0.4;
    ctx.font = "bold 20px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffdd44";
    ctx.fillText("⚡", lightning.x, lightning.y - lightning.radius - 10);
    ctx.textAlign = "start";

    ctx.globalAlpha = 1.0;
  });
}

function renderLightningBolts() {
  const now = Date.now();
  compactInPlace(lightningBolts, (l) => now - l.timestamp < l.duration);

  lightningBolts.forEach((lightning) => {
    const age = now - lightning.timestamp;
    const progress = age / lightning.duration;
    const alpha = Math.max(0, 1 - progress);

    // Flash on ground
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(lightning.x, lightning.y, lightning.radius * (0.5 + progress * 0.5), 0, Math.PI * 2);
    ctx.fill();

    // Electric ground ring
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = "#88ccff";
    ctx.lineWidth = 3 * alpha;
    ctx.beginPath();
    ctx.arc(lightning.x, lightning.y, lightning.radius * progress, 0, Math.PI * 2);
    ctx.stroke();

    // Draw bolt segments
    lightning.bolts.forEach((segments) => {
      ctx.globalAlpha = alpha * (0.6 + Math.random() * 0.4);
      // Outer glow
      ctx.strokeStyle = "#4488ff";
      ctx.lineWidth = 4 * alpha;
      ctx.lineJoin = "round";
      ctx.beginPath();
      segments.forEach((s, i) => {
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();

      // Inner bright core
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * alpha;
      ctx.beginPath();
      segments.forEach((s, i) => {
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    });

    ctx.globalAlpha = 1.0;
  });
}

// Full-page flash effect (covers entire website, not just canvas)
let pageFlashIntensity = 0;
function applyPageFlash(intensity) {
  pageFlashIntensity = Math.max(pageFlashIntensity, Math.min(1, intensity));
  document.body.style.filter = `brightness(${1 + pageFlashIntensity * 3}) saturate(${1 - pageFlashIntensity * 0.5})`;
}
function updatePageFlash() {
  if (pageFlashIntensity > 0) {
    var pfDecay = (flashbangOverlay && flashbangOverlay.pageDecayRate) || 0.006;
    pageFlashIntensity = Math.max(0, pageFlashIntensity - pfDecay);
    if (pageFlashIntensity <= 0 && flashbangOverlay) flashbangOverlay.pageDecayRate = 0;
    if (pageFlashIntensity > 0.01) {
      const flicker = pageFlashIntensity > 0.3 ? (Math.random() - 0.5) * 0.15 : 0;
      const b = 1 + (pageFlashIntensity + flicker) * 3;
      const s = 1 - pageFlashIntensity * 0.5;
      document.body.style.filter = `brightness(${b}) saturate(${s})`;
    } else {
      pageFlashIntensity = 0;
      document.body.style.filter = "";
    }
  }
}

function updateFlashbang() {
  if (flashbangOverlay.alpha > 0) {
    // Use custom decay rate (lightning) or default (~3 seconds)
    var decayRate = flashbangOverlay.decayRate || 0.005;
    flashbangOverlay.alpha = Math.max(0, flashbangOverlay.alpha - decayRate);
    if (flashbangOverlay.alpha <= 0) flashbangOverlay.decayRate = 0;
    // Chaotic flicker when intensity is high
    if (flashbangOverlay.flicker && flashbangOverlay.alpha > 0.2) {
      flashbangOverlay.flickerVal = (Math.random() - 0.5) * 0.2;
    } else {
      flashbangOverlay.flickerVal = 0;
      flashbangOverlay.flicker = 0;
    }
  }
  // Decay full-page flash
  updatePageFlash();
}

function renderFlashbang() {
  if (flashbangOverlay.alpha <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const displayAlpha = Math.min(1, Math.max(0, flashbangOverlay.alpha + (flashbangOverlay.flickerVal || 0)));
  ctx.globalAlpha = displayAlpha;
  // Chaotic color shift when flickering
  if (flashbangOverlay.flicker && flashbangOverlay.alpha > 0.4) {
    const r = 255;
    const g = 240 + Math.floor(Math.random() * 15);
    const b = 220 + Math.floor(Math.random() * 35);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
  } else {
    ctx.fillStyle = "#ffffff";
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

// ===== RENDER LOOP =====

// Pre-render static grid to offscreen canvas for performance
function ensureGridCanvas() {
  if (gridCanvas) return;
  // Create a small tile and use createPattern for efficient rendering
  gridCanvas = document.createElement("canvas");
  const tileSize = 40;
  gridCanvas.width = tileSize;
  gridCanvas.height = tileSize;
  const gc = gridCanvas.getContext("2d");
  gc.fillStyle = "#2a3020";
  gc.fillRect(0, 0, tileSize, tileSize);
  gc.strokeStyle = "rgba(65, 85, 60, 0.35)";
  gc.lineWidth = 0.5;
  gc.beginPath();
  gc.moveTo(0, 0);
  gc.lineTo(0, tileSize);
  gc.stroke();
  gc.beginPath();
  gc.moveTo(0, 0);
  gc.lineTo(tileSize, 0);
  gc.stroke();
}

function ensureObstacleCanvas() {
  // Re-render if dirty or camera moved beyond the padding
  const needsRender = obstacleCanvasDirty ||
    Math.abs(cameraX - obsCanvasCamX) > OBS_CANVAS_PAD * 0.5 ||
    Math.abs(cameraY - obsCanvasCamY) > OBS_CANVAS_PAD * 0.5;
  if (obstacleCanvas && !needsRender) return;

  const cw = GAME_CONFIG.VIEWPORT_WIDTH + OBS_CANVAS_PAD * 2;
  const ch = GAME_CONFIG.VIEWPORT_HEIGHT + OBS_CANVAS_PAD * 2;
  if (!obstacleCanvas) {
    obstacleCanvas = document.createElement("canvas");
    obstacleCanvas.width = cw;
    obstacleCanvas.height = ch;
  } else if (obstacleCanvas.width !== cw || obstacleCanvas.height !== ch) {
    obstacleCanvas.width = cw;
    obstacleCanvas.height = ch;
  }

  // Compute the world region this canvas covers
  const ox = Math.max(0, Math.floor(cameraX - OBS_CANVAS_PAD));
  const oy = Math.max(0, Math.floor(cameraY - OBS_CANVAS_PAD));
  obsCanvasCamX = cameraX;
  obsCanvasCamY = cameraY;

  const oc = obstacleCanvas.getContext("2d");
  oc.clearRect(0, 0, cw, ch);

  // Store origin offset for drawing back to main canvas
  obstacleCanvas._ox = ox;
  obstacleCanvas._oy = oy;

  obstacles.forEach((obstacle) => {
    if (obstacle.destroyed) return;
    // Skip obstacles outside this canvas region
    const rx = obstacle.x - ox;
    const ry = obstacle.y - oy;
    if (rx + obstacle.size < 0 || rx > cw || ry + obstacle.size < 0 || ry > ch) return;

    if (obstacle.type === "tree") {
      oc.fillStyle = "#5a4a2a";
      oc.fillRect(rx + obstacle.size * 0.4, ry + obstacle.size * 0.5, obstacle.size * 0.2, obstacle.size * 0.5);
      oc.fillStyle = "#2a5a2a";
      oc.beginPath();
      oc.arc(rx + obstacle.size * 0.5, ry + obstacle.size * 0.3, obstacle.size * 0.35, 0, Math.PI * 2);
      oc.fill();
      oc.fillStyle = "#2a6a2a";
      oc.beginPath();
      oc.arc(rx + obstacle.size * 0.3, ry + obstacle.size * 0.4, obstacle.size * 0.25, 0, Math.PI * 2);
      oc.fill();
      oc.beginPath();
      oc.arc(rx + obstacle.size * 0.7, ry + obstacle.size * 0.4, obstacle.size * 0.25, 0, Math.PI * 2);
      oc.fill();
    } else {
      oc.fillStyle = "#555545";
      oc.fillRect(rx, ry, obstacle.size, obstacle.size);
      oc.strokeStyle = "#444434";
      oc.lineWidth = 1;
      oc.strokeRect(rx, ry, obstacle.size, obstacle.size);
      oc.strokeStyle = "#666656";
      oc.beginPath();
      oc.moveTo(rx + 2, ry + obstacle.size / 2);
      oc.lineTo(rx + obstacle.size - 2, ry + obstacle.size / 2);
      oc.stroke();
    }
  });
  obstacleCanvasDirty = false;
}

// Update interpolated positions for smooth movement
function updateInterpolation() {
  playerTargets.forEach((target) => {
    // Lerp towards target position
    target.currentX +=
      (target.targetX - target.currentX) * INTERPOLATION_SPEED;
    target.currentY +=
      (target.targetY - target.currentY) * INTERPOLATION_SPEED;
  });
}

// ============ MINIMAP ============
const MINIMAP_SIZE = 180;
const MINIMAP_PADDING = 14;
const MINIMAP_INTERVAL = 100; // ~10 FPS
let _minimapCanvas = null;
let _lastMinimapRender = 0;

function renderMinimap() {
  if (!gameReady) return;
  const framePlayer = _framePlayer;
  if (!framePlayer) return;

  const mx = canvas.width - MINIMAP_SIZE - MINIMAP_PADDING;
  const my = canvas.height - MINIMAP_SIZE - MINIMAP_PADDING;

  // Throttle: only re-render minimap content at ~10 FPS
  const now = performance.now();
  if (now - _lastMinimapRender >= MINIMAP_INTERVAL || !_minimapCanvas) {
    _lastMinimapRender = now;
    if (!_minimapCanvas) {
      _minimapCanvas = document.createElement("canvas");
      _minimapCanvas.width = MINIMAP_SIZE;
      _minimapCanvas.height = MINIMAP_SIZE;
    }
    const mc = _minimapCanvas.getContext("2d");
    _renderMinimapContent(mc, framePlayer);
  }

  // Blit cached minimap to main canvas
  ctx.drawImage(_minimapCanvas, mx, my);
}

function _renderMinimapContent(mc, framePlayer) {
  const scaleX = MINIMAP_SIZE / GAME_CONFIG.ARENA_WIDTH;
  const scaleY = MINIMAP_SIZE / GAME_CONFIG.ARENA_HEIGHT;

  // Background
  mc.save();
  mc.globalAlpha = 0.75;
  mc.fillStyle = "#111118";
  mc.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  mc.globalAlpha = 1;

  // Border
  mc.strokeStyle = "rgba(255,255,255,0.3)";
  mc.lineWidth = 1;
  mc.strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  // Draw obstacles as small dark rectangles
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    mc.fillStyle = "rgba(80,80,80,0.6)";
    mc.fillRect(
      ob.x * scaleX,
      ob.y * scaleY,
      ob.width * scaleX,
      ob.height * scaleY
    );
  }

  // Draw orbs as small cyan dots
  for (let i = 0; i < orbs.length; i++) {
    const orb = orbs[i];
    mc.fillStyle = "#00ffcc";
    mc.beginPath();
    mc.arc(orb.x * scaleX, orb.y * scaleY, 1.5, 0, Math.PI * 2);
    mc.fill();
  }

  // Find crown leader for minimap
  let minimapCrownId = null;
  let minimapMaxScore = 9;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hp > 0 && (players[i].score || 0) > minimapMaxScore) {
      minimapMaxScore = players[i].score;
      minimapCrownId = players[i].id;
    }
  }

  // Draw other players as colored dots
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.id === playerId) continue;
    if (p.hp <= 0) continue;
    if (p.invisible) {
      mc.fillStyle = "rgba(170,102,255,0.4)";
    } else if (minimapCrownId === p.id) {
      mc.fillStyle = "#ffd700";
    } else {
      mc.fillStyle = "#ff4444";
    }
    const dotSize = (minimapCrownId === p.id) ? 4 : 2.5;
    mc.beginPath();
    mc.arc(p.x * scaleX, p.y * scaleY, dotSize, 0, Math.PI * 2);
    mc.fill();
    // Crown marker on minimap for #1 player
    if (minimapCrownId === p.id) {
      mc.fillStyle = "#ffd700";
      mc.font = "10px serif";
      mc.textAlign = "center";
      mc.fillText("👑", p.x * scaleX, p.y * scaleY - 5);
      mc.textAlign = "start";
    }
  }

  // Draw local player as white dot with glow (golden if crown leader)
  const isLocalCrown = (minimapCrownId === playerId);
  mc.fillStyle = isLocalCrown ? "#ffd700" : "#ffffff";
  mc.shadowColor = isLocalCrown ? "#ffd700" : "#ffffff";
  mc.shadowBlur = isLocalCrown ? 6 : 4;
  mc.beginPath();
  mc.arc(predictedX * scaleX, predictedY * scaleY, isLocalCrown ? 4 : 3, 0, Math.PI * 2);
  mc.fill();
  mc.shadowBlur = 0;
  if (isLocalCrown) {
    mc.fillStyle = "#ffd700";
    mc.font = "10px serif";
    mc.textAlign = "center";
    mc.fillText("👑", predictedX * scaleX, predictedY * scaleY - 5);
    mc.textAlign = "start";
  }

  // Draw viewport rectangle
  mc.strokeStyle = "rgba(255,255,255,0.5)";
  mc.lineWidth = 0.5;
  mc.strokeRect(
    cameraX * scaleX,
    cameraY * scaleY,
    GAME_CONFIG.VIEWPORT_WIDTH * scaleX,
    GAME_CONFIG.VIEWPORT_HEIGHT * scaleY
  );

  mc.restore();
}

// Cached local player reference — updated once per render frame
let _framePlayer = null;

function render() {
  const frameNow = Date.now();
  _framePlayer = players.find((p) => p.id === playerId);
  const framePlayer = _framePlayer;

  // Update camera position to follow local player
  if (framePlayer) {
    const targetCamX = predictedX - GAME_CONFIG.VIEWPORT_WIDTH / 2;
    const targetCamY = predictedY - GAME_CONFIG.VIEWPORT_HEIGHT / 2;
    // Clamp camera to arena bounds
    cameraX = Math.max(0, Math.min(GAME_CONFIG.ARENA_WIDTH - GAME_CONFIG.VIEWPORT_WIDTH, targetCamX));
    cameraY = Math.max(0, Math.min(GAME_CONFIG.ARENA_HEIGHT - GAME_CONFIG.VIEWPORT_HEIGHT, targetCamY));
  }

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply camera scale (zoom out to see more)
  ctx.save();
  ctx.scale(CAMERA_SCALE, CAMERA_SCALE);

  // Draw grid background using cached tile pattern
  ensureGridCanvas();
  if (!gridPatternCache) gridPatternCache = ctx.createPattern(gridCanvas, "repeat");
  ctx.save();
  ctx.fillStyle = gridPatternCache;
  // Offset pattern to align with camera
  ctx.translate(-Math.floor(cameraX) % 40, -Math.floor(cameraY) % 40);
  ctx.fillRect(0, 0, GAME_CONFIG.VIEWPORT_WIDTH + 40, GAME_CONFIG.VIEWPORT_HEIGHT + 40);
  ctx.restore();

  // Draw arena boundary (dark outside the arena)
  ctx.save();
  ctx.translate(-Math.floor(cameraX), -Math.floor(cameraY));
  ctx.fillStyle = "#111";
  // Top
  if (cameraY < 0) ctx.fillRect(0, 0, GAME_CONFIG.ARENA_WIDTH, -cameraY);
  // Bottom
  const bottomY = GAME_CONFIG.ARENA_HEIGHT - cameraY;
  if (bottomY < GAME_CONFIG.VIEWPORT_HEIGHT) ctx.fillRect(0, GAME_CONFIG.ARENA_HEIGHT, GAME_CONFIG.ARENA_WIDTH, GAME_CONFIG.VIEWPORT_HEIGHT - bottomY);
  ctx.restore();

  // Screen shake offset
  updateScreenShake();
  const shakeOffset = getScreenShakeOffset();

  // Push camera transform — all world drawing happens in world coordinates
  ctx.save();
  ctx.translate(-Math.floor(cameraX) + shakeOffset.x, -Math.floor(cameraY) + shakeOffset.y);

  // Update interpolation for smooth movement
  updateInterpolation();

  // Update UI and effects
  updateShotUI();
  updateExplosions();
  updateMuzzleFlashes();
  updateShellCasings();
  updateImpactSparks();
  updateDustClouds();
  updatePickupEffects();
  updateHitMarkers();
  updateDamageIndicators();
  updateBombExplosions();
  updateFlashbang();
  updateFloatingNumbers();
  updateKillEffects();
  updateDeathAnimations();
  updateDashTrails();

  // Dust clouds when local player moves
  if (
    framePlayer &&
    framePlayer.hp > 0 &&
    (currentKeys.w || currentKeys.a || currentKeys.s || currentKeys.d)
  ) {
    if (frameNow - lastDustTime > 120) {
      createDustCloud(predictedX, predictedY);
      lastDustTime = frameNow;
    }
  }

  // Try to shoot if mouse is held (hold-to-shoot)
  tryShoot();

  // Render blood stains (on ground, batched by color for performance)
  const bloodColors = ["#7a0000", "#900000", "#550000"];
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = bloodColors[c];
    bloodStains.forEach((stain) => {
      if (stain.color !== c) return;
      ctx.globalAlpha = stain.opacity * 0.7;
      ctx.beginPath();
      ctx.arc(stain.x, stain.y, stain.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1.0;

  // Render arena shrinking zone (danger zone overlay)
  renderZone();

  // Render dust clouds (ground level)
  renderDustClouds();

  // Render obstacles from cached offscreen canvas (viewport-sized, padded)
  ensureObstacleCanvas();
  if (obstacleCanvas) {
    const ox = obstacleCanvas._ox || 0;
    const oy = obstacleCanvas._oy || 0;
    // Compute the overlap between the viewport and the obstacle canvas region
    const srcX = Math.max(0, Math.floor(cameraX) - ox);
    const srcY = Math.max(0, Math.floor(cameraY) - oy);
    const dstX = ox + srcX; // world-space X
    const dstY = oy + srcY; // world-space Y
    const drawW = Math.min(obstacleCanvas.width - srcX, GAME_CONFIG.VIEWPORT_WIDTH + 1);
    const drawH = Math.min(obstacleCanvas.height - srcY, GAME_CONFIG.VIEWPORT_HEIGHT + 1);
    if (drawW > 0 && drawH > 0) {
      ctx.drawImage(obstacleCanvas, srcX, srcY, drawW, drawH, dstX, dstY, drawW, drawH);
    }
  }

  // Render pickups
  renderPickups();
  renderPickupEffects();

  // Render orbs (collectible points like slither.io)
  renderOrbs();

  // Render loot crates
  updateCrateDestroyEffects();
  renderLootCrates();
  renderCrateDestroyEffects();

  // Render bombs
  renderBombs();

  // Render lightning warnings
  renderLightningWarnings();

  // Render dash trails (below players)
  renderDashTrails();

  // Find bounty leader ONCE (player with most kills, minimum 2)
  let bountyLeaderId = null;
  let maxKills = 1;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hp > 0 && players[i].kills > maxKills) {
      maxKills = players[i].kills;
      bountyLeaderId = players[i].id;
    }
  }

  // Find the #1 player by score (crown leader) — minimum 10 pts, must be alive
  let crownLeaderId = null;
  let crownMaxScore = 9;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hp > 0 && (players[i].score || 0) > crownMaxScore) {
      crownMaxScore = players[i].score;
      crownLeaderId = players[i].id;
    }
  }

  players.forEach((p, index) => {
    // Don't render dead players
    if (p.hp <= 0) return;

    let renderX = p.x;
    let renderY = p.y;

    // Use predicted position for local player
    if (p.id === playerId) {
      renderX = predictedX;
      renderY = predictedY;
    } else {
      // Use interpolated position for other players
      const interpolated = playerTargets.get(p.id);
      if (interpolated) {
        renderX = interpolated.currentX;
        renderY = interpolated.currentY;
      }
    }

    // Calculate gun direction
    const gunAngle =
      p.id === playerId
        ? Math.atan2(mouseY - renderY, mouseX - renderX)
        : p.aimAngle || 0;

    // Use skin colors
    const skinIndex = p.skin || 0;
    const skin = SKINS[skinIndex] || SKINS[0];
    const color = skin.primary;
    const darkColor = skin.secondary;

    // Speed boost visual indicator
    if (p.speedBoosted) {
      ctx.strokeStyle = "rgba(68, 136, 255, 0.4)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 24, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Dash visual — fast motion blur ring
    if (p.dashing) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "rgba(255, 255, 100, 0.7)";
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(renderX, renderY, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
      // Create trail particles for other players dashing
      if (p.id !== playerId && Math.random() < 0.5) {
        dashTrails.push({
          x: renderX + (Math.random() - 0.5) * 10,
          y: renderY + (Math.random() - 0.5) * 10,
          alpha: 0.5,
          skin: p.skin || 0,
        });
      }
    }

    // Armor visual — golden outline
    if (p.armor > 0) {
      ctx.strokeStyle = "rgba(221, 170, 34, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 19, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Shield bubble visual
    if (p.shielded) {
      const shieldPulse = 0.3 + Math.sin(Date.now() / 200) * 0.15;
      ctx.strokeStyle = `rgba(100, 200, 255, ${shieldPulse + 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(100, 200, 255, ${shieldPulse * 0.3})`;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 26, 0, Math.PI * 2);
      ctx.fill();
    }

    // Invisibility visual (ghostly fade for others, slight outline for self)
    if (p.invisible && p.id !== playerId) {
      ctx.globalAlpha = 0.05; // Almost fully invisible to others
    } else if (p.invisible && p.id === playerId) {
      ctx.globalAlpha = 0.25; // Semi-transparent for self
    }

    // Health regen aura
    if (p.regen) {
      const regenPulse = 0.3 + Math.sin(Date.now() / 300) * 0.2;
      ctx.fillStyle = `rgba(50, 255, 100, ${regenPulse * 0.2})`;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(50, 255, 100, ${regenPulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 28, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw weapon
    ctx.save();
    ctx.translate(renderX, renderY);
    ctx.rotate(gunAngle);

    if (p.weapon === "machinegun") {
      // Machine gun body
      ctx.fillStyle = "#333";
      ctx.fillRect(4, -2.5, 20, 5);
      // Muzzle
      ctx.fillStyle = "#555";
      ctx.fillRect(24, -3, 5, 6);
      // Magazine
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(10, 2, 6, 5);
      // Stock hint
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(-2, -1.5, 6, 3);
    } else if (p.weapon === "shotgun") {
      // Shotgun body
      ctx.fillStyle = "#3a2a1a";
      ctx.fillRect(4, -3, 20, 6);
      // Double barrel
      ctx.fillStyle = "#444";
      ctx.fillRect(24, -3.5, 5, 3);
      ctx.fillRect(24, 0.5, 5, 3);
      // Stock
      ctx.fillStyle = "#2a1a0a";
      ctx.fillRect(-4, -2.5, 8, 5);
    } else if (p.weapon === "sniper") {
      // Sniper rifle — long barrel
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(4, -2, 30, 4);
      // Scope
      ctx.fillStyle = "#4488ff";
      ctx.fillRect(14, -5, 4, 3);
      // Muzzle
      ctx.fillStyle = "#555";
      ctx.fillRect(34, -1.5, 4, 3);
      // Stock
      ctx.fillStyle = "#3a2a1a";
      ctx.fillRect(-4, -2, 8, 4);
    }

    ctx.restore();

    // Player body - outer ring
    ctx.fillStyle = darkColor;
    ctx.beginPath();
    ctx.arc(renderX, renderY, 16, 0, Math.PI * 2);
    ctx.fill();

    // Player body - inner
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(renderX, renderY, 13, 0, Math.PI * 2);
    ctx.fill();

    // First character initial on the ball
    if (p.username) {
      ctx.font = "bold 14px 'Rajdhani', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(p.username.charAt(0).toUpperCase(), renderX, renderY + 1);
      ctx.textBaseline = "alphabetic";
    }

    // Prominent highlight for local player — pulsing glow ring + arrow
    if (p.id === playerId) {
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300);
      // Outer glow
      ctx.strokeStyle = `rgba(255, 170, 68, ${pulse * 0.4})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 22, 0, Math.PI * 2);
      ctx.stroke();
      // Inner ring
      ctx.strokeStyle = `rgba(255, 200, 80, ${0.5 + pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 20, 0, Math.PI * 2);
      ctx.stroke();
      // Bouncing arrow pointing down at the player
      const bounce = Math.sin(Date.now() / 250) * 3;
      const arrowY = renderY - 42 + bounce;
      ctx.fillStyle = `rgba(255, 200, 80, ${0.7 + pulse * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(renderX, arrowY + 8);
      ctx.lineTo(renderX - 6, arrowY);
      ctx.lineTo(renderX + 6, arrowY);
      ctx.closePath();
      ctx.fill();
    }

    // Health bar above player
    const barWidth = 36;
    const barHeight = 5;
    const barX = renderX - barWidth / 2;
    const barY = renderY - 28;
    const hpPercent = p.hp / maxHp;

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

    // HP fill
    const hpColor =
      hpPercent > 0.5 ? "#4ad94a" : hpPercent > 0.25 ? "#d9a04a" : "#d94a4a";
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);

    // Armor bar (golden, stacked below HP bar)
    if (p.armor > 0) {
      const armorBarY = barY + barHeight + 1;
      const armorPercent = p.armor / 3;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(barX - 1, armorBarY, barWidth + 2, 3);
      ctx.fillStyle = "#ddaa22";
      ctx.fillRect(barX, armorBarY, barWidth * armorPercent, 2);
    }

    // Username
    ctx.font = "bold 20px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    // Shadow for readability
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(p.username, renderX + 1, renderY - 34);
    ctx.fillStyle = p.id === playerId ? "#ffcc66" : "#e0ece0";
    ctx.fillText(p.username, renderX, renderY - 35);
    ctx.textAlign = "start";

    // Score + ammo above player (local player only)
    if (p.id === playerId) {
      ctx.textAlign = "center";
      // Score
      ctx.font = "bold 13px 'Share Tech Mono', monospace";
      const scoreColor = (p.score || 0) >= 50 ? "#ffcc00" : "#ff6b35";
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillText("⭐" + (p.score || 0), renderX + 1, renderY - 48);
      ctx.fillStyle = scoreColor;
      ctx.fillText("⭐" + (p.score || 0), renderX, renderY - 49);
      // Ammo
      const weaponMaxAmmo = p.weapon === "shotgun" ? 10 : p.weapon === "sniper" ? 7 : 35;
      const ammoText = p.shots + "/" + weaponMaxAmmo;
      const ammoColor = p.reloading ? "#ff6b35" : (p.shots <= 5 ? "#ff8844" : "#ddeedd");
      ctx.font = "bold 11px 'Share Tech Mono', monospace";
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillText(ammoText, renderX + 1, renderY - 60);
      ctx.fillStyle = ammoColor;
      ctx.fillText(ammoText, renderX, renderY - 61);
      ctx.textAlign = "start";
    }

    // Bounty skull on the leading player
    if (bountyLeaderId === p.id) {
      ctx.font = "16px serif";
      ctx.textAlign = "center";
      ctx.fillText("💀", renderX, p.id === playerId ? renderY - 72 : renderY - 54);
      ctx.textAlign = "start";
    }

    // Golden crown on the #1 player (highest score)
    if (crownLeaderId === p.id) {
      const crownY = renderY - 26;
      const crownBob = Math.sin(Date.now() / 400) * 1.5;
      ctx.save();
      ctx.translate(renderX, crownY + crownBob);
      // Crown body
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.moveTo(-10, 4);
      ctx.lineTo(-10, -2);
      ctx.lineTo(-7, 1);
      ctx.lineTo(-3, -6);
      ctx.lineTo(0, -1);
      ctx.lineTo(3, -6);
      ctx.lineTo(7, 1);
      ctx.lineTo(10, -2);
      ctx.lineTo(10, 4);
      ctx.closePath();
      ctx.fill();
      // Crown base
      ctx.fillStyle = "#daa520";
      ctx.fillRect(-10, 3, 20, 3);
      // Gem dots
      ctx.fillStyle = "#ff4444";
      ctx.beginPath();
      ctx.arc(-3, -1, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4488ff";
      ctx.beginPath();
      ctx.arc(3, -1, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#44ff44";
      ctx.beginPath();
      ctx.arc(0, -2, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Glow effect
      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "rgba(255, 215, 0, 0.15)";
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Restore alpha after invisibility
    if (p.invisible) {
      ctx.globalAlpha = 1.0;
    }
  });

  // Render bullets
  bullets.forEach((b) => {
    if (b.predicted && b.dx !== undefined) {
      b.x += b.dx;
      b.y += b.dy;
    }

    if (b.weapon === "shotgun") {
      // Shotgun pellet - small white-yellow
      ctx.fillStyle = "#ffe866";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.weapon === "sniper") {
      // Sniper tracer - bright blue laser line
      ctx.strokeStyle = "#44aaff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      const trailLen = 22;
      // Use dx/dy for predicted bullets, or compute from previous position
      let angle;
      if (b.dx !== undefined && b.dy !== undefined) {
        angle = Math.atan2(b.dy, b.dx);
      } else {
        const prev = previousBulletPositions.get(b.id);
        if (prev && (prev.x !== b.x || prev.y !== b.y)) {
          angle = Math.atan2(b.y - prev.y, b.x - prev.x);
          b._lastAngle = angle;
        } else {
          angle = b._lastAngle !== undefined ? b._lastAngle : 0;
        }
      }
      ctx.lineTo(b.x - Math.cos(angle) * trailLen, b.y - Math.sin(angle) * trailLen);
      ctx.stroke();
      // Core dot
      ctx.fillStyle = "#88ccff";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Glow
      ctx.fillStyle = "rgba(68,170,255,0.3)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Machine gun tracer - yellow
      ctx.fillStyle = "#ffcc44";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // Small glow
      ctx.fillStyle = "rgba(255,200,50,0.2)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Render shell casings
  renderShellCasings();

  // Render explosions
  renderExplosions();

  // Render muzzle flashes
  renderMuzzleFlashes();

  // Render knife slashes
  renderKnifeSlashes();

  // Render impact sparks
  renderImpactSparks();

  // Render bomb explosions
  renderBombExplosions();

  // Render lightning bolts
  renderLightningBolts();

  // Render hit markers and damage indicators
  renderHitMarkers();
  renderDamageIndicators();

  // Render floating damage numbers
  renderFloatingNumbers();

  // Render kill effects (fire, ice, lightning)
  renderKillEffects();

  // Render death animations (ragdoll particles)
  renderDeathAnimations();

  // Render emotes above players
  renderEmotes(ctx);

  // === End world-space rendering — restore camera transform ===
  ctx.restore(); // Restore camera translate+shake

  // === Restore camera scale — switch to screen-space for HUD overlays ===
  ctx.restore(); // Restore camera scale

  // Render crosshair (in screen space)
  if (framePlayer) {
    const crossX = (mouseX - cameraX) * CAMERA_SCALE;
    const crossY = (mouseY - cameraY) * CAMERA_SCALE;
    // Tactical crosshair
    ctx.strokeStyle = "rgba(255,170,68,0.8)";
    ctx.lineWidth = 1.5;

    // Cross lines with gap in center
    const gap = 4;
    const len = 10;
    ctx.beginPath();
    ctx.moveTo(crossX - len, crossY);
    ctx.lineTo(crossX - gap, crossY);
    ctx.moveTo(crossX + gap, crossY);
    ctx.lineTo(crossX + len, crossY);
    ctx.moveTo(crossX, crossY - len);
    ctx.lineTo(crossX, crossY - gap);
    ctx.moveTo(crossX, crossY + gap);
    ctx.lineTo(crossX, crossY + len);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = "rgba(255,170,68,0.9)";
    ctx.beginPath();
    ctx.arc(crossX, crossY, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Kill feed
  if (gameReady) {
    renderKillFeed();
  }

  // Render minimap
  renderMinimap();

  // Flashbang overlay (must be last — covers entire screen)
  renderFlashbang();

  // Low HP vignette (drawn on top of everything including flashbang)
  renderLowHPVignette();

  requestAnimationFrame(render);
}

render();
