import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { Frame } from "@/components/frame";
import { RowLink } from "@/components/row-link";
import { setupData } from "@/lib/setup-data";
import { money } from "@/lib/budget";
export default async function Overview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, { db, user }] = await Promise.all([params, requireAdmin()]);
  const [w, p, t, watch, b] = await Promise.all([
    db
      .from("workspaces")
      .select("id,name,status,timezone,client_type")
      .eq("id", id)
      .eq("is_signals_client", true)
      .maybeSingle(),
    db
      .from("campaigns")
      .select("id,code,name,profile_type,who,priority_titles")
      .eq("workspace_id", id)
      .neq("status", "archived")
      .order("created_at"),
    db.rpc("signals_team", { p_workspace_id: id }),
    db
      .from("campaign_prospects")
      .select("campaign_id,company_id,person_id")
      .eq("workspace_id", id)
      .not("company_id", "is", null)
      .eq("group_type", "watchlist"),
    db.rpc("signals_budget_overview", { p_workspace: id }),
  ]);
  if ([w, p, t, watch, b].some((r) => r.error))
    throw new Error("Client overview unavailable");
  if (!w.data) redirect("/not-allowed");
  const client = w.data;
  const settings = await setupData(db, id);
  const times = [
    ...new Set(
      settings.recipients.map((r) => r.morning_email_time).filter(Boolean),
    ),
  ].sort();
  return (
    <Frame admin email={user.email ?? ""} client={{ id, name: client.name }}>
      <div className="screen-head">
        <div>
          <h1>{client.name}</h1>
          <p className="muted">
            {client.client_type || "Type not set"} · {p.data?.length ?? 0}{" "}
            profiles · {t.data?.length ?? 0} users ·{" "}
            <span className="badge">
              {client.status === "setup" ? "Setting up" : client.status}
            </span>
          </p>
        </div>
        <div className="inline-options">
          <Link
            className="button secondary"
            href={"/today?workspace=" + id + "&viewAs=1"}
          >
            View as client
          </Link>
          <Link className="button" href={"/clients/" + id + "/setup"}>
            Edit setup
          </Link>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-tile">
          <span>Budget this month</span>
          <strong>
            {b.data
              ? money(b.data.spent) + " / " + money(b.data.budget.amount)
              : "Not set"}
          </strong>
          <small>{b.data ? "Renews " + b.data.budget.period_end : ""}</small>
        </div>
        <div className="stat-tile">
          <span>Companies watched</span>
          <strong>
            {new Set((watch.data ?? []).map((x) => x.company_id)).size}
          </strong>
        </div>
        <div className="stat-tile">
          <span>Morning list time</span>
          <strong>{times.length ? times.join(" · ") : "Not configured"}</strong>
          <small>{client.timezone}</small>
        </div>
      </div>
      <section className="section">
        <div className="section-heading">
          <h2>Profiles</h2>
          <Link href={"/clients/" + id + "/setup?step=2"}>Edit profiles</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Profile",
                  "Type",
                  "Who",
                  "Titles",
                  "Watching",
                  "Sent to",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.data?.map((x) => {
                const rows = (watch.data ?? []).filter(
                  (w) => w.campaign_id === x.id,
                );
                return (
                  <RowLink
                    key={x.id}
                    href={"/clients/" + id + "/setup?step=2&profile=" + x.id}
                  >
                    <td>
                      <Link
                        href={
                          "/clients/" + id + "/setup?step=2&profile=" + x.id
                        }
                      >
                        <span className="mono">{x.code}</span> {x.name}
                      </Link>
                    </td>
                    <td>{x.profile_type.replaceAll("_", " ")}</td>
                    <td>{x.who || "–"}</td>
                    <td>{x.priority_titles.join(", ") || "–"}</td>
                    <td>
                      {new Set(rows.map((r) => r.company_id)).size} companies ·{" "}
                      {rows.filter((r) => r.person_id).length} people
                    </td>
                    <td>
                      {settings.recipients
                        .filter((r) => r.profile_ids.includes(x.id))
                        .map((r) => r.display_name || r.email)
                        .join(", ") || "Not configured"}
                    </td>
                  </RowLink>
                );
              })}
            </tbody>
          </table>
        </div>
        {!p.data?.length && (
          <p className="muted">Add an ICP profile in setup to get started.</p>
        )}
      </section>
    </Frame>
  );
}
