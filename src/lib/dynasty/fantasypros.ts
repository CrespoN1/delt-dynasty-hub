// FantasyPros dynasty superflex ECR. NOTE: this API tier caps each query at ~10
// results, so this covers the elite tier (top ~10 per position), not the full
// board. Used as a precise-signal layer in the daily brief; web search fills the rest.
// The key is read from FANTASYPROS_API_KEY (Vercel env) — never hardcode it.

const BASE = "https://api.fantasypros.com/public/v2/json/nfl";

export interface FpRow {
  name: string;
  team: string;
  pos: string;
  ecr: number; // overall consensus rank
  posRank: string; // e.g. "QB1"
  tier: number;
  delta: number; // ECR movement (analyst momentum)
  std: number; // consensus spread — low = agreement, high = divided
}

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

async function fetchOne(
  season: string,
  position: string,
  apiKey: string
): Promise<FpRow[]> {
  const url = `${BASE}/${season}/consensus-rankings?type=dynasty&position=${position}&scoring=PPR`;
  const res = await fetch(url, {
    headers: { "x-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  const rows: any[] = data.players ?? [];
  return rows.map((p) => ({
    name: p.player_name,
    team: p.player_team_id,
    pos: p.player_position_id,
    ecr: Number(p.rank_ecr),
    posRank: p.pos_rank,
    tier: Number(p.tier),
    delta: Number(p.player_ecr_delta ?? 0),
    std: Number(p.rank_std ?? 0),
  }));
}

// Returns a name-normalized map of the elite dynasty tier (OP + each position).
export async function fetchFpEcr(
  apiKey: string,
  season = "2026"
): Promise<Map<string, FpRow>> {
  const positions = ["OP", "QB", "RB", "WR", "TE"];
  const results = await Promise.all(
    positions.map((pos) => fetchOne(season, pos, apiKey).catch(() => []))
  );
  const map = new Map<string, FpRow>();
  for (const rows of results)
    for (const r of rows) {
      const k = norm(r.name);
      // keep the row with the best (lowest) overall ECR if duplicated across queries
      const prev = map.get(k);
      if (!prev || r.ecr < prev.ecr) map.set(k, r);
    }
  return map;
}

// Compact, authoritative block to inject into the model prompt.
export function fpPromptBlock(
  map: Map<string, FpRow>,
  rosterNames: string[]
): string {
  if (map.size === 0) return "";
  const rosterSet = new Set(rosterNames.map(norm));
  const all = [...map.values()].sort((a, b) => a.ecr - b.ecr);
  // This feed can return the full board (~600+ rows). Keep the prompt lean and
  // fast under the 60s cap: top ~60 overall PLUS every recipient-roster player
  // (so the user's guys always carry their exact ECR, even if outside the top).
  const TOP = 60;
  const rows = all.filter(
    (r, i) => i < TOP || rosterSet.has(norm(r.name))
  );
  const line = (r: FpRow) =>
    `${r.name} — ECR #${r.ecr} (${r.posRank}), tier ${r.tier}, 30d move ${
      r.delta > 0 ? "+" : ""
    }${r.delta}, consensus spread ${r.std.toFixed(1)}${
      rosterSet.has(norm(r.name)) ? "  [ON RECIPIENT ROSTER]" : ""
    }`;
  return `FANTASYPROS DYNASTY SUPERFLEX ECR (authoritative — use these EXACT numbers for any player listed: the top ~60 overall plus every player on the recipient's roster; use web search for anyone not listed). Lower ECR = better; a negative "30d move" means the player is rising in consensus; a low "consensus spread" means analysts agree, a high one means they're divided:
${rows.map(line).join("\n")}`;
}
