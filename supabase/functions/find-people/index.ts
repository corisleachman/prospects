import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const OWNER = "corisleachman@googlemail.com";
// LinkedIn people search through treg (https://treg.to): the same HarvestAPI search the
// Apify actor harvestapi~linkedin-profile-search used, without an Apify subscription.
// Uses the TREG_TOKEN secret already set for save-prospect. 25 rows a page.
const TREG_URL = "https://treg.to/call";
const SEARCH_ENDPOINT = "harvestapi.linkedin.leads.search";
const PAGE_SIZE = 25;
const PRICE_PER_PAGE_USD = 0.10; // catalog price; observed billing is $0.05 a page
const cors = {
  "Access-Control-Allow-Origin": "https://corisleachman.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const FUNCS: Record<string, string> = { operations: "18", business_development: "4", marketing: "15", sales: "25" };

function liSlug(u: unknown) { const m = String(u || "").toLowerCase().match(/linkedin\.com\/in\/([^/?#]+)/); return m ? m[1].replace(/\/+$/, "") : ""; }
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
      return j({ inserted: Array.isArray(insData) ? insData : [insData], skipped: cands.length - toInsert.length });
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
    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const it of items) {
      const linkedin_url = it?.linkedinUrl || (it?.publicIdentifier ? ("https://www.linkedin.com/in/" + it.publicIdentifier) : "");
      const slug = liSlug(linkedin_url);
      if (slug) { if (seen.has(slug)) continue; seen.add(slug); }
      const cp = Array.isArray(it?.currentPositions) && it.currentPositions[0] ? it.currentPositions[0] : {};
      const name = (it?.firstName || it?.lastName) ? [it.firstName, it.lastName].filter(Boolean).join(" ") : (it?.name || "");
      if (!name) continue;
      candidates.push({
        name,
        title: cp?.title || it?.headline || "",
        company: cp?.companyName || "",
        company_linkedin_url: cp?.companyLinkedinUrl || "",
        linkedin_url,
        email: "",
        location: it?.location?.parsed?.text || it?.location?.linkedinText || "",
        existing: slug ? known.has(slug) : false,
      });
    }
    return j({ candidates, actorItems: items.length, capUsd: estimateCost(maxItems), spentUsd: spent });
  } catch (e) { return j({ error: String(e) }, 500); }
});
