"use client";
import { useFormStatus } from "react-dom";
export function Submit({
  children,
  pending = "Saving…",
}: {
  children: React.ReactNode;
  pending?: string;
}) {
  const status = useFormStatus();
  return (
    <button
      className="button"
      type="submit"
      disabled={status.pending}
      aria-disabled={status.pending}
    >
      {status.pending ? pending : children}
    </button>
  );
}
