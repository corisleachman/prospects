import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makePlan,
  ecbRate,
  nextCall,
  absorb,
  receiptCost,
  https,
  type Profile,
} from "../../../supabase/functions/signals-discovery/core";
const profile: Profile = {
  id: "p",
  workspace_id: "w",
  name: "Brands",
  setup_revision: 0,
  criteria: {
    industries: ["Consumer Goods"],
    locations: ["United States"],
    company_types: ["Consumer brands"],
  },
  priority_titles: ["CMO"],
  watch_list_size: 100,
  who: "",
};
test("discovery quote bounds every page and uses exact supported filters", () => {
  const { plan, result } = makePlan(
    profile,
    ["consumer"],
    0.75,
    "2026-10-16",
    0.000495,
    0.1,
  );
  assert.deepEqual(plan.filters.hq, { country_code: ["US"] });
  assert.deepEqual(plan.filters.industry, { include: ["Consumer Goods"] });
  assert.equal(plan.max_company_pages, 2);
  assert.ok(plan.estimate >= 0.337125 && plan.estimate <= 0.33713);
  assert.equal(nextCall(plan, result)?.usd, 0.02475);
  assert.throws(
    () =>
      makePlan(
        {
          ...profile,
          criteria: { revenue_range: { min: 1, currency: "GBP" } },
        },
        [],
        0.75,
        "2026-10-16",
        0.000495,
        0.1,
      ),
    /USD/,
  );
});
test("normalisation keeps linked people, deduplicates, and never invents source URLs", () => {
  const { plan, result } = makePlan(
    profile,
    ["consumer"],
    0.75,
    "2026-10-16",
    0.000495,
    0.1,
  );
  const call = nextCall(plan, result)!;
  absorb(plan, result, call, {
    results: [
      {
        name: "Example",
        domain: "example.test",
        linkedin_url: "https://linkedin.com/company/example",
      },
      {
        name: "Example",
        domain: "example.test",
        linkedin_url: "https://linkedin.com/company/example",
      },
      { name: "Bad", website: "javascript:alert(1)" },
    ],
    cursor: null,
    total_results: 1,
  });
  assert.equal(result.companies.length, 1);
  assert.equal(
    result.companies[0].linkedin_url,
    "https://www.linkedin.com/company/example",
  );
  const peopleCall = nextCall(plan, result)!;
  assert.equal(peopleCall.kind, "people");
  absorb(plan, result, peopleCall, {
    elements: [
      {
        firstName: "Alex",
        lastName: "Example",
        linkedinUrl: "https://linkedin.com/in/alex",
        currentPositions: [
          {
            title: "CMO",
            companyLinkedinUrl: "https://www.linkedin.com/company/1234",
            companyName: "Example",
          },
        ],
      },
      {
        firstName: "Unrelated",
        linkedinUrl: "https://linkedin.com/in/other",
        currentPositions: [
          { companyLinkedinUrl: "https://linkedin.com/company/other" },
        ],
      },
    ],
    pagination: { totalPages: 1, totalElements: 2 },
  });
  assert.equal(result.people.length, 1);
  assert.equal(result.people[0].title, "CMO");
  assert.equal(nextCall(plan, result), null);
  assert.equal(https("https://evil.test/path", "in"), "");
  assert.equal(https("javascript:alert(1)"), "");
});
test("explicit zero receipts stay zero; missing receipts use the cap", () => {
  assert.deepEqual(
    receiptCost(new Headers({ "X-Treg-Cost-Micro": "0" }), 0.1),
    { usd: 0, basis: "reported" },
  );
  assert.deepEqual(receiptCost(new Headers(), 0.1), {
    usd: 0.1,
    basis: "estimated",
  });
});
test("weekly refresh is limited to approved companies and retains person exclusions", () => {
  const p = {
    ...profile,
    watch_exclusions: [
      "person:https://www.linkedin.com/in/alex|domain:example.test",
    ],
  };
  const approved = [
    {
      key: "domain:example.test",
      name: "Example",
      domain: "example.test",
      website: "https://example.test",
      linkedin_url: "https://www.linkedin.com/company/example",
      industry: "",
      location: "",
      source: "watched",
      provider_ids: {},
    },
  ];
  const { plan, result } = makePlan(
    p,
    [],
    0.75,
    "2026-10-16",
    0.000495,
    0.1,
    "refresh",
    approved,
  );
  const call = nextCall(plan, result)!;
  assert.equal(call.kind, "people");
  absorb(plan, result, call, {
    elements: [
      {
        firstName: "Alex",
        linkedinUrl: "https://linkedin.com/in/alex",
        currentPositions: [
          {
            companyLinkedinUrl: "https://www.linkedin.com/company/1234",
            companyName: "Example",
            title: "CMO",
          },
        ],
      },
    ],
    pagination: { totalPages: 1 },
  });
  assert.equal(result.people.length, 0);
});

test("unverified ownership expansion fails before a paid search", () => {
  assert.throws(
    () =>
      makePlan(
        {
          ...profile,
          criteria: {
            named_companies: [{ name: "Example", include_parent: true }],
          },
        },
        [],
        0.75,
        "2026-10-16",
        0.000495,
        0.1,
      ),
    /verified ownership/,
  );
});

test("ECB XML accepts published single quotes and rejects stale rates", () => {
  const xml =
    "<Cube time='2026-10-16'><Cube currency='USD' rate='1.1253'/><Cube currency='GBP' rate='0.84385'/></Cube>";
  assert.equal(ecbRate(xml, Date.parse("2026-10-17")).fx, 0.84385 / 1.1253);
  assert.deepEqual(
    ecbRate(xml, Date.parse("2026-10-17")),
    ecbRate(xml.replaceAll("'", '"'), Date.parse("2026-10-17")),
  );
  assert.throws(() => ecbRate(xml, Date.parse("2026-10-25")), /current ECB/);
});

test("structured country, state and labelled metro chips map to native HQ filters", () => {
  const { plan } = makePlan(
    {
      ...profile,
      criteria: {
        locations: [
          "United States",
          "California (US state)",
          "New York metro (city keyword)",
        ],
      },
    },
    [],
    0.75,
    "2026-10-16",
    0.000495,
    0.1,
  );
  assert.deepEqual(plan.location_groups, [
    { country_code: ["US"] },
    { country_code: ["US"], state: { include: ["California"] } },
    { city: { include: ["New York"] } },
  ]);
  assert.throws(
    () =>
      makePlan(
        { ...profile, criteria: { industries: ["Invented industry"] } },
        [],
        0.75,
        "2026-10-16",
        0.000495,
        0.1,
      ),
    /provider list/,
  );
});

test("location alternatives advance independently and remain inside their quoted cap", () => {
  const p = {
    ...profile,
    watch_list_size: 25,
    criteria: { locations: ["United Kingdom", "California (US state)"] },
  };
  const { plan, result } = makePlan(p, [], 0.75, "2026-10-16", 0.000495, 0.1);
  const first = nextCall(plan, result)!;
  assert.deepEqual(first.body?.company, { hq: { country_code: ["GB"] } });
  absorb(plan, result, first, { results: [], cursor: null, total_results: 0 });
  const second = nextCall(plan, result)!;
  assert.deepEqual(second.body?.company, {
    hq: { country_code: ["US"], state: { include: ["California"] } },
  });
  assert.ok(plan.estimate >= 0.75 * (first.usd + second.usd + 0.2));
});
