// suggest-reply — drafts a date-aware email reply. Uses OpenAI (preferred) or Anthropic.
const OWNER = "corisleachman@googlemail.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const j = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const SB_URL = Deno.env.get("SUPABASE_URL");
    const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    const uRes = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON!, Authorization: `Bearer ${token}` } });
    const user = await uRes.json().catch(() => ({}));
    if (!uRes.ok || ((user?.email || "").toLowerCase() !== OWNER)) return j({ error: "Not authorised" }, 401);

    const { conversation = [], contactName = "", company = "", today = "", angle = "" } = await req.json();
    const todayStr = today || new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const convoText = conversation
      .map((m: any) => `[${m.date || "date unknown"}] ${m.who}: ${m.text}`)
      .join("\n\n").slice(0, 14000);

    const system = `You draft the next email reply that Coris Leachman sends from his own inbox. Coris is a fractional new business & marketing consultant for creative agencies.

Read the WHOLE thread and reason about TIMING before writing:
- Each message is prefixed with its date in [brackets]. Today's date is provided.
- Work out how much time has passed since the last message and reflect it naturally. If it's been weeks or months, acknowledge the gap lightly (e.g. "it's been a while") rather than replying as if the last message just arrived.
- Never treat stale, time-bound context as current. For example, an old "I'm away skiing this week" or out-of-office note from months ago must NOT be treated as if the person is away now.
- If Coris already sent a follow-up that went unanswered, the new message should be a light, low-pressure nudge — not a repeat of the same ask.

Write a warm, concise, professional reply that fits where the relationship actually is right now, and end with a clear, low-friction next step. Sign off as "Coris". Return ONLY the email body — no subject line, no preamble, no surrounding quotes.`;

    let userMsg = `Today is ${todayStr}.

Email thread so far (each line prefixed with its date, oldest first):

${convoText}

Write Coris's next reply to ${contactName || "the contact"}${company ? ` at ${company}` : ""}, taking full account of the dates above and how much time has passed.`;

    const angleMap: Record<string,string> = {
      warmer: "Rewrite it noticeably warmer and more personable, without gushing.",
      shorter: "Rewrite it significantly shorter and more to the point — just a few sentences.",
      direct: "Rewrite it more direct and confident; get to the ask quickly with less hedging.",
      formal: "Rewrite it a little more formal and polished.",
    };
    if (angle) userMsg += `\n\nStyle adjustment for this version: ${angleMap[angle] || `Adjust the tone/style to be: ${angle}.`}`;

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (openaiKey) {
      const oRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
          max_tokens: 800,
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
        }),
      });
      const d = await oRes.json().catch(() => ({}));
      if (!oRes.ok) return j({ error: d?.error?.message || `OpenAI error ${oRes.status}` }, 502);
      return j({ reply: d?.choices?.[0]?.message?.content || "" });
    }
    if (anthropicKey) {
      const aRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5",
          max_tokens: 800, system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      const d = await aRes.json().catch(() => ({}));
      if (!aRes.ok) return j({ error: d?.error?.message || `AI error ${aRes.status}` }, 502);
      return j({ reply: d?.content?.[0]?.text || "" });
    }
    return j({ error: "Not configured — add OPENAI_API_KEY in Supabase secrets." }, 400);
  } catch (e) { return j({ error: String(e) }, 500); }
});
