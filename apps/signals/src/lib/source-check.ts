import "server-only";
import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
export function publicSourceURL(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Use a public HTTPS website or feed.");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !u.hostname.includes(".") ||
    /^(localhost|.*\.(localhost|local|internal))$/i.test(u.hostname) ||
    isIP(u.hostname.replace(/[\[\]]/g, ""))
  )
    throw new Error("Use a public HTTPS website or feed, not a local address.");
  u.hash = "";
  return u.href;
}
export function publicAddress(ip: string) {
  if (ip.includes(":")) {
    const first = parseInt(ip.split(":")[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && !/^2001:0?db8:/i.test(ip);
  }
  const n = ip.split(".").map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  return !(
    n[0] === 0 ||
    n[0] === 10 ||
    n[0] === 127 ||
    n[0] >= 224 ||
    (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && (n[1] === 168 || n[1] === 0)) ||
    (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
    (n[0] === 198 && (n[1] === 18 || n[1] === 19))
  );
}
async function get(
  raw: string,
  redirects = 0,
): Promise<{ text: string; url: string }> {
  const url = publicSourceURL(raw),
    u = new URL(url);
  const results = await Promise.allSettled([
    resolve4(u.hostname),
    resolve6(u.hostname),
  ]);
  const addresses = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );
  if (!addresses.length || addresses.some((ip) => !publicAddress(ip)))
    throw new Error(
      "This source resolves to a private or unavailable address.",
    );
  const address = addresses[0],
    family = isIP(address);
  return new Promise((resolve, reject) => {
    const req = request(
      u,
      {
        method: "GET",
        headers: {
          "User-Agent": "ProspectSignals/2.0 (source date check)",
          Accept: "application/rss+xml,application/atom+xml,text/html;q=0.9",
        },
        lookup: (_host, opts, done) => {
          if (typeof opts === "object" && opts.all)
            done(null, [{ address, family }]);
          else done(null, address, family);
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          res.resume();
          if (redirects >= 3 || !res.headers.location)
            return reject(new Error("Too many source redirects."));
          get(new URL(res.headers.location, u).href, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if ((res.statusCode ?? 500) >= 400) {
          res.resume();
          return reject(
            new Error("The source returned HTTP " + res.statusCode),
          );
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 512000) {
            req.destroy(new Error("Source page too large to check."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ text: Buffer.concat(chunks).toString("utf8"), url }),
        );
        res.on("error", reject);
      },
    );
    req.setTimeout(6000, () =>
      req.destroy(new Error("Source check timed out.")),
    );
    req.on("error", reject);
    req.end();
  });
}
export function hasPublishDate(text: string) {
  const candidates: string[] = [];
  for (const m of text.matchAll(
    /<(?:pubDate|published|updated)\b[^>]*>\s*([^<]{4,100})<\//gi,
  ))
    candidates.push(m[1]);
  for (const m of text.matchAll(
    /<time\b[^>]*datetime=["']([^"']{4,100})["']/gi,
  ))
    candidates.push(m[1]);
  for (const m of text.matchAll(
    /["']datePublished["']\s*:\s*["']([^"']+)["']/gi,
  ))
    candidates.push(m[1]);
  for (const m of text.matchAll(/<meta\b[^>]*>/gi))
    if (/article:published_time|datePublished/i.test(m[0])) {
      const v = m[0].match(/content=["']([^"']+)["']/i)?.[1];
      if (v) candidates.push(v);
    }
  return candidates.some(
    (v) =>
      /\d{4}/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      Date.parse(v) <= Date.now() + 86400000,
  );
}
export async function checkSource(url: string, fetcher = get) {
  try {
    const page = await fetcher(url);
    if (hasPublishDate(page.text))
      return {
        validation_status: "ok",
        detected_feed: /<(?:rss|feed)\b/i.test(page.text) ? page.url : null,
        last_error: null,
      };
    const links = [...page.text.matchAll(/<link\b[^>]*>/gi)].filter((m) =>
      /application\/(?:rss\+xml|atom\+xml)/i.test(m[0]),
    );
    for (const link of links.slice(0, 2)) {
      const href = link[0].match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const feed = await fetcher(new URL(href, page.url).href);
      if (hasPublishDate(feed.text))
        return {
          validation_status: "ok",
          detected_feed: feed.url,
          last_error: null,
        };
    }
    return {
      validation_status: "no_dates",
      detected_feed: null,
      last_error: "No publish dates found on the page or its advertised feed.",
    };
  } catch (e) {
    return {
      validation_status: "failed",
      detected_feed: null,
      last_error: (e as Error).message.slice(0, 300),
    };
  }
}
