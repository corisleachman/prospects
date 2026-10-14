import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const OWNER = "corisleachman@googlemail.com";
// LinkedIn people search through treg (https://treg.to): the same HarvestAPI search the
// Apify actor harvestapi~linkedin-profile-search used, without an Apify subscription.
// Uses the TREG_TOKEN secret already set for save-prospect. 25 rows a page.
const TREG_URL = "https://treg.to/call";
const SEARCH_ENDPOINT = "harvestapi.linkedin.leads.search";
const PAGE_SIZE = 25;
const PRICE_PER_PAGE_USD = 0.10; // catalog price; observed billing is $0.05 a page
// Email lookup on add, same caps and conventions as save-prospect's find_email.
const EMAIL_FIND_MAX_COST_USD = "0.02";
const EMAIL_VERIFY_MAX_COST_USD = "0.01";
const cors = {
  "Access-Control-Allow-Origin": "https://corisleachman.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const FUNCS: Record<string, string> = { operations: "18", business_development: "4", marketing: "15", sales: "25" };

function liSlug(u: unknown) { const m = String(u || "").toLowerCase().match(/linkedin\.com\/in\/([^/?#]+)/); return m ? m[1].replace(/\/+$/, "") : ""; }
function domainOf(u: unknown): string {
  const s = String(u || "").trim();
  if (!s) return "";
  try { return new URL(/^https?:/i.test(s) ? s : "https://" + s).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return ""; }
}
// The name part of a domain, so madebymany.co.uk and madebymany.com count as one company.
function brandOf(d: string): string {
  const p = d.split(".");
  if (p.length >= 3 && p[p.length - 1].length === 2 && p[p.length - 2].length <= 3) return p[p.length - 3];
  return p.length >= 2 ? p[p.length - 2] : d;
}
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
// One POST to a treg endpoint. The idempotency key comes from the inputs, so a retry
// after a timeout (or a repeat within 24 hours) replays the answer for free.
async function tregPost(token: string, endpoint: string, payload: Record<string, string>, maxCost: string, timeoutMs: number) {
  const key = "prospects-" + endpoint + "-" + await sha256(JSON.stringify(payload));
  const res = await fetch(`${TREG_URL}/${endpoint}`, {
    method: "POST",
    headers: { "X-Treg-Token": token, "X-Treg-Route-Max-Cost": maxCost, "Idempotency-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}
// Look up a work email with treg.people.email.find, then verify it unless the finder
// already did. Returns the contact fields to save, or null with a reason.
async function findEmail(token: string, c: { linkedin_url?: string; name?: string }, domain: string) {
  const query: Record<string, string> = {};
  if (c.linkedin_url) query.linkedin_url = c.linkedin_url;
  if (c.name) query.full_name = c.name;
  if (domain) query.domain = domain;
  let found: any = null;
  for (const timeoutMs of [60000, 45000]) {
    try { found = await tregPost(token, "treg.people.email.find", query, EMAIL_FIND_MAX_COST_USD, timeoutMs); }
    catch (e) { if ((e as Error)?.name === "TimeoutError") continue; throw e; }
    if (found.res.status === 409) { found = null; continue; } // still running on treg's side
    break;
  }
  if (!found) return { fields: null, reason: "timeout" };
  if (found.res.status === 402) return { fields: null, reason: "no_balance" };
  if (!found.res.ok) return { fields: null, reason: "error" };
  const out = found.data?.output || {};
  const email = typeof out.email === "string" ? out.email.trim().toLowerCase() : "";
  if (!email) return { fields: null, reason: "not_found" };
  const emailDomain = email.split("@")[1] || "";
  // A hit on another company's domain is often the wrong person or an old job.
  if (domain && emailDomain !== domain && !emailDomain.endsWith("." + domain) && !domain.endsWith("." + emailDomain) && brandOf(emailDomain) !== brandOf(domain)) {
    return { fields: null, reason: "off_domain", email };
  }
  let verdict = out.verified === true ? "valid" : "";
  if (!verdict) {
    try {
      const v = await tregPost(token, "treg.people.email.verify", { email }, EMAIL_VERIFY_MAX_COST_USD, 20000);
      verdict = (v.res.ok && (v.data?.output?.status || (v.data?.output?.valid === true ? "valid" : ""))) || "";
    } catch (_) { /* leave it unverified */ }
  }
  verdict = verdict.toString().toLowerCase();
  if (verdict === "invalid") return { fields: null, reason: "invalid", email };
  const provider = (found.data?._treg?.provider || String(found.data?._treg?.served_by || "").split(".")[0] || "").toString();
  const deliverable = verdict === "valid";
  const catchAll = /accept|catch|risky/.test(verdict);
  return {
    fields: {
      email,
      email_status: deliverable ? "deliverable" : "Unverified",
      email_source: `treg (${provider || "unknown"})` + (deliverable ? "" : catchAll ? " catch-all" : " unverified"),
      email_enriched_at: new Date().toISOString(),
    },
    reason: "found",
  };
}
function buildQuery(body: any) {
  const maxItems = Math.min(50, Math.max(1, Number(body.max_items || 15)));
  const f = body.filters || {};
  const functionIds = (Array.isArray(f.functions) ? f.functions : []).map((k: string) => FUNCS[k]).filter(Boolean);
  const titles = Array.isArray(f.job_titles) ? f.job_titles.map((t: string) => String(t).trim()).filter(Boolean) : [];
  // LinkedIn returns nothing when a title filter is combined with seniority, so typed
  // titles replace the "Director and above" filter.
  const seniority = f.director_plus === false || titles.length ? [] : ["220", "300", "310", "320"];
  const q: Record<string, string> = {};
  const companyUrl = (body.company_linkedin_url || "").trim();
  if (companyUrl) q.currentCompanies = companyUrl;
  else if ((body.company || "").trim()) q.search = (body.company || "").trim();
  if (functionIds.length) q.functionIds = functionIds.join(",");
  if (seniority.length) q.seniorityLevelIds = seniority.join(",");
  if (titles.length) q.currentJobTitles = titles.join(",");
  const loc = (body.location || body.country || "").trim();
  if (loc) q.locations = loc;
  return { q, maxItems };
}
function estimateCost(maxItems: number) {
  return Math.ceil(maxItems / PAGE_SIZE) * PRICE_PER_PAGE_USD;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const SB_URL = Deno.env.get("SUPABASE_URL");
    const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!token) return j({ error: "Authentication required" }, 401);
    const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON!, Authorization: `Bearer ${token}` } });
    const user = await uRes.json().catch(() => ({}));
    if (!uRes.ok || ((user?.email || "").toLowerCase() !== OWNER)) return j({ error: "Not authorised" }, 401);
    const svc = { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}` };

    const body = await req.json().catch(() => ({}));
    const action = body.action || "estimate";
    const TREG = Deno.env.get("TREG_TOKEN");

    if (action === "estimate") {
      const { maxItems } = buildQuery(body);
      return j({ recommendedCapUsd: estimateCost(maxItems), maxItems, provider: "treg" });
    }

    if (action === "add") {
      if (!SERVICE) return j({ error: "Server not configured" }, 500);
      const cands = Array.isArray(body.candidates) ? body.candidates : [];
      if (!cands.length) return j({ error: "No candidates" }, 400);
      const exRes = await fetch(`${SB_URL}/rest/v1/contacts?select=linkedin_url&linkedin_url=not.is.null`, { headers: svc });
      const exRows = await exRes.json().catch(() => []);
      const known = new Set((Array.isArray(exRows) ? exRows : []).map((r: any) => liSlug(r.linkedin_url)).filter(Boolean));
      const company = (body.company || "").trim();
      const companyLi = (body.company_linkedin_url || "").trim();
      const category = (body.category || "").trim();
      const toInsert: any[] = [];
      for (const c of cands) {
        const slug = liSlug(c.linkedin_url);
        if (slug && known.has(slug)) continue;
        if (slug) known.add(slug);
        const row: any = {
          name: (c.name || "").trim(),
          title: (c.title || "").trim() || null,
          company: company || (c.company || "").trim() || null,
          linkedin_url: (c.linkedin_url || "").trim() || null,
          company_linkedin_url: companyLi || (c.company_linkedin_url || "").trim() || null,
          email: (c.email || "").trim() || null,
          source: "linkedin-people-search",
        };
        if (category) row.category = category;
        if (row.name) toInsert.push(row);
      }
      if (!toInsert.length) return j({ inserted: [], skipped: cands.length });
      const insRes = await fetch(`${SB_URL}/rest/v1/contacts`, { method: "POST", headers: { ...svc, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(toInsert) });
      const insData = await insRes.json().catch(() => null);
      if (!insRes.ok) { const msg = (insData && (insData.message || insData.error || insData.hint)) || `Insert failed (${insRes.status})`; return j({ error: msg }, 502); }
      let inserted: any[] = Array.isArray(insData) ? insData : [insData];
      // Look up each new contact's work email with treg and save it on the contact.
      const emailResults: Record<string, string> = {};
      if (TREG) {
        const domain = domainOf(body.company_domain);
        inserted = await Promise.all(inserted.map(async (row: any) => {
          if (!row?.id || row.email) return row;
          try {
            const r = await findEmail(TREG, { linkedin_url: row.linkedin_url || "", name: row.name || "" }, domain);
            emailResults[row.id] = r.reason;
            if (!r.fields) return row;
            const up = await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${row.id}`, { method: "PATCH", headers: { ...svc, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(r.fields) });
            const upData = await up.json().catch(() => null);
            return up.ok && Array.isArray(upData) && upData[0] ? upData[0] : row;
          } catch (_) { emailResults[row.id] = "error"; return row; }
        }));
      }
      return j({ inserted, skipped: cands.length - toInsert.length, email: emailResults });
    }

    if (!TREG) return j({ error: "TREG_TOKEN is not configured." }, 503);
    if (body.confirm_paid_run !== true) { const { maxItems } = buildQuery(body); return j({ error: "Paid run not confirmed.", recommendedCapUsd: estimateCost(maxItems) }, 402); }
    const { q, maxItems } = buildQuery(body);
    const items: any[] = [];
    let spent = 0;
    for (let page = 1; items.length < maxItems && page <= Math.ceil(maxItems / PAGE_SIZE); page++) {
      const url = new URL(`${TREG_URL}/${SEARCH_ENDPOINT}`);
      for (const [k, v] of Object.entries({ ...q, page: String(page) })) url.searchParams.set(k, v);
      const tRes = await fetch(url, {
        headers: { "X-Treg-Token": TREG, "X-Treg-Route-Max-Cost": PRICE_PER_PAGE_USD.toFixed(2) },
        signal: AbortSignal.timeout(100000),
      });
      spent += Number(tRes.headers.get("X-Treg-Cost-Micro") || 0) / 1e6;
      const data = await tRes.json().catch(() => null);
      if (tRes.status === 402) return j({ error: "treg balance is too low for this search. Top up at treg.to.", topup_url: data?.topup_url || null }, 402);
      if (!tRes.ok) return j({ error: "LinkedIn search failed.", detail: JSON.stringify(data?.detail ?? data ?? tRes.status).slice(0, 400) }, 502);
      const els = Array.isArray(data?.elements) ? data.elements : [];
      items.push(...els);
      const totalPages = Number(data?.pagination?.totalPages || 0);
      if (!els.length || page >= totalPages) break;
    }
    items.splice(maxItems);
    let known = new Set<string>();
    if (SERVICE) {
      const exRes = await fetch(`${SB_URL}/rest/v1/contacts?select=linkedin_url&linkedin_url=not.is.null`, { headers: svc });
      const exRows = await exRes.json().catch(() => []);
      known = new Set((Array.isArray(exRows) ? exRows : []).map((r: any) => liSlug(r.linkedin_url)).filter(Boolean));
    }
    // LinkedIn reports each position's company as a numeric page (/company/10957811), not
    // the vanity URL the dashboard holds. When the search is scoped to one company, the
    // company ID most results share is that company; use its position and report the
    // scoped URL for it so the dashboard knows the person works there.
    const scopedUrl = q.currentCompanies || "";
    let targetId = "";
    if (scopedUrl) {
      const tally: Record<string, number> = {};
      for (const it of items) {
        const ids = new Set((Array.isArray(it?.currentPositions) ? it.currentPositions : []).map((p: any) => String(p?.companyId || "")).filter(Boolean));
        for (const id of ids) tally[id] = (tally[id] || 0) + 1;
      }
      for (const [id, n] of Object.entries(tally)) if (!targetId || n > tally[targetId]) targetId = id;
    }
    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const it of items) {
      const linkedin_url = it?.linkedinUrl || (it?.publicIdentifier ? ("https://www.linkedin.com/in/" + it.publicIdentifier) : "");
      const slug = liSlug(linkedin_url);
      if (slug) { if (seen.has(slug)) continue; seen.add(slug); }
      const positions = Array.isArray(it?.currentPositions) ? it.currentPositions : [];
      const atTarget = targetId ? positions.find((p: any) => String(p?.companyId || "") === targetId) : null;
      const cp = atTarget || positions[0] || {};
      const name = (it?.firstName || it?.lastName) ? [it.firstName, it.lastName].filter(Boolean).join(" ") : (it?.name || "");
      if (!name) continue;
      candidates.push({
        name,
        title: cp?.title || it?.headline || "",
        company: cp?.companyName || "",
        company_linkedin_url: atTarget ? scopedUrl : (cp?.companyLinkedinUrl || ""),
        linkedin_url,
        email: "",
        location: it?.location?.parsed?.text || it?.location?.linkedinText || "",
        existing: slug ? known.has(slug) : false,
      });
    }
    return j({ candidates, actorItems: items.length, capUsd: estimateCost(maxItems), spentUsd: spent });
  } catch (e) { return j({ error: String(e) }, 500); }
});
