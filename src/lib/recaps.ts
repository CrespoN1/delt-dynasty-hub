import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type Recap = {
  season: string;
  week: number;
  headline: string;
  subhead: string;
  matchOfTheWeek: string;
  powerRankingsShakeup: string;
  mainRecap: string;
  weeklyAwards: { title: string; team: string; blurb: string }[];
  generatedAt: string;
  modelId: string;
};

const RECAPS_DIR = path.join(process.cwd(), "data", "recaps");

export function loadAllRecaps(): Recap[] {
  if (!existsSync(RECAPS_DIR)) return [];
  const files = readdirSync(RECAPS_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => JSON.parse(readFileSync(path.join(RECAPS_DIR, f), "utf-8")) as Recap)
    .sort((a, b) => {
      if (a.season !== b.season) return Number(b.season) - Number(a.season);
      return b.week - a.week;
    });
}

export function loadRecap(season: string, week: number): Recap | null {
  const file = path.join(RECAPS_DIR, `${season}-w${String(week).padStart(2, "0")}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8")) as Recap;
}
