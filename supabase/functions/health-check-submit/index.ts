// health-check-submit — receives a completed new business health check from the website,
// saves it to enquiries (source = 'health_check'), builds a branded PDF and emails it via Resend.
// Secrets (Supabase function secrets): RESEND_API_KEY. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { PDFDocument, PDFName, PDFString, rgb, StandardFonts, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const FROM = "Coris Leachman <hello@corisleachman.com>";
const REPLY_TO = "corisleachman@gmail.com";
const BOOK_URL = "https://calendar.app.google/qnfFXyo2wCBRpuB27";
const SITE_URL = "https://corisleachman.com";

// ---------- scoring model (mirrors the health check page) ----------
const STAGES = [
  { t: "Proposition", prod: "playbook", fix: "Sharpen the hook and package the core offer, so you are easy to understand and easy to buy.",
    q: ["We can say in one sentence why clients pick us over similar agencies.", "Our core offer is packaged with a defined scope, outcome and price.", "Our website and credentials say the same thing we say in a pitch."] },
  { t: "Ideal client", prod: "playbook", fix: "Write down the ideal client profile and turn it into a named, tiered list of target companies.",
    q: ["We have a written ideal client profile: sectors, size and decision-maker titles.", "We have a named, tiered list of the companies we want to work with.", "We regularly turn down work that doesn't fit."] },
  { t: "The numbers", prod: "playbook", fix: "Model the pipeline maths, so the activity you plan actually adds up to the target.",
    q: ["We have a net-new revenue target, separate from growth in existing clients.", "We know how many meetings and proposals it takes to hit that target.", "We know our win rate and our average project value."] },
  { t: "Pipeline", prod: "engine", fix: "Define clear pipeline stages and get every live opportunity into one place you can forecast from.",
    q: ["Every live opportunity sits in one place, with clear stages.", "We could forecast next quarter's new business with some confidence.", "Opportunities rarely go quiet without an agreed next step."] },
  { t: "Proof", prod: "audit", fix: "Turn recent wins into case studies with results, matched to the sectors you're targeting.",
    q: ["We have recent case studies with real results, relevant to our target sectors.", "We could send a strong, tailored credentials deck within a day.", "We know why we won our last three pitches."] },
  { t: "Engagement", prod: "playbook", fix: "Set a weekly engagement rhythm your team can sustain, built around a point of view.",
    q: ["We publish a point of view our target clients would recognise.", "Outreach and nurture happen every week, even when the studio is busy.", "We stay in touch with past clients and warm contacts on purpose."] },
  { t: "Ownership", prod: "engine", fix: "Take new business off the founder's shoulders: named owners, clear roles and a fixed review rhythm.",
    q: ["New business would keep running if the founder took a month off.", "Named people own specific new business activities.", "We review the pipeline together on a fixed weekly or fortnightly rhythm."] },
  { t: "Systems", prod: "engine", fix: "Configure the CRM around your process and automate the follow-up, so nothing relies on memory.",
    q: ["Our CRM is set up for our process, and the team actually uses it.", "Follow-ups and nurture are at least partly automated.", "We use AI for prospect research, content or proposal drafting."] },
];
const PRODUCTS: Record<string, { name: string; line: string }> = {
  audit: { name: "The New Business Audit", line: "Three days, about two hours of your time, and a prioritised plan for what to fix first." },
  playbook: { name: "The Growth Playbook", line: "Your ICP, revenue model, engagement plan and six-month calendar in one plan your team can follow." },
  engine: { name: "The New Business Engine", line: "The CRM, scoring, nurture and team rhythm built and handed over, so new business runs without the founder." },
};
const TIERS = [
  { min: 0, label: "Founder-powered", text: "New business runs on the founder's energy and network. It works in good months and stops in busy ones. The fix starts with seeing clearly where you are." },
  { min: 40, label: "Foundations forming", text: "Some of the pieces are there, but they aren't joined up into a system yet. A clear plan, owned by the team, is what turns effort into a pipeline." },
  { min: 70, label: "Engine running", text: "You have more in place than most agencies. The gains now come from tightening the weak spots and making the machine less dependent on any one person." },
];
const MAX = 2; // highest answer value; raise if a fourth option is added

