import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { Frame } from "@/components/frame";
import { Submit } from "@/components/submit";
import type { Profile, ClientDetails } from "@/lib/profile";
import { Details } from "./details";
import { ProfileEditor } from "./profile-editor";
import { addProfile, saveMemberName } from "./actions";
import { inviteClientMember } from "../actions";
export default async function Setup({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    profile?: string;
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
  ] = await Promise.all([
    db
      .from("workspaces")
      .select("id,name,timezone,logo_url,profile_limit,setup_revision,status")
      .eq("id", id)
      .eq("is_signals_client", true)
      .maybeSingle(),
    db
      .from("campaigns")
      .select(
        "id,name,profile_type,who,criteria,priority_titles,relevant_moment,conversation_to_open,watch_list_size,when_no_person,setup_revision",
      )
      .eq("workspace_id", id)
      .neq("status", "archived")
      .order("created_at"),
    db.rpc("signals_team", { p_workspace_id: id }),
  ]);
  if (error || profileError || teamError)
    throw new Error("Client setup unavailable");
  if (!client) redirect("/not-allowed");
  const selected = profiles?.find((p) => p.id === q.profile) ?? profiles?.[0];
  return (
    <Frame admin email={user.email ?? ""}>
      <div className="setup-heading">
        <Link href="/clients">← All clients</Link>
        <Link className="button secondary" href={"/clients/" + id + "/budget"}>
          Budget and costs
        </Link>
        <p className="eyebrow">Client setup</p>
        <h1>{client.name}</h1>
        <p className="muted">
          Start with the client and the people they want to reach.
        </p>
      </div>
      {q.error && (
        <p role="alert" className="notice">
          {q.error.slice(0, 300)}
        </p>
      )}
      <div className="client-setup">
        <aside className="setup-nav" aria-label="Setup steps">
          <a href="#details">01 Client details</a>
          <a href="#profiles">02 ICP profiles</a>
          <p className="small-note">Further setup follows in later phases.</p>
        </aside>
        <div className="setup-content">
          {client.status === "archived" ? (
            <p className="notice">
              This client is archived. Setup is read-only.
            </p>
          ) : (
            <div id="details">
              <Details initial={client as ClientDetails} userId={user.id} />
            </div>
          )}
          <section className="section" id="profiles">
            <div className="section-heading">
              <h2>Profiles</h2>
              <span className="count">
                {profiles?.length ?? 0} / {client.profile_limit}
              </span>
            </div>
            <div className="profile-tabs" aria-label="Choose a profile">
              {profiles?.map((p) => (
                <Link
                  key={p.id}
                  href={"/clients/" + id + "?profile=" + p.id + "#profiles"}
                  aria-current={selected?.id === p.id ? "page" : undefined}
                >
                  {p.name}
                </Link>
              ))}
            </div>
            {client.status !== "archived" && (
              <form action={addProfile}>
                <input type="hidden" name="workspace" value={id} />
                <Submit>Add profile</Submit>
              </form>
            )}
            <p className="small-note">
              {(profiles?.length ?? 0) >= client.profile_limit
                ? "Profile limit reached. Choose a larger placeholder plan to add more."
                : "New profiles start as drafts. Nothing runs automatically."}
            </p>
          </section>
          {selected && client.status !== "archived" && (
            <ProfileEditor
              key={selected.id}
              initial={selected as Profile}
              workspace={id}
              userId={user.id}
            />
          )}
          <section className="section">
            <div className="section-heading">
              <h2>Team</h2>
              <span className="count">{team?.length ?? 0} members</span>
            </div>
            {q.memberSaved && <p role="status">Name saved.</p>}
            {team?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Access</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.map(
                      (m: {
                        user_id: string;
                        display_name: string;
                        email: string;
                        role: string;
                        status: string;
                      }) => (
                        <tr key={m.user_id}>
                          <td>
                            <form
                              action={saveMemberName}
                              className="member-name"
                            >
                              <input
                                type="hidden"
                                name="workspace"
                                value={id}
                              />
                              <input
                                type="hidden"
                                name="user"
                                value={m.user_id}
                              />
                              <input
                                name="name"
                                aria-label={"Name for " + m.email}
                                defaultValue={m.display_name}
                                maxLength={120}
                              />
                              <Submit>Save name</Submit>
                            </form>
                          </td>
                          <td>{m.email}</td>
                          <td>
                            {m.role === "client_admin"
                              ? "Client admin"
                              : "Client user"}
                          </td>
                          <td>{m.status}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No one has accepted an invitation yet.</p>
            )}
            {client.status !== "archived" && (
              <details>
                <summary>Invite a team member</summary>
                <form action={inviteClientMember}>
                  <input type="hidden" name="workspace" value={id} />
                  <label>
                    Email address
                    <input name="email" type="email" required maxLength={254} />
                  </label>
                  <label>
                    Access
                    <select name="role">
                      <option value="client_user">Client user</option>
                      <option value="client_admin">Client admin</option>
                    </select>
                  </label>
                  <Submit pending="Sending invitation…">Send invitation</Submit>
                </form>
              </details>
            )}
          </section>
        </div>
      </div>
    </Frame>
  );
}
