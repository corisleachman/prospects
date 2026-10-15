import "server-only";
import { redirect } from "next/navigation";
import { configured, sessionClient } from "./supabase/server";
export async function requireUser(next = "/today") {
  if (!configured()) redirect("/login");
  const db = await sessionClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login?next=" + encodeURIComponent(next));
  return { db, user };
}
export async function access(next = "/today") {
  const { db, user } = await requireUser(next);
  const { data: admin, error: adminError } = await db
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (adminError) throw new Error("Workspace permissions are unavailable");
  const { data: members, error } = await db
    .from("workspace_members")
    .select("workspace_id,role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .in("role", ["client_admin", "client_user"]);
  if (error) throw new Error("Workspace permissions are unavailable");
  return { db, user, isAdmin: Boolean(admin), members: members ?? [] };
}
export async function requireAdmin() {
  const ctx = await access("/clients");
  if (!ctx.isAdmin) redirect("/not-allowed");
  return ctx;
}