function score(answers: number[]) {
  const stage = STAGES.map((_, i) => answers.slice(i * 3, i * 3 + 3).reduce((a, b) => a + b, 0));
  const total = Math.round(answers.reduce((a, b) => a + b, 0) / (answers.length * MAX) * 100);
  const tier = TIERS.filter((t) => total >= t.min).pop()!;
  const order = stage.map((_, i) => i).sort((a, b) => stage[a] - stage[b] || a - b);
  const gaps = order.slice(0, 3);
  let rec = "audit";
  if (total >= 40) {
    const v: Record<string, number> = {};
    gaps.forEach((g) => (v[STAGES[g].prod] = (v[STAGES[g].prod] || 0) + 1));
    let n = 0;
    for (const k of Object.keys(v)) if (v[k] > n) { n = v[k]; rec = k; }
  }
  return { stage, total, tier, gaps, rec };
}

// ---------- CORS ----------
const ALLOWED = [/^https:\/\/(www\.)?corisleachman\.com$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];
function cors(origin: string | null) {
  const ok = origin && ALLOWED.some((r) => r.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://corisleachman.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

// ---------- PDF ----------
const C = {
  forest: rgb(9 / 255, 40 / 255, 22 / 255), forest2: rgb(15 / 255, 53 / 255, 32 / 255),
  nude: rgb(212 / 255, 197 / 255, 178 / 255), nude2: rgb(228 / 255, 217 / 255, 203 / 255),
  lime: rgb(226 / 255, 248 / 255, 201 / 255), ink: rgb(11 / 255, 26 / 255, 16 / 255),
  muted: rgb(157 / 255, 179 / 255, 161 / 255), mutedNude: rgb(91 / 255, 82 / 255, 70 / 255),
  coral: rgb(201 / 255, 119 / 255, 95 / 255),
};
const FONT_URLS = {
  displayLight: "https://cdn.jsdelivr.net/fontsource/fonts/oswald@latest/latin-200-normal.ttf",
  displayBold: "https://cdn.jsdelivr.net/fontsource/fonts/oswald@latest/latin-600-normal.ttf",
  body: "https://cdn.jsdelivr.net/fontsource/fonts/hanken-grotesk@latest/latin-300-normal.ttf",
  bodyMed: "https://cdn.jsdelivr.net/fontsource/fonts/hanken-grotesk@latest/latin-500-normal.ttf",
};
let fontCache: Record<string, Uint8Array> | null = null;
async function loadFontBytes() {
  if (fontCache) return fontCache;
  const out: Record<string, Uint8Array> = {};
  await Promise.all(Object.entries(FONT_URLS).map(async ([k, u]) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`font ${k} ${r.status}`);
    out[k] = new Uint8Array(await r.arrayBuffer());
  }));
  fontCache = out;
  return out;
}

// pdf-lib's standard fonts can't encode curly quotes etc.; keep fallback text safe
function safe(s: string, custom: boolean) {
  return custom ? s : s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x00-\xFF]/g, "");
}
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.split(/\s+/), lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(t, size) > width && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

