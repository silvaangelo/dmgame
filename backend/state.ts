import type { Game, TrackedPlayer, Room } from "./types.js";

export const rooms: Map<string, Room> = new Map();

export const games: Map<string, Game> = new Map();

export const allPlayers: Map<string, TrackedPlayer> = new Map();

/** The single persistent game world — always running */
export let persistentGame: Game | null = null;

export function setPersistentGame(game: Game) {
  persistentGame = game;
}
