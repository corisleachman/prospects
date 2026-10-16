"use client";
import { useEffect, useRef, useState } from "react";
import type { SaveResult } from "@/app/clients/[id]/actions";
// Writes a local recovery copy synchronously on each edit. Only one request can
// be in flight; revision checks prevent another tab's edits being overwritten.
export function useAutosave<T>(
  initial: T,
  initialRevision: number,
  key: string,
  save: (value: T, revision: number) => Promise<SaveResult>,
) {
  const [value, setValue] = useState(initial),
    [status, setStatus] = useState("Saved"),
    [error, setError] = useState("");
  const current = useRef(initial),
    revision = useRef(initialRevision),
    generation = useRef(0),
    inflight = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true),
    saveRef = useRef(save);
  saveRef.current = save;
  const flush = useRef(async () => {});
  flush.current = async () => {
    if (inflight.current) return;
    const g = generation.current,
      v = current.current;
    inflight.current = true;
    setStatus("Saving…");
    let result: SaveResult;
    try {
      result = await saveRef.current(v, revision.current);
    } catch {
      result = {
        error:
          "Couldn’t save. Your changes are kept in this browser. Retry when connected.",
      };
    }
    inflight.current = false;
    if (result.error || result.revision === undefined) {
      if (mounted.current) {
        setError(result.error ?? "Couldn’t save.");
        setStatus("Not saved");
      }
      return;
    }
    revision.current = result.revision;
    if (mounted.current) setError("");
    if (g === generation.current) {
      try {
        const raw = localStorage.getItem(key);
        if (raw && JSON.stringify(JSON.parse(raw).value) === JSON.stringify(v))
          localStorage.removeItem(key);
      } catch {}
      if (mounted.current) setStatus("Saved");
    } else {
      persist();
      if (mounted.current) void flush.current();
    }
  };
  function persist() {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ value: current.current, revision: revision.current }),
      );
    } catch {
      setError(
        "Browser storage is unavailable. Keep this tab open until Saved appears.",
      );
    }
  }
  function edit(next: T) {
    current.current = next;
    generation.current++;
    setValue(next);
    setError("");
    setStatus("Unsaved changes");
    persist();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush.current(), 650);
  }
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.revision === initialRevision) {
          current.current = draft.value;
          setValue(draft.value);
          generation.current++;
          setStatus("Restored unsaved changes");
          timer.current = setTimeout(() => void flush.current(), 650);
        } else {
          setStatus("Not saved");
          setError(
            "An older local draft exists, but setup changed elsewhere. Reload to discard it and use the saved version.",
          );
        }
      }
    } catch {}
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, initialRevision]);
  function discard() {
    try {
      localStorage.removeItem(key);
    } catch {}
    window.location.reload();
  }
  return {
    value,
    edit,
    status,
    error,
    retry: () => void flush.current(),
    discard,
  };
}
export function SaveStatus({
  status,
  error,
  retry,
  discard,
}: {
  status: string;
  error: string;
  retry: () => void;
  discard: () => void;
}) {
  return (
    <div className="save-status">
      <span role="status">{status}</span>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" className="button secondary" onClick={retry}>
            Retry save
          </button>
          <button type="button" className="text-button" onClick={discard}>
            Discard local changes and reload
          </button>
        </>
      )}
    </div>
  );
}