async function buildPdf(lead: { name: string; company: string }, r: ReturnType<typeof score>, answers: number[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(`New business health check: ${lead.company}`);
  doc.setAuthor("Coris Leachman");
  let custom = true;
  let F: { dl: PDFFont; db: PDFFont; b: PDFFont; bm: PDFFont };
  try {
    doc.registerFontkit(fontkit);
    const bytes = await loadFontBytes();
    F = {
      dl: await doc.embedFont(bytes.displayLight, { subset: true }), db: await doc.embedFont(bytes.displayBold, { subset: true }),
      b: await doc.embedFont(bytes.body, { subset: true }), bm: await doc.embedFont(bytes.bodyMed, { subset: true }),
    };
  } catch (_e) {
    custom = false;
    const h = await doc.embedFont(StandardFonts.Helvetica), hb = await doc.embedFont(StandardFonts.HelveticaBold);
    F = { dl: h, db: hb, b: h, bm: hb };
  }
  const T = (s: string) => safe(s, custom);
  const W = 595.28, H = 841.89, M = 48;
  const text = (p: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number, color = C.nude, spacing = 0) =>
    p.drawText(T(s), { x, y, font, size, color, characterSpacing: spacing });
  const para = (p: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number, width: number, color = C.nude, lh = 1.4) => {
    const lines = wrap(T(s), font, size, width);
    lines.forEach((l, i) => p.drawText(l, { x, y: y - i * size * lh, font, size, color }));
    return y - lines.length * size * lh;
  };
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // ----- page 1: the score -----
  const p1 = doc.addPage([W, H]);
  p1.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.forest });
  text(p1, "CORIS LEACHMAN", M, H - M - 10, F.db, 13, C.nude, 0.6);
  text(p1, "NEW BUSINESS HEALTH CHECK", W - M - F.bm.widthOfTextAtSize(T("NEW BUSINESS HEALTH CHECK"), 8) - 8 * 0.12 * 24, H - M - 8, F.bm, 8, C.muted, 1.2);
  p1.drawLine({ start: { x: M, y: H - M - 26 }, end: { x: W - M, y: H - M - 26 }, thickness: 0.5, color: C.forest2 });

  text(p1, "PREPARED FOR", M, H - 150, F.bm, 8, C.muted, 1.2);
  text(p1, lead.name, M, H - 172, F.b, 18, C.nude);
  text(p1, lead.company, M, H - 194, F.b, 18, C.muted);

  const sc = String(r.total);
  text(p1, sc, M - 6, H - 470, F.dl, 230, C.lime, -4);
  const scW = F.dl.widthOfTextAtSize(T(sc), 230) - 4 * sc.length;
  text(p1, "/100", M + scW + 4, H - 470, F.dl, 40, C.muted);

  const [tA, ...tB] = r.tier.label.split(/[- ]/);
  text(p1, tA.toUpperCase(), M, H - 560, F.dl, 52, C.nude, -0.5);
  text(p1, tB.join(" ").toUpperCase() || "", M, H - 612, F.db, 52, C.lime, -0.5);
  para(p1, r.tier.text, M, H - 660, F.b, 13, 330, C.nude, 1.45);

  // tier scale
  const sy = 120, sw = (W - M * 2) / 3;
  TIERS.forEach((t, i) => {
    const on = t === r.tier, x = M + i * sw;
    p1.drawLine({ start: { x, y: sy + 30 }, end: { x: x + sw - 8, y: sy + 30 }, thickness: on ? 2 : 0.5, color: on ? C.lime : C.muted });
    text(p1, t.label.toUpperCase(), x, sy + 10, on ? F.db : F.dl, 12, on ? C.lime : C.muted, 0.3);
    text(p1, ["0 to 39", "40 to 69", "70 to 100"][i], x, sy - 6, F.b, 9, C.muted);
  });
  text(p1, date, M, M, F.b, 9, C.muted);
  text(p1, "corisleachman.com", W - M - F.b.widthOfTextAtSize("corisleachman.com", 9), M, F.b, 9, C.muted);

  // ----- page 2: the breakdown -----
  const p2 = doc.addPage([W, H]);
  p2.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.nude });
  text(p2, "CORIS LEACHMAN", M, H - M - 10, F.db, 13, C.ink, 0.6);
  text(p2, `${lead.company.toUpperCase()}  ·  ${r.total}/100`, W - M - F.bm.widthOfTextAtSize(T(`${lead.company.toUpperCase()}  ·  ${r.total}/100`), 8) - 10, H - M - 8, F.bm, 8, C.mutedNude, 1.2);

  text(p2, "YOUR ENGINE,", M, H - 128, F.dl, 34, C.ink, -0.3);
  text(p2, "STAGE BY STAGE", M, H - 164, F.db, 34, C.ink, -0.3);

  let y = H - 210;
  const bx = M + 150, bw = W - M - bx - 46;
  STAGES.forEach((s, i) => {
    const v = r.stage[i];
    text(p2, `0${i + 1}`, M, y, F.b, 9, C.mutedNude);
    text(p2, s.t.toUpperCase(), M + 24, y, F.dl, 13, C.ink, 0.2);
    p2.drawRectangle({ x: bx, y: y - 2, width: bw, height: 10, color: C.nude2 });
    if (v > 0) p2.drawRectangle({ x: bx, y: y - 2, width: bw * v / 6, height: 10, color: v >= 5 ? C.forest : v <= 2 ? C.coral : C.forest2 });
    text(p2, `${v} / 6`, W - M - F.b.widthOfTextAtSize(`${v} / 6`, 10), y, F.b, 10, C.ink);
    p2.drawLine({ start: { x: M, y: y - 12 }, end: { x: W - M, y: y - 12 }, thickness: 0.4, color: C.nude2 });
    y -= 28;
  });

  y -= 26;
  text(p2, "YOUR THREE", M, y, F.dl, 26, C.ink, -0.2);
  text(p2, "BIGGEST GAPS", M + F.dl.widthOfTextAtSize("YOUR THREE ", 26), y, F.db, 26, C.ink, -0.2);
  y -= 30;
  const gw = 300;
  r.gaps.forEach((g, k) => {
    const s = STAGES[g];
    p2.drawLine({ start: { x: M, y: y + 14 }, end: { x: M + gw + 30, y: y + 14 }, thickness: 0.5, color: C.mutedNude });
    text(p2, String(k + 1), M, y - 14, F.dl, 28, C.forest);
    text(p2, `${s.t.toUpperCase()}  ·  ${r.stage[g]} / 6`, M + 30, y, F.db, 12, C.ink, 0.3);
    y = para(p2, s.fix, M + 30, y - 16, F.b, 10, gw, C.ink, 1.4) - 2;
    const missing = [0, 1, 2].filter((j) => answers[g * 3 + j] < MAX).map((j) => s.q[j]);
    if (missing.length) y = para(p2, "Not fully in place: " + missing.join(" "), M + 30, y, F.b, 8.5, gw, C.mutedNude, 1.4);
    y -= 18;
  });

  // recommendation panel
  const px = M + gw + 50, pw = W - M - px, ptop = H - 474 - 26;
  const P = PRODUCTS[r.rec];
  const pLines = wrap(T(P.line), F.b, 9.5, pw - 32);
  const nameLines = wrap(T(P.name.toUpperCase()), F.db, 20, pw - 32);
  const ph = 60 + nameLines.length * 20 + pLines.length * 13.5 + 70;
  p2.drawRectangle({ x: px, y: ptop - ph, width: pw, height: ph, color: C.forest });
  text(p2, "WHERE I'D START", px + 16, ptop - 26, F.bm, 7.5, C.muted, 1.1);
  nameLines.forEach((l, i) => p2.drawText(l, { x: px + 16, y: ptop - 54 - i * 20, font: F.db, size: 20, color: C.lime }));
  let py = ptop - 54 - nameLines.length * 20 - 6;
  pLines.forEach((l, i) => p2.drawText(l, { x: px + 16, y: py - i * 13.5, font: F.b, size: 9.5, color: C.nude }));
  py -= pLines.length * 13.5 + 22;
  p2.drawRectangle({ x: px + 16, y: py - 8, width: 104, height: 24, color: C.lime });
  text(p2, "Book a call", px + 30, py, F.bm, 9.5, C.ink);
  // make the lime button a clickable link to the booking page
  const link = doc.context.register(doc.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [px + 16, py - 8, px + 120, py + 16], Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(BOOK_URL) },
  }));
  p2.node.set(PDFName.of("Annots"), doc.context.obj([link]));

  text(p2, "Questions about your results? Reply to the email this came with.", M, M + 14, F.b, 9, C.mutedNude);
  text(p2, `${date}  ·  corisleachman.com`, M, M, F.b, 9, C.mutedNude);

  return await doc.save();
}

