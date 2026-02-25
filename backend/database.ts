import fs from "fs";
import path from "path";
import type { PlayerStats, MatchHistoryEntry } from "./types.js";

const DATA_DIR = path.join(process.cwd(), "data");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

const MAX_HISTORY_ENTRIES = 50;

let stats: Map<string, PlayerStats> = new Map();
let matchHistory: MatchHistoryEntry[] = [];

export function initDatabase() {
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
}

function saveStats() {
  const obj: Record<string, PlayerStats> = {};
  stats.forEach((v, k) => {
    obj[k] = v;
  });
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(obj, null, 2));
  } catch (error) {
    console.error("Failed to save stats:", error);
  }
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

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(matchHistory, null, 2));
  } catch (error) {
    console.error("Failed to save match history:", error);
  }
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
