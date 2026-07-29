// Always-fresh Delt Dynasty War Room dashboard.
// Fetches live Sleeper + FantasyPros server-side (key stays in Vercel env),
// merges with the curated rankings, and returns the self-contained HTML page.
// The CDN caches the rendered output for a few hours (s-maxage) so the heavy
// fetch runs at most a few times a day; visitors always get a cached, fresh page.

import { buildDashboardData } from "@/lib/dynasty/dashboard/build";
import { DASHBOARD_TEMPLATE } from "@/lib/dynasty/dashboard/template";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const data = await buildDashboardData();
    const json = JSON.stringify(data);
    // function replacement avoids `$&`/`$1` interpretation in the injected JSON
    const html = DASHBOARD_TEMPLATE.replace("/*__DATA__*/{}", () => json);
    // During a LIVE rookie draft, refresh fast so the board keeps up with picks;
    // otherwise cache a few hours (data changes slowly in the offseason).
    const live = data.draftStatus === "drafting";
    const cache = live
      ? "public, s-maxage=20, stale-while-revalidate=40"
      : "public, s-maxage=21600, stale-while-revalidate=86400";
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache },
    });
  } catch (err) {
    return new Response("Dashboard build error: " + String(err), {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
