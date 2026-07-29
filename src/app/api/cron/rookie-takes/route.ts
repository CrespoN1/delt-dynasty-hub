// Daily cron: generate a fresh per-rookie analyst take (Claude + web search) and
// commit it to rookie_takes.json in the repo. Vercel auto-redeploys, so the
// dashboard serves current commentary without any per-visit model calls.

import { NextRequest } from "next/server";
import rookiesDeep from "@/lib/dynasty/dashboard/rookies_deep.json";
import { generateRookieTakes, type RookieLite } from "@/lib/dynasty/dashboard/rookie-takes";
import { getFileSha, commitFile } from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby tier cap

const REPO_OWNER = "CrespoN1";
const REPO_NAME = "delt-dynasty-hub";
const BRANCH = "main";
const FILE_PATH = "src/lib/dynasty/dashboard/rookie_takes.json";

// name normalize — must match build.ts so takes join to rookies by key
const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b\.?/gi;
function norm(n: string): string {
  return (n || "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(SUFFIX, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  return !!expected && req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const ghToken = process.env.GH_RECAP_TOKEN;
  if (!apiKey || !ghToken) {
    return Response.json(
      { ok: false, error: "Missing ANTHROPIC_API_KEY or GH_RECAP_TOKEN" },
      { status: 500 }
    );
  }

  const t0 = Date.now();
  try {
    const rookies = (rookiesDeep as RookieLite[]).map((r) => ({
      name: r.name,
      pos: r.pos,
      team: r.team,
      college: r.college,
    }));

    const raw = await generateRookieTakes(rookies, apiKey);
    // normalize keys so build.ts joins by norm(name); keep only known rookies
    const known = new Map(rookies.map((r) => [norm(r.name), r.name]));
    const takes: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const nk = norm(k);
      if (known.has(nk) && typeof v === "string" && v.trim()) takes[nk] = v.trim();
    }

    const payload = JSON.stringify({ updated: new Date().toISOString(), takes }, null, 2) + "\n";
    const existing = await getFileSha({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: FILE_PATH,
      branch: BRANCH,
      token: ghToken,
    });
    const { commitSha } = await commitFile({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: FILE_PATH,
      branch: BRANCH,
      content: payload,
      message: `Refresh rookie analyst takes (${Object.keys(takes).length} players)`,
      token: ghToken,
      sha: existing?.sha,
    });

    return Response.json({
      ok: true,
      players: Object.keys(takes).length,
      commitSha,
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err), elapsedMs: Date.now() - t0 },
      { status: 500 }
    );
  }
}
