"use server";
import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { clientRole, emailAddress } from "@/lib/security";
import { serviceClient } from "@/lib/supabase/server";
import { sendInvitation } from "@/lib/mail";
export async function createClientWorkspace(form: FormData) {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("create_signals_client", {
    p_name: String(form.get("name") ?? "").trim(),
    p_timezone: String(form.get("timezone") ?? "Europe/London"),
  });
  if (error) redirect("/clients?error=create");
  revalidatePath("/clients");
  redirect("/clients/" + data + "/setup?step=1");
}
export async function inviteClientMember(form: FormData) {
  const { db } = await requireAdmin();
  let role, email;
  try {
    role = clientRole(form.get("role"));
    email = emailAddress(form.get("email"));
  } catch {
    redirect("/clients?error=details");
  }
  // Check all delivery configuration before writing an invitation or creating Auth users.
  if (
    !process.env.RESEND_API_KEY ||
    !process.env.RESEND_FROM ||
    !process.env.APP_ORIGIN ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    redirect("/clients?error=mail-configuration");
  const workspace = String(form.get("workspace") ?? "");
  const { data: client, error: lookup } = await db
    .from("workspaces")
    .select("id,name")
    .eq("id", workspace)
    .eq("is_signals_client", true)
    .neq("status", "archived")
    .single();
  if (lookup || !client) redirect("/clients?error=client");
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: invitation, error } = await db.rpc("create_signals_invite", {
    p_workspace_id: workspace,
    p_email: email,
    p_role: role,
    p_token_hash: hash,
  });
  if (error || !invitation) redirect("/clients?error=invite");
  try {
    const base = new URL(process.env.APP_ORIGIN).origin;
    let url = base + "/accept-invite?token=" + token;
    const auth = serviceClient();
    const { data: link, error: linkError } = await auth.auth.admin.generateLink(
      { type: "invite", email },
    );
    if (linkError) {
      // Existing accounts sign in with their existing password. No magic-link login.
      if (
        ![
          "email_exists",
          "user_already_exists",
          "email_already_registered",
        ].includes(linkError.code ?? "")
      )
        throw linkError;
    } else {
      if (!link.properties?.hashed_token)
        throw new Error("Invitation link is unavailable");
      const next = "/set-password?invite=" + token;
      const confirm = new URL("/auth/confirm", base);
      confirm.searchParams.set("token_hash", link.properties.hashed_token);
      confirm.searchParams.set("type", "invite");
      confirm.searchParams.set("next", next);
      url = confirm.toString();
    }
    await sendInvitation(email, client.name, url, String(invitation));
  } catch {
    await db.rpc("mark_signals_invite_delivery", {
      p_id: invitation,
      p_sent: false,
    });
    revalidatePath("/clients");
    redirect("/clients?error=delivery");
  }
  const { error: deliveryError } = await db.rpc(
    "mark_signals_invite_delivery",
    { p_id: invitation, p_sent: true },
  );
  revalidatePath("/clients");
  redirect(
    deliveryError ? "/clients?error=delivery-record" : "/clients?invited=1",
  );
}
