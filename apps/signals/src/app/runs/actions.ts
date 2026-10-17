"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
async function invoke(body: Record<string, unknown>) {
  const { db } = await requireAdmin();
  const { data, error } = await db.functions.invoke("signals-collect", {
    body,
  });
  if (error) {
    let message = "Collection service unavailable";
    try {
      message = (await (error as any).context.json()).error ?? message;
    } catch {}
    throw Error(message);
  }
  if (data?.error) throw Error(data.error);
  return data;
}
export async function runCollection(form: FormData) {
  let result;
  try {
    result = await invoke({
      action: "start",
      include_paid: form.get("include_paid") === "on",
      workspace_id: String(form.get("workspace")),
      retry_id: String(form.get("retry") ?? "") || undefined,
    });
  } catch (e) {
    redirect("/runs?error=" + encodeURIComponent((e as Error).message));
  }
  revalidatePath("/runs");
  redirect("/runs?run=" + result.id);
}
export async function pollCollection(id: string) {
  const { db } = await requireAdmin();
  const { data, error } = await db
    .from("search_runs")
    .select("status")
    .eq("id", id)
    .single();
  if (error) throw Error("Run unavailable");
  if (["queued", "running"].includes(data.status))
    await invoke({ action: "work", id }).catch(() => {});
  return data.status;
}
