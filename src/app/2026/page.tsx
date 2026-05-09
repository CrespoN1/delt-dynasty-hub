import Link from "next/link";
import { loadPlayers, loadSeason, loadSeasons } from "@/lib/data";
import { buildStandings, buildTeamMeta, buildWeekResults } from "@/lib/awards";
import type { SeasonData } from "@/lib/types";

// ISR: revalidate every hour during the season so live data freshens without redeploys
export const revalidate = 3600;

type State = "pre_draft" | "drafted" | "in_season" | "complete";

function detectState(season: SeasonData): State {
  if (season.league.status === "complete") return "complete";
  const hasMatchups = Object.values(season.matchupsByWeek).some((week) =>
    week.some((m) => m.points > 0)
  );
  if (hasMatchups) return "in_season";
  if (season.draftPicks.length > 0) return "drafted";
  return "pre_draft";
}

export default function LiveDashboard() {
  const seasons = loadSeasons();
  const has2026 = seasons.find((s) => s.season === "2026");
  if (!has2026) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/" className="text-white/40 hover:text-white/80 text-sm">← Back</Link>
        <p className="mt-12 text-white/60">2026 season not found.</p>
      </main>
    );
  }

  const season = loadSeason("2026");
  const players = loadPlayers();
  const teams = buildTeamMeta(season);
  const state = detectState(season);

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <Link href="/" className="text-white/40 hover:text-white/80 text-sm">← Back</Link>

      <header className="mt-6 mb-12">
        <p className="text-sm uppercase tracking-[0.2em] text-white/40 mb-2">
          Live Dashboard
        </p>
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">
          <span className="text-gradient">2026 Season</span>
        </h1>
        <p className="text-white/60 mt-3 text-lg">
          {state === "pre_draft" && "Draft is on the way. Lineups are quiet. The chaos hasn't started."}
          {state === "drafted" && "Draft is in the books. Now we wait to see who got fleeced."}
          {state === "in_season" && "Live standings, weekly results, and bench-decision regret in real time."}
          {state === "complete" && "Season's over — head to Wrapped for the autopsy."}
        </p>
      </header>

      {state === "pre_draft" && <PreDraftView season={season} teams={teams} />}
      {state === "drafted" && <DraftedView season={season} teams={teams} players={players} />}
      {state === "in_season" && <InSeasonView season={season} teams={teams} players={players} />}
      {state === "complete" && (
        <Link href="/wrapped/2026" className="card-glow p-6 inline-block">
          View 2026 Wrapped →
        </Link>
      )}
    </main>
  );
}

function PreDraftView({
  season,
  teams,
}: {
  season: SeasonData;
  teams: ReturnType<typeof buildTeamMeta>;
}) {
  return (
    <>
      <section className="card-glow p-8 mb-12 text-center">
        <div className="text-6xl mb-3">🥱</div>
        <h2 className="text-2xl font-bold mb-2">Pre-Draft</h2>
        <p className="text-white/70">
          Once the draft happens, this page will light up with picks, rookie analysis, and projected standings.
        </p>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
          The {season.users.length} Managers
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {[...teams.values()].map((t) => (
            <div key={t.rosterId} className="card p-4 flex items-center gap-3">
              {t.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/10" />
              )}
              <div className="min-w-0">
                <div className="font-bold truncate">{t.teamName}</div>
                <div className="text-xs text-white/40 truncate">@{t.displayName}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function DraftedView({
  season,
  teams,
  players,
}: {
  season: SeasonData;
  teams: ReturnType<typeof buildTeamMeta>;
  players: ReturnType<typeof loadPlayers>;
}) {
  const picks = [...season.draftPicks].sort((a, b) => a.pick_no - b.pick_no);
  const teamName = (rid: number | null) => (rid != null ? teams.get(rid)?.teamName ?? `Team ${rid}` : "?");
  const playerLabel = (pid: string) => {
    const p = players[pid];
    if (!p) return `Player ${pid}`;
    return `${p.name} (${p.position ?? "?"}${p.team ? ` · ${p.team}` : ""})`;
  };

  return (
    <section>
      <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
        Draft Results · {picks.length} picks
      </h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/50">
            <tr>
              <th className="text-left px-4 py-3">Pick</th>
              <th className="text-left px-4 py-3">Round</th>
              <th className="text-left px-4 py-3">Team</th>
              <th className="text-left px-4 py-3">Player</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p) => (
              <tr key={p.pick_no} className="border-t border-white/5">
                <td className="px-4 py-3 text-white/40 tabular-nums">{p.pick_no}</td>
                <td className="px-4 py-3 text-white/40 tabular-nums">{p.round}</td>
                <td className="px-4 py-3">{teamName(p.roster_id)}</td>
                <td className="px-4 py-3 font-medium">{playerLabel(p.player_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InSeasonView({
  season,
  teams,
  players,
}: {
  season: SeasonData;
  teams: ReturnType<typeof buildTeamMeta>;
  players: ReturnType<typeof loadPlayers>;
}) {
  const standings = buildStandings(season);
  const weekly = buildWeekResults(season, players);
  const weeksWithData = Array.from(new Set(weekly.map((w) => w.week))).sort((a, b) => a - b);
  const currentWeek = weeksWithData[weeksWithData.length - 1] ?? 1;
  const thisWeek = weekly.filter((w) => w.week === currentWeek);

  // Pair into matchups
  const seenMatchupIds = new Set<number>();
  type Pair = { a: (typeof thisWeek)[number]; b: (typeof thisWeek)[number] | null };
  const pairs: Pair[] = [];
  for (const w of thisWeek) {
    const raw = season.matchupsByWeek[currentWeek]?.find((m) => m.roster_id === w.rosterId);
    const matchupId = raw?.matchup_id ?? -w.rosterId;
    if (seenMatchupIds.has(matchupId)) continue;
    seenMatchupIds.add(matchupId);
    const opp = thisWeek.find(
      (x) =>
        x.rosterId !== w.rosterId &&
        season.matchupsByWeek[currentWeek]?.find((m) => m.roster_id === x.rosterId)?.matchup_id === matchupId
    );
    pairs.push({ a: w, b: opp ?? null });
  }

  const teamName = (rid: number) => teams.get(rid)?.teamName ?? `Team ${rid}`;

  return (
    <>
      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
          Week {currentWeek} Matchups
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {pairs.map(({ a, b }, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center justify-between text-sm">
                <span className={`font-medium ${a.points > (b?.points ?? 0) ? "text-white" : "text-white/60"}`}>
                  {teamName(a.rosterId)}
                </span>
                <span className="tabular-nums font-bold">{a.points.toFixed(2)}</span>
              </div>
              {b && (
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className={`font-medium ${b.points > a.points ? "text-white" : "text-white/60"}`}>
                    {teamName(b.rosterId)}
                  </span>
                  <span className="tabular-nums font-bold">{b.points.toFixed(2)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
          Standings
        </h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/50">
              <tr>
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Team</th>
                <th className="text-right px-4 py-3">W-L</th>
                <th className="text-right px-4 py-3">PF</th>
                <th className="text-right px-4 py-3">Eff%</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, i) => (
                <tr key={s.rosterId} className="border-t border-white/5">
                  <td className="px-4 py-3 text-white/40">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">{teamName(s.rosterId)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.fpts.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/60">
                    {(s.efficiency * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
