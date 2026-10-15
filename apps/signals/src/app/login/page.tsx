import Link from "next/link";
import { AuthLayout } from "@/components/auth-layout";
import { Submit } from "@/components/submit";
import { configured } from "@/lib/supabase/server";
import { safeNext } from "@/lib/security";
import { signIn } from "../actions";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const q = await searchParams;
  const ready = configured();
  return (
    <AuthLayout title="Welcome back.">
      <p className="intro">Sign in to your workspace.</p>
      {q.error && (
        <p role="alert" className="notice">
          {q.error === "link"
            ? "That link has expired or has already been used. Request a fresh link."
            : "Those details didn’t work. Check your email and password."}
        </p>
      )}
      {!ready && (
        <p role="status" className="notice">
          Sign-in isn’t ready yet. Please contact your workspace administrator.
        </p>
      )}
      <form action={signIn}>
        <input type="hidden" name="next" value={safeNext(q.next, "/")} />
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            disabled={!ready}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={!ready}
          />
        </label>
        {ready && (
          <Submit pending="Signing in…">
            Sign in <span aria-hidden="true">↗</span>
          </Submit>
        )}
      </form>
      <Link className="quiet-link" href="/forgot-password">
        Forgot your password?
      </Link>
      <p className="small-note">
        Access is by invitation. Ask your administrator to invite you.
      </p>
    </AuthLayout>
  );
}
