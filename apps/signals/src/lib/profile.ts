import { industries, canonicalLocation } from "./provider-filters";
export type NamedCompany = {
  name: string;
  website: string;
  include_parent: boolean;
  include_sub_brands: boolean;
};
export type Profile = {
  id: string;
  code?: string;
  name: string;
  profile_type: string;
  who: string;
  criteria: {
    industries?: string[];
    locations?: string[];
    company_types?: string[];
    revenue_range?: {
      min?: number;
      max?: number;
      currency?: string;
      upper_open?: boolean;
    };
    headcount_range?: { min?: number; max?: number; upper_open?: boolean };
    named_companies?: NamedCompany[];
  };
  priority_titles: string[];
  relevant_moment: string;
  conversation_to_open: string;
  watch_list_size: number;
  when_no_person: string;
  setup_revision: number;
};
export type ClientDetails = {
  id: string;
  name: string;
  timezone: string;
  logo_url: string;
  website?: string;
  client_type?: string;
  profile_limit: number;
  setup_revision: number;
};
export function lines(s: string) {
  return s
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
export function validateProfile(p: Profile) {
  if (
    (p.criteria.industries?.length ?? 0) > 50 ||
    (p.criteria.locations?.length ?? 0) > 50 ||
    p.priority_titles.length > 70
  )
    throw new Error("Use up to 50 industries or locations and 70 titles.");
  if (p.code && !/^[A-Z0-9]{1,8}$/.test(p.code))
    throw new Error("Use up to 8 letters or numbers for the profile code.");
  if (p.criteria.industries?.some((v) => !industries.includes(v)))
    throw new Error("Choose industries from the provider list.");
  if (p.criteria.locations?.some((v) => !canonicalLocation(v)))
    throw new Error("Choose a supported country or state.");
  if (!p.name.trim() || p.name.length > 120)
    throw new Error("Enter a profile name, up to 120 characters.");
  if (!["cold_outbound", "introducer", "partner"].includes(p.profile_type))
    throw new Error("Choose a profile type.");
  if (!["needs_person", "drop"].includes(p.when_no_person))
    throw new Error("Choose what happens without a person.");
  if (
    !Number.isInteger(p.watch_list_size) ||
    p.watch_list_size < 1 ||
    p.watch_list_size > 10000
  )
    throw new Error("Watch-list size must be between 1 and 10,000.");
  for (const range of [p.criteria.revenue_range, p.criteria.headcount_range]) {
    if (!range) continue;
    for (const v of [range.min, range.max])
      if (v !== undefined && (!Number.isFinite(v) || v < 0))
        throw new Error(
          "Ranges must contain positive numbers or be left blank.",
        );
    if (
      range.min !== undefined &&
      range.max !== undefined &&
      range.min > range.max
    )
      throw new Error("A range minimum cannot exceed its maximum.");
  }
  if (JSON.stringify(p).length > 90000)
    throw new Error("This profile is too long. Shorten its lists or notes.");
}
