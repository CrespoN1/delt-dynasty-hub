import { NextRequest } from "next/server";
import { fetchNflState, fetchSeasonByLeagueId, fetchSlimPlayers } from "@/lib/sleeper-fetch";
import { generateRecap } from "@/lib/recap-generator";
import { commitFile, getFileSha } from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — recap generation can take ~30-60s

const LEAGUE_ID = "1313673066445819904";
const REPO_OWNER = "CrespoN1";
const REPO_NAME = "delt-dynasty-hub";
const BRANCH = "main";

// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically when CRON_SECRET env var is set.
// For manual triggers, the same header is required.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const overrideWeek = searchParams.get("week");
  const overrideYear = searchParams.get("year");
  const force = searchParams.get("force") === "1";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const ghToken = process.env.GH_RECAP_TOKEN;
  if (!apiKey || !ghToken) {
    return Response.json(
      { ok: false, error: "Missing ANTHROPIC_API_KEY or GH_RECAP_TOKEN env var" },
      { status: 500 }
    );
  }

  // Determine target season + week
  const state = await fetchNflState();
  const season = await fetchSeasonByLeagueId(LEAGUE_ID);
  const targetSeason = overrideYear ?? season.league.season;
  const completedWeeks = Object.keys(season.matchupsByWeek)
    .map((w) => Number(w))
    .filter((w) => {
      // Consider a week "completed" if all teams have non-zero points OR matchup is in past relative to NFL state
      const matchups = season.matchupsByWeek[w];
      return matchups.every((m) => m.points > 0);
    })
    .sort((a, b) => a - b);

  let targetWeek: number;
  if (overrideWeek) {
    targetWeek = Number(overrideWeek);
  } else {
    const latestComplete = completedWeeks[completedWeeks.length - 1];
    if (!latestComplete) {
      return Response.json({ ok: true, skipped: "no completed weeks yet", state });
    }
    targetWeek = latestComplete;
  }

  const path = `data/recaps/${targetSeason}-w${String(targetWeek).padStart(2, "0")}.json`;

  // Skip if already generated (unless force)
  let existingSha: string | undefined;
  if (!force) {
    const existing = await getFileSha({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      branch: BRANCH,
      token: ghToken,
    });
    if (existing) {
      return Response.json({ ok: true, skipped: "already exists", path, season: targetSeason, week: targetWeek });
    }
  } else {
    const existing = await getFileSha({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      branch: BRANCH,
      token: ghToken,
    });
    existingSha = existing?.sha;
  }

  // Fetch players + generate
  const players = await fetchSlimPlayers();
  const t0 = Date.now();
  const { recap, usage } = await generateRecap({
    season,
    week: targetWeek,
    players,
    apiKey,
  });
  const elapsedMs = Date.now() - t0;

  // Commit JSON to GitHub
  const content = JSON.stringify(recap, null, 2) + "\n";
  const { commitSha } = await commitFile({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    path,
    branch: BRANCH,
    content,
    message: `Auto-generate recap: ${targetSeason} Week ${targetWeek}`,
    token: ghToken,
    sha: existingSha,
  });

  return Response.json({
    ok: true,
    season: targetSeason,
    week: targetWeek,
    path,
    commitSha,
    elapsedMs,
    headline: recap.headline,
    usage: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    },
  });
}
