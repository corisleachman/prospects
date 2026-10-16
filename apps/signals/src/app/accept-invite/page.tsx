import { createHash } from "node:crypto";
import { AuthLayout } from "@/components/auth-layout";
import { Submit } from "@/components/submit";
import { requireUser } from "@/lib/access";
import { validToken } from "@/lib/security";
import { acceptInvite } from "./actions";
import { signOut } from "../actions";
export default async function Accept({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const q = await searchParams;
  const { db, user } = await requireUser(
    "/accept-invite" + (q.token ? "?token=" + encodeURIComponent(q.token) : ""),
  );
  const { data, error } = validToken(q.token)
    ? await db.rpc("preview_signals_invite", {
        p_token_hash: createHash("sha256").update(q.token).digest("hex"),
      })
    : { data: null, error: true };
  const invite = data?.[0];
  return (
    <AuthLayout
      title={invite ? "Your workspace is ready." : "Invitation unavailable."}
    >
      {invite && !error ? (
        <>
          <p className="intro">
            Join {invite.workspace_name} as a{" "}
            {invite.invite_role === "client_admin"
              ? "client admin"
              : "client user"}
            .
          </p>
          <p className="small-note">
            Signed in as {user.email}. You’ll only have access to this client’s
            workspace.
          </p>
          <form action={acceptInvite}>
            <input type="hidden" name="token" value={q.token} />
            <Submit pending="Joining workspace…">Accept invitation</Submit>
          </form>
        </>
      ) : (
        <p role="alert" className="notice">
          This link may have expired, been used or belong to another account.
          Ask your administrator for a fresh invitation.
        </p>
      )}
      <form action={signOut}>
        <button className="text-button">Sign out to use another account</button>
      </form>
    </AuthLayout>
  );
}
