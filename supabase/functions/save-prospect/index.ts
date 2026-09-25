// save-prospect — single privileged writer for public.contacts (RLS: owner-only).
// Gated by a shared secret in the x-extension-secret header. Supports four actions:
//   categories — list the distinct categories already in use (for the popup dropdown)
//   match      — find possible existing contacts by name (company boosts confidence)
//   update     — always (re)attach linkedin_url; apply an explicitly chosen category;
//                fill other blank fields; never overwrite the rest
//   insert     — create a new contact (default when no action is given)

const SHARED_SECRET = Deno.env.get("EXTENSION_SHARED_SECRET") ?? "";

// Columns a capture/update may set. Everything else is left to the database.
const ALLOWED = [
  "name", "email", "company", "title", "category", "source",
  "status", "linkedin_url", "notes", "website", "follow_up_at", "research_summary",
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
    if (!SB_URL || !SERVICE) return j({ error: "Server not configured" }, 500);
    const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

    const action = (body.action || "insert").toString();

    // ---- CATEGORIES --------------------------------------------------------
    // Distinct categories in use, most-used first (ties alphabetical).
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

    // ---- UPDATE ------------------------------------------------------------
    // linkedin_url is always (re)attached; a chosen category is applied;
    // all other fields fill blanks only.
    if (action === "update") {
      const id = (body.id || "").toString();
      if (!UUID_RE.test(id)) return j({ error: "Missing or invalid id for update" }, 422);
      const exRes = await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${id}&select=*`, { headers: svc });
      const exArr = await exRes.json().catch(() => []);
      const existing = Array.isArray(exArr) ? exArr[0] : null;
      if (!existing) return j({ error: "That prospect no longer exists" }, 404);

      const patch: Record<string, unknown> = {};
      const filled: string[] = [];

      // linkedin_url: authoritative from the live profile — always write it.
      const incomingLink = typeof body.linkedin_url === "string" ? body.linkedin_url.trim() : "";
      const curLink = (existing.linkedin_url ?? "").toString().trim();
      let linkedin: "none" | "attached" | "updated" | "same" = "none";
      if (incomingLink) {
        if (!curLink) { patch.linkedin_url = incomingLink; linkedin = "attached"; }
        else if (curLink !== incomingLink) { patch.linkedin_url = incomingLink; linkedin = "updated"; }
        else { linkedin = "same"; }
      }

      // category: an explicit pick in the popup — apply it.
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

      // Everything else: fill only if currently blank; never overwrite.
      for (const k of ALLOWED) {
        if (k === "linkedin_url" || k === "category") continue;
        let v = body[k];
        if (v === undefined || v === null) continue;
        if (typeof v === "string") { v = v.trim(); if (v === "") continue; }
        const cur = existing[k];
        const curEmpty = cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === "");
        if (curEmpty) { patch[k] = v; filled.push(k); }
      }

      if (Object.keys(patch).length === 0) {
        return j({ ok: true, unchanged: true, linkedin, category, filled: [], contact: existing });
      }

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
      return j({
        ok: true, linkedin, category, previousCategory, filled,
        contact: Array.isArray(upData) ? upData[0] : upData,
      });
    }

    // ---- INSERT (default) --------------------------------------------------
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
    return j({ ok: true, contact: inserted }, 201);
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
});
