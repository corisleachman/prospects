import Link from "next/link";
import { Frame } from "@/components/frame";
import { RowLink } from "@/components/row-link";
import { adminSummary } from "@/lib/admin-summary";
import { money, budgetNumbers } from "@/lib/budget";
export default async function Clients({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [a, q] = await Promise.all([adminSummary(), searchParams]);
  const normal = [...a.budgets.values()].filter((b) => b && !b.budget.is_test);
  const amount = normal.reduce((n, b) => n + Number(b!.budget.amount), 0),
    used = a.monthSpend;
  return (
    <Frame admin email={a.user.email ?? ""}>
      <div className="screen-head">
        <div>
          <h1>Clients</h1>
          <p className="muted">Everyone you run signals for</p>
        </div>
        <Link className="button" href="/clients/new">
          + New client
        </Link>
      </div>
      {q.error && (
        <p className="notice" role="alert">
          {q.error === "create"
            ? "We couldn’t create that client. Check the name and try again."
            : "Something went wrong. Please try again."}
        </p>
      )}
      <div className="stats-grid four">
        <div className="stat-tile">
          <span>Live clients</span>
          <strong>{a.clients.filter((c) => c.status === "live").length}</strong>
          <small>of {a.clients.length}</small>
        </div>
        <div className="stat-tile">
          <span>Cards yesterday</span>
          <strong>–</strong>
        </div>
        <div className="stat-tile">
          <span>Used last 7 days</span>
          <strong>–</strong>
        </div>
        <div className="stat-tile">
          <span>Spend this month</span>
          <strong>{normal.length ? money(used) : "–"}</strong>
          <small>
            {normal.length ? "of " + money(amount) + " total budgets" : ""}
          </small>
        </div>
      </div>
      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Client",
                  "Status",
                  "Profiles",
                  "Companies watched",
                  "Cards yesterday",
                  "Used 7 days",
                  "Budget left",
                  "Last run",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.clients.map((c) => {
                const b = a.budgets.get(c.id),
                  bn = b ? budgetNumbers(b) : null,
                  run = a.runs.find((r) => r.workspace_id === c.id);
                return (
                  <RowLink key={c.id} href={"/clients/" + c.id}>
                    <td>
                      <Link href={"/clients/" + c.id}>{c.name}</Link>
                      <small className="small-note">{c.timezone}</small>
                    </td>
                    <td>
                      <span className="badge">
                        {c.paused_reason?.startsWith("budget:")
                          ? "Paused: budget used up"
                          : c.status === "setup"
                            ? "Setting up"
                            : c.status}
                      </span>
                    </td>
                    <td>
                      {a.profiles.filter((p) => p.workspace_id === c.id).length}
                    </td>
                    <td>
                      {
                        new Set(
                          a.watch
                            .filter((w) => w.workspace_id === c.id)
                            .map((w) => w.company_id),
                        ).size
                      }
                    </td>
                    <td>–</td>
                    <td>–</td>
                    <td>
                      <Link href={"/clients/" + c.id + "/budget"}>
                        {bn ? money(bn.available) : "Set budget"}
                      </Link>
                      {bn && (
                        <meter
                          className={
                            bn.available / Number(b!.budget.amount) < 0.15
                              ? "hot"
                              : ""
                          }
                          min={0}
                          max={Number(b!.budget.amount)}
                          value={bn.available}
                          aria-label={"Budget left for " + c.name}
                        />
                      )}
                    </td>
                    <td>
                      {run ? (
                        <>
                          <span>
                            {new Date(run.started_at).toLocaleString("en-GB", {
                              timeZone: c.timezone,
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </span>
                          <small className="small-note">
                            {run.run_type === "find_more"
                              ? "Find matches · "
                              : ""}
                            {run.status}
                          </small>
                        </>
                      ) : (
                        "Not run"
                      )}
                    </td>
                  </RowLink>
                );
              })}
            </tbody>
          </table>
        </div>
        {!a.clients.length && (
          <p className="empty-state">
            Your first client starts here. Create a private workspace to get
            started.
          </p>
        )}
      </section>
    </Frame>
  );
}
