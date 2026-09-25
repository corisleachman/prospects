// notify-enquiry — emails Coris via Resend when a new enquiry is inserted.
// No key in the code: RESEND_API_KEY is read from a Supabase secret at runtime.
const TO = "corisleachman@googlemail.com";
function esc(s: unknown){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
Deno.serve(async (req) => {
  const j = (b: unknown, s=200) => new Response(JSON.stringify(b), {status:s, headers:{"Content-Type":"application/json"}});
  if (req.method !== "POST") return j({ ok:true });
  try {
    const secret = Deno.env.get("WEBHOOK_SECRET");
    if (secret && req.headers.get("x-webhook-secret") !== secret) return j({ error:"forbidden" }, 401);
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return j({ error:"RESEND_API_KEY not set yet" }, 400);
    const from = Deno.env.get("RESEND_FROM") || "Prospects Guide <onboarding@resend.dev>";
    const payload = await req.json().catch(()=> ({}));
    const row = payload.record || payload || {};
    const name = row.name || "(no name)", email = row.email || "", company = row.company || "", message = row.message || "";
    const html = `<h2 style="font-family:sans-serif">New enquiry from your build guide</h2>
      <p style="font-family:sans-serif"><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email)}<br><b>Company:</b> ${esc(company||"—")}</p>
      <p style="font-family:sans-serif"><b>Message:</b><br>${esc(message).replace(/\n/g,"<br>")}</p>`;
    const rRes = await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{ Authorization:`Bearer ${key}`, "Content-Type":"application/json" },
      body: JSON.stringify({ from, to:[TO], subject:`New enquiry — ${name}`, html, reply_to: email || undefined }),
    });
    const d = await rRes.json().catch(()=> ({}));
    if (!rRes.ok) return j({ error: d?.message || `Resend ${rRes.status}` }, 502);
    return j({ ok:true, id:d.id });
  } catch(e){ return j({ error:String(e) }, 500); }
});
