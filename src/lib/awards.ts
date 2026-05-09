import type { PlayerSlim, SeasonData, SleeperMatchup } from "./types";

export type TeamMeta = {
  rosterId: number;
  ownerId: string;
  displayName: string;
  teamName: string;
  avatar: string | null;
};

export function buildTeamMeta(season: SeasonData): Map<number, TeamMeta> {
  const usersById = new Map(season.users.map((u) => [u.user_id, u]));
  const map = new Map<number, TeamMeta>();
  for (const r of season.rosters) {
    const u = usersById.get(r.owner_id);
    map.set(r.roster_id, {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      displayName: u?.display_name ?? `User ${r.owner_id.slice(-4)}`,
      teamName: u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`,
      avatar: u?.metadata?.avatar ?? (u?.avatar ? `https://sleepercdn.com/avatars/${u.avatar}` : null),
    });
  }
  return map;
}

export type Standing = {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
  potentialPoints: number;
  efficiency: number; // fpts / potentialPoints
};

export function buildStandings(season: SeasonData): Standing[] {
  return season.rosters
    .map((r) => {
      const fpts = r.settings.fpts + (r.settings.fpts_decimal ?? 0) / 100;
      const fptsAgainst =
        (r.settings.fpts_against ?? 0) + ((r.settings.fpts_against_decimal as number) ?? 0) / 100;
      const ppts =
        (r.settings as Record<string, number>).ppts !== undefined
          ? (r.settings as Record<string, number>).ppts +
            ((r.settings as Record<string, number>).ppts_decimal ?? 0) / 100
          : fpts;
      return {
        rosterId: r.roster_id,
        wins: r.settings.wins,
        losses: r.settings.losses,
        ties: r.settings.ties,
        fpts,
        fptsAgainst,
        potentialPoints: ppts,
        efficiency: ppts > 0 ? fpts / ppts : 0,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
}

export type WeekResult = {
  week: number;
  rosterId: number;
  opponentRosterId: number | null;
  points: number;
  opponentPoints: number;
  margin: number;
  result: "W" | "L" | "T" | null;
  starterPoints: number[];
  starters: string[];
  bench: { id: string; pts: number }[];
  potentialPoints: number;
  benchPointsLeft: number; // best bench swap regret (sum of upgrades possible)
};

// Compute "optimal" lineup using a roster-position-aware greedy approach
function computeOptimal(
  starters: string[],
  starterPoints: number[],
  playersPoints: Record<string, number>,
  rosterPositions: string[],
  players: Record<string, PlayerSlim>
): { optimal: number; benchScore: number } {
  // Determine slot list (only starting slots, exclude BN/IR/TAXI)
  const slots = rosterPositions.filter(
    (p) => !["BN", "IR", "TAXI"].includes(p)
  );

  // Group all rostered players by position with points
  const all = Object.entries(playersPoints).map(([pid, pts]) => ({
    pid,
    pts,
    pos: players[pid]?.position ?? null,
  }));

  // Greedy fill: for each slot, pick highest-scoring eligible player not yet used.
  const used = new Set<string>();
  let optimal = 0;
  const flexEligible = (pos: string | null) => pos === "RB" || pos === "WR" || pos === "TE";
  const superFlexEligible = (pos: string | null) =>
    pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE";

  // Process strict slots first, then FLEX, then SUPER_FLEX
  const order = [...slots].sort((a, b) => {
    const rank = (s: string) =>
      s === "SUPER_FLEX" ? 3 : s === "FLEX" ? 2 : s === "REC_FLEX" ? 2 : 1;
    return rank(a) - rank(b);
  });

  for (const slot of order) {
    let best: { pid: string; pts: number } | null = null;
    for (const p of all) {
      if (used.has(p.pid)) continue;
      const eligible =
        slot === "FLEX" || slot === "REC_FLEX"
          ? flexEligible(p.pos)
          : slot === "SUPER_FLEX"
          ? superFlexEligible(p.pos)
          : p.pos === slot;
      if (eligible && (!best || p.pts > best.pts)) best = { pid: p.pid, pts: p.pts };
    }
    if (best) {
      used.add(best.pid);
      optimal += best.pts;
    }
  }

  const actualStarters = new Set(starters);
  const benchScore = all
    .filter((p) => !actualStarters.has(p.pid))
    .reduce((sum, p) => sum + p.pts, 0);

  return { optimal, benchScore };
}

export function buildWeekResults(season: SeasonData, players: Record<string, PlayerSlim>): WeekResult[] {
  const results: WeekResult[] = [];
  const rosterPositions = season.league.roster_positions;
  const playoffStart = Number(season.league.settings.playoff_week_start ?? 15);

  for (const [weekStr, matchups] of Object.entries(season.matchupsByWeek)) {
    const week = Number(weekStr);
    // Only count regular season for stats by default — include playoffs separately
    const byMatchupId = new Map<number, SleeperMatchup[]>();
    for (const m of matchups) {
      if (m.matchup_id == null) continue;
      const list = byMatchupId.get(m.matchup_id) ?? [];
      list.push(m);
      byMatchupId.set(m.matchup_id, list);
    }

    for (const m of matchups) {
      const opponent =
        m.matchup_id != null
          ? byMatchupId.get(m.matchup_id)?.find((x) => x.roster_id !== m.roster_id) ?? null
          : null;

      const oppPts = opponent?.points ?? 0;
      const margin = m.points - oppPts;
      const result: "W" | "L" | "T" | null = !opponent
        ? null
        : margin > 0
        ? "W"
        : margin < 0
        ? "L"
        : "T";

      const playersPoints = m.players_points ?? {};
      const starters = m.starters ?? [];
      const starterPoints = m.starters_points ?? [];

      const { optimal } = computeOptimal(
        starters,
        starterPoints,
        playersPoints,
        rosterPositions,
        players
      );
      const benchPointsLeft = Math.max(0, optimal - m.points);

      const startersSet = new Set(starters);
      const bench = Object.entries(playersPoints)
        .filter(([pid]) => !startersSet.has(pid))
        .map(([id, pts]) => ({ id, pts }))
        .sort((a, b) => b.pts - a.pts);

      results.push({
        week,
        rosterId: m.roster_id,
        opponentRosterId: opponent?.roster_id ?? null,
        points: m.points,
        opponentPoints: oppPts,
        margin,
        result,
        starterPoints,
        starters,
        bench,
        potentialPoints: optimal,
        benchPointsLeft,
      });
    }
    // tag playoffs (we don't filter, just expose week)
    void playoffStart;
  }
  return results;
}

// =========== Awards ===========

export type Award<T = unknown> = {
  key: string;
  title: string;
  subtitle?: string;
  emoji?: string;
  body: string;
  rosterId?: number;
  data?: T;
};

export function computeAwards(
  season: SeasonData,
  players: Record<string, PlayerSlim>
): Award[] {
  const teams = buildTeamMeta(season);
  const standings = buildStandings(season);
  const weekly = buildWeekResults(season, players);
  const teamName = (rid: number) => teams.get(rid)?.teamName ?? `Team ${rid}`;
  const playerName = (id: string) => players[id]?.name ?? `Player ${id}`;

  const awards: Award[] = [];

  // 1. Points King
  const pointsKing = [...standings].sort((a, b) => b.fpts - a.fpts)[0];
  awards.push({
    key: "points_king",
    title: "Points King",
    emoji: "👑",
    rosterId: pointsKing.rosterId,
    body: `${teamName(pointsKing.rosterId)} dropped ${pointsKing.fpts.toFixed(2)} points across the regular season — most in the league.`,
  });

  // 2. Regular season chump (lowest points)
  const cellar = [...standings].sort((a, b) => a.fpts - b.fpts)[0];
  awards.push({
    key: "cellar",
    title: "Cellar Dweller",
    emoji: "🪦",
    rosterId: cellar.rosterId,
    body: `${teamName(cellar.rosterId)} mustered just ${cellar.fpts.toFixed(2)} points all season. Brutal.`,
  });

  // 3. Best record
  const best = standings[0];
  awards.push({
    key: "best_record",
    title: "Regular Season Champ",
    emoji: "🏅",
    rosterId: best.rosterId,
    body: `${teamName(best.rosterId)} finished ${best.wins}-${best.losses}${best.ties ? `-${best.ties}` : ""} with ${best.fpts.toFixed(2)} points.`,
  });

  // 4. Biggest blowout
  const playoffStart = Number(season.league.settings.playoff_week_start ?? 15);
  const regular = weekly.filter((w) => w.week < playoffStart && w.result);
  const blowout = [...regular].sort((a, b) => b.margin - a.margin)[0];
  if (blowout) {
    awards.push({
      key: "blowout",
      title: "Beatdown of the Year",
      emoji: "💥",
      rosterId: blowout.rosterId,
      body: `Week ${blowout.week}: ${teamName(blowout.rosterId)} crushed ${teamName(blowout.opponentRosterId!)} ${blowout.points.toFixed(2)} – ${blowout.opponentPoints.toFixed(2)} (margin: ${blowout.margin.toFixed(2)}).`,
    });
  }

  // 5. Closest game
  const close = [...regular]
    .filter((w) => w.result === "W")
    .sort((a, b) => a.margin - b.margin)[0];
  if (close) {
    awards.push({
      key: "nailbiter",
      title: "Nailbiter of the Year",
      emoji: "😬",
      rosterId: close.rosterId,
      body: `Week ${close.week}: ${teamName(close.rosterId)} beat ${teamName(close.opponentRosterId!)} by just ${close.margin.toFixed(2)} (${close.points.toFixed(2)}–${close.opponentPoints.toFixed(2)}).`,
    });
  }

  // 6. Highest single-week score
  const highWeek = [...weekly].sort((a, b) => b.points - a.points)[0];
  if (highWeek) {
    awards.push({
      key: "high_week",
      title: "Best Week of the Year",
      emoji: "🚀",
      rosterId: highWeek.rosterId,
      body: `Week ${highWeek.week}: ${teamName(highWeek.rosterId)} put up ${highWeek.points.toFixed(2)} points.`,
    });
  }

  // 7. Lowest single-week score (excluding 0 = bye?)
  const lowWeek = [...weekly]
    .filter((w) => w.points > 0)
    .sort((a, b) => a.points - b.points)[0];
  if (lowWeek) {
    awards.push({
      key: "low_week",
      title: "Worst Week of the Year",
      emoji: "🚽",
      rosterId: lowWeek.rosterId,
      body: `Week ${lowWeek.week}: ${teamName(lowWeek.rosterId)} mustered just ${lowWeek.points.toFixed(2)} points. Yikes.`,
    });
  }

  // 8. Choke (highest score in a loss)
  const choke = [...regular]
    .filter((w) => w.result === "L")
    .sort((a, b) => b.points - a.points)[0];
  if (choke) {
    awards.push({
      key: "choke",
      title: "Hard-Luck Loss",
      emoji: "💔",
      rosterId: choke.rosterId,
      body: `Week ${choke.week}: ${teamName(choke.rosterId)} scored ${choke.points.toFixed(2)} and STILL lost to ${teamName(choke.opponentRosterId!)} (${choke.opponentPoints.toFixed(2)}).`,
    });
  }

  // 9. Lucky duck (lowest score in a win)
  const lucky = [...regular]
    .filter((w) => w.result === "W")
    .sort((a, b) => a.points - b.points)[0];
  if (lucky) {
    awards.push({
      key: "lucky",
      title: "Luckiest Win",
      emoji: "🍀",
      rosterId: lucky.rosterId,
      body: `Week ${lucky.week}: ${teamName(lucky.rosterId)} won with just ${lucky.points.toFixed(2)} points (opponent: ${lucky.opponentPoints.toFixed(2)}).`,
    });
  }

  // 10. Bench MVP — single week most points left on bench
  const benchSingle = [...weekly].sort((a, b) => b.benchPointsLeft - a.benchPointsLeft)[0];
  if (benchSingle && benchSingle.benchPointsLeft > 0) {
    awards.push({
      key: "bench_single",
      title: "Worst Lineup Decision",
      emoji: "🪑",
      rosterId: benchSingle.rosterId,
      body: `Week ${benchSingle.week}: ${teamName(benchSingle.rosterId)} left ${benchSingle.benchPointsLeft.toFixed(2)} points on the bench. Optimal lineup would've scored ${benchSingle.potentialPoints.toFixed(2)}, they scored ${benchSingle.points.toFixed(2)}.`,
    });
  }

  // 11. Lineup efficiency (season)
  const sortedEff = [...standings].sort((a, b) => b.efficiency - a.efficiency);
  const bestEff = sortedEff[0];
  const worstEff = sortedEff[sortedEff.length - 1];
  awards.push({
    key: "best_eff",
    title: "Lineup Wizard",
    emoji: "🧠",
    rosterId: bestEff.rosterId,
    body: `${teamName(bestEff.rosterId)} hit ${(bestEff.efficiency * 100).toFixed(1)}% of their max potential — best in the league.`,
  });
  awards.push({
    key: "worst_eff",
    title: "Coaches Office (please report)",
    emoji: "🤡",
    rosterId: worstEff.rosterId,
    body: `${teamName(worstEff.rosterId)} only scored ${(worstEff.efficiency * 100).toFixed(1)}% of their max — left more on the bench than anyone.`,
  });

  // 12. Most active manager
  const txByRoster = new Map<number, number>();
  for (const tx of season.transactions) {
    if (tx.status !== "complete") continue;
    for (const rid of tx.roster_ids) {
      txByRoster.set(rid, (txByRoster.get(rid) ?? 0) + 1);
    }
  }
  const activeEntries = [...txByRoster.entries()].sort((a, b) => b[1] - a[1]);
  if (activeEntries.length) {
    const [rid, count] = activeEntries[0];
    awards.push({
      key: "most_active",
      title: "Waiver Wire Addict",
      emoji: "📈",
      rosterId: rid,
      body: `${teamName(rid)} was involved in ${count} transactions — most in the league.`,
    });
  }

  // 13. Draft steal — pick after round 4 with highest season points
  // Compute season points per player
  const seasonPlayerPoints = new Map<string, number>();
  for (const m of Object.values(season.matchupsByWeek).flat()) {
    if (!m.players_points) continue;
    for (const [pid, pts] of Object.entries(m.players_points)) {
      seasonPlayerPoints.set(pid, (seasonPlayerPoints.get(pid) ?? 0) + pts);
    }
  }
  const lateSteals = season.draftPicks
    .filter((p) => p.round >= 3)
    .map((p) => ({ ...p, pts: seasonPlayerPoints.get(p.player_id) ?? 0 }))
    .sort((a, b) => b.pts - a.pts);
  if (lateSteals[0]) {
    const s = lateSteals[0];
    awards.push({
      key: "draft_steal",
      title: "Draft Steal of the Year",
      emoji: "💎",
      rosterId: s.roster_id ?? undefined,
      body: `${teamName(s.roster_id ?? -1)} drafted ${playerName(s.player_id)} in round ${s.round} (pick ${s.pick_no}) and got ${s.pts.toFixed(2)} points.`,
    });
  }

  // 14. Draft bust — round 1-2 pick with lowest points
  const earlyBusts = season.draftPicks
    .filter((p) => p.round <= 2)
    .map((p) => ({ ...p, pts: seasonPlayerPoints.get(p.player_id) ?? 0 }))
    .sort((a, b) => a.pts - b.pts);
  if (earlyBusts[0]) {
    const b = earlyBusts[0];
    awards.push({
      key: "draft_bust",
      title: "Draft Bust of the Year",
      emoji: "🥶",
      rosterId: b.roster_id ?? undefined,
      body: `${teamName(b.roster_id ?? -1)} used round ${b.round} (pick ${b.pick_no}) on ${playerName(b.player_id)} and got ${b.pts.toFixed(2)} points.`,
    });
  }

  // 15. MVP — top scoring single player
  const topPlayers = [...seasonPlayerPoints.entries()].sort((a, b) => b[1] - a[1]);
  if (topPlayers[0]) {
    const [pid, pts] = topPlayers[0];
    // find owner: roster that had this player rostered most weeks (use latest week roster)
    const owner = season.rosters.find((r) => r.players?.includes(pid));
    awards.push({
      key: "league_mvp",
      title: "League MVP",
      emoji: "🐐",
      rosterId: owner?.roster_id,
      body: `${playerName(pid)} put up ${pts.toFixed(2)} points${owner ? ` for ${teamName(owner.roster_id)}` : ""} — highest-scoring player in the league.`,
    });
  }

  // 16. Number of trades
  const trades = season.transactions.filter((t) => t.type === "trade" && t.status === "complete");
  awards.push({
    key: "trades",
    title: "Trade Activity",
    emoji: "🔄",
    body: `${trades.length} completed trades this season. Active league.`,
  });

  return awards;
}
