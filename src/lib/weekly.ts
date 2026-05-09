import type { PlayerSlim, SeasonData } from "./types";
import { buildTeamMeta, buildWeekResults, type WeekResult, type TeamMeta } from "./awards";

export type WeeklyMatchup = {
  matchupId: number;
  home: WeekResult;
  away: WeekResult;
  margin: number;
  winnerRosterId: number | null;
};

export type PlayerWeek = {
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  points: number;
  rosterId: number;
  started: boolean;
};

export type WeeklySnapshot = {
  season: string;
  week: number;
  matchups: WeeklyMatchup[];
  topStarters: PlayerWeek[]; // top 10 starting performances
  benchKings: PlayerWeek[]; // top 5 bench performances (regret factor)
  highest: { rosterId: number; points: number };
  lowest: { rosterId: number; points: number };
  blowout: { rosterId: number; opponentRosterId: number; margin: number };
  closest: { rosterId: number; opponentRosterId: number; margin: number };
  worstLineup: WeekResult; // most bench points left
  bestLineup: WeekResult; // highest efficiency that week
  trades: Array<{ rosterIds: number[]; addedPlayers: Record<number, string[]>; droppedPlayers: Record<number, string[]> }>;
};

export function buildWeeklySnapshot(
  season: SeasonData,
  week: number,
  players: Record<string, PlayerSlim>
): WeeklySnapshot {
  const allWeekly = buildWeekResults(season, players);
  const weekly = allWeekly.filter((w) => w.week === week);

  // Build matchups
  const byMatchupId = new Map<number, WeekResult[]>();
  for (const w of weekly) {
    const matchupId = (() => {
      const raw = season.matchupsByWeek[week]?.find((m) => m.roster_id === w.rosterId);
      return raw?.matchup_id ?? -w.rosterId;
    })();
    const list = byMatchupId.get(matchupId) ?? [];
    list.push(w);
    byMatchupId.set(matchupId, list);
  }

  const matchups: WeeklyMatchup[] = [];
  for (const [matchupId, pair] of byMatchupId) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    const margin = Math.abs(a.points - b.points);
    matchups.push({
      matchupId,
      home: a,
      away: b,
      margin,
      winnerRosterId: a.points > b.points ? a.rosterId : b.points > a.points ? b.rosterId : null,
    });
  }

  // Player-level performance for this week
  const playerWeek: PlayerWeek[] = [];
  for (const m of season.matchupsByWeek[week] ?? []) {
    const startersSet = new Set(m.starters ?? []);
    for (const [pid, pts] of Object.entries(m.players_points ?? {})) {
      const p = players[pid];
      playerWeek.push({
        playerId: pid,
        name: p?.name ?? `Player ${pid}`,
        position: p?.position ?? null,
        team: p?.team ?? null,
        points: pts,
        rosterId: m.roster_id,
        started: startersSet.has(pid),
      });
    }
  }

  const topStarters = playerWeek
    .filter((p) => p.started && p.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);

  const benchKings = playerWeek
    .filter((p) => !p.started && p.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);

  const sortedByPoints = [...weekly].sort((a, b) => b.points - a.points);
  const highest = sortedByPoints[0]
    ? { rosterId: sortedByPoints[0].rosterId, points: sortedByPoints[0].points }
    : { rosterId: 0, points: 0 };
  const lowest = sortedByPoints[sortedByPoints.length - 1]
    ? { rosterId: sortedByPoints[sortedByPoints.length - 1].rosterId, points: sortedByPoints[sortedByPoints.length - 1].points }
    : { rosterId: 0, points: 0 };

  const sortedByMargin = matchups.slice().sort((a, b) => b.margin - a.margin);
  const blowout = sortedByMargin[0]
    ? {
        rosterId: sortedByMargin[0].winnerRosterId ?? sortedByMargin[0].home.rosterId,
        opponentRosterId:
          sortedByMargin[0].winnerRosterId === sortedByMargin[0].home.rosterId
            ? sortedByMargin[0].away.rosterId
            : sortedByMargin[0].home.rosterId,
        margin: sortedByMargin[0].margin,
      }
    : { rosterId: 0, opponentRosterId: 0, margin: 0 };
  const closest = sortedByMargin[sortedByMargin.length - 1]
    ? {
        rosterId:
          sortedByMargin[sortedByMargin.length - 1].winnerRosterId ??
          sortedByMargin[sortedByMargin.length - 1].home.rosterId,
        opponentRosterId:
          sortedByMargin[sortedByMargin.length - 1].winnerRosterId ===
          sortedByMargin[sortedByMargin.length - 1].home.rosterId
            ? sortedByMargin[sortedByMargin.length - 1].away.rosterId
            : sortedByMargin[sortedByMargin.length - 1].home.rosterId,
        margin: sortedByMargin[sortedByMargin.length - 1].margin,
      }
    : { rosterId: 0, opponentRosterId: 0, margin: 0 };

  const worstLineup = [...weekly].sort((a, b) => b.benchPointsLeft - a.benchPointsLeft)[0];
  const bestLineup = [...weekly].sort((a, b) => {
    const eA = a.potentialPoints ? a.points / a.potentialPoints : 0;
    const eB = b.potentialPoints ? b.points / b.potentialPoints : 0;
    return eB - eA;
  })[0];

  // Filter trades to the week (very approximate using leg field)
  const trades = season.transactions
    .filter((t) => t.type === "trade" && t.status === "complete" && t.leg === week)
    .map((t) => {
      const adds: Record<number, string[]> = {};
      const drops: Record<number, string[]> = {};
      for (const [pid, rid] of Object.entries(t.adds ?? {})) {
        const r = rid as number;
        adds[r] = adds[r] ?? [];
        adds[r].push(players[pid]?.name ?? `Player ${pid}`);
      }
      for (const [pid, rid] of Object.entries(t.drops ?? {})) {
        const r = rid as number;
        drops[r] = drops[r] ?? [];
        drops[r].push(players[pid]?.name ?? `Player ${pid}`);
      }
      return { rosterIds: t.roster_ids, addedPlayers: adds, droppedPlayers: drops };
    });

  return {
    season: season.league.season,
    week,
    matchups,
    topStarters,
    benchKings,
    highest,
    lowest,
    blowout,
    closest,
    worstLineup,
    bestLineup,
    trades,
  };
}

