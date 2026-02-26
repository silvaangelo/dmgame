import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { PlayerStats, MatchHistoryEntry, RegisteredUser } from "./types.js";

const DATA_DIR = path.join(process.cwd(), "data");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const MAX_HISTORY_ENTRIES = 50;

let stats: Map<string, PlayerStats> = new Map();
let matchHistory: MatchHistoryEntry[] = [];
let users: Map<string, RegisteredUser> = new Map(); // keyed by token

export function initDatabase() {
  // Reset database on every deploy (fresh start)
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      try { fs.unlinkSync(path.join(DATA_DIR, file)); } catch { /* ignore */ }
    }
    console.log("🗑️  Database reset (fresh deploy)");
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(STATS_FILE)) {
    try {
      const raw = fs.readFileSync(STATS_FILE, "utf-8");
      const data = JSON.parse(raw) as Record<string, PlayerStats>;
      for (const [key, value] of Object.entries(data)) {
        stats.set(key, value);
      }
      console.log(`📊 Loaded ${stats.size} player stats from database`);
    } catch {
      console.log("📊 Starting with fresh stats database");
      stats = new Map();
    }
  } else {
    console.log("📊 Creating new stats database");
  }

  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
      matchHistory = JSON.parse(raw) as MatchHistoryEntry[];
      console.log(`📜 Loaded ${matchHistory.length} match history entries`);
    } catch {
      console.log("📜 Starting with fresh match history");
      matchHistory = [];
    }
  } else {
    console.log("📜 Creating new match history");
  }

  // Load users
  if (fs.existsSync(USERS_FILE)) {
    try {
      const raw = fs.readFileSync(USERS_FILE, "utf-8");
      const data = JSON.parse(raw) as Record<string, RegisteredUser>;
      for (const [key, value] of Object.entries(data)) {
        users.set(key, value);
      }
      console.log(`👤 Loaded ${users.size} registered users`);
    } catch {
      console.log("👤 Starting with fresh users database");
      users = new Map();
    }
  } else {
    console.log("👤 Creating new users database");
  }
}

let statsSaveTimer: NodeJS.Timeout | null = null;
function saveStats() {
  if (statsSaveTimer) return;
  statsSaveTimer = setTimeout(() => {
    statsSaveTimer = null;
    const obj: Record<string, PlayerStats> = {};
    stats.forEach((v, k) => {
      obj[k] = v;
    });
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(obj));
    } catch (error) {
      console.error("Failed to save stats:", error);
    }
  }, 2000);
}

export function getPlayerStats(username: string): PlayerStats {
  return (
    stats.get(username) || {
      username,
      kills: 0,
      deaths: 0,
      wins: 0,
      gamesPlayed: 0,
    }
  );
}

export function updatePlayerStats(
  username: string,
  kills: number,
  deaths: number,
  won: boolean,
) {
  const existing = getPlayerStats(username);
  existing.kills += kills;
  existing.deaths += deaths;
  existing.gamesPlayed += 1;
  if (won) existing.wins += 1;
  stats.set(username, existing);
  saveStats();
}

export function getLeaderboard(limit: number = 10): PlayerStats[] {
  return Array.from(stats.values())
    .sort((a, b) => b.kills - a.kills)
    .slice(0, limit);
}

let historySaveTimer: NodeJS.Timeout | null = null;
function saveHistory() {
  if (historySaveTimer) return;
  historySaveTimer = setTimeout(() => {
    historySaveTimer = null;
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(matchHistory));
    } catch (error) {
      console.error("Failed to save match history:", error);
    }
  }, 2000);
}

export function addMatchHistory(entry: MatchHistoryEntry) {
  matchHistory.unshift(entry);
  if (matchHistory.length > MAX_HISTORY_ENTRIES) {
    matchHistory = matchHistory.slice(0, MAX_HISTORY_ENTRIES);
  }
  saveHistory();
}

export function getMatchHistory(username: string, limit: number = 10): MatchHistoryEntry[] {
  return matchHistory
    .filter((entry) => entry.players.some((p) => p.username === username))
    .slice(0, limit);
}

/* ================= USER REGISTRATION ================= */

let usersSaveTimer: NodeJS.Timeout | null = null;
function saveUsers() {
  if (usersSaveTimer) return;
  usersSaveTimer = setTimeout(() => {
    usersSaveTimer = null;
    const obj: Record<string, RegisteredUser> = {};
    users.forEach((v, k) => {
      obj[k] = v;
    });
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(obj));
    } catch (error) {
      console.error("Failed to save users:", error);
    }
  }, 2000);
}

function generateToken(username: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(username + Date.now().toString() + crypto.randomBytes(16).toString("hex"));
  return hash.digest("hex");
}

export function registerUser(username: string): RegisteredUser {
  // Check if username already exists
  for (const user of users.values()) {
    if (user.username.toLowerCase() === username.toLowerCase()) {
      user.lastSeen = Date.now();
      return user;
    }
  }

  // New registration
  const token = generateToken(username);
  const user: RegisteredUser = {
    username,
    token,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  users.set(token, user);
  saveUsers();
  console.log(`👤 Registered new user: ${username}`);
  return user;
}

export function getUserByToken(token: string): RegisteredUser | undefined {
  return users.get(token);
}


