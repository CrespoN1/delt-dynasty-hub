import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { SeasonData } from "../src/lib/types";

async function main() {
  const dataDir = path.join(process.cwd(), "data");
  const seasonsIndex = JSON.parse(readFileSync(path.join(dataDir, "seasons.json"), "utf-8")) as Array<{
    season: string;
    status: string;
  }>;

  const force = process.argv.includes("--force");

  const targets: { year: string; week: number }[] = [];
  for (const { season: year, status } of seasonsIndex) {
    if (status !== "complete") continue;
    const file = path.join(dataDir, `season_${year}.json`);
    if (!existsSync(file)) continue;
    const season = JSON.parse(readFileSync(file, "utf-8")) as SeasonData;
    const weeks = Object.keys(season.matchupsByWeek)
      .map((w) => Number(w))
      .sort((a, b) => a - b);
    for (const w of weeks) {
      const out = path.join(dataDir, "recaps", `${year}-w${String(w).padStart(2, "0")}.json`);
      if (!force && existsSync(out)) continue;
      targets.push({ year, week: w });
    }
  }

  console.log(`Generating ${targets.length} recap(s)…`);
  for (const { year, week } of targets) {
    console.log(`\n=== ${year} Week ${week} ===`);
    const result = spawnSync("npx", ["tsx", "scripts/generate-recap.ts", year, String(week)], {
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) {
      console.error(`Failed on ${year} W${week} — stopping.`);
      process.exit(1);
    }
  }
  console.log(`\nDone — ${targets.length} recap(s) generated.`);
}

main();
