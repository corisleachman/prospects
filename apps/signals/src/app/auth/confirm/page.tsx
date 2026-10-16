import { AuthLayout } from "@/components/auth-layout";
import { Submit } from "@/components/submit";
import { safeNext } from "@/lib/security";
import { confirmAuthentication } from "../../actions";
export default async function Confirm({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; token_hash?: string; next?: string }>;
}) {
  const q = await searchParams;
  return (
    <AuthLayout
      title={q.type === "invite" ? "You’re invited." : "Reset your password."}
    >
      <p className="intro">
        Continue to securely set your password. Opening this page won’t use your
        link.
      </p>
      <form action={confirmAuthentication}>
        <input type="hidden" name="type" value={q.type ?? ""} />
        <input type="hidden" name="token_hash" value={q.token_hash ?? ""} />
        <input
          type="hidden"
          name="next"
          value={safeNext(q.next, "/set-password")}
        />
        <Submit pending="Checking link…">Continue</Submit>
      </form>
    </AuthLayout>
  );
}
