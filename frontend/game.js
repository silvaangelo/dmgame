// ===== MSGPACK PROTOCOL WRAPPERS =====
function serialize(data) {
  return MessagePack.encode(data);
}
function deserialize(raw) {
  return MessagePack.decode(new Uint8Array(raw));
}

// ===== HTML ESCAPING (XSS prevention) =====
function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Game configuration constants
const GAME_CONFIG = {
  ARENA_WIDTH: 1400,
  ARENA_HEIGHT: 900,
  PLAYER_RADIUS: 16,
  PLAYER_SPEED: 8,
  SHOTS_PER_MAGAZINE: 30,
  MAX_BLOOD_STAINS: 150,
  MAX_PARTICLES: 100,
  MAX_EXPLOSIONS: 8,
  MAX_BLOOD_EFFECTS: 10,
  MAX_IMPACT_SPARKS: 12,
  MUZZLE_FLASH_DURATION: 100,
  EXPLOSION_PARTICLE_COUNT: 12,
  BLOOD_PARTICLE_COUNT: 8,
  KILLS_TO_WIN: 5,
  KNIFE_SPEED_BONUS: 1.5,
  PICKUP_SPEED_MULTIPLIER: 1.5,
};

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
const WEAPON_CYCLE = ["machinegun", "shotgun", "knife", "sniper"];
const WEAPON_NAMES = {
  machinegun: "🔫 Metralhadora",
  shotgun: "🔫 Shotgun",
  knife: "🔪 Faca",
  minigun: "🔥 Minigun",
  sniper: "🎯 Sniper",
};
const WEAPON_COOLDOWNS = {
  machinegun: 60,
  shotgun: 500,
  knife: 200,
  minigun: 18,
  sniper: 1200,
};
const WEAPON_KILL_ICONS = {
  machinegun: "🔫",
  shotgun: "🔫",
  knife: "🔪",
  minigun: "🔥",
  sniper: "🎯"
};

let ws;
let playerId;
let players = [];
let bullets = [];
let obstacles = [];
let pickups = [];
let mouseX = 700;
let mouseY = 450;
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

// Celebration system (match end explosions + audio)
let celebrationInterval = null;
let celebrationIsWinner = false;
let victoryCountdownInterval = null;

// Cached DOM elements (avoid getElementById in hot paths)
let _cachedDOM = null;
function getCachedDOM() {
  if (!_cachedDOM) {
    _cachedDOM = {
      killsDisplay: document.getElementById("killsDisplay"),
      shotsDisplay: document.getElementById("shotsDisplay"),
      healthDisplay: document.getElementById("healthDisplay"),
      cooldownDisplay: document.getElementById("cooldownDisplay"),
      reloadDisplay: document.getElementById("reloadDisplay"),
      hpBarFill: document.getElementById("hpBarFill"),
      speedBoostDisplay: document.getElementById("speedBoostDisplay"),
      killFeed: document.getElementById("killFeed"),
      playerListContent: document.getElementById("playerListContent"),
    };
  }
  return _cachedDOM;
}

// Pre-rendered obstacle canvas (static, invalidated only on destroy)
let obstacleCanvas = null;
let obstacleCanvasDirty = true;

// Kill feed dirty flag (avoid innerHTML comparison)
let killFeedDirty = true;

// Screen shake
let screenShake = { intensity: 0, decay: 0.92 };
let killFeedEntries = [];
const KILL_FEED_DURATION = 4000;
const KILL_FEED_MAX = 5;

// Skins
let selectedSkin = 0;
let currentRoomData = null;

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

// Interpolation for smooth movement
const playerTargets = new Map(); // Store target positions for other players
let lastStateTime = 0;
const INTERPOLATION_SPEED = 0.45; // How fast to interpolate (0-1)
let lastShootTime = 0;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Responsive canvas sizing
function resizeCanvas() {
  const maxW = window.innerWidth * 0.92;
  const maxH = window.innerHeight * 0.85;
  const arenaAspect = GAME_CONFIG.ARENA_WIDTH / GAME_CONFIG.ARENA_HEIGHT;
  let displayW, displayH;
  if (maxW / maxH > arenaAspect) {
    displayH = maxH;
    displayW = maxH * arenaAspect;
  } else {
    displayW = maxW;
    displayH = maxW / arenaAspect;
  }
  canvas.style.width = displayW + "px";
  canvas.style.height = displayH + "px";
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

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
    bloodStains = bloodStains.slice(-GAME_CONFIG.MAX_BLOOD_STAINS);
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
  if (killEffects.length > 15) killEffects = killEffects.slice(-15);
}

function updateKillEffects() {
  killEffects.forEach((effect) => {
    effect.frame++;
    effect.particles.forEach((p) => {
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
    });
  });
  killEffects = killEffects.filter((e) => e.particles.some((p) => p.life > 0));
}

function renderKillEffects() {
  killEffects.forEach((effect) => {
    effect.particles.forEach((p) => {
      if (p.life <= 0) return;
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
    });
  });
  ctx.globalAlpha = 1.0;
}

// Death animation system (ragdoll explosion particles)
function createDeathAnimation(x, y, skinIndex) {
  const skin = SKINS[skinIndex] || SKINS[0];
  const particles = [];
  const count = 10;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    const isBody = i < 4; // First few are body-colored

    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      life: 1.0,
      size: isBody ? (4 + Math.random() * 4) : (2 + Math.random() * 3),
      color: isBody ? skin.primary : `rgb(${139 + Math.floor(Math.random() * 80)}, 0, 0)`,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
    });
  }

  deathAnimations.push({ particles, frame: 0 });
  if (deathAnimations.length > 10) deathAnimations = deathAnimations.slice(-10);
}

function updateDeathAnimations() {
  deathAnimations.forEach((anim) => {
    anim.frame++;
    anim.particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // Gravity
      p.vx *= 0.97;
      p.rotation += p.rotSpeed;
      p.life -= 0.015;
    });
  });
  deathAnimations = deathAnimations.filter((a) => a.particles.some((p) => p.life > 0));
}

function renderDeathAnimations() {
  deathAnimations.forEach((anim) => {
    anim.particles.forEach((p) => {
      if (p.life <= 0) return;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size * p.life, p.size * p.life);
      ctx.restore();
    });
  });
  ctx.globalAlpha = 1.0;
}

function updateExplosions() {
  explosions.forEach((explosion) => {
    explosion.frame++;
    explosion.particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // Gravity
      p.vx *= 0.98; // Air resistance
      p.life -= 0.02;
    });
  });

  // Remove dead explosions
  explosions = explosions.filter((e) => e.particles.some((p) => p.life > 0));
  if (explosions.length > GAME_CONFIG.MAX_EXPLOSIONS) {
    explosions = explosions.slice(-GAME_CONFIG.MAX_EXPLOSIONS);
  }

  // Update blood particles
  bloodParticles.forEach((blood) => {
    blood.frame++;
    blood.particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2; // Gravity
      p.vx *= 0.95; // Air resistance
      p.life -= 0.025;
    });
  });

  // Remove dead blood effects
  bloodParticles = bloodParticles.filter((b) =>
    b.particles.some((p) => p.life > 0),
  );
  if (bloodParticles.length > GAME_CONFIG.MAX_BLOOD_EFFECTS) {
    bloodParticles = bloodParticles.slice(-GAME_CONFIG.MAX_BLOOD_EFFECTS);
  }
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
  muzzleFlashes = muzzleFlashes.filter(
    (flash) => now - flash.timestamp < GAME_CONFIG.MUZZLE_FLASH_DURATION,
  );
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
  knifeSlashes = knifeSlashes.filter(
    (slash) => now - slash.timestamp < slash.duration,
  );

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
  if (shellCasings.length > 50) shellCasings = shellCasings.slice(-50);
}

function updateShellCasings() {
  shellCasings.forEach((s) => {
    s.x += s.vx;
    s.y += s.vy;
    s.vx *= 0.92;
    s.vy *= 0.92;
    s.rotation += s.rotSpeed;
    s.rotSpeed *= 0.95;
    s.life -= 0.012;
  });
  shellCasings = shellCasings.filter((s) => s.life > 0);
}

function renderShellCasings() {
  shellCasings.forEach((s) => {
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
  });
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
  impactSparks.forEach((impact) => {
    impact.frame++;
    impact.particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.vx *= 0.96;
      p.life -= 0.04;
    });
  });
  impactSparks = impactSparks.filter((i) =>
    i.particles.some((p) => p.life > 0),
  );
  if (impactSparks.length > GAME_CONFIG.MAX_IMPACT_SPARKS) {
    impactSparks = impactSparks.slice(-GAME_CONFIG.MAX_IMPACT_SPARKS);
  }
}

