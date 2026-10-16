import { AuthLayout } from "@/components/auth-layout";
import { Submit } from "@/components/submit";
import { requireUser } from "@/lib/access";
import { changePassword } from "../actions";
export default async function SetPassword({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; error?: string }>;
}) {
  const q = await searchParams;
  await requireUser(
    "/set-password" +
      (q.invite ? "?invite=" + encodeURIComponent(q.invite) : ""),
  );
  return (
    <AuthLayout title="Make it yours.">
      <p className="intro">Choose a password with at least 12 characters.</p>
      {q.error && (
        <p className="notice" role="alert">
          {q.error === "password"
            ? "Use 12 to 128 characters and make sure both passwords match."
            : "We couldn’t update your password. Request a fresh reset link and try again."}
        </p>
      )}
      <form action={changePassword}>
        <input type="hidden" name="invite" value={q.invite ?? ""} />
        <label>
          New password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <Submit pending="Saving password…">Save password</Submit>
      </form>
    </AuthLayout>
  );
}
