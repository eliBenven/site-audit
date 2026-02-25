/**
 * External link checker module.
 *
 * Extracts outbound (external) links from crawled pages and verifies
 * they resolve to a 2xx status via HEAD requests.
 */

import type { CrawlResult, SeoIssue } from "./types.js";

export interface ExternalLinkResult {
  checked: number;
  broken: number;
  issues: SeoIssue[];
}

function extractExternalLinks(html: string, pageUrl: string): string[] {
  const links: string[] = [];
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  const pageOrigin = new URL(pageUrl).origin;

  while ((m = re.exec(html)) !== null) {
    const href = m[1];
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
  }
  return [...new Set(links)];
}

async function headCheck(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function checkExternalLinks(
  crawlResult: CrawlResult,
  options: { concurrency?: number; timeout?: number } = {},
): Promise<ExternalLinkResult> {
  const concurrency = options.concurrency ?? 10;
  const timeout = options.timeout ?? 8_000;
  const issues: SeoIssue[] = [];

  // Collect all unique external links with source pages
  const linkSources = new Map<string, string[]>();
  for (const [url, node] of crawlResult.pages) {
    for (const ext of extractExternalLinks(node.html, url)) {
      const sources = linkSources.get(ext) ?? [];
      sources.push(url);
      linkSources.set(ext, sources);
    }
  }

  const allLinks = [...linkSources.keys()];
  let broken = 0;

  // Process in batches
  for (let i = 0; i < allLinks.length; i += concurrency) {
    const batch = allLinks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (link) => {
        const result = await headCheck(link, timeout);
        return { link, ...result };
      }),
    );

    for (const { link, ok, status } of results) {
      if (!ok) {
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

  return { checked: allLinks.length, broken, issues };
}
