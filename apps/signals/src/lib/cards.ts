import "server-only";
import { access } from "./access";
import { redirect } from "next/navigation";
export async function cardContext(
  q: { workspace?: string; viewAs?: string; show?: string; recipient?: string },
  history = false,
) {
  const ctx = await access(history ? "/history" : "/today"),
    viewing = ctx.isAdmin && q.viewAs === "1" && !!q.workspace,
    ids = viewing ? [q.workspace!] : ctx.members.map((m) => m.workspace_id);
  if (!ids.length) {
    if (ctx.isAdmin) redirect("/clients");
    redirect("/not-allowed");
  }
  const id = q.workspace ?? ids[0];
  if (!ids.includes(id)) redirect("/not-allowed");
  const { data: w, error } = await ctx.db
    .from("workspaces")
    .select("id,name,timezone,status,default_no_repeat_days")
    .eq("id", id)
    .eq("is_signals_client", true)
    .neq("status", "archived")
    .single();
  if (error || !w) redirect("/not-allowed");
  const { data, error: ce } = await ctx.db.rpc("signals_cards", {
    p_workspace: id,
    p_history: history,
    p_everyone: q.show === "everyone" || (viewing && q.show !== "mine"),
    p_recipient: ctx.isAdmin ? (q.recipient ?? null) : null,
  });
  if (ce) throw Error("Cards unavailable");
  return { ...ctx, workspace: w, viewing, data };
}
