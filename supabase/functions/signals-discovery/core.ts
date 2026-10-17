import providerValues from "./provider-values.json" with { type: "json" };
export type Company = {
  key: string;
  name: string;
  website: string;
  domain: string;
  linkedin_url: string;
  industry: string;
  revenue_band?: string;
  headcount_band?: string;
  location: string;
  source: string;
  provider_ids: Record<string, string>;
};
export type Person = {
  key: string;
  name: string;
  title: string;
  linkedin_url: string;
  location: string;
  company_key: string;
  provider_ids: Record<string, string>;
};
export type Result = {
  companies: Company[];
  people: Person[];
  warnings: string[];
  company_total?: number;
  people_total?: number;
};
export type Profile = {
  id: string;
  workspace_id: string;
  name: string;
  setup_revision: number;
  criteria: Record<string, any>;
  priority_titles: string[];
  watch_list_size: number;
  who: string;
  watch_exclusions?: string[];
};
export type Plan = {
  profile: Profile;
  keywords: string[];
  limit: number;
  fx: number;
  fx_date: string;
  company_rate: number;
  people_rate: number;
  kind: "find" | "refresh";
  company_page: number;
  company_cursor: string | null;
  location_groups?: Record<string, unknown>[];
  location_group?: number;
  company_done: boolean;
  named_index: number;
  people_group: number;
  people_page: number;
  max_company_pages: number;
  estimate: number;
  filters: Record<string, any>;
};
export type Call = {
  endpoint: string;
  method: "POST" | "GET";
  body?: Record<string, any>;
  query?: Record<string, string>;
  usd: number;
  kind: "companies" | "named" | "people";
};
export function https(s: unknown, linkedin?: "company" | "in") {
  if (typeof s !== "string" || !s.trim()) return "";
  try {
    const u = new URL(s.includes("://") ? s : "https://" + s);
    if (u.protocol !== "https:" || u.username || u.password) return "";
    if (
      linkedin &&
      (!/(^|\.)linkedin\.com$/i.test(u.hostname) ||
        !u.pathname.startsWith("/" + linkedin + "/"))
    )
      return "";
    if (linkedin) u.hostname = "www.linkedin.com";
    u.search = "";
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}
export function companyKey(domain: string, linkedin: string, name: string) {
  return domain
    ? "domain:" + domain
    : linkedin
      ? "linkedin:" + linkedin
      : "named:" + name.trim().toLowerCase();
}
export function namedCompany(x: any): Company {
  const website = https(x.website),
    domain = website ? new URL(website).hostname.replace(/^www\./, "") : "";
  return {
    key: companyKey(domain, "", String(x.name ?? "")),
    name: String(x.name ?? "").trim(),
    website,
    domain,
    linkedin_url: "",
    industry: "",
    location: "",
    source: "named",
    provider_ids: {},
  };
}
export function defaultKeywords(p: Profile) {
  const types = (p.criteria.company_types ?? []).join(" ");
  if (/consumer/i.test(types)) return ["consumer"];
  return (p.criteria.company_types ?? [])
    .filter((x: string) => x.split(/\s+/).length < 5)
    .slice(0, 5);
}
export function countries(values: string[]) {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return values.map((v) => {
    const t = v.trim();
    if (/^[A-Z]{2}$/.test(t)) return t;
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        if (names.of(code)?.toLowerCase() === t.toLowerCase()) return code;
      }
    throw new Error(
      "Discovery locations currently need country names or two-letter country codes: " +
        t,
    );
  });
}
export function makePlan(
  p: Profile,
  keywords: string[],
  fx: number,
  fxDate: string,
  companyRate: number,
  peopleRate: number,
  kind: "find" | "refresh" = "find",
  approved: Company[] = [],
) {
  const limit = Math.min(p.watch_list_size, 200),
    c = p.criteria,
    named = (c.named_companies ?? []).filter((x: any) => x.name?.trim());
  if (named.some((x: any) => x.include_parent || x.include_sub_brands))
    throw new Error(
      "Parent and sub-brand discovery needs verified ownership data. Untick those options and add the related companies explicitly for this adapter.",
    );
  if (named.length > limit)
    throw new Error(
      "Named companies exceed the watch-list size. Increase it first.",
    );
  if (named.length > 20)
    throw new Error(
      "This discovery adapter supports up to 20 named companies per run.",
    );
  if (!Number.isFinite(fx) || fx <= 0 || companyRate <= 0 || peopleRate <= 0)
    throw new Error("Pricing is unavailable.");
  const filters: Record<string, any> = {};
  const locationGroups: Record<string, unknown>[] = [];
  if (c.industries?.some((v: string) => !providerValues.industries.includes(v)))
    throw new Error("Choose industries from the provider list.");
  if (c.industries?.length)
    filters.industry = { include: c.industries.filter(Boolean) };
  if (c.locations?.length) {
    const location = c.locations.filter(Boolean) as string[];
    const states = location
      .filter((v) => v.endsWith(" (US state)"))
      .map((v) => v.slice(0, -11));
    const metros = location
      .filter((v) => v in providerValues.metros)
      .map((v) => (providerValues.metros as Record<string, string>)[v]);
    const country = location.filter(
      (v) => !v.endsWith(" (US state)") && !(v in providerValues.metros),
    );
    if (country.length)
      locationGroups.push({ country_code: countries(country) });
    if (states.length)
      locationGroups.push({ country_code: ["US"], state: { include: states } });
    if (metros.length) locationGroups.push({ city: { include: metros } });
    if (locationGroups.length === 1) filters.hq = locationGroups[0];
  }
  if (keywords.filter(Boolean).length)
    filters.keywords = { include: keywords.filter(Boolean) };
  if (
    c.headcount_range &&
    (c.headcount_range.min !== undefined || c.headcount_range.max !== undefined)
  )
    filters.employee_count = {
      min: c.headcount_range.min ?? 0,
      max: c.headcount_range.max ?? 0,
    };
  if (c.revenue_range && (c.revenue_range.min > 0 || c.revenue_range.max > 0)) {
    if (c.revenue_range.currency && c.revenue_range.currency !== "USD")
      throw new Error(
        "BlitzAPI revenue filters use USD. Set the profile revenue currency to USD first.",
      );
    filters.revenue = {
      min: c.revenue_range.min ?? 0,
      max: c.revenue_range.max ?? 0,
    };
  }
  if (
    kind === "find" &&
    !Object.keys(filters).length &&
    !locationGroups.length &&
    !named.length
  )
    throw new Error(
      "Add industries, locations, size or search keywords before finding matches.",
    );
  const pagesPerLocation = Math.ceil(Math.max(limit - named.length, 0) / 50);
  const maxCompanyPages =
    kind === "find" ? pagesPerLocation * Math.max(locationGroups.length, 1) : 0;
  const namedCosts = kind === "find" ? named.length : 0,
    companyPagesCost = Array.from(
      { length: maxCompanyPages },
      (_, i) =>
        Math.ceil(
          Math.min(
            50,
            Math.max(
              limit - named.length - (i % Math.max(pagesPerLocation, 1)) * 50,
              0,
            ),
          ) *
            companyRate *
            fx *
            1e6,
        ) / 1e6,
    ).reduce((a, b) => a + b, 0);
  const estimate =
    companyPagesCost +
    (namedCosts * Math.ceil(companyRate * fx * 1e6)) / 1e6 +
    (Math.ceil((kind === "refresh" ? approved.length : limit) / 50) *
      2 *
      Math.ceil(peopleRate * fx * 1e6)) /
      1e6;
  if (estimate <= 0)
    throw new Error(
      "Save companies with LinkedIn URLs before enabling refresh.",
    );
  const plan: Plan = {
    profile: p,
    keywords,
    limit,
    fx,
    fx_date: fxDate,
    company_rate: companyRate,
    people_rate: peopleRate,
    kind,
    company_page: 0,
    company_cursor: null,
    location_groups: locationGroups.length ? locationGroups : [{}],
    location_group: 0,
    company_done: kind === "refresh" || maxCompanyPages === 0,
    named_index: kind === "refresh" ? named.length : 0,
    people_group: 0,
    people_page: 1,
    max_company_pages: maxCompanyPages,
    estimate: Math.ceil(estimate * 1e6) / 1e6,
    filters,
  };
  const result: Result = {
    companies:
      kind === "refresh"
        ? approved
        : named.map(namedCompany).filter((x: Company) => x.name),
    people: [],
    warnings: [],
  };
  if (defaultKeywords(p).length || c.company_types?.length)
    result.warnings.push(
      "Company descriptions are search hints, not verified ICP fit. Review the candidates.",
    );
  return { plan, result };
}
export function nextCall(p: Plan, r: Result): Call | null {
  const named = (p.profile.criteria.named_companies ?? []).filter((x: any) =>
    x.name?.trim(),
  );
  if (!p.company_done && p.company_page < p.max_company_pages) {
    const count = Math.min(50, Math.max(p.limit - r.companies.length, 0));
    return {
      endpoint: "blitzapi.companies.search",
      method: "POST",
      body: {
        company: {
          ...p.filters,
          ...(p.location_groups?.length
            ? { hq: p.location_groups[p.location_group ?? 0] }
            : {}),
        },
        max_results: count,
        ...(p.company_cursor ? { cursor: p.company_cursor } : {}),
      },
      usd: count * p.company_rate,
      kind: "companies",
    };
  }
  if (p.named_index < named.length)
    return {
      endpoint: "blitzapi.companies.search",
      method: "POST",
      body: {
        company: { name: { include: [named[p.named_index].name] } },
        max_results: 1,
      },
      usd: p.company_rate,
      kind: "named",
    };
  const companies = r.companies.filter((c) => c.linkedin_url).slice(0, p.limit),
    group = companies.slice(p.people_group * 50, (p.people_group + 1) * 50);
  if (group.length && r.people.length < p.limit)
    return {
      endpoint: "harvestapi.linkedin.leads.search",
      method: "GET",
      query: {
        currentCompanies: group.map((c) => c.linkedin_url).join(","),
        ...(p.profile.priority_titles.length
          ? { currentJobTitles: p.profile.priority_titles.join(",") }
          : { seniorityLevelIds: "220,300,310,320" }),
        page: String(p.people_page),
      },
      usd: p.people_rate,
      kind: "people",
    };
  return null;
}
function normalCompany(x: any, source = "discovered"): Company | null {
  const name = String(x.name ?? "").trim();
  if (!name) return null;
  const website = https(x.website || x.domain),
    domain = website ? new URL(website).hostname.replace(/^www\./, "") : "",
    li = https(x.linkedin_url, "company");
  if (!website && !li) return null;
  return {
    key: companyKey(domain, li, name),
    name,
    website,
    domain,
    linkedin_url: li,
    industry: String(x.industry ?? ""),
    revenue_band:
      typeof x.revenue === "string"
        ? x.revenue
        : typeof x.revenue?.range === "string"
          ? x.revenue.range
          : "",
    headcount_band: String(x.size ?? ""),
    location: [x.hq?.city, x.hq?.country_code].filter(Boolean).join(", "),
    source,
    provider_ids: {
      blitzapi: String(x.id ?? ""),
      ...(x.linkedin_id ? { linkedin: String(x.linkedin_id) } : {}),
    },
  };
}
export function absorb(p: Plan, r: Result, call: Call, data: any) {
  if (
    data?.success === false ||
    data?.error ||
    (typeof data?.status === "number" && data.status >= 400)
  )
    throw new Error("Provider returned an error inside its response.");
  if (call.kind === "people") {
    if (!Array.isArray(data?.elements))
      throw new Error("Unexpected people response shape.");
    for (const x of data.elements) {
      const li = https(x.linkedinUrl, "in");
      if (!li) continue;
      const positions = Array.isArray(x.currentPositions)
        ? x.currentPositions
        : [];
      // Harvest returns numeric LinkedIn company URLs while Blitz returns slugs.
      // Prefer the URL; accept only a unique exact company name from the
      // employer-filtered result when those representations differ.
      const matched = positions
        .map((pos: any) => {
          const byUrl = r.companies.find(
            (c) =>
              c.linkedin_url === https(pos.companyLinkedinUrl, "company") ||
              (!!pos.companyId &&
                c.provider_ids.linkedin === String(pos.companyId)),
          );
          const byName = r.companies.filter(
            (c) =>
              c.name.trim().toLowerCase() ===
              String(pos.companyName ?? "")
                .trim()
                .toLowerCase(),
          );
          return {
            position: pos,
            company: byUrl ?? (byName.length === 1 ? byName[0] : undefined),
          };
        })
        .find((x: any) => x.company);
      if (!matched) continue;
      const { position, company } = matched;
      const name =
        [x.firstName, x.lastName].filter(Boolean).join(" ").trim() ||
        String(x.name ?? "");
      if (!name) continue;
      const key = "person:" + li + "|" + company.key;
      if (
        (p.profile.watch_exclusions ?? []).includes(key) &&
        p.kind === "refresh"
      )
        continue;
      if (!r.people.some((x) => x.key === key))
        r.people.push({
          key,
          name,
          title: String(position.title ?? ""),
          linkedin_url: li,
          location: String(
            x.location?.linkedinText ?? x.location?.parsed?.text ?? "",
          ),
          company_key: company.key,
          provider_ids: { harvestapi: String(x.id ?? "") },
        });
    }
    r.people = r.people.slice(0, p.limit);
    r.people_total =
      (r.people_total ?? 0) +
      (p.people_page === 1 ? Number(data.pagination?.totalElements ?? 0) : 0);
    if (
      p.people_page === 1 &&
      Number(data.pagination?.totalPages ?? 1) > 1 &&
      data.elements.length > 0
    )
      p.people_page = 2;
    else {
      p.people_group++;
      p.people_page = 1;
    }
  } else {
    if (!Array.isArray(data?.results))
      throw new Error("Unexpected company response shape.");
    const named = (p.profile.criteria.named_companies ?? []).filter((x: any) =>
        x.name?.trim(),
      ),
      target = call.kind === "named" ? named[p.named_index] : null;
    for (const raw of data.results) {
      const c = normalCompany(raw, target ? "named" : "discovered");
      if (!c) continue;
      if (target) {
        const manual = namedCompany(target);
        if (
          (manual.domain && manual.domain !== c.domain) ||
          (!manual.domain && manual.name.toLowerCase() !== c.name.toLowerCase())
        ) {
          r.warnings.push(
            "Named company could not be verified: " + manual.name,
          );
          continue;
        }
        r.companies = r.companies.filter((x) => x.key !== manual.key);
      }
      if (!r.companies.some((x) => x.key === c.key)) r.companies.push(c);
    }
    r.companies = r.companies
      .sort(
        (a, b) => Number(b.source === "named") - Number(a.source === "named"),
      )
      .slice(0, p.limit);
    if (call.kind === "companies") {
      if (!p.company_cursor)
        r.company_total =
          (r.company_total ?? 0) +
          Number(
            data.total_results ?? data.results_length ?? data.results.length,
          );
      p.company_page++;
      p.company_cursor = typeof data.cursor === "string" ? data.cursor : null;
      if (!p.company_cursor) p.location_group = (p.location_group ?? 0) + 1;
      p.company_done =
        r.companies.length >= p.limit ||
        (p.location_group ?? 0) >= (p.location_groups?.length ?? 1) ||
        p.company_page >= p.max_company_pages;
    } else p.named_index++;
  }
}
export function receiptCost(headers: Headers, cap: number) {
  const raw = headers.get("X-Treg-Cost-Micro");
  if (raw === null || raw.trim() === "")
    return { usd: cap, basis: "estimated" };
  const n = Number(raw) / 1e6;
  if (!Number.isFinite(n) || n < 0)
    throw new Error("Invalid provider cost receipt");
  return { usd: n, basis: "reported" };
}

export function ecbRate(xml: string, now = Date.now()) {
  const usd = Number(
    xml.match(/currency=["']USD["']\s+rate=["']([^"']+)["']/)?.[1],
  );
  const gbp = Number(
    xml.match(/currency=["']GBP["']\s+rate=["']([^"']+)["']/)?.[1],
  );
  const date = xml.match(/time=["'](\d{4}-\d{2}-\d{2})["']/)?.[1];
  if (
    !date ||
    now - Date.parse(date) > 7 * 86400000 ||
    Date.parse(date) > now + 86400000 ||
    !Number.isFinite(usd) ||
    !Number.isFinite(gbp) ||
    usd <= 0 ||
    gbp <= 0
  )
    throw new Error("A current ECB USD/GBP rate is required");
  return { fx: gbp / usd, date };
}
