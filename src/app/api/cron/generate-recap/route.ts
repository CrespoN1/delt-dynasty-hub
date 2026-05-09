import { NextRequest } from "next/server";
import {
  detectLatestCompleteWeek,
  fetchSeasonForWeek,
  fetchSlimPlayers,
} from "@/lib/sleeper-fetch";
import { generateRecap } from "@/lib/recap-generator";
import { commitFile, getFileSha } from "@/lib/github";
import { notifyRecapDropped } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby tier cap

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

  // Determine target week — fast path: just probe weeks until we find the latest complete one
  let targetWeek: number;
  let targetSeason: string;
  if (overrideWeek && overrideYear) {
    targetWeek = Number(overrideWeek);
    targetSeason = overrideYear;
  } else {
    const probe = await detectLatestCompleteWeek(LEAGUE_ID);
    targetSeason = probe.league.season;
    if (!probe.week) {
      return Response.json({ ok: true, skipped: "no completed weeks yet", season: probe.league.season });
    }
    targetWeek = probe.week;
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

  // Fetch slim season (just this week) + players in parallel
  const [season, players] = await Promise.all([
    fetchSeasonForWeek(LEAGUE_ID, targetWeek),
    fetchSlimPlayers(),
  ]);
  if (!season.matchupsByWeek[targetWeek]) {
    return Response.json(
      { ok: false, error: `Week ${targetWeek} has no scored matchups yet` },
      { status: 400 }
    );
  }
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

  // Send notification email (best-effort — don't fail the cron if email fails)
  let notify: { ok: boolean; id?: string; error?: string } | null = null;
  const resendKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.RECAP_NOTIFY_EMAIL;
  const siteUrl = process.env.SITE_URL ?? "https://delt-dynasty-hub.vercel.app";
  if (resendKey && notifyEmail) {
    const result = await notifyRecapDropped({
      recap,
      toEmail: notifyEmail,
      apiKey: resendKey,
      siteUrl,
    });
    notify = result;
  }

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
    notify,
  });
}
