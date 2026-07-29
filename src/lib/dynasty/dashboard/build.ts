// Server-side builder for the always-fresh Delt Dynasty War Room dashboard.
// Ports the original build.py + refresh.py (live Sleeper) and layers in the
// live FantasyPros dynasty superflex ECR feed (key stays in Vercel env).
//
// It fetches live Sleeper (all rosters / traded picks / draft) + FantasyPros
// ECR, merges them with the hand-curated rankings JSON committed alongside, and
// returns the `data` blob the template's client JS renders.

import boardRaw from "./board.json";
import rookiesRaw from "./rookies_deep.json";
import moversRaw from "./movers.json";
import fpSentimentRaw from "./fp_sentiment.json";
import { fetchFpEcr, type FpRow } from "../fantasypros";

const LEAGUE_ID = "1313673066445819904";
const DRAFT_ID = "1313673066458390528";
const MY_ROSTER_ID = 12; // 7BigPapi7 / "Little Peckers"
const API = "https://api.sleeper.app/v1";

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

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

type Any = Record<string, any>;
const board = boardRaw as Any[];
const rookies = rookiesRaw as Any[];
const movers = moversRaw as Any[];
const fpSentiment = fpSentimentRaw as Any[];

// ---- analyst sentiment helpers (ported from build.py) ----
function boardSent(p: Any, fpmap: Map<string, Any>, movdir: Map<string, string>): Any {
  const k = norm(p.name);
  const curated = fpmap.get(k);
  if (curated) {
    return {
      signal: curated.signal,
      trend: curated.trend,
      consensus: curated.consensus ?? "mixed",
      take: curated.take,
      src: "FantasyPros",
    };
  }
  const d = movdir.get(k);
  if (d === "up")
    return { signal: "Buy", trend: "rising", consensus: "mixed", take: "Trending up in this week’s dynasty movers.", src: "Movers" };
  if (d === "down")
    return { signal: "Sell", trend: "falling", consensus: "mixed", take: "Trending down in this week’s dynasty movers.", src: "Movers" };
  if (d === "watch")
    return { signal: "Hold", trend: "steady", consensus: "divided", take: "On the analyst watch list — situation in flux.", src: "Movers" };
  const n = (p.note || "").toLowerCase();
  const buy = ["buy-low", "buy low", "ascending", "trending up", "value up", " rising", "reclaiming", "undervalued", "breakout", "riser", "ceiling rising", "trending sharply up"];
  const sell = ["cratered", "trending down", "possible sell", "fading", "declining", "buried", "slipping", "sell-high", "minimal long-term", "win-now", "drift"];
  if (buy.some((w) => n.includes(w)))
    return { signal: "Buy", trend: "rising", consensus: "mixed", take: p.note || "", src: "Notes" };
  if (sell.some((w) => n.includes(w))) {
    const hard = ["cratered", "trending down", "fading", "declining", "buried", "slipping", "sell-high"];
    const sig = hard.some((w) => n.includes(w)) ? "Sell" : "Hold";
    return { signal: sig, trend: sig === "Sell" ? "falling" : "steady", consensus: "mixed", take: p.note || "", src: "Notes" };
  }
  return { signal: "Hold", trend: "steady", consensus: "mixed", take: "No strong buy/sell signal in current analyst chatter — hold.", src: "Baseline" };
}

// Overlay LIVE FantasyPros movement (30d ECR delta) + agreement (rank spread)
// onto a sentiment object, so trend/consensus reflect the current feed.
function overlayFp(sent: Any, fp?: FpRow): Any {
  if (!fp) return sent;
  const out = { ...sent };
  if (fp.delta <= -3) out.trend = "rising";
  else if (fp.delta >= 3) out.trend = "falling";
  if (fp.std && fp.std < 8) out.consensus = "strong";
  else if (fp.std && fp.std > 20) out.consensus = "divided";
  out.src = "FantasyPros (live)";
  return out;
}

