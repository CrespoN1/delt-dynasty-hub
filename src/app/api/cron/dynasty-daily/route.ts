import { NextRequest } from "next/server";
import { fetchDynastyData } from "@/lib/dynasty/data";
import { researchBrief, renderHtml } from "@/lib/dynasty/brief";
import { sendDynastyBrief } from "@/lib/dynasty/send";
import { fetchFpEcr, fpPromptBlock } from "@/lib/dynasty/fantasypros";

export const runtime = "nodejs";
export const maxDuration = 60; // raise to 300 on Vercel Pro if research times out

// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.DYNASTY_NOTIFY_EMAIL ?? "berto.crespo17@gmail.com";
  if (!apiKey || !resendKey) {
    return Response.json(
      { ok: false, error: "Missing ANTHROPIC_API_KEY or RESEND_API_KEY" },
      { status: 500 }
    );
  }

  const t0 = Date.now();
  try {
    const data = await fetchDynastyData();

    // Optional FantasyPros ECR layer (elite tier) — only if a key is configured.
    let fpBlock = "";
    const fpKey = process.env.FANTASYPROS_API_KEY;
    if (fpKey) {
      try {
        const fp = await fetchFpEcr(fpKey);
        fpBlock = fpPromptBlock(fp, data.roster.map((p) => p.name));
      } catch {
        fpBlock = "";
      }
    }

    const content = await researchBrief(data, apiKey, fpBlock);
    const dateLabel = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    });
    const html = renderHtml(data, content, dateLabel);
    const subject = `🏈 Delt Dynasty Daily — ${dateLabel}`;
    const send = await sendDynastyBrief({ html, subject, toEmail, apiKey: resendKey });

    return Response.json({
      ok: send.ok,
      send,
      picks: data.picks.map((p) => p.label),
      needs: data.needs,
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err), elapsedMs: Date.now() - t0 },
      { status: 500 }
    );
  }
}
