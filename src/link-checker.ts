/**
 * External link checker module.
 *
 * Extracts outbound (external) links from crawled pages using cheerio
 * and verifies they resolve to a 2xx status via HEAD requests.
 * Rate-limits requests per domain to avoid hammering external servers.
 */

import * as cheerio from "cheerio";
import type { CrawlResult, SeoIssue } from "./types.js";

export interface ExternalLinkResult {
  checked: number;
  broken: number;
  issues: SeoIssue[];
}

function extractExternalLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const pageOrigin = new URL(pageUrl).origin;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, pageUrl);
      if (
        (resolved.protocol === "http:" || resolved.protocol === "https:") &&
        resolved.origin !== pageOrigin
      ) {
        links.push(resolved.href);
      }
    } catch {
      // skip invalid URLs
    }
  });

  return [...new Set(links)];
}

async function headCheckWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
): Promise<{ ok: boolean; status: number }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      // Some servers reject HEAD — fallback to GET on 405
      if (res.status === 405) {
        const getController = new AbortController();
        const getTimer = setTimeout(() => getController.abort(), timeoutMs);
        const getRes = await fetch(url, {
          method: "GET",
          signal: getController.signal,
          redirect: "follow",
        });
        clearTimeout(getTimer);
        return { ok: getRes.ok, status: getRes.status };
      }

      if (res.ok || res.status < 500) return { ok: res.ok, status: res.status };
      // Retry on 5xx
      if (attempt < retries) continue;
      return { ok: res.ok, status: res.status };
    } catch {
      if (attempt < retries) continue;
      return { ok: false, status: 0 };
    }
  }
  return { ok: false, status: 0 };
}

export async function checkExternalLinks(
  crawlResult: CrawlResult,
  options: { concurrency?: number; timeout?: number; retries?: number } = {},
): Promise<ExternalLinkResult> {
  const concurrency = options.concurrency ?? 10;
  const timeout = options.timeout ?? 8_000;
  const retries = options.retries ?? 1;
  const issues: SeoIssue[] = [];

  // Non-HTML extensions to skip when extracting outgoing links
  const NON_HTML_EXTENSIONS = /\.(txt|xml|json|pdf|csv|rss|atom|ico|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot)$/i;

  // Collect all unique external links with source pages
  const linkSources = new Map<string, string[]>();
  for (const [url, node] of crawlResult.pages) {
    // Skip non-HTML pages (e.g. llms.txt, llms-full.txt) — their content
    // isn't HTML so cheerio would extract garbage "links" from raw text.
    try {
      const pathname = new URL(url).pathname;
      if (NON_HTML_EXTENSIONS.test(pathname)) continue;
    } catch { /* proceed if URL is unparseable */ }
    for (const ext of extractExternalLinks(node.html, url)) {
      const sources = linkSources.get(ext) ?? [];
      sources.push(url);
      linkSources.set(ext, sources);
    }
  }

  // Group links by domain for rate limiting
  const domainBuckets = new Map<string, string[]>();
  for (const link of linkSources.keys()) {
    try {
      const host = new URL(link).hostname;
      const bucket = domainBuckets.get(host) ?? [];
      bucket.push(link);
      domainBuckets.set(host, bucket);
    } catch {
      // Skip unparseable
    }
  }

  // Flatten into batches that don't hit the same domain more than twice per batch
  const allLinks: string[] = [];
  const domainQueues = new Map<string, string[]>();
  for (const [domain, links] of domainBuckets) {
    domainQueues.set(domain, [...links]);
  }

  // Interleave domains to spread load
  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const [, queue] of domainQueues) {
      if (queue.length > 0) {
        allLinks.push(queue.shift()!);
        hasMore = hasMore || queue.length > 0;
      }
    }
  }

  let broken = 0;

  // Process in batches
  for (let i = 0; i < allLinks.length; i += concurrency) {
    const batch = allLinks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (link) => {
        const result = await headCheckWithRetry(link, timeout, retries);
        return { link, ...result };
      }),
    );

    for (const { link, ok, status } of results) {
      if (!ok) {
        // Some sites (x.com, twitter.com, linkedin.com) block all bot/HEAD
        // requests with 403. These aren't broken links — skip them.
        const host = new URL(link).hostname;
        const botBlocking = ["x.com", "twitter.com", "linkedin.com", "facebook.com", "instagram.com"];
        if (status === 403 && botBlocking.some((d) => host === d || host.endsWith("." + d))) {
          continue;
        }

        broken++;
        const sources = linkSources.get(link)!;
        for (const source of sources) {
          issues.push({
            rule: "external-link-broken",
            severity: "warning",
            message: `External link to ${link} returned ${status || "timeout/error"}.`,
            url: source,
          });
        }
      }
    }
  }

  return { checked: linkSources.size, broken, issues };
}
