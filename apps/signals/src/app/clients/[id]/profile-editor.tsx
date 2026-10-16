"use client";
import { useAutosave, SaveStatus } from "@/components/autosave";
import { saveProfile } from "./actions";
import { lines, type Profile, type NamedCompany } from "@/lib/profile";
export function ProfileEditor({
  initial,
  workspace,
  userId,
}: {
  initial: Profile;
  workspace: string;
  userId: string;
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
  const companies = c.named_companies ?? [];
  function company(i: number, patch: Partial<NamedCompany>) {
    criteria(
      "named_companies",
      companies.map((x, n) => (n === i ? { ...x, ...patch } : x)),
    );
  }
  const text = (
    label: string,
    k: "who" | "relevant_moment" | "conversation_to_open",
  ) => (
    <label>
      {label}
      <textarea
        value={p[k]}
        onChange={(e) => field(k, e.target.value)}
        rows={3}
      />
    </label>
  );
  const list = (
    label: string,
    k: "industries" | "locations" | "company_types",
  ) => (
    <label>
      {label}
      <span className="small-note">One per line · optional</span>
      <textarea
        value={(c[k] ?? []).join("\n")}
        onChange={(e) => criteria(k, e.target.value.split("\n"))}
        onBlur={(e) => criteria(k, lines(e.target.value))}
        rows={3}
      />
    </label>
  );
  return (
    <section className="section">
      <div className="section-heading">
        <h2>ICP profile</h2>
        <span className="eyebrow">02 / Setup</span>
      </div>
      <SaveStatus {...a} />
      <p className="small-note">
        Only the profile name is required. Leave anything else blank and come
        back later.
      </p>
      <div className="field-grid">
        <label>
          Profile name
          <input
            value={p.name}
            maxLength={120}
            onChange={(e) => field("name", e.target.value)}
          />
        </label>
        <label>
          Profile type
          <select
            value={p.profile_type}
            onChange={(e) => field("profile_type", e.target.value)}
          >
            <option value="cold_outbound">Cold outbound</option>
            <option value="introducer">Introducer</option>
            <option value="partner">Partner</option>
          </select>
        </label>
      </div>
      {text("Who do you want to reach?", "who")}
      <div className="field-grid">
        {list("Industries", "industries")}
        {list("Locations", "locations")}
        {list("Company types", "company_types")}
        <label>
          Priority job titles
          <span className="small-note">One per line · optional</span>
          <textarea
            value={p.priority_titles.join("\n")}
            onChange={(e) =>
              field("priority_titles", e.target.value.split("\n"))
            }
            onBlur={(e) => field("priority_titles", lines(e.target.value))}
            rows={3}
          />
        </label>
      </div>
      <fieldset>
        <legend>
          Revenue range <span className="muted">Optional</span>
        </legend>
        <div className="range-fields">
          {(["min", "max"] as const).map((k) => (
            <label key={k}>
              {k === "min" ? "Minimum revenue" : "Maximum revenue"}
              <input
                type="number"
                min={0}
                value={c.revenue_range?.[k] ?? ""}
                onChange={(e) =>
                  criteria("revenue_range", {
                    ...c.revenue_range,
                    [k]:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
          <label>
            Currency
            <input
              value={c.revenue_range?.currency ?? ""}
              maxLength={3}
              placeholder="USD"
              onChange={(e) =>
                criteria("revenue_range", {
                  ...c.revenue_range,
                  currency: e.target.value.toUpperCase(),
                })
              }
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>
          Headcount range <span className="muted">Optional</span>
        </legend>
        <div className="field-grid">
          {(["min", "max"] as const).map((k) => (
            <label key={k}>
              {k === "min" ? "Minimum headcount" : "Maximum headcount"}
              <input
                type="number"
                min={0}
                step={1}
                value={c.headcount_range?.[k] ?? ""}
                onChange={(e) =>
                  criteria("headcount_range", {
                    ...c.headcount_range,
                    [k]:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>
          Named companies <span className="muted">Optional extras</span>
        </legend>
        <p className="small-note">
          Discovery uses the criteria above. Add specific companies you always
          want included.
        </p>
        {companies.map((x, i) => (
          <div className="company-row" key={i}>
            <div className="field-grid">
              <label>
                Company name {i + 1}
                <input
                  value={x.name}
                  onChange={(e) => company(i, { name: e.target.value })}
                />
              </label>
              <label>
                Website {i + 1}
                <input
                  value={x.website}
                  onChange={(e) => company(i, { website: e.target.value })}
                />
              </label>
            </div>
            <div className="inline-options">
              <label>
                <input
                  type="checkbox"
                  checked={x.include_parent}
                  onChange={(e) =>
                    company(i, { include_parent: e.target.checked })
                  }
                />
                Include parent
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={x.include_sub_brands}
                  onChange={(e) =>
                    company(i, { include_sub_brands: e.target.checked })
                  }
                />
                Include sub-brands
              </label>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  criteria(
                    "named_companies",
                    companies.filter((_, n) => n !== i),
                  )
                }
              >
                Remove company {i + 1}
              </button>
            </div>
          </div>
        ))}
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            criteria("named_companies", [
              ...companies,
              {
                name: "",
                website: "",
                include_parent: false,
                include_sub_brands: false,
              },
            ])
          }
        >
          Add named company
        </button>
      </fieldset>
      {text("Relevant moment", "relevant_moment")}
      {text("Conversation to open", "conversation_to_open")}
      <div className="field-grid">
        <label>
          Watch-list size
          <input
            type="number"
            min={1}
            max={10000}
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
      <p className="small-note">
        Company discovery and watch-list previews come in Phase 4.
      </p>
    </section>
  );
}
