/**
 * Playwright-based website crawler.
 *
 * Follows internal links, builds a site graph, captures status codes and
 * redirect chains, and discovers all pages up to a configurable depth.
 */

import { chromium, type Browser, type Page, type Response } from "playwright";
import { URL } from "node:url";
import type { CrawlOptions, CrawlResult, PageNode } from "./types.js";

const DEFAULT_OPTIONS: CrawlOptions = {
  maxDepth: 3,
  maxPages: 50,
  mode: "rendered",
  concurrency: 5,
  timeout: 30_000,
  respectRobotsTxt: false,
};

/** Normalise a URL: strip hash, trailing slash, sort search params. */
export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    // Only crawl http(s)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    // Remove trailing slash except for root
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    u.searchParams.sort();
    return u.href;
  } catch {
    return null;
  }
}

/** Check whether two URLs share the same origin. */
export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Extract all internal anchor links from HTML using a simple regex
 * (used when mode === "html").
 */
export function extractLinksFromHtml(html: string, pageUrl: string): string[] {
  const links: string[] = [];
  const hrefRe = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null) {
    const resolved = normalizeUrl(match[1], pageUrl);
    if (resolved && isSameOrigin(resolved, pageUrl)) {
      links.push(resolved);
    }
  }
  return [...new Set(links)];
}

/** Fetch a page via plain HTTP (no rendering). */
async function fetchHtml(
  url: string,
  timeout: number,
): Promise<{ html: string; statusCode: number; redirectChain: string[]; error?: string }> {
  const redirectChain: string[] = [];
  try {
    let current = url;
    let response: globalThis.Response | undefined;
    // Follow redirects manually to capture the chain
    for (let i = 0; i < 10; i++) {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeout),
      });
      const status = response.status;
      if (status >= 300 && status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        redirectChain.push(current);
        current = new URL(location, current).href;
      } else {
        break;
      }
    }
    const html = await (response?.text() ?? Promise.resolve(""));
    return {
      html,
      statusCode: response?.status ?? 0,
      redirectChain,
    };
  } catch (err) {
    return {
      html: "",
      statusCode: 0,
      redirectChain,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function crawl(
  startUrl: string,
  userOptions?: Partial<CrawlOptions>,
): Promise<CrawlResult> {
  const opts: CrawlOptions = { ...DEFAULT_OPTIONS, ...userOptions };
  const start = Date.now();

  const normalizedStart = normalizeUrl(startUrl);
  if (!normalizedStart) {
    throw new Error(`Invalid start URL: ${startUrl}`);
  }

  const pages = new Map<string, PageNode>();
  // Queue: [url, depth, referrerUrl]
  const queue: Array<[string, number, string | null]> = [[normalizedStart, 0, null]];
  const enqueued = new Set<string>([normalizedStart]);

  let browser: Browser | undefined;

  if (opts.mode === "rendered") {
    browser = await chromium.launch({ headless: true });
  }

  try {
    while (queue.length > 0 && pages.size < opts.maxPages) {
      // Take a batch up to concurrency limit
      const batch = queue.splice(0, opts.concurrency);

      const tasks = batch.map(async ([url, depth, referrer]) => {
        if (pages.size >= opts.maxPages) return;

        let html = "";
        let statusCode = 0;
        let redirectChain: string[] = [];
        let outgoingLinks: string[] = [];
        let error: string | undefined;

        if (opts.mode === "rendered" && browser) {
          let page: Page | undefined;
          try {
            page = await browser.newPage();
            const redirectUrls: string[] = [];
            page.on("response", (resp: Response) => {
              const status = resp.status();
              if (status >= 300 && status < 400) {
                redirectUrls.push(resp.url());
              }
            });

            const response = await page.goto(url, {
              waitUntil: "networkidle",
              timeout: opts.timeout,
            });

            statusCode = response?.status() ?? 0;
            redirectChain = redirectUrls;
            html = await page.content();

            // Extract internal links via Playwright locator API
            const anchorLocators = page.locator("a[href]");
            const count = await anchorLocators.count();
            const hrefs: string[] = [];
            for (let i = 0; i < count; i++) {
              const href = await anchorLocators.nth(i).getAttribute("href");
              if (href) hrefs.push(href);
            }
            for (const href of hrefs) {
              const resolved = normalizeUrl(href, url);
              if (resolved && isSameOrigin(resolved, normalizedStart)) {
                outgoingLinks.push(resolved);
              }
            }
            outgoingLinks = [...new Set(outgoingLinks)];
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          } finally {
            await page?.close();
          }
        } else {
          // HTML-only mode
          const result = await fetchHtml(url, opts.timeout);
          html = result.html;
          statusCode = result.statusCode;
          redirectChain = result.redirectChain;
          error = result.error;
          outgoingLinks = extractLinksFromHtml(html, url);
        }

        const node: PageNode = {
          url,
          statusCode,
          redirectChain,
          depth,
          incomingLinks: referrer ? [referrer] : [],
          outgoingLinks,
          html,
          error,
        };

        pages.set(url, node);

        // Enqueue discovered links
        if (depth < opts.maxDepth) {
          for (const link of outgoingLinks) {
            if (!enqueued.has(link) && pages.size + queue.length < opts.maxPages) {
              enqueued.add(link);
              queue.push([link, depth + 1, url]);
            }
            // Update incoming links on already-discovered pages
            const existing = pages.get(link);
            if (existing && !existing.incomingLinks.includes(url)) {
              existing.incomingLinks.push(url);
            }
          }
        }
      });

      await Promise.allSettled(tasks);
    }
  } finally {
    await browser?.close();
  }

  // Second pass: fill in incoming links from the full graph
  for (const [url, node] of pages) {
    for (const outLink of node.outgoingLinks) {
      const target = pages.get(outLink);
      if (target && !target.incomingLinks.includes(url)) {
        target.incomingLinks.push(url);
      }
    }
  }

  // Detect orphan pages (no incoming links, excluding start URL)
  const orphanPages: string[] = [];
  for (const [url, node] of pages) {
    if (url !== normalizedStart && node.incomingLinks.length === 0) {
      orphanPages.push(url);
    }
  }

  return {
    startUrl: normalizedStart,
    pages,
    orphanPages,
    elapsedMs: Date.now() - start,
  };
}
