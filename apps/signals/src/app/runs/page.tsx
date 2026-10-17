import Link from "next/link";
import { Frame } from "@/components/frame";
import { adminSummary } from "@/lib/admin-summary";
export default async function Runs() {
  const a = await adminSummary();
  return (
    <Frame admin email={a.user.email ?? ""}>
      <div className="screen-head">
        <div>
          <h1>Runs and costs</h1>
          <p className="muted">
            Approved discovery runs. Collection starts in Phase 6.
          </p>
        </div>
      </div>
      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {["Client", "Run", "Started", "Status"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.runs.map((r) => (
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
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!a.runs.length && <p>No runs yet.</p>}
      </section>
    </Frame>
  );
}
