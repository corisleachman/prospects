export type Item = {
  url: string;
  title: string;
  excerpt: string;
  published_at: string | null;
  source_name: string;
  external_id?: string;
  language?: string;
  company_ids?: string[];
  person_id?: string;
  raw_date?: string;
};
export type Company = { id: string; name: string; website?: string };
export type Drop =
  | "no_date"
  | "too_old"
  | "future_date"
  | "invalid_url"
  | "non_english"
  | "financial_notice"
  | "duplicate";
export function plain(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&(?:rsquo|lsquo|#8216|#8217);/gi, "'")
    .replace(/&(?:rdquo|ldquo|#8220|#8221);/gi, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
export function canonicalURL(raw: string): string {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error("Invalid source URL");
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$|mc_[ce]id$|ref$|referrer$)/i.test(k))
      u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href.replace(/\/$/, "");
}
export function dated(raw: unknown, now = new Date()): string | null {
  if (typeof raw === "number") {
    const d = new Date(raw < 1e12 ? raw * 1000 : raw);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (!raw) return null;
  const v = String(raw).trim();
  if (/^\d{10,13}$/.test(v)) return dated(Number(v), now);
  const rel = v.match(/^(\d+)\s*(minute|hour|day|week)s?\s+ago$/i);
  if (rel)
    return new Date(
      now.getTime() -
        Number(rel[1]) *
          ({ minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[
            rel[2].toLowerCase()
          ] ?? 0),
    ).toISOString();
  if (!/\d{4}|^\d{1,2}\s+[A-Za-z]{3,}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function wholeWord(text: string, name: string) {
  if (!name.trim()) return false;
  const escaped = plain(name)
    .normalize("NFKC")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    "(^|[^\\p{L}\\p{N}])" + escaped + "(?=$|[^\\p{L}\\p{N}])",
    "iu",
  ).test(plain(text).normalize("NFKC"));
}
export function brands(item: Item, companies: Company[]) {
  const text = plain(item.title + " " + item.excerpt);
  return companies.filter((c) => wholeWord(text, c.name)).map((c) => c.id);
}
export function english(item: Item) {
  if (item.language && !/^en(?:[-_]|$)/i.test(item.language)) return false;
  const t = plain(item.title + " " + item.excerpt).toLowerCase();
  const foreign = (
    t.match(
      /\b(el|los|las|una|para|avec|dans|des|une|pour|und|der|die|das|mit|für)\b/g,
    ) ?? []
  ).length;
  const en = (
    t.match(
      /\b(the|and|for|with|from|new|of|to|in|on|its|is|as|at|a|an|announces?|appoints?|launch(?:es)?|campaign|brand|marketing|agency|chief|officer|review|consumer|creative)\b/g,
    ) ?? []
  ).length;
  return en >= 2 && en > foreign;
}
export function filterItem(
  item: Item,
  hours: number,
  seen: Set<string>,
  now = new Date(),
): { canonical: string; drop: Drop | null } {
  let canonical = "";
  try {
    canonical = canonicalURL(item.url);
  } catch {
    return { canonical, drop: "invalid_url" };
  }
  const stamp = dated(item.published_at, now);
  if (!stamp) return { canonical, drop: "no_date" };
  const age = now.getTime() - Date.parse(stamp);
  if (age < -300000) return { canonical, drop: "future_date" };
  if (age > hours * 3600000) return { canonical, drop: "too_old" };
  if (!english(item)) return { canonical, drop: "non_english" };
  if (
    /\b(earnings|quarterly results|financial results|dividends?|investor (?:conference|call|presentation)|conference call|shareholder|stockholder)\b/i.test(
      item.title,
    )
  )
    return { canonical, drop: "financial_notice" };
  if (seen.has(canonical)) return { canonical, drop: "duplicate" };
  seen.add(canonical);
  return { canonical, drop: null };
}
const many = (v: any): any[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
export function parseFeed(
  xml: string,
  source: string,
  parse: (xml: string) => any,
): Item[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("Feed declarations aren't supported");
  const root = parse(xml),
    channel = root.rss?.channel,
    entries = many(channel?.item ?? root.feed?.entry);
  if (!entries.length) throw Error("No RSS or Atom entries found");
  const text = (v: any) => (typeof v === "object" ? (v?.["#text"] ?? "") : v);
  return entries.slice(0, 200).map((e: any) => {
    const links = many(e.link),
      link = links.find(
        (v: any) =>
          typeof v === "string" || !v["@_rel"] || v["@_rel"] === "alternate",
      );
    const raw = text(e.pubDate ?? e["dc:date"] ?? e.published ?? e.updated);
    return {
      url: typeof link === "object" ? (link["@_href"] ?? "") : (link ?? ""),
      title: plain(text(e.title)),
      excerpt: plain(
        text(
          e.description ??
            e.summary ??
            e["content:encoded"] ??
            e.content ??
            e.title,
        ),
      ).slice(0, 30000),
      published_at: dated(raw),
      raw_date: String(raw ?? ""),
      source_name: source,
      external_id: String(text(e.guid ?? e.id) ?? "") || undefined,
      language: text(
        e.language ??
          e["dc:language"] ??
          channel?.language ??
          root.feed?.["@_xml:lang"],
      ),
    };
  });
}
export function newsItems(payload: any, now = new Date()): Item[] {
  const d = payload.output?.data ?? payload.data ?? payload;
  const rows = Array.isArray(d)
    ? d
    : (d.items ?? d.results ?? d.news ?? d.news_results ?? []);
  return rows.slice(0, 20).map((x: any) => ({
    url: x.link ?? x.url ?? "",
    title: plain(x.title),
    excerpt: plain(x.snippet ?? x.description ?? x.content ?? x.title).slice(
      0,
      30000,
    ),
    published_at: dated(
      x.createdUtc ??
        x.isoDate ??
        x.published_at ??
        x.publishedAt ??
        x.date ??
        x.published ??
        x.time,
      now,
    ),
    raw_date: String(x.date ?? x.published_at ?? ""),
    source_name:
      typeof x.source === "string"
        ? x.source
        : (x.source?.name ?? "News search"),
    language: x.language ?? "en",
  }));
}
export function postItems(
  rows: any[],
  personId: string,
  now = new Date(),
): Item[] {
  return rows.slice(0, 5).map((x) => {
    const raw =
      x.postedAt?.date ??
      x.postedAt?.timestamp ??
      x.postedAt ??
      x.publishedAt ??
      x.createdAt ??
      x.timestamp;
    return {
      url: x.linkedinUrl ?? x.url ?? x.postUrl ?? "",
      title: plain(x.content ?? x.text).slice(0, 250),
      excerpt: plain(x.content ?? x.text).slice(0, 30000),
      published_at: dated(raw, now),
      source_name: "LinkedIn",
      person_id: personId,
      language: x.language,
      external_id: x.id ?? x.urn,
    };
  });
}
export async function hash(value: string) {
  const b = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

export function robotsAllows(
  text: string,
  path: string,
  agent = "prospectsignals",
) {
  if (/^\s*</.test(text)) return false;
  const groups: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
  }[] = [];
  let group: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
  } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim(),
      colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(),
      value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!group || group.rules.length) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group && (key === "allow" || key === "disallow") && value)
      group.rules.push({ allow: key === "allow", path: value });
  }
  const specific = groups.filter((g) =>
      g.agents.some((a) => a !== "*" && agent.includes(a)),
    ),
    selected = specific.length
      ? specific
      : groups.filter((g) => g.agents.includes("*"));
  let best = { length: -1, allow: true };
  for (const rule of selected.flatMap((g) => g.rules)) {
    const escaped = rule.path
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\\\$$/, "$");
    if (
      new RegExp("^" + escaped).test(path) &&
      (rule.path.length > best.length ||
        (rule.path.length === best.length && rule.allow))
    )
      best = { length: rule.path.length, allow: rule.allow };
  }
  return best.allow;
}

export function parseWebsite(
  html: string,
  url: string,
  source: string,
): Item[] {
  const items: Item[] = [];
  function visit(value: any, depth = 0) {
    if (
      depth > 10 ||
      !value ||
      typeof value !== "object" ||
      items.length >= 100
    )
      return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    const types = Array.isArray(value["@type"])
      ? value["@type"]
      : [value["@type"]];
    if (
      types.some((v: string) =>
        [
          "Article",
          "NewsArticle",
          "BlogPosting",
          "ReportageNewsArticle",
        ].includes(v),
      ) &&
      value.headline &&
      value.datePublished
    ) {
      const raw = value.datePublished;
      let link = value.url ?? value.mainEntityOfPage?.["@id"] ?? url;
      if (typeof link !== "string") link = url;
      items.push({
        url: new URL(link, url).href,
        title: plain(value.headline),
        excerpt: plain(
          value.articleBody ?? value.description ?? value.headline,
        ).slice(0, 30000),
        published_at: dated(raw),
        raw_date: String(raw),
        source_name: source,
        language: value.inLanguage,
      });
    }
    for (const v of Object.values(value))
      if (typeof v === "object") visit(v, depth + 1);
  }
  for (const script of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(script[1]));
    } catch {}
  }
  if (items.length) return items;
  const metas = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = m[0].match(/(?:property|name)=["']([^"']+)["']/i)?.[1],
      v = m[0].match(/content=["']([^"']*)["']/i)?.[1];
    if (key && v) metas.set(key.toLowerCase(), v);
  }
  const stamp = metas.get("article:published_time"),
    title = metas.get("og:title");
  if (metas.get("og:type") === "article" && stamp && title) {
    const body = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
    items.push({
      url,
      title: plain(title),
      excerpt: plain(body ?? metas.get("og:description") ?? title).slice(
        0,
        30000,
      ),
      published_at: dated(stamp),
      raw_date: stamp,
      source_name: source,
    });
  }
  if (!items.length)
    throw Error(
      "No dated article metadata found. Add a feed or a direct article URL.",
    );
  return items;
}

