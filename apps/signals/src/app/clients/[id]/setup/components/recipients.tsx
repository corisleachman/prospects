"use client";
import { useState, useTransition } from "react";
import { useAutosave, SaveStatus } from "@/components/autosave";
import { Submit } from "@/components/submit";
import { inviteClientMember } from "../../../actions";
import {
  saveRecipient,
  saveClientLimits,
  removeRecipient,
  restoreRecipient,
} from "../actions";
import type { Recipient, SetupProfile, DeliveryLimits } from "@/lib/setup";
function PersonRow({
  initial,
  workspace,
  profiles,
  onRemoved,
  defaults,
}: {
  initial: Recipient;
  workspace: string;
  profiles: SetupProfile[];
  onRemoved: (v: Recipient, revision: number) => void;
  defaults: DeliveryLimits;
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
          <summary>
            <span>Limits</span>{" "}
            <span className="small-note">
              {v.max_cards_per_day} a day
              {v.max_cards_override != null ? " (custom)" : ""} ·{" "}
              {v.no_repeat_days} days
              {v.repeat_days_override != null ? " (custom)" : ""}
            </span>
          </summary>
          <label className="check-label">
            <input
              type="checkbox"
              aria-label={"Override daily card cap for " + v.email}
              checked={v.max_cards_override != null}
              onChange={(e) =>
                a.edit({
                  ...v,
                  max_cards_override: e.target.checked
                    ? v.max_cards_per_day
                    : null,
                  max_cards_per_day: e.target.checked
                    ? v.max_cards_per_day
                    : defaults.daily,
                })
              }
            />
            Override daily card cap
          </label>
          <label>
            Daily card cap
            <input
              aria-label={"Daily card cap for " + v.email}
              type="number"
              min={1}
              max={100}
              disabled={v.max_cards_override == null}
              value={v.max_cards_override ?? defaults.daily}
              onChange={(e) =>
                a.edit({
                  ...v,
                  max_cards_override: Number(e.target.value),
                  max_cards_per_day: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              aria-label={"Override repeat window for " + v.email}
              checked={v.repeat_days_override != null}
              onChange={(e) =>
                a.edit({
                  ...v,
                  repeat_days_override: e.target.checked
                    ? v.no_repeat_days
                    : null,
                  no_repeat_days: e.target.checked
                    ? v.no_repeat_days
                    : defaults.repeat,
                })
              }
            />
            Override repeat window
          </label>
          <label>
            Days before repeat
            <input
              aria-label={"Days before repeat for " + v.email}
              type="number"
              min={1}
              max={365}
              disabled={v.repeat_days_override == null}
              value={v.repeat_days_override ?? defaults.repeat}
              onChange={(e) =>
                a.edit({
                  ...v,
                  repeat_days_override: Number(e.target.value),
                  no_repeat_days: Number(e.target.value),
                })
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
function ClientLimits({
  workspace,
  initial,
  onSaved,
}: {
  workspace: string;
  initial: DeliveryLimits;
  onSaved: (limits: DeliveryLimits, routes: Recipient[]) => void;
}) {
  const a = useAutosave(
    { daily: initial.daily, repeat: initial.repeat },
    initial.revision,
    "signals:" + workspace + ":delivery-defaults",
    async (v, r) => {
      const result = await saveClientLimits(workspace, v, r);
      if (result.error) return { error: result.error };
      onSaved({ ...v, revision: result.revision! }, result.routes ?? []);
      return { revision: result.revision! };
    },
  );
  return (
    <div className="client-limits">
      <strong>Limits</strong>
      <label>
        Cards per person per day
        <input
          type="number"
          min={1}
          max={100}
          value={a.value.daily}
          onChange={(e) =>
            a.edit({ ...a.value, daily: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Repeat window (days)
        <input
          type="number"
          min={1}
          max={365}
          value={a.value.repeat}
          onChange={(e) =>
            a.edit({ ...a.value, repeat: Number(e.target.value) })
          }
        />
      </label>
      <SaveStatus {...a} />
      <p className="small-note">
        Applies to everyone unless their row has an override.
      </p>
    </div>
  );
}
export function Recipients({
  workspace,
  initial,
  profiles,
  timezone,
  limits,
}: {
  workspace: string;
  initial: Recipient[];
  profiles: SetupProfile[];
  timezone: string;
  limits: DeliveryLimits;
}) {
  const [defaults, setDefaults] = useState(limits);
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
      <ClientLimits
        workspace={workspace}
        initial={limits}
        onSaved={(next, routes) => {
          setDefaults(next);
          setRows((old) =>
            old.map((r) => ({ ...r, ...routes.find((x) => x.id === r.id) })),
          );
        }}
      />
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
                key={row.id + ":" + row.setup_revision}
                defaults={defaults}
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
