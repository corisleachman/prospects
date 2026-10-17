"use client";
import { useAutosave, SaveStatus } from "@/components/autosave";
import { saveClient } from "./actions";
import type { ClientDetails } from "@/lib/profile";
export function Details({
  initial,
  userId,
}: {
  initial: ClientDetails;
  userId: string;
}) {
  const a = useAutosave(
    initial,
    initial.setup_revision,
    `signals:${userId}:${initial.id}:details`,
    (value, revision) => saveClient(initial.id, revision, value),
  );
  const d = a.value;
  const change = (key: keyof ClientDetails, value: string | number) =>
    a.edit({ ...d, [key]: value });
  return (
    <section className="section">
      <div className="section-heading">
        <h2>Client details</h2>
        <span className="eyebrow">01 / Setup</span>
      </div>
      <SaveStatus {...a} />
      <div className="field-grid">
        <label>
          Client name
          <input
            value={d.name}
            onChange={(e) => change("name", e.target.value)}
            maxLength={120}
          />
        </label>
        <label>
          Timezone
          <input
            value={d.timezone}
            onChange={(e) => change("timezone", e.target.value)}
            list="timezones"
          />
          <datalist id="timezones">
            {[
              "Europe/London",
              "America/New_York",
              "America/Chicago",
              "America/Denver",
              "America/Los_Angeles",
              "Europe/Paris",
              "Asia/Singapore",
              "Australia/Sydney",
              "UTC",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </datalist>
        </label>
        <label>
          Website
          <input
            type="url"
            value={d.website ?? ""}
            maxLength={2000}
            placeholder="https://example.com"
            onChange={(e) => change("website", e.target.value)}
          />
        </label>
        <label>
          Client type
          <select
            value={d.client_type ?? ""}
            onChange={(e) => change("client_type", e.target.value)}
          >
            {[
              "",
              "Ad agency",
              "Consultancy",
              "Consumer brand",
              "Software business",
              "Other",
            ].map((t) => (
              <option key={t} value={t}>
                {t || "Not set"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Logo URL <span className="muted">Optional · HTTPS</span>
          <input
            type="url"
            value={d.logo_url}
            onChange={(e) => change("logo_url", e.target.value)}
            placeholder="https://…"
            maxLength={2000}
          />
        </label>
        <label>
          Placeholder plan
          <select
            value={d.profile_limit}
            onChange={(e) => change("profile_limit", Number(e.target.value))}
          >
            <option value={2}>Starter · 2 profiles</option>
            <option value={5}>Growth · 5 profiles</option>
            <option value={10}>Scale · 10 profiles</option>
          </select>
          <span className="small-note">
            Temporary limits. Pricing and billing come later.
          </span>
        </label>
      </div>
    </section>
  );
}
