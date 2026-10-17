"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import {
  validateProfile,
  type Profile,
  type ClientDetails,
} from "@/lib/profile";
export type SaveResult = { revision?: number; error?: string };
export async function saveClient(
  id: string,
  revision: number,
  details: ClientDetails,
): Promise<SaveResult> {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("save_signals_client", {
    p_id: id,
    p_revision: revision,
    p_details: details,
  });
  if (error) return { error: error.message };
  revalidatePath("/clients");
  return { revision: data };
}
export async function saveProfile(
  workspace: string,
  revision: number,
  profile: Profile,
): Promise<SaveResult> {
  const { db } = await requireAdmin();
  try {
    validateProfile(profile);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Check the profile fields.",
    };
  }
  const { data, error } = await db.rpc("save_signals_profile", {
    p_workspace_id: workspace,
    p_id: profile.id,
    p_revision: revision,
    p_profile: profile,
  });
  if (error)
    return {
      error:
        error.code === "23505"
          ? "Another profile already uses that name or code."
          : error.message,
    };
  return { revision: data };
}
export async function addProfile(form: FormData) {
  const { db } = await requireAdmin();
  const workspace = String(form.get("workspace"));
  const { data, error } = await db.rpc("create_signals_profile", {
    p_workspace_id: workspace,
  });
  redirect(
    "/clients/" +
      encodeURIComponent(workspace) +
      "/setup" +
      (error
        ? "?error=" + encodeURIComponent(error.message)
        : "?profile=" + data),
  );
}
export async function saveMemberName(form: FormData) {
  const { db } = await requireAdmin();
  const workspace = String(form.get("workspace"));
  const { error } = await db.rpc("set_signals_member_name", {
    p_workspace_id: workspace,
    p_user_id: String(form.get("user")),
    p_name: String(form.get("name") ?? ""),
  });
  revalidatePath("/clients/" + workspace);
  redirect(
    "/clients/" +
      workspace +
      (error
        ? "?error=" + encodeURIComponent(error.message)
        : "?memberSaved=1"),
  );
}