export type EventItem = {
  id: string;
  source_key: string;
  company_ids: string[];
  item: Item;
};
function eventHint(title: string) {
  for (const [kind, pattern] of Object.entries({
    leadership: /\b(?:appoints?|new cmo|chief (?:marketing|brand) officer)\b/i,
    review: /\b(?:agency|creative|media) (?:review|search|pitch)\b/i,
    rebrand: /\b(?:rebrand|reposition)\b/i,
    campaign: /\bcampaign\b/i,
    award: /\b(?:award|shortlist|cannes|effies)\b/i,
    funding: /\b(?:funding|acquisition|acquires)\b/i,
    layoffs: /\b(?:layoffs?|restructur)\b/i,
  }))
    if (pattern.test(title)) return kind;
  return "unknown";
}
export function groupEvents(input: EventItem[]): Map<string, string> {
  const rank: Record<string, number> = {
    linkedin_posts: 100,
    press_wires: 90,
    extra_sources: 85,
    trade_press: 80,
    news_search: 50,
  };
  const ordered = [...input].sort(
      (a, b) =>
        (rank[b.source_key] ?? 0) - (rank[a.source_key] ?? 0) ||
        a.item.url.localeCompare(b.item.url),
    ),
    primaries: EventItem[] = [],
    result = new Map<string, string>();
  const words = (v: string) =>
    new Set(
      plain(v)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(
          (w) =>
            w &&
            ![
              "a",
              "an",
              "the",
              "and",
              "of",
              "to",
              "for",
              "in",
              "on",
              "with",
            ].includes(w),
        ),
    );
  for (const v of ordered) {
    const w = words(v.item.title),
      kind = eventHint(v.item.title);
    const match = primaries.find((p) => {
      if (!v.company_ids.some((id) => p.company_ids.includes(id))) return false;
      if (
        !p.item.published_at ||
        !v.item.published_at ||
        Math.abs(
          Date.parse(p.item.published_at) - Date.parse(v.item.published_at),
        ) >
          36 * 3600000
      )
        return false;
      if (eventHint(p.item.title) !== kind) return false;
      const pw = words(p.item.title),
        overlap = [...w].filter((x) => pw.has(x)).length,
        union = new Set([...w, ...pw]).size;
      return union > 0 && overlap / union >= (kind === "unknown" ? 0.95 : 0.8);
    });
    result.set(v.id, match?.id ?? v.id);
    if (!match) primaries.push(v);
  }
  return result;
}
