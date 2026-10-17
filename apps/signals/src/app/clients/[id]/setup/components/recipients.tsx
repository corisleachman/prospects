"use client";
import { useState, useTransition } from "react";
import { useAutosave, SaveStatus } from "@/components/autosave";
import { Submit } from "@/components/submit";
import { inviteClientMember } from "../../../actions";
import { saveRecipient, removeRecipient, restoreRecipient } from "../actions";
import type { Recipient, SetupProfile } from "@/lib/setup";
function PersonRow({
  initial,
  workspace,
  profiles,
  onRemoved,
}: {
  initial: Recipient;
  workspace: string;
  profiles: SetupProfile[];
  onRemoved: (v: Recipient, revision: number) => void;
}) {
  const a = useAutosave(
      initial,
      initial.setup_revision,
      "signals:" + workspace + ":recipient:" + initial.id,
      (v, r) => saveRecipient(workspace, v, r),
    ),
    v = a.value;
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  return (
    <tr>
      <td>
        <input
          className="person-name"
          aria-label={"Name for " + v.email}
          value={v.display_name}
          onChange={(e) => a.edit({ ...v, display_name: e.target.value })}
          maxLength={120}
        />
        <span className="small-note">
          {v.email}
          {v.pending ? " · invite sent" : ""}
        </span>
        <details className="recipient-limits">
          <summary>Limits</summary>
          <label>
            Daily card cap
            <input
              aria-label={"Daily card cap for " + v.email}
              type="number"
              min={1}
              max={100}
              value={v.max_cards_per_day}
              onChange={(e) =>
                a.edit({ ...v, max_cards_per_day: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Days before repeat
            <input
              aria-label={"Days before repeat for " + v.email}
              type="number"
              min={1}
              max={365}
              value={v.no_repeat_days}
              onChange={(e) =>
                a.edit({ ...v, no_repeat_days: Number(e.target.value) })
              }
            />
          </label>
        </details>
        <SaveStatus {...a} />
        {error && <p role="alert">{error}</p>}
      </td>
      <td>
        <select
          aria-label={"Role for " + v.email}
          value={v.role}
          onChange={(e) => a.edit({ ...v, role: e.target.value })}
        >
          <option value="client_admin">Client admin</option>
          <option value="client_user">Salesperson</option>
        </select>
      </td>
      <td>
        <div className="chips">
          {profiles.map((p) => (
            <button
              className="chip mono"
              title={p.name}
              aria-label={"Receive " + p.code + " for " + v.email}
              aria-pressed={v.profile_ids.includes(p.id)}
              key={p.id}
              onClick={() =>
                a.edit({
                  ...v,
                  profile_ids: v.profile_ids.includes(p.id)
                    ? v.profile_ids.filter((id) => id !== p.id)
                    : [...v.profile_ids, p.id],
                })
              }
            >
              {p.code}
            </button>
          ))}
        </div>
      </td>
      <td>
        <select
          aria-label={"Morning email for " + v.email}
          value={v.morning_email_time?.slice(0, 5) ?? ""}
          onChange={(e) =>
            a.edit({ ...v, morning_email_time: e.target.value || null })
          }
        >
          <option value="">Off</option>
          {["07:00", "07:30", "08:00", "08:30"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </td>
      <td>
        <button
          className="text-button danger"
          disabled={pending || a.status !== "Saved"}
          onClick={() =>
            start(async () => {
              try {
                const rev = a.getRevision();
                await removeRecipient(workspace, v.id, rev);
                onRemoved(v, rev + 1);
              } catch (e) {
                setError((e as Error).message);
              }
            })
          }
        >
          {pending ? "Removing…" : "Remove"}
        </button>
      </td>
    </tr>
  );
}
export function Recipients({
  workspace,
  initial,
  profiles,
  timezone,
}: {
  workspace: string;
  initial: Recipient[];
  profiles: SetupProfile[];
  timezone: string;
}) {
  const [rows, setRows] = useState(initial),
    [inviting, setInviting] = useState(false),
    [removed, setRemoved] = useState<{
      value: Recipient;
      revision: number;
    } | null>(null),
    [error, setError] = useState(""),
    [pending, start] = useTransition();
  return (
    <section className="section setup-step">
      <h2>Who gets what</h2>
      <p className="intro">
        Each person sees only the cards from the profiles switched on in their
        row, in the app and in their morning email.
      </p>
      <p className="small-note">
        Morning email times use {timezone}. No email is sent until the client
        goes live.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {removed && (
        <p className="notice">
          Person removed.{" "}
          <button
            className="text-button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  const r = await restoreRecipient(
                    workspace,
                    removed.value,
                    removed.revision,
                  );
                  setRows((old) => [...old, { ...removed.value, ...r }]);
                  setRemoved(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              })
            }
          >
            Undo
          </button>
        </p>
      )}
      <div className="table-wrap">
        <table className="routing-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Profiles they receive</th>
              <th>Morning email</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PersonRow
                key={row.id}
                initial={row}
                workspace={workspace}
                profiles={profiles}
                onRemoved={(value, revision) => {
                  setRows((old) => old.filter((r) => r.id !== value.id));
                  setRemoved({ value, revision });
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="muted">No one has been invited yet.</p>}
      {inviting ? (
        <form action={inviteClientMember} className="invite-inline">
          <input type="hidden" name="workspace" value={workspace} />
          <div className="field-grid">
            <label>
              Name
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Email address
              <input type="email" name="email" required maxLength={254} />
            </label>
            <label>
              Role
              <select name="role" defaultValue="client_user">
                <option value="client_user">Salesperson</option>
                <option value="client_admin">Client admin</option>
              </select>
            </label>
          </div>
          <div className="inline-options">
            <Submit pending="Sending invitation…">Add and invite</Submit>
            <button
              className="button secondary"
              type="button"
              onClick={() => setInviting(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="button secondary" onClick={() => setInviting(true)}>
          + Invite person
        </button>
      )}
    </section>
  );
}
