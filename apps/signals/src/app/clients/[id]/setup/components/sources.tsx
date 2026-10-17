"use client";
import { useState, useTransition } from "react";
import { useAutosave, SaveStatus } from "@/components/autosave";
import {
  saveSource,
  addExtraSources,
  editExtraSource,
  deleteExtraSource,
  validateExtraSource,
} from "../actions";
import type { SourceSetting, ExtraSource } from "@/lib/setup";
function SourceRow({
  initial,
  workspace,
}: {
  initial: SourceSetting;
  workspace: string;
}) {
  const a = useAutosave(
    initial,
    initial.setup_revision,
    "signals:" + workspace + ":source:" + initial.source_key,
    async (v, r) => {
      try {
        return await saveSource(workspace, v, r);
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  );
  return (
    <div className="source-row">
      <label className="check-label">
        <input
          type="checkbox"
          aria-label={"Enable " + a.value.config.name}
          checked={a.value.enabled}
          onChange={(e) => a.edit({ ...a.value, enabled: e.target.checked })}
        />
        <span>
          <strong>{a.value.config.name}</strong>
          <span className="small-note">{a.value.config.description}</span>
        </span>
      </label>
      <div>
        <label>
          Freshness
          <select
            aria-label={a.value.config.name + " freshness"}
            value={a.value.freshness_hours}
            onChange={(e) =>
              a.edit({ ...a.value, freshness_hours: Number(e.target.value) })
            }
          >
            {[
              [24, "24h"],
              [48, "48h"],
              [72, "72h"],
              [168, "7d"],
              [336, "14d"],
            ].map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <SaveStatus {...a} />
      </div>
    </div>
  );
}
export function Sources({
  workspace,
  initial,
  extra,
}: {
  workspace: string;
  initial: SourceSetting[];
  extra: ExtraSource[];
}) {
  const [rows, setRows] = useState(extra),
    [input, setInput] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [url, setURL] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [pending, start] = useTransition();
  const replace = (row: ExtraSource) =>
    setRows((old) => old.map((x) => (x.id === row.id ? row : x)));
  function check(row: ExtraSource) {
    start(async () => {
      try {
        replace(await validateExtraSource(workspace, row.id));
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }
  function add() {
    start(async () => {
      setError("");
      try {
        const added = await addExtraSources(workspace, input);
        setRows((old) => [
          ...old.filter((r) => !added.some((a) => a.id === r.id)),
          ...added,
        ]);
        setInput("");
        setToast(added.length + " sources added and being checked");
        for (const row of added) check(row);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }
  return (
    <section className="section setup-step">
      <h2>Sources</h2>
      <p className="intro">
        Anything older than the window, or with no visible date, is dropped
        before AI reads it.
      </p>
      {initial.map((s) => (
        <SourceRow key={s.source_key} workspace={workspace} initial={s} />
      ))}
      <div className="section-heading">
        <h3>Extra sources for this client</h3>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <p role="status" className="small-note">
        {toast}
      </p>
      {rows.map((row) => (
        <div className="extra-row" key={row.id}>
          {editing === row.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  try {
                    const saved = await editExtraSource(workspace, row, url);
                    replace(saved);
                    setEditing(null);
                    check(saved);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                });
              }}
            >
              <label>
                Source URL
                <input
                  required
                  type="url"
                  value={url}
                  onChange={(e) => setURL(e.target.value)}
                />
              </label>
              <div className="inline-options">
                <button className="button secondary" disabled={pending}>
                  Save source
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div>
                <a href={row.url} target="_blank" rel="noopener noreferrer">
                  {row.url}
                </a>
                <p className="small-note">
                  {row.validation_status === "pending"
                    ? "Being checked…"
                    : row.validation_status === "ok"
                      ? "OK"
                      : row.validation_status === "no_dates"
                        ? "no dates found"
                        : row.last_error || "Check failed"}
                </p>
                {row.detected_feed && row.detected_feed !== row.url && (
                  <p className="small-note">Feed: {row.detected_feed}</p>
                )}
              </div>
              <div className="inline-options">
                <button
                  className="text-button"
                  disabled={pending}
                  onClick={() => {
                    setEditing(row.id);
                    setURL(row.url);
                  }}
                >
                  Edit
                </button>
                <button
                  className="text-button danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      try {
                        await deleteExtraSource(workspace, row);
                        setRows((old) => old.filter((r) => r.id !== row.id));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    })
                  }
                >
                  Remove
                </button>
                {row.validation_status !== "ok" && (
                  <button
                    className="text-button"
                    disabled={pending}
                    onClick={() => check(row)}
                  >
                    Check again
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="extra-add"
      >
        <label>
          Extra source URLs
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://…"
            required
          />
          <span className="small-note">
            Paste URLs separated by commas or spaces. Enter also adds.
          </span>
        </label>
        <button className="button secondary" disabled={pending}>
          {pending ? "Checking…" : "Add"}
        </button>
      </form>
    </section>
  );
}
