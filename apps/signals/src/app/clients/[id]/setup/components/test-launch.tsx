"use client";
import { useEffect, useState, useTransition } from "react";
import { SignalCard } from "@/components/signal-card";
import { testCommand } from "../test-actions";
async function command(
  action: "start" | "refresh" | "review" | "launch",
  workspace: string,
  id = "",
  paid = false,
): Promise<any> {
  const r = await testCommand(action, workspace, id, paid);
  if (r.error) throw Error(r.error);
  return r.data;
}
const startTest = (workspace: string, paid: boolean) =>
  command("start", workspace, "", paid);
const refreshTest = (workspace: string, id: string) =>
  command("refresh", workspace, id);
const reviewTest = (workspace: string, id: string) =>
  command("review", workspace, id);
const launchClient = (workspace: string, id: string) =>
  command("launch", workspace, id);

import { money } from "@/lib/budget";
type Run = {
  id: string;
  status: string;
  summary: any;
  error_summary?: string;
  samples_reviewed: boolean;
  created_at: string;
  cards: any[];
};
export function TestLaunch({
  workspace,
  initial,
  sourceCount,
  profileCount,
  status,
  firstMorning,
  timezone,
}: {
  workspace: string;
  initial: Run | null;
  sourceCount: number;
  profileCount: number;
  status: string;
  firstMorning: string | null;
  timezone: string;
}) {
  const [run, setRun] = useState(initial),
    [busy, start] = useTransition(),
    [error, setError] = useState(""),
    [samples, setSamples] = useState(false),
    [paid, setPaid] = useState(false),
    [live, setLive] = useState(status === "live"),
    [first, setFirst] = useState(firstMorning);
  const running =
    !!run && ["collecting", "triage", "score"].includes(run.status);
  useEffect(() => {
    if (!running || !run) return;
    const id = run.id;
    const t = setInterval(() => {
      refreshTest(workspace, id)
        .then(setRun)
        .catch((e) => setError(e.message));
    }, 5000);
    return () => clearInterval(t);
  }, [running, run?.id, workspace]);
  function act(fn: () => Promise<void>) {
    setError("");
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }
  const s = run?.summary ?? {},
    cards = run?.cards ?? [];
  return (
    <section className="section test-launch">
      <h2>Test and go live</h2>
      <p className="muted">
        Runs once over the last 48 hours with the current setup. Nothing is sent
        to the client until you go live.
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={paid}
          onChange={(e) => setPaid(e.target.checked)}
          disabled={running || busy}
        />{" "}
        Include paid news and watched LinkedIn sources, within this client’s
        budget
      </label>
      <button
        className="button secondary"
        disabled={running || busy}
        onClick={() =>
          act(async () => {
            setSamples(false);
            setRun(await startTest(workspace, paid));
          })
        }
      >
        {running ? (
          <>
            <span className="spinner" /> Collecting from {sourceCount} sources
            across {profileCount} profiles…
          </>
        ) : (
          "Run test"
        )}
      </button>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {run?.error_summary && <p className="notice">{run.error_summary}</p>}
      {run && !running && (
        <>
          <div className="stat-tiles">
            <div>
              <span className="small-note">Items collected</span>
              <strong>{s.items_collected ?? 0}</strong>
            </div>
            <div>
              <span className="small-note">Fresh and not duplicate</span>
              <strong>{s.fresh ?? 0}</strong>
            </div>
            <div>
              <span className="small-note">Usable cards (score 7 or more)</span>
              <strong>{s.usable ?? 0}</strong>
            </div>
            <div>
              <span className="small-note">Test cost</span>
              <strong>{money(s.cost ?? 0)}</strong>
            </div>
          </div>
          {!!s.reused_fresh && (
            <p className="small-note">
              Includes {s.reused_fresh} fresh items already collected. They are
              judged against this setup without buying them again.
            </p>
          )}
          <h3>Dropped because</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                {[
                  [
                    "Older than the window or no date",
                    (s.drops?.too_old ?? 0) + (s.drops?.no_date ?? 0),
                  ],
                  ["Duplicate of another report", s.drops?.duplicate ?? 0],
                  ["Didn't match a profile", s.unmatched ?? 0],
                  ["Matched but scored below 7", s.below_seven ?? 0],
                  ["AI failures", s.model_failures ?? 0],
                  ["Budget paused", s.budget_paused ?? 0],
                ].map(([name, count]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small-note">
            Status: {run.status}.{" "}
            <a href={"/runs/" + run.id}>Source receipts and stage costs</a>
          </p>
          <button
            className="button secondary"
            onClick={() => setSamples(!samples)}
          >
            Review the {cards.length} sample cards
          </button>
          {samples && (
            <div className="sample-cards">
              {cards.length ? (
                cards.map((c) => <Sample key={c.id} card={c} />)
              ) : (
                <p className="notice">
                  A good reason is worth waiting for. This test produced no
                  usable cards.
                </p>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={run.samples_reviewed}
                  disabled={busy || run.samples_reviewed}
                  onChange={() =>
                    act(async () => {
                      await reviewTest(workspace, run.id);
                      setRun({ ...run, samples_reviewed: true });
                    })
                  }
                />{" "}
                I’ve reviewed the sample cards and test results.
              </label>
            </div>
          )}
          {live ? (
            <p className="badge positive">
              Live · first list{" "}
              {first
                ? new Intl.DateTimeFormat("en-GB", {
                    timeZone: timezone,
                    weekday: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(first))
                : "scheduled"}
            </p>
          ) : (
            <button
              className="button"
              disabled={
                busy ||
                !run.samples_reviewed ||
                !["ready", "partial"].includes(run.status) ||
                (s.model_failures ?? 0) > 0 ||
                (s.budget_paused ?? 0) > 0 ||
                (s.pending ?? 0) > 0
              }
              onClick={() =>
                act(async () => {
                  const date = await launchClient(workspace, run.id);
                  setFirst(date);
                  setLive(true);
                })
              }
            >
              Go live
            </button>
          )}
        </>
      )}
    </section>
  );
}
function Sample({ card: c }: { card: any }) {
  return (
    <SignalCard
      preview
      budgetAvailable={false}
      onHandled={() => {}}
      card={{
        ...c,
        person_name: c.people?.name,
        person_title: c.people?.title,
        company_name: c.companies?.name,
        industry: c.companies?.industry,
        location: c.companies?.location,
        profile_code: c.campaigns?.code,
        profile_name: c.campaigns?.name,
        sensitive: c.polarity === "negative",
        factual_summary: c.signals?.factual_summary,
        drafts: c.message_drafts,
        sources: c.sources?.map((s: any) => ({
          url: s.source_url,
          name: s.source_name,
          published_at: s.published_at,
        })),
      }}
    />
  );
}
