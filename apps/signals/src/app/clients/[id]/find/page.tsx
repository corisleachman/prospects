import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { Frame } from "@/components/frame";
import { Submit } from "@/components/submit";
function defaultKeywords(p: { criteria: Record<string, any> }) {
  const types = (p.criteria.company_types ?? []).join(" ");
  return /consumer/i.test(types)
    ? ["consumer"]
    : (p.criteria.company_types ?? [])
        .filter((x: string) => x.split(/\s+/).length < 5)
        .slice(0, 5);
}
import { estimateMatches, setRefresh } from "./actions";
import { Preview } from "./preview";
export default async function Find({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ profile?: string; preview?: string; error?: string }>;
}) {
  const [{ id }, q, { db, user }] = await Promise.all([
    params,
    searchParams,
    requireAdmin(),
  ]);
  const [
    { data: client, error },
    { data: profiles, error: pe },
    { data: budget, error: be },
  ] = await Promise.all([
    db
      .from("workspaces")
      .select("id,name,status,paused_reason")
      .eq("id", id)
      .eq("is_signals_client", true)
      .maybeSingle(),
    db
      .from("campaigns")
      .select("*")
      .eq("workspace_id", id)
      .neq("status", "archived")
      .order("created_at"),
    db.rpc("signals_budget_overview", { p_workspace: id }),
  ]);
  if (error || pe || be) throw new Error("Discovery setup unavailable");
  if (!client) redirect("/not-allowed");
  const p = profiles?.find((x) => x.id === q.profile) ?? profiles?.[0];
  if (!p)
    return (
      <Frame admin email={user.email ?? ""}>
        <h1>Add a profile first.</h1>
        <Link href={"/clients/" + id}>Open setup</Link>
      </Frame>
    );
  const [
    { data: previews, error: qe },
    { data: watch, error: we },
    { data: refreshLog, error: re },
  ] = await Promise.all([
    db
      .from("discovery_previews")
      .select("*")
      .eq("workspace_id", id)
      .eq("profile_id", p.id)
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("campaign_prospects")
      .select(
        "id,company_id,person_id,source,last_refreshed_at,companies(*),people(*)",
      )
      .eq("workspace_id", id)
      .eq("campaign_id", p.id)
      .eq("group_type", "watchlist")
      .not("company_id", "is", null),
    db
      .from("discovery_refresh_log")
      .select("status,reason,created_at")
      .eq("workspace_id", id)
      .eq("profile_id", p.id)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);
  if (qe || we || re) throw new Error("Watch list unavailable");
  const preview = previews?.find((x) => x.id === q.preview) ?? previews?.[0];
  const canRun = Boolean(
    budget &&
    !budget.budget.is_test &&
    budget.budget.status === "active" &&
    !["paused", "archived"].includes(client.status),
  );
  return (
    <Frame admin email={user.email ?? ""}>
      <div className="setup-heading">
        <Link href={"/clients/" + id}>← Client setup</Link>
        <p className="eyebrow">{client.name} / Find matches</p>
        <h1>
          Choose who
          <br />
          <em>to keep watching.</em>
        </h1>
      </div>
      <nav className="profile-tabs" aria-label="Choose a profile">
        {profiles?.map((x) => (
          <Link
            key={x.id}
            href={"/clients/" + id + "/find?profile=" + x.id}
            aria-current={p.id === x.id ? "page" : undefined}
          >
            {x.name}
          </Link>
        ))}
      </nav>
      {q.error && (
        <p className="notice" role="alert">
          {q.error.slice(0, 300)}
        </p>
      )}
      <section className="section">
        <div className="section-heading">
          <h2>{p.name}</h2>
          <Link href={"/clients/" + id + "?profile=" + p.id}>Edit profile</Link>
        </div>
        <p className="small-note">
          Industry, country, revenue and headcount filters come from the saved
          profile. Titles:{" "}
          {p.priority_titles.join(", ") || "Director and above"}. Results are
          candidates for your review.
        </p>
        <form action={estimateMatches}>
          <input type="hidden" name="workspace" value={id} />
          <input type="hidden" name="profile" value={p.id} />
          <label>
            Company search keywords
            <span className="small-note">
              One per line. Suggested from company descriptions; review these
              before estimating.
            </span>
            <textarea
              name="keywords"
              rows={3}
              defaultValue={defaultKeywords(p).join("\n")}
            />
          </label>
          <label>
            Companies to preview
            <input
              name="limit"
              type="number"
              min={1}
              max={Math.min(p.watch_list_size, 200)}
              defaultValue={Math.min(p.watch_list_size, 25)}
              required
            />
          </label>
          <Submit pending="Checking current prices…">
            Estimate search cost
          </Submit>
          <p className="small-note">
            Estimating uses the public catalog and exchange-rate source. No paid
            search runs until you approve its cost.
          </p>
        </form>
        <Link href={"/clients/" + id + "/budget"}>
          Budget and cost ledger ↗
        </Link>
      </section>
      {preview && (
        <Preview
          key={preview.id}
          initial={preview}
          workspace={id}
          profile={p.id}
          canRun={canRun}
        />
      )}
      <section className="section">
        <div className="section-heading">
          <h2>Saved watch list</h2>
          <span className="count">
            {watch?.filter((x) => !x.person_id).length ?? 0} companies
          </span>
        </div>
        {watch?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Person / role</th>
                  <th>Refreshed</th>
                </tr>
              </thead>
              <tbody>
                {watch.map((x: any) => (
                  <tr key={x.id}>
                    <td>
                      {x.companies?.website || x.companies?.linkedin_url ? (
                        <a
                          href={x.companies.website || x.companies.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {x.companies.name} ↗
                        </a>
                      ) : (
                        x.companies?.name
                      )}
                    </td>
                    <td>
                      {x.people ? (
                        <>
                          <a
                            href={x.people.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {x.people.name} ↗
                          </a>
                          <br />
                          {x.people.title}
                        </>
                      ) : (
                        "Company watch"
                      )}
                    </td>
                    <td>
                      {x.last_refreshed_at
                        ? new Date(x.last_refreshed_at).toLocaleDateString(
                            "en-GB",
                          )
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            Run a preview, untick anything you don’t want, then save the
            selection.
          </p>
        )}
        <form action={setRefresh}>
          <input type="hidden" name="workspace" value={id} />
          <input type="hidden" name="profile" value={p.id} />
          <label className="check-label">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={p.watch_refresh_enabled}
            />
            Refresh this saved watch list weekly
          </label>
          <p className="small-note">
            Opt-in. Refreshes people at approved companies, keeps exclusions,
            and uses the same budget gate. No new companies are added
            automatically.{" "}
            {p.next_watch_refresh_at
              ? "Next due: " +
                new Date(p.next_watch_refresh_at).toLocaleDateString("en-GB")
              : ""}
          </p>
          <Submit>Save refresh setting</Submit>
        </form>
        {refreshLog?.map((x, i) => (
          <p className="small-note" key={i}>
            Refresh {x.status}: {x.reason}
          </p>
        ))}
      </section>
    </Frame>
  );
}
