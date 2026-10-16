"use server";
import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/security";
import { requireUser } from "@/lib/access";
function origin() {
  const value = process.env.APP_ORIGIN;
  if (!value) throw new Error("App origin is unavailable");
  return new URL(value).origin;
}
export async function signIn(form: FormData) {
  const next = safeNext(form.get("next"), "/");
  const db = await sessionClient();
  const { error } = await db.auth.signInWithPassword({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  });
  if (error)
    redirect("/login?error=credentials&next=" + encodeURIComponent(next));
  redirect(next);
}
export async function signOut() {
  const db = await sessionClient();
  await db.auth.signOut({ scope: "local" });
  redirect("/login");
}
export async function requestReset(form: FormData) {
  const db = await sessionClient();
  const { error } = await db.auth.resetPasswordForEmail(
    String(form.get("email") ?? "").trim(),
    { redirectTo: origin() + "/auth/callback?next=/set-password" },
  );
  if (error) redirect("/forgot-password?error=unavailable");
  redirect("/forgot-password?sent=1");
}
export async function changePassword(form: FormData) {
  const invite = String(form.get("invite") ?? "");
  const path =
    "/set-password" + (invite ? "?invite=" + encodeURIComponent(invite) : "");
  const { db } = await requireUser(path);
  const password = String(form.get("password") ?? "");
  if (
    password.length < 12 ||
    password.length > 128 ||
    password !== form.get("confirm")
  )
    redirect(path + (invite ? "&" : "?") + "error=password");
  const { error } = await db.auth.updateUser({ password });
  if (error) redirect(path + (invite ? "&" : "?") + "error=unavailable");
  redirect(invite ? "/accept-invite?token=" + encodeURIComponent(invite) : "/");
}
export async function confirmAuthentication(form: FormData) {
  const type = form.get("type"),
    token_hash = String(form.get("token_hash") ?? "");
  if ((type !== "invite" && type !== "recovery") || !token_hash)
    redirect("/login?error=link");
  const db = await sessionClient();
  const { error } = await db.auth.verifyOtp({ type, token_hash });
  if (error) redirect("/login?error=link");
  redirect(safeNext(form.get("next"), "/set-password"));
}
