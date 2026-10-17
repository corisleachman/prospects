import { test } from "node:test";
import assert from "node:assert/strict";
import { XMLParser } from "fast-xml-parser";
import {
  parseFeed,
  groupEvents,
  parseWebsite,
  robotsAllows,
  filterItem,
  wholeWord,
  brands,
  dated,
  newsItems,
  postItems,
  type Item,
} from "../../../supabase/functions/signals-collect/core";
const now = new Date("2026-10-17T12:00:00Z");
const item: Item = {
  url: "https://example.com/launch?utm_source=mail",
  title: "KIND launches a new brand campaign",
  excerpt: "The new campaign for KIND features its new snack range.",
  published_at: "2026-10-17T10:00:00Z",
  source_name: "Test",
};
test("collection filters dates, English, financial notices and canonical duplicates before AI", () => {
  const seen = new Set<string>();
  assert.equal(filterItem(item, 48, seen, now).drop, null);
  assert.equal(
    filterItem(
      { ...item, url: "https://example.com/launch?fbclid=abc" },
      48,
      seen,
      now,
    ).drop,
    "duplicate",
  );
  assert.equal(
    filterItem({ ...item, published_at: null }, 48, new Set(), now).drop,
    "no_date",
  );
  assert.equal(
    filterItem(
      { ...item, published_at: "2026-10-14T10:00:00Z" },
      48,
      new Set(),
      now,
    ).drop,
    "too_old",
  );
  assert.equal(
    filterItem(
      { ...item, published_at: "2026-10-18T10:00:00Z" },
      48,
      new Set(),
      now,
    ).drop,
    "future_date",
  );
  assert.equal(
    filterItem({ ...item, language: "es" }, 48, new Set(), now).drop,
    "non_english",
  );
  assert.equal(
    filterItem(
      { ...item, title: "KIND announces quarterly earnings and a dividend" },
      48,
      new Set(),
      now,
    ).drop,
    "financial_notice",
  );
  assert.equal(
    filterItem({ ...item, url: "javascript:alert(1)" }, 48, new Set(), now)
      .drop,
    "invalid_url",
  );
});
test("whole-word brands never match a substring or create ownership links", () => {
  assert.equal(wholeWord("A Gorenje oven with kindling", "KIND"), false);
  assert.equal(wholeWord("KIND launches new snacks", "KIND"), true);
  assert.equal(wholeWord("KIND’s campaign", "KIND"), true);
  assert.equal(wholeWord("PepsiCo launches a new campaign", "Pepsi"), false);
  assert.deepEqual(
    brands(item, [
      { id: "one", name: "KIND" },
      { id: "two", name: "Pepsi" },
    ]),
    ["one"],
  );
});
test("RSS, Atom and tested provider shapes retain source dates without inventing them", () => {
  const parse = (s: string) =>
    new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      parseTagValue: false,
    }).parse(s);
  const rss = parseFeed(
    "<rss><channel><language>en-US</language><item><title>KIND launches campaign</title><link>https://example.com/a</link><description>The new brand campaign.</description><pubDate>Sat, 17 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>",
    "Trade",
    parse,
  );
  assert.equal(rss[0].published_at, "2026-10-17T10:00:00.000Z");
  assert.equal(rss[0].language, "en-US");
  const atom = parseFeed(
    '<feed><entry><title>A new campaign</title><link href="https://example.com/a"/><updated>2026-10-17T10:00:00Z</updated></entry></feed>',
    "Trade",
    parse,
  );
  assert.equal(atom[0].url, "https://example.com/a");
  assert.throws(() => parseFeed("<!DOCTYPE rss><rss/>", "Trade", parse));
  assert.equal(dated("2 hours ago", now), "2026-10-17T10:00:00.000Z");
  assert.equal(dated("yesterday", now), null);
  const news = newsItems(
    {
      output: {
        data: {
          items: [
            {
              url: "https://example.com/a",
              title: "Brand launches a campaign",
              createdUtc: 1792224000,
            },
          ],
        },
      },
    },
    now,
  );
  assert.ok(news[0].published_at);
  assert.equal(
    postItems(
      [
        {
          linkedinUrl: "https://linkedin.com/posts/a",
          content: "A new campaign",
          postedAt: { date: "2026-10-17T10:00:00Z" },
        },
      ],
      "person",
      now,
    )[0].person_id,
    "person",
  );
});

