"use client";
import { useId, useState } from "react";
import { splitChips, keywordParts } from "@/lib/setup";
export function ChipInput({
  label,
  values,
  onChange,
  options,
  hint,
  strict = false,
  keywords = false,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  options?: string[];
  hint?: string;
  strict?: boolean;
  keywords?: boolean;
}) {
  const id = useId(),
    [draft, setDraft] = useState(""),
    [editing, setEditing] = useState<number | null>(null),
    [error, setError] = useState("");
  function add(raw: string) {
    const incoming = splitChips(raw);
    if (!incoming.length) return;
    const mapped = incoming.map(
      (v) =>
        options?.find((o) => o.toLocaleLowerCase() === v.toLocaleLowerCase()) ??
        (strict ? null : v),
    );
    if (mapped.some((x) => x === null)) {
      setError(
        "Choose a value from the suggestions. Unrecognised values were not added.",
      );
      return;
    }
    const next = values.filter((_, i) => i !== editing);
    for (const v of mapped as string[])
      if (!next.some((x) => x.toLowerCase() === v.toLowerCase())) next.push(v);
    onChange(next);
    setDraft("");
    setEditing(null);
    setError("");
  }
  return (
    <div className="chip-field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="small-note" id={id + "-hint"}>
          {hint}
        </p>
      )}
      <div className="chip-box">
        <div className="chips">
          {values.map((v, i) => (
            <span
              className={
                "token" +
                (keywords
                  ? keywordParts(v).excluded
                    ? " keyword-exclude"
                    : keywordParts(v).exact
                      ? " keyword-exact"
                      : ""
                  : "")
              }
              key={v}
            >
              <button
                type="button"
                aria-label={"Edit " + label + ": " + v}
                onClick={() => {
                  setEditing(i);
                  setDraft(v);
                  document.getElementById(id)?.focus();
                }}
              >
                {v}
              </button>
              <button
                type="button"
                aria-label={"Remove " + label + ": " + v}
                onClick={() => {
                  onChange(values.filter((_, n) => i !== n));
                  if (editing === i) {
                    setEditing(null);
                    setDraft("");
                  }
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          id={id}
          aria-describedby={hint ? id + "-hint" : undefined}
          list={options ? id + "-values" : undefined}
          value={draft}
          placeholder={values.length ? "Add another…" : "Type to add…"}
          autoComplete="off"
          onChange={(e) => {
            if (/[,\n]/.test(e.target.value)) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
            if (e.key === "Escape") {
              setDraft("");
              setEditing(null);
              setError("");
            }
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[,\n]/.test(t)) {
              e.preventDefault();
              add(t);
            }
          }}
        />
        {options && (
          <datalist id={id + "-values"}>
            {options.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        )}
      </div>
      {error && (
        <p role="alert" className="small-note">
          {error}
        </p>
      )}
      <p className="small-note">
        Press Enter to add. Commas add several at once. Select a chip to edit
        it.
      </p>
    </div>
  );
}
