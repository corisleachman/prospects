import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const OWNER = "corisleachman@googlemail.com";
const cors = {
  "Access-Control-Allow-Origin": "https://corisleachman.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });

function extractJson(text: string): any {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0 || end < start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const SB_URL = Deno.env.get("SUPABASE_URL");
    const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    if (!token) return j({ error: "Authentication required" }, 401);
    const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON!, Authorization: `Bearer ${token}` } });
    const user = await uRes.json().catch(() => ({}));
    if (!uRes.ok || ((user?.email || "").toLowerCase() !== OWNER)) return j({ error: "Not authorised" }, 401);

    const { company = "", city = "", country = "", website = "" } = await req.json().catch(() => ({}));
    if (!company) return j({ error: "company is required" }, 400);
    const loc = [city, country].filter(Boolean).join(", ");

    const prompt = `You are enriching a company record in a B2B prospecting CRM for a consultant who works with creative, advertising and design agencies.

Company: "${company}"${loc ? `\nLocation: ${loc}` : ""}${website ? `\nKnown website: ${website}` : ""}

Use web search to identify THIS specific company (disambiguate carefully if the name is common). Then return ONLY a JSON object, no markdown, with these keys:
- "website": the official homepage URL (https://…)
- "domain": the bare domain only, e.g. "example.com"
- "linkedin_url": the company's LinkedIn COMPANY page URL (must look like https://www.linkedin.com/company/…). Do NOT return a personal /in/ profile.
- "industry": a short industry label
- "size": approximate employee range, e.g. "11-50"
- "confidence": "high" | "medium" | "low"
- "notes": one short sentence on how you disambiguated, or "" if none

Rules: Only include a value you actually verified via search. If you cannot confidently verify a field, set it to an empty string "". Never invent or guess a URL. Return only the JSON object.`;

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (anthropicKey) {
      const aRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("ENRICH_MODEL") || "claude-haiku-4-5",
          max_tokens: 1024,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const d = await aRes.json().catch(() => ({}));
      if (!aRes.ok) return j({ error: d?.error?.message || `AI error ${aRes.status}` }, 502);
      const text = (Array.isArray(d?.content) ? d.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
      const suggestion = extractJson(text);
      if (!suggestion) return j({ error: "Could not parse AI response", raw: text.slice(0, 400) }, 502);
      return j({ suggestion, model: Deno.env.get("ENRICH_MODEL") || "claude-haiku-4-5" });
    }
    if (openaiKey) {
      const oRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini", tools: [{ type: "web_search_preview" }], input: prompt }),
      });
      const d = await oRes.json().catch(() => ({}));
      if (!oRes.ok) return j({ error: d?.error?.message || `OpenAI error ${oRes.status}` }, 502);
      let text = d?.output_text || "";
      if (!text && Array.isArray(d?.output)) {
        text = d.output.flatMap((o: any) => Array.isArray(o?.content) ? o.content : []).filter((c: any) => typeof c?.text === "string").map((c: any) => c.text).join("\n");
      }
      const suggestion = extractJson(text);
      if (!suggestion) return j({ error: "Could not parse AI response", raw: String(text).slice(0, 400) }, 502);
      return j({ suggestion, model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini" });
    }
    return j({ error: "No AI key configured (need ANTHROPIC_API_KEY or OPENAI_API_KEY)" }, 400);
  } catch (e) { return j({ error: String(e) }, 500); }
});
