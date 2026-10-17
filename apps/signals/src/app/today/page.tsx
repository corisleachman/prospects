import { redirect } from "next/navigation";
import Link from "next/link";
import { access } from "@/lib/access";
import { Frame } from "@/components/frame";
export default async function Today({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; viewAs?: string }>;
}) {
  const [ctx, q] = await Promise.all([access("/today"), searchParams]);
  const viewing = ctx.isAdmin && q.viewAs === "1" && q.workspace;
  const ids = viewing ? [q.workspace!] : ctx.members.map((m) => m.workspace_id);
  if (!ids.length)
    return (
      <Frame admin={ctx.isAdmin} email={ctx.user.email ?? ""}>
        <p className="eyebrow">Today</p>
        <h1>
          {ctx.isAdmin
            ? "Your clients’ next conversations."
            : "Your account is ready."}
        </h1>
        <p className="intro">
          {ctx.isAdmin
            ? "Create a client and invite their team to get started."
            : "Accept your workspace invitation to see your Today view."}
        </p>
        {ctx.isAdmin && (
          <Link className="button" href="/clients">
            Open Clients
          </Link>
        )}
      </Frame>
    );
  if (q.workspace && !ids.includes(q.workspace)) redirect("/not-allowed");
  const { data: workspaces, error } = await ctx.db
    .from("workspaces")
    .select("id,name,timezone")
    .in("id", ids)
    .eq("is_signals_client", true)
    .neq("status", "archived");
  if (error) throw new Error("Workspace unavailable");
  const workspace = workspaces?.find((w) => w.id === (q.workspace ?? ids[0]));
  if (!workspace) redirect("/not-allowed");
  const member = ctx.members.find((m) => m.workspace_id === workspace.id);
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: workspace.timezone,
  }).format(new Date());
  return (
    <Frame
      admin={ctx.isAdmin && !viewing}
      workspace={workspace.name}
      email={ctx.user.email ?? ""}
    >
      {viewing && (
        <p className="notice">
          Viewing as {workspace.name}.{" "}
          <Link href={"/clients/" + workspace.id}>Exit</Link>
        </p>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {workspace.name} / {today}
          </p>
          <h1>
            Today’s reasons
            <br />
            <em>to connect.</em>
          </h1>
        </div>
        <p className="page-lede">
          {member?.role === "client_admin"
            ? "Your client’s cards"
            : "Your cards"}
          .<br />
          Fresh evidence, considered carefully.
        </p>
      </div>
      {workspaces && workspaces.length > 1 && (
        <nav className="workspace-switcher" aria-label="Choose workspace">
          {workspaces.map((w) => (
            <Link
              key={w.id}
              aria-current={w.id === workspace.id ? "page" : undefined}
              href={"/today?workspace=" + w.id}
            >
              {w.name}
            </Link>
          ))}
        </nav>
      )}
      <section className="today-empty">
        <p className="eyebrow">No cards yet</p>
        <div className="empty-line" aria-hidden="true" />
        <h2>
          A good reason
          <br />
          is worth waiting for.
        </h2>
        <p>
          Nothing strong enough today.
          <br />
          We only show fresh, relevant signals.
        </p>
        <span className="badge">You choose when to reach out</span>
      </section>
    </Frame>
  );
}
