import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlayerSlim, SeasonData } from "../src/lib/types";
import { generateRecap } from "../src/lib/recap-generator";

async function main() {
  const [yearArg, weekArg] = process.argv.slice(2);
  if (!yearArg || !weekArg) {
    console.error("Usage: tsx scripts/generate-recap.ts <year> <week>");
    process.exit(1);
  }
  const year = yearArg;
  const week = Number(weekArg);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set (put it in .env.local)");
    process.exit(1);
  }

  const dataDir = path.join(process.cwd(), "data");
  const season = JSON.parse(readFileSync(path.join(dataDir, `season_${year}.json`), "utf-8")) as SeasonData;
  const players = JSON.parse(readFileSync(path.join(dataDir, "players.json"), "utf-8")) as Record<
    string,
    PlayerSlim
  >;

  console.log(`Generating recap for ${year} Week ${week}…`);
  const t0 = Date.now();
  const { recap, usage } = await generateRecap({ season, week, players, apiKey });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `  → ${elapsed}s · in: ${usage.input_tokens} (cache write: ${usage.cache_creation_input_tokens ?? 0}, cache read: ${usage.cache_read_input_tokens ?? 0}) · out: ${usage.output_tokens}`
  );

  const recapsDir = path.join(dataDir, "recaps");
  if (!existsSync(recapsDir)) mkdirSync(recapsDir, { recursive: true });
  const file = path.join(recapsDir, `${year}-w${String(week).padStart(2, "0")}.json`);
  writeFileSync(file, JSON.stringify(recap, null, 2));
  console.log(`  Wrote ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
