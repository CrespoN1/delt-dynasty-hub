import Link from "next/link";
import { loadSeason, loadSeasons } from "@/lib/data";
import { buildStandings, buildTeamMeta } from "@/lib/awards";

export default function Home() {
  const seasons = loadSeasons();
  const completedSeasons = seasons.filter((s) => s.status === "complete");
  const latestComplete = completedSeasons[completedSeasons.length - 1];
  const featured = latestComplete ? loadSeason(latestComplete.season) : null;
  const standings = featured ? buildStandings(featured) : [];
  const teams = featured ? buildTeamMeta(featured) : new Map();

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <header className="mb-12">
        <p className="text-sm uppercase tracking-[0.2em] text-white/40 mb-2">
          Fantasy League Hub
        </p>
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">
          <span className="text-gradient">Delt Dynasty</span>
        </h1>
        <p className="text-white/60 mt-3 text-lg">
          {seasons.length} seasons of bad lineup decisions, beautiful trades, and brutal beatdowns.
        </p>
      </header>

      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
          Live & Coming Up
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/2026"
            className="card-glow p-6 hover:scale-[1.02] transition-transform"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase tracking-wider text-accent">Live</span>
              <span className="text-xs text-white/40">· auto-refreshing</span>
            </div>
            <div className="text-2xl font-black mb-1">2026 Dashboard</div>
            <div className="text-white/70 text-sm">Standings, matchups, draft tracker →</div>
          </Link>
          <Link
            href="/recaps"
            className="card-glow p-6 hover:scale-[1.02] transition-transform"
          >
            <div className="text-xs uppercase tracking-wider text-accent mb-1">AI-Generated</div>
            <div className="text-2xl font-black mb-1">Weekly Recaps</div>
            <div className="text-white/70 text-sm">Roasts, cope, and stats →</div>
          </Link>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
          Season Recaps
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {completedSeasons.map((s) => (
            <Link
              key={s.season}
              href={`/wrapped/${s.season}`}
              className="card-glow p-6 hover:scale-[1.02] transition-transform"
            >
              <div className="text-4xl font-black mb-1">{s.season}</div>
              <div className="text-white/70 text-sm">Wrapped →</div>
            </Link>
          ))}
        </div>
      </section>

      {featured && (
        <section>
          <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
            {latestComplete?.season} Final Standings
          </h2>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/50">
                <tr>
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Team</th>
                  <th className="text-right px-4 py-3">W-L</th>
                  <th className="text-right px-4 py-3">PF</th>
                  <th className="text-right px-4 py-3">PA</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">Eff%</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => {
                  const t = teams.get(s.rosterId);
                  return (
                    <tr key={s.rosterId} className="border-t border-white/5">
                      <td className="px-4 py-3 text-white/40">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {t?.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-white/10" />
                          )}
                          <div>
                            <div className="font-medium">{t?.teamName}</div>
                            <div className="text-xs text-white/40">@{t?.displayName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {s.wins}-{s.losses}{s.ties ? `-${s.ties}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.fpts.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-white/60">
                        {s.fptsAgainst.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell text-white/60">
                        {(s.efficiency * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="mt-16 pt-8 border-t border-white/5 text-xs text-white/40">
        Data via{" "}
        <a className="underline hover:text-white/70" href="https://docs.sleeper.com/" target="_blank">
          Sleeper API
        </a>
        . Built with Next.js.
      </footer>
    </main>
  );
}
