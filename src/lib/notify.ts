// Send a "new recap dropped" email via Resend.
// Free tier: 3000/month, 100/day. Way more than we need.

import type { GeneratedRecap } from "./recap-generator";

const FROM = "Delt Dynasty <onboarding@resend.dev>";

export async function notifyRecapDropped({
  recap,
  toEmail,
  apiKey,
  siteUrl,
}: {
  recap: GeneratedRecap;
  toEmail: string;
  apiKey: string;
  siteUrl: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const recapUrl = `${siteUrl}/recaps/${recap.season}/${recap.week}`;
  const subject = `Week ${recap.week} Recap: ${recap.headline}`;
  const previewText = recap.subhead;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <span style="display:none;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(previewText)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:linear-gradient(135deg,rgba(249,115,22,0.12),rgba(168,85,247,0.08));border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 8px;color:rgba(255,255,255,0.4);font-size:12px;letter-spacing:2px;text-transform:uppercase;">Delt Dynasty · ${recap.season} · Week ${recap.week}</p>
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;font-weight:900;color:#fafafa;">${escapeHtml(recap.headline)}</h1>
          <p style="margin:0 0 28px;font-size:16px;line-height:1.5;color:rgba(255,255,255,0.75);">${escapeHtml(recap.subhead)}</p>
          <a href="${recapUrl}" style="display:inline-block;background:#f97316;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px;font-size:15px;">Open & Share to Group Chat →</a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.5);">Tap the link → tap the Share button → pick the league chat. Two taps and the roast lands in iMessage.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const body = {
    from: FROM,
    to: toEmail,
    subject,
    html,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
  }
  const j = (await res.json()) as { id: string };
  return { ok: true, id: j.id };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
