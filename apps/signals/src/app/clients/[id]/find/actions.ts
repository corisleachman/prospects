"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/access";
import { serviceClient } from "@/lib/supabase/server";
async function invoke(body: Record<string, unknown>) {
  const { db } = await requireAdmin();
  const { data, error } = await db.functions.invoke("signals-discovery", {
    body,
  });
  if (error) {
    let message = "Discovery service is unavailable.";
    try {
      const detail = await (error as any).context.json();
      message = detail.error ?? message;
    } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
function back(
  workspace: string,
  profile: string,
  error?: string,
  preview?: string,
) {
  revalidatePath("/clients/" + workspace + "/find");
  redirect(
    "/clients/" +
      workspace +
      "/find?profile=" +
      encodeURIComponent(profile) +
      (error ? "&error=" + encodeURIComponent(error) : "") +
      (preview ? "&preview=" + preview : ""),
  );
}
export async function estimateMatches(form: FormData) {
  const workspace = String(form.get("workspace")),
    profile = String(form.get("profile"));
  let result;
  try {
    result = await invoke({
      action: "estimate",
      profile_id: profile,
      limit: Number(form.get("limit") ?? 25),
      keywords: String(form.get("keywords") ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
    });
  } catch (e) {
    back(workspace, profile, (e as Error).message);
  }
  back(workspace, profile, undefined, result.id);
}
export async function startMatches(form: FormData) {
  const { db } = await requireAdmin();
  const workspace = String(form.get("workspace")),
    profile = String(form.get("profile")),
    preview = String(form.get("preview"));
  try {
    const { data: p, error } = await db
      .from("discovery_previews")
      .select("profile_id,workspace_id")
      .eq("id", preview)
      .single();
    if (error || p.workspace_id !== workspace || p.profile_id !== profile)
      throw new Error("Preview unavailable");
    const service = serviceClient();
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
      const { error: mailError } = await service.rpc(
        "signals_discovery_mail_config",
        {
          p_settings: {
            key: process.env.RESEND_API_KEY,
            from: process.env.RESEND_FROM,
            origin: process.env.APP_ORIGIN,
          },
        },
      );
      if (mailError)
        throw new Error("Worker alert configuration could not be saved.");
    }
    await invoke({ action: "start", id: preview });
  } catch (e) {
    back(workspace, profile, (e as Error).message, preview);
  }
  back(workspace, profile, undefined, preview);
}
export async function pollPreview(id: string) {
  const { db } = await requireAdmin();
  const { data, error } = await db
    .from("discovery_previews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error("Preview unavailable");
  if (data.status === "queued")
    await invoke({ action: "work", id }).catch(() => {});
  return data;
}
export async function saveWatchlist(form: FormData) {
  const { db } = await requireAdmin();
  const workspace = String(form.get("workspace")),
    profile = String(form.get("profile")),
    preview = String(form.get("preview"));
  const { data: p, error: lookup } = await db
    .from("discovery_previews")
    .select("workspace_id,profile_id")
    .eq("id", preview)
    .single();
  if (lookup || p.workspace_id !== workspace || p.profile_id !== profile)
    back(workspace, profile, "Preview unavailable");
  const { error } = await db.rpc("save_signals_watchlist", {
    p_id: preview,
    p_company_keys: form.getAll("companies"),
    p_person_keys: form.getAll("people"),
  });
  if (error) back(workspace, profile, error.message, preview);
  revalidatePath("/clients/" + workspace);
  back(workspace, profile, undefined, preview);
}
export async function setRefresh(form: FormData) {
  const { db } = await requireAdmin();
  const workspace = String(form.get("workspace")),
    profile = String(form.get("profile"));
  const { data: p } = await db
    .from("campaigns")
    .select("workspace_id")
    .eq("id", profile)
    .single();
  if (p?.workspace_id !== workspace)
    back(workspace, profile, "Profile unavailable");
  const { error } = await db.rpc("set_signals_refresh", {
    p_profile: profile,
    p_enabled: form.get("enabled") === "on",
  });
  back(workspace, profile, error?.message);
}
