import "server-only";
import { requireAdmin } from "./access";
import type { BudgetOverview } from "./budget";
export async function adminSummary() {
  const { db, user } = await requireAdmin();
  const [w, p, watch, r, monthSpend] = await Promise.all([
    db
      .from("workspaces")
      .select("id,name,status,timezone,paused_reason,created_at")
      .eq("is_signals_client", true)
      .order("created_at", { ascending: false }),
    db
      .from("campaigns")
      .select("id,workspace_id,code,name,status")
      .neq("status", "archived"),
    db
      .from("campaign_prospects")
      .select("workspace_id,campaign_id,company_id,person_id")
      .not("company_id", "is", null)
      .eq("group_type", "watchlist"),
    db
      .from("search_runs")
      .select("id,workspace_id,status,started_at,completed_at,run_type")
      .order("started_at", { ascending: false })
      .limit(100),
    db.rpc("signals_admin_month_spend"),
  ]);
  if (w.error || p.error || watch.error || r.error || monthSpend.error)
    throw new Error("Client summaries unavailable");
  const budgets = await Promise.all(
    (w.data ?? []).map(async (c) => {
      const x = await db.rpc("signals_budget_overview", { p_workspace: c.id });
      if (x.error) throw new Error("Budget summary unavailable");
      return [c.id, x.data as BudgetOverview | null] as const;
    }),
  );
  return {
    db,
    user,
    monthSpend: Number(monthSpend.data ?? 0),
    clients: w.data ?? [],
    profiles: p.data ?? [],
    watch: watch.data ?? [],
    runs: r.data ?? [],
    budgets: new Map(budgets),
  };
}
