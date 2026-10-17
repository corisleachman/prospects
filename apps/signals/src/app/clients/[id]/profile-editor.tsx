"use client";
import Link from "next/link";
import { useAutosave, SaveStatus } from "@/components/autosave";
import { ChipInput } from "@/components/chip-input";
import {
  industries,
  locationOptions,
  titleSuggestions,
  revenueSteps,
  headcountSteps,
  revenueLabel,
  headcountLabel,
} from "@/lib/provider-filters";
import { saveProfile } from "./actions";
import type { Profile, NamedCompany } from "@/lib/profile";
export function ProfileEditor({
  initial,
  workspace,
  userId,
  summary,
}: {
  initial: Profile;
  workspace: string;
  userId: string;
  summary?: {
    result: any;
    status: string;
    estimated_gbp: number;
    actual_gbp: number;
  };
}) {
  const a = useAutosave(
    initial,
    initial.setup_revision,
    `signals:${userId}:${workspace}:${initial.id}`,
    (v, r) => saveProfile(workspace, r, v),
  );
  const p = a.value,
    c = p.criteria;
  function field(k: keyof Profile, v: unknown) {
    a.edit({ ...p, [k]: v });
  }
  function criteria(k: keyof Profile["criteria"], v: unknown) {
    field("criteria", { ...c, [k]: v });
  }
  const text = (
    label: string,
    k: "who" | "relevant_moment" | "conversation_to_open",
    hint?: string,
  ) => (
    <label>
      {label}
      {hint && <span className="small-note">{hint}</span>}
      <textarea
        rows={3}
        aria-label={label}
        value={p[k]}
        onChange={(e) => field(k, e.target.value)}
      />
    </label>
  );
  function range(
    key: "revenue_range" | "headcount_range",
    label: string,
    steps: number[],
    format: (n: number) => string,
  ) {
    const value = c[key] ?? {};
    return (
      <fieldset>
        <legend>{label}</legend>
        <div className="field-grid">
          {(["min", "max"] as const).map((k) => (
            <label key={k}>
              {k === "min" ? "From" : "To"}
              <select
                aria-label={label + " " + (k === "min" ? "from" : "to")}
                value={
                  k === "max" && value.upper_open
                    ? steps[steps.length - 1]
                    : (value[k] ?? 0)
                }
                onChange={(e) =>
                  criteria(key, {
                    ...value,
                    ...(key === "revenue_range" ? { currency: "USD" } : {}),
                    [k]:
                      k === "max" &&
                      Number(e.target.value) === steps[steps.length - 1]
                        ? undefined
                        : Number(e.target.value) || undefined,
                    ...(k === "max"
                      ? {
                          upper_open:
                            Number(e.target.value) === steps[steps.length - 1],
                        }
                      : {}),
                  })
                }
              >
                {steps.map((n) => (
                  <option key={n} value={n}>
                    {format(n)}
                  </option>
                ))}
                {value[k] && !steps.includes(value[k]!) && (
                  <option value={value[k]}>
                    Existing: {format(value[k]!)}
                  </option>
                )}
              </select>
            </label>
          ))}
        </div>
        {value.min && value.max && value.max < value.min ? (
          <p role="alert">To must be at least From.</p>
        ) : null}
      </fieldset>
    );
  }
  const companies = c.named_companies ?? [];
  function named(values: string[]) {
    criteria(
      "named_companies",
      values.map((value) => {
        const existing = companies.find((x) => (x.website || x.name) === value);
        if (existing) return existing;
        let website = "";
        try {
          const u = new URL(value.includes("://") ? value : "https://" + value);
          if (
            !value.includes(" ") &&
            u.hostname.includes(".") &&
            u.protocol === "https:"
          )
            website = u.href;
        } catch {}
        return {
          name: website
            ? new URL(website).hostname.replace(/^www\./, "")
            : value,
          website,
          include_parent: false,
          include_sub_brands: false,
        } as NamedCompany;
      }),
    );
  }
  return (
    <section className="section profile-form">
      <div className="section-heading">
        <h2>ICP profile</h2>
        <SaveStatus {...a} />
      </div>
      <div className="profile-identity">
        <label>
          Profile code
          <input
            maxLength={8}
            value={p.code ?? ""}
            onChange={(e) => field("code", e.target.value.toUpperCase())}
          />
        </label>
        <label>
          Profile name
          <input
            value={p.name}
            maxLength={120}
            onChange={(e) => field("name", e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Type</legend>
          <div className="chips">
            {[
              ["cold_outbound", "Cold outbound"],
              ["introducer", "Introducer"],
              ["partner", "Partner"],
            ].map(([value, label]) => (
              <button
                className="chip"
                aria-pressed={p.profile_type === value}
                key={value}
                type="button"
                onClick={() => field("profile_type", value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      {text("Who do you want to reach?", "who")}
      <ChipInput
        label="Priority job titles"
        values={p.priority_titles}
        onChange={(v) => field("priority_titles", v)}
        options={titleSuggestions}
        hint="Titles are sent directly to the provider’s job-title filter."
      />
      <div className="field-grid">
        <ChipInput
          label="Industries"
          values={c.industries ?? []}
          onChange={(v) => criteria("industries", v)}
          options={industries}
          strict
          hint="Picked from the data provider's industry list, so each one is a real search filter."
        />
        <ChipInput
          label="Locations"
          values={c.locations ?? []}
          onChange={(v) => criteria("locations", v)}
          options={locationOptions}
          strict
          hint="Countries and states map to HQ filters. City/metro options use city keywords, not exact metro boundaries. Leave empty for anywhere."
        />
      </div>
      <div className="criteria-ranges">
        {range("revenue_range", "Revenue (USD)", revenueSteps, revenueLabel)}
        {range("headcount_range", "Headcount", headcountSteps, headcountLabel)}
      </div>
      <ChipInput
        label="Also watch these companies or brands"
        values={companies.map((x) => x.website || x.name)}
        onChange={named}
        hint="Names or websites. Add related brands explicitly. Optional."
      />
      <div className="field-grid">
        {text(
          "Relevant moment",
          "relevant_moment",
          "Used to score how relevant each signal is.",
        )}
        {text(
          "Conversation to open",
          "conversation_to_open",
          "Guides the tone and ask of the openers.",
        )}
      </div>
      <div className="field-grid">
        <label>
          Watch-list size
          <input
            type="number"
            min={1}
            max={200}
            value={p.watch_list_size}
            onChange={(e) => field("watch_list_size", Number(e.target.value))}
          />
        </label>
        <label>
          When no person is found
          <select
            value={p.when_no_person}
            onChange={(e) => field("when_no_person", e.target.value)}
          >
            <option value="needs_person">Show as “needs a person”</option>
            <option value="drop">Drop the item</option>
          </select>
        </label>
      </div>
      <div className="match-panel">
        <h3>Find matches</h3>
        <p>
          Preview companies and people for {p.code || p.name}. Check the
          estimated cost before approving a search.
        </p>
        {summary && (
          <>
            <p>
              {summary.result.companies.length} companies and{" "}
              {summary.result.people.length} people in the latest preview for{" "}
              {p.code || p.name}.
            </p>
            <p className="small-note">
              {summary.result.companies
                .slice(0, 3)
                .map((x: any) => x.name)
                .join(" · ")}
            </p>
            <p className="small-note">
              Candidates await review. Weekly refresh is optional on the saved
              watch list. Data costs are quoted in GBP before each run.
            </p>
          </>
        )}
        <Link
          className="button"
          href={"/clients/" + workspace + "/find?profile=" + p.id}
        >
          Find matches
        </Link>
      </div>
    </section>
  );
}
