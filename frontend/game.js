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
var BINARY_WEAPON_MAP = { 0: "machinegun", 1: "shotgun", 4: "sniper" };

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
  var seq = dv.getUint32(off, true); off += 4;
  var playerCount = dv.getUint16(off, true); off += 2;

  // Players (25 bytes each)
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
    var bAngle = dv.getFloat32(off, true); off += 4;
    parsedBullets.push({ id: "b" + bsid, x: bx, y: by, weapon: BINARY_WEAPON_MAP[bw] || "machinegun", angle: bAngle });
  }

  return {
    seq: seq,
    players: parsedPlayers,
    bullets: parsedBullets,
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

  // Death/damage detection
  parsedPlayers.forEach(function(p) {
    var prevState = previousPlayerStates.get(p.id);
    if (prevState && prevState.hp > 0 && p.hp <= 0) {
      createDeathAnimation(p.x, p.y, p.skin || 0);
      var deathWeapon = pendingDeathWeapon.get(p.username) || "machinegun";
      var wasHeadshot = pendingHeadshot.get(p.username) || false;
      pendingDeathWeapon.delete(p.username);
      pendingHeadshot.delete(p.username);

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

      createFloatingNumber(p.x, p.y, prevState.hp, wasHeadshot);
      if (p.id === playerId) { triggerScreenShake(12); stopHeartbeat(); }
      else { triggerScreenShake(5); }
      playPositionalSound("died", p.x, p.y, 0.3);
      if (p.id !== playerId) createHitMarker();
    } else if (prevState && prevState.hp > p.hp && p.hp > 0) {
      createBlood(p.x, p.y);
      createBloodStain(p.x, p.y);
      var isHS = recentHeadshots.has(p.username);
      recentHeadshots.delete(p.username);
      createFloatingNumber(p.x, p.y, prevState.hp - p.hp, isHS);
      if (p.id !== playerId) createHitMarker();
      if (p.id === playerId) {
        createDamageIndicator(p.x, p.y);
        triggerScreenShake(6);
        if (p.hp <= 20) startHeartbeat();
      }
    } else if (prevState && p.hp > prevState.hp && p.id === playerId) {
      if (p.hp > 20) stopHeartbeat();
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
  // Track death timestamps: mark newly dead players, clear alive ones
  players.forEach(function(p) {
    if (p.hp <= 0) {
      if (!playerDeathTimes.has(p.id)) playerDeathTimes.set(p.id, Date.now());
    } else {
      playerDeathTimes.delete(p.id);
    }
  });
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

    // Per-weapon ammo tracking (binary handler)
    weaponAmmoState[currentPlayer.weapon] = currentPlayer.shots;
    if (currentPlayer.weapon !== lastKnownWeapon) {
      lastKnownWeapon = currentPlayer.weapon;
    }

    var lastProcessed = currentPlayer.lastProcessedInput || 0;
    pendingInputs = pendingInputs.filter(function(inp) { return inp.sequence > lastProcessed; });

    var reconciledX = currentPlayer.x;
    var reconciledY = currentPlayer.y;
    pendingInputs.forEach(function(input) {
      var result = applyInput(reconciledX, reconciledY, input.keys, currentPlayer.weapon);
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
  ARENA_PADDING: 200,
  PLAYER_RADIUS: 20,
  PLAYER_SPEED: 10.5,
  SHOTS_PER_MAGAZINE: 35,
  MAX_BLOOD_STAINS: 80,
  MAX_PARTICLES: 100,
  MAX_BLOOD_EFFECTS: 10,
  MAX_IMPACT_SPARKS: 12,
  MUZZLE_FLASH_DURATION: 100,
  BLOOD_PARTICLE_COUNT: 8,
  VIEWPORT_WIDTH: window.innerWidth,
  VIEWPORT_HEIGHT: window.innerHeight,
};

// Camera state
let cameraX = 0;
let cameraY = 0;
let CAMERA_SCALE = 1.1; // Zoomed in to see sprites better (let, not const — dynamic for sniper zoom)
const CAMERA_SCALE_DEFAULT = 1.1;
const CAMERA_SCALE_SNIPER = CAMERA_SCALE_DEFAULT * 0.75; // 25% zoom out for sniper
let _cameraInitialized = false;

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
  { name: "Forest", primary: "#2a8a3a", secondary: "#1a5a2a" },
  { name: "Coral", primary: "#e07040", secondary: "#a04828" },
  { name: "Navy", primary: "#3a4a8a", secondary: "#2a2a5a" },
  { name: "Rose", primary: "#d94a8a", secondary: "#8a2a5a" },
];

// ===== SPRITE PRELOADING =====
// Preload the two base player sprites (rifle + shotgun)
var spriteRifle = new Image();
var spriteShotgun = new Image();
var spriteSniper = new Image();
// Bullet sprites
var spriteRifleBullet = new Image();
var spriteShotgunBullet = new Image();
var spriteSniperBullet = new Image();
var spritesLoaded = false;
(function preloadSprites() {
  var loaded = 0;
  var total = 6;
  function onLoad() { loaded++; if (loaded >= total) spritesLoaded = true; }
  spriteRifle.onload = onLoad; spriteRifle.onerror = onLoad;
  spriteRifle.src = "assets/sprites/player-rifle-idle.png";
  spriteShotgun.onload = onLoad; spriteShotgun.onerror = onLoad;
  spriteShotgun.src = "assets/sprites/player-shotgun-idle.png";
  spriteSniper.onload = onLoad; spriteSniper.onerror = onLoad;
  spriteSniper.src = "assets/sprites/player-sniper-idle.png";
  spriteRifleBullet.onload = onLoad; spriteRifleBullet.onerror = onLoad;
  spriteRifleBullet.src = "assets/sprites/rifle-bullet.png";
  spriteShotgunBullet.onload = onLoad; spriteShotgunBullet.onerror = onLoad;
  spriteShotgunBullet.src = "assets/sprites/shotgun-bullet.png";
  spriteSniperBullet.onload = onLoad; spriteSniperBullet.onerror = onLoad;
  spriteSniperBullet.src = "assets/sprites/sniper-bullet.png";
})();

// Pixel art texture sprite sheets
var txGrass = new Image();
var txWall = new Image();
var txStoneGround = new Image();
var txProps = new Image();
var txPlant = new Image();
var texturesLoaded = false;
(function preloadTextures() {
  var loaded = 0;
  var total = 5;
  function onTexLoad() {
    loaded++;
    if (loaded >= total) {
      texturesLoaded = true;
      // Invalidate cached patterns so they rebuild with textures
      gridCanvas = null;
      gridPatternCache = null;
      wallLookup = null;
    }
  }
  txGrass.onload = onTexLoad; txGrass.onerror = onTexLoad;
  txGrass.src = "assets/pixel-art-textures/TX%20Tileset%20Grass.png";
  txWall.onload = onTexLoad; txWall.onerror = onTexLoad;
  txWall.src = "assets/pixel-art-textures/TX%20Tileset%20Wall.png";
  txStoneGround.onload = onTexLoad; txStoneGround.onerror = onTexLoad;
  txStoneGround.src = "assets/pixel-art-textures/TX%20Tileset%20Stone%20Ground.png";
  txProps.onload = onTexLoad; txProps.onerror = onTexLoad;
  txProps.src = "assets/pixel-art-textures/TX%20Props.png";
  txPlant.onload = onTexLoad; txPlant.onerror = onTexLoad;
  txPlant.src = "assets/pixel-art-textures/TX%20Plant.png";
})();

// Sprite render dimensions (scaled to match player hitbox)
var SPRITE_RENDER_W = 70;
var SPRITE_RENDER_H = 70 / (283 / 160); // maintain aspect ratio ≈ 39.6

// Muzzle position in sprite-local coordinates (origin = player center)
// All sprites are 283×160 with muzzle at pixel (272, 118)
var SPRITE_DRAW_OX = -SPRITE_RENDER_W * 0.35;  // draw offset X
var SPRITE_DRAW_OY = -SPRITE_RENDER_H / 2;     // draw offset Y
var SPRITE_SCALE_X = SPRITE_RENDER_W / 283;
var SPRITE_SCALE_Y = SPRITE_RENDER_H / 160;
var MUZZLE_OFFSET = { x: SPRITE_DRAW_OX + 272 * SPRITE_SCALE_X, y: SPRITE_DRAW_OY + 118 * SPRITE_SCALE_Y };

// Head position offsets per weapon in sprite-local coords (origin = player center)
// Sprite pixel coords: sniper (67,88), shotgun (78,87), rifle (78,87)
var HEAD_OFFSETS = {
  machinegun: { x: SPRITE_DRAW_OX + 78 * SPRITE_SCALE_X, y: SPRITE_DRAW_OY + 87 * SPRITE_SCALE_Y },
  shotgun:    { x: SPRITE_DRAW_OX + 78 * SPRITE_SCALE_X, y: SPRITE_DRAW_OY + 87 * SPRITE_SCALE_Y },
  sniper:     { x: SPRITE_DRAW_OX + 67 * SPRITE_SCALE_X, y: SPRITE_DRAW_OY + 88 * SPRITE_SCALE_Y },
};
var HEAD_OFFSET_DEFAULT = HEAD_OFFSETS.machinegun;

// Get muzzle world position given player center and aim angle
function getMuzzlePosition(px, py, angle, weapon) {
  var cos = Math.cos(angle);
  var sin = Math.sin(angle);
  return {
    x: px + MUZZLE_OFFSET.x * cos - MUZZLE_OFFSET.y * sin,
    y: py + MUZZLE_OFFSET.x * sin + MUZZLE_OFFSET.y * cos
  };
}

// Client-side muzzle-wall check — mirrors server's muzzleBlockedByWall().
// Steps along the line from player center to muzzle tip and checks if any
// point intersects an obstacle. Prevents "ghost shots" where the client
// fires effects but the server refunds the bullet.
function isMuzzleBlockedByWall(px, py, mx, my) {
  var dx = mx - px;
  var dy = my - py;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return false;
  var stepSize = 10;
  var steps = Math.ceil(dist / stepSize);
  for (var si = 1; si <= steps; si++) {
    var t = si / steps;
    var sx = px + dx * t;
    var sy = py + dy * t;
    for (var oi = 0; oi < gameObstacles.length; oi++) {
      var o = gameObstacles[oi];
      if (o.destroyed) continue;
      if (sx >= o.x && sx <= o.x + o.size && sy >= o.y && sy <= o.y + o.size) {
        return true;
      }
    }
  }
  return false;
}

// Get head world position given player center, aim angle, and weapon
function getHeadWorldPosition(px, py, angle, weapon) {
  var ho = HEAD_OFFSETS[weapon] || HEAD_OFFSET_DEFAULT;
  var cos = Math.cos(angle);
  var sin = Math.sin(angle);
  return {
    x: px + ho.x * cos - ho.y * sin,
    y: py + ho.x * sin + ho.y * cos
  };
}

function getPlayerSprite(skinIndex, weapon) {
  if (weapon === "shotgun") return spriteShotgun;
  if (weapon === "sniper") return spriteSniper;
  return spriteRifle;
}

// Weapon definitions
const WEAPON_COOLDOWNS = {
  machinegun: 95,
  shotgun: 950,
  sniper: 1550,
};
const WEAPON_KILL_ICONS = {
  machinegun: "🔫",
  shotgun: "🔫",
  sniper: "🎯",
};

let ws;
let playerId;
let loggedInUsername = "";
let players = [];
let bullets = [];
let gameObstacles = [];
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let screenMouseX = window.innerWidth / 2;
let screenMouseY = window.innerHeight / 2;
let previousBulletCount = 0;
let wasReloading = false;
let reloadStartTime = 0;
let reloadDuration = 0;  // ms — set per weapon when reload starts
let lastEmptyClickTime = 0;
let lowAmmoWarningShown = false;
let reloadFlashAlpha = 0;

// Per-weapon ammo state (client-side tracking for HUD display)
let weaponAmmoState = { machinegun: 35, shotgun: 8, sniper: 5 };
let lastKnownWeapon = "machinegun";

let bloodParticles = [];
let bloodStains = [];
let muzzleFlashes = [];
let shellCasings = [];
let impactSparks = [];
let dustClouds = [];
let lastDustTime = 0;
let hitMarkers = [];
let damageIndicators = [];
let previousBulletPositions = new Map();

// Low HP vignette + heartbeat
let lowHPPulseTime = 0;
let heartbeatActive = false;

// Floating damage numbers
let floatingNumbers = [];

// Revenge tracking — store last killer username for local player
let lastKilledByUsername = "";
// Last kill weapon per victim (from "kill" messages) for weapon-specific death effects
let pendingDeathWeapon = new Map(); // victimUsername -> weapon
let pendingHeadshot = new Map(); // victimUsername -> true (if killed by headshot)
let recentHeadshots = new Set(); // track recently headshotted players for gold damage numbers

// Kill effect particles (fire, ice, lightning)
let killEffects = [];

// Death animation particles (replaces instant despawn)
let deathAnimations = [];
// Track death timestamps separately (survives players array replacement)
const playerDeathTimes = new Map();

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

// Kill feed dirty flag (avoid innerHTML comparison)
let killFeedDirty = true;

// Screen shake
let screenShake = { intensity: 0, decay: 0.92 };
let killFeedEntries = [];

// Cached grid canvas (used in resizeCanvas and render)
let gridCanvas = null;
let gridPatternCache = null;
let wallLookup = null;       // Set of "x,y" strings for fast wall neighbor checks
let mapDecorations = [];     // Visual-only plant/prop decorations
const KILL_FEED_DURATION = 4000;
const KILL_FEED_MAX = 5;

let maxHp = 100; // updated from server on game start

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
  // Store raw screen coords for per-frame recalculation
  screenMouseX = e.clientX;
  screenMouseY = e.clientY;
  // Convert screen coords to world coords via camera scale + offset
  mouseX = screenMouseX / CAMERA_SCALE + cameraX;
  mouseY = screenMouseY / CAMERA_SCALE + cameraY;
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

function updateBloodParticles() {
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
    x: x,
    y: y,
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
function createFloatingNumber(x, y, amount, isHeadshot) {
  floatingNumbers.push({
    x: x + (Math.random() - 0.5) * 10,
    y: y - 10,
    vy: -1.5,
    life: 1.0,
    text: "-" + amount,
    headshot: !!isHeadshot,
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
    const fontSize = f.headshot ? Math.round(24 * scale) : Math.round(18 * scale);
    ctx.font = `bold ${fontSize}px 'Rajdhani', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Headshot = gold text, normal = red text
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 3;
    const displayText = f.headshot ? "🎯 " + f.text : f.text;
    ctx.strokeText(displayText, f.x, f.y);
    ctx.fillStyle = f.headshot ? "#ffd700" : "#ff3333";
    ctx.fillText(displayText, f.x, f.y);
    ctx.restore();
  }
  ctx.globalAlpha = 1.0;
}

// Low HP vignette rendering
let lowHPVignetteGradient = null;
let lowHPVignetteW = 0;
let lowHPVignetteH = 0;

function renderLowHPVignette() {
  const localPlayer = players.find((p) => p.id === playerId);
  if (!localPlayer || localPlayer.hp <= 0 || localPlayer.hp > 20) return;

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

function renderBloodParticles() {
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
function applyInput(x, y, keys, weapon) {
  const speed = GAME_CONFIG.PLAYER_SPEED;
  const playerRadius = GAME_CONFIG.PLAYER_RADIUS;
  const radiusSq = playerRadius * playerRadius;
  const margin = playerRadius;
  let newX = x;
  let newY = y;

  // X axis movement + collision (push-out resolution)
  if (keys.a) newX -= speed;
  if (keys.d) newX += speed;
  newX = Math.max(margin, Math.min(GAME_CONFIG.ARENA_WIDTH - margin, newX));
  // Resolve X-axis obstacle collisions
  for (let i = 0; i < gameObstacles.length; i++) {
    const o = gameObstacles[i];
    if (o.destroyed) continue;
    const closestX = Math.max(o.x, Math.min(newX, o.x + o.size));
    const closestY = Math.max(o.y, Math.min(newY, o.y + o.size));
    const dx = newX - closestX;
    const dy = newY - closestY;
    const dSq = dx * dx + dy * dy;
    if (dSq < radiusSq) {
      if (dSq > 0.0001) {
        const dist = Math.sqrt(dSq);
        newX += (dx / dist) * (playerRadius - dist);
      } else {
        if (o.x + o.size / 2 < newX) newX = o.x + o.size + playerRadius;
        else newX = o.x - playerRadius;
      }
    }
  }

  // Y axis movement
  if (keys.w) newY -= speed;
  if (keys.s) newY += speed;
  newY = Math.max(margin, Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, newY));
  // Resolve Y-axis obstacle collisions
  for (let i = 0; i < gameObstacles.length; i++) {
    const o = gameObstacles[i];
    if (o.destroyed) continue;
    const closestX = Math.max(o.x, Math.min(newX, o.x + o.size));
    const closestY = Math.max(o.y, Math.min(newY, o.y + o.size));
    const dx = newX - closestX;
    const dy = newY - closestY;
    const dSq = dx * dx + dy * dy;
    if (dSq < radiusSq) {
      if (dSq > 0.0001) {
        const dist = Math.sqrt(dSq);
        newY += (dy / dist) * (playerRadius - dist);
      } else {
        if (o.y + o.size / 2 < newY) newY = o.y + o.size + playerRadius;
        else newY = o.y - playerRadius;
      }
    }
  }

  // Player-player collision (push local player away from other players)
  const minPlayerDist = playerRadius * 2;
  const minPlayerDistSq = minPlayerDist * minPlayerDist;
  for (let i = 0; i < players.length; i++) {
    const other = players[i];
    if (other.id === playerId) continue;
    if (other.hp <= 0) continue;
    const pdx = newX - other.x;
    const pdy = newY - other.y;
    const pdSq = pdx * pdx + pdy * pdy;
    if (pdSq < minPlayerDistSq && pdSq > 0.0001) {
      const pdist = Math.sqrt(pdSq);
      const overlap = minPlayerDist - pdist;
      // Push local player out entirely (server pushes both, but client only controls local)
      newX += (pdx / pdist) * overlap;
      newY += (pdy / pdist) * overlap;
      newX = Math.max(margin, Math.min(GAME_CONFIG.ARENA_WIDTH - margin, newX));
      newY = Math.max(margin, Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, newY));
    }
  }

  return { x: newX, y: newY };
}

// ===== WEB AUDIO SYSTEM =====

let audioCtx = null;
const audioBuffers = {};
const activeGameSources = [];
let masterVolume = 0.7; // 0.0 – 1.0, persisted in localStorage
try { const saved = localStorage.getItem("masterVolume"); if (saved !== null) masterVolume = parseFloat(saved); } catch (_) { /* ignore */ }
let machinegunSoundIndex = 0;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const a = `${assetBase}/assets/audio`;

  // Shooting sounds
  for (let i = 1; i <= 4; i++) loadAudioBuffer(`machinegun-${i}`, `${a}/guns/shot/machinegun-${i}.mp3`);
  loadAudioBuffer("machinegun-5", `${a}/guns/shot/machinegun-5.wav`);
  loadAudioBuffer("shotgun-shot", `${a}/guns/shot/shotgun.mp3`);
  loadAudioBuffer("sniper-shot", `${a}/guns/shot/sniper-shot-bolt-reload.mp3`);

  // Per-weapon reload sounds
  loadAudioBuffer("reload-rifle", `${a}/guns/reload.mp3`);
  loadAudioBuffer("reload-shotgun", `${a}/guns/reload-shotgun.mp3`);
  loadAudioBuffer("reload-sniper", `${a}/guns/sniper-reload.mp3`);
  loadAudioBuffer("shotgun-pump", `${a}/guns/shogun-pump-bullet.mp3`);

  // Weapon switch
  loadAudioBuffer("weapon-switch", `${a}/guns/weapon-switch.mp3`);

  // Combat feedback
  loadAudioBuffer("empty-click", `${a}/guns/empty-click.wav`);
  loadAudioBuffer("kill-confirm", `${a}/guns/kill-confirm.wav`);

  // Player sounds
  loadAudioBuffer("scream", `${a}/scream.wav`);
  loadAudioBuffer("died", `${a}/died.mp3`);

  // Match sounds
  loadAudioBuffer("matchstart", `${a}/match-start.ogg`);
  for (let i = 1; i <= 8; i++) loadAudioBuffer(`win-${i}`, `${a}/match-win/win-${i}.mp3`);
  for (let i = 1; i <= 9; i++) loadAudioBuffer(`lose-${i}`, `${a}/match-lose/lose-${i}.mp3`);

  // Kill streak announcements (random variant picked at play time)
  loadAudioBuffer("streak-double-1", `${a}/killstreaks/double-kill.mp3`);
  loadAudioBuffer("streak-double-2", `${a}/killstreaks/double-kill-2.mp3`);
  loadAudioBuffer("streak-double-3", `${a}/killstreaks/double-kill-3.mp3`);
  loadAudioBuffer("streak-double-4", `${a}/killstreaks/double-kill-4.mp3`);
  loadAudioBuffer("streak-monster-1", `${a}/killstreaks/monster-kill.mp3`);
  loadAudioBuffer("streak-monster-2", `${a}/killstreaks/monster-kill-2.mp3`);
  loadAudioBuffer("streak-unstoppable-1", `${a}/killstreaks/unstoppable.mp3`);
  loadAudioBuffer("streak-unstoppable-2", `${a}/killstreaks/unstoppable_2.mp3`);
  loadAudioBuffer("streak-legendary", `${a}/killstreaks/legendary.mp3`);
  loadAudioBuffer("streak-godlike", `${a}/killstreaks/godlike.mp3`);
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
  gameObstacles = [];
  wallLookup = null;
  mapDecorations = [];
  bloodParticles = [];
  bloodStains = [];
  muzzleFlashes = [];
  shellCasings = [];
  impactSparks = [];
  dustClouds = [];
  hitMarkers = [];
  damageIndicators = [];
  killEffects = [];
  deathAnimations = [];
  previousBulletPositions.clear();
  screenShake = { intensity: 0, decay: 0.92 };
  killFeedEntries = [];
  killFeedDirty = true;
  _cachedDOM = null;
  previousPlayerStates.clear();
  gameReady = false;
  roundEnded = false;
  floatingNumbers = [];
  lowHPPulseTime = 0;
  stopHeartbeat();
  stopAllGameSounds();
  lastKilledByUsername = "";
  pendingDeathWeapon.clear();
  pendingHeadshot.clear();
  recentHeadshots.clear();
  wasReloading = false;
  reloadStartTime = 0;
  reloadDuration = 0;
  lastEmptyClickTime = 0;
  lowAmmoWarningShown = false;
  reloadFlashAlpha = 0;
  weaponAmmoState = { machinegun: 35, shotgun: 8, sniper: 5 };
  lastKnownWeapon = "machinegun";
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
  gameObstacles = data.obstacles || [];
  wallLookup = null;
  generateMapDecorations();

  if (data.arenaWidth) GAME_CONFIG.ARENA_WIDTH = data.arenaWidth;
  if (data.arenaHeight) GAME_CONFIG.ARENA_HEIGHT = data.arenaHeight;
  if (data.maxHp) maxHp = data.maxHp;

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
    .sort(function(a, b) { return (b.kills || 0) - (a.kills || 0); });

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
        '<span class="pl-stats">' + p.kills + 'K/' + p.deaths + 'D (' + kd + ') | ' + (dead ? '💀' : '❤️' + hpPct + '%') + '</span>' +
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
    .sort(function(a, b) { return (b.kills || 0) - (a.kills || 0); });

  const top = sorted.slice(0, 10);
  const localIdx = sorted.findIndex(function(p) { return p.id === playerId; });

  let html = "";
  top.forEach(function(p, i) {
    const isMe = p.id === playerId;
    html += '<div class="lb-row' + (isMe ? " lb-me" : "") + '">' +
      '<span class="lb-rank">' + (i + 1) + '.</span>' +
      '<span class="lb-name">' + esc(p.username) + '</span>' +
      '<span class="lb-score">' + (p.kills || 0) + '</span>' +
      '</div>';
  });

  // Show local player position if not in top 10
  if (localIdx >= 10) {
    const me = sorted[localIdx];
    html += '<div class="lb-divider">···</div>';
    html += '<div class="lb-row lb-me">' +
      '<span class="lb-rank">' + (localIdx + 1) + '.</span>' +
      '<span class="lb-name">' + esc(me.username) + '</span>' +
      '<span class="lb-score">' + (me.kills || 0) + '</span>' +
      '</div>';
  }

  list.innerHTML = html;
}

// ===== SHOOTING =====

function tryShoot() {
  if (!isMouseDown || !gameReady || roundEnded) return;
  const localPlayer = players.find(function(p) { return p.id === playerId; });
  if (!localPlayer || localPlayer.hp <= 0) return;

  // Empty magazine feedback: dry-fire click when trying to shoot with 0 ammo
  if (localPlayer.shots <= 0 && !localPlayer.reloading) {
    const now = Date.now();
    if (now - lastEmptyClickTime > 400) {
      lastEmptyClickTime = now;
      playSound("empty-click", 0.4);
      // Auto-trigger reload on empty mag
      ws.send(serialize({ type: "reload" }));
      reloadFlashAlpha = 1.0;
    }
    return;
  }

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

  // Compute muzzle position from sprite data
  const aimAngle = Math.atan2(dirY, dirX);
  const muzzle = getMuzzlePosition(predictedX, predictedY, aimAngle, weapon);

  // Client-side muzzle-wall check: don't shoot if muzzle is inside a wall
  // (matches server-side muzzleBlockedByWall — prevents ghost shots)
  if (isMuzzleBlockedByWall(predictedX, predictedY, muzzle.x, muzzle.y)) {
    return;
  }

  ws.send(serialize({ type: "shoot", dirX: dirX, dirY: dirY }));

  // Client-side muzzle flash and effects
  createMuzzleFlash(muzzle.x, muzzle.y, dirX, dirY);

  // Shell casing
  const casingAngle = aimAngle + Math.PI / 2;
  createShellCasing(predictedX, predictedY, casingAngle);

  // Client-side predicted bullet (removed on next server state)
  const bulletSpeed = weapon === "sniper" ? 48 : 15;
  bullets.push({
    id: "predicted-" + Math.random().toString(36).slice(2),
    x: muzzle.x,
    y: muzzle.y,
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
          // Reset per-weapon ammo state (server resets all weapons)
          weaponAmmoState = { machinegun: 35, shotgun: 8, sniper: 5 };
          lastKnownWeapon = "machinegun";
          // Clear auto-respawn timer
          if (autoRespawnTimer) {
            clearInterval(autoRespawnTimer);
            autoRespawnTimer = null;
          }
          // Hide death overlay
          const deathOv = document.getElementById("deathOverlay");
          if (deathOv) deathOv.style.display = "none";
          showToast("🔄 Respawned!", "#44ff44");
        }
      }
      return;
    }

    // ===== HEADSHOT EVENT =====
    if (data.type === "headshot") {
      // Track this player as recently headshotted for gold damage number
      recentHeadshots.add(data.victim);
      // Show headshot hit marker for shooter
      const localPlayer = players.find(function(p) { return p.id === playerId; });
      if (localPlayer && data.victim !== localPlayer.username) {
        createHitMarker();
        // Extra screen shake for headshot
        triggerScreenShake(3);
      }
      return;
    }

    // ===== BULLET HIT WALL =====
    if (data.type === "bulletHitWall") {
      createImpactSparks(data.x, data.y);
      return;
    }

    // ===== KILLS =====
    if (data.type === "kill") {
      addKillFeedEntry(data.killer, data.victim, data.weapon, data.isHeadshot);
      pendingDeathWeapon.set(data.victim, data.weapon);
      if (data.isHeadshot) pendingHeadshot.set(data.victim, true);

      const localPlayer = players.find(function(p) { return p.id === playerId; });
      if (localPlayer) {
        if (data.killer === localPlayer.username) {
          playSound("kill-confirm", 0.5);
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
            if (droppedEl) droppedEl.style.display = "none";
          }
          // Start auto-respawn countdown
          startAutoRespawnTimer();
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
      // Play killstreak announcement sound (random variant)
      if (data.streak === 2) {
        playSound("streak-double-" + (Math.floor(Math.random() * 4) + 1), 0.7);
      } else if (data.streak === 3) {
        playSound("streak-monster-" + (Math.floor(Math.random() * 2) + 1), 0.7);
      } else if (data.streak === 5) {
        playSound("streak-unstoppable-" + (Math.floor(Math.random() * 2) + 1), 0.7);
      } else if (data.streak === 7) {
        playSound("streak-legendary", 0.8);
      } else if (data.streak >= 10) {
        playSound("streak-godlike", 0.9);
      }
      return;
    }

    // ===== CHAT =====
    if (data.type === "chatMessage") {
      addKillFeedEntry(data.username, data.message, "chat");
      return;
    }

    // ===== STATE UPDATE (35 Hz) =====
    if (data.type === "state") {
      const weaponCodeMap = { 0: "machinegun", 1: "shotgun", 4: "sniper" };
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
            if (p.hp <= 20) startHeartbeat();
          }
        } else if (prevState && p.hp > prevState.hp && p.id === playerId) {
          if (p.hp > 20) stopHeartbeat();
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
      // Track death timestamps: mark newly dead players, clear alive ones
      players.forEach(function(p) {
        if (p.hp <= 0) {
          if (!playerDeathTimes.has(p.id)) playerDeathTimes.set(p.id, Date.now());
        } else {
          playerDeathTimes.delete(p.id);
        }
      });
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

        // ── Reload sound & feedback ──
        if (currentPlayer.reloading && !wasReloading) {
          // Just started reloading — play per-weapon reload sound
          if (currentPlayer.weapon === "shotgun") {
            playSound("reload-shotgun", 0.6);
            reloadDuration = 2200;
          } else if (currentPlayer.weapon === "sniper") {
            playSound("reload-sniper", 0.6);
            reloadDuration = 2800;
          } else {
            playSound("reload-rifle", 0.6);
            reloadDuration = 1800;
          }
          reloadStartTime = Date.now();
          reloadFlashAlpha = 1.0;
        }
        if (!currentPlayer.reloading && wasReloading) {
          // Reload just completed — brief flash + shotgun pump sound
          reloadFlashAlpha = 0.8;
          if (currentPlayer.weapon === "shotgun") {
            playSound("shotgun-pump", 0.5);
          }
        }
        wasReloading = currentPlayer.reloading;

        // ── Per-weapon ammo tracking ──
        // Update ammo state for the current weapon from server
        weaponAmmoState[currentPlayer.weapon] = currentPlayer.shots;
        // Detect weapon switch: if weapon changed, we saved old ammo already via server
        if (currentPlayer.weapon !== lastKnownWeapon) {
          lastKnownWeapon = currentPlayer.weapon;
        }

        // ── Low ammo warning tracking ──
        const wpnMaxAmmo = currentPlayer.weapon === "shotgun" ? 8 : currentPlayer.weapon === "sniper" ? 5 : 35;
        const lowAmmoThreshold = Math.max(1, Math.ceil(wpnMaxAmmo * 0.2));
        if (currentPlayer.shots <= lowAmmoThreshold && currentPlayer.shots > 0 && !currentPlayer.reloading) {
          lowAmmoWarningShown = true;
        } else {
          lowAmmoWarningShown = false;
        }

        const lastProcessed = currentPlayer.lastProcessedInput || 0;
        pendingInputs = pendingInputs.filter(function(i) { return i.sequence > lastProcessed; });

        let reconciledX = currentPlayer.x;
        let reconciledY = currentPlayer.y;
        pendingInputs.forEach(function(input) {
          const result = applyInput(reconciledX, reconciledY, input.keys, currentPlayer.weapon);
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
            var mvpIcons = { mostKills: "\ud83d\udde1\ufe0f", longestStreak: "\ud83d\udd25", mostDamage: "\ud83d\udca5" };
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
            return '<div class="' + cls + '"><span>' + medal + " " + esc(s.username) + '</span><span>' + s.kills + 'K/' + s.deaths + 'D</span></div>';
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
          playSound("win-" + data.audioIndex, 0.6);
        } else {
          playSound("lose-" + data.audioIndex, 0.6);
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
      bullets = [];
      bloodParticles = [];
      bloodStains = [];
      muzzleFlashes = [];
      shellCasings = [];
      impactSparks = [];
      dustClouds = [];
      hitMarkers = [];
      damageIndicators = [];
      killEffects = [];
      deathAnimations = [];
      previousBulletPositions.clear();
      screenShake = { intensity: 0, decay: 0.92 };
      killFeedEntries = [];
      killFeedDirty = true;
      _cachedDOM = null;
      previousPlayerStates.clear();
      floatingNumbers = [];
      lowHPPulseTime = 0;
      weaponAmmoState = { machinegun: 35, shotgun: 8, sniper: 5 };
      lastKnownWeapon = "machinegun";

      gameObstacles = data.obstacles || [];
      wallLookup = null;
      generateMapDecorations();

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
    ws.send(serialize({ type: "join", username: trimmed, skin: 0 }));
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

let autoRespawnTimer = null;
let autoRespawnCountdown = 3;

function doRespawn() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(serialize({ type: "requestRespawn" }));
  // Clear auto-respawn timer since player clicked manually
  if (autoRespawnTimer) {
    clearInterval(autoRespawnTimer);
    autoRespawnTimer = null;
  }
}

function startAutoRespawnTimer() {
  // Clear any existing timer
  if (autoRespawnTimer) {
    clearInterval(autoRespawnTimer);
    autoRespawnTimer = null;
  }
  autoRespawnCountdown = 3;
  const btn = document.getElementById("deathRespawnBtn");
  if (btn) btn.textContent = "⚔ RESPAWN (" + autoRespawnCountdown + ")";
  autoRespawnTimer = setInterval(function() {
    autoRespawnCountdown--;
    if (btn) btn.textContent = "⚔ RESPAWN (" + autoRespawnCountdown + ")";
    if (autoRespawnCountdown <= 0) {
      clearInterval(autoRespawnTimer);
      autoRespawnTimer = null;
      if (btn) btn.textContent = "⚔ RESPAWN";
      doRespawn();
    }
  }, 1000);
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
    playSound("weapon-switch", 0.5);
    return;
  }

  // Number keys 1-3 to select weapon directly
  if (e.key >= "1" && e.key <= "3") {
    const weapons = ["machinegun", "shotgun", "sniper"];
    const weaponIndex = parseInt(e.key) - 1;
    ws.send(serialize({ type: "switchWeapon", weapon: weapons[weaponIndex] }));
    playSound("weapon-switch", 0.5);
    return;
  }

  // R key to manually reload
  if (mappedKey === "r") {
    ws.send(serialize({ type: "reload" }));
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
      playSound("weapon-switch", 0.5);
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

function addKillFeedEntry(killer, victim, weapon, isHeadshot) {
  const icon = weapon === "streak" ? "🔥" : (WEAPON_KILL_ICONS[weapon] || "💀");
  const entry = { killer, victim, icon, timestamp: Date.now(), headshot: !!isHeadshot };
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
        `<div class="kill-entry${e.headshot ? ' headshot-kill' : ''}" style="opacity:${opacity}">` +
        `<span class="killer">${esc(e.killer)}</span>` +
        `<span class="weapon-icon">${e.icon}${e.headshot ? '<span class="hs-badge">HS</span>' : ''}</span>` +
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

// ===== LEADERBOARD =====
// Leaderboard overlay is handled by updateLeaderboardOverlay() in the game loop

// ===== RENDER LOOP =====

// Pre-render static grid to offscreen canvas for performance
function ensureGridCanvas() {
  if (gridCanvas) return;
  // Use pixel art grass tileset if loaded, otherwise fallback to procedural grid
  if (txGrass.complete && txGrass.naturalWidth > 0) {
    // Extract 2x2 center grass tiles (64x64) from tileset rows 2-3, cols 2-3
    gridCanvas = document.createElement("canvas");
    gridCanvas.width = 64;
    gridCanvas.height = 64;
    var gc = gridCanvas.getContext("2d");
    gc.imageSmoothingEnabled = false;
    gc.drawImage(txGrass, 64, 64, 64, 64, 0, 0, 64, 64);
    // Slight darkening to match game's moody tone
    gc.fillStyle = "rgba(0,0,0,0.12)";
    gc.fillRect(0, 0, 64, 64);
  } else {
    // Fallback: procedural dark grid
    gridCanvas = document.createElement("canvas");
    var tileSize = 40;
    gridCanvas.width = tileSize;
    gridCanvas.height = tileSize;
    var gc = gridCanvas.getContext("2d");
    gc.fillStyle = "#2a3020";
    gc.fillRect(0, 0, tileSize, tileSize);
    gc.strokeStyle = "rgba(65, 85, 60, 0.35)";
    gc.lineWidth = 0.5;
    gc.beginPath();
    gc.moveTo(0, 0); gc.lineTo(0, tileSize);
    gc.stroke();
    gc.beginPath();
    gc.moveTo(0, 0); gc.lineTo(tileSize, 0);
    gc.stroke();
  }
}

// Generate scattered visual decorations (plants, grass tufts, props) across the arena
function generateMapDecorations() {
  mapDecorations = [];
  var aw = GAME_CONFIG.ARENA_WIDTH || 1600;
  var ah = GAME_CONFIG.ARENA_HEIGHT || 1600;
  // Simple seeded PRNG for deterministic placement across all clients
  var seed = Math.floor(aw * 7 + ah * 13 + gameObstacles.length * 31);
  function srand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  // Decoration types: source regions from TX Plant.png (32px tile grid)
  var plantSpecs = [
    { sx: 64,  sy: 128, sw: 32, sh: 32, dw: 20, dh: 20 },
    { sx: 128, sy: 128, sw: 32, sh: 32, dw: 22, dh: 22 },
    { sx: 192, sy: 128, sw: 32, sh: 32, dw: 18, dh: 18 },
    { sx: 64,  sy: 160, sw: 32, sh: 32, dw: 26, dh: 26 },
    { sx: 128, sy: 160, sw: 32, sh: 32, dw: 24, dh: 24 },
  ];

  // Props decorations from TX Props.png (512x512, 32px tile grid)
  // These are placed near walls for visual flair
  var propSpecs = [
    { sx: 0,   sy: 320, sw: 32, sh: 32, dw: 18, dh: 18, sheet: "props" },   // small stone/debris
    { sx: 32,  sy: 320, sw: 32, sh: 32, dw: 20, dh: 20, sheet: "props" },   // pebbles
    { sx: 64,  sy: 320, sw: 32, sh: 32, dw: 16, dh: 16, sheet: "props" },   // small rubble
    { sx: 96,  sy: 320, sw: 32, sh: 32, dw: 14, dh: 14, sheet: "props" },   // tiny stone
    { sx: 0,   sy: 352, sw: 32, sh: 32, dw: 22, dh: 22, sheet: "props" },   // scattered rocks
    { sx: 32,  sy: 352, sw: 32, sh: 32, dw: 20, dh: 20, sheet: "props" },   // debris pile
  ];

  // Place ~60 plant decorations randomly
  for (var i = 0; i < 60; i++) {
    var dx = srand() * (aw - 120) + 60;
    var dy = srand() * (ah - 120) + 60;
    // Skip if overlapping any wall
    var skip = false;
    for (var j = 0; j < gameObstacles.length; j++) {
      var o = gameObstacles[j];
      if (dx > o.x - 20 && dx < o.x + o.size + 20 && dy > o.y - 20 && dy < o.y + o.size + 20) {
        skip = true; break;
      }
    }
    if (skip) continue;
    var spec = plantSpecs[Math.floor(srand() * plantSpecs.length)];
    mapDecorations.push({ x: dx, y: dy, sx: spec.sx, sy: spec.sy, sw: spec.sw, sh: spec.sh, dw: spec.dw, dh: spec.dh, alpha: 0.35 + srand() * 0.3, sheet: "plant" });
  }

  // Place props near wall edges for rubble/debris look
  for (var wi = 0; wi < gameObstacles.length; wi++) {
    var wo = gameObstacles[wi];
    if (wo.destroyed) continue;
    // ~40% chance to place a prop near each wall tile
    if (srand() > 0.4) continue;
    // Pick a random exposed side
    var side = Math.floor(srand() * 4);
    var px, py;
    var bs = wo.size || 40;
    if (side === 0) { px = wo.x + srand() * bs; py = wo.y - 8 - srand() * 10; }       // north
    else if (side === 1) { px = wo.x + srand() * bs; py = wo.y + bs + 4 + srand() * 8; } // south
    else if (side === 2) { px = wo.x - 8 - srand() * 10; py = wo.y + srand() * bs; }    // west
    else { px = wo.x + bs + 4 + srand() * 8; py = wo.y + srand() * bs; }                 // east
    // Don't place if inside another wall
    var overlaps = false;
    for (var oi = 0; oi < gameObstacles.length; oi++) {
      var oo = gameObstacles[oi];
      if (px > oo.x - 4 && px < oo.x + oo.size + 4 && py > oo.y - 4 && py < oo.y + oo.size + 4) {
        overlaps = true; break;
      }
    }
    if (overlaps) continue;
    var pspec = propSpecs[Math.floor(srand() * propSpecs.length)];
    mapDecorations.push({ x: px, y: py, sx: pspec.sx, sy: pspec.sy, sw: pspec.sw, sh: pspec.sh, dw: pspec.dw, dh: pspec.dh, alpha: 0.4 + srand() * 0.3, sheet: "props" });
  }
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

  // Blit cached minimap to main canvas (semi-transparent)
  ctx.globalAlpha = 0.55;
  ctx.drawImage(_minimapCanvas, mx, my);
  ctx.globalAlpha = 1.0;
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

  // Draw obstacles on minimap (stone wall color to match pixel art textures)
  mc.fillStyle = "rgba(140,125,105,0.8)";
  for (let i = 0; i < gameObstacles.length; i++) {
    const o = gameObstacles[i];
    if (o.destroyed) continue;
    mc.fillRect(o.x * scaleX, o.y * scaleY, Math.max(1, o.size * scaleX), Math.max(1, o.size * scaleY));
  }

  // Find crown leader for minimap (most kills)
  let minimapCrownId = null;
  let minimapMaxKills = 1;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hp > 0 && (players[i].kills || 0) > minimapMaxKills) {
      minimapMaxKills = players[i].kills;
      minimapCrownId = players[i].id;
    }
  }

  // Draw other players as colored dots (only if within viewport)
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.id === playerId) continue;
    if (p.hp <= 0) continue;
    // Only show players on minimap if they are within the player's viewport
    const vpX = cameraX;
    const vpY = cameraY;
    const vpW = GAME_CONFIG.VIEWPORT_WIDTH;
    const vpH = GAME_CONFIG.VIEWPORT_HEIGHT;
    if (p.x < vpX || p.x > vpX + vpW || p.y < vpY || p.y > vpY + vpH) continue;
    if (minimapCrownId === p.id) {
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

// ============ OBSTACLE RENDERING ============
function renderObstacles() {
  if (!gameObstacles.length) return;
  var cx = Math.floor(cameraX);
  var cy = Math.floor(cameraY);
  var vw = GAME_CONFIG.VIEWPORT_WIDTH;
  var vh = GAME_CONFIG.VIEWPORT_HEIGHT;
  var viewL = cx - 60, viewT = cy - 60;
  var viewR = cx + vw + 60, viewB = cy + vh + 60;
  var bs = 40; // block size in game units

  // Build wall position lookup (invalidated when obstacles change)
  if (!wallLookup) {
    wallLookup = new Set();
    for (var wi = 0; wi < gameObstacles.length; wi++) {
      var wo = gameObstacles[wi];
      if (!wo.destroyed) wallLookup.add(wo.x + "," + wo.y);
    }
  }

  var useWallTex = txWall.complete && txWall.naturalWidth > 0;
  var useStoneGround = txStoneGround.complete && txStoneGround.naturalWidth > 0;

  // Wall fill tile source coordinates (TX Tileset Wall.png, 32px tiles)
  // Solid stone surface tiles: grid rows 1-2, cols 5-7 → 6 variations
  var wallSrc = [
    [160, 32], [192, 32], [224, 32],
    [160, 64], [192, 64], [224, 64],
  ];

  // -- Pass 0: stone ground patches around wall bases for foundation look --
  if (useStoneGround) {
    for (var i = 0; i < gameObstacles.length; i++) {
      var o = gameObstacles[i];
      if (o.destroyed) continue;
      if (o.x + bs + 10 < viewL || o.x - 10 > viewR || o.y + bs + 10 < viewT || o.y - 10 > viewB) continue;
      // Draw stone ground at each exposed edge (small border around wall base)
      var hasN = wallLookup.has(o.x + "," + (o.y - bs));
      var hasS = wallLookup.has(o.x + "," + (o.y + bs));
      var hasE = wallLookup.has((o.x + bs) + "," + o.y);
      var hasW = wallLookup.has((o.x - bs) + "," + o.y);
      // Stone ground border (8px strip on exposed sides)
      ctx.globalAlpha = 0.5;
      if (!hasN) ctx.drawImage(txStoneGround, 0, 0, 32, 8, o.x - 4, o.y - 8, bs + 8, 8);
      if (!hasS) ctx.drawImage(txStoneGround, 0, 24, 32, 8, o.x - 4, o.y + bs, bs + 8, 8);
      if (!hasE) ctx.drawImage(txStoneGround, 24, 0, 8, 32, o.x + bs, o.y - 4, 8, bs + 8);
      if (!hasW) ctx.drawImage(txStoneGround, 0, 0, 8, 32, o.x - 8, o.y - 4, 8, bs + 8);
      ctx.globalAlpha = 1;
    }
  }

  // -- Pass 1: drop shadows below walls (south-exposed edges) --
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (var i = 0; i < gameObstacles.length; i++) {
    var o = gameObstacles[i];
    if (o.destroyed) continue;
    if (o.x + bs < viewL || o.x > viewR || o.y + bs < viewT || o.y > viewB) continue;
    if (!wallLookup.has(o.x + "," + (o.y + bs))) {
      ctx.fillRect(o.x + 2, o.y + bs, bs - 4, 6);
    }
    // Small east shadow too
    if (!wallLookup.has((o.x + bs) + "," + o.y)) {
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(o.x + bs, o.y + 2, 4, bs - 4);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
    }
  }

  // -- Pass 2: draw wall tiles with texture --
  for (var i = 0; i < gameObstacles.length; i++) {
    var o = gameObstacles[i];
    if (o.destroyed) continue;
    if (o.x + o.size < viewL || o.x > viewR || o.y + o.size < viewT || o.y > viewB) continue;
    var s = o.size;

    if (useWallTex) {
      // Pick fill tile based on position for subtle variety
      var tv = ((Math.floor(o.x / bs) * 7 + Math.floor(o.y / bs) * 13) & 0x7FFFFFFF) % 6;
      var src = wallSrc[tv];
      // Draw wall fill texture (32px source scaled to 40px game block)
      ctx.drawImage(txWall, src[0], src[1], 32, 32, o.x, o.y, s, s);

      // Check neighbors for edge rendering
      var hasN = wallLookup.has(o.x + "," + (o.y - bs));
      var hasS = wallLookup.has(o.x + "," + (o.y + bs));
      var hasE = wallLookup.has((o.x + bs) + "," + o.y);
      var hasW = wallLookup.has((o.x - bs) + "," + o.y);

      // Dark edge on exposed sides (wall border / outline effect)
      if (!hasN || !hasS || !hasE || !hasW) {
        ctx.fillStyle = "rgba(35,25,15,0.5)";
        if (!hasN) ctx.fillRect(o.x, o.y, s, 2);
        if (!hasS) ctx.fillRect(o.x, o.y + s - 2, s, 2);
        if (!hasE) ctx.fillRect(o.x + s - 2, o.y, 2, s);
        if (!hasW) ctx.fillRect(o.x, o.y, 2, s);
        // Light inner highlight (bevel effect on opposite edges)
        ctx.fillStyle = "rgba(255,230,180,0.12)";
        if (!hasS) ctx.fillRect(o.x + 2, o.y + 1, s - 4, 1);
        if (!hasE) ctx.fillRect(o.x + 1, o.y + 2, 1, s - 4);
      }
    } else {
      // Fallback: procedural crate-style blocks
      ctx.fillStyle = "#6b5b3d";
      ctx.fillRect(o.x, o.y, s, s);
      ctx.strokeStyle = "#3d3225";
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, s - 2, s - 2);
      ctx.strokeStyle = "rgba(255,230,180,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(o.x + 2, o.y + s - 2);
      ctx.lineTo(o.x + 2, o.y + 2);
      ctx.lineTo(o.x + s - 2, o.y + 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(o.x + 3, o.y + 3);
      ctx.lineTo(o.x + s - 3, o.y + s - 3);
      ctx.moveTo(o.x + s - 3, o.y + 3);
      ctx.lineTo(o.x + 3, o.y + s - 3);
      ctx.stroke();
    }
  }
}

// Render ground decorations (plants, grass tufts, props — visual only)
function renderDecorations() {
  if (!mapDecorations.length) return;
  var hasPlant = txPlant.complete && txPlant.naturalWidth > 0;
  var hasProps = txProps.complete && txProps.naturalWidth > 0;
  if (!hasPlant && !hasProps) return;
  var cx = Math.floor(cameraX);
  var cy = Math.floor(cameraY);
  var vw = GAME_CONFIG.VIEWPORT_WIDTH;
  var vh = GAME_CONFIG.VIEWPORT_HEIGHT;
  for (var i = 0; i < mapDecorations.length; i++) {
    var d = mapDecorations[i];
    // Viewport cull
    if (d.x + d.dw < cx - 20 || d.x - d.dw > cx + vw + 20) continue;
    if (d.y + d.dh < cy - 20 || d.y - d.dh > cy + vh + 20) continue;
    var sheet = (d.sheet === "props") ? txProps : txPlant;
    if (!sheet.complete || sheet.naturalWidth === 0) continue;
    ctx.globalAlpha = d.alpha;
    ctx.drawImage(sheet, d.sx, d.sy, d.sw, d.sh, d.x - d.dw / 2, d.y - d.dh / 2, d.dw, d.dh);
  }
  ctx.globalAlpha = 1;
}

function render() {
  const frameNow = Date.now();
  _framePlayer = players.find((p) => p.id === playerId);
  const framePlayer = _framePlayer;

  // Update camera position to follow local player (smooth lerp to reduce stutter)
  if (framePlayer) {
    // Sniper zoom: smoothly transition camera scale
    const targetScale = (framePlayer.weapon === "sniper") ? CAMERA_SCALE_SNIPER : CAMERA_SCALE_DEFAULT;
    CAMERA_SCALE += (targetScale - CAMERA_SCALE) * 0.12;
    // Update viewport size based on current camera scale
    GAME_CONFIG.VIEWPORT_WIDTH = Math.ceil(window.innerWidth / CAMERA_SCALE);
    GAME_CONFIG.VIEWPORT_HEIGHT = Math.ceil(window.innerHeight / CAMERA_SCALE);

    const targetCamX = predictedX - GAME_CONFIG.VIEWPORT_WIDTH / 2;
    const targetCamY = predictedY - GAME_CONFIG.VIEWPORT_HEIGHT / 2;
    // Clamp camera to arena bounds (with padding so edge players stay visible)
    const pad = GAME_CONFIG.ARENA_PADDING;
    const clampedX = Math.max(-pad, Math.min(GAME_CONFIG.ARENA_WIDTH + pad - GAME_CONFIG.VIEWPORT_WIDTH, targetCamX));
    const clampedY = Math.max(-pad, Math.min(GAME_CONFIG.ARENA_HEIGHT + pad - GAME_CONFIG.VIEWPORT_HEIGHT, targetCamY));
    // Smooth camera interpolation to prevent jitter from server reconciliation
    const CAMERA_LERP = 0.25;
    if (cameraX === 0 && cameraY === 0 && !_cameraInitialized) {
      cameraX = clampedX;
      cameraY = clampedY;
      _cameraInitialized = true;
    } else {
      cameraX += (clampedX - cameraX) * CAMERA_LERP;
      cameraY += (clampedY - cameraY) * CAMERA_LERP;
    }
    // Recompute world-space mouse from screen coords every frame
    mouseX = screenMouseX / CAMERA_SCALE + cameraX;
    mouseY = screenMouseY / CAMERA_SCALE + cameraY;
  }

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply camera scale (zoom out to see more)
  ctx.save();
  ctx.scale(CAMERA_SCALE, CAMERA_SCALE);

  // Draw grid background using cached tile pattern (grass texture or fallback grid)
  ensureGridCanvas();
  if (!gridPatternCache) gridPatternCache = ctx.createPattern(gridCanvas, "repeat");
  ctx.save();
  ctx.fillStyle = gridPatternCache;
  // Offset pattern to align with camera (use actual pattern tile dimensions)
  var _gpw = gridCanvas.width, _gph = gridCanvas.height;
  ctx.translate(-((Math.floor(cameraX) % _gpw) + _gpw) % _gpw, -((Math.floor(cameraY) % _gph) + _gph) % _gph);
  ctx.fillRect(0, 0, GAME_CONFIG.VIEWPORT_WIDTH + _gpw, GAME_CONFIG.VIEWPORT_HEIGHT + _gph);
  ctx.restore();

  // Draw arena boundary — out-of-bounds overlay + border line
  {
    const aw = GAME_CONFIG.ARENA_WIDTH;
    const ah = GAME_CONFIG.ARENA_HEIGHT;
    const pad = GAME_CONFIG.ARENA_PADDING;
    const cx = Math.floor(cameraX);
    const cy = Math.floor(cameraY);
    const vw = GAME_CONFIG.VIEWPORT_WIDTH;
    const vh = GAME_CONFIG.VIEWPORT_HEIGHT;

    ctx.save();
    ctx.translate(-cx, -cy);

    // Visible range in world coords
    const visL = cx - 2, visT = cy - 2, visR = cx + vw + 2, visB = cy + vh + 2;

    // 1) Dark void beyond the padded area
    ctx.fillStyle = "#111";
    if (visT < -pad) ctx.fillRect(visL, visT, visR - visL, -pad - visT);
    if (visB > ah + pad) ctx.fillRect(visL, ah + pad, visR - visL, visB - (ah + pad));
    if (visL < -pad) ctx.fillRect(visL, -pad, -pad - visL, ah + 2 * pad);
    if (visR > aw + pad) ctx.fillRect(aw + pad, -pad, visR - (aw + pad), ah + 2 * pad);

    // 2) Semi-transparent overlay on the padding zone (outside playable, inside void)
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    // Top strip
    if (visT < 0) ctx.fillRect(Math.max(visL, -pad), Math.max(visT, -pad), Math.min(visR, aw + pad) - Math.max(visL, -pad), Math.min(0, visB) - Math.max(visT, -pad));
    // Bottom strip
    if (visB > ah) ctx.fillRect(Math.max(visL, -pad), Math.max(ah, visT), Math.min(visR, aw + pad) - Math.max(visL, -pad), Math.min(visB, ah + pad) - Math.max(ah, visT));
    // Left strip (between top/bottom)
    if (visL < 0) ctx.fillRect(Math.max(visL, -pad), Math.max(visT, 0), Math.min(0, visR) - Math.max(visL, -pad), Math.min(visB, ah) - Math.max(visT, 0));
    // Right strip (between top/bottom)
    if (visR > aw) ctx.fillRect(Math.max(aw, visL), Math.max(visT, 0), Math.min(visR, aw + pad) - Math.max(aw, visL), Math.min(visB, ah) - Math.max(visT, 0));

    // 3) Playable boundary line
    ctx.strokeStyle = "rgba(255,60,60,0.55)";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, aw, ah);

    ctx.restore();
  }

  // Screen shake offset
  updateScreenShake();
  const shakeOffset = getScreenShakeOffset();

  // Push camera transform — all world drawing happens in world coordinates
  ctx.save();
  ctx.translate(-Math.floor(cameraX) + shakeOffset.x, -Math.floor(cameraY) + shakeOffset.y);

  // Update interpolation for smooth movement
  updateInterpolation();

  // Update UI and effects
  updateBloodParticles();
  updateMuzzleFlashes();
  updateShellCasings();
  updateImpactSparks();
  updateDustClouds();
  updateHitMarkers();
  updateDamageIndicators();
  updateFloatingNumbers();
  updateKillEffects();
  updateDeathAnimations();

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

  // Render ground decorations (plants, grass tufts — below walls)
  renderDecorations();

  // Render obstacles (walls — ground layer)
  renderObstacles();

  // Render blood stains (on ground, batched by color for performance)
  const bloodColors = ["#7a0000", "#900000", "#550000"];
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = bloodColors[c];
    bloodStains.forEach((stain) => {
      if (stain.color !== c) return;
      if (!isOnScreen(stain.x, stain.y)) return;
      ctx.globalAlpha = stain.opacity * 0.7;
      ctx.beginPath();
      ctx.arc(stain.x, stain.y, stain.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1.0;

  // Render dust clouds (ground level)
  renderDustClouds();

  // Find bounty leader ONCE (player with most kills, minimum 2)
  let bountyLeaderId = null;
  let maxKills = 1;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hp > 0 && players[i].kills > maxKills) {
      maxKills = players[i].kills;
      bountyLeaderId = players[i].id;
    }
  }

  // Find the #1 player by kills (crown leader) — minimum 2 kills, must be alive
  let crownLeaderId = null;
  let crownMaxKills = 1;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hp > 0 && (players[i].kills || 0) > crownMaxKills) {
      crownMaxKills = players[i].kills;
      crownLeaderId = players[i].id;
    }
  }

  players.forEach((p, index) => {
    // Dead player corpse: show fading body for a short time after death
    if (p.hp <= 0) {
      const deathTime = playerDeathTimes.get(p.id);
      if (!deathTime) return; // no recorded death time
      const elapsed = Date.now() - deathTime;
      const CORPSE_FADE_MS = 2500;
      if (elapsed > CORPSE_FADE_MS) return; // fully faded — skip
      const corpseAlpha = Math.max(0, 1 - elapsed / CORPSE_FADE_MS) * 0.55;
      const corpseX = p.x;
      const corpseY = p.y;
      if (!isOnScreen(corpseX, corpseY)) return;
      ctx.globalAlpha = corpseAlpha;
      // Draw fallen body shape
      ctx.fillStyle = "#3a3a3a";
      ctx.beginPath();
      ctx.arc(corpseX, corpseY, 13, 0, Math.PI * 2);
      ctx.fill();
      // X eyes
      ctx.strokeStyle = "#777";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(corpseX - 5, corpseY - 3); ctx.lineTo(corpseX - 2, corpseY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(corpseX - 2, corpseY - 3); ctx.lineTo(corpseX - 5, corpseY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(corpseX + 2, corpseY - 3); ctx.lineTo(corpseX + 5, corpseY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(corpseX + 5, corpseY - 3); ctx.lineTo(corpseX + 2, corpseY); ctx.stroke();
      // Small skull icon above corpse
      if (elapsed < 2000) {
        ctx.font = "10px serif";
        ctx.textAlign = "center";
        ctx.fillText("💀", corpseX, corpseY - 16);
        ctx.textAlign = "start";
      }
      ctx.globalAlpha = 1.0;
      return;
    }

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

    // Draw player sprite (replaces circle body + weapon)
    var spriteImg = getPlayerSprite(skinIndex, p.weapon);
    if (spriteImg && spriteImg.complete && spriteImg.naturalWidth > 0) {
      ctx.save();
      ctx.translate(renderX, renderY);
      ctx.rotate(gunAngle);
      // Draw sprite centered on player, offset slightly so gun points forward
      ctx.drawImage(spriteImg, -SPRITE_RENDER_W * 0.35, -SPRITE_RENDER_H / 2, SPRITE_RENDER_W, SPRITE_RENDER_H);
      ctx.restore();
    } else {
      // Fallback: draw circle body + weapon if sprites not loaded
      ctx.save();
      ctx.translate(renderX, renderY);
      ctx.rotate(gunAngle);
      if (p.weapon === "shotgun") {
        ctx.fillStyle = "#3a2a1a";
        ctx.fillRect(4, -3, 20, 6);
        ctx.fillStyle = "#444";
        ctx.fillRect(24, -3.5, 5, 3);
        ctx.fillRect(24, 0.5, 5, 3);
      } else if (p.weapon === "sniper") {
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(4, -2, 30, 4);
        ctx.fillStyle = "#4488ff";
        ctx.fillRect(14, -5, 4, 3);
      } else {
        ctx.fillStyle = "#333";
        ctx.fillRect(4, -2.5, 20, 5);
        ctx.fillStyle = "#555";
        ctx.fillRect(24, -3, 5, 6);
      }
      ctx.restore();
      // Fallback circle body
      ctx.fillStyle = darkColor;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 13, 0, Math.PI * 2);
      ctx.fill();
      if (p.username) {
        ctx.font = "bold 14px 'Rajdhani', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(p.username.charAt(0).toUpperCase(), renderX, renderY + 1);
        ctx.textBaseline = "alphabetic";
      }
    }

    // ---- Dot at player head position (green = local, red = others) ----
    {
      var headPos = getHeadWorldPosition(renderX, renderY, gunAngle, p.weapon || "machinegun");
      var dotColor = (p.id === playerId) ? "#33ff55" : "#ff3333";
      ctx.fillStyle = dotColor;
      ctx.shadowColor = dotColor;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(headPos.x, headPos.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Golden crown on the #1 player (highest score)
    if (crownLeaderId === p.id) {
      const crownY = renderY - 34;
      const crownBob = Math.sin(Date.now() / 400) * 1.5;
      ctx.save();
      ctx.translate(renderX, crownY + crownBob);
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.moveTo(-8, 3);
      ctx.lineTo(-8, -1);
      ctx.lineTo(-5, 1);
      ctx.lineTo(-2, -5);
      ctx.lineTo(0, -1);
      ctx.lineTo(2, -5);
      ctx.lineTo(5, 1);
      ctx.lineTo(8, -1);
      ctx.lineTo(8, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#daa520";
      ctx.fillRect(-8, 2, 16, 2);
      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur = 6;
      ctx.fillStyle = "rgba(255, 215, 0, 0.15)";
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Username below player
    if (p.username) {
      ctx.font = "bold 10px 'Rajdhani', sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeText(p.username, renderX, renderY + 28);
      ctx.fillStyle = (p.id === playerId) ? "#ffcc66" : "#bbccbb";
      ctx.fillText(p.username, renderX, renderY + 28);
      ctx.textAlign = "start";
    }

    // ── Reload indicator (circular arc above player) ──
    if (p.reloading) {
      var reloadArcY = renderY - 30;
      var reloadArcR = 10;
      // Estimate progress based on time (rough visual, not exact sync)
      var rDur = p.weapon === "shotgun" ? 2200 : p.weapon === "sniper" ? 2800 : 1800;
      var rElapsed = 0;
      if (p.id === playerId && reloadStartTime > 0) {
        rElapsed = Date.now() - reloadStartTime;
      } else {
        // For other players, use a 50% estimate animation
        rElapsed = (Date.now() % rDur);
      }
      var rProgress = Math.min(1, rElapsed / rDur);

      // Background arc
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(renderX, reloadArcY, reloadArcR, -Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
      // Progress arc
      ctx.strokeStyle = (p.id === playerId) ? "#ff8833" : "#ff6644";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(renderX, reloadArcY, reloadArcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rProgress);
      ctx.stroke();
      // "R" text
      ctx.font = "bold 8px 'Share Tech Mono', monospace";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("R", renderX, reloadArcY);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "start";
    }
  });

  // Render bullets — update predicted bullets and check wall collision
  bullets = bullets.filter(function(b) {
    if (b.predicted && b.dx !== undefined) {
      b.x += b.dx;
      b.y += b.dy;
      // Check obstacle collision for predicted bullets
      for (var oi = 0; oi < gameObstacles.length; oi++) {
        var ob = gameObstacles[oi];
        if (b.x >= ob.x && b.x <= ob.x + ob.size && b.y >= ob.y && b.y <= ob.y + ob.size) {
          createImpactSparks(b.x, b.y);
          return false; // Remove this bullet
        }
      }
      // Remove if out of bounds
      if (b.x < 0 || b.x > GAME_CONFIG.arenaWidth || b.y < 0 || b.y > GAME_CONFIG.arenaHeight) {
        return false;
      }
    }
    return true;
  });
  bullets.forEach((b) => {

    // Compute bullet travel angle for sprite rotation
    let angle;
    if (b.dx !== undefined && b.dy !== undefined) {
      // Client-predicted bullet: use velocity
      angle = Math.atan2(b.dy, b.dx);
    } else if (b.angle !== undefined) {
      // Server bullet: use protocol-provided angle
      angle = b.angle;
    } else {
      angle = 0;
    }

    // Pick sprite and size per weapon
    let bulletSprite, bw, bh;
    if (b.weapon === "shotgun") {
      bulletSprite = spriteShotgunBullet;
      bw = 10; bh = 10;
    } else if (b.weapon === "sniper") {
      bulletSprite = spriteSniperBullet;
      bw = 28; bh = 10;
    } else {
      // machinegun / default
      bulletSprite = spriteRifleBullet;
      bw = 16; bh = 8;
    }

    if (bulletSprite.complete && bulletSprite.naturalWidth > 0) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(angle);
      ctx.drawImage(bulletSprite, -bw / 2, -bh / 2, bw, bh);
      ctx.restore();
    } else {
      // Fallback: simple dot while sprite loads
      ctx.fillStyle = "#ffcc44";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Render shell casings
  renderShellCasings();

  // Render blood particles
  renderBloodParticles();

  // Render muzzle flashes
  renderMuzzleFlashes();

  // Render impact sparks
  renderImpactSparks();

  // Render hit markers and damage indicators
  renderHitMarkers();
  renderDamageIndicators();

  // Render floating damage numbers
  renderFloatingNumbers();

  // Render kill effects (fire, ice, lightning)
  renderKillEffects();

  // Render death animations (ragdoll particles)
  renderDeathAnimations();

  // === End world-space rendering — restore camera transform ===
  ctx.restore(); // Restore camera translate+shake

  // === Restore camera scale — switch to screen-space for HUD overlays ===
  ctx.restore(); // Restore camera scale

  // Render crosshair (in screen space)
  if (framePlayer) {
    const crossX = (mouseX - cameraX) * CAMERA_SCALE;
    const crossY = (mouseY - cameraY) * CAMERA_SCALE;

    const isReloading = framePlayer.reloading;
    const isEmpty = framePlayer.shots <= 0 && !isReloading;

    // Dim crosshair when reloading or empty
    const crossAlpha = isReloading ? 0.35 : isEmpty ? 0.4 : 0.8;
    const crossColor = isEmpty ? "rgba(255,80,50," + crossAlpha + ")" : "rgba(255,170,68," + crossAlpha + ")";

    // Tactical crosshair
    ctx.strokeStyle = crossColor;
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

    // Reload progress arc around crosshair
    if (isReloading && reloadStartTime > 0) {
      const rElapsed = Date.now() - reloadStartTime;
      const rProg = Math.min(1, rElapsed / (reloadDuration || 1800));
      ctx.strokeStyle = "rgba(255,140,50,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(crossX, crossY, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rProg);
      ctx.stroke();
    }

    // Center dot
    ctx.fillStyle = crossColor;
    ctx.beginPath();
    ctx.arc(crossX, crossY, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ===== BOTTOM-CENTER HUD: Ammo + Score =====
  if (framePlayer && gameReady) {
    const localP = framePlayer;
    const hudY = canvas.height - 30;
    const hudCenterX = canvas.width / 2;

    // Background bar
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const hudW = 340, hudH = 44;
    const hudRX = hudCenterX - hudW / 2, hudRY = hudY - hudH / 2;
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(hudRX + r, hudRY);
    ctx.lineTo(hudRX + hudW - r, hudRY);
    ctx.quadraticCurveTo(hudRX + hudW, hudRY, hudRX + hudW, hudRY + r);
    ctx.lineTo(hudRX + hudW, hudRY + hudH - r);
    ctx.quadraticCurveTo(hudRX + hudW, hudRY + hudH, hudRX + hudW - r, hudRY + hudH);
    ctx.lineTo(hudRX + r, hudRY + hudH);
    ctx.quadraticCurveTo(hudRX, hudRY + hudH, hudRX, hudRY + hudH - r);
    ctx.lineTo(hudRX, hudRY + r);
    ctx.quadraticCurveTo(hudRX, hudRY, hudRX + r, hudRY);
    ctx.closePath();
    ctx.fill();

    // HP section (left)
    const hpPercent = localP.hp / maxHp;
    const hpColor = hpPercent > 0.5 ? "#4ad94a" : hpPercent > 0.25 ? "#d9a04a" : "#d94a4a";
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(hudRX + 8, hudY - 4, 80, 8);
    ctx.fillStyle = hpColor;
    ctx.fillRect(hudRX + 8, hudY - 4, 80 * hpPercent, 8);
    ctx.font = "bold 11px 'Share Tech Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(localP.hp + "/" + maxHp, hudRX + 48, hudY - 8);

    // Ammo section (center) — enhanced with better feedback
    const weaponMaxAmmo = localP.weapon === "shotgun" ? 8 : localP.weapon === "sniper" ? 5 : 35;
    const ammoRatio = localP.shots / weaponMaxAmmo;
    const lowAmmoThresh = 0.2;

    if (localP.reloading) {
      // ── RELOAD PROGRESS BAR ──
      const elapsed = Date.now() - reloadStartTime;
      const progress = Math.min(1, elapsed / (reloadDuration || 1800));
      const barW = 100, barH = 6;
      const barX = hudCenterX - barW / 2, barY = hudY - 8;

      // Background
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(barX, barY, barW, barH);
      // Progress fill (orange → green as it completes)
      const rC = Math.floor(255 * (1 - progress));
      const gC = Math.floor(100 + 155 * progress);
      ctx.fillStyle = "rgb(" + rC + "," + gC + ",50)";
      ctx.fillRect(barX, barY, barW * progress, barH);
      // Border
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);

      // Pulsing "RELOADING" text
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.008);
      ctx.font = "bold 13px 'Share Tech Mono', monospace";
      ctx.fillStyle = "rgba(255,107,53," + pulse.toFixed(2) + ")";
      ctx.textAlign = "center";
      ctx.fillText("RELOADING", hudCenterX, hudY + 8);
    } else if (localP.shots === 0) {
      // ── EMPTY MAG — urgent warning ──
      const blink = Math.sin(Date.now() * 0.012) > 0 ? 1.0 : 0.3;
      ctx.font = "bold 14px 'Share Tech Mono', monospace";
      ctx.fillStyle = "rgba(255,50,50," + blink.toFixed(2) + ")";
      ctx.textAlign = "center";
      ctx.fillText("EMPTY — PRESS R", hudCenterX, hudY + 4);
    } else {
      // ── Normal ammo display with low-ammo coloring ──
      var ammoColor;
      if (ammoRatio <= lowAmmoThresh) {
        // Critical: pulsing red-orange
        const cPulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.006);
        ammoColor = "rgba(255,70,30," + cPulse.toFixed(2) + ")";
      } else if (ammoRatio <= 0.4) {
        ammoColor = "#ff8844";
      } else {
        ammoColor = "#ddeedd";
      }
      ctx.font = "bold 13px 'Share Tech Mono', monospace";
      ctx.fillStyle = ammoColor;
      ctx.textAlign = "center";
      ctx.fillText(localP.shots + " / " + weaponMaxAmmo, hudCenterX, hudY - 1);

      // Ammo pips (small dots showing individual rounds remaining)
      if (weaponMaxAmmo <= 10) {
        const pipY = hudY + 8;
        const pipSpacing = 8;
        const pipStartX = hudCenterX - ((weaponMaxAmmo - 1) * pipSpacing) / 2;
        for (let pi = 0; pi < weaponMaxAmmo; pi++) {
          if (pi < localP.shots) {
            ctx.fillStyle = ammoRatio <= lowAmmoThresh ? "#ff6633" : "#aaddaa";
          } else {
            ctx.fillStyle = "rgba(80,80,80,0.6)";
          }
          ctx.beginPath();
          ctx.arc(pipStartX + pi * pipSpacing, pipY, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Low ammo warning indicator
      if (lowAmmoWarningShown) {
        ctx.font = "bold 10px 'Share Tech Mono', monospace";
        ctx.fillStyle = "rgba(255,140,40,0.8)";
        ctx.textAlign = "center";
        ctx.fillText("LOW AMMO", hudCenterX, hudRY - 4);
      }
    }

    // Kills section (right)
    ctx.font = "bold 12px 'Rajdhani', sans-serif";
    ctx.fillStyle = "#ff6b53";
    ctx.textAlign = "center";
    ctx.fillText("💀 " + (localP.kills || 0), hudRX + hudW - 45, hudY - 3);

    ctx.textAlign = "start";

    // ── Weapon selector (above HUD bar) showing 1=Rifle 2=Shotgun 3=Sniper ──
    {
      const weaponSlots = [
        { key: "1", name: "RIFLE", weapon: "machinegun" },
        { key: "2", name: "SHOTGUN", weapon: "shotgun" },
        { key: "3", name: "SNIPER", weapon: "sniper" },
      ];
      const slotW = 68, slotH = 28, slotGap = 4;
      const totalSlotsW = weaponSlots.length * slotW + (weaponSlots.length - 1) * slotGap;
      const slotStartX = hudCenterX - totalSlotsW / 2;
      const slotY = hudRY - slotH - 6;
      const currentWeapon = localP.weapon || "machinegun";

      for (let wi = 0; wi < weaponSlots.length; wi++) {
        const slot = weaponSlots[wi];
        const sx = slotStartX + wi * (slotW + slotGap);
        const isActive = slot.weapon === currentWeapon;

        // Slot background
        if (isActive) {
          ctx.fillStyle = "rgba(255,170,68,0.25)";
        } else {
          ctx.fillStyle = "rgba(0,0,0,0.35)";
        }
        // Rounded mini rect
        const sr = 3;
        ctx.beginPath();
        ctx.moveTo(sx + sr, slotY);
        ctx.lineTo(sx + slotW - sr, slotY);
        ctx.quadraticCurveTo(sx + slotW, slotY, sx + slotW, slotY + sr);
        ctx.lineTo(sx + slotW, slotY + slotH - sr);
        ctx.quadraticCurveTo(sx + slotW, slotY + slotH, sx + slotW - sr, slotY + slotH);
        ctx.lineTo(sx + sr, slotY + slotH);
        ctx.quadraticCurveTo(sx, slotY + slotH, sx, slotY + slotH - sr);
        ctx.lineTo(sx, slotY + sr);
        ctx.quadraticCurveTo(sx, slotY, sx + sr, slotY);
        ctx.closePath();
        ctx.fill();

        // Active border
        if (isActive) {
          ctx.strokeStyle = "rgba(255,170,68,0.7)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Key number
        ctx.font = "bold 10px 'Share Tech Mono', monospace";
        ctx.fillStyle = isActive ? "#ffaa44" : "rgba(180,180,180,0.5)";
        ctx.textAlign = "left";
        ctx.fillText(slot.key, sx + 4, slotY + 14);

        // Weapon name
        ctx.font = "bold 9px 'Share Tech Mono', monospace";
        ctx.fillStyle = isActive ? "#ffffff" : "rgba(160,160,160,0.6)";
        ctx.textAlign = "center";
        ctx.fillText(slot.name, sx + slotW / 2 + 4, slotY + 9);

        // Per-weapon ammo count
        const slotMaxAmmo = slot.weapon === "shotgun" ? 8 : slot.weapon === "sniper" ? 5 : 35;
        const slotAmmo = isActive ? localP.shots : (weaponAmmoState[slot.weapon] != null ? weaponAmmoState[slot.weapon] : slotMaxAmmo);
        ctx.font = "bold 7px 'Share Tech Mono', monospace";
        if (slotAmmo === 0) {
          ctx.fillStyle = isActive ? "#ff4444" : "rgba(255,80,80,0.5)";
        } else {
          ctx.fillStyle = isActive ? "rgba(200,220,200,0.9)" : "rgba(140,140,140,0.5)";
        }
        ctx.fillText(slotAmmo + "/" + slotMaxAmmo, sx + slotW / 2 + 4, slotY + 19);
      }
      ctx.textAlign = "start";
    }

    // ── Reload flash overlay (brief screen-edge tint when reload starts/ends) ──
    if (reloadFlashAlpha > 0.01) {
      reloadFlashAlpha *= 0.92;
      ctx.fillStyle = "rgba(255,140,40," + (reloadFlashAlpha * 0.15).toFixed(3) + ")";
      ctx.fillRect(0, canvas.height - 60, canvas.width, 60);
    }
  }

  // Kill feed
  if (gameReady) {
    renderKillFeed();
  }

  // Render minimap
  renderMinimap();

  // Low HP vignette (drawn on top of everything)
  renderLowHPVignette();

  requestAnimationFrame(render);
}

render();