// ---------- email ----------
function esc(s: unknown) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function emailHtml(first: string, r: ReturnType<typeof score>) {
  const P = PRODUCTS[r.rec];
  const gaps = r.gaps.map((g) => `<li style="margin:0 0 6px">${esc(STAGES[g].t)} (${r.stage[g]}/6)</li>`).join("");
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0B1A10;max-width:560px">
<p>Hi ${esc(first)},</p>
<p>Thanks for taking the new business health check. Your full results are attached as a PDF, so you can share them with your team.</p>
<p style="margin:22px 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5B5246">Your score</p>
<p style="margin:0;font-size:40px;line-height:1;color:#092816"><b>${r.total}</b><span style="font-size:18px;color:#5B5246">/100</span> &nbsp;<span style="font-size:18px">${esc(r.tier.label)}</span></p>
<p style="margin:22px 0 6px">The three gaps costing you most right now:</p>
<ol style="margin:0 0 18px;padding-left:20px">${gaps}</ol>
<p>Where I'd start: <b>${esc(P.name)}</b>. ${esc(P.line)}</p>
<p>If you'd like to talk it through, reply to this email or <a href="${BOOK_URL}" style="color:#092816">book a 30-minute call</a>. No pitch deck, just an honest look at where new business stands.</p>
<p>Coris</p>
<p style="font-size:12px;color:#5B5246;margin-top:28px">Coris Leachman · New business growth partner for independent agencies · <a href="${SITE_URL}" style="color:#5B5246">corisleachman.com</a><br>You're receiving this because you completed the health check on corisleachman.com. <a href="${SITE_URL}/privacy" style="color:#5B5246">Privacy policy</a>.</p>
</div>`;
}
function b64(bytes: Uint8Array) {
  let s = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

// ---------- handler ----------
Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...h, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return j({ error: "method" }, 405);

  try {
    const body = await req.json().catch(() => null);
    if (!body) return j({ error: "Invalid request." }, 400);
    if (body.website) return j({ ok: true }); // honeypot: bots fill hidden fields

    const clean = (v: unknown, n = 160) => String(v ?? "").trim().slice(0, n);
    const lead = { name: clean(body.name), email: clean(body.email).toLowerCase(), company: clean(body.company), title: clean(body.title) };
    if (!lead.name || !lead.company || !lead.title || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return j({ error: "Please fill in every field with a valid email." }, 400);
    const answers = Array.isArray(body.answers) ? body.answers.map((n: unknown) => Number(n)) : [];
    if (answers.length !== STAGES.length * 3 || answers.some((n: number) => !Number.isInteger(n) || n < 0 || n > MAX)) return j({ error: "Answers are incomplete." }, 400);

    const SB = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sbh = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

    // rate limit: max 3 submissions per email per hour
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await fetch(`${SB}/rest/v1/enquiries?select=id&source=eq.health_check&email=eq.${encodeURIComponent(lead.email)}&created_at=gte.${since}`, { headers: sbh }).then((r) => r.json()).catch(() => []);
    if (Array.isArray(recent) && recent.length >= 3) return j({ error: "You've already submitted a few times. Check your inbox for your results." }, 429);

    const r = score(answers);
    const summary = `Health check: ${r.total}/100, ${r.tier.label}. Biggest gaps: ${r.gaps.map((g) => STAGES[g].t).join(", ")}. Suggested start: ${PRODUCTS[r.rec].name}.`;
    const ins = await fetch(`${SB}/rest/v1/enquiries`, {
      method: "POST", headers: { ...sbh, Prefer: "return=representation" },
      body: JSON.stringify({
        name: lead.name, email: lead.email, company: lead.company, job_title: lead.title, source: "health_check",
        message: summary, score: r.total, tier: r.tier.label,
        results: { answers, stages: STAGES.map((s, i) => ({ stage: s.t, score: r.stage[i] })), gaps: r.gaps.map((g) => STAGES[g].t), recommended: PRODUCTS[r.rec].name, page: clean(body.page, 300) },
      }),
    });
    const row = (await ins.json().catch(() => []))[0];
    if (!ins.ok || !row) return j({ error: "Couldn't save your results. Please try again." }, 500);

    // build + send; failures are recorded but don't fail the visitor's request
    let status = "sent", detail = "";
    try {
      const key = Deno.env.get("RESEND_API_KEY");
      if (!key) throw new Error("RESEND_API_KEY not set");
      const pdf = await buildPdf(lead, r, answers);
      const first = lead.name.split(/\s+/)[0];
      const send = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to: [lead.email], reply_to: REPLY_TO,
          subject: `Your new business health check: ${r.total}/100`,
          html: emailHtml(first, r),
          attachments: [{ filename: `New-business-health-check-${lead.company.replace(/[^a-z0-9]+/gi, "-")}.pdf`, content: b64(pdf) }],
        }),
      });
      if (!send.ok) { status = "failed"; detail = (await send.text()).slice(0, 300); }
    } catch (e) { status = "failed"; detail = String(e).slice(0, 300); }

    await fetch(`${SB}/rest/v1/enquiries?id=eq.${row.id}`, { method: "PATCH", headers: sbh, body: JSON.stringify({ email_status: status === "sent" ? "sent" : `failed: ${detail}` }) }).catch(() => {});
    return j({ ok: true, score: r.total, emailed: status === "sent" });
  } catch (e) {
    return j({ error: "Something went wrong.", detail: String(e).slice(0, 200) }, 500);
  }
});