function rookieSent(r: Any): Any {
  const prof = r.profile || "";
  const b = (r.buzz || "").toLowerCase();
  const has = (...w: string[]) => w.some((x) => b.includes(x));
  let tr: string;
  if (has("fading", "cooling", "overvalued", "overhyped", "buyer-beware", "slid behind", "muted", "slipping")) tr = "falling";
  else if (has("hyped", "rising", "riser", "sleeper", "buy-low", "undervalued", "underrated", "all-in", "bullish", "helium", "climbing")) tr = "rising";
  else tr = "steady";
  let sig: string;
  if (has("overvalued", "overhyped")) sig = "Sell";
  else if (prof === "Bust risk") sig = "Sell";
  else if (has("buy-low", "undervalued", "underrated")) sig = "Buy";
  else if (prof === "Boom") sig = "Buy";
  else if ((prof === "Balanced" || prof === "Safe floor") && has("hyped", "consensus", "co-favorite", "wr1", "unanimous", "rising")) sig = "Buy";
  else sig = "Hold";
  const cons = has("split", "disagree", "debate", "buyer-beware", "divided", " vs ", "buyer beware")
    ? "divided"
    : has("unanimous", "consensus", "universal", "clear")
    ? "strong"
    : "mixed";
  return { signal: sig, trend: tr, consensus: cons, take: (r.buzz || "").slice(0, 150), src: "Buzz" };
}

const TARGETS: Record<string, number> = { QB: 3, RB: 5, WR: 6, TE: 2 };