function renderImpactSparks() {
  impactSparks.forEach((impact) => {
    impact.particles.forEach((p) => {
      if (p.life > 0) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });
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
  if (dustClouds.length > 40) dustClouds = dustClouds.slice(-40);
}

function updateDustClouds() {
  dustClouds.forEach((d) => {
    d.x += d.vx;
    d.y += d.vy;
    d.size += 0.1;
    d.life -= 0.02;
    d.vx *= 0.98;
  });
  dustClouds = dustClouds.filter((d) => d.life > 0);
}

function renderDustClouds() {
  dustClouds.forEach((d) => {
    ctx.globalAlpha = d.opacity * d.life;
    ctx.fillStyle = "#8a7a60";
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1.0;
}

// Hit marker system — visual feedback when you hit an enemy
function createHitMarker() {
  hitMarkers.push({ life: 1.0, timestamp: Date.now() });
  if (hitMarkers.length > 5) hitMarkers.shift();
}

function updateHitMarkers() {
  hitMarkers.forEach((h) => { h.life -= 0.04; });
  hitMarkers = hitMarkers.filter((h) => h.life > 0);
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
  damageIndicators.forEach((d) => { d.life -= 0.025; });
  damageIndicators = damageIndicators.filter((d) => d.life > 0);
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
  floatingNumbers.forEach((f) => {
    f.y += f.vy;
    f.vy -= 0.02; // Slow upward acceleration
    f.life -= 0.02;
  });
  floatingNumbers = floatingNumbers.filter((f) => f.life > 0);
}

function renderFloatingNumbers() {
  if (floatingNumbers.length === 0) return;
  floatingNumbers.forEach((f) => {
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
  });
  ctx.globalAlpha = 1.0;
}

// Low HP vignette rendering
let lowHPVignetteGradient = null;
let lowHPVignetteW = 0;
let lowHPVignetteH = 0;

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
  explosions.forEach((explosion) => {
    explosion.particles.forEach((p) => {
      if (p.life > 0) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    });
  });

  // Render blood particles
  bloodParticles.forEach((blood) => {
    blood.particles.forEach((p) => {
      if (p.life > 0) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    });
  });
}

// ===== MOVEMENT PREDICTION =====

// Movement prediction function (matches server logic)
function applyInput(x, y, keys, weapon, speedBoosted) {
  const knifeBonus = weapon === "knife" ? GAME_CONFIG.KNIFE_SPEED_BONUS : 1;
  const boostMultiplier = speedBoosted ? GAME_CONFIG.PICKUP_SPEED_MULTIPLIER : 1;
  const speed = GAME_CONFIG.PLAYER_SPEED * knifeBonus * boostMultiplier;
  const playerRadius = GAME_CONFIG.PLAYER_RADIUS;
  const margin = playerRadius;
  let newX = x;
  let newY = y;

  // X axis movement + collision
  const oldX = newX;
  if (keys.a) newX -= speed;
  if (keys.d) newX += speed;
  newX = Math.max(margin, Math.min(GAME_CONFIG.ARENA_WIDTH - margin, newX));
  for (const obs of obstacles) {
    if (obs.destroyed) continue;
    const cx = Math.max(obs.x, Math.min(newX, obs.x + obs.size));
    const cy = Math.max(obs.y, Math.min(newY, obs.y + obs.size));
    const dx = newX - cx;
    const dy = newY - cy;
    if (dx * dx + dy * dy < playerRadius * playerRadius) {
      newX = oldX;
      break;
    }
  }

  // Y axis movement + collision
  const oldY = newY;
  if (keys.w) newY -= speed;
  if (keys.s) newY += speed;
  newY = Math.max(margin, Math.min(GAME_CONFIG.ARENA_HEIGHT - margin, newY));
  for (const obs of obstacles) {
    if (obs.destroyed) continue;
    const cx = Math.max(obs.x, Math.min(newX, obs.x + obs.size));
    const cy = Math.max(obs.y, Math.min(newY, obs.y + obs.size));
    const dx = newX - cx;
    const dy = newY - cy;
    if (dx * dx + dy * dy < playerRadius * playerRadius) {
      newY = oldY;
      break;
    }
  }

  return { x: newX, y: newY };
}

// ===== WEB AUDIO SYSTEM =====

let audioCtx = null;
const audioBuffers = {};
let readyAlarmSource = null;
let readyAlarmGain = null;
const activeGameSources = [];
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
  gain.gain.value = volume;
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
  const finalVolume = volume * (0.05 + 0.95 * attenuation);
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

let previousHP = 3;

// Return to lobby (called from victory countdown or Voltar button)
function returnToLobby() {
  if (victoryCountdownInterval) { clearInterval(victoryCountdownInterval); victoryCountdownInterval = null; }

  // Hide victory screen and game UI
  document.getElementById("victoryScreen").style.display = "none";
  document.getElementById("game").style.display = "none";
  document.getElementById("gameUI").style.display = "none";
  document.getElementById("playerList").style.display = "none";
  document.getElementById("readyScreen").style.display = "none";
  document.getElementById("killFeed").style.display = "none";

  // Hide mobile controls
  const mobileCtrl = document.getElementById("mobileControls");
  if (mobileCtrl) mobileCtrl.classList.remove("active");

  // Show room list (player stays logged in)
  document.getElementById("lobbyLayout").style.display = "";
  document.getElementById("roomListScreen").style.display = "block";
  if (document.getElementById("inGameControls")) document.getElementById("inGameControls").style.display = "none";

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
  bombExplosions = [];
  activeLightnings = [];
  lightningBolts = [];
  killEffects = [];
  deathAnimations = [];
  flashbangOverlay = { alpha: 0, flicker: 0, flickerVal: 0 };
  pageFlashIntensity = 0;
  document.body.style.filter = "";
  if (celebrationInterval) { clearInterval(celebrationInterval); celebrationInterval = null; }
  previousBulletPositions.clear();
  screenShake = { intensity: 0, decay: 0.92 };
  currentRoomData = null;
  killFeedEntries = [];
  killFeedDirty = true;
  obstacleCanvasDirty = true;
  _cachedDOM = null;
  previousPlayerStates.clear();
  gameReady = false;
  floatingNumbers = [];
  lowHPPulseTime = 0;
  lowHPVignetteGradient = null;
  stopHeartbeat();
  lastKilledByUsername = "";
  pendingDeathWeapon.clear();

  // Remove any active toasts
  activeToasts.forEach((t) => t.remove());
  activeToasts = [];
}

// Skip victory screen instantly (Voltar button)
function skipVictoryScreen() {
  returnToLobby();
}

// Confirm ready button click
function confirmReady() {
  if (!ws) return;

  // Stop alarm
  stopReadyAlarm();

  // Disable button
  const readyButton = document.getElementById("readyButton");
  readyButton.disabled = true;
  readyButton.style.opacity = "0.4";
  readyButton.style.background = "#2a3a2a";
  readyButton.textContent = "PRONTO ✓";

  // Send ready to server
  ws.send(serialize({ type: "ready" }));
}

// Update ready status display
function updateReadyStatus(readyCount, totalCount) {
  const waitingMsg = document.getElementById("waitingForPlayers");
  if (waitingMsg && readyCount !== undefined && totalCount !== undefined) {
    const waiting = totalCount - readyCount;
    if (waiting > 0) {
      waitingMsg.textContent = `Esperando ${waiting} jogador${waiting > 1 ? "es" : ""}...`;
      waitingMsg.style.fontSize = "16px";
      waitingMsg.style.fontWeight = "normal";
      waitingMsg.style.color = "#7a9a7a";
    } else {
      waitingMsg.textContent = "Todos prontos! Iniciando...";
      waitingMsg.style.fontSize = "16px";
      waitingMsg.style.fontWeight = "600";
      waitingMsg.style.color = "#4ad94a";
    }
  }
}

// Update global online list panel (visible on all screens)
function updateGlobalOnlineList(onlinePlayers) {
  const content = document.getElementById("globalOnlineContent");
  const countEl = document.getElementById("globalOnlineCount");
  if (!content) return;

  if (countEl) countEl.textContent = onlinePlayers ? onlinePlayers.length : 0;

  if (!onlinePlayers || onlinePlayers.length === 0) {
    content.innerHTML =
      '<p style="color: #8aaa8a; font-style: italic; font-size: 14px;">Nenhum jogador online</p>';
    return;
  }

  const statusColors = {
    online: "#4ad94a",
    "in-room": "#d9a04a",
    "in-game": "#d94a4a",
  };
  const statusLabels = {
    online: "Online",
    "in-room": "Na Sala",
    "in-game": "Jogando",
  };

  const html = onlinePlayers
    .map((p) => {
      const color = statusColors[p.status] || "#6a8a6a";
      const label = statusLabels[p.status] || p.status;
      const isMe = p.id === playerId;
      return `
      <div style="padding: 4px 7px; margin: 2px 0; border-radius: 2px; display: flex; justify-content: space-between; align-items: center; background: ${isMe ? "rgba(74,138,74,0.1)" : "rgba(255,255,255,0.02)"};">
        <span style="font-weight: ${isMe ? "600" : "400"}; color: ${isMe ? "#bbddbb" : "#a0b8a0"}; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; font-family: 'Rajdhani', sans-serif;">${esc(p.username)}${isMe ? "" : ""}</span>
        <span style="font-size: 11px; color: ${color}; display: flex; align-items: center; gap: 3px; white-space: nowrap; font-family: 'Share Tech Mono', monospace;">
          <span style="width: 6px; height: 6px; border-radius: 50%; background: ${color}; display: inline-block;"></span>
          ${label}
        </span>
      </div>
    `;
    })
    .join("");

  content.innerHTML = html;
}

// Update player list UI
let lastPlayerListUpdate = 0;
function updatePlayerList() {
  const now = Date.now();
  if (now - lastPlayerListUpdate < 250) return;
  lastPlayerListUpdate = now;

  const listContent = getCachedDOM().playerListContent;
  if (!listContent) return;

  const playerHTML = players
    .sort((a, b) => b.kills - a.kills)
    .map((p, index) => {
      const isMe = p.id === playerId;
      const isDead = p.hp <= 0;
      const isLeading = index === 0 && p.kills > 0;
      const killProgress = Math.min(
        100,
        (p.kills / GAME_CONFIG.KILLS_TO_WIN) * 100,
      );
      return `
        <div style="padding: 10px 15px; margin-bottom: 8px; background: ${isMe ? "rgba(255, 107, 53, 0.15)" : "rgba(255,255,255,0.03)"}; border-radius: 4px; border: 1px solid ${isDead ? "#333" : isLeading ? "#ffd700" : isMe ? "#ff6b35" : "#2a3a2a"}; min-width: 150px;">
          <div style="font-weight: ${isMe ? "bold" : "normal"}; color: ${isDead ? "#666" : "#f0f0f0"}; margin-bottom: 5px; font-size: 18px; font-family: 'Rajdhani', sans-serif;">
            ${isLeading ? "👑 " : ""}${esc(p.username)} ${isMe ? "(Você)" : ""} ${isDead ? "💀" : ""}
          </div>
          <div style="font-size: 15px; display: flex; gap: 10px; font-family: 'Share Tech Mono', monospace;">
            <span style="color: ${p.hp <= 1 ? '#ff5555' : p.hp <= 2 ? '#ffcc44' : '#55dd55'};">❤️ ${p.hp}/4</span>
            <span style="color: #ffaa44;">🎯 ${p.kills}/${GAME_CONFIG.KILLS_TO_WIN}</span>
            <span style="color: #aa88aa;">💀 ${p.deaths || 0}</span>
          </div>
          <div style="margin-top: 5px; background: #1a1f14; border-radius: 2px; height: 4px; overflow: hidden;">
            <div style="width: ${killProgress}%; height: 100%; background: linear-gradient(90deg, #ff6b35, #ff4422);"></div>
          </div>
        </div>
      `;
    })
    .join("");

  listContent.innerHTML = playerHTML;
}

// ===== MOUSE & SHOOTING =====

// Track mouse position for aiming
let lastAimSendTime = 0;
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);

  // Send aim direction to server (throttled — 33ms = ~30 updates/sec max)
  const now = Date.now();
  if (ws && playerId && gameReady && now - lastAimSendTime > 33) {
    const player = players.find((p) => p.id === playerId);
    if (player) {
      const aimAngle = Math.atan2(mouseY - predictedY, mouseX - predictedX);
      ws.send(serialize({ type: "aim", aimAngle }));
      lastAimSendTime = now;
    }
  }
});

// Hold to shoot - track mouse state
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) {
    // Left click only
    isMouseDown = true;
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (e.button === 0) {
    isMouseDown = false;
  }
});

canvas.addEventListener("mouseleave", () => {
  isMouseDown = false;
});

