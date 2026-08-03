// Generate fresh per-rookie analyst takes with Claude + web search, and write
// them to src/lib/dynasty/dashboard/rookie_takes.json. Run by the GitHub Action
// (no serverless time limit, unlike Vercel) — the commit redeploys the hub and
// the dashboard serves the current takes. Needs ANTHROPIC_API_KEY in the env.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DASH = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "dynasty", "dashboard");
const rookies = JSON.parse(readFileSync(join(DASH, "rookies_deep.json"), "utf8"));

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b\.?/gi;
const norm = (n) =>
  (n || "").toLowerCase().replace(/[.'’]/g, "").replace(SUFFIX, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}
const client = new Anthropic({ apiKey });

const list = rookies.map((r) => `${r.name} (${r.pos}, ${r.team}${r.college ? ", " + r.college : ""})`).join("; ");
const prompt = `You are a dynasty fantasy football analyst. Today's date is in your context. Using web search across FantasyPros, DynastyLeagueFootball, DynastyNerds, PFF, ESPN and r/DynastyFF, research the FRESHEST (last ~2 weeks) analyst consensus and news on these 2026 NFL rookies for a 12-team SUPERFLEX PPR dynasty rookie draft.

For EACH player, write ONE current, specific sentence (max ~28 words): where their rookie-draft stock sits and why, plus any recent camp / depth-chart / news development. Anchor to analyst consensus; do NOT invent injuries or transactions.

Return ONLY a JSON object (no prose, no markdown fences) mapping the EXACT player name to the take string, e.g. {"Jeremiyah Love":"...","Carnell Tate":"..."}. Include every player.

PLAYERS: ${list}`;

const resp = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 6000,
  tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
  messages: [{ role: "user", content: prompt }],
});

const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
const m = text.match(/\{[\s\S]*\}/);
if (!m) {
  console.error("No JSON in response. Head:", text.slice(0, 400));
  process.exit(1);
}
const raw = JSON.parse(m[0]);
const known = new Map(rookies.map((r) => [norm(r.name), r.name]));
const takes = {};
for (const [k, v] of Object.entries(raw)) {
  const nk = norm(k);
  if (known.has(nk) && typeof v === "string" && v.trim()) takes[nk] = v.trim();
}
if (Object.keys(takes).length === 0) {
  console.error("Parsed zero known-player takes; refusing to overwrite.");
  process.exit(1);
}
writeFileSync(
  join(DASH, "rookie_takes.json"),
  JSON.stringify({ updated: new Date().toISOString(), takes }, null, 2) + "\n"
);
console.log(`Wrote ${Object.keys(takes).length} rookie takes.`);
