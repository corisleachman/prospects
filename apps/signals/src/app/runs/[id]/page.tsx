import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { Frame } from "@/components/frame";
import { costMoney } from "@/lib/budget";
import { CollectionPoller } from "../poller";
export default async function Run({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, { db, user }] = await Promise.all([params, requireAdmin()]);
  const [r, t, items, cost] = await Promise.all([
    db.from("search_runs").select("*").eq("id", id).single(),
    db.from("source_tasks").select("*").eq("run_id", id).order("created_at"),
    db
      .from("collection_items")
      .select("*")
      .eq("run_id", id)
      .order("created_at")
      .limit(1000),
    db
      .from("cost_ledger")
      .select("stage,source_key,cost,cost_basis,outcome")
      .eq("run_id", id),
  ]);
  if (r.error) notFound();
  if (t.error || items.error || cost.error)
    throw Error("Run details unavailable");
  const w = await db
    .from("workspaces")
    .select("name")
    .eq("id", r.data.workspace_id)
    .single();
  const pipeline = await db
    .from("pipeline_runs")
    .select("status,summary,error_summary")
    .eq("id", id)
    .maybeSingle();
  if (pipeline.error) throw Error("Judging costs unavailable");
  const stages = pipeline.data?.summary?.stages ?? {};
  const judgments = pipeline.data
    ? await db
        .from("pipeline_jobs")
        .select("id,stage,status,result,error_summary,input,profile_id")
        .eq("run_id", id)
        .order("created_at")
        .limit(2000)
    : { data: [], error: null };
  if (judgments.error) throw Error("Judgment log unavailable");
  return (
    <Frame admin email={user.email ?? ""}>
      <div className="screen-head">
        <div>
          <h1>Collection run</h1>
          <p className="muted">
            {w.data?.name} · {r.data.status}
          </p>
        </div>
        <Link href="/runs">All runs</Link>
      </div>
      {["queued", "running"].includes(r.data.status) && (
        <CollectionPoller id={id} />
      )}
      {pipeline.data && (
        <section className="section">
          <h2>Judging and writing</h2>
          <p className="muted">
            {pipeline.data.status} · {pipeline.data.summary?.usable ?? 0} usable
            cards
          </p>
          {pipeline.data.error_summary && (
            <p className="notice">{pipeline.data.error_summary}</p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Cost</th>
                  <th>Cache read tokens</th>
                  <th>Failures</th>
                  <th>Token-limit failures</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stages).map(([stage, v]) => {
                  const x = v as any;
                  return (
                    <tr key={stage}>
                      <td>
                        {stage === "triage"
                          ? "Stage 1 · Triage"
                          : "Stage 2 · Score and write"}
                      </td>
                      <td>{costMoney(x.cost ?? 0)}</td>
                      <td>{x.cache_read_input_tokens ?? 0}</td>
                      <td>{x.failures ?? 0}</td>
                      <td>{x.max_tokens_failures ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="section">
        <h2>Sources and drops</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Items</th>
                <th>Fresh</th>
                <th>Dropped because</th>
                <th>Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {t.data?.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.collection_source_key}
                    <small className="small-note">
                      {x.input.url ?? x.input.query}
                    </small>
                  </td>
                  <td>{x.collected_count}</td>
                  <td>{x.fresh_count}</td>
                  <td>
                    {Object.entries(x.drop_counts ?? {})
                      .map(([k, n]) => k.replaceAll("_", " ") + ": " + n)
                      .join(" · ") || "–"}
                  </td>
                  <td>{costMoney(Number(x.cost_gbp))}</td>
                  <td>
                    {x.status}
                    <small className="small-note">{x.error_summary}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {!!judgments.data?.length && (
        <section className="section">
          <h2>Judgment log</h2>
          <p className="small-note">
            Includes sensitive signals kept for admin only.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Stage</th>
                  <th>Score</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {judgments.data.map((j) => (
                  <tr key={j.id}>
                    <td>{j.input?.item?.title}</td>
                    <td>{j.stage}</td>
                    <td>{j.result?.relevance ?? j.result?.icp_fit ?? "–"}</td>
                    <td>{j.error_summary ?? j.result?.reason ?? j.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="section">
        <h2>Items</h2>
        <p className="small-note">
          Passing the filter means fresh and not duplicate. Judging runs
          separately against the client’s profiles.
        </p>
        {items.data?.map((x) => (
          <article className="collected-item" key={x.id}>
            <span className="badge">
              {x.drop_reason?.replaceAll("_", " ") ?? "Fresh"}
            </span>
            <h3>{x.item.title}</h3>
            <p>{x.item.excerpt?.slice(0, 350)}</p>
            <p className="small-note">
              {x.item.source_name} · {x.item.published_at ?? "No visible date"}{" "}
              · {x.company_ids.length} watched brand matches
            </p>
            {/^https?:\/\//.test(x.item.url) && (
              <a href={x.item.url} target="_blank" rel="noreferrer">
                Open source ↗
              </a>
            )}
          </article>
        ))}
      </section>
      <section className="section">
        <h2>Cost ledger</h2>
        {cost.data?.length ? (
          <ul>
            {cost.data.map((x, i) => (
              <li key={i}>
                {x.stage} · {x.source_key} · {costMoney(Number(x.cost))} ·{" "}
                {x.cost_basis} · {x.outcome}
              </li>
            ))}
          </ul>
        ) : (
          <p>No paid calls recorded.</p>
        )}
      </section>
    </Frame>
  );
}
