import Link from "next/link";
import { loadAllRecaps } from "@/lib/recaps";

export default function RecapsIndex() {
  const recaps = loadAllRecaps();

  // Group by season
  const bySeason: Record<string, typeof recaps> = {};
  for (const r of recaps) {
    bySeason[r.season] = bySeason[r.season] ?? [];
    bySeason[r.season].push(r);
  }
  const seasons = Object.keys(bySeason).sort((a, b) => Number(b) - Number(a));

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <Link href="/" className="text-white/40 hover:text-white/80 text-sm">
        ← Back
      </Link>

      <header className="mt-6 mb-12">
        <p className="text-sm uppercase tracking-[0.2em] text-white/40 mb-2">
          AI-Generated
        </p>
        <h1 className="text-5xl md:text-6xl font-black tracking-tight">
          <span className="text-gradient">Weekly Recaps</span>
        </h1>
        <p className="text-white/60 mt-3 text-lg">
          Brutally specific, occasionally rude. Written by Claude Opus 4.7 using your league's actual data and player nicknames.
        </p>
      </header>

      {recaps.length === 0 ? (
        <div className="card p-8 text-center text-white/60">
          <p className="mb-2">No recaps generated yet.</p>
          <p className="text-sm">
            Run <code className="px-2 py-1 bg-white/10 rounded">npm run generate-recap 2025 14</code> to create one.
          </p>
        </div>
      ) : (
        seasons.map((season) => (
          <section key={season} className="mb-12">
            <h2 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">
              {season} Season
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {bySeason[season].map((r) => (
                <Link
                  key={r.week}
                  href={`/recaps/${r.season}/${r.week}`}
                  className="card p-5 hover:scale-[1.01] transition-transform"
                >
                  <div className="text-xs uppercase tracking-wider text-white/40 mb-1">
                    Week {r.week}
                  </div>
                  <div className="text-lg font-bold leading-snug mb-1">
                    {r.headline}
                  </div>
                  <div className="text-sm text-white/60 line-clamp-2">
                    {r.subhead}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
