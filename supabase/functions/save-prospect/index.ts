// save-prospect — single privileged writer for public.contacts (RLS: owner-only).
// Gated by a shared secret in the x-extension-secret header. Actions:
//   categories     — distinct categories in use (for the popup dropdown)
//   match          — possible existing contacts by name (company boosts confidence)
//   update         — always (re)attach linkedin_url; apply an explicitly chosen category;
//                    fill other blank fields; never overwrite the rest
//   insert         — create a new contact (default when no action is given)
//   company_status — current LinkedIn/website details for an agency (popup polls this)
//   backfill       — claim a batch of agencies missing website/LinkedIn and look them up
//   review_refetch — record match details for name-only matches made before tracking
//
// After an insert/update the contact is linked to its agency by the DB trigger
// (b10_link_agency). If that agency is missing its website or LinkedIn page, we run
// the Apify actor harvestapi/linkedin-company in the background and fill the blanks
// on public.agencies; trigger z10_sync_agency_to_contacts copies them onto every
// linked contact.

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

// Set with: supabase secrets set EXTENSION_SHARED_SECRET=... (never commit the value).
const SHARED_SECRET = Deno.env.get("EXTENSION_SHARED_SECRET") ?? "";

const COMPANY_ACTOR = "harvestapi~linkedin-company";
const COMPANY_MAX_CHARGE_USD = "0.05";
const RETRY_AFTER_DAYS = 30;

