declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
import { franc } from "franc-min";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "@supabase/supabase-js";
import {
  parseFeed,
  groupEvents,
  parseWebsite,
  robotsAllows,
  newsItems,
  postItems,
  filterItem,
  brands,
  hash,
  type Item,
} from "./core.ts";
import { getPublicSource } from "./public-http.ts";
import { ecbRate, receiptCost } from "../signals-discovery/core.ts";
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
const robotCache = new Map<string, string>();
async function getFeed(url: string) {
  const u = new URL(url);
  let robots = robotCache.get(u.origin);
  if (robots === undefined) {
    try {
      robots = (await getPublicSource(u.origin + "/robots.txt")).text;
    } catch {
      throw Error("Publisher robots rules unavailable; feed skipped");
    }
    robotCache.set(u.origin, robots);
  }
  if (!robotsAllows(robots, u.pathname + u.search))
    throw Error("Publisher robots rules disallow this feed");
  return getPublicSource(url);
}
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await svc.rpc(name, args);
  if (error) throw Error(error.message);
  return data;
}
async function rows(table: string, workspace: string) {
  const { data, error } = await svc
    .from(table)
    .select("*")
    .eq("workspace_id", workspace);
  if (error) throw Error("Collection settings unavailable");
  return data ?? [];
}
async function plan(workspace: string, test = false, includePaid = false) {
  const [w, profiles, sources, rules, watch, extra] = await Promise.all([
    svc
      .from("workspaces")
      .select("id,is_signals_client,status")
      .eq("id", workspace)
      .single(),
    rows("campaigns", workspace),
    rows("workspace_source_settings", workspace),
    rows("signal_definitions", workspace),
    svc
      .from("campaign_prospects")
      .select(
        "company_id,person_id,companies!campaign_prospects_company_id_fkey(*),people!campaign_prospects_person_id_fkey(*)",
      )
      .eq("workspace_id", workspace)
      .eq("group_type", "watchlist"),
    rows("client_extra_sources", workspace),
  ]);
  if (
    w.error ||
    !w.data.is_signals_client ||
    ["paused", "archived"].includes(w.data.status) ||
    watch.error
  )
    throw Error("Client unavailable");
  const ps = profiles.filter((p) => p.status !== "archived");
  if (!ps.length) throw Error("Add an ICP profile first");
  const companies = [
    ...new Map(
      (watch.data ?? [])
        .filter((x: any) => x.companies)
        .map((x: any) => [x.company_id, x.companies]),
    ).values(),
  ] as any[];
  const people = [
    ...new Map(
      (watch.data ?? [])
        .filter((x: any) => x.people?.linkedin_url)
        .map((x: any) => [x.person_id, x.people]),
    ).values(),
  ] as any[];
  const jobs: any[] = [];
  for (const s of sources.filter((s) => s.enabled)) {
    const config = s.config,
      hours = test ? Math.min(48, s.freshness_hours) : s.freshness_hours;
    const job = (v: any) =>
      jobs.push({
        ...v,
        key: s.source_key + ":" + jobs.length,
        source_key: s.source_key,
        family: config.family,
        provider: config.provider,
        hours,
      });
    if (config.adapter === "rss")
      for (const feed of config.feeds ?? [])
        job({ adapter: "rss", url: feed, cap_usd: 0, name: config.name });
    if (config.adapter === "treg_news" && includePaid) {
      for (let i = 0; i < companies.length; i += 6)
        job({
          adapter: "treg_news",
          query: companies
            .slice(i, i + 6)
            .map((c) => '"' + c.name.replace(/"/g, "") + '"')
            .join(" OR "),
          cap_usd: 0.002,
        });
      const phrases = [
        ...new Set(
          rules
            .filter((r) => r.is_active && !r.deleted_at)
            .flatMap((r) =>
              (r.keywords ?? []).filter((x: string) => !x.startsWith("-")),
            ),
        ),
      ] as string[];
      const market = phrases.length
        ? phrases
        : [
            '"agency review" OR "creative review"',
            '"new CMO" OR "chief brand officer"',
            '"major brand campaign" OR "brand relaunch"',
          ];
      for (let i = 0; i < market.length; i += 6)
        job({
          adapter: "treg_news",
          query: market.slice(i, i + 6).join(" OR "),
          cap_usd: 0.002,
        });
    }
    if (config.adapter === "apify_posts" && includePaid)
      for (const p of people)
        job({
          adapter: "apify_posts",
          url: p.linkedin_url,
          person_id: p.id,
          actor: "harvestapi~linkedin-profile-posts",
          cap_usd: 0.1,
        });
  }
  // Extra sources must pass the date check. Websites still need dated Article metadata.
  for (const e of extra.filter(
    (e) => !e.deleted_at && e.validation_status === "ok",
  ))
    jobs.push({
      key: "extra:" + e.id,
      source_key: "extra_sources",
      family: "publication",
      provider: "client_rss",
      adapter: "extra_read",
      url: e.detected_feed || e.url,
      name: new URL(e.url).hostname,
      hours: 48,
      cap_usd: 0,
    });
  let fx = 1,
    fxDate = "";
  if (jobs.some((j) => j.cap_usd > 0)) {
    const [rate, catalog] = await Promise.all([
      fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
        signal: AbortSignal.timeout(15000),
      }),
      fetch("https://treg.to/catalog/endpoints/anyapi.google.serp.news", {
        signal: AbortSignal.timeout(15000),
      }),
    ]);
    if (!rate.ok || !catalog.ok)
      throw Error("Provider pricing or exchange rate unavailable");
    const e = (await catalog.json()).endpoint;
    if (e.platform_blocked || Number(e.cost?.usd) > 0.002)
      throw Error("News provider pricing changed. Review before collecting");
    const v = ecbRate(await rate.text());
    fx = v.fx;
    fxDate = v.date;
  }
  return {
    snapshot: {
      profiles: ps,
      rules: rules.filter((r) => !r.deleted_at),
      sources,
      companies,
      people,
      fx,
      fx_date: fxDate,
      test,
      include_paid: includePaid,
    },
    jobs,
  };
}
async function retain(task: any, items: Item[], snapshot: any) {
  const old = await svc
    .from("collection_items")
    .select("canonical_url")
    .eq("workspace_id", task.workspace_id)
    .not("evidence_id", "is", null);
  if (old.error) throw Error("Duplicate history unavailable");
  const seen = new Set<string>((old.data ?? []).map((x) => x.canonical_url)),
    drops: Record<string, number> = {};
  let fresh = 0;
  for (const [i, item] of items.entries()) {
    const lang = franc(item.title + " " + item.excerpt, { minLength: 30 });
    if (!item.language || /^en(?:[-_]|$)/i.test(item.language))
      item.language = lang === "eng" ? "en" : lang;
    const { canonical, drop } = filterItem(item, task.input.hours, seen),
      companyIds = brands(item, snapshot.companies);
    let evidence: string | null = null;
    if (drop) drops[drop] = (drops[drop] ?? 0) + 1;
    else {
      const { data, error } = await svc
        .from("evidence_items")
        .insert({
          workspace_id: task.workspace_id,
          source_task_id: task.id,
          source_family: task.source_family,
          provider_key: task.provider_key,
          source_external_id: item.external_id ?? null,
          source_url: item.url,
          canonical_url: canonical,
          canonical_url_hash: await hash(canonical),
          source_name: item.source_name,
          title: item.title,
          excerpt: item.excerpt || item.title,
          content_hash: await hash(item.excerpt || item.title),
          published_at: item.published_at,
          published_date_known: true,
          submission_route: "automated",
          capture_metadata: {
            run_id: task.run_id,
            source_key: task.collection_source_key,
            company_ids: companyIds,
            person_id: item.person_id ?? null,
            raw_date: item.raw_date ?? null,
          },
        })
        .select("id")
        .single();
      if (error) throw Error("Evidence could not be saved");
      evidence = data.id;
      fresh++;
    }
    const { error } = await svc.from("collection_items").upsert(
      {
        workspace_id: task.workspace_id,
        run_id: task.run_id,
        source_task_id: task.id,
        item_index: i,
        source_key: task.collection_source_key,
        item,
        canonical_url: canonical,
        drop_reason: drop,
        evidence_id: evidence,
        company_ids: companyIds,
        person_id: item.person_id ?? null,
      },
      { onConflict: "source_task_id,item_index", ignoreDuplicates: true },
    );
    if (error) throw Error("Filter result could not be saved");
  }
  return { items: items.length, fresh, drops };
}
async function finish(
  task: any,
  items: Item[],
  snapshot: any,
  usd: number,
  basis: string,
  error: string | null,
  reference: string | null,
) {
  let counts = {
    items: items.length,
    fresh: 0,
    drops: {} as Record<string, number>,
  };
  try {
    if (items.length) counts = await retain(task, items, snapshot);
  } catch {
    error =
      "Collected items could not all be saved. The provider charge is recorded.";
  }
  await rpc("finish_signals_collection_task", {
    p_id: task.id,
    p_cost: Math.ceil(usd * snapshot.fx * 1e6) / 1e6,
    p_usd: usd,
    p_basis: basis,
    p_counts: counts,
    p_error: error,
    p_reference: reference,
  });
}
async function execute(task: any, snapshot: any) {
  const j = task.input;
  let usd = 0,
    basis = "reported",
    items: Item[] = [],
    error: string | null = null,
    reference: string | null = null;
  try {
    if (j.adapter === "rss" || j.adapter === "extra_read") {
      const f = await getFeed(j.url);
      items =
        j.adapter === "extra_read" && !/<(?:rss|feed)\b/i.test(f.text)
          ? parseWebsite(f.text, f.url, j.name)
          : parseFeed(f.text, j.name, (xml) =>
              new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_",
                processEntities: false,
                parseTagValue: false,
              }).parse(xml),
            );
    } else if (j.adapter === "treg_news") {
      const token = Deno.env.get("TREG_TOKEN");
      if (!token) throw Error("News search key is not configured");
      usd = j.cap_usd;
      basis = "estimated";
      const response = await fetch(
        "https://treg.to/call/anyapi.google.serp.news",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Treg-Token": token,
            "X-Treg-Route-Max-Cost": String(j.cap_usd),
            "Idempotency-Key": "collection:" + task.id,
          },
          body: JSON.stringify({
            query: j.query,
            timeframe: Math.ceil(j.hours / 24) + "d",
            gl: "us",
            hl: "en",
            limit: 20,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        },
      );
      const receipt = receiptCost(response.headers, j.cap_usd);
      usd = receipt.usd;
      basis = receipt.basis;
      reference = response.headers.get("X-Treg-Call-Id");
      if (!response.ok)
        throw Error("News search returned HTTP " + response.status);
      items = newsItems(await response.json());
    } else if (j.adapter === "apify_posts") {
      const token = Deno.env.get("APIFY_TOKEN");
      if (!token) throw Error("LinkedIn source key is not configured");
      usd = j.cap_usd;
      basis = "estimated";
      const response = await fetch(
        "https://api.apify.com/v2/acts/harvestapi~linkedin-profile-posts/runs?maxTotalChargeUsd=" +
          j.cap_usd,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            targetUrls: [j.url],
            maxPosts: 5,
            scrapeReactions: false,
            scrapeComments: false,
            includeQuotePosts: true,
            includeReposts: false,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok)
        throw Error("LinkedIn provider returned HTTP " + response.status);
      const run = (await response.json()).data;
      reference = run.id;
      const { error: save } = await svc
        .from("source_tasks")
        .update({
          provider_reference: reference,
          input: { ...j, dataset: run.defaultDatasetId },
        })
        .eq("id", task.id);
      if (save) throw Error("Provider run could not be saved");
      return;
    } else throw Error("Source adapter is unavailable");
  } catch (e) {
    error = e instanceof Error ? e.message : "Source collection failed";
  }
  await finish(task, items, snapshot, usd, basis, error, reference);
}
async function pollApify(task: any, snapshot: any) {
  const token = Deno.env.get("APIFY_TOKEN");
  if (!token) return;
  let response;
  try {
    response = await fetch(
      "https://api.apify.com/v2/actor-runs/" +
        encodeURIComponent(task.provider_reference),
      {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    return;
  }
  if (!response.ok) return;
  const run = (await response.json()).data;
  if (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status))
    return;
  const reported = Number(run.usageTotalUsd),
    known =
      run.usageTotalUsd != null && Number.isFinite(reported) && reported >= 0,
    usd = known ? reported : task.estimated_cost_usd;
  let items: Item[] = [],
    error =
      run.status === "SUCCEEDED"
        ? null
        : "LinkedIn provider " + run.status.toLowerCase();
  if (!error) {
    try {
      const response = await fetch(
        "https://api.apify.com/v2/datasets/" +
          encodeURIComponent(run.defaultDatasetId) +
          "/items?clean=true&limit=5",
        {
          headers: { Authorization: "Bearer " + token },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw Error();
      items = postItems(await response.json(), task.input.person_id);
    } catch {
      error = "LinkedIn posts could not be downloaded";
    }
  }
  await finish(
    task,
    items,
    snapshot,
    usd,
    known ? "reported" : "estimated",
    error,
    task.provider_reference,
  );
}
async function groupReports(id: string) {
  const { data, error } = await svc
    .from("collection_items")
    .select("*")
    .eq("run_id", id)
    .not("evidence_id", "is", null)
    .order("created_at");
  if (error) throw Error("Event grouping unavailable");
  const groups = groupEvents(data ?? []);
  for (const row of data ?? []) {
    const primary = groups.get(row.id)!;
    if (primary !== row.id) {
      const { error } = await svc
        .from("collection_items")
        .update({
          is_primary: false,
          primary_item_id: primary,
          event_group_key: primary,
          drop_reason: "same_event",
        })
        .eq("id", row.id)
        .eq("workspace_id", row.workspace_id);
      if (error) throw Error("Event grouping could not be saved");
    }
  }
  const { data: all, error: read } = await svc
    .from("collection_items")
    .select("source_task_id,drop_reason,evidence_id")
    .eq("run_id", id);
  if (read) throw Error("Filter totals unavailable");
  for (const task of new Set((all ?? []).map((x) => x.source_task_id))) {
    const rows = (all ?? []).filter((x) => x.source_task_id === task),
      drops: Record<string, number> = {};
    for (const row of rows)
      if (row.drop_reason)
        drops[row.drop_reason] = (drops[row.drop_reason] ?? 0) + 1;
    const { error } = await svc
      .from("source_tasks")
      .update({
        fresh_count: rows.filter((x) => !x.drop_reason && x.evidence_id).length,
        drop_counts: drops,
      })
      .eq("id", task)
      .eq("run_id", id);
    if (error) throw Error("Filter totals could not be saved");
  }
}
async function work(id: string) {
  const { data: run, error } = await svc
    .from("collection_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return;
  // A run lease prevents concurrent polls from duplicating free reads or provider polls.
  const { data: claimed } = await svc
    .from("collection_runs")
    .update({ lease_until: new Date(Date.now() + 120000).toISOString() })
    .eq("id", id)
    .or("lease_until.is.null,lease_until.lt." + new Date().toISOString())
    .select("id");
  if (!claimed?.length) return;
  try {
    const began = Date.now();
    while (Date.now() - began < 90000) {
      const { data: tasks, error } = await svc
        .from("source_tasks")
        .select("*")
        .eq("run_id", id)
        .order("created_at");
      if (error) throw Error("Tasks unavailable");
      const running = (tasks ?? []).filter((t) => t.status === "running");
      for (const t of running) {
        if (t.input.adapter === "apify_posts" && t.provider_reference)
          await pollApify(t, run.snapshot);
        else if (t.lease_until && Date.parse(t.lease_until) < Date.now())
          await finish(
            t,
            [],
            run.snapshot,
            t.estimated_cost_usd,
            "estimated",
            "Worker interrupted. Reserved cap recorded; this call was not repeated.",
            t.provider_reference,
          );
      }
      const next = tasks?.find((t) => t.status === "queued");
      if (!next) {
        const pending = await svc
          .from("source_tasks")
          .select("id")
          .eq("run_id", id)
          .eq("status", "running")
          .limit(1);
        if (pending.error) throw Error("Task status unavailable");
        if (pending.data?.length) return;
        await groupReports(id);
        const { data: final } = await svc
          .from("source_tasks")
          .select(
            "status,fresh_count,collected_count,drop_counts,error_summary",
          )
          .eq("run_id", id);
        if (final?.some((t) => t.status === "running")) return;
        const errors = final?.filter((t) => t.status !== "succeeded") ?? [];
        await svc
          .from("search_runs")
          .update({
            status: errors.length
              ? final?.some((t) => t.status === "succeeded")
                ? "partial"
                : "failed"
              : "succeeded",
            completed_at: new Date().toISOString(),
            new_count: final?.reduce((n, t) => n + t.fresh_count, 0) ?? 0,
            error_summary: errors.length
              ? errors
                  .map((t) => t.error_summary)
                  .filter(Boolean)
                  .join("; ")
                  .slice(0, 1000)
              : null,
          })
          .eq("id", id);
        return;
      }
      const task = await rpc("claim_signals_collection_task", {
        p_id: next.id,
        p_fx: run.snapshot.fx,
      });
      if (task) await execute(task, run.snapshot);
    }
  } catch (e) {
    await svc
      .from("search_runs")
      .update({
        error_summary:
          e instanceof Error ? e.message : "Collection interrupted",
      })
      .eq("id", id);
  } finally {
    await svc
      .from("collection_runs")
      .update({ lease_until: null })
      .eq("id", id);
  }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    // Internal workers may continue an already-approved run, never create one.
    let internal = jwt === key;
    if (!internal && jwt.startsWith("sb_secret_")) {
      const caller = createClient(base,jwt,{auth:{persistSession:false,autoRefreshToken:false}});
      const access=await caller.rpc("signals_collection_worker_access");
      internal=!access.error&&access.data===true;
    }
    if (internal) {
      const body = await req.json();
      if (body.action === "health")
        return reply({
          treg_configured: !!Deno.env.get("TREG_TOKEN"),
          apify_configured: !!Deno.env.get("APIFY_TOKEN"),
        });
      if (body.action !== "work")
        return reply(
          { error: "Only existing runs may be continued by the worker" },
          403,
        );
      const { data: run } = await svc
        .from("collection_runs")
        .select("id")
        .eq("id", body.id)
        .maybeSingle();
      if (!run) return reply({ error: "Run unavailable" }, 404);
      EdgeRuntime.waitUntil(work(run.id));
      return reply({ id: run.id });
    }
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
      return reply({
        treg_configured: !!Deno.env.get("TREG_TOKEN"),
        apify_configured: !!Deno.env.get("APIFY_TOKEN"),
      });
    if (body.action === "start") {
      const p = await plan(
        body.workspace_id,
        body.kind === "test",
        body.include_paid === true,
      );
      if (body.retry_id) {
        const { data: failed, error } = await svc
          .from("source_tasks")
          .select("input,status")
          .eq("run_id", body.retry_id)
          .eq("workspace_id", body.workspace_id)
          .in("status", ["failed", "cancelled"]);
        if (error || !failed?.length) throw Error("No failed sources to retry");
        p.jobs = p.jobs.filter((j) =>
          failed.some(
            (t) =>
              t.input.adapter === j.adapter &&
              t.input.url === j.url &&
              t.input.query === j.query &&
              t.input.person_id === j.person_id,
          ),
        );
        if (!p.jobs.length)
          throw Error(
            "Source settings changed. Start a new collection instead",
          );
      }
      const user = createClient(base, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: "Bearer " + jwt } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: id, error } = await user.rpc("start_signals_collection", {
        p_workspace: body.workspace_id,
        p_key: crypto.randomUUID(),
        p_snapshot: p.snapshot,
        p_jobs: p.jobs,
        p_kind: body.kind === "test" ? "test" : "manual",
      });
      if (error) throw Error(error.message);
      EdgeRuntime.waitUntil(work(id));
      return reply({ id });
    }
    if (body.action === "work") {
      const { data: r } = await svc
        .from("collection_runs")
        .select("id")
        .eq("id", body.id)
        .maybeSingle();
      if (!r) return reply({ error: "Run unavailable" }, 404);
      EdgeRuntime.waitUntil(work(r.id));
      return reply({ id: r.id });
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "Collection unavailable" },
      400,
    );
  }
});
