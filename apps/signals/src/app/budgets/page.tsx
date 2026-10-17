import Link from "next/link";
import { Frame } from "@/components/frame";
import { adminSummary } from "@/lib/admin-summary";
import { money, budgetNumbers } from "@/lib/budget";
export default async function Budgets() {
  const a = await adminSummary();
  return (
    <Frame admin email={a.user.email ?? ""}>
      <div className="screen-head">
        <h1>Budgets</h1>
      </div>
      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Client",
                  "Period",
                  "Budget",
                  "Used",
                  "Left",
                  "Renews",
                  "Per usable card",
                  "",
                ].map((x, i) => (
                  <th key={i}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.clients.map((c) => {
                const b = a.budgets.get(c.id),
                  n = b ? budgetNumbers(b) : null;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={"/clients/" + c.id}>{c.name}</Link>
                    </td>
                    <td>
                      {b
                        ? b.budget.period_start + " to " + b.budget.period_end
                        : "Not set"}
                      {b?.budget.is_test && (
                        <span className="badge">Test budget</span>
                      )}
                    </td>
                    <td>{b ? money(b.budget.amount) : "–"}</td>
                    <td>
                      {b ? money(b.spent) : "–"}
                      {b && (
                        <meter
                          className={
                            Number(b.spent) / Number(b.budget.amount) > 0.85
                              ? "hot"
                              : ""
                          }
                          min={0}
                          max={Number(b.budget.amount)}
                          value={Number(b.spent)}
                          aria-label={"Budget used by " + c.name}
                        />
                      )}
                    </td>
                    <td>{n ? money(n.available) : "–"}</td>
                    <td>{b?.budget.period_end ?? "–"}</td>
                    <td>–</td>
                    <td>
                      <Link
                        className="button secondary"
                        href={"/clients/" + c.id + "/budget"}
                      >
                        Renew or top up
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small-note">
          When a budget runs out, collection pauses and the client's list says
          'Paused until your budget renews'.
        </p>
      </section>
    </Frame>
  );
}
