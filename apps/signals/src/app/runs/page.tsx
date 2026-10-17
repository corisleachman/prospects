import Link from "next/link";
import { Frame } from "@/components/frame";
import { Submit } from "@/components/submit";
import { adminSummary } from "@/lib/admin-summary";
import { costMoney } from "@/lib/budget";
import { runCollection } from "./actions";
import { CollectionPoller } from "./poller";
export default async function Runs({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; error?: string }>;
}) {
  const [a, q] = await Promise.all([adminSummary(), searchParams]);
  const [cr, st, pr] = await Promise.all([
    a.db
      .from("collection_runs")
      .select("id,workspace_id,kind")
      .order("created_at", { ascending: false })
      .limit(100),
    a.db
      .from("source_tasks")
      .select("*")
      .not("collection_source_key", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000),
    a.db
      .from("pipeline_runs")
      .select("id,workspace_id,status,summary")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (cr.error || st.error || pr.error)
    throw Error("Collection runs unavailable");
  const groups = new Map<string, any>();
  for (const t of st.data ?? []) {
    const key = t.run_id + ":" + t.collection_source_key;
    let g = groups.get(key);
    if (!g) {
      g = {
        run: t.run_id,
        workspace: t.workspace_id,
        source: t.collection_source_key,
        items: 0,
        fresh: 0,
        usable: 0,
        cost: 0,
        statuses: [],
        errors: [],
        drops: {},
      };
      groups.set(key, g);
    }
    g.items += t.collected_count;
    g.fresh += t.fresh_count;
    g.usable += t.usable_count;
    g.cost += Number(t.cost_gbp);
    g.statuses.push(t.status);
    if (t.error_summary) g.errors.push(t.error_summary);
    for (const [k, n] of Object.entries(t.drop_counts ?? {}))
      g.drops[k] = (g.drops[k] ?? 0) + Number(n);
  }
  for (const p of pr.data ?? []) {
    for (const [source, values] of Object.entries(p.summary?.sources ?? {})) {
      const v = values as any,
        key = p.id + ":" + source,
        g = groups.get(key) ?? {
          run: p.id,
          workspace: p.workspace_id,
          source,
          statuses: [],
          errors: [],
          drops: {},
        };
      Object.assign(g, {
        items: v.items ?? 0,
        fresh: v.fresh ?? 0,
        usable: v.usable ?? 0,
        cost: v.cost ?? 0,
        pipelineStatus: p.status,
      });
      groups.set(key, g);
    }
  }
  const selected = a.runs.find((r) => r.id === q.run),
    active = selected && ["queued", "running"].includes(selected.status);
  return (
    <Frame admin email={a.user.email ?? ""}>
      <div className="screen-head">
        <div>
          <h1>Runs and costs</h1>
          <p className="muted">
            Collection by client and source. Open a run for the items and
            reasons anything was dropped.
          </p>
        </div>
      </div>
      {q.error && (
        <p role="alert" className="notice">
          {q.error.slice(0, 500)}
        </p>
      )}
      <section className="section">
        <form action={runCollection} className="collection-form">
          <label>
            Client
            <select name="workspace" required>
              {a.clients
                .filter((c) => !["paused", "archived"].includes(c.status))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="check-label">
            <input type="checkbox" name="include_paid" />
            Include paid sources
          </label>
          <Submit pending="Starting collection…">Run collection</Submit>
        </form>
        <p className="small-note">
          Manual runs only. Public feeds run by default. Tick Include paid
          sources to add news search and LinkedIn. News search is capped at
          US$0.002 per query and LinkedIn posts at US$0.10 per watched person.
          Each paid call needs budget available and stays within the daily
          allowance. Use setup step 7 to test judging and review cards.
        </p>
      </section>
      {active && <CollectionPoller id={selected.id} />}
      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Client",
                  "Source",
                  "Items",
                  "Fresh",
                  "Usable",
                  "Cost",
                  "Per usable card",
                  "Status",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...groups.values()].map((g) => {
                const run = a.runs.find((r) => r.id === g.run),
                  running = g.statuses.some((s: string) =>
                    ["queued", "running"].includes(s),
                  ),
                  failed = g.statuses.some((s: string) =>
                    ["failed", "cancelled"].includes(s),
                  );
                return (
                  <tr key={g.run + g.source}>
                    <td>
                      <Link href={"/runs/" + g.run}>
                        {a.clients.find((c) => c.id === g.workspace)?.name ??
                          "Client"}
                      </Link>
                      <small className="small-note">
                        {run?.started_at
                          ? new Date(run.started_at).toLocaleString("en-GB", {
                              timeZone: "Europe/London",
                            })
                          : ""}
                      </small>
                    </td>
                    <td>{g.source.replaceAll("_", " ")}</td>
                    <td>{g.items}</td>
                    <td>{g.fresh}</td>
                    <td>{g.pipelineStatus ? g.usable : "Pending judging"}</td>
                    <td>{costMoney(g.cost)}</td>
                    <td>{g.usable ? costMoney(g.cost / g.usable) : "–"}</td>
                    <td>
                      <span
                        className={
                          "badge " + (failed ? "polarity-negative" : "")
                        }
                      >
                        {running
                          ? "Running"
                          : failed
                            ? "Failed · retry"
                            : "Done"}
                      </span>
                      {failed && !running && (
                        <form action={runCollection}>
                          <input
                            type="hidden"
                            name="workspace"
                            value={g.workspace}
                          />
                          <input type="hidden" name="retry" value={g.run} />
                          <label className="check-label">
                            <input type="checkbox" name="include_paid" />
                            Include paid sources
                          </label>
                          <button className="text-button">
                            Retry failed sources
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!groups.size && (
          <p>No collections yet. Choose a client and run collection.</p>
        )}
      </section>
      <section className="section">
        <h2>Discovery runs</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Run</th>
                <th>Started</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {a.runs
                .filter((r) => !cr.data?.some((c) => c.id === r.id))
                .map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={"/clients/" + r.workspace_id}>
                        {a.clients.find((c) => c.id === r.workspace_id)?.name ??
                          "Client"}
                      </Link>
                    </td>
                    <td>
                      {r.run_type === "find_more" ? "Find matches" : r.run_type}
                    </td>
                    <td>
                      {r.started_at
                        ? new Date(r.started_at).toLocaleString("en-GB", {
                            timeZone: "Europe/London",
                          })
                        : "–"}
                    </td>
                    <td>{r.status}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </Frame>
  );
}
