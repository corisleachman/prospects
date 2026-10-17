"use server";
import { requireAdmin } from "@/lib/access";
import { revalidatePath } from "next/cache";
import { schedule } from "@/lib/schedule";
async function invoke(body: Record<string, unknown>) {
  const { db } = await requireAdmin();
  const { data, error } = await db.functions.invoke("signals-pipeline", {
    body,
  });
  if (error) {
    let message = "Test service unavailable";
    try {
      message = (await (error as any).context.json()).error ?? message;
    } catch {}
    throw Error(message);
  }
  if (data?.error) throw Error(data.error);
  return data;
}
export async function refreshTest(workspace: string, id: string) {
  const { db } = await requireAdmin();
  const { data, error } = await db
    .from("pipeline_runs")
    .select("id,status,summary,error_summary,samples_reviewed,created_at")
    .eq("workspace_id", workspace)
    .eq("id", id)
    .single();
  if (error) throw Error("Test unavailable");
  if (["collecting", "triage", "score"].includes(data.status))
    await invoke({ action: "work", id }).catch(() => {});
  const { data: cards, error: ce } = await db
    .from("campaign_signals")
    .select(
      "id,relevance,polarity,why_this_person,companies!campaign_signals_company_id_fkey(name),people!campaign_signals_person_id_fkey(name,title),signals!campaign_signals_signal_id_workspace_id_fkey(id,factual_summary),message_drafts(channel,body,subject,version)",
    )
    .eq("workspace_id", workspace)
    .eq("pipeline_run_id", id)
    .order("relevance", { ascending: false });
  if (ce) throw Error("Sample cards unavailable");
  const ids = (cards ?? []).map((c: any) => c.signals?.id).filter(Boolean);
  const sources = ids.length
    ? await db
        .from("signal_sources")
        .select(
          "signal_id,evidence_items!signal_sources_evidence_item_id_workspace_id_fkey(id,source_url,source_name,published_at)",
        )
        .in("signal_id", ids)
    : { data: [], error: null };
  if (sources.error) throw Error("Card sources unavailable");
  return {
    ...data,
    cards: (cards ?? []).map((c) => ({
      ...c,
      sources: (sources.data ?? [])
        .filter((x) => x.signal_id === (c.signals as any)?.id)
        .map((x) => x.evidence_items),
    })),
  };
}
async function startTest(workspace: string, paid: boolean) {
  const data = await invoke({
    action: "start",
    workspace_id: workspace,
    include_paid: paid,
  });
  return refreshTest(workspace, data.id);
}
async function reviewTest(workspace: string, id: string) {
  const { db } = await requireAdmin();
  const { error } = await db.rpc("review_signals_test", {
    p_workspace: workspace,
    p_run: id,
  });
  if (error) throw Error(error.message);
}
async function launchClient(workspace: string, id: string) {
  const { db } = await requireAdmin();
  const [{ data: w, error: we }, { data: routes, error: re }] =
    await Promise.all([
      db.from("workspaces").select("timezone").eq("id", workspace).single(),
      db
        .from("delivery_rules")
        .select("morning_email_time")
        .eq("workspace_id", workspace)
        .eq("enabled", true)
        .not("user_id", "is", null),
    ]);
  if (we || re) throw Error("Delivery settings unavailable");
  const next = schedule(
    w.timezone,
    (routes ?? []).flatMap((r) =>
      r.morning_email_time ? [r.morning_email_time.slice(0, 5)] : [],
    ),
    new Date(),
    true,
  );
  const { error } = await db.rpc("go_live_signals", {
    p_workspace: workspace,
    p_run: id,
    p_first: next.email,
    p_next: next.collect,
  });
  if (error) throw Error(error.message);
  revalidatePath("/clients");
  revalidatePath("/clients/" + workspace);
  return next.email;
}

export async function testCommand(
  action: "start" | "refresh" | "review" | "launch",
  workspace: string,
  id = "",
  paid = false,
) {
  try {
    const data =
      action === "start"
        ? await startTest(workspace, paid)
        : action === "refresh"
          ? await refreshTest(workspace, id)
          : action === "review"
            ? await reviewTest(workspace, id)
            : await launchClient(workspace, id);
    return { data, error: null };
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
}
