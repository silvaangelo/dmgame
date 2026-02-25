// Game configuration constants
const GAME_CONFIG = {
  ARENA_WIDTH: 1400,
  ARENA_HEIGHT: 900,
  PLAYER_RADIUS: 15,
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
const WEAPON_CYCLE = ["machinegun", "shotgun", "knife"];
const WEAPON_NAMES = {
  machinegun: "🔫 Metralhadora",
  shotgun: "🔫 Shotgun",
  knife: "🔪 Faca",
  minigun: "🔥 Minigun",
};
const WEAPON_COOLDOWNS = {
  machinegun: 60,
  shotgun: 500,
  knife: 200,
  minigun: 18,
};
const WEAPON_KILL_ICONS = {
  machinegun: "🔫",
  shotgun: "🔫",
  knife: "🔪",
  minigun: "🔥",
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

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  loadAudioBuffer("shot", `${assetBase}/assets/shot.wav`);
  loadAudioBuffer("reload", `${assetBase}/assets/reload.ogg`);
  loadAudioBuffer("scream", `${assetBase}/assets/scream.wav`);
  loadAudioBuffer("matchstart", `${assetBase}/assets/matchstart.ogg`);
  loadAudioBuffer("died", `${assetBase}/assets/died.mp3`);
  loadAudioBuffer("readyalarm", `${assetBase}/assets/readyalarm.wav`);
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
  ws.send(JSON.stringify({ type: "ready" }));
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
        <span style="font-weight: ${isMe ? "600" : "400"}; color: ${isMe ? "#bbddbb" : "#a0b8a0"}; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; font-family: 'Rajdhani', sans-serif;">${p.username}${isMe ? "" : ""}</span>
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

  const listContent = document.getElementById("playerListContent");
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
            ${isLeading ? "👑 " : ""}${p.username} ${isMe ? "(Você)" : ""} ${isDead ? "💀" : ""}
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
      ws.send(JSON.stringify({ type: "aim", aimAngle }));
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
    }

    // Client-side bullet prediction (instant visual feedback)
    if (player.weapon !== "knife") {
      const bulletSpeed =
        player.weapon === "machinegun" ? 9 :
        player.weapon === "shotgun" ? 8 : 9;

      if (player.weapon === "shotgun") {
        // Predict 5 pellets
        for (let i = 0; i < 5; i++) {
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
      } else {
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

    ws.send(JSON.stringify({ type: "shoot", dirX, dirY }));
    lastShootTime = now;
  }
}

// ===== NETWORKING =====

let loggedInUsername = "";

function login() {
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

  // Prevent multiple logins
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  // Disable button to prevent double-clicks
  loginButton.disabled = true;
  loginButton.style.opacity = "0.6";
  loginButton.textContent = "Conectando...";

  loggedInUsername = trimmed;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "login", username: trimmed }));
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === "error") {
      const errorEl = document.getElementById("usernameError");
      errorEl.textContent = "⚠ " + data.message;
      errorEl.style.display = "block";
      loginButton.disabled = false;
      loginButton.style.opacity = "1";
      loginButton.textContent = "ENTRAR";
      return;
    }

    if (data.type === "onlineList") {
      updateGlobalOnlineList(data.players);
    }

    if (data.type === "loginSuccess") {
      playerId = data.playerId;
      // Show room list screen
      document.getElementById("menu").style.display = "none";
      document.getElementById("roomListScreen").style.display = "block";
    }

    if (data.type === "roomList") {
      updateRoomList(data.rooms);
    }

    if (data.type === "matchHistory") {
      renderMatchHistory(data.history);
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
      playerId = players.find((p) => p.username === loggedInUsername).id;
      gameReady = false;

      // Update arena dimensions from server
      if (data.arenaWidth) GAME_CONFIG.ARENA_WIDTH = data.arenaWidth;
      if (data.arenaHeight) GAME_CONFIG.ARENA_HEIGHT = data.arenaHeight;
      canvas.width = GAME_CONFIG.ARENA_WIDTH;
      canvas.height = GAME_CONFIG.ARENA_HEIGHT;
      gridCanvas = null; // Invalidate cached grid
      resizeCanvas();

      // Initialize audio system
      initAudio();

      // Reset ready button for new match
      const readyButton = document.getElementById("readyButton");
      readyButton.disabled = false;
      readyButton.style.opacity = "1";
      readyButton.textContent = "BORA! 💪";

      // Play match start sound
      playSound("matchstart", 0.7);

      // Play ready alarm (loop)
      startReadyAlarm();

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
      }
    }

    if (data.type === "kill") {
      addKillFeedEntry(data.killer, data.victim, data.weapon);

      // Show viral toast for local player involvement
      const localPlayer = players.find((p) => p.id === playerId);
      if (localPlayer) {
        if (data.killer === localPlayer.username) {
          const phrase = SELF_KILL_PHRASES[Math.floor(Math.random() * SELF_KILL_PHRASES.length)]
            .replace("{victim}", data.victim);
          showToast(phrase, "#4ad94a");
        } else if (data.victim === localPlayer.username) {
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
      // Explosion sound
      playGrenadeExplosionSound(data.x, data.y);
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
      const weaponCodeMap = { 0: "machinegun", 1: "shotgun", 2: "knife", 3: "minigun" };
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
      const pickupTypeMap = { 0: "health", 1: "ammo", 2: "speed", 3: "minigun" };
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
          // Player just died - create explosion
          createExplosion(p.x, p.y);
          // Screen shake on explosions (stronger if it's us dying)
          if (p.id === playerId) {
            triggerScreenShake(12);
          } else {
            triggerScreenShake(5);
          }
          // Play death sound with positional audio
          playPositionalSound("died", p.x, p.y, 0.5);
          // Hit marker for the killer (us)
          if (p.id !== playerId) createHitMarker();
        } else if (prevState && prevState.hp > p.hp && p.hp > 0) {
          // Player took damage but still alive - create blood
          createBlood(p.x, p.y);
          // Create permanent blood stain
          createBloodStain(p.x, p.y);
          // Hit marker if it's an enemy (we likely shot them)
          if (p.id !== playerId) createHitMarker();
          // Damage indicator + screen shake if it's us taking damage
          if (p.id === playerId) {
            createDamageIndicator(p.x, p.y);
            triggerScreenShake(6);
          }
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
            playPositionalSound("shot", b.x, b.y, 0.45, 0.8);
          } else {
            playPositionalSound("shot", b.x, b.y, 0.25, 1.3);
          }
        }
      });

      // Update bullet position tracking
      previousBulletPositions = new Map();
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

      // Hide ready screen if showing
      document.getElementById("readyScreen").style.display = "none";

      // Determine if local player won
      const localPlayer = data.scoreboard.find((p) => p.username === loggedInUsername);
      const isLocalWinner = localPlayer && localPlayer.isWinner;

      // Show victory screen with scoreboard
      const scoreboardHTML = data.scoreboard
        .map(
          (player, index) => `
        <div style="padding: 12px; margin: 8px 0; background: ${player.isWinner ? "linear-gradient(90deg, rgba(255,107,53,0.3), rgba(255,68,34,0.2))" : "rgba(255,255,255,0.05)"}; border-radius: 4px; border: 1px solid ${player.isWinner ? "#ff6b35" : "#2a3a2a"}; display: flex; justify-content: space-between; align-items: center; animation: screenFadeIn 0.3s ease-out ${index * 0.1}s both;">
          <span style="font-size: 22px; font-weight: ${player.isWinner ? "bold" : "normal"}; color: white; font-family: 'Rajdhani', sans-serif;">
            ${index + 1}. ${player.username} ${player.isWinner ? "👑" : ""}
          </span>
          <span style="font-size: 18px; color: #bbddbb; font-family: 'Share Tech Mono', monospace;">
            ${player.kills} abates / ${player.deaths} mortes
          </span>
        </div>
      `,
        )
        .join("");

      // Pick a random viral phrase
      const viralPhrase = isLocalWinner
        ? WINNER_PHRASES[Math.floor(Math.random() * WINNER_PHRASES.length)].replace("{winner}", "Você")
        : LOSER_PHRASES[Math.floor(Math.random() * LOSER_PHRASES.length)].replace("{winner}", data.winnerName);

      document.getElementById("victoryMessage").innerHTML =
        isLocalWinner ? "🏆 VITÓRIA! 🏆" : data.winnerName + " VENCEU!";
      document.getElementById("victorySubtext").innerHTML = viralPhrase;
      document.getElementById("countdownMessage").innerHTML = `
        <div style="margin: 20px 0;">
          <h3 style="color: #aaccaa; margin-bottom: 15px; font-family: 'Rajdhani', sans-serif; text-transform: uppercase; letter-spacing: 2px;">Placar Final</h3>
          ${scoreboardHTML}
        </div>
        <p style="margin-top: 20px; font-size: 18px; color: #8aaa8a;">Voltando pro lobby em <span id="countdownTimer" style="color: #ff6b35; font-weight: bold;">5</span>s...</p>
      `;
      document.getElementById("victoryScreen").style.display = "block";

      // Countdown from 5 to 1
      let countdown = 5;

      const countdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          const timerElement = document.getElementById("countdownTimer");
          if (timerElement) {
            timerElement.textContent = countdown.toString();
          }
        } else {
          clearInterval(countdownInterval);

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
          previousBulletPositions = new Map();
          screenShake = { intensity: 0, decay: 0.92 };
          currentRoomData = null;
          killFeedEntries = [];
          previousPlayerStates.clear();
          gameReady = false;

          // Remove any active toasts
          activeToasts.forEach((t) => t.remove());
          activeToasts = [];

          // Do NOT close WebSocket — player stays connected
        }
      }, 1000);
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    loginButton.disabled = false;
    loginButton.style.opacity = "1";
    loginButton.style.background = "";
    loginButton.textContent = "ENTRAR";
  };

  ws.onclose = () => {
    console.log("WebSocket closed");
    ws = null;

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
    loginBtn.disabled = false;
    loginBtn.style.opacity = "1";
    loginBtn.textContent = "ENTRAR";
  };
}