export function formatSnapshotForPrompt(
  snapshot: WeeklySnapshot,
  teams: Map<number, TeamMeta>,
  players: Record<string, PlayerSlim>,
  rosterMetadata: Map<number, Record<string, string> | null | undefined>
): string {
  const teamName = (rid: number) => teams.get(rid)?.teamName ?? `Team ${rid}`;
  const ownerName = (rid: number) => teams.get(rid)?.displayName ?? "?";

  const playerLabel = (rid: number, pid: string) => {
    const p = players[pid];
    const nicknameMap = rosterMetadata.get(rid);
    const nick = nicknameMap?.[`p_nick_${pid}`];
    const base = p?.name ?? `Player ${pid}`;
    return nick ? `${base} ("${nick}")` : base;
  };

  const lines: string[] = [];
  lines.push(`# Week ${snapshot.week} of ${snapshot.season} season\n`);

  lines.push(`## Matchups (${snapshot.matchups.length})`);
  for (const m of snapshot.matchups) {
    const winnerSide = m.winnerRosterId === m.home.rosterId ? m.home : m.away;
    const loserSide = m.winnerRosterId === m.home.rosterId ? m.away : m.home;
    lines.push(
      `- ${teamName(winnerSide.rosterId)} (${winnerSide.points.toFixed(2)}) DEF ${teamName(loserSide.rosterId)} (${loserSide.points.toFixed(2)}) — margin ${m.margin.toFixed(2)}`
    );
  }
  lines.push("");

  lines.push(`## Highlights`);
  lines.push(`- Highest scorer: ${teamName(snapshot.highest.rosterId)} with ${snapshot.highest.points.toFixed(2)}`);
  lines.push(`- Lowest scorer: ${teamName(snapshot.lowest.rosterId)} with ${snapshot.lowest.points.toFixed(2)}`);
  lines.push(
    `- Biggest blowout: ${teamName(snapshot.blowout.rosterId)} crushed ${teamName(snapshot.blowout.opponentRosterId)} by ${snapshot.blowout.margin.toFixed(2)}`
  );
  lines.push(
    `- Closest game: ${teamName(snapshot.closest.rosterId)} edged ${teamName(snapshot.closest.opponentRosterId)} by ${snapshot.closest.margin.toFixed(2)}`
  );
  if (snapshot.worstLineup) {
    lines.push(
      `- Worst lineup: ${teamName(snapshot.worstLineup.rosterId)} left ${snapshot.worstLineup.benchPointsLeft.toFixed(2)} pts on the bench (scored ${snapshot.worstLineup.points.toFixed(2)}, optimal ${snapshot.worstLineup.potentialPoints.toFixed(2)})`
    );
  }
  if (snapshot.bestLineup) {
    const eff = snapshot.bestLineup.potentialPoints
      ? (snapshot.bestLineup.points / snapshot.bestLineup.potentialPoints) * 100
      : 0;
    lines.push(
      `- Best lineup: ${teamName(snapshot.bestLineup.rosterId)} hit ${eff.toFixed(1)}% efficiency`
    );
  }
  lines.push("");

  lines.push(`## Top 10 Starters`);
  for (const p of snapshot.topStarters) {
    lines.push(
      `- ${playerLabel(p.rosterId, p.playerId)} (${p.position ?? "?"}, ${p.team ?? "?"}): ${p.points.toFixed(2)} pts for ${teamName(p.rosterId)}`
    );
  }
  lines.push("");

  if (snapshot.benchKings.length) {
    lines.push(`## Painful Bench Performances (top 5 bench points)`);
    for (const p of snapshot.benchKings) {
      lines.push(
        `- ${playerLabel(p.rosterId, p.playerId)} (${p.position ?? "?"}): ${p.points.toFixed(2)} pts wasted on ${teamName(p.rosterId)}'s bench`
      );
    }
    lines.push("");
  }

  if (snapshot.trades.length) {
    lines.push(`## Trades This Week`);
    for (const t of snapshot.trades) {
      const sides = t.rosterIds
        .map((rid) => `${teamName(rid)}: got ${(t.addedPlayers[rid] ?? []).join(", ") || "(picks)"}`)
        .join(" | ");
      lines.push(`- ${sides}`);
    }
    lines.push("");
  }
  void ownerName;

  return lines.join("\n");
}

