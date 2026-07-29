// Send the dynasty brief via Resend (same 3rd party as the weekly recap email).

const FROM = "Delt Dynasty <onboarding@resend.dev>";

export async function sendDynastyBrief({
  html,
  subject,
  toEmail,
  apiKey,
}: {
  html: string;
  subject: string;
  toEmail: string;
  apiKey: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: toEmail, subject, html }),
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
  const j = (await res.json()) as { id: string };
  return { ok: true, id: j.id };
}
