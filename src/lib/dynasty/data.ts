// Live Sleeper data for the Delt Dynasty daily brief: the recipient's roster,
// post-trade rookie picks, positional needs, and the waiver pool.

const LEAGUE_ID = "1313673066445819904";
const DRAFT_ID = "1313673066458390528";
const MY_ROSTER_ID = 12; // 7BigPapi7 / "Little Peckers"
const API = "https://api.sleeper.app/v1";

type Sleeper = Record<string, unknown>;

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b\.?/gi;
export function norm(n: string): string {
  return (n || "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(SUFFIX, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Player {
  name: string;
  pos: string;
  team: string;
  age: number | null;
}
export interface Pick {
  round: number;
  slot: number;
  overall: number;
  label: string;
  acquired: boolean;
}
export interface DynastyData {
  roster: Player[];
  picks: Pick[];
  needs: string[];
  waivers: Player[];
  teamName: string;
}

const TARGETS: Record<string, number> = { QB: 3, RB: 5, WR: 6, TE: 2 };

export async function fetchDynastyData(): Promise<DynastyData> {
  const [rosters, users, players, traded, draft] = await Promise.all([
    get<any[]>(`${API}/league/${LEAGUE_ID}/rosters`),
    get<any[]>(`${API}/league/${LEAGUE_ID}/users`),
    get<Record<string, Sleeper>>(`${API}/players/nfl`),
    get<any[]>(`${API}/league/${LEAGUE_ID}/traded_picks`),
    get<any>(`${API}/draft/${DRAFT_ID}`),
  ]);

  const umap = new Map(users.map((u) => [u.user_id, u]));
  const pname = (pid: string): Player => {
    const p = (players[pid] as any) || {};
    const name =
      p.full_name ||
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
      pid;
    return { name, pos: p.position ?? "?", team: p.team ?? "FA", age: p.age ?? null };
  };

  const mine = rosters.find((r) => r.roster_id === MY_ROSTER_ID);
  const roster: Player[] = (mine?.players ?? []).map(pname);
  const owner = umap.get(mine?.owner_id);
  const teamName = (owner?.metadata?.team_name as string) || "Little Peckers";

  // needs: positions with fewer top-ish players than a healthy superflex target.
  // (We approximate "quality" as rostered count here; the dashboard uses top-100.)
  const byPos: Record<string, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
  for (const p of roster) if (byPos[p.pos]) byPos[p.pos].push(p);

  // owned rookie picks (post-trade)
  const s2r: Record<number, number> = {};
  for (const [slot, rid] of Object.entries(draft.slot_to_roster_id ?? {}))
    s2r[Number(slot)] = rid as number;
  const r2s = new Map(Object.entries(s2r).map(([slot, rid]) => [rid, Number(slot)]));
  const cur = new Map<string, number>();
  for (const t of traded)
    cur.set(`${t.season}|${t.round}|${t.roster_id}`, t.owner_id);
  const rounds = draft.settings?.rounds ?? 4;
  const teams = draft.settings?.teams ?? 12;
  const picks: Pick[] = [];
  for (let rd = 1; rd <= rounds; rd++) {
    for (let orig = 1; orig <= teams; orig++) {
      const ownerId = cur.get(`2026|${rd}|${orig}`) ?? orig;
      if (ownerId === MY_ROSTER_ID) {
        const slot = r2s.get(orig)!;
        picks.push({
          round: rd,
          slot,
          overall: (rd - 1) * teams + slot,
          label: `${rd}.${String(slot).padStart(2, "0")}`,
          acquired: orig !== MY_ROSTER_ID,
        });
      }
    }
  }
  picks.sort((a, b) => a.overall - b.overall);

  // waiver pool: skill players not rostered anywhere, ranked by Sleeper search_rank
  const rostered = new Set<string>();
  for (const r of rosters) for (const pid of r.players ?? []) rostered.add(pid);
  const waivers: Player[] = [];
  const pool: { sr: number; p: Player }[] = [];
  for (const [pid, raw] of Object.entries(players)) {
    if (rostered.has(pid)) continue;
    const p = raw as any;
    if (!["QB", "RB", "WR", "TE"].includes(p.position)) continue;
    if (!p.team) continue;
    const sr = p.search_rank;
    if (sr == null || sr >= 9999999) continue;
    pool.push({ sr, p: pname(pid) });
  }
  pool.sort((a, b) => a.sr - b.sr);
  for (const { p } of pool.slice(0, 25)) waivers.push(p);

  // needs = positions below target on ROSTER count as a rough proxy
  const needs = ["QB", "RB", "WR", "TE"].filter(
    (pos) => (byPos[pos]?.length ?? 0) < TARGETS[pos]
  );

  return { roster, picks, needs, waivers, teamName };
}
