import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSeason, loadSeasons, loadPlayers } from "@/lib/data";
import { buildTeamMeta, computeAwards } from "@/lib/awards";

export function generateStaticParams() {
  return loadSeasons()
    .filter((s) => s.status === "complete")
    .map((s) => ({ year: s.season }));
}

export default async function WrappedPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  const seasons = loadSeasons();
  if (!seasons.find((s) => s.season === year && s.status === "complete")) {
    notFound();
  }

  const season = loadSeason(year);
  const players = loadPlayers();
  const teams = buildTeamMeta(season);
  const awards = computeAwards(season, players);

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <Link href="/" className="text-white/40 hover:text-white/80 text-sm">
        ← Back
      </Link>

      <header className="mt-6 mb-12">
        <p className="text-sm uppercase tracking-[0.2em] text-white/40 mb-2">
          {season.league.name} · {year} Season
        </p>
        <h1 className="text-6xl md:text-8xl font-black tracking-tight">
          <span className="text-gradient">Wrapped</span>
        </h1>
        <p className="text-white/60 mt-4 text-lg">
          {Object.keys(season.matchupsByWeek).length} weeks. {season.users.length} managers. One champion. Lots of regret.
        </p>
      </header>

      <section className="grid gap-5 md:grid-cols-2">
        {awards.map((a) => {
          const team = a.rosterId != null ? teams.get(a.rosterId) : undefined;
          return (
            <article key={a.key} className="card p-6">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-bold uppercase tracking-wide text-white/80">
                  {a.title}
                </h3>
                <span className="text-3xl">{a.emoji}</span>
              </div>
              {team && (
                <div className="flex items-center gap-3 mb-3">
                  {team.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={team.avatar}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover ring-2 ring-white/10"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-white/10" />
                  )}
                  <div>
                    <div className="font-bold">{team.teamName}</div>
                    <div className="text-xs text-white/40">@{team.displayName}</div>
                  </div>
                </div>
              )}
              <p className="text-white/70 leading-relaxed">{a.body}</p>
            </article>
          );
        })}
      </section>

      <footer className="mt-16 pt-8 border-t border-white/5 text-xs text-white/40 text-center">
        Stats computed from Sleeper API · Optimal lineup uses greedy slot fill
      </footer>
    </main>
  );
}
