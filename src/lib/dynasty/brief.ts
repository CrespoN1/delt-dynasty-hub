// Research the freshest dynasty news with Claude (web search) and render a
// Gmail-bulletproof HTML brief. All non-ASCII chars are HTML entities so the
// email never garbles.

import Anthropic from "@anthropic-ai/sdk";
import type { DynastyData, Player, Pick } from "./data";

const DYNASTY_MODEL = "claude-opus-4-7"; // matches the recap generator

export interface BriefContent {
  tldr: string[];
  movers: {
    name: string;
    pos: string;
    team: string;
    dir: "up" | "down" | "watch";
    signal: "BUY" | "HOLD" | "SELL";
    note: string;
  }[];
  roster: { name: string; pos: string; team: string; signal: string; note: string }[];
  waivers: { name: string; pos: string; team: string; note: string }[];
  rookies: { label: string; target: string; note: string }[];
  trades: string[];
}

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function researchBrief(
  data: DynastyData,
  apiKey: string,
  fpBlock = ""
): Promise<BriefContent> {
  const client = new Anthropic({ apiKey });
  const roster = data.roster
    .map((p) => `${p.name} (${p.pos}, ${p.team})`)
    .join("; ");
  const picks = data.picks.map((p) => `${p.label} (overall #${p.overall})`).join(", ");
  const waivers = data.waivers.map((p) => `${p.name} (${p.pos}, ${p.team})`).join("; ");

  const prompt = `You are the analyst for a 12-team SUPERFLEX PPR dynasty league (Sleeper). Today's date is included in your context. Research the FRESHEST fantasy dynasty news (last 24-48h) using web search across FantasyPros, DynastyLeagueFootball, DynastyNerds, PFF, ESPN, RotoWire, and r/DynastyFF, then return a brief for this specific team.

RECIPIENT TEAM "${data.teamName}" roster: ${roster}
RECIPIENT rookie picks (post-trade): ${picks || "none"}
Roster needs: ${data.needs.join(", ") || "none"}
Waiver pool (unrostered, best available): ${waivers}

Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
 "tldr": ["3-4 short headline bullets for THIS team today"],
 "movers": [{"name","pos","team","dir":"up|down|watch","signal":"BUY|HOLD|SELL","note":"one line why"}],
 "roster": [{"name","pos","team","signal":"BUY|HOLD|SELL","note":"trend/outlook for a player ON the recipient's roster"}],
 "waivers": [{"name","pos","team","note":"why to add — pick from the waiver pool above"}],
 "rookies": [{"label":"<one of the recipient's pick labels>","target":"player name","note":"who to target/who could fall"}],
 "trades": ["1-2 buy-low / sell-high angles for this roster"]
}
Anchor sentiment to FantasyPros consensus. Do NOT invent injuries or transactions. Keep each note under 22 words. 6-10 movers, 4-6 roster items, 4-6 waivers, one rookies entry per recipient pick.
${fpBlock ? "\n" + fpBlock : ""}`;

  const resp = await client.messages.create({
    model: DYNASTY_MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium" } as any,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 } as any],
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in model response");
  return JSON.parse(match[0]) as BriefContent;
}

// ---------- render ----------
const SECT =
  'font:700 12px Arial,sans-serif;letter-spacing:1px;color:#8a7f68;text-transform:uppercase;border-bottom:2px solid #efe7d6;padding-bottom:6px';
function pill(signal: string): string {
  const s = (signal || "HOLD").toUpperCase();
  const map: Record<string, [string, string, string]> = {
    BUY: ["#1e7f52", "#e6f2ea", "&#9650;"],
    SELL: ["#b23b32", "#f6e7e5", "&#9660;"],
    HOLD: ["#b07d1e", "#f7efdd", ""],
  };
  const [c, bg, arrow] = map[s] || map.HOLD;
  return `<span style="font:700 11px Arial;color:${c};background:${bg};padding:3px 9px;border-radius:10px">${arrow} ${s}</span>`;
}

export function renderHtml(data: DynastyData, c: BriefContent, dateLabel: string): string {
  const tldr = c.tldr
    .map(
      (b) =>
        `<tr><td style="font:400 14px/1.5 Arial;color:#2c2820;padding:3px 0">&#8226; ${esc(
          b
        )}</td></tr>`
    )
    .join("");

  const movers = (c.movers || [])
    .map(
      (m) =>
        `<tr><td style="font:700 14px Arial;color:#1c1a14;padding:7px 0;border-bottom:1px solid #f2ecdd">${esc(
          m.name
        )} <span style="font:400 12px Arial;color:#8a7f68">${esc(m.pos)} &#183; ${esc(
          m.team
        )}</span></td><td align="right" style="padding:7px 0;border-bottom:1px solid #f2ecdd">${pill(
          m.signal
        )}</td></tr><tr><td colspan="2" style="font:400 12px/1.4 Arial;color:#6e6353;padding:0 0 8px">${esc(
          m.note
        )}</td></tr>`
    )
    .join("");

  const roster = (c.roster || [])
    .map(
      (r) =>
        `<tr><td style="font:700 14px Arial;color:#1c1a14;padding:7px 0;border-bottom:1px solid #f2ecdd">${esc(
          r.name
        )} <span style="font:400 12px Arial;color:#8a7f68">${esc(r.pos)} &#183; ${esc(
          r.team
        )}</span></td><td align="right" style="padding:7px 0;border-bottom:1px solid #f2ecdd">${pill(
          r.signal
        )}</td></tr><tr><td colspan="2" style="font:400 12px/1.4 Arial;color:#6e6353;padding:0 0 8px">${esc(
          r.note
        )}</td></tr>`
    )
    .join("");

  const rookies = (c.rookies || [])
    .map(
      (rk, i) =>
        `<tr style="background:${i % 2 ? "#ffffff" : "#faf6ee"}"><td width="70" style="font:800 15px Arial;color:#b07d1e;padding:10px 12px">${esc(
          rk.label
        )}</td><td style="font:400 13px/1.4 Arial;color:#2c2820;padding:10px 12px"><b>${esc(
          rk.target
        )}</b> &#8212; ${esc(rk.note)}</td></tr>`
    )
    .join("");

  const waivers = (c.waivers || [])
    .map(
      (w) =>
        `<tr><td style="font:400 13px/1.5 Arial;color:#4a4436;padding:4px 0"><b>${esc(
          w.name
        )}</b> <span style="color:#8a7f68">${esc(w.pos)} &#183; ${esc(
          w.team
        )}</span> &#8212; ${esc(w.note)}</td></tr>`
    )
    .join("");

  const trades = (c.trades || [])
    .map(
      (t) =>
        `<tr><td style="font:400 13px/1.5 Arial;color:#4a4436;padding:4px 0">&#8226; ${esc(
          t
        )}</td></tr>`
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ede4;padding:24px 12px;font-family:Arial,Helvetica,sans-serif"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e2d9c6;border-radius:14px;overflow:hidden">
  <tr><td style="height:5px;background:#c68a2e;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="padding:22px 26px 8px">
    <div style="font:700 11px Arial;letter-spacing:2px;color:#b07d1e;text-transform:uppercase">${esc(
      data.teamName
    )} &#183; Superflex PPR &#183; Delt Dynasty</div>
    <div style="font:800 26px Arial;color:#1c1a14;margin-top:6px">&#127944; Dynasty Daily</div>
    <div style="font:400 13px Arial;color:#8a7f68;margin-top:2px">${esc(dateLabel)}</div>
  </td></tr>
  <tr><td style="padding:14px 26px 0"><div style="${SECT}">&#128204; The one-minute read</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${tldr}</table></td></tr>
  <tr><td style="padding:18px 26px 0"><div style="${SECT}">&#128200; Movers</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${movers}</table></td></tr>
  <tr><td style="padding:18px 26px 0"><div style="${SECT}">&#128100; Your team (${esc(
    data.teamName
  )})</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${roster}</table></td></tr>
  <tr><td style="padding:18px 26px 0"><div style="${SECT}">&#127919; Your rookie picks</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #eee2cc;border-radius:10px">${rookies}</table></td></tr>
  <tr><td style="padding:18px 26px 0"><div style="${SECT}">&#10133; Waiver wire</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${waivers}</table></td></tr>
  ${
    trades
      ? `<tr><td style="padding:18px 26px 0"><div style="${SECT}">&#128302; Trade notes</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${trades}</table></td></tr>`
      : ""
  }
  <tr><td style="padding:16px 26px 22px"><div style="font:400 11px/1.5 Arial;color:#9a8f78;border-top:1px solid #efe7d6;padding-top:12px">Sources: Sleeper (live roster + traded picks) &#183; FantasyPros / DLF / PFF consensus via web search. Analyst reads = published expert consensus.</div></td></tr>
</table></td></tr></table>`;
}
