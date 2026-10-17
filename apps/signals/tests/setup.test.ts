import { test } from "node:test";
import assert from "node:assert/strict";
import { splitChips, keywordParts, examples } from "../src/lib/setup";
import {
  publicAddress,
  publicSourceURL,
  hasPublishDate,
  checkSource,
} from "../src/lib/source-check";
test("chip parsing preserves quoted phrases and exclusions", () => {
  assert.deepEqual(
    splitChips(
      '"agency of record", agency review, -recruitment\n"brand, agency"',
    ),
    ['"agency of record"', "agency review", "-recruitment", '"brand, agency"'],
  );
  assert.deepEqual(keywordParts('-"old news"'), {
    excluded: true,
    exact: true,
    text: "old news",
  });
  assert.equal(
    examples("Hello\n\nA full message.\n---\nSecond\n---\nThird").length,
    3,
  );
});
test("extra source checks reject private endpoints and require a parseable publish date", async () => {
  for (const url of [
    "http://example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://user:secret@example.com",
    "https://example.com:8443",
  ])
    assert.throws(() => publicSourceURL(url));
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.equal(publicAddress("2606:4700::1111"), true);
  assert.equal(hasPublishDate("<pubDate>not a date</pubDate>"), false);
  assert.equal(
    hasPublishDate("<pubDate>Fri, 16 Oct 2026 12:00:00 GMT</pubDate>"),
    true,
  );
  assert.equal(
    hasPublishDate(
      '<meta content="2026-10-16T12:00:00Z" property="article:published_time">',
    ),
    true,
  );
  const result = await checkSource("https://example.com", async (url) => ({
    url,
    text: url.endsWith("/rss")
      ? "<rss><item><pubDate>Fri, 16 Oct 2026 12:00:00 GMT</pubDate></item></rss>"
      : '<link rel="alternate" type="application/rss+xml" href="/rss">',
  }));
  assert.equal(result.validation_status, "ok");
  assert.equal(result.detected_feed, "https://example.com/rss");
});
