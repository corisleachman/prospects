"use server";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/access";
import { validToken } from "@/lib/security";
export async function acceptInvite(form: FormData) {
  const token = form.get("token");
  if (!validToken(token)) redirect("/accept-invite?error=unavailable");
  const { db } = await requireUser("/accept-invite?token=" + token);
  const { data, error } = await db.rpc("accept_signals_invite", {
    p_token_hash: createHash("sha256").update(token).digest("hex"),
  });
  if (error) redirect("/accept-invite?error=unavailable");
  redirect("/today?workspace=" + encodeURIComponent(String(data)));
}