export function formatLeagueContext(
  season: SeasonData,
  teams: Map<number, TeamMeta>,
  players: Record<string, PlayerSlim>
): string {
  const lines: string[] = [];
  lines.push(`# Delt Dynasty — League Context`);
  lines.push("");
  lines.push(`**Format:** 12-team dynasty league, SuperFlex, 1 PPR (0.5 PPR for TEs), IDP scoring, taxi squad for rookies.`);
  lines.push(`**Regular season:** weeks 1-14. **Playoffs:** weeks 15-17.`);
  lines.push("");
  lines.push(`## The 12 Teams (with owners)`);
  for (const [, t] of teams) {
    lines.push(`- **${t.teamName}** (@${t.displayName})`);
  }
  lines.push("");
  lines.push(`## Player Nicknames the Managers Coined`);
  lines.push(`Use these whenever they apply — they encode running jokes the league shares.`);
  lines.push("");
  for (const r of season.rosters) {
    const meta = r.metadata;
    if (!meta) continue;
    const nicks: string[] = [];
    for (const [k, v] of Object.entries(meta)) {
      if (!k.startsWith("p_nick_")) continue;
      const pid = k.replace("p_nick_", "");
      const real = players[pid]?.name ?? `Player ${pid}`;
      nicks.push(`${real} → "${v}"`);
    }
    if (nicks.length) {
      const tname = teams.get(r.roster_id)?.teamName ?? `Team ${r.roster_id}`;
      lines.push(`**${tname}**: ${nicks.join("; ")}`);
    }
  }
  return lines.join("\n");
}
