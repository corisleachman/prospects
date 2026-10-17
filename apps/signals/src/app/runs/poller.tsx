"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pollCollection } from "./actions";
export function CollectionPoller({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  useEffect(() => {
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const status = await pollCollection(id);
        setError("");
        router.refresh();
        if (!["queued", "running"].includes(status)) clearInterval(timer);
      } catch {
        setError("Couldn’t refresh the run. Retrying shortly.");
      } finally {
        busy = false;
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [id, router]);
  return (
    <p role="status" className="notice">
      {error ||
        "Collecting and filtering. This page updates while the run is in progress."}
      Nothing is sent.
    </p>
  );
}
