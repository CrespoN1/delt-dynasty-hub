import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  PlayerSlim,
  SeasonData,
  SleeperDraftPick,
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperTransaction,
  SleeperUser,
} from "../src/lib/types";

const CURRENT_LEAGUE_ID = "1313673066445819904";
const DATA_DIR = path.join(process.cwd(), "data");
const API = "https://api.sleeper.app/v1";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchSeason(leagueId: string): Promise<SeasonData> {
  const league = await get<SleeperLeague>(`${API}/league/${leagueId}`);
  console.log(`  → ${league.name} ${league.season} (${league.status})`);

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

async function fetchPlayers(): Promise<Record<string, PlayerSlim>> {
  console.log("  → Fetching NFL players index (~5MB, only first run)…");
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
  return slim;
}

async function main() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });

  console.log("Tracing league chain…");
  const chain: string[] = [];
  let cursor: string | null = CURRENT_LEAGUE_ID;
  while (cursor) {
    chain.push(cursor);
    const lg: SleeperLeague = await get<SleeperLeague>(`${API}/league/${cursor}`);
    cursor = lg.previous_league_id;
  }
  console.log(`  Found ${chain.length} season(s).`);

  const seasons: SeasonData[] = [];
  for (const id of chain) {
    console.log(`Fetching league ${id}…`);
    seasons.push(await fetchSeason(id));
  }

  // Sort by season ascending
  seasons.sort((a, b) => Number(a.league.season) - Number(b.league.season));

  for (const s of seasons) {
    const file = path.join(DATA_DIR, `season_${s.league.season}.json`);
    await writeFile(file, JSON.stringify(s, null, 2));
    console.log(`  Wrote ${file}`);
  }

  await writeFile(
    path.join(DATA_DIR, "seasons.json"),
    JSON.stringify(
      seasons.map((s) => ({
        season: s.league.season,
        league_id: s.league.league_id,
        name: s.league.name,
        status: s.league.status,
      })),
      null,
      2
    )
  );

  // Players index — only refresh if missing (it's huge and rarely changes mid-day)
  const playersFile = path.join(DATA_DIR, "players.json");
  if (!existsSync(playersFile) || process.env.REFRESH_PLAYERS === "1") {
    const players = await fetchPlayers();
    await writeFile(playersFile, JSON.stringify(players));
    console.log(`  Wrote ${playersFile} (${Object.keys(players).length} players)`);
  } else {
    console.log("  players.json already exists — skipping (set REFRESH_PLAYERS=1 to refresh)");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
