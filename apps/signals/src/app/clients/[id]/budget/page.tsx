import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/access";
import { Frame } from "@/components/frame";
import { Submit } from "@/components/submit";
import { budgetNumbers, money, type BudgetOverview } from "@/lib/budget";
import { changeBudget, testCost, retryAlerts, savePricing } from "./actions";
export default async function Budget({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [{ id }, q, { db, user }] = await Promise.all([
    params,
    searchParams,
    requireAdmin(),
  ]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/not-allowed");
  const results = await Promise.all([
    db
      .from("workspaces")
      .select("id,name,status,paused_reason,timezone")
      .eq("id", id)
      .eq("is_signals_client", true)
      .maybeSingle(),
    db.rpc("signals_budget_overview", { p_workspace: id }),
    db
      .from("budget_history")
      .select("*")
      .eq("workspace_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("cost_ledger")
      .select("*")
      .eq("workspace_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("budget_alerts")
      .select("*")
      .eq("workspace_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("provider_pricing")
      .select("pricing_key,rates,updated_at")
      .eq("workspace_id", id),
  ]);
  if (results.some((r) => r.error))
    throw new Error("Budget records unavailable");
  const client = results[0].data;
  if (!client) redirect("/not-allowed");
  const overview = results[1].data as BudgetOverview | null,
    history = results[2].data ?? [],
    costs = results[3].data ?? [],
    alerts = results[4].data ?? [],
    pricing = results[5].data ?? [];
  const n = overview ? budgetNumbers(overview) : null,
    b = overview?.budget;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: client.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const parts = today.split("-").map(Number),
    end = new Date(Date.UTC(parts[0], parts[1], parts[2]))
      .toISOString()
      .slice(0, 10);
  const hidden = <input type="hidden" name="workspace" value={id} />;
  const budgetForm = (action: string, label: string) => (
    <form action={changeBudget}>
      {hidden}
      <input type="hidden" name="action" value={action} />
      <label>
        {action === "top_up" ? "Amount to add (£)" : "Budget amount (£)"}
        <input
          name="amount"
          type="number"
          min="0.000001"
          max="1000000"
          step="any"
          defaultValue={action === "top_up" ? "" : (b?.amount ?? 10)}
          required
        />
      </label>
      {["create", "renew"].includes(action) && (
        <>
          <div className="field-grid">
            <label>
              Period start
              <input name="start" type="date" defaultValue={today} required />
            </label>
            <label>
              Period end (exclusive)
              <input name="end" type="date" defaultValue={end} required />
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              name="test"
              defaultChecked={b?.is_test ?? true}
            />
            Test budget · allows fake costs
          </label>
        </>
      )}
      <label>
        Note
        <input name="note" maxLength={2000} placeholder="Why this changed" />
      </label>
      <Submit>{label}</Submit>
    </form>
  );
  return (
    <Frame admin email={user.email ?? ""} client={{ id, name: client.name }}>
      <div className="setup-heading">
        <Link href={"/clients/" + id + "/setup?step=1"}>← Client setup</Link>
        <p className="eyebrow">{client.name} / Budget</p>
        <h1>
          A clear limit.
          <br />
          <em>A record of every call.</em>
        </h1>
      </div>
      {q.error && (
        <p className="notice" role="alert">
          {q.error.slice(0, 300)}
        </p>
      )}
      {q.saved && (
        <p role="status" className="notice success">
          Saved.
        </p>
      )}
      {client.paused_reason?.startsWith("budget:") && (
        <p className="notice">Paused: budget {client.paused_reason.slice(7)}</p>
      )}
      {b && n ? (
        <section className="section">
          <div className="section-heading">
            <h2>{b.is_test ? "Test budget" : "Usage budget"}</h2>
            <span className="badge">{b.status}</span>
          </div>
          <p>
            {b.period_start} to {b.period_end} (end exclusive) · GBP
          </p>
          <dl className="budget-totals">
            <div>
              <dt>Budget</dt>
              <dd>{money(b.amount)}</dd>
            </div>
            <div>
              <dt>Spent</dt>
              <dd>{money(overview.spent)}</dd>
            </div>
            <div>
              <dt>Reserved</dt>
              <dd>{money(overview.reserved)}</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>{money(n.available)}</dd>
            </div>
          </dl>
          <p className="small-note">
            Daily soft cap: {money(n.softCap)} · Today’s spend:{" "}
            {money(overview.today_spent)}. Optional work stops first;
            watched-person checks can continue within the hard cap.
          </p>
          <p className="small-note">{b.note}</p>
        </section>
      ) : (
        <section className="section">
          <h2>Create a budget</h2>
          <p className="muted">
            No calls can run without an active budget. Start with a £10 test
            budget to check the controls.
          </p>
          {budgetForm("create", "Create budget")}
        </section>
      )}
      {b && (
        <div className="setup-columns">
          <section className="section">
            <h2>Top up</h2>
            {budgetForm("top_up", "Add to budget")}
          </section>
          <section className="section">
            <h2>Change the total</h2>
            {budgetForm("change", "Change budget")}
          </section>
          <section className="section">
            <h2>Renew for a new period</h2>
            <p className="small-note">
              Closes the current period and starts a fresh ledger total. Pending
              calls must be resolved first.
            </p>
            {budgetForm("renew", "Renew budget")}
          </section>
          <section className="section">
            <h2>Test the cap</h2>
            {b.is_test && b.status === "active" ? (
              <form action={testCost}>
                {hidden}
                <input name="request_key" type="hidden" value={randomUUID()} />
                <label>
                  Fake cost (£)
                  <input
                    type="number"
                    name="amount"
                    min="0.000001"
                    step="any"
                    required
                  />
                </label>
                <p className="small-note">
                  Adds a permanent, labelled test ledger entry. No provider is
                  called. Crossing 80% or 100% sends a budget alert to the
                  platform administrator.
                </p>
                <Submit>Add fake cost</Submit>
              </form>
            ) : (
              <p className="muted">
                Fake costs are available only on an active test budget.
              </p>
            )}
          </section>
        </div>
      )}
      <section className="section">
        <div className="section-heading">
          <h2>Budget history</h2>
          <span className="count">Latest 100</span>
        </div>
        {history.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Change</th>
                  <th>Total</th>
                  <th>By</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      {new Date(h.created_at).toLocaleString("en-GB", {
                        timeZone: client.timezone,
                      })}
                    </td>
                    <td>{h.action.replace("_", " ")}</td>
                    <td>{money(h.amount)}</td>
                    <td>{h.actor_label}</td>
                    <td>{h.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Budget changes will appear here.</p>
        )}
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>Cost ledger</h2>
          <span className="count">Latest 100</span>
        </div>
        {costs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Stage</th>
                  <th>Provider / source</th>
                  <th>Units</th>
                  <th>Cost</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {new Date(c.created_at).toLocaleString("en-GB", {
                        timeZone: client.timezone,
                      })}
                    </td>
                    <td>{c.stage}</td>
                    <td>
                      {c.provider}
                      <br />
                      {c.source_key}
                    </td>
                    <td>
                      <code>{JSON.stringify(c.units)}</code>
                    </td>
                    <td>{money(c.cost)}</td>
                    <td>
                      {c.is_test ? "Test · " : ""}
                      {c.outcome} · {c.cost_basis}
                      {c.batch ? " · batch" : ""}
                      {c.cached ? " · cached" : ""}
                      {c.model ? " · " + c.model : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            No costs recorded. Collection is not connected yet.
          </p>
        )}
      </section>
      <section className="section">
        <h2>Budget alerts</h2>
        {alerts.length ? (
          <>
            <ul>
              {alerts.map((a) => (
                <li key={a.id}>
                  {a.threshold}% · {a.status} · {a.attempts} attempts
                  {a.last_error ? " · " + a.last_error : ""}
                </li>
              ))}
            </ul>
            <form action={retryAlerts}>
              {hidden}
              <Submit>Retry unsent alerts</Submit>
            </form>
          </>
        ) : (
          <p className="muted">
            One alert at 80% and one at 100% for each period. Client users do
            not receive them.
          </p>
        )}
      </section>
      <section className="section">
        <details>
          <summary>Provider pricing settings</summary>
          <p className="small-note">
            GBP rates used by future adapters. Keep the unit names in the rates
            object. No prices are assumed and no paid calls run here.
          </p>
          {pricing.map((p) => (
            <p key={p.pricing_key}>
              <strong>{p.pricing_key}</strong>{" "}
              <code>{JSON.stringify(p.rates)}</code>
            </p>
          ))}
          <form action={savePricing}>
            {hidden}
            <label>
              Pricing key
              <input
                name="key"
                maxLength={120}
                required
                placeholder="provider/model"
              />
            </label>
            <label>
              Rates (JSON)
              <textarea
                name="rates"
                rows={4}
                required
                placeholder='{"input_per_million": 0, "output_per_million": 0}'
              />
            </label>
            <Submit>Save pricing</Submit>
          </form>
        </details>
      </section>
    </Frame>
  );
}
