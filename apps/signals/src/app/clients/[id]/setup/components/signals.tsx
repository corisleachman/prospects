"use client";
import { useState, useTransition } from "react";
import { ChipInput } from "@/components/chip-input";
import { saveRule, deleteRule } from "../actions";
import { keywordParts, type SignalRule, type SetupProfile } from "@/lib/setup";
const blank: SignalRule = {
  id: "",
  label: "",
  description: "",
  polarity: "positive",
  tone_guidance: "",
  keywords: [],
  is_active: true,
  applies_to_all: true,
  profile_ids: [],
  setup_revision: 0,
};
export function Signals({
  workspace,
  initial,
  profiles,
}: {
  workspace: string;
  initial: SignalRule[];
  profiles: SetupProfile[];
}) {
  const [rules, setRules] = useState(initial),
    [edit, setEdit] = useState<SignalRule | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [pending, start] = useTransition();
  function persist(rule: SignalRule) {
    start(async () => {
      setError("");
      try {
        const saved = await saveRule(workspace, rule);
        setRules((old) =>
          rule.id
            ? old.map((r) => (r.id === rule.id ? saved : r))
            : [...old, saved],
        );
        setEdit(null);
        setStatus("Saved");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }
  function remove(rule: SignalRule) {
    start(async () => {
      try {
        await deleteRule(workspace, rule);
        setRules((old) => old.filter((r) => r.id !== rule.id));
        setStatus("Signal removed.");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }
  const editor = edit && (
    <form
      className="rule-editor"
      onSubmit={(e) => {
        e.preventDefault();
        persist(edit);
      }}
    >
      <h3>{edit.id ? "Edit signal" : "Add signal"}</h3>
      <div className="field-grid">
        <label>
          Name
          <input
            maxLength={160}
            required
            value={edit.label}
            onChange={(e) => setEdit({ ...edit, label: e.target.value })}
          />
        </label>
        <label>
          Type
          <select
            aria-label="Type"
            value={edit.polarity}
            onChange={(e) =>
              setEdit({
                ...edit,
                polarity: e.target.value as SignalRule["polarity"],
              })
            }
          >
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative (handled gently)</option>
          </select>
        </label>
      </div>
      <label>
        What counts<span className="small-note">The AI judge reads this.</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={edit.description}
          onChange={(e) => setEdit({ ...edit, description: e.target.value })}
        />
      </label>
      <ChipInput
        label="Keywords"
        values={edit.keywords}
        onChange={(keywords) => setEdit({ ...edit, keywords })}
        keywords
        hint="Quotes mean an exact phrase. A leading minus excludes a word."
      />
      <p className="small-note keyword-preview">
        Syntax preview:{" "}
        {edit.keywords
          .map((v) => {
            const k = keywordParts(v);
            return (
              (k.excluded
                ? "exclude "
                : k.exact
                  ? "exact phrase "
                  : "contains ") + k.text
            );
          })
          .join(" · ") || "No keyword restriction"}
      </p>
      <fieldset>
        <legend>Applies to</legend>
        <div className="chips">
          <button
            className="chip"
            type="button"
            aria-pressed={edit.applies_to_all}
            onClick={() => setEdit({ ...edit, applies_to_all: true })}
          >
            All
          </button>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              title={p.name}
              aria-pressed={
                !edit.applies_to_all && edit.profile_ids.includes(p.id)
              }
              onClick={() =>
                setEdit({
                  ...edit,
                  applies_to_all: false,
                  profile_ids: edit.applies_to_all
                    ? [p.id]
                    : edit.profile_ids.includes(p.id)
                      ? edit.profile_ids.filter((id) => id !== p.id)
                      : [...edit.profile_ids, p.id],
                })
              }
            >
              {p.code}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        Tone guidance
        <span className="small-note">
          Sensitive news and awards never get a pitch.
        </span>
        <textarea
          rows={2}
          value={edit.tone_guidance}
          onChange={(e) => setEdit({ ...edit, tone_guidance: e.target.value })}
        />
      </label>
      <div className="inline-options">
        <button disabled={pending} className="button" type="submit">
          {pending ? "Saving…" : "Save signal"}
        </button>
        <button
          disabled={pending}
          className="button secondary"
          type="button"
          onClick={() => setEdit(null)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
  return (
    <section className="section setup-step">
      <div className="section-heading">
        <h2>Signals</h2>
        <button
          className="button secondary"
          disabled={pending || !!edit}
          onClick={() => {
            setEdit({ ...blank });
            setStatus("");
          }}
        >
          + Add signal
        </button>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <p className="small-note" role="status">
        {pending ? "Saving…" : status}
      </p>
      {rules.map((r) => (
        <div className="rule-row" key={r.id}>
          {edit?.id === r.id ? (
            editor
          ) : (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  aria-label={"Enable " + r.label}
                  checked={r.is_active}
                  disabled={pending}
                  onChange={(e) =>
                    persist({ ...r, is_active: e.target.checked })
                  }
                />
                <span>
                  <strong>{r.label}</strong>
                  <span className="small-note">{r.description}</span>
                </span>
              </label>
              <div className="rule-content">
                {!!r.keywords.length && (
                  <div className="chips">
                    {r.keywords.map((v) => (
                      <span
                        key={v}
                        className={
                          "token " +
                          (keywordParts(v).excluded
                            ? "keyword-exclude"
                            : keywordParts(v).exact
                              ? "keyword-exact"
                              : "")
                        }
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                )}
                <p className="small-note">
                  Profiles:{" "}
                  {r.applies_to_all
                    ? "All"
                    : r.profile_ids
                        .map((id) => profiles.find((p) => p.id === id)?.code)
                        .filter(Boolean)
                        .join(", ") || "Choose profiles"}
                </p>
              </div>
              <div className="rule-actions">
                <span className={"badge polarity-" + r.polarity}>
                  {r.polarity[0].toUpperCase() + r.polarity.slice(1)}
                </span>
                <button
                  className="text-button"
                  disabled={pending}
                  onClick={() => setEdit({ ...r })}
                >
                  Edit
                </button>
                <button
                  className="text-button danger"
                  disabled={pending}
                  onClick={() => remove(r)}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      {edit && !edit.id && editor}
    </section>
  );
}
