import { TestLaunch } from "./components/test-launch";
import { refreshTest } from "./test-actions";
import { setupData } from "@/lib/setup-data";
import { examples } from "@/lib/setup";
import { Signals } from "./components/signals";
import { Sources } from "./components/sources";
import { Voice } from "./components/voice";
import { Recipients } from "./components/recipients";
import { money } from "@/lib/budget";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { Frame } from "@/components/frame";
import { Submit } from "@/components/submit";
import type { Profile, ClientDetails } from "@/lib/profile";
import { Details } from "../details";
import { ProfileEditor } from "../profile-editor";
import { addProfile } from "../actions";
export default async function Setup({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    profile?: string;
    step?: string;
    error?: string;
    memberSaved?: string;
  }>;
}) {
  const [{ id }, q, { db, user }] = await Promise.all([
    params,
    searchParams,
    requireAdmin(),
  ]);
  if (!/^[a-f0-9-]{36}$/i.test(id)) redirect("/not-allowed");
  const [
    { data: client, error },
    { data: profiles, error: profileError },
    { data: team, error: teamError },
    { data: previews, error: previewError },
    { data: budget, error: budgetError },
  ] = await Promise.all([
    db
      .from("workspaces")
      .select(
        "id,name,timezone,logo_url,website,client_type,profile_limit,setup_revision,status,latest_pipeline_test_id,first_morning_at,default_max_cards_per_day,default_no_repeat_days,delivery_limits_revision",
      )
      .eq("id", id)
      .eq("is_signals_client", true)
      .maybeSingle(),
    db
      .from("campaigns")
      .select(
        "id,code,name,profile_type,who,criteria,priority_titles,relevant_moment,conversation_to_open,watch_list_size,when_no_person,setup_revision",
      )
      .eq("workspace_id", id)
      .neq("status", "archived")
      .order("created_at"),
    db.rpc("signals_team", { p_workspace_id: id }),
    db
      .from("discovery_previews")
      .select("id,profile_id,result,status,actual_gbp,estimated_gbp")
      .eq("workspace_id", id)
      .in("status", ["succeeded", "partial"])
      .order("created_at", { ascending: false })
      .limit(20),
    db.rpc("signals_budget_overview", { p_workspace: id }),
  ]);
  if (error || profileError || teamError || previewError || budgetError)
    throw new Error("Client setup unavailable");
  if (!client) redirect("/not-allowed");
  const step = q.profile ? 2 : Math.min(7, Math.max(1, Number(q.step) || 1));
  const settings = await setupData(db, id);
  const test =
    step === 7 && client.latest_pipeline_test_id
      ? await refreshTest(id, client.latest_pipeline_test_id)
      : null;
  const done = [
    !!client.name,
    !!profiles?.length,
    settings.rules.some((r) => r.is_active),
    settings.sources.some((s) => s.enabled),
    examples(settings.voice.examples_text).length >= 3,
    settings.recipients.some((r) => r.profile_ids.length > 0),
  ];
  const selected = profiles?.find((p) => p.id === q.profile) ?? profiles?.[0];
  return (
    <Frame admin email={user.email ?? ""} client={{ id, name: client.name }}>
      <div className="screen-head">
        <div>
          <h1>{client.name}</h1>
          <p className="muted">
            Client setup · <span className="badge">{client.status}</span>
          </p>
        </div>
        <Link href={"/clients/" + id}>Back to overview</Link>
      </div>
      {q.error && (
        <p role="alert" className="notice">
          {q.error.slice(0, 300)}
        </p>
      )}
      <div className="client-setup">
        <aside className="setup-nav" aria-label="Setup steps">
          {[
            "Client details",
            "ICP profiles",
            "Signals",
            "Sources",
            "Voice and copy",
            "Who gets what",
            "Test and go live",
          ].map((name, i) =>
            i < 7 ? (
              <Link
                key={name}
                aria-current={step === i + 1 ? "step" : undefined}
                href={"/clients/" + id + "/setup?step=" + (i + 1)}
              >
                <span className="step-number">
                  {step !== i + 1 && done[i] ? "✓" : i + 1}
                </span>
                {name}
              </Link>
            ) : (
              <button key={name} disabled>
                <span className="step-number">{i + 1}</span>
                <span>
                  {name}
                  <small>Coming in Phase {i === 6 ? 7 : 5}</small>
                </span>
              </button>
            ),
          )}
        </aside>
        <div className="setup-content">
          {step === 1 &&
            (client.status === "archived" ? (
              <p className="notice">
                This client is archived. Setup is read-only.
              </p>
            ) : (
              <div id="details">
                <Details initial={client as ClientDetails} userId={user.id} />
                <section className="section">
                  <h2>Monthly scraping budget</h2>
                  <p className="muted">
                    {budget
                      ? money(budget.budget.amount) +
                        " · renews " +
                        budget.budget.period_end
                      : "Not set"}
                  </p>
                  <p className="small-note">
                    Collection pauses when it runs out until you renew it.
                  </p>
                  <Link href={"/clients/" + id + "/budget"}>
                    Budget and cost ledger
                  </Link>
                </section>
              </div>
            ))}
          {step === 2 && (
            <>
              <section className="section" id="profiles">
                <div className="profile-tabs" aria-label="Choose a profile">
                  {profiles?.map((p) => (
                    <Link
                      key={p.id}
                      href={"/clients/" + id + "/setup?step=2&profile=" + p.id}
                      aria-current={selected?.id === p.id ? "page" : undefined}
                    >
                      <span className="mono">{p.code}</span> {p.name}
                    </Link>
                  ))}
                  {client.status !== "archived" && (
                    <form action={addProfile}>
                      <input type="hidden" name="workspace" value={id} />
                      <Submit>+ Add</Submit>
                    </form>
                  )}
                  <span className="count">
                    {profiles?.length ?? 0}/{client.profile_limit} profiles
                  </span>
                  <span className="small-note">
                    {(profiles?.length ?? 0) >= client.profile_limit
                      ? "Profile limit reached. Choose a larger placeholder plan to add more."
                      : "New profiles start as drafts. Nothing runs automatically."}
                  </span>
                </div>
              </section>
              {selected && client.status !== "archived" && (
                <ProfileEditor
                  key={selected.id}
                  initial={selected as Profile}
                  workspace={id}
                  userId={user.id}
                  summary={previews?.find((x) => x.profile_id === selected.id)}
                />
              )}
            </>
          )}
          {step === 3 && (
            <Signals
              workspace={id}
              initial={settings.rules}
              profiles={profiles ?? []}
            />
          )}
          {step === 4 && (
            <Sources
              workspace={id}
              initial={settings.sources}
              extra={settings.extra}
            />
          )}
          {step === 5 && <Voice workspace={id} initial={settings.voice} />}
          {step === 6 && (
            <Recipients
              workspace={id}
              initial={settings.recipients}
              profiles={profiles ?? []}
              timezone={client.timezone}
              limits={{
                daily: client.default_max_cards_per_day ?? 10,
                repeat: client.default_no_repeat_days ?? 30,
                revision: client.delivery_limits_revision ?? 0,
              }}
            />
          )}
          {step === 7 && (
            <TestLaunch
              workspace={id}
              initial={test}
              sourceCount={settings.sources.filter((s) => s.enabled).length}
              profileCount={profiles?.length ?? 0}
              status={client.status}
              firstMorning={client.first_morning_at}
              timezone={client.timezone}
            />
          )}
          <div className="setup-next">
            <Link
              className="button secondary"
              href={
                step < 7
                  ? "/clients/" + id + "/setup?step=" + (step + 1)
                  : "/clients/" + id
              }
            >
              Save and continue
            </Link>
            <span className="small-note">Changes save automatically.</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}
