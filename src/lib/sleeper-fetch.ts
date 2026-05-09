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

  // Fetch all weeks of matchups + transactions in parallel
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
  const [weekMatchups, weekTransactions, drafts] = await Promise.all([
    Promise.all(
      weeks.map((w) => get<SleeperMatchup[]>(`${API}/league/${leagueId}/matchups/${w}`))
    ),
    Promise.all(
      weeks.map((w) =>
        get<SleeperTransaction[]>(`${API}/league/${leagueId}/transactions/${w}`).catch(
          () => [] as SleeperTransaction[]
        )
      )
    ),
    get<Array<{ draft_id: string }>>(`${API}/league/${leagueId}/drafts`),
  ]);

  const matchupsByWeek: Record<number, SleeperMatchup[]> = {};
  weekMatchups.forEach((m, i) => {
    const w = weeks[i];
    if (m.length && m.some((row) => row.points > 0)) matchupsByWeek[w] = m;
  });

  const transactions: SleeperTransaction[] = weekTransactions.flat();

  const draftPicks: SleeperDraftPick[] = (
    await Promise.all(drafts.map((d) => get<SleeperDraftPick[]>(`${API}/draft/${d.draft_id}/picks`)))
  ).flat();

  return { league, users, rosters, matchupsByWeek, draftPicks, transactions };
}

// Fast path for the cron: just the target week + bare-minimum metadata.
// Skips draft picks (~50 calls saved) and only fetches one week of matchups+transactions.
export async function fetchSeasonForWeek(
  leagueId: string,
  targetWeek: number
): Promise<SeasonData> {
  const [league, users, rosters, matchups, transactions] = await Promise.all([
    get<SleeperLeague>(`${API}/league/${leagueId}`),
    get<SleeperUser[]>(`${API}/league/${leagueId}/users`),
    get<SleeperRoster[]>(`${API}/league/${leagueId}/rosters`),
    get<SleeperMatchup[]>(`${API}/league/${leagueId}/matchups/${targetWeek}`),
    get<SleeperTransaction[]>(`${API}/league/${leagueId}/transactions/${targetWeek}`).catch(
      () => [] as SleeperTransaction[]
    ),
  ]);
  const matchupsByWeek: Record<number, SleeperMatchup[]> = {};
  if (matchups.length && matchups.some((m) => m.points > 0)) {
    matchupsByWeek[targetWeek] = matchups;
  }
  return {
    league,
    users,
    rosters,
    matchupsByWeek,
    draftPicks: [],
    transactions,
  };
}

// Walk previous_league_id chain to find the league_id for a given season.
export async function findLeagueIdForSeason(
  currentLeagueId: string,
  season: string
): Promise<string | null> {
  let id: string | null = currentLeagueId;
  // Bound the walk so a circular chain doesn't loop forever
  for (let i = 0; i < 32 && id; i++) {
    const lg = await get<SleeperLeague>(`${API}/league/${id}`);
    if (lg.season === season) return id;
    id = lg.previous_league_id;
  }
  return null;
}

// Detect the latest completed week without pulling 18 weeks of full matchup data.
// Polls weeks backwards from `playoffWeekStart + 3` until it finds one where every roster has scored.
export async function detectLatestCompleteWeek(
  leagueId: string
): Promise<{ league: SleeperLeague; week: number | null }> {
  const league = await get<SleeperLeague>(`${API}/league/${leagueId}`);
  const playoffWeekStart = Number(league.settings.playoff_week_start ?? 15);
  const lastWeek = playoffWeekStart + 3;
  // Bulk fetch all weeks in parallel (~18 calls, ~1-2s)
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
  const all = await Promise.all(
    weeks.map((w) => get<SleeperMatchup[]>(`${API}/league/${leagueId}/matchups/${w}`))
  );
  let latest: number | null = null;
  for (let i = 0; i < weeks.length; i++) {
    const m = all[i];
    if (m.length && m.every((row) => row.points > 0)) latest = weeks[i];
  }
  return { league, week: latest };
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
