// Server-only helpers — fetch a single season's data live from Sleeper.
// Used by the cron route, not the local script.

import type {
  PlayerSlim,
  SeasonData,
  SleeperDraftPick,
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperTransaction,
  SleeperUser,
} from "./types";

const API = "https://api.sleeper.app/v1";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchSeasonByLeagueId(leagueId: string): Promise<SeasonData> {
  const league = await get<SleeperLeague>(`${API}/league/${leagueId}`);
  const [users, rosters] = await Promise.all([
    get<SleeperUser[]>(`${API}/league/${leagueId}/users`),
    get<SleeperRoster[]>(`${API}/league/${leagueId}/rosters`),
  ]);

  const playoffWeekStart = Number(league.settings.playoff_week_start ?? 15);
  const lastWeek = playoffWeekStart + 3;

  const matchupsByWeek: Record<number, SleeperMatchup[]> = {};
  const weekResults = await Promise.all(
    Array.from({ length: lastWeek }, (_, i) => i + 1).map(async (w) => {
      const m = await get<SleeperMatchup[]>(`${API}/league/${leagueId}/matchups/${w}`);
      return [w, m] as const;
    })
  );
  for (const [w, m] of weekResults) {
    if (m.length && m.some((row) => row.points > 0)) matchupsByWeek[w] = m;
  }

  const drafts = await get<Array<{ draft_id: string }>>(`${API}/league/${leagueId}/drafts`);
  const draftPicks: SleeperDraftPick[] = [];
  for (const d of drafts) {
    const picks = await get<SleeperDraftPick[]>(`${API}/draft/${d.draft_id}/picks`);
    draftPicks.push(...picks);
  }

  const transactions: SleeperTransaction[] = [];
  for (let w = 1; w <= lastWeek; w++) {
    try {
      const txs = await get<SleeperTransaction[]>(
        `${API}/league/${leagueId}/transactions/${w}`
      );
      transactions.push(...txs);
    } catch {
      // some weeks may 404 — skip
    }
  }

  return { league, users, rosters, matchupsByWeek, draftPicks, transactions };
}

// Slim players index — the cron route needs this for nicknames + names.
// Cached in-memory across invocations of the same Vercel function instance.
let _playersCache: { ts: number; data: Record<string, PlayerSlim> } | null = null;
const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000;

export async function fetchSlimPlayers(): Promise<Record<string, PlayerSlim>> {
  if (_playersCache && Date.now() - _playersCache.ts < PLAYERS_TTL_MS) {
    return _playersCache.data;
  }
  type FullPlayer = {
    player_id: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
    position?: string | null;
    team?: string | null;
  };
  const players = await get<Record<string, FullPlayer>>(`${API}/players/nfl`);
  const slim: Record<string, PlayerSlim> = {};
  for (const [id, p] of Object.entries(players)) {
    const name =
      p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    if (!name) continue;
    slim[id] = {
      id,
      name,
      position: p.position ?? null,
      team: p.team ?? null,
    };
  }
  _playersCache = { ts: Date.now(), data: slim };
  return slim;
}

export type NflState = {
  week: number;
  season: string;
  season_type: "regular" | "post" | "pre";
  leg: number;
};

export async function fetchNflState(): Promise<NflState> {
  return get<NflState>(`${API}/state/nfl`);
}
