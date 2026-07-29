// Generate a FRESH per-rookie analyst take with Claude + web search. Run daily
// by the rookie-takes cron, which commits the result to rookie_takes.json so the
// dashboard can serve current commentary fast (no per-visit model calls).

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5"; // fast enough to research + summarize under the 60s cap

export interface RookieLite {
  name: string;
  pos: string;
  team: string;
  college?: string;
}

// Returns { "<player name>": "1-2 sentence current analyst take" }.
export async function generateRookieTakes(
  rookies: RookieLite[],
  apiKey: string
): Promise<Record<string, string>> {
  const client = new Anthropic({ apiKey });
  const list = rookies
    .map((r) => `${r.name} (${r.pos}, ${r.team}${r.college ? ", " + r.college : ""})`)
    .join("; ");

  const prompt = `You are a dynasty fantasy football analyst. Today's date is in your context. Using web search across FantasyPros, DynastyLeagueFootball, DynastyNerds, PFF, ESPN and r/DynastyFF, research the FRESHEST (last ~2 weeks) analyst consensus and news on these 2026 NFL rookies for a 12-team SUPERFLEX PPR dynasty rookie draft.

For EACH player, write ONE current, specific sentence (max ~28 words): where their rookie-draft stock sits and why, plus any recent camp/depth-chart/news development. Anchor to analyst consensus; do NOT invent injuries or transactions.

Return ONLY a JSON object (no prose, no markdown fences) mapping the EXACT player name to the take string, e.g. {"Jeremiyah Love":"...","Carnell Tate":"..."}. Include every player.

PLAYERS: ${list}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4500,
    output_config: { effort: "low" } as any,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 } as any],
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in rookie-takes response");
  return JSON.parse(match[0]) as Record<string, string>;
}