// Shooting function (called from game loop)
function tryShoot() {
  if (!ws || !playerId || !gameReady || !isMouseDown) return;

  const player = players.find((p) => p.id === playerId);
  if (!player) return;

  // Check cooldown based on weapon
  const now = Date.now();
  const cooldown = WEAPON_COOLDOWNS[player.weapon] || 200;
  if (now - lastShootTime < cooldown) return;

  if (
    player.weapon === "knife" ||
    player.weapon === "minigun" ||
    (player.shots > 0 && !player.reloading)
  ) {
    // Use predicted position for more accurate shooting
    const playerX = predictedX;
    const playerY = predictedY;

    // Calculate direction to mouse
    const dx = mouseX - playerX;
    const dy = mouseY - playerY;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Normalize direction
    let dirX = dx / length;
    let dirY = dy / length;

    // Apply client-side recoil prediction
    if (player.weapon === "machinegun" || player.weapon === "minigun") {
      const recoil = player.weapon === "minigun" ? 0.15 : 0.12;
      const recoilAngle = (Math.random() - 0.5) * 2 * recoil;
      const cos = Math.cos(recoilAngle);
      const sin = Math.sin(recoilAngle);
      const newDirX = dirX * cos - dirY * sin;
      const newDirY = dirX * sin + dirY * cos;
      dirX = newDirX;
      dirY = newDirY;
    }

    // Create visual effect based on weapon
    if (player.weapon === "knife") {
      const aimAngle = Math.atan2(dirY, dirX);
      createKnifeSlash(playerX, playerY, aimAngle);
      playKnifeSound(playerX, playerY);
    } else {
      createMuzzleFlash(playerX, playerY, dirX, dirY);
      if (player.weapon !== "knife") {
        createShellCasing(playerX, playerY, Math.atan2(dirY, dirX));
      }
      // Screen shake on shotgun shot (recoil feel)
      if (player.weapon === "shotgun") triggerScreenShake(6);
      if (player.weapon === "minigun") triggerScreenShake(2);
      if (player.weapon === "sniper") triggerScreenShake(8);
    }

    // Client-side bullet prediction (instant visual feedback)
    if (player.weapon !== "knife") {
      const bulletSpeed =
        player.weapon === "machinegun" ? 9 :
        player.weapon === "shotgun" ? 8 :
        player.weapon === "sniper" ? 16 : 9;

      if (player.weapon === "shotgun") {
        // Predict 6 pellets
        for (let i = 0; i < 6; i++) {
          const spreadAngle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 0.9;
          const pDirX = Math.cos(spreadAngle);
          const pDirY = Math.sin(spreadAngle);
          const pb = {
            id: "predicted_" + Date.now() + "_" + i,
            x: playerX, y: playerY,
            dx: pDirX * bulletSpeed, dy: pDirY * bulletSpeed,
            weapon: "shotgun", predicted: true,
          };
          bullets.push(pb);
          setTimeout(() => { bullets = bullets.filter((b) => b.id !== pb.id); }, 80);
        }
      }  else {
        const predictedBullet = {
          id: "predicted_" + Date.now(),
          x: playerX, y: playerY,
          dx: dirX * bulletSpeed, dy: dirY * bulletSpeed,
          weapon: player.weapon, predicted: true,
        };
        bullets.push(predictedBullet);
        setTimeout(() => { bullets = bullets.filter((b) => b.id !== predictedBullet.id); }, 100);
      }
    }

    ws.send(serialize({ type: "shoot", dirX, dirY }));
    lastShootTime = now;
  }
}

// ===== NETWORKING =====

let loggedInUsername = "";
let loggedIn = false;
let sessionToken = "";

// ===== SESSION PERSISTENCE =====

function saveSession(token, username) {
  sessionToken = token;
  loggedInUsername = username;

  // Save to localStorage
  try {
    localStorage.setItem("dm_token", token);
    localStorage.setItem("dm_username", username);
  } catch { /* private browsing */ }

  // Save to cookie (30 days, HttpOnly not possible from JS but use Secure + SameSite)
  document.cookie = `dm_token=${token}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Strict; Secure`;

  // Clear any legacy URL hash
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname);
  }
}

function loadSavedToken() {
  // Try localStorage first
  try {
    const token = localStorage.getItem("dm_token");
    if (token) return token;
  } catch { /* private browsing */ }

  // Try cookie
  const match = document.cookie.match(/dm_token=([a-f0-9]+)/);
  if (match) return match[1];

  return null;
}

async function checkExistingSession() {
  const savedToken = loadSavedToken();
  if (!savedToken) return null;
  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: savedToken }),
    });
    const data = await res.json();
    if (data.username && data.token) {
      saveSession(data.token, data.username);
      return { username: data.username, token: data.token };
    }
  } catch { /* offline or error */ }
  return null;
}

async function apiRegister(username) {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  saveSession(data.token, data.username);
  return data;
}

// ===== WEBSOCKET CONNECTION =====

function connectSpectator() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    // If we have a pending login, send it now
    if (loggedInUsername && !loggedIn) {
      if (sessionToken) {
        ws.send(serialize({ type: "login", token: sessionToken }));
      } else {
        ws.send(serialize({ type: "login", username: loggedInUsername }));
      }
    }
  };

  ws.onclose = () => {
    // Reconnect spectator if not logged in
    if (!loggedIn) {
      setTimeout(connectSpectator, 3000);
    }
  };

  setupWsMessageHandler();
}

async function login() {
  const username = document.getElementById("username").value;
  const loginButton = document.querySelector("#menu button");
  const errorElement = document.getElementById("usernameError");

  const trimmed = username.trim();
  const usernamePattern = /^[a-zA-Z0-9_]+$/;
  const minLen = 2;
  const maxLen = 16;

  if (!trimmed) {
    errorElement.textContent = "⚠ Digite um codinome!";
    errorElement.style.display = "block";
    return;
  }
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    errorElement.textContent = `⚠ O codinome deve ter ${minLen}-${maxLen} caracteres.`;
    errorElement.style.display = "block";
    return;
  }
  if (!usernamePattern.test(trimmed)) {
    errorElement.textContent = "⚠ Só letras, números e underline são permitidos.";
    errorElement.style.display = "block";
    return;
  }

  // Hide error if username is valid
  errorElement.style.display = "none";

  // Prevent double login
  if (loggedIn) return;

  // Disable button to prevent double-clicks
  loginButton.disabled = true;
  loginButton.style.opacity = "0.6";
  loginButton.textContent = "Conectando...";

  // Register via API first to get token
  try {
    await apiRegister(trimmed);
  } catch (err) {
    errorElement.textContent = "⚠ " + err.message;
    errorElement.style.display = "block";
    loginButton.disabled = false;
    loginButton.style.opacity = "1";
    loginButton.textContent = "ENTRAR";
    return;
  }

  loggedInUsername = trimmed;

  // Send WS login with token
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(serialize({ type: "login", token: sessionToken }));
  } else {
    connectSpectator();
  }
}

