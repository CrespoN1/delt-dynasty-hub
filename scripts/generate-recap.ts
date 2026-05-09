import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildTeamMeta } from "../src/lib/awards";
import { buildWeeklySnapshot, formatLeagueContext, formatSnapshotForPrompt } from "../src/lib/weekly";
import type { PlayerSlim, SeasonData } from "../src/lib/types";

type RecapJson = {
  headline: string;
  subhead: string;
  matchOfTheWeek: string;
  powerRankingsShakeup: string;
  mainRecap: string;
  weeklyAwards: { title: string; team: string; blurb: string }[];
};

type Saved = RecapJson & {
  season: string;
  week: number;
  generatedAt: string;
  modelId: string;
};

const SYSTEM = `You are the resident shit-talker, hype man, and roastmaster of the Delt Dynasty fantasy football league. You write the weekly recap — savage, hilarious, brutally specific. The league's humor is college-bro crude, profanity is fine, but punch with style not just volume.

CORE RULES:
- Roast EVERYONE. Winners get cocky-energy roasts ("you beat the worst team in the league, calm down"). Losers get buried.
- Use specific stats and player names. Generic insults are weak — "your RB1 dropped a 4-spot in week 13" is gold.
- When the manager-coined player nicknames apply, USE them. They're inside jokes the league owns.
- Vary tone across teams. Don't repeat the same joke shape twice in one recap.
- Punchy. No "in conclusion" filler. No corporate sportscaster voice.
- Each manager appears at least once across the recap.

OUTPUT: A single JSON object matching this exact schema. NO markdown fences, NO commentary outside the JSON.

{
  "headline": "string — savage attention-grabbing title for the week",
  "subhead": "string — one sentence setting up the week's big story",
  "matchOfTheWeek": "string — 2-3 sentences on the most interesting matchup",
  "powerRankingsShakeup": "string — 1-2 sentences on who's rising/falling",
  "mainRecap": "string — 200-400 words, the meat of the article, multi-team roasting",
  "weeklyAwards": [
    { "title": "string — short award name", "team": "string — exact team name from context", "blurb": "string — 1 sentence savage" },
    ... 4 awards total ...
  ]
}`;

const MODEL_ID = "claude-opus-4-7";

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
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const dataDir = path.join(process.cwd(), "data");
  const season = JSON.parse(readFileSync(path.join(dataDir, `season_${year}.json`), "utf-8")) as SeasonData;
  const players = JSON.parse(readFileSync(path.join(dataDir, "players.json"), "utf-8")) as Record<string, PlayerSlim>;

  if (!season.matchupsByWeek[week]) {
    console.error(`No matchup data for ${year} week ${week}`);
    process.exit(1);
  }

  const teams = buildTeamMeta(season);
  const rosterMetadata = new Map(season.rosters.map((r) => [r.roster_id, r.metadata]));

  const leagueContext = formatLeagueContext(season, teams, players);
  const snapshot = buildWeeklySnapshot(season, week, players);
  const weekData = formatSnapshotForPrompt(snapshot, teams, players, rosterMetadata);

  const client = new Anthropic({ apiKey });

  console.log(`Generating recap for ${year} Week ${week}…`);
  const t0 = Date.now();

  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: leagueContext, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: `Write the recap for the data below.\n\n${weekData}\n\nReturn only the JSON object.`,
      },
    ],
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const usage = response.usage;
  console.log(
    `  → ${elapsed}s · in: ${usage.input_tokens} (cache write: ${usage.cache_creation_input_tokens ?? 0}, cache read: ${usage.cache_read_input_tokens ?? 0}) · out: ${usage.output_tokens}`
  );

  // Extract text from response (skip thinking blocks)
  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }

  // Strip code fences if Claude wrapped the JSON
  text = text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }

  let parsed: RecapJson;
  try {
    parsed = JSON.parse(text) as RecapJson;
  } catch (err) {
    console.error("Failed to parse JSON. Raw response:");
    console.error(text);
    throw err;
  }

  const recapsDir = path.join(dataDir, "recaps");
  if (!existsSync(recapsDir)) mkdirSync(recapsDir, { recursive: true });

  const out: Saved = {
    ...parsed,
    season: year,
    week,
    generatedAt: new Date().toISOString(),
    modelId: MODEL_ID,
  };
  const file = path.join(recapsDir, `${year}-w${String(week).padStart(2, "0")}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`  Wrote ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
