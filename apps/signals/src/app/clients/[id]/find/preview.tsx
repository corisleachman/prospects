"use client";
import { useEffect, useState } from "react";
import { pollPreview, saveWatchlist, startMatches } from "./actions";
import { Submit } from "@/components/submit";
import { money } from "@/lib/budget";
type Row = {
  id: string;
  status: string;
  estimated_gbp: number;
  actual_gbp: number;
  step: number;
  error_summary: string | null;
  saved_at: string | null;
  plan: any;
  result: {
    companies: any[];
    people: any[];
    warnings: string[];
    company_total?: number;
    people_total?: number;
  };
};
export function Preview({
  initial,
  workspace,
  profile,
  canRun,
}: {
  initial: Row;
  workspace: string;
  profile: string;
  canRun: boolean;
}) {
  const [p, setP] = useState(initial),
    [error, setError] = useState("");
  const [companyKeys, setCompanies] = useState(
      initial.result.companies.map((c) => c.key),
    ),
    [peopleKeys, setPeople] = useState(initial.result.people.map((x) => x.key));
  useEffect(() => {
    if (!["queued", "running"].includes(p.status)) return;
    let alive = true,
      busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await pollPreview(p.id);
        if (alive) {
          setP(next);
          setCompanies(next.result.companies.map((c: any) => c.key));
          setPeople(next.result.people.map((x: any) => x.key));
        }
      } catch {
        if (alive)
          setError("Progress check failed. Reload this page to reconnect.");
      } finally {
        busy = false;
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [p.id, p.status]);
  function toggleCompany(key: string, checked: boolean) {
    setCompanies(
      checked ? [...companyKeys, key] : companyKeys.filter((x) => x !== key),
    );
    if (!checked)
      setPeople(
        peopleKeys.filter(
          (k) => p.result.people.find((x) => x.key === k)?.company_key !== key,
        ),
      );
  }
  const hidden = (
    <>
      <input name="workspace" type="hidden" value={workspace} />
      <input name="profile" type="hidden" value={profile} />
      <input name="preview" type="hidden" value={p.id} />
    </>
  );
  const complete = ["succeeded", "partial"].includes(p.status);
  return (
    <section className="section">
      <div className="section-heading">
        <h2>{p.status === "quoted" ? "Search estimate" : "Match preview"}</h2>
        <span className="badge">{p.status}</span>
      </div>
      <p>
        Maximum estimated cost: {money(p.estimated_gbp)}{" "}
        <span className="small-note">
          ({Number(p.estimated_gbp).toFixed(6)} GBP)
        </span>
      </p>
      <p className="small-note">
        treg catalog prices · ECB USD/GBP rate {p.plan.fx.toFixed(6)} dated{" "}
        {p.plan.fx_date}. The quote expires after 30 minutes.
      </p>
      {p.status === "quoted" && (
        <>
          <p className="small-note">
            Up to {p.plan.limit} companies and {p.plan.limit} people. The final
            cost follows provider receipts. Missing receipts are recorded
            conservatively at the reserved call cap.
          </p>
          <form action={startMatches}>
            {hidden}
            {canRun ? (
              <Submit pending="Starting search…">
                Approve cost and find matches
              </Submit>
            ) : (
              <p className="notice">
                Create or renew an active normal budget before searching. Test
                budgets cannot pay for discovery.
              </p>
            )}
          </form>
        </>
      )}
      {["queued", "running"].includes(p.status) && (
        <p role="status">
          Finding matches… {p.step} provider calls recorded. You can close this
          tab; the worker will finish the approved search.
        </p>
      )}
      {p.status !== "quoted" && (
        <p>
          Recorded cost: {money(p.actual_gbp)} (
          {Number(p.actual_gbp).toFixed(6)} GBP)
        </p>
      )}
      {(p.error_summary || error) && (
        <p role="alert" className="notice">
          {p.error_summary ?? error}
        </p>
      )}
      {p.result.warnings?.length > 0 && (
        <ul className="small-note">
          {[...new Set(p.result.warnings)].map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {complete && (
        <form action={saveWatchlist}>
          {hidden}
          <p>
            {p.result.companies.length} companies and {p.result.people.length}{" "}
            people returned. Review the selection before saving.
          </p>
          {p.result.company_total !== undefined && (
            <p className="small-note">
              The company provider reports {p.result.company_total} results for
              the discovery query. Counts can include candidates outside your
              ICP; this preview has not been judged by AI.
            </p>
          )}
          <div className="section-heading">
            <h3>Companies</h3>
            <span className="count">{companyKeys.length} selected</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Keep</th>
                  <th>Company</th>
                  <th>Industry / location</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {p.result.companies.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <input
                        aria-label={"Keep company " + c.name}
                        type="checkbox"
                        name="companies"
                        value={c.key}
                        checked={companyKeys.includes(c.key)}
                        onChange={(e) => toggleCompany(c.key, e.target.checked)}
                      />
                    </td>
                    <td>
                      {c.website || c.linkedin_url ? (
                        <a
                          href={c.website || c.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {c.name} ↗
                        </a>
                      ) : (
                        <>
                          {c.name}
                          <span className="small-note">
                            {" "}
                            · identity needs verification
                          </span>
                        </>
                      )}
                      {c.linkedin_url && (
                        <>
                          <br />
                          <a
                            className="small-note"
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Company LinkedIn ↗
                          </a>
                        </>
                      )}
                    </td>
                    <td>
                      {c.industry}
                      <br />
                      {c.location}
                    </td>
                    <td>{c.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="section-heading">
            <h3>People</h3>
            <span className="count">{peopleKeys.length} selected</span>
          </div>
          {p.result.people.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Keep</th>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Company</th>
                  </tr>
                </thead>
                <tbody>
                  {p.result.people.map((x) => (
                    <tr key={x.key}>
                      <td>
                        <input
                          type="checkbox"
                          name="people"
                          value={x.key}
                          aria-label={"Keep person " + x.name}
                          checked={peopleKeys.includes(x.key)}
                          disabled={!companyKeys.includes(x.company_key)}
                          onChange={(e) =>
                            setPeople(
                              e.target.checked
                                ? [...peopleKeys, x.key]
                                : peopleKeys.filter((k) => k !== x.key),
                            )
                          }
                        />
                      </td>
                      <td>
                        <a
                          href={x.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {x.name} ↗
                        </a>
                      </td>
                      <td>{x.title}</td>
                      <td>
                        {
                          p.result.companies.find(
                            (c) => c.key === x.company_key,
                          )?.name
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              No matching people were returned. Companies can still be saved.
            </p>
          )}
          <Submit>Save watch list</Submit>
          {p.saved_at && <p role="status">Watch list saved.</p>}
        </form>
      )}
    </section>
  );
}
