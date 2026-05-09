import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAllRecaps, loadRecap } from "@/lib/recaps";
import { loadSeason } from "@/lib/data";
import { buildTeamMeta } from "@/lib/awards";
import { ShareButton } from "@/components/ShareButton";

export function generateStaticParams() {
  return loadAllRecaps().map((r) => ({ year: r.season, week: String(r.week) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string; week: string }>;
}) {
  const { year, week } = await params;
  const recap = loadRecap(year, Number(week));
  if (!recap) return { title: "Recap not found" };
  const title = `${recap.headline} · Delt Dynasty Week ${recap.week}`;
  return {
    title,
    description: recap.subhead,
    openGraph: {
      title,
      description: recap.subhead,
      type: "article",
    },
    twitter: {
      card: "summary_large_image" as const,
      title,
      description: recap.subhead,
    },
  };
}

export default async function RecapPage({
  params,
}: {
  params: Promise<{ year: string; week: string }>;
}) {
  const { year, week } = await params;
  const recap = loadRecap(year, Number(week));
  if (!recap) notFound();

  const season = loadSeason(year);
  const teams = buildTeamMeta(season);
  const teamByName = new Map<string, ReturnType<typeof teams.get>>();
  for (const [, t] of teams) teamByName.set(t.teamName.toLowerCase(), t);

  // Compute movement deltas vs previous week (same season).
  const prevRecap = Number(week) > 1 ? loadRecap(year, Number(week) - 1) : null;
  const movementByTeam = new Map<string, number | null>();
  if (recap.powerRankings) {
    if (prevRecap?.powerRankings) {
      const prevByTeam = new Map(
        prevRecap.powerRankings.map((r) => [r.team.toLowerCase(), r.rank])
      );
      for (const r of recap.powerRankings) {
        const prev = prevByTeam.get(r.team.toLowerCase());
        movementByTeam.set(r.team.toLowerCase(), prev != null ? prev - r.rank : null);
      }
    } else {
      for (const r of recap.powerRankings) movementByTeam.set(r.team.toLowerCase(), null);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/recaps" className="text-white/40 hover:text-white/80 text-sm">
          ← All Recaps
        </Link>
        <ShareButton
          url={`/recaps/${recap.season}/${recap.week}`}
          title={recap.headline}
          text={`${recap.season} W${recap.week} recap: ${recap.headline}`}
          variant="subtle"
        />
      </div>

      <article className="mt-6">
        <div className="text-sm uppercase tracking-[0.2em] text-white/40 mb-3">
          {recap.season} · Week {recap.week}
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight mb-4">
          {recap.headline}
        </h1>
        <p className="text-xl text-white/70 mb-6 leading-relaxed">
          {recap.subhead}
        </p>
        <div className="mb-10">
          <ShareButton
            url={`/recaps/${recap.season}/${recap.week}`}
            title={recap.headline}
            text={`${recap.season} W${recap.week} recap: ${recap.headline}`}
            variant="primary"
          />
        </div>

        {recap.powerRankings && recap.powerRankings.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
              Power Rankings
            </h2>
            <div className="card overflow-hidden">
              {[...recap.powerRankings]
                .sort((a, b) => a.rank - b.rank)
                .map((r) => {
                  const t = teamByName.get(r.team.toLowerCase());
                  const move = movementByTeam.get(r.team.toLowerCase());
                  return (
                    <div
                      key={r.rank}
                      className="flex items-start gap-4 p-4 border-t border-white/5 first:border-t-0"
                    >
                      <div className="flex-shrink-0 w-8 text-2xl font-black text-white/80 tabular-nums">
                        {r.rank}
                      </div>
                      <div className="flex-shrink-0 w-12 flex items-center justify-center">
                        <MovementBadge move={move ?? null} />
                      </div>
                      {t?.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.avatar}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-bold leading-snug">{r.team}</div>
                        <div className="text-sm text-white/60 leading-snug mt-0.5">{r.blurb}</div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        <section className="card-glow p-6 mb-8">
          <div className="text-xs uppercase tracking-wider text-white/60 mb-2">
            Match of the Week
          </div>
          <p className="text-white/90 leading-relaxed">{recap.matchOfTheWeek}</p>
        </section>

        <section className="prose prose-invert max-w-none mb-10">
          {recap.mainRecap.split(/\n\n+/).map((para, i) => (
            <p key={i} className="text-white/80 leading-relaxed text-lg mb-4">
              {para}
            </p>
          ))}
        </section>

        {!recap.powerRankings && recap.powerRankingsShakeup && (
          <section className="card p-6 mb-8">
            <div className="text-xs uppercase tracking-wider text-white/60 mb-2">
              Power Rankings
            </div>
            <p className="text-white/80">{recap.powerRankingsShakeup}</p>
          </section>
        )}

        <section className="mb-12">
          <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
            Weekly Awards
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {recap.weeklyAwards.map((a, i) => {
              const t = teamByName.get(a.team.toLowerCase());
              return (
                <div key={i} className="card p-4">
                  <div className="text-xs uppercase tracking-wider text-accent mb-1">
                    {a.title}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    {t?.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-white/10" />
                    )}
                    <span className="font-bold">{a.team}</span>
                  </div>
                  <p className="text-sm text-white/70 leading-snug">{a.blurb}</p>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="text-xs text-white/30 border-t border-white/5 pt-6">
          Generated by {recap.modelId} on {new Date(recap.generatedAt).toLocaleDateString()}
        </footer>
      </article>
    </main>
  );
}

function MovementBadge({ move }: { move: number | null }) {
  if (move == null) {
    return <span className="text-white/30 text-xs font-medium">—</span>;
  }
  if (move === 0) {
    return <span className="text-white/40 text-xs font-medium">·</span>;
  }
  if (move > 0) {
    return (
      <span className="text-emerald-400 text-xs font-bold inline-flex items-center gap-0.5">
        ▲{move}
      </span>
    );
  }
  return (
    <span className="text-rose-400 text-xs font-bold inline-flex items-center gap-0.5">
      ▼{Math.abs(move)}
    </span>
  );
}
