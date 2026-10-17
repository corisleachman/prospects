import { test } from "node:test";
import assert from "node:assert/strict";
import {
  request,
  usageCost,
  parseMessage,
  parseTriage,
  validateJudgment,
  ruleMatches,
  selectPerson,
  schedule,
  type Setup,
} from "../../../supabase/functions/signals-pipeline/core";
const setup: Setup = {
  fingerprint: "test",
  profiles: [
    {
      id: "profile",
      code: "02",
      name: "Established growth brands",
      who: "Established US consumer brands",
      relevant_moment: "New marketing leadership",
      conversation_to_open: "Connect about brand priorities",
      priority_titles: ["CMO", "VP Brand"],
      when_no_person: "needs_person",
      criteria: {},
    },
  ],
  rules: [
    {
      id: "rule",
      template_key: "layoffs",
      label: "Layoffs or restructure",
      description: "A confirmed restructuring",
      polarity: "negative",
      is_active: true,
      keywords: [],
      tone_guidance: "Acknowledge only",
      applies_to_all: true,
      profile_ids: [],
    },
  ],
  voice: {
    examples_text: "One\n---\nTwo\n---\nThree",
    tone: "Warm",
    sign_off: "Alex",
    banned_phrases: ["synergy"],
    channels: ["email", "linkedin"],
    linkedin_length: 200,
  },
};
const item = {
  url: "https://example.test/news",
  title: "KIND confirms layoffs",
  excerpt:
    "KIND announced layoffs. Jordan, Chief Marketing Officer, confirmed the news.",
  published_at: "2026-10-17T10:00:00Z",
  source_name: "Example",
};
const triage = {
  profile_id: "profile",
  icp_fit: 9,
  event_type: "layoffs",
  rule_id: "rule",
  polarity: "negative" as const,
  company: "KIND",
  person: { name: "Jordan", title: "Chief Marketing Officer" },
  keep: true,
  reason: "Company fit",
};
test("model calls preserve exact settings, structured outputs and a shared cached system prompt", () => {
  const one = request("triage", setup, item),
    two = request("score", setup, item),
    fallback = request("score", setup, item, true);
  assert.deepEqual(one.thinking, { type: "disabled" });
  assert.equal(one.max_tokens, 300);
  assert.deepEqual(two.thinking, { type: "between_tools" });
  assert.equal(two.max_tokens, 800);
  assert.equal(fallback.max_tokens, 1500);
  assert.ok(!("thinking" in fallback));
  assert.equal(one.system[0].text, two.system[0].text);
  assert.equal(one.output_config.effort, "low");
  assert.equal(one.output_config.format.type, "json_schema");
});
test("truncated and refusal responses are rejected before parsing partial JSON", () => {
  assert.throws(
    () =>
      parseMessage({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '{"relevance":9' }],
      }),
    /Incomplete/,
  );
  assert.throws(
    () => parseMessage({ stop_reason: "refusal", content: [] }),
    /Incomplete/,
  );
});
test("source facts and title priorities determine a person, without guessing LinkedIn", () => {
  assert.equal(parseTriage(triage, setup, item).company, "KIND");
  assert.throws(
    () => parseTriage({ ...triage, company: "Pepsi" }, setup, item),
    /not stated/,
  );
  const p = selectPerson(triage, item, "company", [], setup.profiles[0]);
  assert.equal(p?.name, "Jordan");
  assert.equal(p?.linkedin_url, undefined);
  const wrong = selectPerson(
    { ...triage, person: { name: "Jordan", title: "CEO" } },
    { ...item, excerpt: "KIND CEO Jordan announced the change." },
    "company",
    [],
    setup.profiles[0],
  );
  assert.equal(wrong, null);
});
test("sensitive openers have no offer or ask and missing people cannot reach seven", () => {
  const value = {
    relevance: 9,
    reason: "Confirmed event at the right company",
    event_summary: item.title,
    supporting_quote: item.excerpt,
    confirmed_event: true,
    opener_linkedin: "I saw the news. Thinking of you and the team.",
    email_subject: "Thinking of the team",
    email_body: "I saw the news. Thinking of you and the team.",
  };
  assert.equal(
    validateJudgment({ ...value }, setup, item, triage, null).relevance,
    6,
  );
  assert.throws(
    () =>
      validateJudgment(
        { ...value, opener_linkedin: "I saw the news. Happy to help you." },
        setup,
        item,
        triage,
        triage.person,
      ),
    /Sensitive/,
  );
  assert.throws(
    () =>
      validateJudgment(
        {
          ...value,
          opener_linkedin: "Thinking of you. Would you like to connect?",
        },
        setup,
        item,
        triage,
        triage.person,
      ),
    /Sensitive/,
  );
  assert.throws(
    () =>
      validateJudgment(
        {
          ...value,
          supporting_quote: "A fictional event never announced here",
        },
        setup,
        item,
        triage,
        triage.person,
      ),
    /quote/,
  );
});
test("keyword exclusions and quotes preserve their meanings", () => {
  const r = {
    ...setup.rules[0],
    template_key: "custom",
    keywords: ['"agency of record"', "agency review", "-recruitment"],
  };
  assert.equal(
    ruleMatches(r, setup.profiles[0], {
      ...item,
      excerpt: "The agency has begun its review.",
    }),
    true,
  );
  assert.equal(
    ruleMatches(r, setup.profiles[0], {
      ...item,
      excerpt: "An agency review for recruitment.",
    }),
    false,
  );
});
test("actual cache usage and batch discounts produce explicit costs", () => {
  const r = {
    input_per_million: 2,
    output_per_million: 10,
    cache_read_per_million: 0.1,
    cache_write_per_million: 2.5,
    cache_write_1h_per_million: 4,
    batch_multiplier: 0.5,
  };
  assert.equal(
    usageCost(
      {
        input_tokens: 1000000,
        output_tokens: 1000000,
        cache_read_input_tokens: 1000000,
        cache_creation_input_tokens: 1000000,
      },
      r,
      true,
    ),
    7.3,
  );
});
test("London and New York schedules use local email times through daylight saving", () => {
  const before = schedule(
    "America/New_York",
    ["08:00", "07:30"],
    new Date("2026-10-17T16:00:00Z"),
    true,
  );
  assert.equal(before.email, "2026-10-18T11:30:00.000Z");
  assert.equal(before.collect, "2026-10-18T07:30:00.000Z");
  assert.equal(before.fallback, "2026-10-18T11:00:00.000Z");
  const after = schedule(
    "Europe/London",
    ["07:00"],
    new Date("2026-10-25T12:00:00Z"),
    true,
  );
  assert.equal(after.email, "2026-10-26T07:00:00.000Z");
});
