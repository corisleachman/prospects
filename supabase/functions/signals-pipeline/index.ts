declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
import { createClient } from "@supabase/supabase-js";
import {
  models,
  rewriteRequest,
  validateRewrite,
  request,
  upperCost,
  usageCost,
  parseMessage,
  parseTriage,
  validateJudgment,
  selectPerson,
  titleRank,
  sensitiveEnabled,
  schedule,
  localDate,
  zonedTime,
  type Setup,
  type Rates,
  type Triage,
  type Person,
} from "./core.ts";
import {
  groupEvents,
  hash,
  wholeWord,
  type Item,
} from "../signals-collect/core.ts";
import {
  makePlan,
  nextCall,
  absorb,
  https,
  receiptCost,
  ecbRate,
} from "../signals-discovery/core.ts";
const base = Deno.env.get("SUPABASE_URL")!,
  key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  svc = createClient(base, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "https://prospect-signals.vercel.app",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const reply = (v: unknown, s = 200) =>
  new Response(JSON.stringify(v), { status: s, headers });
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await svc.rpc(name, args);
  if (error) throw Error(error.message);
  return data;
}
class ProviderError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function api(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const token = Deno.env.get("ANTHROPIC_API_KEY");
  if (!token) throw Error("Anthropic key is not configured");
  const r = await fetch("https://api.anthropic.com/v1/" + path, {
    method,
    headers: {
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    let error = "Anthropic returned HTTP " + r.status;
    try {
      error = (await r.json()).error?.message ?? error;
    } catch {}
    throw new ProviderError(r.status, error.slice(0, 500));
  }
  return path.endsWith("/results") ? r.text() : r.json();
}
async function collect(body: Record<string, unknown>, jwt = key) {
  const r = await fetch(base + "/functions/v1/signals-collect", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + jwt,
        "Content-Type": "application/json",
        apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    }),
    data = await r.json();
  if (!r.ok || data.error)
    throw Error(data.error ?? data.message ?? "Collection HTTP " + r.status);
  return data;
}
async function register(id: string, fallback?: string) {
  const { data: existing } = await svc
    .from("pipeline_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (existing) return existing;
  const { data: c, error } = await svc
    .from("collection_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw Error("Collection unavailable");
  const setup = (await rpc("signals_pipeline_setup", {
    p_workspace: c.workspace_id,
  })) as Setup;
  const { data: prices, error: priceError } = await svc
    .from("provider_pricing")
    .select("*")
    .eq("workspace_id", c.workspace_id)
    .in("pricing_key", [
      ...Object.values(models)
        .filter((v: any) => v?.model)
        .map((v: any) => "anthropic/" + v.model),
    ]);
  if (priceError) throw Error("Model pricing unavailable");
  const rates: Record<string, any> = {};
  for (const m of [models.stage1.model, models.stage2.model]) {
    const p = prices?.find((p) => p.pricing_key === "anthropic/" + m);
    if (
      !p?.verified_on ||
      Date.parse(p.verified_on) < Date.now() - 30 * 86400000
    )
      throw Error("Review model pricing in Budget settings before judging");
    usageCost({}, p.rates, false);
    rates[m] = { ...p.rates, currency: p.currency };
  }
  let fx = 1,
    fx_date = "";
  if (Object.values(rates).some((r: any) => r.currency === "USD")) {
    const response = await fetch(
      "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw Error("Exchange rate unavailable");
    const v = ecbRate(await response.text());
    fx = v.fx;
    fx_date = v.date;
  }
  const value = {
    id,
    workspace_id: c.workspace_id,
    status: "collecting",
    fingerprint: setup.fingerprint,
    snapshot: { setup, rates, fx, fx_date, kind: c.kind },
    fallback_at: fallback ?? new Date(Date.now() + 15 * 60000).toISOString(),
  };
  const { error: save } = await svc
    .from("pipeline_runs")
    .upsert(value, { onConflict: "id", ignoreDuplicates: true });
  if (save) throw Error("Pipeline could not be created");
  if (c.kind === "test")
    await svc
      .from("workspaces")
      .update({ latest_pipeline_test_id: id })
      .eq("id", c.workspace_id);
  return value;
}
async function prepare(run: any) {
  const { data: source } = await svc
    .from("search_runs")
    .select("status")
    .eq("id", run.id)
    .single();
  if (!source || ["queued", "running"].includes(source.status)) {
    await collect({ action: "work", id: run.id });
    return false;
  }
  const { data: items, error } = await svc
    .from("collection_items")
    .select(
      "*,source_tasks!collection_items_source_task_id_workspace_id_fkey(input)",
    )
    .eq("workspace_id", run.workspace_id)
    .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString())
    .is("drop_reason", null)
    .eq("is_primary", true)
    .not("evidence_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(2001);
  if (error) throw Error("Fresh evidence unavailable");
  if ((items?.length ?? 0) > 2000)
    throw Error(
      "More than 2,000 fresh candidates. Narrow the source window before judging",
    );
  const { data: enabled } = await svc
    .from("workspace_source_settings")
    .select("source_key")
    .eq("workspace_id", run.workspace_id)
    .eq("enabled", true);
  const active = new Set((enabled ?? []).map((s) => s.source_key));
  active.add("extra_sources");
  let considered = 0;
  for (const row of items ?? []) {
    const hours =
      run.snapshot.kind === "test"
        ? Math.min(48, row.source_tasks?.input?.hours ?? 48)
        : (row.source_tasks?.input?.hours ?? 48);
    if (
      !active.has(row.source_key) ||
      !row.item.published_at ||
      Date.parse(row.item.published_at) < Date.now() - hours * 3600000
    )
      continue;
    if (run.snapshot.kind !== "test") {
      const prior = await svc
        .from("pipeline_jobs")
        .select(
          "id,pipeline_runs!pipeline_jobs_run_id_workspace_id_fkey(snapshot)",
        )
        .eq("workspace_id", run.workspace_id)
        .eq("item_id", row.id)
        .eq("stage", "triage")
        .in("status", ["succeeded", "dropped"])
        .neq("run_id", run.id);
      if (prior.error) throw Error("Previous judgments unavailable");
      if (
        prior.data?.some((p: any) => p.pipeline_runs?.snapshot?.kind !== "test")
      )
        continue;
    }
    const { error: save } = await svc.from("pipeline_jobs").upsert(
      {
        workspace_id: run.workspace_id,
        run_id: run.id,
        item_id: row.id,
        stage: "triage",
        input: {
          item: row.item,
          source_key: row.source_key,
          source_task_id: row.source_task_id,
          source_hours: hours,
          optional: row.company_ids.length === 0 && !row.person_id,
        },
      },
      { onConflict: "run_id,item_id,stage", ignoreDuplicates: true },
    );
    if (save) throw Error("Judging tasks could not be saved");
    considered++;
  }
  await svc
    .from("pipeline_runs")
    .update({
      status: "triage",
      summary: { input_count: considered, collection_status: source.status },
    })
    .eq("id", run.id);
  return true;
}
async function settle(
  call: any,
  job: any,
  run: any,
  message: any,
  error: string | null = null,
  canceled = false,
) {
  let value: any = null,
    usage: any = message?.usage ?? (canceled ? {} : null),
    cost = 0,
    status = "failed";
  try {
    if (usage === null) {
      cost = Number(
        (
          await svc
            .from("cost_reservations")
            .select("estimated_cost")
            .eq("id", call.reservation_id)
            .single()
        ).data?.estimated_cost ?? 0,
      );
    } else cost = usageCost(usage, call.rates, call.mode === "batch") * call.fx;
    if (!error) {
      const result = parseMessage(message);
      await svc
        .from("pipeline_ai_calls")
        .update({ model_output: result })
        .eq("id", call.id);
      value =
        job.stage === "triage"
          ? parseTriage(result, run.snapshot.setup, job.input.item)
          : validateJudgment(
              result,
              run.snapshot.setup,
              job.input.item,
              job.input.triage,
              job.input.person,
            );
      status = "succeeded";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Invalid structured result";
  }
  await rpc("settle_signals_ai_call", {
    p_call: call.id,
    p_cost: Math.ceil(cost * 1e6) / 1e6,
    p_usage: usage,
    p_status: canceled ? "canceled" : status,
    p_stop: message?.stop_reason ?? null,
    p_error: error,
    p_result: value,
  });
}
function inputFor(job: any) {
  return {
    item: job.input.item,
    ...(job.stage === "score"
      ? {
          triage: job.input.triage,
          verified_person: job.input.person
            ? { name: job.input.person.name, title: job.input.person.title }
            : null,
          profile_id: job.profile_id,
        }
      : {}),
  };
}
async function submit(run: any, jobs: any[], mode: "batch" | "live") {
  const stage = jobs[0].stage,
    setup = run.snapshot.setup,
    batchId = mode === "batch" ? crypto.randomUUID() : null;
  if (batchId) {
    const { error } = await svc.from("pipeline_batches").insert({
      id: batchId,
      workspace_id: run.workspace_id,
      run_id: run.id,
      stage,
    });
    if (error) throw Error("Batch record could not be created");
  }
  const calls: any[] = [];
  const started = Date.now();
  for (const job of jobs) {
    if (Date.now() - started > 60000) break;
    if (
      Date.parse(job.input.item.published_at) +
        job.input.source_hours * 3600000 <
      Date.now()
    ) {
      await svc
        .from("pipeline_jobs")
        .update({
          status: "dropped",
          error_summary: "Evidence expired before judging",
          promoted: true,
        })
        .eq("id", job.id);
      continue;
    }
    let params = request(stage, setup, inputFor(job), job.fallback_variant),
      tokens: number;
    try {
      try {
        tokens = Number(
          (
            await api(
              "messages/count_tokens",
              Object.fromEntries(
                Object.entries(params).filter(([k]) => k !== "max_tokens"),
              ),
            )
          ).input_tokens,
        );
      } catch (e) {
        if (
          stage === "score" &&
          !job.fallback_variant &&
          e instanceof ProviderError &&
          e.status === 400
        ) {
          job.fallback_variant = true;
          params = request(stage, setup, inputFor(job), true);
          await svc
            .from("pipeline_jobs")
            .update({
              fallback_variant: true,
              configuration_errors: [
                ...(job.configuration_errors ?? []),
                { step: "count_tokens", error: e.message },
              ],
            })
            .eq("id", job.id);
          tokens = Number(
            (
              await api(
                "messages/count_tokens",
                Object.fromEntries(
                  Object.entries(params).filter(([k]) => k !== "max_tokens"),
                ),
              )
            ).input_tokens,
          );
        } else throw e;
      }
      if (!Number.isInteger(tokens) || tokens < 0 || tokens + 256 > 100000)
        throw Error("Model input is too large or could not be counted");
      const rates = run.snapshot.rates[params.model],
        fx = rates.currency === "USD" ? run.snapshot.fx : 1,
        cap =
          Math.ceil(
            upperCost(tokens, params.max_tokens, rates, mode === "batch") *
              fx *
              1e6,
          ) / 1e6,
        id = crypto.randomUUID();
      const reserved = await rpc("reserve_signals_ai_call", {
        p_job: job.id,
        p_call: id,
        p_mode: mode,
        p_params: params,
        p_rates: rates,
        p_fx: fx,
        p_cap: cap,
        p_batch: batchId,
      });
      if (reserved) calls.push({ id, job, params, rates, fx });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Judging unavailable",
        budget = /budget|cap|paused/i.test(error);
      await svc
        .from("pipeline_jobs")
        .update({
          status: budget ? "budget_paused" : "failed",
          error_summary: error,
        })
        .eq("id", job.id);
      if (e instanceof ProviderError && [401, 403].includes(e.status))
        throw Error("Anthropic authentication failed. Check the project key.");
    }
  }
  if (!calls.length) {
    if (batchId)
      await svc
        .from("pipeline_batches")
        .update({ status: "failed", error_summary: "No calls were submitted" })
        .eq("id", batchId);
    return;
  }
  await svc
    .from("pipeline_ai_calls")
    .update({ status: "submitted" })
    .in(
      "id",
      calls.map((c) => c.id),
    );
  if (mode === "live") {
    await Promise.all(
      calls.map(async (c) => {
        const call = (
          await svc
            .from("pipeline_ai_calls")
            .select("*")
            .eq("id", c.id)
            .single()
        ).data;
        try {
          const message = await api("messages", c.params);
          await settle(call, c.job, run, message);
        } catch (e) {
          if (e instanceof ProviderError) {
            await settle(call, c.job, run, { usage: {} }, e.message);
            if (
              c.job.stage === "score" &&
              !c.job.fallback_variant &&
              e.status === 400
            )
              await svc
                .from("pipeline_jobs")
                .update({
                  status: "pending",
                  fallback_variant: true,
                  configuration_errors: [
                    ...(c.job.configuration_errors ?? []),
                    { step: "live", error: e.message },
                  ],
                })
                .eq("id", c.job.id);
          } else
            await settle(
              call,
              c.job,
              run,
              null,
              "Live response unavailable; reserved cap recorded without retrying",
            );
        }
      }),
    );
    return;
  }
  try {
    const b = await api("messages/batches", {
      requests: calls.map((c) => ({ custom_id: c.id, params: c.params })),
    });
    await svc
      .from("pipeline_batches")
      .update({ provider_id: b.id, status: "processing" })
      .eq("id", batchId);
  } catch (e) {
    if (e instanceof ProviderError) {
      for (const c of calls) {
        const call = (
          await svc
            .from("pipeline_ai_calls")
            .select("*")
            .eq("id", c.id)
            .single()
        ).data;
        await settle(call, c.job, run, { usage: {} }, e.message);
        if (stage === "score" && !c.job.fallback_variant && e.status === 400)
          await svc
            .from("pipeline_jobs")
            .update({
              status: "pending",
              fallback_variant: true,
              configuration_errors: [
                ...(c.job.configuration_errors ?? []),
                { step: "batch_submit", error: e.message },
              ],
            })
            .eq("id", c.job.id);
      }
      await svc
        .from("pipeline_batches")
        .update({ status: "failed", error_summary: e.message })
        .eq("id", batchId);
    } else {
      await svc
        .from("pipeline_batches")
        .update({
          status: "uncertain",
          error_summary:
            "Batch submission response unavailable. Funds remain reserved; no request was repeated.",
        })
        .eq("id", batchId);
      await svc
        .from("pipeline_ai_calls")
        .update({
          status: "uncertain",
          error_summary: "Batch submission response unavailable",
        })
        .in(
          "id",
          calls.map((c) => c.id),
        );
    }
  }
}
async function pollBatches(run: any) {
  const { data: batches, error } = await svc
    .from("pipeline_batches")
    .select("*")
    .eq("run_id", run.id)
    .in("status", ["creating", "processing", "canceling", "uncertain"]);
  if (error) throw Error("Batch status unavailable");
  for (const b of batches ?? []) {
    const { data: calls } = await svc
      .from("pipeline_ai_calls")
      .select("*,pipeline_jobs!pipeline_ai_calls_job_id_workspace_id_fkey(*)")
      .eq("batch_id", b.id);
    if (!b.provider_id) {
      if (Date.parse(b.created_at) < Date.now() - 25 * 3600000) {
        for (const c of calls ?? [])
          if (!c.completed_at)
            await settle(
              c,
              c.pipeline_jobs,
              run,
              null,
              "Unconfirmed batch expired; maximum reserved charge recorded",
            );
        await svc
          .from("pipeline_batches")
          .update({
            status: "failed",
            error_summary: "Unconfirmed batch expired",
          })
          .eq("id", b.id);
      }
      continue;
    }
    let current;
    try {
      current = await api(
        "messages/batches/" + encodeURIComponent(b.provider_id),
      );
    } catch {
      continue;
    }
    if (current.processing_status !== "ended") {
      if (
        Date.parse(run.fallback_at) <= Date.now() &&
        current.processing_status !== "canceling"
      ) {
        try {
          await api(
            "messages/batches/" + encodeURIComponent(b.provider_id) + "/cancel",
            undefined,
            "POST",
          );
          await svc
            .from("pipeline_batches")
            .update({ status: "canceling" })
            .eq("id", b.id);
        } catch {}
      }
      continue;
    }
    let ndjson: string;
    try {
      ndjson = await api(
        "messages/batches/" + encodeURIComponent(b.provider_id) + "/results",
      );
    } catch {
      continue;
    }
    for (const line of ndjson.split("\n").filter(Boolean)) {
      const result = JSON.parse(line),
        call = (calls ?? []).find((c) => c.id === result.custom_id);
      if (!call || call.completed_at) continue;
      const job = call.pipeline_jobs;
      if (result.result.type === "succeeded")
        await settle(call, job, run, result.result.message);
      else {
        const error =
          result.result.error?.error?.message ??
          result.result.error?.message ??
          "Batch request " + result.result.type;
        await settle(call, job, run, { usage: {} }, error, true);
        if (
          job.stage === "score" &&
          !job.fallback_variant &&
          result.result.type === "errored" &&
          result.result.error?.error?.type !== "authentication_error"
        )
          await svc
            .from("pipeline_jobs")
            .update({
              status: "pending",
              fallback_variant: true,
              configuration_errors: [
                ...(job.configuration_errors ?? []),
                { step: "batch_result", error },
              ],
            })
            .eq("id", job.id);
      }
    }
    await svc
      .from("pipeline_batches")
      .update({ status: "ended" })
      .eq("id", b.id);
  }
}
const legalName = (v: string) =>
  v
    .toLowerCase()
    .replace(/\b(the|inc|ltd|limited|llc|corp|corporation|company|co)\b/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
async function company(run: any, name: string) {
  const { data: watch, error } = await svc
    .from("campaign_prospects")
    .select("companies!campaign_prospects_company_id_fkey(*)")
    .eq("workspace_id", run.workspace_id)
    .eq("group_type", "watchlist");
  if (error) throw Error("Watch companies unavailable");
  const known = [
      ...new Map(
        (watch ?? [])
          .filter((w: any) => w.companies)
          .map((w: any) => [w.companies.id, w.companies]),
      ).values(),
    ] as any[],
    matches = known.filter((c) => legalName(c.name) === legalName(name));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) throw Error("Company identity needs review");
  const exact = await svc
    .from("companies")
    .select("id")
    .eq("name", name)
    .limit(2);
  if (exact.error) throw Error("Company lookup unavailable");
  if (exact.data?.length === 1) return exact.data[0].id;
  const { data, error: save } = await svc
    .from("companies")
    .upsert(
      {
        workspace_id: run.workspace_id,
        name,
        discovery_key: "signal-name:" + (await hash(name.toLowerCase())),
        provider_ids: { source: "dated_signal" },
      },
      { onConflict: "discovery_key" },
    )
    .select("id")
    .single();
  if (save) throw Error("Source company could not be recorded");
  return data.id;
}
async function person(
  run: any,
  triage: Triage,
  item: Item,
  cid: string,
  profile: any,
) {
  const { data: watch, error } = await svc
    .from("campaign_prospects")
    .select("people!campaign_prospects_person_company_fk(*)")
    .eq("workspace_id", run.workspace_id)
    .eq("campaign_id", profile.id)
    .eq("company_id", cid)
    .eq("group_type", "watchlist");
  if (error) throw Error("Watch people unavailable");
  const people = (watch ?? []).flatMap((w: any) =>
    w.people ? [w.people] : [],
  ) as Person[];
  const selected = selectPerson(triage, item, cid, people, profile);
  if (!selected) return null;
  if (selected.id) return selected;
  const { data, error: save } = await svc
    .from("people")
    .upsert(
      {
        workspace_id: run.workspace_id,
        name: selected.name,
        title: selected.title,
        company_id: cid,
        discovery_key:
          "signal-person:" +
          (await hash(
            cid + selected.name.toLowerCase() + selected.title.toLowerCase(),
          )),
        provider_ids: { source_url: item.url },
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "discovery_key" },
    )
    .select("*")
    .single();
  if (save) throw Error("Named person could not be recorded");
  return data as Person;
}
async function promoteTriage(run: any) {
  const { data: jobs, error } = await svc
    .from("pipeline_jobs")
    .select("*")
    .eq("run_id", run.id)
    .eq("stage", "triage");
  if (error) throw Error("Triage unavailable");
  const setup = run.snapshot.setup as Setup;
  const eligible: any[] = [];
  for (const j of jobs ?? []) {
    if (j.promoted || j.status !== "succeeded") continue;
    const t = j.result as Triage,
      p = setup.profiles.find((p) => p.id === t.profile_id),
      r = setup.rules.find((r) => r.id === t.rule_id);
    let reason = "";
    if (!t.keep || t.icp_fit < 5 || !p) reason = "Did not match a profile";
    else if (!r?.is_active) reason = "Signal rule is off; admin log only";
    else if (t.polarity === "negative" && !sensitiveEnabled(setup))
      reason = "Sensitive delivery rule is off; admin log only";
    else if (!t.company) reason = "No company stated in the source";
    if (reason) {
      await svc
        .from("pipeline_jobs")
        .update({ status: "dropped", promoted: true, error_summary: reason })
        .eq("id", j.id);
      continue;
    }
    try {
      const cid = await company(run, t.company),
        selected = await person(run, t, j.input.item, cid, p);
      if (!selected && p!.when_no_person === "drop") {
        await svc
          .from("pipeline_jobs")
          .update({
            status: "dropped",
            promoted: true,
            error_summary: "No matching person; profile set to drop",
          })
          .eq("id", j.id);
        continue;
      }
      eligible.push({
        ...j,
        profile_id: p!.id,
        company_id: cid,
        person_id: selected?.id ?? null,
        selected,
      });
    } catch (e) {
      await svc
        .from("pipeline_jobs")
        .update({
          status: "failed",
          promoted: true,
          error_summary: e instanceof Error ? e.message : "Entity match failed",
        })
        .eq("id", j.id);
    }
  }
  const grouped = groupEvents(
    eligible.map((j) => ({
      id: j.item_id,
      source_key: j.input.source_key,
      company_ids: [j.company_id],
      item: j.input.item,
    })),
  );
  for (const j of eligible) {
    const primary = grouped.get(j.item_id);
    if (primary !== j.item_id) {
      await svc
        .from("pipeline_jobs")
        .update({
          status: "dropped",
          promoted: true,
          error_summary: "Duplicate report of the same event",
        })
        .eq("id", j.id);
      await svc
        .from("collection_items")
        .update({
          is_primary: false,
          primary_item_id: primary,
          drop_reason: "same_event",
          event_group_key: primary,
        })
        .eq("id", j.item_id)
        .eq("workspace_id", run.workspace_id);
      continue;
    }
    const { error } = await svc.from("pipeline_jobs").upsert(
      {
        workspace_id: run.workspace_id,
        run_id: run.id,
        item_id: j.item_id,
        stage: "score",
        profile_id: j.profile_id,
        company_id: j.company_id,
        person_id: j.person_id,
        input: { ...j.input, triage: j.result, person: j.selected },
      },
      { onConflict: "run_id,item_id,stage", ignoreDuplicates: true },
    );
    if (error) throw Error("Scoring tasks could not be created");
    await svc
      .from("pipeline_jobs")
      .update({
        promoted: true,
        profile_id: j.profile_id,
        company_id: j.company_id,
        person_id: j.person_id,
      })
      .eq("id", j.id);
  }
  await svc.from("pipeline_runs").update({ status: "score" }).eq("id", run.id);
}
async function saveCards(run: any) {
  const { data: jobs, error } = await svc
    .from("pipeline_jobs")
    .select("*")
    .eq("run_id", run.id)
    .eq("stage", "score")
    .eq("status", "succeeded")
    .eq("promoted", false);
  if (error) throw Error("Scoring results unavailable");
  for (const j of jobs ?? []) {
    const value = j.result,
      until = new Date(
        Date.parse(j.input.item.published_at) + j.input.source_hours * 3600000,
      ).toISOString();
    if (value.relevance < 7 || Date.parse(until) <= Date.now()) {
      await svc
        .from("pipeline_jobs")
        .update({
          status: "dropped",
          promoted: true,
          error_summary:
            value.relevance < 7
              ? "Matched but scored below 7"
              : "Evidence expired before cards were ready",
        })
        .eq("id", j.id);
      continue;
    }
    try {
      const id = await rpc("finalize_signals_card", {
        p_job: j.id,
        p_value: {
          ...value,
          rule_id: j.input.triage.rule_id,
          polarity: j.input.triage.polarity,
          fresh_until: until,
          model: models.stage2.model,
          fingerprint: await hash(
            run.workspace_id +
              j.company_id +
              j.input.triage.event_type +
              j.item_id,
          ),
        },
      });
      if (!id)
        await svc
          .from("pipeline_jobs")
          .update({
            promoted: true,
            status: "dropped",
            error_summary: "Card held by current delivery rules",
          })
          .eq("id", j.id);
    } catch (e) {
      await svc
        .from("pipeline_jobs")
        .update({
          promoted: true,
          status: "failed",
          error_summary:
            e instanceof Error ? e.message : "Card could not be saved",
        })
        .eq("id", j.id);
    }
  }
}
async function summary(run: any) {
  const [j, c, t, cards] = await Promise.all([
    svc.from("pipeline_jobs").select("*").eq("run_id", run.id),
    svc.from("pipeline_ai_calls").select("*").eq("run_id", run.id),
    svc.from("source_tasks").select("*").eq("run_id", run.id),
    svc
      .from("campaign_signals")
      .select("id,polarity")
      .eq("pipeline_run_id", run.id),
  ]);
  if (j.error || c.error || t.error || cards.error)
    throw Error("Run summary unavailable");
  const jobs = j.data ?? [],
    calls = c.data ?? [],
    tasks = t.data ?? [],
    stages: Record<string, any> = {
      triage: {
        cost: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        max_tokens_failures: 0,
        failures: 0,
      },
      score: {
        cost: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        max_tokens_failures: 0,
        failures: 0,
      },
    },
    sources: Record<string, any> = {};
  for (const task of tasks) {
    const s = (sources[task.collection_source_key] ??= {
      items: 0,
      fresh: 0,
      usable: 0,
      cost: 0,
      statuses: [],
    });
    s.items += task.collected_count;
    s.fresh += task.fresh_count;
    s.cost += Number(task.cost_gbp);
    s.statuses.push(task.status);
  }
  for (const call of calls) {
    const job = jobs.find((j) => j.id === call.job_id),
      s = stages[job?.stage ?? "triage"];
    s.cost += Number(call.cost_gbp ?? 0);
    s.cache_read_input_tokens += call.usage?.cache_read_input_tokens ?? 0;
    s.cache_creation_input_tokens +=
      call.usage?.cache_creation_input_tokens ?? 0;
    if (call.stop_reason === "max_tokens") s.max_tokens_failures++;
    if (call.completed_at && call.status !== "succeeded") s.failures++;
    const source = (sources[job?.input.source_key] ??= {
      items: 0,
      fresh: 0,
      usable: 0,
      cost: 0,
      statuses: [],
    });
    source.cost += Number(call.cost_gbp ?? 0);
  }
  for (const job of jobs.filter(
    (j) =>
      j.stage === "score" &&
      j.status === "succeeded" &&
      j.promoted &&
      j.result?.relevance >= 7,
  )) {
    const source = (sources[job.input.source_key] ??= {
      items: 0,
      fresh: 0,
      usable: 0,
      cost: 0,
      statuses: [],
    });
    source.usable++;
  }
  const drops: Record<string, number> = {};
  for (const task of tasks)
    for (const [k, n] of Object.entries(task.drop_counts ?? {}))
      drops[k] = (drops[k] ?? 0) + Number(n);
  const triage = jobs.filter((j) => j.stage === "triage"),
    sourceItems = tasks.reduce((n, t) => n + t.collected_count, 0),
    reused = triage.filter(
      (j) => !tasks.some((t) => t.id === j.input.source_task_id),
    ).length;
  for (const job of triage.filter(
    (j) => !tasks.some((t) => t.id === j.input.source_task_id),
  )) {
    const source = (sources[job.input.source_key] ??= {
      items: 0,
      fresh: 0,
      usable: 0,
      cost: 0,
      statuses: [],
    });
    source.items++;
    source.fresh++;
  }
  drops.duplicate =
    (drops.duplicate ?? 0) +
    triage.filter((j) => /Duplicate report/.test(j.error_summary ?? "")).length;
  return {
    items_collected: sourceItems + reused,
    raw_collected: sourceItems,
    reused_fresh: reused,
    fresh: triage.length,
    usable: cards.data?.length ?? 0,
    cost:
      tasks.reduce((n, t) => n + Number(t.cost_gbp), 0) +
      calls.reduce((n, c) => n + Number(c.cost_gbp ?? 0), 0),
    stages,
    sources,
    drops,
    unmatched: triage.filter(
      (j) =>
        j.status === "dropped" && !/Duplicate/i.test(j.error_summary ?? ""),
    ).length,
    below_seven: jobs.filter(
      (j) => j.stage === "score" && j.status === "dropped",
    ).length,
    model_failures: jobs.filter((j) => j.status === "failed").length,
    budget_paused: jobs.filter((j) => j.status === "budget_paused").length,
    pending: calls.filter((c) => !c.completed_at).length,
  };
}
async function work(id: string) {
  const { data: r, error } = await svc
    .from("pipeline_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return;
  const { data: claim } = await svc
    .from("pipeline_runs")
    .update({ lease_until: new Date(Date.now() + 120000).toISOString() })
    .eq("id", id)
    .or("lease_until.is.null,lease_until.lt." + new Date().toISOString())
    .select("id");
  if (!claim?.length) return;
  try {
    if (r.status === "collecting" && !(await prepare(r))) return;
    await pollBatches(r);
    let rows =
      (await svc.from("pipeline_jobs").select("*").eq("run_id", id)).data ?? [];
    const workspace = (
      await svc
        .from("workspaces")
        .select("status,timezone")
        .eq("id", r.workspace_id)
        .single()
    ).data;
    if (!workspace || ["paused", "archived"].includes(workspace.status)) {
      await svc
        .from("pipeline_jobs")
        .update({
          status: "budget_paused",
          error_summary: "Client paused; no new AI call made",
        })
        .eq("run_id", id)
        .in("status", ["pending", "budget_paused"]);
    } else {
      const triage = rows.filter((j) => j.stage === "triage");
      if (
        !triage.some((j) => ["pending", "submitted"].includes(j.status)) &&
        triage.some((j) => j.status === "succeeded" && !j.promoted)
      )
        await promoteTriage(r);
      rows =
        (await svc.from("pipeline_jobs").select("*").eq("run_id", id)).data ??
        [];
      const stage = rows.some(
          (j) =>
            j.stage === "triage" && ["pending", "submitted"].includes(j.status),
        )
          ? "triage"
          : "score",
        pending = rows.filter(
          (j) => j.stage === stage && j.status === "pending",
        );
      if (pending.length) {
        const previous =
          (
            await svc
              .from("pipeline_batches")
              .select("status")
              .eq("run_id", id)
              .eq("stage", stage)
          ).data ?? [];
        const warm = previous.some((b) => b.status === "ended"),
          waiting = previous.some((b) =>
            ["creating", "processing", "canceling", "uncertain"].includes(
              b.status,
            ),
          );
        if (warm || !waiting)
          await submit(r, pending.slice(0, warm ? 50 : 1), "batch");
      }
      if (Date.parse(r.fallback_at) <= Date.now()) {
        rows =
          (await svc.from("pipeline_jobs").select("*").eq("run_id", id)).data ??
          [];
        const live = rows.filter(
          (j) =>
            ["pending", "submitted"].includes(j.status) && j.stage === stage,
        );
        const eligible: any[] = [];
        for (const j of live) {
          const used = await svc
            .from("pipeline_ai_calls")
            .select("params")
            .eq("job_id", j.id)
            .eq("mode", "live");
          if (used.error) throw Error("Fallback history unavailable");
          if (
            !used.data?.length ||
            (j.fallback_variant &&
              !used.data.some(
                (c) =>
                  c.params.max_tokens === models.stage2.fallback_max_tokens,
              ))
          )
            eligible.push(j);
        }
        if (eligible.length) await submit(r, eligible.slice(0, 8), "live");
      }
    }
    await saveCards(r);
    rows =
      (await svc.from("pipeline_jobs").select("*").eq("run_id", id)).data ?? [];
    const s = await summary(r),
      active =
        rows.some((j) => ["pending", "submitted"].includes(j.status)) ||
        (["paused", "archived"].includes(workspace?.status) &&
          rows.some((j) => j.status === "succeeded" && !j.promoted));
    if (!active) {
      const failed =
          s.model_failures > 0 ||
          s.budget_paused > 0 ||
          s.drops.save_failed > 0,
        noSource = s.raw_collected === 0 && s.fresh === 0;
      await svc
        .from("pipeline_runs")
        .update({
          status: noSource ? "failed" : failed ? "partial" : "ready",
          summary: s,
          error_summary: null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (
        !r.published &&
        r.snapshot.kind !== "test" &&
        workspace?.status === "live"
      ) {
        await rpc("publish_signals_cards", {
          p_run: id,
          p_day: localDate(new Date(), workspace.timezone),
        });
        await svc
          .from("pipeline_runs")
          .update({ published: true })
          .eq("id", id);
      }
    } else
      await svc
        .from("pipeline_runs")
        .update({ summary: s, error_summary: null })
        .eq("id", id);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Judging interrupted";
    await svc
      .from("pipeline_runs")
      .update({
        error_summary: error,
        ...(/authentication failed|not configured|pricing unavailable/i.test(
          error,
        )
          ? { status: "failed" }
          : {}),
      })
      .eq("id", id);
  } finally {
    await svc.from("pipeline_runs").update({ lease_until: null }).eq("id", id);
  }
}
async function repairCompanyValidation(runId: string) {
  const { data: run, error } = await svc
    .from("pipeline_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (error) throw Error("Run unavailable");
  const { data: jobs } = await svc
    .from("pipeline_jobs")
    .select("*")
    .eq("run_id", runId)
    .eq("stage", "triage")
    .eq("status", "failed")
    .eq("error_summary", "Company was not stated in the item");
  let repaired = 0;
  for (const job of jobs ?? []) {
    const { data: calls } = await svc
      .from("pipeline_ai_calls")
      .select(
        "*,pipeline_batches!pipeline_ai_calls_batch_id_workspace_id_fkey(provider_id)",
      )
      .eq("job_id", job.id)
      .eq("stop_reason", "end_turn")
      .not("completed_at", "is", null);
    for (const c of calls ?? []) {
      const provider = c.pipeline_batches?.provider_id;
      if (!provider) continue;
      const results = await api("messages/batches/" + provider + "/results");
      for (const line of results.trim().split("\n")) {
        const row = JSON.parse(line);
        if (row.custom_id !== c.id || row.result.type !== "succeeded") continue;
        try {
          const value = parseTriage(
            parseMessage(row.result.message),
            run.snapshot.setup,
            job.input.item,
          );
          const { error: save } = await svc
            .from("pipeline_jobs")
            .update({
              status: "succeeded",
              result: value,
              error_summary: null,
              promoted: false,
              configuration_errors: [
                ...(job.configuration_errors ?? []),
                {
                  validation_repair: "typographic apostrophe normalization",
                  original_error: job.error_summary,
                },
              ],
            })
            .eq("id", job.id)
            .eq("status", "failed");
          if (save) throw save;
          repaired++;
        } catch {}
      }
    }
  }
  if (repaired)
    await svc
      .from("pipeline_runs")
      .update({ status: "triage", completed_at: null, error_summary: null })
      .eq("id", runId);
  return { repaired };
}
async function globalWork() {
  const lostPeople = await svc
    .from("person_lookup_calls")
    .select("id,delivery_id,actor_id,cap_gbp")
    .is("completed_at", null)
    .lt("created_at", new Date(Date.now() - 15 * 60000).toISOString())
    .limit(20);
  if (!lostPeople.error)
    for (const c of lostPeople.data ?? [])
      await rpc("finish_signals_person_lookup", {
        p_delivery: c.delivery_id,
        p_actor: c.actor_id,
        p_person: null,
        p_call: c.id,
        p_cost: Number(c.cap_gbp),
        p_usage: null,
        p_error: "Person search receipt unavailable; reserved cap recorded",
      });

  const lost = await svc
    .from("rewrite_calls")
    .select("id,reservation_id")
    .is("completed_at", null)
    .lt("created_at", new Date(Date.now() - 15 * 60000).toISOString())
    .limit(20);
  if (!lost.error)
    for (const call of lost.data ?? []) {
      const { data: r } = await svc
        .from("cost_reservations")
        .select("estimated_cost")
        .eq("id", call.reservation_id)
        .single();
      if (r)
        await rpc("settle_signals_rewrite", {
          p_call: call.id,
          p_cost: Number(r.estimated_cost),
          p_usage: null,
          p_value: null,
          p_error: "Rewrite receipt unavailable; reserved cap recorded",
          p_stop: null,
        });
    }

  const orphan = await svc
    .from("collection_runs")
    .select("id,workspace_id,kind")
    .in("kind", ["test", "scheduled"])
    .gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString())
    .limit(100);
  for (const c of orphan.data ?? []) {
    const p = await svc
      .from("pipeline_runs")
      .select("id")
      .eq("id", c.id)
      .maybeSingle();
    if (!p.data)
      try {
        await register(c.id);
      } catch {}
  }
  const active = await svc
    .from("pipeline_runs")
    .select("id")
    .or("status.in.(collecting,triage,score),summary->>pending.gt.0")
    .order("created_at")
    .limit(2);
  await Promise.allSettled((active.data ?? []).map((p) => work(p.id)));
  const unpublished = await svc
    .from("pipeline_runs")
    .select(
      "id,workspace_id,snapshot,workspaces!pipeline_runs_workspace_id_fkey(status,timezone)",
    )
    .in("status", ["ready", "partial"])
    .eq("published", false)
    .limit(25);
  for (const p of unpublished.data ?? []) {
    const w = p.workspaces as any;
    if (p.snapshot.kind !== "test" && w?.status === "live") {
      await rpc("publish_signals_cards", {
        p_run: p.id,
        p_day: localDate(new Date(), w.timezone),
      });
      await svc
        .from("pipeline_runs")
        .update({ published: true })
        .eq("id", p.id);
    }
  }
  const due = await svc
    .from("workspaces")
    .select("id,timezone")
    .eq("is_signals_client", true)
    .eq("status", "live")
    .lte("next_pipeline_run_at", new Date().toISOString())
    .limit(5);
  for (const w of due.data ?? []) {
    try {
      const setup = await rpc("signals_pipeline_setup", { p_workspace: w.id }),
        times = (setup.delivery ?? [])
          .filter((d: any) => d.enabled && d.user_id && d.morning_email_time)
          .map((d: any) => d.morning_email_time.slice(0, 5)),
        today = schedule(w.timezone, times),
        next = schedule(w.timezone, times, new Date(), true);
      const c = await collect({
        action: "start_scheduled",
        workspace_id: w.id,
        day: localDate(new Date(), w.timezone),
        next: next.collect,
      });
      if (c.id) {
        await register(
          c.id,
          new Date(
            zonedTime(
              localDate(new Date(), w.timezone),
              [...times].sort()[0] ?? "07:30",
              w.timezone,
            ).getTime() -
              30 * 60000,
          ).toISOString(),
        );
        await work(c.id);
      }
    } catch {}
  }
}
async function rewrite(
  delivery: string,
  actor: string,
  channel: "email" | "linkedin",
) {
  const context = await rpc("signals_rewrite_context", {
    p_delivery: delivery,
    p_actor: actor,
    p_channel: channel,
  });
  if (!context.item || !context.judgment)
    throw Error("Original evidence unavailable");
  const { data: p, error } = await svc
    .from("provider_pricing")
    .select("*")
    .eq("workspace_id", context.workspace_id)
    .eq("pricing_key", "anthropic/" + models.stage2.model)
    .single();
  if (
    error ||
    !p.verified_on ||
    Date.parse(p.verified_on) < Date.now() - 30 * 86400000
  )
    throw Error("Review model pricing before rewriting");
  usageCost({}, p.rates, false);
  let fx = 1;
  if (p.currency === "USD") {
    const response = await fetch(
      "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw Error("Exchange rate unavailable");
    fx = ecbRate(await response.text()).fx;
  }
  const input = {
    item: context.item,
    profile_id: context.profile_id,
    verified_person: context.person,
    current_opener: context.current,
  };
  let params = rewriteRequest(context.setup, input, channel),
    tokens: number;
  try {
    tokens = (
      await api(
        "messages/count_tokens",
        Object.fromEntries(
          Object.entries(params).filter(([k]) => k !== "max_tokens"),
        ),
      )
    ).input_tokens;
  } catch (e) {
    if (!(e instanceof ProviderError) || e.status !== 400) throw e;
    params = rewriteRequest(context.setup, input, channel, true);
    tokens = (
      await api(
        "messages/count_tokens",
        Object.fromEntries(
          Object.entries(params).filter(([k]) => k !== "max_tokens"),
        ),
      )
    ).input_tokens;
  }
  if (!Number.isInteger(tokens) || tokens < 0 || tokens + 256 > 100000)
    throw Error("Rewrite input is too large");
  const id = crypto.randomUUID(),
    cap =
      Math.ceil(
        upperCost(tokens, models.stage2.fallback_max_tokens, p.rates, false) *
          fx *
          1e6,
      ) / 1e6;
  await rpc("reserve_signals_rewrite", {
    p_delivery: delivery,
    p_actor: actor,
    p_channel: channel,
    p_call: id,
    p_cap: cap,
    p_params: params,
    p_rates: p.rates,
    p_fx: fx,
  });
  let message: any = null,
    value: any = null,
    failure: string | null = null,
    cost = 0,
    usage: any = null;
  try {
    try {
      message = await api("messages", params);
    } catch (e) {
      if (
        e instanceof ProviderError &&
        e.status === 400 &&
        params.max_tokens !== models.stage2.fallback_max_tokens
      ) {
        params = rewriteRequest(context.setup, input, channel, true);
        message = await api("messages", params);
      } else throw e;
    }
    usage = message.usage ?? {};
    cost = usageCost(usage, p.rates, false) * fx;
    const parsed = parseMessage(message);
    await svc
      .from("rewrite_calls")
      .update({ model_output: parsed })
      .eq("id", id);
    value = validateRewrite(
      parsed,
      context.setup,
      context.item,
      context.polarity,
      context.person,
      context.judgment,
      channel,
    );
  } catch (e) {
    failure = e instanceof Error ? e.message : "Rewrite failed";
    if (!message) {
      usage = e instanceof ProviderError ? {} : null;
      cost = usage === null ? cap : 0;
    }
  }
  const draftId = await rpc("settle_signals_rewrite", {
    p_call: id,
    p_cost: Math.ceil(cost * 1e6) / 1e6,
    p_usage: usage,
    p_value: value,
    p_error: failure,
    p_stop: message?.stop_reason ?? null,
  });
  if (failure) return { error: "Couldn't rewrite, try again", attempted: true };
  const { data: draft, error: de } = await svc
    .from("message_drafts")
    .select("id,channel,body,subject,version")
    .eq("id", draftId)
    .single();
  if (de) throw Error("Saved rewrite unavailable");
  return { draft, attempted: true };
}
async function findPerson(
  delivery: string,
  actor: string,
  approvedCap?: number,
) {
  const context = await rpc("signals_person_context", {
      p_delivery: delivery,
      p_actor: actor,
    }),
    profile = context.profile;
  const selected = selectPerson(
    { person: null } as Triage,
    { title: "", excerpt: "" } as Item,
    context.company.id,
    context.people,
    profile,
  );
  if (selected?.id) {
    await rpc("finish_signals_person_lookup", {
      p_delivery: delivery,
      p_actor: actor,
      p_person: selected.id,
    });
    return { found: true };
  }
  const linkedin = https(context.company.linkedin_url, "company");
  if (!linkedin)
    return {
      message:
        "No verified company LinkedIn page. Ask your client admin to review the company before a paid person search.",
    };
  if (!profile.priority_titles?.length)
    return {
      message:
        "Ask your client admin to add priority job titles before searching.",
    };
  const [catalog, xml] = await Promise.all([
    fetch(
      "https://treg.to/catalog/endpoints/harvestapi.linkedin.leads.search",
      { signal: AbortSignal.timeout(15000) },
    ),
    fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
      signal: AbortSignal.timeout(15000),
    }),
  ]);
  if (!catalog.ok || !xml.ok) throw Error("Person search pricing unavailable");
  const details = await catalog.json(),
    usd = Number(details.endpoint?.cost?.usd);
  if (
    details.endpoint?.cost?.type !== "per_call" ||
    details.endpoint.platform_blocked ||
    !Number.isFinite(usd) ||
    usd <= 0 ||
    usd > 0.5
  )
    throw Error("Person search pricing needs review");
  const fx = ecbRate(await xml.text()).fx,
    cap = Math.ceil(usd * fx * 1e6) / 1e6;
  if (approvedCap === undefined)
    return { quote: { cap_gbp: cap, cap_usd: usd } };
  if (!Number.isFinite(approvedCap) || approvedCap < cap)
    throw Error("Search price changed; request a new estimate");
  const token = Deno.env.get("TREG_TOKEN");
  if (!token) throw Error("Person search key unavailable");
  const id = crypto.randomUUID();
  await rpc("begin_signals_person_lookup", {
    p_delivery: delivery,
    p_actor: actor,
    p_call: id,
    p_cap: cap,
  });
  let cost = cap,
    usage: any = null,
    error: string | null = null,
    personId: string | null = null;
  try {
    const company = {
      ...context.company,
      key: context.company.id,
      linkedin_url: linkedin,
      website: context.company.website ?? "",
      domain: context.company.domain ?? "",
      revenue_band: "",
      headcount_band: "",
      source: "approved",
      provider_ids: context.company.provider_ids ?? {},
    };
    const { plan, result } = makePlan(
        { ...profile, watch_list_size: 25 },
        [],
        fx,
        new Date().toISOString().slice(0, 10),
        0.001,
        usd,
        "refresh",
        [company],
      ),
      call = nextCall(plan, result);
    if (!call || call.kind !== "people")
      throw Error("Person search couldn't be built");
    const url = new URL("https://treg.to/call/" + call.endpoint);
    for (const [k, v] of Object.entries(call.query ?? {}))
      url.searchParams.set(k, v);
    const response = await fetch(url, {
      headers: {
        "X-Treg-Token": token,
        "X-Treg-Route-Max-Cost": String(usd),
        "Idempotency-Key": id,
      },
      signal: AbortSignal.timeout(65000),
      redirect: "error",
    });
    const receipt = receiptCost(response.headers, usd);
    cost = Math.ceil(receipt.usd * fx * 1e6) / 1e6;
    usage =
      receipt.basis === "reported"
        ? {
            treg_call_id: response.headers.get("X-Treg-Call-Id"),
            cost_usd: receipt.usd,
            usd_gbp: fx,
          }
        : null;
    if (!response.ok)
      throw Error("Person search returned HTTP " + response.status);
    absorb(plan, result, call, await response.json());
    const candidate = result.people
      .filter((p) => titleRank(p.title, profile.priority_titles) < 999)
      .sort(
        (a, b) =>
          titleRank(a.title, profile.priority_titles) -
          titleRank(b.title, profile.priority_titles),
      )[0];
    if (candidate) {
      const { data: existing, error: ee } = await svc
        .from("people")
        .select("id")
        .eq("company_id", company.id)
        .eq("linkedin_url", candidate.linkedin_url);
      if (ee) throw Error("Person match unavailable");
      if (existing?.length === 1) personId = existing[0].id;
      else {
        const { data: saved, error: se } = await svc
          .from("people")
          .insert({
            workspace_id: context.workspace_id,
            company_id: company.id,
            name: candidate.name,
            title: candidate.title,
            linkedin_url: candidate.linkedin_url,
            location: candidate.location,
            provider_ids: candidate.provider_ids,
            last_checked_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (se) throw Error("Person could not be saved");
        personId = saved.id;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Person search failed";
  }
  await rpc("finish_signals_person_lookup", {
    p_delivery: delivery,
    p_actor: actor,
    p_person: personId,
    p_call: id,
    p_cost: cost,
    p_usage: usage,
    p_error: error,
  });
  return error
    ? { error: "Couldn't find a person, try again" }
    : personId
      ? { found: true }
      : {
          message:
            "No matching person found. This card stays marked as needing a person.",
        };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const token = req.headers.get("X-Signals-Cron-Token");
    if (token) {
      if (!(await rpc("verify_signals_discovery_cron", { p_token: token })))
        return reply({ error: "Not allowed" }, 401);
      const b = await req.json();
      if (b.action === "repair_company_validation")
        return reply(await repairCompanyValidation(b.id));
      EdgeRuntime.waitUntil(b.id ? work(b.id) : globalWork());
      return reply({ queued: true });
    }
    const jwt = (req.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    const { data: u, error } = await svc.auth.getUser(jwt);
    if (error || !u.user) return reply({ error: "Sign in required" }, 401);
    const b = await req.json();
    if (b.action === "find_person")
      return reply(await findPerson(b.delivery, u.user.id, b.approved_cap));
    if (b.action === "rewrite")
      return reply(await rewrite(b.delivery, u.user.id, b.channel));
    const { data: admin } = await svc
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", u.user.id)
      .eq("active", true)
      .maybeSingle();
    if (!admin) return reply({ error: "Not allowed" }, 403);
    if (b.action === "start") {
      const c = await collect(
        {
          action: "start",
          workspace_id: b.workspace_id,
          kind: "test",
          include_paid: b.include_paid === true,
        },
        jwt,
      );
      await register(c.id);
      EdgeRuntime.waitUntil(work(c.id));
      return reply({ id: c.id });
    }
    if (b.action === "work") {
      const { data: r } = await svc
        .from("pipeline_runs")
        .select("id")
        .eq("id", b.id)
        .maybeSingle();
      if (!r) return reply({ error: "Run unavailable" }, 404);
      EdgeRuntime.waitUntil(work(r.id));
      return reply({ id: r.id });
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Pipeline unavailable" },
      400,
    );
  }
});