// ===== ROOM UI FUNCTIONS =====

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

function renderMatchHistory(history) {
  const section = document.getElementById("matchHistorySection");
  const content = document.getElementById("matchHistoryContent");
  if (!section || !content) return;

  if (!history || history.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  content.innerHTML = history
    .map((match) => {
      const me = match.players.find((p) => p.username === loggedInUsername);
      const isWin = me && me.isWinner;
      const kills = me ? me.kills : 0;
      const deaths = me ? me.deaths : 0;
      const kd = deaths === 0 ? kills.toFixed(1) : (kills / deaths).toFixed(1);
      const otherPlayers = match.players
        .filter((p) => p.username !== loggedInUsername)
        .map((p) => p.username)
        .join(", ");

      return `
        <div class="match-entry ${isWin ? "match-win" : "match-loss"}">
          <div class="match-header">
            <span class="match-result">${isWin ? "✓ Vitória" : "✗ Derrota"}</span>
            <span class="match-time">${formatTimeAgo(match.timestamp)}</span>
          </div>
          <div class="match-stats">
            <span>🎯 ${kills} abates</span>
            <span>💀 ${deaths} mortes</span>
            <span>📊 K/D ${kd}</span>
          </div>
          <div class="match-players">vs ${otherPlayers || "—"} · Vencedor: ${match.winnerName}</div>
        </div>
      `;
    })
    .join("");
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
      (r) => `
    <div class="room-item">
      <div class="room-info">
        <div class="room-name">⚔ ${r.name}</div>
        <div class="room-count">${r.playerCount}/${r.maxPlayers} jogadores</div>
      </div>
      <button onclick="doJoinRoom('${r.id}')">Entrar</button>
    </div>
  `,
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
        <span class="player-name"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${skinColor};margin-right:8px;vertical-align:middle;border:1px solid rgba(255,255,255,0.2);"></span>${p.username}${p.id === playerId ? " (Você)" : ""}</span>
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
  ws.send(JSON.stringify({ type: "createRoom" }));
}

function doJoinRoom(roomId) {
  if (!ws) return;
  ws.send(JSON.stringify({ type: "joinRoom", roomId }));
}

function doLeaveRoom() {
  if (!ws) return;

  // Reset room ready button
  const readyBtn = document.getElementById("roomReadyBtn");
  if (readyBtn) {
    readyBtn.disabled = false;
    readyBtn.textContent = "⚔ ESTOU PRONTO! ⚔";
  }

  ws.send(JSON.stringify({ type: "leaveRoom" }));
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

  ws.send(JSON.stringify({ type: "roomReady" }));
}

// ===== HUD DISPLAY =====

let lastShotUIUpdate = 0;
function updateShotUI() {
  const now = Date.now();
  if (now - lastShotUIUpdate < 100) return;
  lastShotUIUpdate = now;

  const player = players.find((p) => p.id === playerId);
  if (!player) return;

  const killsDisplay = document.getElementById("killsDisplay");
  const shotsDisplay = document.getElementById("shotsDisplay");
  const healthDisplay = document.getElementById("healthDisplay");
  const cooldownDisplay = document.getElementById("cooldownDisplay");
  const reloadDisplay = document.getElementById("reloadDisplay");
  const hpBarFill = document.getElementById("hpBarFill");

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
  if (player.weapon === "knife") {
    shotsDisplay.textContent = `${weaponName} | Corpo a corpo`;
  } else if (player.weapon === "minigun") {
    shotsDisplay.textContent = `${weaponName} | ∞`;
  } else {
    shotsDisplay.textContent = `${weaponName} | ${player.shots}/30`;
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
  const speedBoostDisplay = document.getElementById("speedBoostDisplay");
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

  // Tab to show scoreboard
  if (e.key === "Tab") {
    e.preventDefault();
    const pl = document.getElementById("playerList");
    if (pl) pl.style.display = "block";
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
    ws.send(JSON.stringify({ type: "switchWeapon" }));
    return;
  }

  // Number keys 1-3 to select weapon directly
  if (e.key >= "1" && e.key <= "3") {
    const weapons = ["machinegun", "shotgun", "knife"];
    const weaponIndex = parseInt(e.key) - 1;
    ws.send(JSON.stringify({ type: "switchWeapon", weapon: weapons[weaponIndex] }));
    return;
  }

  // R key to manually reload
  if (e.key === "r" || e.key === "R") {
    ws.send(JSON.stringify({ type: "reload" }));
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

    ws.send(JSON.stringify(input));

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
  // Tab release hides scoreboard
  if (e.key === "Tab") {
    e.preventDefault();
    const pl = document.getElementById("playerList");
    if (pl) pl.style.display = "none";
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

    ws.send(JSON.stringify(input));

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

// ===== MOBILE TOUCH CONTROLS =====

const isTouchDevice = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
let joystickActive = false;
let joystickTouchId = null;
let joystickCenterX = 0;
let joystickCenterY = 0;
const JOYSTICK_MAX_RADIUS = 45;

function initMobileControls() {
  const mobileControls = document.getElementById("mobileControls");
  if (!mobileControls) return;
  if (!isTouchDevice) return;

  mobileControls.classList.add("active");

  const joystickArea = document.getElementById("joystickArea");
  const joystickThumb = document.getElementById("joystickThumb");
  const joystickBase = document.getElementById("joystickBase");
  const weaponBtn = document.getElementById("touchWeaponBtn");

  // Joystick touch handling
  joystickArea.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (joystickTouchId !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    const rect = joystickBase.getBoundingClientRect();
    joystickCenterX = rect.left + rect.width / 2;
    joystickCenterY = rect.top + rect.height / 2;
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
        joystickThumb.style.left = "60px";
        joystickThumb.style.top = "60px";
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
    // Update thumb visual position
    joystickThumb.style.left = (60 + dx) + "px";
    joystickThumb.style.top = (60 + dy) + "px";

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

  // Right-side aim joystick — aims + auto-fires while touched
  const aimArea = document.getElementById("aimJoystickArea");
  const aimBase = document.getElementById("aimJoystickBase");
  const aimThumb = document.getElementById("aimJoystickThumb");
  let aimTouchId = null;
  let aimCenterX = 0;
  let aimCenterY = 0;
  const AIM_JOYSTICK_MAX = 45;

  aimArea.addEventListener("touchstart", (e) => {
    e.preventDefault();
    initAudio();
    if (aimTouchId !== null) return;
    const touch = e.changedTouches[0];
    aimTouchId = touch.identifier;
    const rect = aimBase.getBoundingClientRect();
    aimCenterX = rect.left + rect.width / 2;
    aimCenterY = rect.top + rect.height / 2;
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
        aimThumb.style.left = "60px";
        aimThumb.style.top = "60px";
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
    aimThumb.style.left = (60 + dx) + "px";
    aimThumb.style.top = (60 + dy) + "px";

    // Convert joystick direction to aim angle (only if moved past deadzone)
    const deadzone = 8;
    if (dist > deadzone) {
      const aimAngle = Math.atan2(dy, dx);
      // Project aim far from player so the crosshair is in the right direction
      const aimDist = 300;
      mouseX = predictedX + Math.cos(aimAngle) * aimDist;
      mouseY = predictedY + Math.sin(aimAngle) * aimDist;

      // Send aim angle to server
      if (ws && playerId && gameReady) {
        ws.send(JSON.stringify({ type: "aim", aimAngle }));
      }
    }
  }

  // Weapon switch button
  weaponBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    weaponBtn.classList.add("pressed");
    if (ws && gameReady) {
      ws.send(JSON.stringify({ type: "switchWeapon" }));
    }
    setTimeout(() => weaponBtn.classList.remove("pressed"), 150);
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
      ws.send(JSON.stringify(input));

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
  renderKillFeed();
}

let lastKillFeedRender = 0;
function renderKillFeed() {
  const now = Date.now();
  if (now - lastKillFeedRender < 250) return;
  lastKillFeedRender = now;

  const container = document.getElementById("killFeed");
  if (!container) return;
  killFeedEntries = killFeedEntries.filter(
    (e) => now - e.timestamp < KILL_FEED_DURATION,
  );

  // Only rebuild if count changed (avoids blinking from innerHTML replacement)
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
          `<span class="streak-text">🔥 ${e.killer}: ${e.victim}</span></div>`
        );
      }
      return (
        `<div class="kill-entry" style="opacity:${opacity}">` +
        `<span class="killer">${e.killer}</span>` +
        `<span class="weapon-icon">${e.icon}</span>` +
        `<span class="victim">${e.victim}</span></div>`
      );
    })
    .join("");

  if (container.innerHTML !== newHTML) {
    container.innerHTML = newHTML;
  }
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
  if (ws) ws.send(JSON.stringify({ type: "selectSkin", skin: index }));
  initSkinSelector();
}

// ===== LEADERBOARD =====

function requestLeaderboard() {
  if (!ws) return;
  ws.send(JSON.stringify({ type: "getLeaderboard" }));
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
        <span class="lb-name">${i === 0 ? "👑 " : ""}${s.username}</span>
        <span class="lb-stats">${s.kills}K / ${s.deaths}M (${kd}) | ${s.wins}V / ${s.gamesPlayed}J</span>
      </div>`;
    }).join("");
  }

  document.getElementById("leaderboardModal").style.display = "block";
}

// ===== GRENADE & PICKUP EFFECTS =====

function playGrenadeExplosionSound(x, y) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const dx = x - predictedX;
  const dy = y - predictedY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const maxHearingDist = 600;
  const distanceFactor = Math.max(0, 1 - distance / maxHearingDist);
  const attenuation = distanceFactor * distanceFactor;
  const baseVolume = 0.05 + 0.95 * attenuation;

  const osc = audioCtx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(60, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 0.3);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.4 * baseVolume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
  const panVal = Math.max(-1, Math.min(1, dx / (GAME_CONFIG.ARENA_WIDTH * 0.25)));
  const panner = audioCtx.createStereoPanner();
  panner.pan.value = panVal;
  osc.connect(gain);
  gain.connect(panner);
  panner.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.4);
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
  const pickupColors = { health: "#ff4444", ammo: "#44bb44", speed: "#4488ff", minigun: "#ff8800" };
  const pickupIcons = { health: "+", ammo: "A", speed: "S", minigun: "M" };
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

  // Dust clouds when local player moves
  const dustNow = Date.now();
  const dustPlayer = players.find((p) => p.id === playerId);
  if (
    dustPlayer &&
    dustPlayer.hp > 0 &&
    (currentKeys.w || currentKeys.a || currentKeys.s || currentKeys.d)
  ) {
    if (dustNow - lastDustTime > 120) {
      createDustCloud(predictedX, predictedY);
      lastDustTime = dustNow;
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

  // Render obstacles
  obstacles.forEach((obstacle) => {
    if (!obstacle.destroyed) {
      if (obstacle.type === "tree") {
        // Tree trunk
        ctx.fillStyle = "#5a4a2a";
        ctx.fillRect(
          obstacle.x + obstacle.size * 0.4,
          obstacle.y + obstacle.size * 0.5,
          obstacle.size * 0.2,
          obstacle.size * 0.5,
        );

        // Foliage
        ctx.fillStyle = "#2a5a2a";
        ctx.beginPath();
        ctx.arc(
          obstacle.x + obstacle.size * 0.5,
          obstacle.y + obstacle.size * 0.3,
          obstacle.size * 0.35,
          0,
          Math.PI * 2,
        );
        ctx.fill();

        ctx.fillStyle = "#2a6a2a";
        ctx.beginPath();
        ctx.arc(
          obstacle.x + obstacle.size * 0.3,
          obstacle.y + obstacle.size * 0.4,
          obstacle.size * 0.25,
          0,
          Math.PI * 2,
        );
        ctx.fill();

        ctx.beginPath();
        ctx.arc(
          obstacle.x + obstacle.size * 0.7,
          obstacle.y + obstacle.size * 0.4,
          obstacle.size * 0.25,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else {
        // Concrete block
        ctx.fillStyle = "#555545";
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.size, obstacle.size);

        // Edges
        ctx.strokeStyle = "#444434";
        ctx.lineWidth = 1;
        ctx.strokeRect(obstacle.x, obstacle.y, obstacle.size, obstacle.size);

        // Crack texture
        ctx.strokeStyle = "#666656";
        ctx.beginPath();
        ctx.moveTo(obstacle.x + 2, obstacle.y + obstacle.size / 2);
        ctx.lineTo(
          obstacle.x + obstacle.size - 2,
          obstacle.y + obstacle.size / 2,
        );
        ctx.stroke();
      }
    }
  });

  // Render pickups
  renderPickups();
  renderPickupEffects();

  // Render bombs
  renderBombs();

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
    }

    ctx.restore();

    // Player body - outer ring
    ctx.fillStyle = darkColor;
    ctx.beginPath();
    ctx.arc(renderX, renderY, 12, 0, Math.PI * 2);
    ctx.fill();

    // Player body - inner
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(renderX, renderY, 9, 0, Math.PI * 2);
    ctx.fill();

    // Highlight for local player
    if (p.id === playerId) {
      ctx.strokeStyle = "#ffaa44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(renderX, renderY, 15, 0, Math.PI * 2);
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
    ctx.font = "bold 13px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = p.id === playerId ? "#ffcc66" : "#ccddcc";
    ctx.fillText(p.username, renderX, renderY - 29);
    ctx.textAlign = "start";
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

  // Render hit markers and damage indicators
  renderHitMarkers();
  renderDamageIndicators();

  // Render crosshair
  const player = players.find((p) => p.id === playerId);
  if (player) {
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

  requestAnimationFrame(render);
}

render();
