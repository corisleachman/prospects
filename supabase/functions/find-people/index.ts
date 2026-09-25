import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const OWNER = "corisleachman@googlemail.com";
const ACTOR = "harvestapi~linkedin-profile-search";
const cors = {
  "Access-Control-Allow-Origin": "https://corisleachman.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const FUNCS: Record<string, string> = { operations: "18", business_development: "4", marketing: "15", sales: "25" };

function liSlug(u: unknown) { const m = String(u || "").toLowerCase().match(/linkedin\.com\/in\/([^/?#]+)/); return m ? m[1].replace(/\/+$/, "") : ""; }
function pickEmail(emails: unknown, top: unknown) {
  if (Array.isArray(emails) && emails.length) { const e: any = emails[0]; if (typeof e === "string") return e; if (e) return e.email || e.value || e.address || ""; }
  return typeof top === "string" ? top : "";
}
function buildInput(body: any) {
  const mode = body.mode === "full_email" ? "Full + email search" : body.mode === "full" ? "Full" : "Short";
  const maxItems = Math.min(50, Math.max(1, Number(body.max_items || 15)));
  const f = body.filters || {};
  const functionIds = (Array.isArray(f.functions) ? f.functions : []).map((k: string) => FUNCS[k]).filter(Boolean);
  const seniority = f.director_plus === false ? [] : ["220", "300", "310", "320"];
  const titles = Array.isArray(f.job_titles) ? f.job_titles.filter(Boolean) : [];
  const input: any = { profileScraperMode: mode, maxItems };
  const companyUrl = (body.company_linkedin_url || "").trim();
  if (companyUrl) input.currentCompanies = [companyUrl];
  else if ((body.company || "").trim()) input.searchQuery = (body.company || "").trim();
  if (functionIds.length) input.functionIds = functionIds;
  if (seniority.length) input.seniorityLevelIds = seniority;
  if (titles.length) input.currentJobTitles = titles;
  const loc = (body.location || body.country || "").trim();
  if (loc) input.locations = [loc];
  return { input, mode, maxItems };
}
function estimateCost(mode: string, maxItems: number) {
  const pages = Math.ceil(maxItems / 25);
  const perProfile = mode === "Full + email search" ? 0.01 : mode === "Full" ? 0.004 : 0;
  const est = pages * 0.10 + maxItems * perProfile;
  return Math.max(0.05, Math.ceil((est + 0.02) * 100) / 100);
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
    const apifyToken = Deno.env.get("APIFY_TOKEN");

    if (action === "estimate") {
      const { mode, maxItems } = buildInput(body);
      return j({ recommendedCapUsd: estimateCost(mode, maxItems), maxItems, mode });
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
      return j({ inserted: Array.isArray(insData) ? insData : [insData], skipped: cands.length - toInsert.length });
    }

    if (!apifyToken) return j({ error: "APIFY_TOKEN is not configured." }, 503);
    if (body.confirm_paid_run !== true) { const { mode, maxItems } = buildInput(body); return j({ error: "Paid run not confirmed.", recommendedCapUsd: estimateCost(mode, maxItems) }, 402); }
    const { input, mode, maxItems } = buildInput(body);
    const cap = estimateCost(mode, maxItems);
    const endpoint = new URL("https://api.apify.com/v2/acts/" + ACTOR + "/run-sync-get-dataset-items");
    endpoint.searchParams.set("maxTotalChargeUsd", cap.toFixed(2));
    endpoint.searchParams.set("clean", "true");
    endpoint.searchParams.set("format", "json");
    const aRes = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + apifyToken, "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(120000) });
    const txt = await aRes.text();
    if (!aRes.ok) return j({ error: "LinkedIn search failed.", detail: txt.slice(0, 400) }, 502);
    let items: any; try { items = JSON.parse(txt); } catch { items = []; }
    if (!Array.isArray(items)) items = [];
    let known = new Set<string>();
    if (SERVICE) {
      const exRes = await fetch(`${SB_URL}/rest/v1/contacts?select=linkedin_url&linkedin_url=not.is.null`, { headers: svc });
      const exRows = await exRes.json().catch(() => []);
      known = new Set((Array.isArray(exRows) ? exRows : []).map((r: any) => liSlug(r.linkedin_url)).filter(Boolean));
    }
    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const it of items) {
      const linkedin_url = it?.linkedinUrl || (it?.publicIdentifier ? ("https://www.linkedin.com/in/" + it.publicIdentifier) : "");
      const slug = liSlug(linkedin_url);
      if (slug) { if (seen.has(slug)) continue; seen.add(slug); }
      const cp = Array.isArray(it?.currentPosition) && it.currentPosition[0] ? it.currentPosition[0] : {};
      const name = (it?.firstName || it?.lastName) ? [it.firstName, it.lastName].filter(Boolean).join(" ") : (it?.name || "");
      if (!name) continue;
      candidates.push({
        name,
        title: it?.headline || cp?.position || "",
        company: cp?.companyName || "",
        company_linkedin_url: cp?.companyLinkedinUrl || "",
        linkedin_url,
        email: pickEmail(it?.emails, it?.email),
        location: it?.location?.parsed?.text || it?.location?.linkedinText || "",
        existing: slug ? known.has(slug) : false,
      });
    }
    return j({ candidates, actorItems: items.length, capUsd: cap });
  } catch (e) { return j({ error: String(e) }, 500); }
});