function setupWsMessageHandler() {
  ws.onmessage = (e) => {
    const data = deserialize(e.data);

    if (data.type === "error") {
      const errorEl = document.getElementById("usernameError");
      errorEl.textContent = "⚠ " + data.message;
      errorEl.style.display = "block";
      const loginButton = document.querySelector("#menu button");
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.style.opacity = "1";
        loginButton.textContent = "ENTRAR";
      }
      loggedInUsername = "";
      return;
    }

    if (data.type === "onlineList") {
      updateGlobalOnlineList(data.players);
    }

    if (data.type === "loginSuccess") {
      playerId = data.playerId;
      loggedIn = true;
      // Show room list screen
      document.getElementById("menu").style.display = "none";
      document.getElementById("roomListScreen").style.display = "block";
      // Fetch leaderboard to populate top 3
      requestLeaderboard();
    }

    if (data.type === "roomList") {
      updateRoomList(data.rooms);
    }

    if (data.type === "roomJoined") {
      currentRoomData = data.room;
      showRoomScreen(data.room);
    }

    if (data.type === "roomUpdate") {
      currentRoomData = data.room;
      updateRoomScreen(data.room);
      initSkinSelector();
    }

    if (data.type === "roomCountdown") {
      const el = document.getElementById("roomCountdown");
      if (el) {
        el.textContent = `⏰ Jogo começa em ${data.timeRemaining}s`;
        if (data.timeRemaining <= 10) {
          el.style.color = "#ff6b35";
        } else {
          el.style.color = "#d9a04a";
        }
      }
    }

    if (data.type === "roomKicked") {
      // Kicked from room (wasn't ready in time)
      document.getElementById("roomScreen").style.display = "none";
      document.getElementById("roomListScreen").style.display = "block";
    }

    if (data.type === "start") {
      document.getElementById("roomScreen").style.display = "none";
      document.getElementById("roomListScreen").style.display = "none";
      document.getElementById("menu").style.display = "none";
      document.getElementById("lobbyLayout").style.display = "none";
      canvas.style.display = "block";
      document.getElementById("gameUI").style.display = "block";
      document.getElementById("killFeed").style.display = "flex";
      document.getElementById("readyScreen").style.display = "block";
      if (document.getElementById("inGameControls")) document.getElementById("inGameControls").style.display = "block";

      players = data.players;
      obstacles = data.obstacles || [];
      const localP = players.find((p) => p.username === loggedInUsername);
      if (localP) playerId = localP.id;
      gameReady = false;
      obstacleCanvasDirty = true;
      _cachedDOM = null; // Refresh cached DOM references

      // Update arena dimensions from server
      if (data.arenaWidth) GAME_CONFIG.ARENA_WIDTH = data.arenaWidth;
      if (data.arenaHeight) GAME_CONFIG.ARENA_HEIGHT = data.arenaHeight;
      canvas.width = GAME_CONFIG.ARENA_WIDTH;
      canvas.height = GAME_CONFIG.ARENA_HEIGHT;
      gridCanvas = null; // Invalidate cached grid
      resizeCanvas();

      // Initialize audio system
      initAudio();

      // Hide ready button — match auto-starts
      const readyButton = document.getElementById("readyButton");
      readyButton.style.display = "none";

      // Show "preparing" message
      const waitingMsg = document.getElementById("waitingForPlayers");
      if (waitingMsg) {
        waitingMsg.textContent = "Preparando partida...";
        waitingMsg.style.fontSize = "20px";
        waitingMsg.style.color = "#d9a04a";
      }

      // Initialize predicted position
      const player = players.find((p) => p.id === playerId);
      if (player) {
        predictedX = player.x;
        predictedY = player.y;
      }

      // Update waiting message
      updateReadyStatus();
    }

    if (data.type === "readyUpdate") {
      updateReadyStatus(data.readyCount, data.totalCount);
    }

    if (data.type === "preGameCountdown") {
      const el = document.getElementById("preGameTimer");
      if (el) {
        el.textContent = `⏰ Auto-início em ${data.timeRemaining}s`;
        if (data.timeRemaining <= 5) {
          el.style.color = "#ff6b35";
        }
      }
    }

    if (data.type === "countdown") {
      // Show countdown overlay
      const waitingMsg = document.getElementById("waitingForPlayers");
      if (waitingMsg) {
        waitingMsg.textContent = `Começando em ${data.countdown}...`;
        waitingMsg.style.fontSize = "26px";
        waitingMsg.style.fontWeight = "700";
        waitingMsg.style.color = "#ff6b35";
      }
      const preGameEl = document.getElementById("preGameTimer");
      if (preGameEl) preGameEl.textContent = "";
    }

    if (data.type === "allReady") {
      gameReady = true;
      stopReadyAlarm();
      document.getElementById("readyScreen").style.display = "none";

      // On large screens, always show the scoreboard
      if (window.innerWidth > 1200) {
        const pl = document.getElementById("playerList");
        if (pl) pl.style.display = "block";
      }

      // Play match start sound (after 3s countdown finishes)
      playSound("matchstart", 0.7);

      // Show dramatic game start toast
      showToast("🔥 VAI! 🔥", "#ff6b35");

      // Update kills to win if provided
      if (data.killsToWin) {
        GAME_CONFIG.KILLS_TO_WIN = data.killsToWin;
      }

      // Update arena dimensions if provided
      if (data.arenaWidth) GAME_CONFIG.ARENA_WIDTH = data.arenaWidth;
      if (data.arenaHeight) GAME_CONFIG.ARENA_HEIGHT = data.arenaHeight;
      canvas.width = GAME_CONFIG.ARENA_WIDTH;
      canvas.height = GAME_CONFIG.ARENA_HEIGHT;
      gridCanvas = null; // Invalidate cached grid
      resizeCanvas();

      // Initialize mobile touch controls
      initMobileControls();
    }

    if (data.type === "respawn") {
      // Handle player respawn
      const respawnedPlayer = players.find((p) => p.id === data.playerId);
      if (respawnedPlayer) {
        respawnedPlayer.x = data.x;
        respawnedPlayer.y = data.y;
        respawnedPlayer.hp = 4; // Reset HP

        // Update interpolation target for respawned player
        if (data.playerId !== playerId) {
          playerTargets.set(data.playerId, {
            currentX: data.x,
            currentY: data.y,
            targetX: data.x,
            targetY: data.y,
          });
        } else {
          // Local player respawned
          predictedX = data.x;
          predictedY = data.y;
        }

        console.log(`🔄 ${respawnedPlayer.username} respawned!`);
      }
    }

    if (data.type === "newObstacle") {
      // Add new obstacle spawned during the game
      if (data.obstacle) {
        obstacles.push(data.obstacle);
        obstacleCanvasDirty = true;
        console.log("🌳 New obstacle spawned!");
      }
    }

    if (data.type === "obstacleDestroyed") {
      // Update obstacle when destroyed (bandwidth optimization)
      const obstacle = obstacles.find((o) => o.id === data.obstacleId);
      if (obstacle) {
        createImpactSparks(
          obstacle.x + obstacle.size / 2,
          obstacle.y + obstacle.size / 2,
        );
        obstacle.destroyed = true;
        obstacleCanvasDirty = true;
      }
    }

    if (data.type === "kill") {
      addKillFeedEntry(data.killer, data.victim, data.weapon);

      // Track weapon used for weapon-specific death effects
      pendingDeathWeapon.set(data.victim, data.weapon);

      // Show viral toast for local player involvement
      const localPlayer = players.find((p) => p.id === playerId);
      if (localPlayer) {
        if (data.killer === localPlayer.username) {
          // Revenge check
          if (data.isRevenge) {
            showToast("🔥 Você se vingou! VINGANÇA! 🔥", "#ff4400");
          } else {
            const phrase = SELF_KILL_PHRASES[Math.floor(Math.random() * SELF_KILL_PHRASES.length)]
              .replace("{victim}", data.victim);
            showToast(phrase, "#4ad94a");
          }
        } else if (data.victim === localPlayer.username) {
          lastKilledByUsername = data.killer;
          const phrase = DEATH_PHRASES[Math.floor(Math.random() * DEATH_PHRASES.length)]
            .replace("{killer}", data.killer);
          showToast(phrase, "#d94a4a");
        }
      }
    }

    if (data.type === "killStreak") {
      // Show kill streak announcement to everyone
      const streakColors = { 2: "#ffaa00", 3: "#ff6600", 5: "#ff2222", 7: "#ff00ff", 10: "#00ffff" };
      const color = streakColors[data.streak] || "#ffaa00";
      showToast(`🔥 ${data.player}: ${data.message}`, color);
      addKillFeedEntry(data.player, data.message, "streak");
    }

    if (data.type === "skinTaken") {
      showToast(data.message, "#ff6b35");
    }

    if (data.type === "playerDisconnected") {
      showToast(`⚠️ ${data.username} desconectou`, "#ff6b35");
    }

    if (data.type === "pickupCollected") {
      createPickupEffect(data.x, data.y, data.pickupType);
      if (data.playerId === playerId) {
        playPickupSound();
        const pickupMessages = {
          health: "❤️ Vida restaurada!",
          ammo: "🎯 Munição cheia!",
          speed: "⚡ Modo turbo!",
          minigun: "🔥 MINIGUN ATIVADA!",
        };
        showToast(pickupMessages[data.pickupType] || "✨ Bônus!", "#44bbff");
      }
    }

    if (data.type === "bombSpawned") {
      activeBombs.push({
        id: data.id,
        x: data.x,
        y: data.y,
        spawnTime: Date.now(),
      });
    }

    if (data.type === "bombExploded") {
      // Remove from active bombs
      activeBombs = activeBombs.filter((b) => b.id !== data.id);
      // Create visual explosion
      createBombExplosion(data.x, data.y, data.radius || 80);
      // Screen shake
      const dx = data.x - predictedX;
      const dy = data.y - predictedY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const shakeIntensity = Math.max(2, 15 - dist / 50);
      triggerScreenShake(shakeIntensity);
      // Mild white flash for very close explosions
      if (dist < 120) {
        const bombFlash = 0.3 * (1 - dist / 120);
        flashbangOverlay.alpha = Math.max(flashbangOverlay.alpha, bombFlash);
      }
      // Explosion sound
      playExplosionSound(data.x, data.y);
    }

    // ===== LIGHTNING STRIKE SYSTEM =====
    if (data.type === "lightningWarning") {
      activeLightnings.push({
        id: data.id,
        x: data.x,
        y: data.y,
        radius: data.radius || 100,
        spawnTime: Date.now(),
        fuseTime: 250,
      });
    }

    if (data.type === "lightningStruck") {
      // Remove from active warnings
      activeLightnings = activeLightnings.filter((l) => l.id !== data.id);
      const lx = data.x;
      const ly = data.y;
      const lRadius = data.radius || 100;

      // Calculate distance from player to lightning center
      const ldx = lx - predictedX;
      const ldy = ly - predictedY;
      const ldist = Math.sqrt(ldx * ldx + ldy * ldy);

      // Players INSIDE the lightning radius — full effect
      if (ldist < lRadius) {
        const proximity = 1.0 - ldist / lRadius;
        const volume = 0.3 + proximity * 0.35;
        playSound("lightning", volume, 0.9 + Math.random() * 0.2);

        // Screen shake: stronger at center
        const lShake = 5 + proximity * 13;
        triggerScreenShake(lShake);

        // Full white screen at center, fades over 3s (chaotic mode)
        flashbangOverlay.alpha = 0.9 + proximity * 0.1;
        flashbangOverlay.flicker = 1;
        // Full-page brightness/blur effect on the entire website
        applyPageFlash(0.8 + proximity * 0.2);
      } else if (ldist < lRadius * 2.5) {
        // Nearby but outside — rumble + distant thunder + mild page flash
        const nearFactor = 1.0 - (ldist - lRadius) / (lRadius * 1.5);
        triggerScreenShake(2 + nearFactor * 5);
        playSound("lightning", nearFactor * 0.2, 0.7 + Math.random() * 0.2);
        // Mild page flash for nearby players
        if (nearFactor > 0.3) {
          applyPageFlash(nearFactor * 0.4);
        }
      }

      // Always create the visual bolt on the map (visible if on screen)
      createLightningStrike(lx, ly, lRadius);
    }

    if (data.type === "leaderboard") {
      showLeaderboard(data.stats);
    }

    if (data.type === "myStats") {
      // Could display stats somewhere — for now just log
      console.log("My stats:", data.stats);
    }

    if (data.type === "state") {
      // Parse compact format: [id, x, y, hp, shots, reloading, lastInput, aimAngle, weapon, kills, skin, speedBoosted]
      const weaponCodeMap = { 0: "machinegun", 1: "shotgun", 2: "knife", 3: "minigun", 4: "sniper" };
      // Build username lookup map for O(1) access instead of O(n) per player
      const usernameMap = new Map();
      players.forEach((pl) => usernameMap.set(pl.id, pl.username));

      const parsedPlayers = (data.p || data.players || []).map((p) => {
        if (Array.isArray(p)) {
          // Compact format
          return {
            id: p[0],
            x: p[1],
            y: p[2],
            hp: p[3],
            shots: p[4],
            reloading: p[5] === 1,
            lastProcessedInput: p[6],
            aimAngle: p[7],
            weapon: weaponCodeMap[p[8]] || "machinegun",
            kills: p[9],
            skin: p[10] || 0,
            speedBoosted: p[11] === 1,
            shielded: p[12] === 1,
            invisible: p[13] === 1,
            regen: p[14] === 1,
            // Preserve username from existing player data
            username: usernameMap.get(p[0]) || "Jogador",
          };
        }
        return p; // Already object format
      });

      // Parse compact bullets: [id, x, y, weapon]
      const parsedBullets = (data.b || data.bullets || []).map((b) => {
        if (Array.isArray(b)) {
          return {
            id: b[0],
            x: b[1],
            y: b[2],
            weapon: weaponCodeMap[b[3]] || "machinegun",
          };
        }
        return b;
      });

      // Parse compact pickups: [id, x, y, typeCode]
      const pickupTypeMap = { 0: "health", 1: "ammo", 2: "speed", 3: "minigun", 4: "shield", 5: "invisibility", 6: "regen" };
      const parsedPickups = (data.pk || []).map((pk) => {
        if (Array.isArray(pk)) {
          return { id: pk[0], x: pk[1], y: pk[2], type: pickupTypeMap[pk[3]] || "health" };
        }
        return pk;
      });
      pickups = parsedPickups;

      // Check for deaths before updating players
      parsedPlayers.forEach((p) => {
        const prevState = previousPlayerStates.get(p.id);
        if (prevState && prevState.hp > 0 && p.hp <= 0) {
          // Player just died - create death animation (ragdoll particles)
          createDeathAnimation(p.x, p.y, p.skin || 0);

          // Weapon-specific death effects
          const deathWeapon = pendingDeathWeapon.get(p.username) || "machinegun";
          pendingDeathWeapon.delete(p.username);

          if (deathWeapon === "knife") {
            // Knife kills: extra blood splatter + ice effect
            createBlood(p.x, p.y);
            createBlood(p.x, p.y);
            createBlood(p.x, p.y);
            createBloodStain(p.x, p.y);
            createBloodStain(p.x, p.y);
            createBloodStain(p.x, p.y);
            createKillEffect(p.x, p.y, "ice");
          } else if (deathWeapon === "shotgun") {
            // Shotgun kills: body flying effect + fire effect
            for (let i = 0; i < 12; i++) {
              const angle = Math.random() * Math.PI * 2;
              const speed = 3 + Math.random() * 4;
              bloodParticles.push({
                particles: [{
                  x: p.x, y: p.y,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed - 2,
                  life: 1.0,
                  size: 3 + Math.random() * 4,
                  color: `rgb(${139 + Math.floor(Math.random() * 116)}, 0, 0)`,
                }],
                frame: 0,
              });
            }
            createBloodStain(p.x, p.y);
            createBloodStain(p.x, p.y);
            createKillEffect(p.x, p.y, "fire");
          } else if (deathWeapon === "sniper") {
            // Sniper kills: lightning effect (disintegration)
            createKillEffect(p.x, p.y, "lightning");
            createBlood(p.x, p.y);
          } else if (deathWeapon === "minigun") {
            // Minigun kills: fire + lightning
            createKillEffect(p.x, p.y, "fire");
            createKillEffect(p.x, p.y, "lightning");
          } else {
            // Default death (machinegun): lightning sparks
            createBlood(p.x, p.y);
            createBloodStain(p.x, p.y);
            createKillEffect(p.x, p.y, "lightning");
          }

          // Floating damage number for kill
          createFloatingNumber(p.x, p.y, prevState.hp);

          // Screen shake on explosions (stronger if it's us dying)
          if (p.id === playerId) {
            triggerScreenShake(12);
            stopHeartbeat();
          } else {
            triggerScreenShake(5);
          }
          // Play death sound with positional audio
          playPositionalSound("died", p.x, p.y, 0.5);
          // Hit marker for the killer (us)
          if (p.id !== playerId) createHitMarker();
        } else if (prevState && prevState.hp > p.hp && p.hp > 0) {
          // Player took damage but still alive - create blood
          const dmg = prevState.hp - p.hp;
          createBlood(p.x, p.y);
          // Create permanent blood stain
          createBloodStain(p.x, p.y);
          // Floating damage number
          createFloatingNumber(p.x, p.y, dmg);
          // Hit marker if it's an enemy (we likely shot them)
          if (p.id !== playerId) createHitMarker();
          // Damage indicator + screen shake if it's us taking damage
          if (p.id === playerId) {
            createDamageIndicator(p.x, p.y);
            triggerScreenShake(6);
            // Start heartbeat if at 1 HP
            if (p.hp === 1) {
              startHeartbeat();
            }
          }
        } else if (prevState && p.hp > prevState.hp && p.id === playerId) {
          // Healed — stop heartbeat if above 1 HP
          if (p.hp > 1) stopHeartbeat();
        }
        previousPlayerStates.set(p.id, { hp: p.hp, x: p.x, y: p.y });

        // Set interpolation targets for other players
        if (p.id !== playerId) {
          const current = playerTargets.get(p.id);
          if (current) {
            // Update target, keep current interpolated position
            playerTargets.set(p.id, {
              currentX: current.currentX,
              currentY: current.currentY,
              targetX: p.x,
              targetY: p.y,
            });
          } else {
            // First time seeing this player
            playerTargets.set(p.id, {
              currentX: p.x,
              currentY: p.y,
              targetX: p.x,
              targetY: p.y,
            });
          }
        }
      });

      // Detect bullet-wall/obstacle impacts (disappeared bullets)
      const currentBulletIdSet = new Set(parsedBullets.map((b) => b.id));
      previousBulletPositions.forEach((pos, id) => {
        if (!currentBulletIdSet.has(id)) {
          const margin = 25;
          const nearWall =
            pos.x < margin ||
            pos.x > GAME_CONFIG.ARENA_WIDTH - margin ||
            pos.y < margin ||
            pos.y > GAME_CONFIG.ARENA_HEIGHT - margin;
          let nearObstacle = false;
          for (const obs of obstacles) {
            if (obs.destroyed) continue;
            if (
              pos.x > obs.x - 10 &&
              pos.x < obs.x + obs.size + 10 &&
              pos.y > obs.y - 10 &&
              pos.y < obs.y + obs.size + 10
            ) {
              nearObstacle = true;
              break;
            }
          }
          if (nearWall || nearObstacle) {
            createImpactSparks(pos.x, pos.y);
          }
        }
      });

      // Detect new bullets for weapon-specific positional audio
      parsedBullets.forEach((b) => {
        if (!previousBulletPositions.has(b.id)) {
          if (b.weapon === "shotgun") {
            playPositionalSound("shotgun-shot", b.x, b.y, 0.45, 0.8 + Math.random() * 0.15);
          } else if (b.weapon === "sniper") {
            playPositionalSound("sniper-shot", b.x, b.y, 0.5, 0.95 + Math.random() * 0.1);
          } else {
            // Machinegun / minigun: rotate through machinegun-1..5
            machinegunSoundIndex = (machinegunSoundIndex % 5) + 1;
            playPositionalSound(`machinegun-${machinegunSoundIndex}`, b.x, b.y, 0.25, 1.1 + Math.random() * 0.3);
          }
        }
      });

      // Update bullet position tracking
      previousBulletPositions.clear();
      parsedBullets.forEach((b) =>
        previousBulletPositions.set(b.id, { x: b.x, y: b.y }),
      );

      players = parsedPlayers;
      bullets = parsedBullets;
      lastStateTime = Date.now();
      // Obstacles are only sent at game start, not in every state update

      // Update player list
      updatePlayerList();

      // Play reload sound when current player starts reloading
      const currentPlayer = players.find((p) => p.id === playerId);
      if (currentPlayer && currentPlayer.reloading && !wasReloading) {
        playSound("reload", 0.5);
      }
      wasReloading = currentPlayer ? currentPlayer.reloading : false;

      // Play scream sound when current player takes damage
      if (currentPlayer && currentPlayer.hp < previousHP) {
        playPositionalSound("scream", predictedX, predictedY, 0.6);
      }
      previousHP = currentPlayer ? currentPlayer.hp : 3;

      // Client-side prediction reconciliation
      if (currentPlayer) {
        const serverLastProcessed = currentPlayer.lastProcessedInput;

        // Remove acknowledged inputs
        pendingInputs = pendingInputs.filter(
          (input) => input.sequence > serverLastProcessed,
        );

        // Start from server position
        let reconciledX = currentPlayer.x;
        let reconciledY = currentPlayer.y;

        // Replay unacknowledged inputs
        pendingInputs.forEach((input) => {
          const result = applyInput(
            reconciledX,
            reconciledY,
            input.keys,
            currentPlayer.weapon,
            currentPlayer.speedBoosted,
          );
          reconciledX = result.x;
          reconciledY = result.y;
        });

        // Update predicted position
        predictedX = reconciledX;
        predictedY = reconciledY;

        // Clean old inputs (older than 1 second)
        const now = Date.now();
        pendingInputs = pendingInputs.filter((i) => now - i.timestamp < 1000);
      }
    }

    if (data.type === "end") {
      console.log("Game over! Winner:", data.winnerName);

      // Clear any previous celebration (e.g. from a race condition)
      if (celebrationInterval) { clearInterval(celebrationInterval); celebrationInterval = null; }
      if (victoryCountdownInterval) { clearInterval(victoryCountdownInterval); victoryCountdownInterval = null; }

      // Stop all in-game sounds (shots, bombs, etc.)
      stopAllGameSounds();
      stopHeartbeat();

      // Hide ready screen if showing
      document.getElementById("readyScreen").style.display = "none";

      // Determine if local player won
      const localPlayer = data.scoreboard.find((p) => p.username === loggedInUsername);
      const isLocalWinner = localPlayer && localPlayer.isWinner;

      // Play ONE win/lose sound
      const audioIdx = data.audioIndex || 1;
      const firstSound = isLocalWinner ? `win-${audioIdx}` : `lose-${audioIdx}`;
      playSound(firstSound, 0.7);

      // Start celebration: periodic bomb explosions (visual + one bomb sound each)
      celebrationIsWinner = isLocalWinner;
      let celebrationCount = 0;
      celebrationInterval = setInterval(() => {
        celebrationCount++;
        if (celebrationCount > 4) {
          clearInterval(celebrationInterval);
          celebrationInterval = null;
          return;
        }
        // Random position near the player view
        const cx = predictedX + (Math.random() - 0.5) * canvas.width * 0.7;
        const cy = predictedY + (Math.random() - 0.5) * canvas.height * 0.7;
        createBombExplosion(cx, cy, 50 + Math.random() * 40);
        triggerScreenShake(3 + Math.random() * 4);
        // One bomb sound per explosion
        const bIdx = Math.floor(Math.random() * 5) + 1;
        playSound(`bomb-${bIdx}`, 0.4, 0.9 + Math.random() * 0.2);
      }, 1100);

      // Sort scoreboard by kills descending
      const sorted = [...data.scoreboard].sort((a, b) => b.kills - a.kills);
      const endMedals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];

      // Winner showcase (top 3)
      const top3 = sorted.slice(0, 3);
      const showcaseHTML = top3.map((p, i) => {
        const initial = p.username.charAt(0).toUpperCase();
        const rank = i + 1;
        return `<div class="showcase-player rank-${rank}">
          <div class="showcase-avatar">
            ${initial}
            <span class="showcase-medal">${endMedals[i] || ""}</span>
          </div>
          <div class="showcase-name">${esc(p.username)}</div>
          <div class="showcase-kills">${p.kills}K / ${p.deaths}D</div>
        </div>`;
      }).join("");

      // Full scoreboard
      const scoreboardHTML = sorted.map((p, i) => {
        const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(1) : p.kills.toFixed(1);
        const isW = p.isWinner;
        return `<div class="vs-row ${isW ? "winner" : ""}">
          <span class="vs-rank">${isW ? "\uD83D\uDC51" : (i + 1) + "."}</span>
          <span class="vs-name">${esc(p.username)}</span>
          <span class="vs-stats">${p.kills}K / ${p.deaths}D (${kd})</span>
        </div>`;
      }).join("");

      // Pick a random viral phrase
      const viralPhrase = isLocalWinner
        ? WINNER_PHRASES[Math.floor(Math.random() * WINNER_PHRASES.length)].replace("{winner}", "Você")
        : LOSER_PHRASES[Math.floor(Math.random() * LOSER_PHRASES.length)].replace("{winner}", esc(data.winnerName));

      // Banner
      document.getElementById("victoryBanner").innerHTML =
        isLocalWinner ? "\uD83C\uDF89 \uD83C\uDF86 \uD83C\uDF89" : "\u2694\uFE0F \uD83D\uDC80 \u2694\uFE0F";
      document.getElementById("victoryMessage").innerHTML =
        isLocalWinner ? "\uD83C\uDFC6 VITÓRIA! \uD83C\uDFC6" : esc(data.winnerName) + " VENCEU!";
      document.getElementById("victorySubtext").innerHTML = viralPhrase;
      document.getElementById("victoryShowcase").innerHTML = showcaseHTML;
      document.getElementById("victoryScoreboard").innerHTML = scoreboardHTML;
      document.getElementById("victoryFooter").innerHTML = `
        <button id="voltarBtn" onclick="skipVictoryScreen()" style="padding: 14px 44px; font-size: 22px; font-weight: 700; background: linear-gradient(180deg, #3a5a3a 0%, #2a4a2a 100%); color: #f0f0f0; border: 1px solid #4a6a4a; border-radius: 2px; cursor: pointer; text-transform: uppercase; letter-spacing: 2px; font-family: 'Rajdhani', sans-serif;">\u21A9 Voltar</button>
        <p style="margin-top: 10px; font-size: 15px; color: #8aaa8a;">Voltando em <span id="countdownTimer" style="color: #ff6b35; font-weight: bold;">10</span>s...</p>
        <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 13px; color: #8aaa8a; line-height: 1.8;">
          <div style="color: #88ccff; font-weight: 600; margin-bottom: 4px;">\uD83C\uDFAE Controles</div>
          <div><kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#bbddbb;border:1px solid #3a5a3a;">WASD</kbd> Mover \u00b7 <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#bbddbb;border:1px solid #3a5a3a;">Click / Espaço</kbd> Atirar \u00b7 <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#bbddbb;border:1px solid #3a5a3a;">Q</kbd> Trocar Arma \u00b7 <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#bbddbb;border:1px solid #3a5a3a;">Tab</kbd> Placar</div>
          <div><kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#bbddbb;border:1px solid #3a5a3a;">1</kbd> Metralhadora \u00b7 <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#bbddbb;border:1px solid #3a5a3a;">2</kbd> Shotgun \u00b7 <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#bbddbb;border:1px solid #3a5a3a;">3</kbd> Faca \u00b7 <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#bbddbb;border:1px solid #3a5a3a;">4</kbd> Sniper</div>
        </div>
      `;
      document.getElementById("victoryScreen").style.display = "block";

      // Countdown from 10 to 1
      let countdown = 10;

      if (victoryCountdownInterval) clearInterval(victoryCountdownInterval);
      victoryCountdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          const timerElement = document.getElementById("countdownTimer");
          if (timerElement) {
            timerElement.textContent = countdown.toString();
          }
        } else {
          returnToLobby();
        }
      }, 1000);
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    const loginButton = document.querySelector("#menu button");
    if (loginButton) {
      loginButton.disabled = false;
      loginButton.style.opacity = "1";
      loginButton.style.background = "";
      loginButton.textContent = "ENTRAR";
    }
  };

  ws.onclose = () => {
    console.log("WebSocket closed");
    ws = null;
    loggedIn = false;

    // Clear online panel when disconnected
    const content = document.getElementById("globalOnlineContent");
    if (content) {
      content.innerHTML =
        '<p style="color: #8aaa8a; font-style: italic; font-size: 14px;">Conecte para ver jogadores</p>';
    }
    const countEl = document.getElementById("globalOnlineCount");
    if (countEl) countEl.textContent = "0";

    // Go back to login screen
    document.getElementById("roomListScreen").style.display = "none";
    document.getElementById("roomScreen").style.display = "none";
    document.getElementById("game").style.display = "none";
    document.getElementById("gameUI").style.display = "none";
    document.getElementById("playerList").style.display = "none";
    document.getElementById("readyScreen").style.display = "none";
    document.getElementById("killFeed").style.display = "none";
    document.getElementById("victoryScreen").style.display = "none";
    document.getElementById("lobbyLayout").style.display = "";
    document.getElementById("menu").style.display = "block";
    if (document.getElementById("inGameControls")) document.getElementById("inGameControls").style.display = "none";
    const mobileCtrlClose = document.getElementById("mobileControls");
    if (mobileCtrlClose) mobileCtrlClose.classList.remove("active");

    const loginBtn = document.querySelector("#menu button");
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.style.opacity = "1";
      loginBtn.textContent = "ENTRAR";
    }

    // Keep session token but reset login state for reconnection
    loggedInUsername = "";
    loggedIn = false;

    // If we have a saved session, restore username for auto-reconnect
    const savedToken = loadSavedToken();
    if (savedToken && savedToken === sessionToken) {
      try {
        const savedName = localStorage.getItem("dm_username");
        if (savedName) loggedInUsername = savedName;
      } catch { /* ignore */ }
    }

    // Reconnect spectator after a delay
    setTimeout(connectSpectator, 3000);
  };
}

