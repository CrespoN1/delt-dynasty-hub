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
import { fetchFpSuperflexBoard, fetchFpNews, type FpRow, type FpNews } from "../fantasypros";

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

// Dynasty trade value from the superflex overall ECR — a smooth decay so the
// top tier is worth a lot and value falls off with rank. Unranked (outside the
// ~540 board) gets a small floor. Relative values are what matter for fairness.
function dynValue(ecr?: number | null): number {
  if (ecr == null) return 20;
  return Math.round(10000 * Math.exp(-(ecr - 1) / 60));
}

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
  let fpNews = new Map<number, FpNews>();
  const fpKey = process.env.FANTASYPROS_API_KEY;
  if (fpKey) {
    [fp, fpNews] = await Promise.all([
      fetchFpSuperflexBoard(fpKey).catch(() => new Map<string, FpRow>()),
      fetchFpNews(fpKey).catch(() => new Map<number, FpNews>()),
    ]);
  }
  const fpEcr = (name: string): FpRow | undefined => fp.get(norm(name));
  // latest FantasyPros analyst news for a player, joined by FP player_id
  const newsFor = (name: string): Any | undefined => {
    const f = fpEcr(name);
    if (!f) return undefined;
    const nw = fpNews.get(f.id);
    if (!nw) return undefined;
    return { title: nw.title, impact: nw.impact || nw.desc, date: nw.date, link: nw.link };
  };

  // Sleeper name index (age/team enrichment for FP-only board entries)
  const byNorm = new Map<string, Any>();
  for (const p of Object.values(players)) {
    const nm = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (nm) byNorm.set(norm(nm), p);
  }

  // Live Sleeper trending adds/drops (last 48h, league-wide) for the Movers feed
  let addTrend: Any[] = [];
  let dropTrend: Any[] = [];
  try {
    [addTrend, dropTrend] = await Promise.all([
      get<Any[]>(`${API}/players/nfl/trending/add?lookback_hours=48&limit=20`),
      get<Any[]>(`${API}/players/nfl/trending/drop?lookback_hours=48&limit=20`),
    ]);
  } catch {
    addTrend = [];
    dropTrend = [];
  }

  // Live rookie-draft picks (empty until the draft starts) + NFL season phase.
  let draftPicks: Any[] = [];
  let nflState: Any = {};
  try {
    [draftPicks, nflState] = await Promise.all([
      get<Any[]>(`${API}/draft/${DRAFT_ID}/picks`).catch(() => []),
      get<Any>(`${API}/state/nfl`).catch(() => ({})),
    ]);
  } catch {
    draftPicks = [];
    nflState = {};
  }

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
    out.value = dynValue(f?.ecr);
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

  // ---- board: FP-native (live), left-joined with curated notes ----
  // When FantasyPros is live the board is built from the real overall ECR (top
  // ~130), so risers auto-appear and the order never goes stale; curated notes/
  // tiers attach by name. Falls back to the curated hand-order if FP is down.
  const fpSentMap = new Map(fpSentiment.map((x) => [norm(x.name), x]));
  const movdir = new Map(movers.map((m) => [norm(m.name), m.direction as string]));
  const curatedBoard = new Map(board.map((p) => [norm(p.name), p]));
  const tierLabel = (ecr: number, curated?: string): string =>
    curated || (ecr <= 12 ? "Elite" : ecr <= 36 ? "Tier 1" : ecr <= 72 ? "Tier 2" : ecr <= 120 ? "Tier 3" : "Depth");

  let boardOut: Any[];
  if (fp.size > 0) {
    const fpRows = [...fp.values()]
      .filter((r) => ["QB", "RB", "WR", "TE"].includes(r.pos))
      .sort((a, b) => a.ecr - b.ecr)
      .slice(0, 130);
    const inFp = new Set(fpRows.map((r) => norm(r.name)));
    const merged: Any[] = fpRows.map((r) => {
      const c = curatedBoard.get(norm(r.name));
      const sl = byNorm.get(norm(r.name));
      return {
        name: r.name,
        pos: r.pos,
        team: r.team || c?.team || sl?.team || "FA",
        age: c?.age ?? sl?.age ?? null,
        tier: tierLabel(r.ecr, c?.tier),
        note: c?.note || "",
        fpEcr: r.ecr,
        fpDelta: r.delta,
        _sort: r.ecr,
      };
    });
    // keep any curated player who fell outside the live top-130 (with their note)
    for (const c of board)
      if (!inFp.has(norm(c.name))) merged.push({ ...c, _sort: 9999 });
    merged.sort((a, b) => a._sort - b._sort);
    boardOut = merged.map((p, i) => {
      p.rank = i + 1;
      p.owner = ownerOf(p.name);
      const _f = fpEcr(p.name);
      p.sent = overlayFp(boardSent(p, fpSentMap, movdir), _f);
      p.value = dynValue(p.fpEcr);
      if (_f) {
        p.ecrRange = { min: _f.rankMin, max: _f.rankMax };
        p.owned = _f.owned;
      }
      p.news = newsFor(p.name);
      delete p._sort;
      return p;
    });
  } else {
    boardOut = board.map((p, i) => {
      p.rank = i + 1;
      p.owner = ownerOf(p.name);
      p.sent = boardSent(p, fpSentMap, movdir);
      p.value = dynValue(p.fpEcr);
      return p;
    });
  }

  // ---- live rookie draft: who's already been picked ----
  const draftedNorm = new Set<string>();
  const draftLog: Any[] = [];
  for (const dp of draftPicks) {
    const meta = dp.metadata || {};
    const nm =
      meta.first_name || meta.last_name
        ? `${meta.first_name ?? ""} ${meta.last_name ?? ""}`.trim()
        : players[dp.player_id]?.full_name || "";
    if (!nm) continue;
    draftedNorm.add(norm(nm));
    draftLog.push({
      pick: dp.pick_no,
      round: dp.round,
      name: nm,
      pos: meta.position || players[dp.player_id]?.position || "?",
      team: meta.team || players[dp.player_id]?.team || "FA",
      byMe: dp.roster_id === MY_ROSTER_ID,
    });
  }
  draftLog.sort((a, b) => a.pick - b.pick);

  // ---- rookies: owner + FP ECR + sentiment + live consensus rank/slot ----
  for (const r of rookies) {
    r.owner = ownerOf(r.name);
    const f = fpEcr(r.name);
    if (f) {
      r.fpEcr = f.ecr;
      r.fpDelta = f.delta;
      r.ecrRange = { min: f.rankMin, max: f.rankMax }; // where analysts range him
      r.owned = f.owned;
    }
    r.value = dynValue(f?.ecr);
    r.drafted = draftedNorm.has(norm(r.name));
    r.news = newsFor(r.name); // live FantasyPros analyst take, if any
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

  // ---- movers: LIVE Sleeper trending adds/drops + your injury watch ----
  // Rising = most-added across Sleeper (48h), Falling = most-dropped, Watch =
  // YOUR rostered players carrying an injury designation. Falls back to the
  // curated movers.json if the trending feed is unavailable.
  const trendItem = (pid: string, count: number, direction: "up" | "down"): Any | null => {
    const p = players[pid];
    if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return null;
    const nm = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (!nm) return null;
    const f = fpEcr(nm);
    const ecrTxt = f ? `dynasty ECR #${f.ecr}` : "outside the top ~540 dynasty";
    const n = count.toLocaleString();
    const note =
      direction === "up"
        ? `Most-added across Sleeper (48h) — ${n} adds. ${f ? `Real dynasty value (${ecrTxt}).` : `Deeper/speculative (${ecrTxt}).`}`
        : `Most-dropped across Sleeper (48h) — ${n} drops. ${ecrTxt}.`;
    return { name: nm, pos: p.position, team: p.team || "FA", direction, note, owner: ownerOf(nm), fpEcr: f?.ecr };
  };
  let moversOut: Any[] = [];
  if (addTrend.length || dropTrend.length) {
    for (const t of addTrend) {
      const it = trendItem(t.player_id, t.count, "up");
      if (it) moversOut.push(it);
      if (moversOut.filter((m) => m.direction === "up").length >= 10) break;
    }
    for (const t of dropTrend) {
      const it = trendItem(t.player_id, t.count, "down");
      if (it) moversOut.push(it);
      if (moversOut.filter((m) => m.direction === "down").length >= 10) break;
    }
    for (const pid of myteam._pids) {
      const p = players[pid];
      if (!p || !p.injury_status) continue;
      const nm = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      moversOut.push({
        name: nm,
        pos: p.position,
        team: p.team || "FA",
        direction: "watch",
        note: `Injury watch — Sleeper lists him ${p.injury_status}${p.injury_body_part ? ` (${p.injury_body_part})` : ""}.`,
        owner: MY_ROSTER_ID,
        fpEcr: fpEcr(nm)?.ecr,
      });
    }
  } else {
    moversOut = movers.map((m) => ({ ...m, owner: ownerOf(m.name) }));
  }

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
    va.push({ name: nm, pos: p.position, team: p.team, age: p.age ?? null, sr, fpEcr: f?.ecr, fpDelta: f?.delta, value: dynValue(f?.ecr) });
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

  // value each owned rookie pick by the consensus rookie expected at that slot
  const rookiesByRank = [...rookies].sort((a, b) => a.rank - b.rank);
  for (const pk of myPicks) {
    const r = rookiesByRank[pk.overall - 1];
    pk.value = r ? dynValue(r.fpEcr) : 40;
    pk.target = r?.name ?? null;
  }

  // ---- roster needs / positional depth ----
  const boardNames = new Set(boardOut.map((p) => norm(p.name)));
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
    draftStatus: draft.status ?? "pre_draft", // pre_draft | drafting | complete
    draftMade: draftLog.length,
    draftLog,
    nfl: {
      week: nflState.week ?? nflState.display_week ?? null,
      seasonType: nflState.season_type ?? "off",
      inSeason: ["regular", "post"].includes(nflState.season_type),
    },
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
    teams: [shipTeam], // only MY roster ships to the team-locked views
    // all rosters (with names) power the Trades tab: analyzer + target finder
    allTeams: teams.map((t) => ({ id: t.id, name: t.name, owner: t.owner, players: t.players })),
    board: boardOut,
    rookies,
    movers: moversOut,
    vets,
    fpEngaged: fp.size > 0,
  };
}