// Columns a capture/update may set. Everything else is left to the database.
const ALLOWED = [
  "name", "email", "company", "title", "category", "source",
  "status", "linkedin_url", "notes", "website", "follow_up_at", "research_summary",
  "company_linkedin_url",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-extension-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const norm = (s: unknown) => (s ?? "").toString().toLowerCase().replace(/\s+/g, " ").trim();
const normCompany = (s: unknown) =>
  norm(s)
    .replace(/[.,]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(ltd|limited|inc|llc|llp|plc|co|company|group|studio|studios|agency|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
const tokens = (s: unknown) => norm(s).split(" ").filter(Boolean);
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

// Any LinkedIn company/showcase/school link -> https://www.linkedin.com/company/<slug>
function companyUrl(value: unknown): string {
  const m = String(value || "").match(/linkedin\.com\/(?:company|showcase|school)\/([^/?#\s]+)/i);
  return m ? "https://www.linkedin.com/company/" + decodeURIComponent(m[1]).replace(/\/+$/, "") : "";
}
const companySlug = (u: string) => (u.match(/\/company\/([^/?#]+)/i)?.[1] || "").toLowerCase();
const isNumericCompanyUrl = (u: unknown) => /\/company\/\d+\/?$/i.test(String(u || ""));

// Letters and digits only: "BMB Agency" and "Bmbagency" both -> "bmbagency".
const squash = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, "");

// Search-friendly company name: "Shoot The Moon :: London" -> "Shoot The Moon".
const searchName = (s: unknown) =>
  String(s || "").split(/\s*(?:::|\||—|–|\s-\s)\s*/)[0].trim() || String(s || "").trim();

// What to type into LinkedIn search. Squashed domain-style names ("Wearebulletproof",
// "Etchcreative") don't search well, so use their core word; the match rules still
// compare results against the full name and domain.
function searchQuery(s: unknown): string {
  const base = searchName(s);
  if (/\s/.test(base) || base.length < 8) return base;
  let core = base.toLowerCase();
  const p = core.replace(/^(weare|the)/, "");
  if (p.length >= 4) core = p;
  const q = core.replace(/(london|uk|ltd|agency|creatives?|studios?|digital|group|designs?|media|global|international|marketing|comms)$/, "");
  if (q.length >= 4) core = q;
  return core;
}

function sameCompany(a: unknown, b: unknown): boolean {
  const x = normCompany(a), y = normCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Names imported from email domains are squashed together ("Shoreditchdesignstudio").
  const sa = squash(a), sb = squash(b);
  if (sa && sa === sb) return true;
  const sx = squash(x), sy = squash(y);
  if (sx && sx === sy) return true;
  const shorter = x.length <= y.length ? x : y;
  return shorter.length >= 4 && (x.startsWith(y) || y.startsWith(x));
}

function domainOf(u: unknown): string {
  const s = String(u || "").trim();
  if (!s) return "";
  try { return new URL(/^https?:/i.test(s) ? s : "https://" + s).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return ""; }
}

const UK = new Set(["gb", "uk", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland"]);
function inCountry(want: string, locations: any[]): boolean {
  const w = norm(want) || "united kingdom";
  return locations.some((l) => {
    const vals = [l?.parsed?.countryCode, l?.parsed?.country, l?.parsed?.countryFull, l?.country].map(norm).filter(Boolean);
    if (UK.has(w)) return vals.some((v) => UK.has(v));
    return vals.some((v) => v === w || v.includes(w) || w.includes(v));
  });
}

// How far to trust a LinkedIn company result for this agency.
//   ok              — looked up by the company's own page URL, or website domain confirmed
//   matched_by_name — name matches and it's in the right country (worth a glance)
//   no_match        — different company; write nothing
function judge(agency: any, item: any, viaUrl: boolean): "ok" | "matched_by_name" | "no_match" {
  if (viaUrl) return "ok";
  const have = agency?.domain || domainOf(agency?.website);
  const got = domainOf(item?.website);
  // The company's own website is named after it ("Jdoglobal" -> jdoglobal.com): strong match,
  // provided it's in the right country (a US "Wonder" at wonder.com is not a UK agency).
  const gotLabel = got.split(".")[0] || "";
  const locs0 = Array.isArray(item?.locations) ? item.locations : [];
  if (!have && gotLabel.length >= 4 && squash(gotLabel) === squash(searchName(agency?.name))) {
    return (!locs0.length || inCountry(agency?.country || "", locs0)) ? "ok" : "no_match";
  }
  if (!sameCompany(item?.name, searchName(agency?.name))) return "no_match";
  if (have && got) return (have === got || have.endsWith("." + got) || got.endsWith("." + have)) ? "ok" : "no_match";
  const locs = Array.isArray(item?.locations) ? item.locations : [];
  if (locs.length) return inCountry(agency?.country || "", locs) ? "matched_by_name" : "no_match";
  return squash(normCompany(item?.name)) === squash(normCompany(searchName(agency?.name))) ? "matched_by_name" : "no_match";
}

// Values a LinkedIn company result would give each agency field.
function derive(item: any, knownUrl: string) {
  const hq = Array.isArray(item?.locations) ? (item.locations.find((l: any) => l?.headquarter) || item.locations[0]) : null;
  const range = item?.employeeCountRange;
  return {
    linkedin_url: companyUrl(item?.linkedinUrl) || knownUrl || "",
    website: typeof item?.website === "string" ? item.website.trim() : "",
    industry: item?.industries?.[0]?.title || item?.industries?.[0]?.name || "",
    size_band: range && typeof range.start === "number" ? (range.end ? `${range.start}-${range.end}` : `${range.start}+`) : "",
    founded_year: typeof item?.foundedOn?.year === "number" ? item.foundedOn.year : null,
    city: hq?.parsed?.city || hq?.city || "",
    country: hq?.parsed?.countryFull || hq?.parsed?.country || hq?.country || "",
    description: typeof item?.description === "string" ? item.description.trim().slice(0, 2000) : "",
  } as Record<string, any>;
}
const FILL_FIELDS = ["website", "industry", "size_band", "founded_year", "city", "country", "description"];

// Fill-blanks patch for an agency from one LinkedIn company result. Records which
// LinkedIn company it matched and exactly which fields it filled, so a wrong match
// can be undone cleanly from the review page.
function buildPatch(agency: any, item: any, status: string, knownUrl: string) {
  const now = new Date().toISOString();
  const d = derive(item, knownUrl);
  const patch: Record<string, unknown> = { linkedin_enriched_at: now, linkedin_enrich_status: status };
  const filled: string[] = [];
  if (d.linkedin_url && (blank(agency.linkedin_url) || isNumericCompanyUrl(agency.linkedin_url))) {
    patch.linkedin_url = d.linkedin_url;
    if (blank(agency.linkedin_url)) filled.push("linkedin_url");
  }
  for (const k of FILL_FIELDS) {
    const v = d[k];
    if (v !== "" && v !== null && v !== undefined && blank(agency[k])) { patch[k] = v; filled.push(k); }
  }
  if (filled.includes("website") && blank(agency.domain)) filled.push("domain"); // set by trigger from website
  if (typeof item?.employeeCount === "number") {
    patch.employee_count = item.employeeCount;
    if (agency.employee_count === null || agency.employee_count === undefined) filled.push("employee_count");
  }
  patch.linkedin_enrichment = { linkedin_name: item?.name || null, linkedin_url: d.linkedin_url || null, filled, at: now };
  return patch;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  try {
    const provided = req.headers.get("x-extension-secret") || "";
    if (!provided || !safeEqual(provided, SHARED_SECRET)) return j({ error: "Not authorised" }, 401);

    let body: any;
    try { body = await req.json(); } catch { return j({ error: "Invalid JSON body" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return j({ error: "Body must be a JSON object" }, 400);

    const SB_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const APIFY = Deno.env.get("APIFY_TOKEN") || "";
    if (!SB_URL || !SERVICE) return j({ error: "Server not configured" }, 500);
    const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

    // Normalise the scraped company page URL once.
    if (body.company_linkedin_url !== undefined) {
      body.company_linkedin_url = companyUrl(body.company_linkedin_url) || null;
    }

    const action = (body.action || "insert").toString();

    // ---- helpers that need the service key --------------------------------
    const AGENCY_COLS =
      "id,name,website,domain,linkedin_url,industry,size_band,employee_count,founded_year,description,city,country," +
      "linkedin_enriched_at,linkedin_enrich_status,linkedin_enrichment";

    async function getAgency(id: string) {
      const r = await fetch(`${SB_URL}/rest/v1/agencies?id=eq.${id}&select=${AGENCY_COLS}`, { headers: svc });
      const a = await r.json().catch(() => []);
      return Array.isArray(a) ? a[0] || null : null;
    }

    async function findAgencyByCompanyUrl(url: string) {
      const slug = companySlug(url);
      if (!slug) return null;
      const r = await fetch(
        `${SB_URL}/rest/v1/agencies?select=id,name,linkedin_url&linkedin_url=ilike.*${encodeURIComponent("/company/" + slug)}*&limit=5`,
        { headers: svc },
      );
      const rows = await r.json().catch(() => []);
      if (!Array.isArray(rows)) return null;
      // Exact slug match only (ilike would also match "/company/fold-studio" for "fold").
      return rows.find((a: any) => companySlug(companyUrl(a.linkedin_url)) === slug) || null;
    }

    async function patchAgency(id: string, patch: Record<string, unknown>) {
      await fetch(`${SB_URL}/rest/v1/agencies?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
    }

    // One Apify run of the company actor; returns the dataset items.
    async function runCompanyActor(input: Record<string, unknown>, maxChargeUsd: string, timeoutMs: number) {
      const endpoint = new URL(`https://api.apify.com/v2/acts/${COMPANY_ACTOR}/run-sync-get-dataset-items`);
      endpoint.searchParams.set("maxTotalChargeUsd", maxChargeUsd);
      endpoint.searchParams.set("clean", "true");
      endpoint.searchParams.set("format", "json");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${APIFY}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const items = await res.json().catch(() => []);
      return Array.isArray(items) ? items.filter((i: any) => i && (i.name || i.linkedinUrl)) : [];
    }

    // Look the company up on LinkedIn via Apify and fill blanks on the agency.
    async function enrichAgency(agency: any, knownUrl: string) {
      const stamp = (status: string) => ({ linkedin_enriched_at: new Date().toISOString(), linkedin_enrich_status: status });
      try {
        const input = knownUrl ? { companies: [knownUrl] } : { searches: [searchQuery(agency.name)] };
        const items = await runCompanyActor(input, COMPANY_MAX_CHARGE_USD, 110000);
        const item = items[0];
        if (!item) { await patchAgency(agency.id, stamp("not_found")); return; }
        const fresh = await getAgency(agency.id) || agency;
        const verdict = judge(fresh, item, !!knownUrl);
        if (verdict === "no_match") { await patchAgency(agency.id, stamp("no_match")); return; }
        await patchAgency(agency.id, buildPatch(fresh, item, verdict, knownUrl));
      } catch (e) {
        console.error("enrichAgency", e);
        await patchAgency(agency.id, stamp("error"));
      }
    }

    // Decide whether to look the company up, and kick it off in the background.
    async function maybeEnrich(agencyId: string | null, scrapedUrl: string) {
      if (!agencyId) return { status: "no_company" };
      const agency = await getAgency(agencyId);
      if (!agency) return { status: "no_company" };
      const summary = { agency_id: agency.id, name: agency.name, website: agency.website, linkedin_url: agency.linkedin_url };

      if (!blank(agency.website) && !blank(agency.linkedin_url) && !isNumericCompanyUrl(agency.linkedin_url)) {
        return { status: "on_file", ...summary };
      }
      if (!APIFY) return { status: "not_configured", ...summary };

      const knownUrl = scrapedUrl || companyUrl(agency.linkedin_url);
      if (agency.linkedin_enrichment?.rejected && !scrapedUrl) {
        return { status: "tried", last_result: "rejected", ...summary };
      }
      const lastTry = agency.linkedin_enriched_at ? new Date(agency.linkedin_enriched_at).getTime() : 0;
      const recent = lastTry && Date.now() - lastTry < RETRY_AFTER_DAYS * 86400000;
      // Skip a repeat paid lookup unless we now have a page URL we didn't have before.
      const newInfo = !!scrapedUrl && blank(agency.linkedin_url);
      if (recent && !newInfo) return { status: "tried", last_result: agency.linkedin_enrich_status, ...summary };

      const job = enrichAgency(agency, knownUrl);
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job);
      else await job;
      return { status: "looking_up", via: knownUrl ? "linkedin_url" : "name_search", ...summary };
    }

    // ---- BACKFILL -------------------------------------------------------------
    // Claims up to `batch_size` agencies still missing a website / LinkedIn page
    // (atomically, so parallel callers never overlap), resolves them in ONE actor
    // run, and fills blanks. Call repeatedly until { done: true }.
    if (action === "backfill") {
      if (!APIFY) return j({ error: "APIFY_TOKEN is not configured." }, 503);
      const size = Math.min(50, Math.max(1, Number(body.batch_size || 25)));
      const cr = await fetch(`${SB_URL}/rest/v1/rpc/claim_agencies_for_linkedin_enrichment`, {
        method: "POST",
        headers: { ...svc, "Content-Type": "application/json" },
        body: JSON.stringify({ batch_size: size }),
      });
      const claimed = await cr.json().catch(() => []);
      if (!cr.ok || !Array.isArray(claimed)) return j({ error: "Could not claim a batch", detail: claimed }, 500);
      if (!claimed.length) return j({ done: true, claimed: 0 });

      const viaUrl = claimed.filter((a: any) => companyUrl(a.linkedin_url));
      const viaName = claimed.filter((a: any) => !companyUrl(a.linkedin_url));
      const input: Record<string, unknown> = {};
      if (viaUrl.length) input.companies = viaUrl.map((a: any) => companyUrl(a.linkedin_url));
      if (viaName.length) input.searches = [...new Set(viaName.map((a: any) => searchQuery(a.name)))];

      const counts: Record<string, number> = { ok: 0, matched_by_name: 0, no_match: 0, not_found: 0, error: 0 };
      const stampAll = async (status: string) => {
        await Promise.all(claimed.map((a: any) => patchAgency(a.id, { linkedin_enriched_at: new Date().toISOString(), linkedin_enrich_status: status })));
        counts[status] += claimed.length;
      };

      let items: any[] = [];
      try {
        items = await runCompanyActor(input, (claimed.length * 0.004 + 0.05).toFixed(2), 140000);
      } catch (e) {
        console.error("backfill actor", e);
        await stampAll("error");
        return j({ done: false, claimed: claimed.length, counts, error: String(e).slice(0, 300) });
      }

      const bySearch = new Map<string, any>();
      const byKey = new Map<string, any>();
      for (const it of items) {
        const q = it?.originalQuery?.search;
        if (q && !bySearch.has(String(q))) bySearch.set(String(q), it);
        if (it?.id) byKey.set(String(it.id).toLowerCase(), it);
        if (it?.universalName) byKey.set(String(it.universalName).toLowerCase(), it);
        const s = companySlug(companyUrl(it?.linkedinUrl));
        if (s) byKey.set(s, it);
      }

      const samples: any[] = [];
      await Promise.all(claimed.map(async (a: any) => {
        const known = companyUrl(a.linkedin_url);
        const item = known ? byKey.get(companySlug(known)) : bySearch.get(searchQuery(a.name));
        let status: string;
        if (!item) status = "not_found";
        else status = judge(a, item, !!known);
        if (!item || status === "no_match") {
          await patchAgency(a.id, { linkedin_enriched_at: new Date().toISOString(), linkedin_enrich_status: status });
        } else {
          const patch = buildPatch(a, item, status, known);
          await patchAgency(a.id, patch);
          if (samples.length < 5) samples.push({ agency: a.name, found: item.name, status, website: patch.website ?? a.website ?? null });
        }
        counts[status] = (counts[status] || 0) + 1;
      }));

      return j({ done: false, claimed: claimed.length, actor_items: items.length, counts, samples });
    }

    // ---- REVIEW REFETCH ------------------------------------------------------
    // Name-only matches made before tracking existed have no record of what they
    // filled. Re-read their LinkedIn page (by the URL we stored) and record the matched
    // company name plus the fields whose values came from it. Writes nothing else.
    if (action === "review_refetch") {
      if (!APIFY) return j({ error: "APIFY_TOKEN is not configured." }, 503);
      const r = await fetch(
        `${SB_URL}/rest/v1/agencies?select=${AGENCY_COLS}&linkedin_enrich_status=eq.matched_by_name&linkedin_enrichment=is.null&limit=50`,
        { headers: svc },
      );
      const rows = await r.json().catch(() => []);
      if (!Array.isArray(rows) || !rows.length) return j({ done: true, updated: 0 });
      const urls = [...new Set(rows.map((a: any) => companyUrl(a.linkedin_url)).filter(Boolean))];
      const items = urls.length ? await runCompanyActor({ companies: urls }, (urls.length * 0.004 + 0.05).toFixed(2), 140000) : [];
      const byKey = new Map<string, any>();
      for (const it of items) {
        if (it?.id) byKey.set(String(it.id).toLowerCase(), it);
        if (it?.universalName) byKey.set(String(it.universalName).toLowerCase(), it);
        const sl = companySlug(companyUrl(it?.linkedinUrl));
        if (sl) byKey.set(sl, it);
      }
      const same = (k: string, a: any, b: any) =>
        k === "website" ? (!!domainOf(a) && domainOf(a) === domainOf(b))
          : (a !== null && a !== undefined && b !== null && b !== "" && String(a).trim() === String(b).trim());
      await Promise.all(rows.map(async (a: any) => {
        const url = companyUrl(a.linkedin_url);
        const item = url ? byKey.get(companySlug(url)) : null;
        const filled = ["linkedin_url"]; // name-only matches only happen when no page was on file
        if (item) {
          const d = derive(item, url);
          for (const k of FILL_FIELDS) if (same(k, a[k], d[k])) filled.push(k);
          if (filled.includes("website") && a.domain && a.domain === domainOf(a.website)) filled.push("domain");
          if (a.employee_count !== null && a.employee_count === item.employeeCount) filled.push("employee_count");
        }
        await patchAgency(a.id, {
          linkedin_enrichment: { linkedin_name: item?.name || null, linkedin_url: url || null, filled, at: a.linkedin_enriched_at, reconstructed: true },
        });
      }));
      return j({ done: false, updated: rows.length, matched: items.length });
    }

    // ---- COMPANY STATUS ------------------------------------------------------
    if (action === "company_status") {
      const id = (body.agency_id || "").toString();
      if (!UUID_RE.test(id)) return j({ error: "Missing or invalid agency_id" }, 422);
      const a = await getAgency(id);
      if (!a) return j({ error: "Agency not found" }, 404);
      return j({ agency: a });
    }

    // ---- CATEGORIES --------------------------------------------------------
    if (action === "categories") {
      const counts = new Map<string, { label: string; n: number }>();
      const PAGE = 1000;
      for (let from = 0; from < 20000; from += PAGE) {
        const res = await fetch(
          `${SB_URL}/rest/v1/contacts?select=category&category=not.is.null`,
          { headers: { ...svc, Range: `${from}-${from + PAGE - 1}`, "Range-Unit": "items" } },
        );
        const rows = await res.json().catch(() => []);
        if (!res.ok || !Array.isArray(rows)) break;
        for (const r of rows) {
          const label = (r.category ?? "").toString().trim();
          if (!label) continue;
          const key = label.toLowerCase();
          const cur = counts.get(key);
          if (cur) cur.n++; else counts.set(key, { label, n: 1 });
        }
        if (rows.length < PAGE) break;
      }
      const categories = [...counts.values()]
        .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
        .map((c) => ({ name: c.label, count: c.n }));
      return j({ categories });
    }

    // ---- MATCH -------------------------------------------------------------
    if (action === "match") {
      const wantName = norm(body.name);
      if (!wantName) return j({ matches: [] });
      const toks = tokens(body.name);
      const last = toks[toks.length - 1] || wantName;
      const url =
        `${SB_URL}/rest/v1/contacts` +
        `?select=id,name,company,title,linkedin_url,email,category,status,created_at` +
        `&name=ilike.*${encodeURIComponent(last)}*&limit=50`;
      const res = await fetch(url, { headers: svc });
      const rows = await res.json().catch(() => []);
      if (!res.ok || !Array.isArray(rows)) return j({ matches: [] });

      const wantCompany = normCompany(body.company);
      const scored: any[] = [];
      for (const r of rows) {
        const rn = norm(r.name);
        const rToks = tokens(r.name);
        const exact = rn === wantName;
        const firstLast =
          toks.length >= 2 && rToks.length >= 2 &&
          rToks[0] === toks[0] && rToks[rToks.length - 1] === toks[toks.length - 1];
        const contains = rn && wantName && (rn.includes(wantName) || wantName.includes(rn));
        if (!(exact || firstLast || contains)) continue;
        const rc = normCompany(r.company);
        const companyMatch = !!(wantCompany && rc && (rc === wantCompany || rc.includes(wantCompany) || wantCompany.includes(rc)));
        let score = exact ? 3 : firstLast ? 2 : 1;
        if (companyMatch) score += 2;
        scored.push({
          id: r.id, name: r.name, company: r.company, title: r.title,
          linkedin_url: r.linkedin_url, email: r.email, category: r.category,
          status: r.status, created_at: r.created_at,
          companyMatch, score,
        });
      }
      scored.sort((a, b) => b.score - a.score || (a.name || "").localeCompare(b.name || ""));
      return j({ matches: scored.slice(0, 8) });
    }

    const scrapedCompanyUrl = (body.company_linkedin_url || "").toString();

    // ---- UPDATE ------------------------------------------------------------
    if (action === "update") {
      const id = (body.id || "").toString();
      if (!UUID_RE.test(id)) return j({ error: "Missing or invalid id for update" }, 422);
      const exRes = await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${id}&select=*`, { headers: svc });
      const exArr = await exRes.json().catch(() => []);
      const existing = Array.isArray(exArr) ? exArr[0] : null;
      if (!existing) return j({ error: "That prospect no longer exists" }, 404);

      // If the contact has no company yet and we already know this company page,
      // use the agency's own name so the trigger links to the existing record.
      if (scrapedCompanyUrl && blank(existing.company)) {
        const known = await findAgencyByCompanyUrl(scrapedCompanyUrl);
        if (known) body.company = known.name;
      }

      const patch: Record<string, unknown> = {};
      const filled: string[] = [];

      const incomingLink = typeof body.linkedin_url === "string" ? body.linkedin_url.trim() : "";
      const curLink = (existing.linkedin_url ?? "").toString().trim();
      let linkedin: "none" | "attached" | "updated" | "same" = "none";
      if (incomingLink) {
        if (!curLink) { patch.linkedin_url = incomingLink; linkedin = "attached"; }
        else if (curLink !== incomingLink) { patch.linkedin_url = incomingLink; linkedin = "updated"; }
        else { linkedin = "same"; }
      }

      const incomingCat = typeof body.category === "string" ? body.category.trim() : "";
      const curCat = (existing.category ?? "").toString().trim();
      let category: "none" | "set" | "changed" | "same" = "none";
      let previousCategory: string | null = null;
      if (incomingCat) {
        if (!curCat) { patch.category = incomingCat; category = "set"; }
        else if (curCat.toLowerCase() !== incomingCat.toLowerCase()) {
          patch.category = incomingCat; category = "changed"; previousCategory = curCat;
        } else { category = "same"; }
      }

      for (const k of ALLOWED) {
        if (k === "linkedin_url" || k === "category") continue;
        let v = body[k];
        if (v === undefined || v === null) continue;
        if (typeof v === "string") { v = v.trim(); if (v === "") continue; }
        if (blank(existing[k])) { patch[k] = v; if (k !== "company_linkedin_url") filled.push(k); }
      }

      let contact = existing;
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        const upRes = await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${id}`, {
          method: "PATCH",
          headers: { ...svc, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify(patch),
        });
        const upData = await upRes.json().catch(() => null);
        if (!upRes.ok) {
          const msg = (upData && (upData.message || upData.error || upData.hint)) || `Update failed (${upRes.status})`;
          return j({ error: msg }, upRes.status === 401 || upRes.status === 403 ? 500 : upRes.status);
        }
        contact = Array.isArray(upData) ? upData[0] : upData;
      }

      const company = await maybeEnrich(contact?.agency_id || null, scrapedCompanyUrl);
      return j({
        ok: true, unchanged: Object.keys(patch).length === 0,
        linkedin, category, previousCategory, filled, contact, company,
      });
    }

    // ---- INSERT (default) --------------------------------------------------
    if (scrapedCompanyUrl) {
      const known = await findAgencyByCompanyUrl(scrapedCompanyUrl);
      if (known) body.company = known.name; // link to the agency we already have
    }

    const row: Record<string, unknown> = {};
    for (const k of ALLOWED) {
      let v = body[k];
      if (v === undefined || v === null) continue;
      if (typeof v === "string") { v = v.trim(); if (v === "") continue; }
      row[k] = v;
    }
    if (!row.name || typeof row.name !== "string") return j({ error: "A prospect name is required" }, 422);

    const res = await fetch(`${SB_URL}/rest/v1/contacts`, {
      method: "POST",
      headers: { ...svc, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && (data.message || data.error || data.hint)) || `Insert failed (${res.status})`;
      return j({ error: msg }, res.status === 401 || res.status === 403 ? 500 : res.status);
    }
    const inserted = Array.isArray(data) ? data[0] : data;
    const company = await maybeEnrich(inserted?.agency_id || null, scrapedCompanyUrl);
    return j({ ok: true, contact: inserted, company }, 201);
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
});