// On page load: check for existing session, then connect
(async function init() {
  // Connect spectator WebSocket first for online list
  connectSpectator();

  // Check for saved session (token in localStorage/cookie or IP match)
  const session = await checkExistingSession();
  if (session) {
    loggedInUsername = session.username;
    sessionToken = session.token;

    // Pre-fill username input
    const usernameInput = document.getElementById("username");
    if (usernameInput) usernameInput.value = session.username;

    // Auto-login via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(serialize({ type: "login", token: session.token }));
    }
    // If WS isn't open yet, the onopen handler will send the login
  }
})();

// ===== ROOM UI FUNCTIONS =====

function renderTop3(stats) {
  const container = document.getElementById("top3Content");
  if (!container) return;

  if (!stats || stats.length === 0) {
    container.innerHTML = '<p style="color: #6a8a6a; font-style: italic; font-size: 14px;">Nenhum jogador ainda. Seja o primeiro!</p>';
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  container.innerHTML = stats.slice(0, 3).map((s, i) => {
    const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(1) : s.kills.toFixed(1);
    return `<div class="top3-entry">
      <span class="top3-medal">${medals[i]}</span>
      <span class="top3-name">${esc(s.username)}</span>
      <span class="top3-stats">${s.kills}K · ${s.wins}V · K/D ${kd}</span>
    </div>`;
  }).join("");
}

function updateRoomList(rooms) {
  const content = document.getElementById("roomListContent");
  if (!content) return;

  if (!rooms || rooms.length === 0) {
    content.innerHTML =
      '<p style="color: #8aaa8a; font-style: italic; font-size: 14px;">Nenhuma sala disponível. Crie uma!</p>';
    return;
  }

  content.innerHTML = rooms
    .map(
      (r) => {
        const safeId = String(r.id).replace(/[^a-f0-9-]/gi, "");
        return `
    <div class="room-item">
      <div class="room-info">
        <div class="room-name">⚔ ${esc(r.name)}</div>
        <div class="room-count">${r.playerCount}/${r.maxPlayers} jogadores</div>
      </div>
      <button onclick="doJoinRoom('${safeId}')">Entrar</button>
    </div>
  `;
      }
    )
    .join("");
}

function showRoomScreen(room) {
  document.getElementById("roomListScreen").style.display = "none";
  document.getElementById("roomScreen").style.display = "block";
  initSkinSelector();
  updateRoomScreen(room);
}

function updateRoomScreen(room) {
  const nameEl = document.getElementById("roomName");
  if (nameEl) nameEl.textContent = "⚔ " + room.name;

  const countdownEl = document.getElementById("roomCountdown");
  if (countdownEl) {
    if (room.timeRemaining !== null && room.timeRemaining !== undefined) {
      countdownEl.textContent = `⏰ Jogo começa em ${room.timeRemaining}s`;
    } else if (room.players.length < 2) {
      countdownEl.textContent = "Esperando mais jogadores...";
      countdownEl.style.color = "#8aaa8a";
    } else {
      countdownEl.textContent = "";
    }
  }

  const listEl = document.getElementById("roomPlayerList");
  if (listEl) {
    listEl.innerHTML = room.players
      .map(
        (p) => {
          const skinColor = SKINS[p.skin || 0] ? SKINS[p.skin || 0].primary : SKINS[0].primary;
          return `
      <div class="room-player">
        <span class="player-name"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${skinColor};margin-right:8px;vertical-align:middle;border:1px solid rgba(255,255,255,0.2);"></span>${esc(p.username)}${p.id === playerId ? " (Você)" : ""}</span>
        <span class="player-status ${p.ready ? "ready" : "waiting"}">${p.ready ? "✓ Pronto" : "⏳ Esperando"}</span>
      </div>
    `;
        }
      )
      .join("");
  }

  // Check if local player is already ready → disable button
  const localPlayer = room.players.find((p) => p.id === playerId);
  const readyBtn = document.getElementById("roomReadyBtn");
  if (readyBtn && localPlayer) {
    if (localPlayer.ready) {
      readyBtn.disabled = true;
      readyBtn.textContent = "✓ PRONTO!";
    } else {
      readyBtn.disabled = false;
      readyBtn.textContent = "⚔ ESTOU PRONTO! ⚔";
    }
  }
}

function doCreateRoom() {
  if (!ws) return;
  ws.send(serialize({ type: "createRoom" }));
}

function doJoinRoom(roomId) {
  if (!ws) return;
  ws.send(serialize({ type: "joinRoom", roomId }));
}

function doLeaveRoom() {
  if (!ws) return;

  // Reset room ready button
  const readyBtn = document.getElementById("roomReadyBtn");
  if (readyBtn) {
    readyBtn.disabled = false;
    readyBtn.textContent = "⚔ ESTOU PRONTO! ⚔";
  }

  ws.send(serialize({ type: "leaveRoom" }));
  currentRoomData = null;
  document.getElementById("roomScreen").style.display = "none";
  document.getElementById("roomListScreen").style.display = "block";
}

function doRoomReady() {
  if (!ws) return;

  const readyBtn = document.getElementById("roomReadyBtn");
  if (readyBtn) {
    readyBtn.disabled = true;
    readyBtn.textContent = "✓ PRONTO!";
  }

  // Initialize audio on first user interaction
  initAudio();

  ws.send(serialize({ type: "roomReady" }));
}

// ===== HUD DISPLAY =====

let lastShotUIUpdate = 0;
function updateShotUI() {
  const now = Date.now();
  if (now - lastShotUIUpdate < 100) return;
  lastShotUIUpdate = now;

  const player = players.find((p) => p.id === playerId);
  if (!player) return;

  const dom = getCachedDOM();
  const killsDisplay = dom.killsDisplay;
  const shotsDisplay = dom.shotsDisplay;
  const healthDisplay = dom.healthDisplay;
  const cooldownDisplay = dom.cooldownDisplay;
  const reloadDisplay = dom.reloadDisplay;
  const hpBarFill = dom.hpBarFill;

  // Update kills progress
  if (killsDisplay) {
    killsDisplay.textContent = `🏆 ${player.kills}/${GAME_CONFIG.KILLS_TO_WIN}`;
    if (player.kills >= GAME_CONFIG.KILLS_TO_WIN - 1) {
      killsDisplay.style.color = "#ff4422";
      killsDisplay.style.textShadow = "0 0 12px rgba(255,68,34,0.5)";
    } else {
      killsDisplay.style.color = "#ff6b35";
      killsDisplay.style.textShadow = "0 0 8px rgba(255,107,53,0.3)";
    }
  }

  const weaponName = WEAPON_NAMES[player.weapon] || "🔫 ???";
  const WEAPON_SHORTCUTS = { machinegun: "1", shotgun: "2", knife: "3", sniper: "4" };
  const shortcut = WEAPON_SHORTCUTS[player.weapon] || "";
  const shortcutTag = shortcut ? `[${shortcut}] ` : "";
  if (player.weapon === "knife") {
    shotsDisplay.textContent = `${shortcutTag}${weaponName} | Corpo a corpo`;
  } else if (player.weapon === "minigun") {
    shotsDisplay.textContent = `${weaponName} | ∞`;
  } else {
    shotsDisplay.textContent = `${shortcutTag}${weaponName} | ${player.shots}/30`;
  }

  // Show respawn message if dead
  if (player.hp <= 0) {
    healthDisplay.textContent = RESPAWN_PHRASES[Math.floor(Math.random() * RESPAWN_PHRASES.length)];
    if (hpBarFill) {
      hpBarFill.style.width = "0%";
      hpBarFill.className = "hud-hp-bar-fill";
    }
  } else {
    healthDisplay.textContent = `❤️ ${player.hp}/4`;
    if (hpBarFill) {
      const hpPercent = (player.hp / 4) * 100;
      hpBarFill.style.width = hpPercent + "%";
      if (player.hp <= 1) {
        hpBarFill.className = "hud-hp-bar-fill hp-danger";
      } else if (player.hp <= 2) {
        hpBarFill.className = "hud-hp-bar-fill hp-mid";
      } else {
        hpBarFill.className = "hud-hp-bar-fill";
      }
    }
  }

  const shotNow = Date.now();
  const timeSinceLastShot = shotNow - player.lastShotTime;
  const weaponCooldown = WEAPON_COOLDOWNS[player.weapon] || 200;

  // Show cooldown based on weapon
  if (
    timeSinceLastShot < weaponCooldown &&
    (player.weapon === "knife" || player.shots > 0) &&
    !player.reloading
  ) {
    const remaining = (weaponCooldown - timeSinceLastShot) / 1000;
    cooldownDisplay.textContent = `⏱️ ${remaining.toFixed(2)}s`;
  } else {
    cooldownDisplay.textContent = "";
  }

  // Show reload status
  if (player.reloading) {
    reloadDisplay.textContent = "🔄 RECARREGANDO...";
  } else {
    reloadDisplay.textContent = "";
  }

  // Show speed boost status
  const speedBoostDisplay = dom.speedBoostDisplay;
  if (speedBoostDisplay) {
    const parts = [];
    if (player.speedBoosted) parts.push("⚡ TURBO!");
    if (player.weapon === "minigun") parts.push("🔥 MINIGUN!");
    speedBoostDisplay.textContent = parts.join(" ");
  }
}

// ===== INPUT =====

const keysPressed = new Set();

document.addEventListener("keydown", (e) => {
  if (!ws || !gameReady) return;

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
  if (e.key === " ") {
    e.preventDefault();
    isMouseDown = true;
    return;
  }

  // Prevent duplicate events
  if (keysPressed.has(e.key)) return;
  keysPressed.add(e.key);

  // Map arrow keys to WASD
  let mappedKey = e.key;
  if (e.key === "ArrowUp") mappedKey = "w";
  if (e.key === "ArrowDown") mappedKey = "s";
  if (e.key === "ArrowLeft") mappedKey = "a";
  if (e.key === "ArrowRight") mappedKey = "d";

  // Q key to cycle weapons
  if (e.key === "q" || e.key === "Q") {
    ws.send(serialize({ type: "switchWeapon" }));
    return;
  }

  // Number keys 1-4 to select weapon directly
  if (e.key >= "1" && e.key <= "4") {
    const weapons = ["machinegun", "shotgun", "knife", "sniper"];
    const weaponIndex = parseInt(e.key) - 1;
    ws.send(serialize({ type: "switchWeapon", weapon: weapons[weaponIndex] }));
    return;
  }

  // R key to manually reload
  if (e.key === "r" || e.key === "R") {
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
        player.speedBoosted,
      );
      predictedX = predicted.x;
      predictedY = predicted.y;
    }
  }

  if (e.key === " ") {
    e.preventDefault(); // Prevent page scroll on space
    isMouseDown = true; // Let tryShoot() handle cooldowns and effects
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

  if (e.key === " ") {
    isMouseDown = false;
    return;
  }

  if (!ws || !gameReady) return;

  keysPressed.delete(e.key);

  // Map arrow keys to WASD
  let mappedKey = e.key;
  if (e.key === "ArrowUp") mappedKey = "w";
  if (e.key === "ArrowDown") mappedKey = "s";
  if (e.key === "ArrowLeft") mappedKey = "a";
  if (e.key === "ArrowRight") mappedKey = "d";

  if (
    mappedKey === "w" ||
    mappedKey === "a" ||
    mappedKey === "s" ||
    mappedKey === "d"
  ) {
    inputSequence++;

    // Update current keys state
    currentKeys[mappedKey] = false;

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
  if (!ws || !gameReady) return;
  for (const key of ["w", "a", "s", "d"]) {
    if (currentKeys[key]) {
      currentKeys[key] = false;
      inputSequence++;
      ws.send(serialize({ type: "keyup", key, sequence: inputSequence, timestamp: Date.now() }));
      pendingInputs.push({ sequence: inputSequence, keys: { ...currentKeys }, timestamp: Date.now() });
    }
  }
  keysPressed.clear();
  isMouseDown = false;
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
  const icon = weapon === "streak" ? "🔥" : (WEAPON_KILL_ICONS[weapon] || "💀");
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

// ===== SKINS =====

function initSkinSelector() {
  const container = document.getElementById("skinOptions");
  if (!container) return;
  // Determine which skins are taken by other players in the room
  const takenSkins = new Set();
  if (currentRoomData && currentRoomData.players) {
    currentRoomData.players.forEach((p) => {
      if (p.id !== playerId && p.skin !== undefined) {
        takenSkins.add(p.skin);
      }
    });
  }
  container.innerHTML = SKINS.map((skin, i) => {
    const isTaken = takenSkins.has(i);
    const isSelected = i === selectedSkin;
    return `<div class="skin-option ${isSelected ? "selected" : ""} ${isTaken ? "taken" : ""}" style="background: ${skin.primary};${isTaken ? "opacity:0.35;cursor:not-allowed;" : ""}" onclick="${isTaken ? "" : `selectSkin(${i})`}" title="${skin.name}${isTaken ? " (em uso)" : ""}"></div>`;
  }).join("");
}

function selectSkin(index) {
  selectedSkin = index;
  if (ws) ws.send(serialize({ type: "selectSkin", skin: index }));
  initSkinSelector();
}

// ===== LEADERBOARD =====

let leaderboardModalRequested = false;

function requestLeaderboard(openModal) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  leaderboardModalRequested = !!openModal;
  ws.send(serialize({ type: "getLeaderboard" }));
}

function showLeaderboard(stats) {
  const container = document.getElementById("leaderboardContent");
  if (!container) return;

  if (!stats || stats.length === 0) {
    container.innerHTML = '<p style="color: #8aaa8a; font-style: italic;">Nenhuma estatística ainda. Jogue uma partida!</p>';
  } else {
    container.innerHTML = stats.map((s, i) => {
      const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
      return `<div class="lb-row ${i === 0 ? "top" : ""}">
        <span class="lb-rank">${i + 1}.</span>
        <span class="lb-name">${i === 0 ? "👑 " : ""}${esc(s.username)}</span>
        <span class="lb-stats">${s.kills}K / ${s.deaths}M (${kd}) | ${s.wins}V / ${s.gamesPlayed}J</span>
      </div>`;
    }).join("");
  }

  // Always update the inline top 3 section
  renderTop3(stats);

  // Only open the modal if the user explicitly clicked the ranking button
  if (leaderboardModalRequested) {
    leaderboardModalRequested = false;
    document.getElementById("leaderboardModal").style.display = "block";
  }
}

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
  const colors = { health: "#ff4444", ammo: "#44ff44", speed: "#4488ff", minigun: "#ff8800" };
  const icons = { health: "❤️", ammo: "📦", speed: "⚡", minigun: "🔥" };
  pickupEffects.push({
    x, y,
    color: colors[pickupType] || "#ffffff",
    icon: icons[pickupType] || "✨",
    life: 1.0,
    timestamp: Date.now(),
  });
  if (pickupEffects.length > 20) pickupEffects = pickupEffects.slice(-20);
}

function updatePickupEffects() {
  pickupEffects.forEach((e) => {
    e.y -= 0.5;
    e.life -= 0.015;
  });
  pickupEffects = pickupEffects.filter((e) => e.life > 0);
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

function renderPickups() {
  const pickupColors = {
    health: "#ff4444", ammo: "#44bb44", speed: "#4488ff", minigun: "#ff8800",
    shield: "#44ddff", invisibility: "#aa66ff", regen: "#44ff88",
  };
  const pickupIcons = {
    health: "+", ammo: "A", speed: "S", minigun: "M",
    shield: "🛡", invisibility: "👻", regen: "♥",
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
    ctx.arc(pk.x, pk.y + floatY, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Pickup body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + floatY, 12, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + floatY, 12, 0, Math.PI * 2);
    ctx.stroke();

    // Icon
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, pk.x, pk.y + floatY);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
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
  if (bombExplosions.length > 12) bombExplosions = bombExplosions.slice(-12);
}

function updateBombExplosions() {
  bombExplosions.forEach((exp) => {
    exp.frame++;
    exp.shockwave += 8;
    exp.particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.vx *= 0.97;
      p.life -= 0.02;
    });
  });
  bombExplosions = bombExplosions.filter((e) => e.particles.some((p) => p.life > 0));
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
  if (lightningBolts.length > 8) lightningBolts = lightningBolts.slice(-8);
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
  lightningBolts = lightningBolts.filter((l) => now - l.timestamp < l.duration);

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
    pageFlashIntensity = Math.max(0, pageFlashIntensity - 0.006);
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
    // Decay over ~3 seconds
    flashbangOverlay.alpha = Math.max(0, flashbangOverlay.alpha - 0.005);
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
let gridCanvas = null;
function ensureGridCanvas() {
  if (gridCanvas) return;
  gridCanvas = document.createElement("canvas");
  gridCanvas.width = GAME_CONFIG.ARENA_WIDTH;
  gridCanvas.height = GAME_CONFIG.ARENA_HEIGHT;
  const gc = gridCanvas.getContext("2d");
  gc.fillStyle = "#2a3020";
  gc.fillRect(0, 0, GAME_CONFIG.ARENA_WIDTH, GAME_CONFIG.ARENA_HEIGHT);
  gc.strokeStyle = "rgba(65, 85, 60, 0.35)";
  gc.lineWidth = 0.5;
  for (let x = 0; x < GAME_CONFIG.ARENA_WIDTH; x += 40) {
    gc.beginPath();
    gc.moveTo(x, 0);
    gc.lineTo(x, GAME_CONFIG.ARENA_HEIGHT);
    gc.stroke();
  }
  for (let y = 0; y < GAME_CONFIG.ARENA_HEIGHT; y += 40) {
    gc.beginPath();
    gc.moveTo(0, y);
    gc.lineTo(GAME_CONFIG.ARENA_WIDTH, y);
    gc.stroke();
  }
}

function ensureObstacleCanvas() {
  if (obstacleCanvas && !obstacleCanvasDirty) return;
  if (!obstacleCanvas) {
    obstacleCanvas = document.createElement("canvas");
    obstacleCanvas.width = GAME_CONFIG.ARENA_WIDTH;
    obstacleCanvas.height = GAME_CONFIG.ARENA_HEIGHT;
  }
  const oc = obstacleCanvas.getContext("2d");
  oc.clearRect(0, 0, GAME_CONFIG.ARENA_WIDTH, GAME_CONFIG.ARENA_HEIGHT);
  obstacles.forEach((obstacle) => {
    if (obstacle.destroyed) return;
    if (obstacle.type === "tree") {
      oc.fillStyle = "#5a4a2a";
      oc.fillRect(obstacle.x + obstacle.size * 0.4, obstacle.y + obstacle.size * 0.5, obstacle.size * 0.2, obstacle.size * 0.5);
      oc.fillStyle = "#2a5a2a";
      oc.beginPath();
      oc.arc(obstacle.x + obstacle.size * 0.5, obstacle.y + obstacle.size * 0.3, obstacle.size * 0.35, 0, Math.PI * 2);
      oc.fill();
      oc.fillStyle = "#2a6a2a";
      oc.beginPath();
      oc.arc(obstacle.x + obstacle.size * 0.3, obstacle.y + obstacle.size * 0.4, obstacle.size * 0.25, 0, Math.PI * 2);
      oc.fill();
      oc.beginPath();
      oc.arc(obstacle.x + obstacle.size * 0.7, obstacle.y + obstacle.size * 0.4, obstacle.size * 0.25, 0, Math.PI * 2);
      oc.fill();
    } else {
      oc.fillStyle = "#555545";
      oc.fillRect(obstacle.x, obstacle.y, obstacle.size, obstacle.size);
      oc.strokeStyle = "#444434";
      oc.lineWidth = 1;
      oc.strokeRect(obstacle.x, obstacle.y, obstacle.size, obstacle.size);
      oc.strokeStyle = "#666656";
      oc.beginPath();
      oc.moveTo(obstacle.x + 2, obstacle.y + obstacle.size / 2);
      oc.lineTo(obstacle.x + obstacle.size - 2, obstacle.y + obstacle.size / 2);
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

function render() {
  const frameNow = Date.now();
  const framePlayer = players.find((p) => p.id === playerId);

  // Draw cached grid background (no per-frame line drawing)
  ensureGridCanvas();
  ctx.drawImage(gridCanvas, 0, 0);

  // Screen shake offset
  updateScreenShake();
  const shakeOffset = getScreenShakeOffset();
  if (shakeOffset.x !== 0 || shakeOffset.y !== 0) {
    ctx.save();
    ctx.translate(shakeOffset.x, shakeOffset.y);
  }

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

  // Render dust clouds (ground level)
  renderDustClouds();

  // Render obstacles from cached offscreen canvas
  ensureObstacleCanvas();
  ctx.drawImage(obstacleCanvas, 0, 0);

  // Render pickups
  renderPickups();
  renderPickupEffects();

  // Render bombs
  renderBombs();

  // Render lightning warnings
  renderLightningWarnings();

  // Find bounty leader ONCE (player with most kills, minimum 2)
  let bountyLeaderId = null;
  let maxKills = 1;
  for (let i = 0; i < players.length; i++) {
    if (players[i].hp > 0 && players[i].kills > maxKills) {
      maxKills = players[i].kills;
      bountyLeaderId = players[i].id;
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
      ctx.arc(renderX, renderY, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Shield bubble visual
    if (p.shielded) {
      const shieldPulse = 0.3 + Math.sin(Date.now() / 200) * 0.15;
      ctx.strokeStyle = `rgba(100, 200, 255, ${shieldPulse + 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(100, 200, 255, ${shieldPulse * 0.3})`;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    // Invisibility visual (ghostly fade for others, slight outline for self)
    if (p.invisible && p.id !== playerId) {
      ctx.globalAlpha = 0.15; // Nearly invisible to others
    } else if (p.invisible && p.id === playerId) {
      ctx.globalAlpha = 0.5; // Semi-transparent for self
    }

    // Health regen aura
    if (p.regen) {
      const regenPulse = 0.3 + Math.sin(Date.now() / 300) * 0.2;
      ctx.fillStyle = `rgba(50, 255, 100, ${regenPulse * 0.2})`;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(50, 255, 100, ${regenPulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw weapon
    ctx.save();
    ctx.translate(renderX, renderY);
    ctx.rotate(gunAngle);

    if (p.weapon === "knife") {
      // Knife handle
      ctx.fillStyle = "#5a3a1a";
      ctx.fillRect(8, -2, 12, 4);
      // Blade
      ctx.fillStyle = "#aab0b0";
      ctx.beginPath();
      ctx.moveTo(20, -3);
      ctx.lineTo(34, 0);
      ctx.lineTo(20, 3);
      ctx.closePath();
      ctx.fill();
      // Edge highlight
      ctx.strokeStyle = "#dde0e0";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(22, -1);
      ctx.lineTo(31, 0);
      ctx.stroke();
    } else if (p.weapon === "machinegun") {
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
    } else if (p.weapon === "minigun") {
      // Minigun body
      ctx.fillStyle = "#444";
      ctx.fillRect(4, -4, 24, 8);
      // Multiple barrels
      ctx.fillStyle = "#555";
      ctx.fillRect(28, -5, 8, 3);
      ctx.fillRect(28, -1, 8, 3);
      ctx.fillRect(28, 3, 8, 3);
      // Handle
      ctx.fillStyle = "#333";
      ctx.fillRect(-2, -2, 6, 4);
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
    ctx.arc(renderX, renderY, 13, 0, Math.PI * 2);
    ctx.fill();

    // Player body - inner
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(renderX, renderY, 10, 0, Math.PI * 2);
    ctx.fill();

    // First character initial on the ball
    if (p.username) {
      ctx.font = "bold 12px 'Rajdhani', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(p.username.charAt(0).toUpperCase(), renderX, renderY + 1);
      ctx.textBaseline = "alphabetic";
    }

    // Highlight for local player
    if (p.id === playerId) {
      ctx.strokeStyle = "#ffaa44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Health bar above player
    const barWidth = 30;
    const barHeight = 4;
    const barX = renderX - barWidth / 2;
    const barY = renderY - 24;
    const hpPercent = p.hp / 4;

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);

    // HP fill
    const hpColor =
      hpPercent > 0.5 ? "#4ad94a" : hpPercent > 0.25 ? "#d9a04a" : "#d94a4a";
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);

    // Username
    ctx.font = "bold 20px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    // Shadow for readability
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(p.username, renderX + 1, renderY - 30);
    ctx.fillStyle = p.id === playerId ? "#ffcc66" : "#e0ece0";
    ctx.fillText(p.username, renderX, renderY - 31);
    ctx.textAlign = "start";

    // Bounty skull on the leading player
    if (bountyLeaderId === p.id) {
      ctx.font = "16px serif";
      ctx.textAlign = "center";
      ctx.fillText("💀", renderX, renderY - 48);
      ctx.textAlign = "start";
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
    } else if (b.weapon === "minigun") {
      // Minigun tracer - orange
      ctx.fillStyle = "#ff8844";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,136,68,0.3)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.weapon === "sniper") {
      // Sniper tracer - bright blue laser line
      ctx.strokeStyle = "#44aaff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      const trailLen = 18;
      const angle = b.dx !== undefined ? Math.atan2(b.dy, b.dx) : 0;
      ctx.lineTo(b.x - Math.cos(angle) * trailLen, b.y - Math.sin(angle) * trailLen);
      ctx.stroke();
      // Core dot
      ctx.fillStyle = "#88ccff";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
      // Glow
      ctx.fillStyle = "rgba(68,170,255,0.25)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
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

  // Render crosshair
  if (framePlayer) {
    // Tactical crosshair
    ctx.strokeStyle = "rgba(255,170,68,0.8)";
    ctx.lineWidth = 1.5;

    // Cross lines with gap in center
    const gap = 4;
    const len = 10;
    ctx.beginPath();
    ctx.moveTo(mouseX - len, mouseY);
    ctx.lineTo(mouseX - gap, mouseY);
    ctx.moveTo(mouseX + gap, mouseY);
    ctx.lineTo(mouseX + len, mouseY);
    ctx.moveTo(mouseX, mouseY - len);
    ctx.lineTo(mouseX, mouseY - gap);
    ctx.moveTo(mouseX, mouseY + gap);
    ctx.lineTo(mouseX, mouseY + len);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = "rgba(255,170,68,0.9)";
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Kill feed
  if (gameReady) {
    renderKillFeed();
  }

  // Restore canvas from screen shake
  if (shakeOffset.x !== 0 || shakeOffset.y !== 0) {
    ctx.restore();
  }

  // Flashbang overlay (must be last — covers entire screen)
  renderFlashbang();

  // Low HP vignette (drawn on top of everything including flashbang)
  renderLowHPVignette();

  requestAnimationFrame(render);
}

render();
