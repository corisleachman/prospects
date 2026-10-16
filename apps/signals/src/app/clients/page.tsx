import Link from "next/link";
import { money, budgetNumbers, type BudgetOverview } from "@/lib/budget";
import { requireAdmin } from "@/lib/access";
import { Frame } from "@/components/frame";
import { Submit } from "@/components/submit";
import { createClientWorkspace, inviteClientMember } from "./actions";
const errors: Record<string, string> = {
  create: "We couldn’t create that client. Check the name and try again.",
  details: "Enter a valid email address and choose a client role.",
  client: "That client is unavailable.",
  invite: "We couldn’t create the invitation. Try again.",
  delivery:
    "The invitation couldn’t be sent and has been revoked. Check email delivery, then send a fresh invitation.",
  "mail-configuration":
    "Invitation email isn’t ready yet. Contact the platform administrator.",
  "delivery-record":
    "The email was sent, but its delivery record couldn’t be saved. Check the invitation before resending.",
};
export default async function Clients({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; invited?: string }>;
}) {
  const [{ db, user }, q] = await Promise.all([requireAdmin(), searchParams]);
  const [{ data: clients, error }, { data: invites, error: inviteError }] =
    await Promise.all([
      db
        .from("workspaces")
        .select("id,name,status,timezone,created_at,paused_reason")
        .eq("is_signals_client", true)
        .order("created_at", { ascending: false }),
      db
        .from("workspace_invites")
        .select(
          "id,workspace_id,email,role,expires_at,accepted_at,revoked_at,delivery_status,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
  if (error || inviteError) throw new Error("Client list unavailable");
  const budgetRows = await Promise.all(
    (clients ?? []).map(async (c) => {
      const r = await db.rpc("signals_budget_overview", { p_workspace: c.id });
      if (r.error) throw new Error("Budget summary unavailable");
      return [c.id, r.data as BudgetOverview | null] as const;
    }),
  );
  const budgets = new Map(budgetRows);
  return (
    <Frame admin email={user.email ?? ""}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Platform / Clients</p>
          <h1>
            A workspace
            <br />
            <em>for every client.</em>
          </h1>
        </div>
        <p className="page-lede">
          Set up a private space.
          <br />
          Invite the people who’ll use it.
        </p>
      </div>
      {q.error && (
        <p role="alert" className="notice">
          {errors[q.error] ?? "Something went wrong. Try again."}
        </p>
      )}
      {(q.created || q.invited) && (
        <p role="status" className="notice success">
          {q.invited
            ? "Invitation sent. Access starts when the recipient accepts."
            : "Client created. You can invite their team below."}
        </p>
      )}
      <section className="section">
        <div className="section-heading">
          <h2>Clients</h2>
          <span className="count">{clients?.length ?? 0} workspaces</span>
        </div>
        {clients?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Timezone</th>
                  <th>Budget</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={"/clients/" + c.id}>{c.name}</Link>
                    </td>
                    <td>
                      <span className="badge">
                        {c.paused_reason?.startsWith("budget:")
                          ? "Paused: budget " + c.paused_reason.slice(7)
                          : c.status}
                      </span>
                    </td>
                    <td>{c.timezone}</td>
                    <td>
                      <Link href={"/clients/" + c.id + "/budget"}>
                        {budgets.get(c.id)
                          ? money(budgets.get(c.id)!.budget.amount) +
                            " · " +
                            money(budgetNumbers(budgets.get(c.id)!).available) +
                            " left"
                          : "Set budget"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-mark" aria-hidden="true">
              ↗
            </span>
            <h3>Your first client starts here.</h3>
            <p>
              Create a workspace below. Their team will only see their own
              space.
            </p>
          </div>
        )}
      </section>
      <div className="setup-columns">
        <section className="section">
          <p className="eyebrow">01 / A private space</p>
          <h2>Create a client</h2>
          <form action={createClientWorkspace}>
            <label>
              Client name
              <input
                name="name"
                placeholder="Before: Work"
                maxLength={120}
                required
              />
            </label>
            <label>
              Timezone
              <select name="timezone" defaultValue="Europe/London">
                {[
                  "Europe/London",
                  "America/New_York",
                  "America/Chicago",
                  "America/Denver",
                  "America/Los_Angeles",
                  "Europe/Paris",
                  "Asia/Singapore",
                  "Australia/Sydney",
                  "UTC",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <Submit>Create client</Submit>
          </form>
        </section>
        <section className="section">
          <p className="eyebrow">02 / The right people</p>
          <h2>Invite a team member</h2>
          {clients?.some((c) => c.status !== "archived") ? (
            <form action={inviteClientMember}>
              <label>
                Client
                <select name="workspace" required>
                  {clients
                    .filter((c) => c.status !== "archived")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="off"
                  maxLength={254}
                  required
                />
              </label>
              <label>
                Access
                <select name="role" defaultValue="client_user">
                  <option value="client_user">
                    Client user · their own cards
                  </option>
                  <option value="client_admin">
                    Client admin · all client cards
                  </option>
                </select>
              </label>
              <p className="small-note">
                Neither role can edit setup or see costs. Invitations expire in
                seven days.
              </p>
              <Submit pending="Sending invitation…">Send invitation</Submit>
            </form>
          ) : (
            <p className="muted">
              Create a client first, then invite their team.
            </p>
          )}
        </section>
      </div>
      {Boolean(invites?.length) && (
        <section className="section">
          <div className="section-heading">
            <h2>Recent invitations</h2>
            <span className="count">Latest 50</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Client</th>
                  <th>Access</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invites?.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>
                      {clients?.find((c) => c.id === i.workspace_id)?.name ??
                        "Client"}
                    </td>
                    <td>
                      {i.role === "client_admin"
                        ? "Client admin"
                        : "Client user"}
                    </td>
                    <td>
                      {i.accepted_at
                        ? "Accepted"
                        : i.revoked_at
                          ? "Revoked"
                          : new Date(i.expires_at) < new Date()
                            ? "Expired"
                            : i.delivery_status === "sent"
                              ? "Awaiting acceptance"
                              : i.delivery_status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Frame>
  );
}
