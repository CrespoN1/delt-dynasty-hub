import { ImageResponse } from "next/og";
import { loadRecap } from "@/lib/recaps";
import { loadSeason } from "@/lib/data";
import { buildTeamMeta } from "@/lib/awards";

export const runtime = "nodejs";
export const alt = "Delt Dynasty Weekly Recap";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({
  params,
}: {
  params: Promise<{ year: string; week: string }>;
}) {
  const { year, week } = await params;
  const recap = loadRecap(year, Number(week));
  if (!recap) {
    return new ImageResponse(<Fallback />, size);
  }

  const season = loadSeason(year);
  const teams = buildTeamMeta(season);
  const teamByName = new Map<string, ReturnType<typeof teams.get>>();
  for (const [, t] of teams) teamByName.set(t.teamName.toLowerCase(), t);

  const featuredTeams = recap.weeklyAwards
    .map((a) => teamByName.get(a.team.toLowerCase()))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .slice(0, 5);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "70px 80px",
          background:
            "radial-gradient(ellipse at 0% 0%, rgba(249,115,22,0.35), transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(168,85,247,0.30), transparent 55%), #0a0a0a",
          color: "#fafafa",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "22px",
            letterSpacing: "6px",
            color: "rgba(255,255,255,0.55)",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          <span>DELT DYNASTY</span>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
          <span>{recap.season}</span>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
          <span>WEEK {recap.week}</span>
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            marginTop: "40px",
            marginBottom: "30px",
          }}
        >
          <h1
            style={{
              fontSize: recap.headline.length > 70 ? "62px" : "78px",
              fontWeight: 900,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: 0,
              backgroundImage:
                "linear-gradient(135deg, #fb923c 0%, #f97316 35%, #c084fc 100%)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {recap.headline}
          </h1>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              maxWidth: "780px",
            }}
          >
            <div
              style={{
                fontSize: "20px",
                color: "rgba(255,255,255,0.6)",
                lineHeight: 1.4,
              }}
            >
              {truncate(recap.subhead, 140)}
            </div>
            <div
              style={{
                fontSize: "16px",
                color: "rgba(255,255,255,0.35)",
                marginTop: "12px",
                letterSpacing: "2px",
                textTransform: "uppercase",
              }}
            >
              delt-dynasty-hub.vercel.app
            </div>
          </div>

          {featuredTeams.length > 0 && (
            <div style={{ display: "flex", marginLeft: "30px" }}>
              {featuredTeams.map((t, i) =>
                t.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={t.rosterId}
                    src={t.avatar}
                    alt=""
                    width={56}
                    height={56}
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "3px solid rgba(255,255,255,0.15)",
                      marginLeft: i === 0 ? 0 : "-14px",
                    }}
                  />
                ) : (
                  <div
                    key={t.rosterId}
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.08)",
                      border: "3px solid rgba(255,255,255,0.15)",
                      marginLeft: i === 0 ? 0 : "-14px",
                    }}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>
    ),
    size
  );
}

function Fallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        color: "#f97316",
        fontSize: "96px",
        fontWeight: 900,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      Delt Dynasty
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