test("feed access honours matching publisher robots groups and longest allow paths", () => {
  const text =
    "User-agent: *\nDisallow: /private/\nAllow: /private/feed/\nUser-agent: GPTBot\nDisallow: /";
  assert.equal(robotsAllows(text, "/feed/"), true);
  assert.equal(robotsAllows(text, "/private/news"), false);
  assert.equal(robotsAllows(text, "/private/feed/rss"), true);
  assert.equal(robotsAllows(text, "/feed/", "gptbot"), false);
  assert.equal(robotsAllows("<html>not robots</html>", "/feed/"), false);
});

test("extra websites require dated article metadata and never use an unrelated page date", () => {
  const json =
    '<script type="application/ld+json">' +
    JSON.stringify({
      "@type": "NewsArticle",
      headline: "A brand launches a new campaign",
      datePublished: "2026-10-17T10:00:00Z",
      url: "/news",
      description: "The brand announced a new campaign.",
    }) +
    "</script>";
  const items = parseWebsite(json, "https://example.com", "Example");
  assert.equal(items[0].url, "https://example.com/news");
  assert.equal(items[0].published_at, "2026-10-17T10:00:00.000Z");
  assert.throws(
    () =>
      parseWebsite(
        '<time datetime="2026-10-17">Updated footer</time>',
        "https://example.com",
        "Example",
      ),
    /No dated article/,
  );
});

test("reports group only when brand, stated event, date and headline match; primary favours direct sources", () => {
  const rows = [
    { id: "news", source_key: "news_search", company_ids: ["kind"], item },
    {
      id: "wire",
      source_key: "press_wires",
      company_ids: ["kind"],
      item: {
        ...item,
        url: "https://example.com/wire",
        title: "KIND launches new brand campaign",
      },
    },
    { id: "other", source_key: "trade_press", company_ids: ["other"], item },
    {
      id: "different",
      source_key: "press_wires",
      company_ids: ["kind"],
      item: { ...item, title: "KIND appoints a new chief brand officer" },
    },
  ];
  const grouped = groupEvents(rows);
  assert.equal(grouped.get("news"), "wire");
  assert.equal(grouped.get("other"), "other");
  assert.equal(grouped.get("different"), "different");
});

test("pinned transport decodes bounded HTTP responses and rejects truncated chunks", async () => {
  const { decodeHTTP, publicSourceURL, publicAddress } =
    await import("../../../supabase/functions/signals-collect/public-http");
  const encode = (s: string) => new TextEncoder().encode(s);
  const r = decodeHTTP(
    encode(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
    ),
  );
  assert.equal(new TextDecoder().decode(r.body), "hello");
  assert.throws(
    () =>
      decodeHTTP(
        encode(
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n9\r\nhello\r\n",
        ),
      ),
    /Incomplete/,
  );
  assert.throws(() => publicSourceURL("https://127.0.0.1/feed"));
  assert.equal(publicAddress("169.254.169.254"), false);
});

test("whole-word matching accepts typographic apostrophes without substring matches", () => {
  assert.equal(wholeWord("Arby’s hires a new CMO", "Arby's"), true);
  assert.equal(wholeWord("Arby&rsquo;s hires a new CMO", "Arby's"), true);
  assert.equal(
    wholeWord("A Gorenje oven is a kind of appliance", "KIND Snacks"),
    false,
  );
  assert.equal(wholeWord("Kindness matters", "KIND"), false);
});
