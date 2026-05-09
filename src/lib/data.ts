import { readFileSync } from "node:fs";
import path from "node:path";
import type { PlayerSlim, SeasonData } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

export function loadSeason(year: string | number): SeasonData {
  const file = path.join(DATA_DIR, `season_${year}.json`);
  return JSON.parse(readFileSync(file, "utf-8")) as SeasonData;
}

export function loadSeasons(): { season: string; status: string }[] {
  const file = path.join(DATA_DIR, "seasons.json");
  return JSON.parse(readFileSync(file, "utf-8")) as { season: string; status: string }[];
}

export function loadPlayers(): Record<string, PlayerSlim> {
  const file = path.join(DATA_DIR, "players.json");
  return JSON.parse(readFileSync(file, "utf-8")) as Record<string, PlayerSlim>;
}
