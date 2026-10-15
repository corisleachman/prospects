import Link from "next/link";
import { AuthLayout } from "@/components/auth-layout";
import { Submit } from "@/components/submit";
import { configured } from "@/lib/supabase/server";
import { requestReset } from "../actions";
export default async function Forgot({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const q = await searchParams;
  return (
    <AuthLayout title="A fresh start.">
      <p className="intro">We’ll email you a link to reset your password.</p>
      {q.sent ? (
        <p role="status" className="notice">
          If there’s an account for that email, a reset link is on its way.
          Check your inbox.
        </p>
      ) : (
        <>
          {q.error && (
            <p className="notice" role="alert">
              We couldn’t request a reset just now. Try again shortly.
            </p>
          )}
          <form action={requestReset}>
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                maxLength={254}
                required
                disabled={!configured()}
              />
            </label>
            {configured() && (
              <Submit pending="Requesting link…">Send reset link</Submit>
            )}
          </form>
        </>
      )}
      <Link className="quiet-link" href="/login">
        Back to sign in
      </Link>
    </AuthLayout>
  );
}
