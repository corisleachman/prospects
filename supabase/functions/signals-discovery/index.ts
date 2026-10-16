declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import {
  makePlan,
  nextCall,
  absorb,
  receiptCost,
  defaultKeywords,
  type Plan,
  type Result,
  type Company,
} from "./core.ts";
const base = Deno.env.get("SUPABASE_URL")!,
  key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(base, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "https://prospect-signals.vercel.app",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await svc.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
async function pricing() {
  const endpoints = [
    "blitzapi.companies.search",
    "harvestapi.linkedin.leads.search",
  ];
  const [company, people, xml] = await Promise.all([
    ...endpoints.map(async (ep) => {
      const r = await fetch("https://treg.to/catalog/endpoints/" + ep, {
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error("Provider catalog is unavailable");
      return r.json();
    }),
    fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
      signal: AbortSignal.timeout(15000),
    }).then((r) => {
      if (!r.ok) throw new Error("Exchange-rate source unavailable");
      return r.text();
    }),
  ]);
  const usd = Number(xml.match(/currency="USD"\s+rate="([^"]+)"/)?.[1]),
    gbp = Number(xml.match(/currency="GBP"\s+rate="([^"]+)"/)?.[1]),
    date = xml.match(/time="(\d{4}-\d{2}-\d{2})"/)?.[1];
  if (
    !date ||
    Date.now() - Date.parse(date) > 7 * 86400000 ||
    Date.parse(date) > Date.now() + 86400000 ||
    !usd ||
    !gbp
  )
    throw new Error("A current ECB USD/GBP rate is required");
  if (
    company.endpoint?.cost?.type !== "per_result" ||
    people.endpoint?.cost?.type !== "per_call" ||
    company.endpoint.platform_blocked ||
    people.endpoint.platform_blocked
  )
    throw new Error(
      "Provider pricing changed. Review the adapter before using it.",
    );
  return {
    companyRate: Number(company.endpoint.cost.usd),
    peopleRate: Number(people.endpoint.cost.usd),
    fx: gbp / usd,
    date,
  };
}
async function profile(id: string) {
  const { data, error } = await svc
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("Profile unavailable");
  const { data: w } = await svc
    .from("workspaces")
    .select("is_signals_client,status")
    .eq("id", data.workspace_id)
    .maybeSingle();
  if (!w?.is_signals_client || w.status === "archived")
    throw new Error("Client unavailable");
  return data;
}
async function quote(
  profileId: string,
  keywords: string[] | undefined,
  kind: "find" | "refresh",
  actor: string | null,
  requestedLimit?: number,
) {
  const p = await profile(profileId),
    rates = await pricing();
  let approved: Company[] = [];
  if (kind === "refresh") {
    const { data, error } = await svc
      .from("campaign_prospects")
      .select("companies!campaign_prospects_company_id_fkey(*)")
      .eq("campaign_id", p.id)
      .eq("workspace_id", p.workspace_id)
      .is("person_id", null)
      .not("company_id", "is", null)
      .eq("group_type", "watchlist");
    if (error) throw new Error("Watch list unavailable");
    approved = (data ?? []).map((x: any) => ({
      ...x.companies,
      key: x.companies.discovery_key,
      source: "watched",
      provider_ids: x.companies.provider_ids ?? {},
    }));
  }
  if (
    requestedLimit !== undefined &&
    (!Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 200)
  )
    throw new Error("Choose a search size between 1 and 200.");
  const { plan, result } = makePlan(
    requestedLimit === undefined
      ? p
      : { ...p, watch_list_size: Math.min(p.watch_list_size, requestedLimit) },
    keywords ?? defaultKeywords(p),
    rates.fx,
    rates.date,
    rates.companyRate,
    rates.peopleRate,
    kind,
    approved,
  );
  const { data, error } = await svc
    .from("discovery_previews")
    .insert({
      workspace_id: p.workspace_id,
      profile_id: p.id,
      profile_revision: p.setup_revision,
      kind,
      plan,
      result,
      estimated_gbp: plan.estimate,
      created_by: actor,
    })
    .select("id,estimated_gbp,plan")
    .single();
  if (error) throw new Error("Quote could not be saved");
  return data;
}
async function alerts(workspace: string) {
  try {
    const rows = await rpc("pending_signals_budget_alerts", {
      p_workspace: workspace,
    });
    const config = await rpc("signals_discovery_mail_config", {
      p_settings: null,
    });
    if (!config?.key || !config?.from) return;
    for (const a of rows ?? []) {
      let sent = false;
      try {
        if (!config?.key || !config?.from)
          throw new Error("Mail configuration missing");
        const text = `${a.client_name} has reached ${a.threshold}% of its budget.${a.threshold === 100 ? " Collection and AI are paused." : ""} Open Clients: ${config.origin}/clients`;
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + config.key,
            "Content-Type": "application/json",
            "Idempotency-Key": "signals-budget-" + a.id,
          },
          body: JSON.stringify({
            from: config.from,
            to: a.recipients,
            subject: `${a.is_test ? "Test budget: " : ""}${a.client_name} has used ${a.threshold}% of its budget`,
            text,
          }),
          signal: AbortSignal.timeout(15000),
        });
        sent = r.ok;
      } catch {}
      await rpc("mark_signals_budget_alert", { p_id: a.id, p_sent: sent });
    }
  } catch {
    /* Pending outbox entries remain visible for the administrator to retry. */
  }
}
async function process(id: string) {
  const started = Date.now();
  while (Date.now() - started < 105000) {
    const { data: p, error } = await svc
      .from("discovery_previews")
      .select("*")
      .eq("id", id)
      .single();
    if (error || p.status !== "queued") return;
    const plan = p.plan as Plan,
      result = p.result as Result,
      call = nextCall(plan, result);
    if (!call) return;
    const cap = Math.ceil(call.usd * plan.fx * 1e6) / 1e6;
    let claimed;
    try {
      claimed = await rpc("claim_signals_discovery_step", {
        p_id: id,
        p_cap: cap,
      });
    } catch (e) {
      await svc
        .from("discovery_previews")
        .update({
          status: result.companies.length ? "partial" : "failed",
          error_summary: (e as Error).message,
        })
        .eq("id", id);
      await rpc("cancel_signals_cost", { p_reservation: p.reservation_id });
      await svc
        .from("search_runs")
        .update({
          status: "partial",
          completed_at: new Date().toISOString(),
          error_summary: (e as Error).message,
        })
        .eq("id", p.run_id);
      return;
    }
    if (!claimed) return;
    let cost = { usd: call.usd, basis: "estimated" },
      failure: string | null = null,
      data: any = null,
      httpStatus = 0,
      receipt = "";
    try {
      const url = new URL("https://treg.to/call/" + call.endpoint);
      for (const [k, v] of Object.entries(call.query ?? {}))
        url.searchParams.set(k, v);
      const token = Deno.env.get("TREG_TOKEN");
      if (!token) throw new Error("TREG_TOKEN is not configured");
      const response = await fetch(url, {
        method: call.method,
        headers: {
          "X-Treg-Token": token,
          "X-Treg-Route-Max-Cost": String(call.usd),
          "Idempotency-Key": claimed.request_key,
          "Content-Type": "application/json",
        },
        ...(call.body ? { body: JSON.stringify(call.body) } : {}),
        signal: AbortSignal.timeout(65000),
        redirect: "error",
      });
      httpStatus = response.status;
      receipt = response.headers.get("X-Treg-Call-Id") ?? "";
      cost = receiptCost(response.headers, call.usd);
      data = await response.json();
      if (!response.ok)
        throw new Error("treg returned HTTP " + response.status);
      absorb(plan, result, call, data);
    } catch (e) {
      failure = (e as Error).message;
    }
    if (!httpStatus && failure?.includes("not configured"))
      cost = { usd: 0, basis: "reported" };
    const done = failure !== null || nextCall(plan, result) === null;
    await rpc("finish_signals_discovery_step", {
      p_id: id,
      p_reservation: claimed.reservation,
      p_cost: Math.ceil(cost.usd * plan.fx * 1e6) / 1e6,
      p_details: {
        stage: "find",
        provider: "treg",
        source_key: call.endpoint,
        cost_basis: cost.basis,
        outcome: failure ? "failed" : "success",
        units: {
          provider_cost_usd: cost.usd,
          usd_gbp: plan.fx,
          fx_date: plan.fx_date,
          http_status: httpStatus,
          treg_call_id: receipt,
          returned:
            call.kind === "people"
              ? (data?.elements?.length ?? 0)
              : (data?.results?.length ?? 0),
        },
      },
      p_result: result,
      p_plan: plan,
      p_done: done,
      p_error: failure,
    });
    if (done) {
      if (plan.kind === "refresh" && !failure)
        await rpc("save_signals_watchlist", {
          p_id: id,
          p_company_keys: result.companies.map((c) => c.key),
          p_person_keys: result.people
            .map((x) => x.key)
            .filter((k) => !(plan.profile.watch_exclusions ?? []).includes(k)),
        });
      await alerts(p.workspace_id);
      return;
    }
  }
}
async function work() {
  await rpc("recover_signals_discovery", {});
  const { data: pendingAlerts } = await svc
    .from("budget_alerts")
    .select("workspace_id")
    .neq("status", "sent")
    .limit(1);
  if (pendingAlerts?.length) await alerts(pendingAlerts[0].workspace_id);
  const { data: jobs } = await svc
    .from("discovery_previews")
    .select("id")
    .eq("status", "queued")
    .order("created_at")
    .limit(1);
  if (jobs?.length) {
    await process(jobs[0].id);
    return;
  }
  const { data: due } = await svc
    .from("campaigns")
    .select("id,workspace_id")
    .eq("watch_refresh_enabled", true)
    .lte("next_watch_refresh_at", new Date().toISOString())
    .neq("status", "archived")
    .order("next_watch_refresh_at")
    .limit(1);
  if (!due?.length) return;
  const p = due[0];
  // Claim the due slot before quoting; concurrent invocations cannot start it twice.
  const { data: claimed } = await svc
    .from("campaigns")
    .update({
      next_watch_refresh_at: new Date(Date.now() + 86400000).toISOString(),
    })
    .eq("id", p.id)
    .lte("next_watch_refresh_at", new Date().toISOString())
    .select("id");
  if (!claimed?.length) return;
  try {
    const q = await quote(p.id, undefined, "refresh", null);
    await rpc("start_signals_discovery", { p_id: q.id });
    await process(q.id);
  } catch (e) {
    await svc.from("discovery_refresh_log").insert({
      workspace_id: p.workspace_id,
      profile_id: p.id,
      status: "skipped",
      reason: (e as Error).message,
    });
  }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const cronToken = req.headers.get("X-Signals-Cron-Token");
    if (cronToken) {
      const valid = await rpc("verify_signals_discovery_cron", {
        p_token: cronToken,
      });
      if (!valid) return reply({ error: "Not allowed" }, 401);
      EdgeRuntime.waitUntil(work());
      return reply({ queued: true });
    }
    const jwt = (req.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    const { data: u, error } = await svc.auth.getUser(jwt);
    if (error || !u.user) return reply({ error: "Sign in required" }, 401);
    const { data: admin } = await svc
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", u.user.id)
      .eq("active", true)
      .maybeSingle();
    if (!admin) return reply({ error: "Not allowed" }, 403);
    const body = await req.json();
    if (body.action === "health")
      return reply({ token_configured: Boolean(Deno.env.get("TREG_TOKEN")) });
    if (body.action === "estimate")
      return reply(
        await quote(
          body.profile_id,
          body.keywords,
          "find",
          u.user.id,
          body.limit,
        ),
      );
    if (body.action === "start") {
      if (!Deno.env.get("TREG_TOKEN"))
        throw new Error("TREG_TOKEN is not configured");
      await rpc("start_signals_discovery", { p_id: body.id });
      EdgeRuntime.waitUntil(process(body.id));
      return reply({ id: body.id, queued: true });
    }
    if (body.action === "work") {
      await rpc("recover_signals_discovery", {});
      EdgeRuntime.waitUntil(process(body.id));
      return reply({ queued: true });
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (e) {
    return reply({ error: (e as Error).message }, 400);
  }
});
