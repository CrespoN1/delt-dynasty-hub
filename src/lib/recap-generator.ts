// Shared recap-generation logic used by both the local CLI script and
// the serverless cron route.

import Anthropic from "@anthropic-ai/sdk";
import type { PlayerSlim, SeasonData } from "./types";
import { buildTeamMeta } from "./awards";
import { buildWeeklySnapshot, formatLeagueContext, formatSnapshotForPrompt } from "./weekly";

export const RECAP_MODEL = "claude-opus-4-7";

export const RECAP_SYSTEM = `You are the resident shit-talker, hype man, and roastmaster of the Delt Dynasty fantasy football league. You write the weekly recap — savage, hilarious, brutally specific. The league's humor is college-bro crude, profanity is fine, but punch with style not just volume.

CORE RULES:
- Roast EVERYONE. Winners get cocky-energy roasts ("you beat the worst team in the league, calm down"). Losers get buried.
- Use specific stats and player names. Generic insults are weak — "your RB1 dropped a 4-spot in week 13" is gold.
- When the manager-coined player nicknames apply, USE them. They're inside jokes the league owns.
- Vary tone across teams. Don't repeat the same joke shape twice in one recap.
- Punchy. No "in conclusion" filler. No corporate sportscaster voice.
- Each manager appears at least once across the recap.
- Power rankings: rank ALL 12 teams. Order should reflect overall team strength right now (record, point totals, recent form, roster quality), not just this week's score. Top of list is rank 1 (best). Each team gets a 1-sentence savage take that's specific to their week or their season arc — no generic filler.

OUTPUT: A single JSON object matching this exact schema. NO markdown fences, NO commentary outside the JSON.

{
  "headline": "string — savage attention-grabbing title for the week",
  "subhead": "string — one sentence setting up the week's big story",
  "matchOfTheWeek": "string — 2-3 sentences on the most interesting matchup",
  "mainRecap": "string — 200-400 words, the meat of the article, multi-team roasting",
  "powerRankings": [
    { "rank": 1, "team": "string — exact team name from context", "blurb": "string — 1 savage sentence about why they're here" },
    ... ALL 12 teams, ranked 1-12 ...
  ],
  "weeklyAwards": [
    { "title": "string — short award name", "team": "string — exact team name from context", "blurb": "string — 1 sentence savage" },
    ... 4 awards total ...
  ]
}`;

export type PowerRanking = { rank: number; team: string; blurb: string };

export type RecapJson = {
  headline: string;
  subhead: string;
  matchOfTheWeek: string;
  mainRecap: string;
  powerRankings: PowerRanking[];
  weeklyAwards: { title: string; team: string; blurb: string }[];
};

export type GeneratedRecap = RecapJson & {
  season: string;
  week: number;
  generatedAt: string;
  modelId: string;
};

export async function generateRecap({
  season,
  week,
  players,
  apiKey,
}: {
  season: SeasonData;
  week: number;
  players: Record<string, PlayerSlim>;
  apiKey: string;
}): Promise<{ recap: GeneratedRecap; usage: Anthropic.Messages.Usage }> {
  if (!season.matchupsByWeek[week]) {
    throw new Error(`No matchup data for ${season.league.season} week ${week}`);
  }

  const teams = buildTeamMeta(season);
  const rosterMetadata = new Map(season.rosters.map((r) => [r.roster_id, r.metadata]));
  const leagueContext = formatLeagueContext(season, teams, players);
  const snapshot = buildWeeklySnapshot(season, week, players);
  const weekData = formatSnapshotForPrompt(snapshot, teams, players, rosterMetadata);

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: RECAP_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: RECAP_SYSTEM },
      { type: "text", text: leagueContext, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: `Write the recap for the data below.\n\n${weekData}\n\nReturn only the JSON object.`,
      },
    ],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  text = text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }

  const parsed = JSON.parse(text) as RecapJson;
  return {
    recap: {
      ...parsed,
      season: season.league.season,
      week,
      generatedAt: new Date().toISOString(),
      modelId: RECAP_MODEL,
    },
    usage: response.usage,
  };
}
