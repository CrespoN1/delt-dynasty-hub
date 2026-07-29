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

  // Lightweight health check: ?diag=1 reports what the FantasyPros key looks
  // like AT RUNTIME (length only, never the value) and whether the ECR feed
  // actually returns rows — without running Claude/web-search or sending email.
  if (new URL(req.url).searchParams.get("diag") === "1") {
    const fpKey = process.env.FANTASYPROS_API_KEY ?? "";
    let fpEcrRows = 0;
    let fpError = "";
    const tf = Date.now();
    if (fpKey) {
      try {
        fpEcrRows = (await fetchFpEcr(fpKey)).size;
      } catch (e) {
        fpError = String(e);
      }
    }
    return Response.json({
      diag: true,
      fpKeyLen: fpKey.length,
      fpEcrRows,
      fpEngaged: fpEcrRows > 0,
      fpFetchMs: Date.now() - tf,
      fpError,
    });
  }

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

    // Optional FantasyPros ECR layer — only if a key is configured.
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