export async function buildDashboardData(): Promise<Any> {
  const [rosters, users, players, traded, draft] = await Promise.all([
    get<Any[]>(`${API}/league/${LEAGUE_ID}/rosters`),
    get<Any[]>(`${API}/league/${LEAGUE_ID}/users`),
    get<Record<string, Any>>(`${API}/players/nfl`),
    get<Any[]>(`${API}/league/${LEAGUE_ID}/traded_picks`),
    get<Any>(`${API}/draft/${DRAFT_ID}`),
  ]);

  // ---- live FantasyPros ECR (elite superflex board) ----
  let fp = new Map<string, FpRow>();
  const fpKey = process.env.FANTASYPROS_API_KEY;
  if (fpKey) {
    try {
      fp = await fetchFpEcr(fpKey);
    } catch {
      fp = new Map();
    }
  }
  const fpEcr = (name: string): FpRow | undefined => fp.get(norm(name));

  const umap = new Map(users.map((u) => [u.user_id, u]));
  const pname = (pid: string) => {
    const p = players[pid] || {};
    const nm = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || pid;
    const out: Any = { name: nm, pos: p.position ?? "?", team: p.team ?? "FA", age: p.age ?? null };
    const f = fpEcr(nm);
    if (f) {
      out.fpEcr = f.ecr;
      out.fpDelta = f.delta;
    }
    return out;
  };

  // ---- teams (only MY team ships; others feed the ownership index) ----
  const teams = rosters.map((r) => {
    const u = umap.get(r.owner_id) || {};
    const meta = (u.metadata as Any) || {};
    return {
      id: r.roster_id,
      owner: u.display_name,
      name: meta.team_name || u.display_name,
      players: (r.players || []).map(pname),
      _pids: r.players || [],
    };
  });

  // ownership index: normalized name -> roster_id
  const own = new Map<string, number>();
  for (const r of rosters)
    for (const pid of r.players || []) {
      const p = players[pid] || {};
      const nm = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      if (nm) own.set(norm(nm), r.roster_id);
    }
  const ownerOf = (name: string): number | null => own.get(norm(name)) ?? null;

  const myteam = teams.find((t) => t.id === MY_ROSTER_ID)!;

  // ---- board: rank + owner + FP ECR + sentiment ----
  const fpSentMap = new Map(fpSentiment.map((x) => [norm(x.name), x]));
  const movdir = new Map(movers.map((m) => [norm(m.name), m.direction as string]));
  board.forEach((p, i) => {
    p.rank = i + 1;
    p.owner = ownerOf(p.name);
    const f = fpEcr(p.name);
    if (f) {
      p.fpEcr = f.ecr;
      p.fpDelta = f.delta;
    }
    p.sent = overlayFp(boardSent(p, fpSentMap, movdir), f);
  });

  // ---- rookies: owner + FP ECR + sentiment + live consensus rank/slot ----
  for (const r of rookies) {
    r.owner = ownerOf(r.name);
    const f = fpEcr(r.name);
    if (f) {
      r.fpEcr = f.ecr;
      r.fpDelta = f.delta;
    }
    r.sent = rookieSent(r);
  }
  // Re-rank the rookie class by LIVE FantasyPros ECR (fall back to curated order
  // for anyone not in the feed), then derive a consensus 12-team rookie-draft slot.
  rookies.forEach((r, i) => (r._ord = i));
  rookies.sort((a, b) => (a.fpEcr ?? 1000 + a._ord) - (b.fpEcr ?? 1000 + b._ord));
  rookies.forEach((r, i) => {
    r.rank = i + 1;
    const rd = Math.ceil(r.rank / 12);
    const slot = ((r.rank - 1) % 12) + 1;
    r.rookieRound = `${rd}.${String(slot).padStart(2, "0")}`;
    delete r._ord;
  });

  // ---- movers: owner ----
  for (const m of movers) m.owner = ownerOf(m.name);

  // ---- waiver vets: unrostered skill players, ranked by FP dynasty value ----
  const rostered = new Set<string>();
  for (const r of rosters) for (const pid of r.players || []) rostered.add(pid);
  const va: Any[] = [];
  for (const [pid, p] of Object.entries(players)) {
    if (rostered.has(pid)) continue;
    if (!["QB", "RB", "WR", "TE"].includes(p.position)) continue;
    if (!p.team) continue;
    const sr = p.search_rank;
    if (sr == null || sr >= 9999999) continue;
    if ((p.years_exp || 0) < 1) continue; // 2026 rookies covered on the Rookie tab
    const nm = (p.full_name || "").trim();
    if (!nm) continue;
    const f = fpEcr(nm);
    va.push({ name: nm, pos: p.position, team: p.team, age: p.age ?? null, sr, fpEcr: f?.ecr, fpDelta: f?.delta });
  }
  // FP value first (lower ECR = better), then Sleeper search_rank for the rest.
  va.sort((a, b) => (a.fpEcr ?? 100000) - (b.fpEcr ?? 100000) || a.sr - b.sr);
  const vets = va.slice(0, 18);

  // ---- owned rookie picks (post-trade) ----
  const s2r: Record<number, number> = {};
  for (const [slot, rid] of Object.entries(draft.slot_to_roster_id || {})) s2r[Number(slot)] = rid as number;
  const r2s = new Map(Object.entries(s2r).map(([slot, rid]) => [rid, Number(slot)]));
  const cur = new Map<string, number>();
  for (const t of traded) cur.set(`${t.season}|${t.round}|${t.roster_id}`, t.owner_id);
  const rounds = draft.settings?.rounds ?? 4;
  const nteams = draft.settings?.teams ?? 12;
  const myPicks: Any[] = [];
  for (let rd = 1; rd <= rounds; rd++) {
    for (let orig = 1; orig <= nteams; orig++) {
      const ownerId = cur.get(`2026|${rd}|${orig}`) ?? orig;
      if (ownerId === MY_ROSTER_ID) {
        const slot = r2s.get(orig)!;
        myPicks.push({
          round: rd,
          origSlot: slot,
          overall: (rd - 1) * nteams + slot,
          label: `${rd}.${String(slot).padStart(2, "0")}`,
          fromRoster: orig,
        });
      }
    }
  }
  myPicks.sort((a, b) => a.overall - b.overall);

  // ---- roster needs / positional depth ----
  const boardNames = new Set(board.map((p) => norm(p.name)));
  const byPos: Record<string, Any[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const p of myteam.players) if (byPos[p.pos]) byPos[p.pos].push(p);
  const posDepth: Any = {};
  const myNeeds: string[] = [];
  for (const [pos, tv] of Object.entries(TARGETS)) {
    const ranked = byPos[pos].filter((p) => boardNames.has(norm(p.name))).length;
    posDepth[pos] = { have: byPos[pos].length, ranked, target: tv, need: ranked < tv };
    if (ranked < tv) myNeeds.push(pos);
  }

  const updated =
    "Live · " +
    new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }) +
    " ET";

  // strip helper field before shipping myteam
  const shipTeam = { id: myteam.id, owner: myteam.owner, name: myteam.name, players: myteam.players };

  return {
    updated,
    myTeam: MY_ROSTER_ID,
    myTeamName: myteam.name,
    myOwner: myteam.owner,
    draft: { slot: 2, teams: 12, rounds: 4, type: "linear" },
    myPicks,
    myNeeds,
    posDepth,
    league: {
      name: "Delt Dynasty",
      format: "Superflex PPR",
      teams: 12,
      lineup: "QB / RB·RB / WR·WR·WR / TE / FLEX·FLEX / SUPERFLEX",
      status: "Pre-draft (4-round rookie draft)",
    },
    teams: [shipTeam], // only MY roster ships — rival identities are stripped
    board,
    rookies,
    movers,
    vets,
    fpEngaged: fp.size > 0,
  };
}
