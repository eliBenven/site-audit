/**
 * Playwright-based website crawler.
 *
 * Follows internal links, builds a site graph, captures status codes,
 * redirect chains, TTFB, and discovers all pages up to a configurable depth.
 *
 * Supports: robots.txt, retries, include/exclude patterns, cookies,
 * custom User-Agent, and <base href> resolution.
 */

import { chromium, type Browser, type Page, type Response } from "playwright";
import { URL } from "node:url";
import * as cheerio from "cheerio";
import type { CrawlOptions, CrawlResult, PageNode } from "./types.js";

const DEFAULT_OPTIONS: CrawlOptions = {
  maxDepth: 3,
  maxPages: 50,
  mode: "rendered",
  concurrency: 5,
  timeout: 30_000,
  respectRobotsTxt: true,
  retries: 1,
};

const DEFAULT_USER_AGENT = "site-audit/1.0 (https://github.com/site-audit)";

// ── Robots.txt Parser ────────────────────────────────────────────────────────

interface RobotsRules {
  disallow: string[];
  allow: string[];
}

function parseRobotsTxt(text: string, userAgent: string): RobotsRules {
  const lines = text.split("\n").map((l) => l.trim());
  const rules: RobotsRules = { disallow: [], allow: [] };

  let activeForUs = false;
  const ua = userAgent.split("/")[0].toLowerCase();

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("user-agent:")) {
      const agent = lower.slice("user-agent:".length).trim();
      activeForUs = agent === "*" || agent === ua;
    } else if (activeForUs && lower.startsWith("disallow:")) {
      const path = line.slice("disallow:".length).trim();
      if (path) rules.disallow.push(path);
    } else if (activeForUs && lower.startsWith("allow:")) {
      const path = line.slice("allow:".length).trim();
      if (path) rules.allow.push(path);
    }
  }

  return rules;
}

function isAllowedByRobots(urlPath: string, rules: RobotsRules): boolean {
  // Allow rules take precedence over disallow for same-length prefixes
  for (const allow of rules.allow) {
    if (urlPath.startsWith(allow)) return true;
  }
  for (const disallow of rules.disallow) {
    if (urlPath.startsWith(disallow)) return false;
  }
  return true;
}

async function fetchRobotsTxt(origin: string, timeout: number): Promise<RobotsRules | null> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return parseRobotsTxt(text, DEFAULT_USER_AGENT);
  } catch {
    return null;
  }
}

// ── URL Utilities ────────────────────────────────────────────────────────────

/** Normalise a URL: strip hash, trailing slash, sort search params. */
export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
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

/** Check if a URL matches any of the given glob-like patterns. */
function matchesPattern(url: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Convert simple glob to regex: * -> .*, ** -> .*
    const re = new RegExp(
      "^" + pattern.replace(/\*\*/g, "@@DOUBLE@@").replace(/\*/g, "[^/]*").replace(/@@DOUBLE@@/g, ".*") + "$",
    );
    if (re.test(url)) return true;
  }
  return false;
}

/**
 * Extract all internal anchor links from HTML using cheerio.
 * Respects <base href> if present.
 */
export function extractLinksFromHtml(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const baseHref = $("base").attr("href");
  const resolveBase = baseHref || pageUrl;

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const resolved = normalizeUrl(href, resolveBase);
    if (resolved && isSameOrigin(resolved, pageUrl)) {
      links.push(resolved);
    }
  });
  return [...new Set(links)];
}

// ── Fetch with retries ───────────────────────────────────────────────────────

async function fetchHtml(
  url: string,
  timeout: number,
  retries: number,
  cookie?: string,
  userAgent?: string,
): Promise<{ html: string; statusCode: number; redirectChain: string[]; ttfb: number; responseTime: number; error?: string }> {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  if (userAgent) headers["user-agent"] = userAgent;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const redirectChain: string[] = [];
    const start = Date.now();
    let ttfb = 0;

    try {
      let current = url;
      let response: globalThis.Response | undefined;

      for (let i = 0; i < 10; i++) {
        const reqStart = Date.now();
        response = await fetch(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(timeout),
          headers,
        });
        if (ttfb === 0) ttfb = Date.now() - reqStart;

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
      const statusCode = response?.status ?? 0;
      const responseTime = Date.now() - start;

      // Retry on 5xx
      if (statusCode >= 500 && attempt < retries) continue;

      return { html, statusCode, redirectChain, ttfb, responseTime };
    } catch (err) {
      if (attempt < retries) continue;
      return {
        html: "",
        statusCode: 0,
        redirectChain,
        ttfb: 0,
        responseTime: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Unreachable, but TypeScript needs it
  return { html: "", statusCode: 0, redirectChain: [], ttfb: 0, responseTime: 0, error: "Max retries exceeded" };
}

// ── Progress callback ────────────────────────────────────────────────────────

export type CrawlProgressCallback = (progress: {
  crawled: number;
  queued: number;
  maxPages: number;
  currentUrl: string;
}) => void;

// ── Main Crawl ───────────────────────────────────────────────────────────────

export async function crawl(
  startUrl: string,
  userOptions?: Partial<CrawlOptions>,
  onProgress?: CrawlProgressCallback,
): Promise<CrawlResult> {
  const opts: CrawlOptions = { ...DEFAULT_OPTIONS, ...userOptions };
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const start = Date.now();

  const normalizedStart = normalizeUrl(startUrl);
  if (!normalizedStart) {
    throw new Error(`Invalid start URL: ${startUrl}`);
  }

  const origin = new URL(normalizedStart).origin;

  // Fetch and parse robots.txt if enabled
  let robotsRules: RobotsRules | null = null;
  if (opts.respectRobotsTxt) {
    robotsRules = await fetchRobotsTxt(origin, opts.timeout);
  }

  const pages = new Map<string, PageNode>();
  const queue: Array<[string, number, string | null]> = [[normalizedStart, 0, null]];
  const enqueued = new Set<string>([normalizedStart]);

  // Track count separately to avoid race condition with Map size
  let crawledCount = 0;

  function shouldCrawl(url: string): boolean {
    // Robots.txt check
    if (robotsRules) {
      try {
        const path = new URL(url).pathname;
        if (!isAllowedByRobots(path, robotsRules)) return false;
      } catch { /* skip */ }
    }
    // Include/exclude patterns
    if (opts.include && opts.include.length > 0 && !matchesPattern(url, opts.include)) return false;
    if (opts.exclude && opts.exclude.length > 0 && matchesPattern(url, opts.exclude)) return false;
    return true;
  }

  let browser: Browser | undefined;

  if (opts.mode === "rendered") {
    browser = await chromium.launch({ headless: true });
  }

  try {
    while (queue.length > 0 && crawledCount < opts.maxPages) {
      const batch = queue.splice(0, opts.concurrency);

      const tasks = batch.map(async ([url, depth, referrer]) => {
        // Atomic check-and-increment to prevent exceeding maxPages
        if (crawledCount >= opts.maxPages) return;
        crawledCount++;

        onProgress?.({
          crawled: crawledCount,
          queued: queue.length,
          maxPages: opts.maxPages,
          currentUrl: url,
        });

        let html = "";
        let statusCode = 0;
        let redirectChain: string[] = [];
        let outgoingLinks: string[] = [];
        let error: string | undefined;
        let ttfb = 0;
        let responseTime = 0;

        if (opts.mode === "rendered" && browser) {
          let page: Page | undefined;
          for (let attempt = 0; attempt <= opts.retries; attempt++) {
            try {
              page = await browser.newPage();
              if (ua) await page.setExtraHTTPHeaders({ "user-agent": ua });
              if (opts.cookie) await page.setExtraHTTPHeaders({ cookie: opts.cookie });

              const redirectUrls: string[] = [];
              let firstResponseTime = 0;
              const navStart = Date.now();

              page.on("response", (resp: Response) => {
                if (firstResponseTime === 0) firstResponseTime = Date.now() - navStart;
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
              ttfb = firstResponseTime;
              responseTime = Date.now() - navStart;
              html = await page.content();

              // Use cheerio on the rendered HTML (handles <base href> too)
              outgoingLinks = extractLinksFromHtml(html, url);

              // Don't retry on success or 4xx
              if (statusCode < 500) break;
              if (attempt < opts.retries) {
                await page.close();
                page = undefined;
                continue;
              }
            } catch (err) {
              error = err instanceof Error ? err.message : String(err);
              if (attempt < opts.retries) {
                await page?.close();
                page = undefined;
                continue;
              }
            }
          }
          await page?.close();
        } else {
          const result = await fetchHtml(url, opts.timeout, opts.retries, opts.cookie, ua);
          html = result.html;
          statusCode = result.statusCode;
          redirectChain = result.redirectChain;
          error = result.error;
          ttfb = result.ttfb;
          responseTime = result.responseTime;
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
          ttfb,
          responseTime,
        };

        pages.set(url, node);

        // Enqueue discovered links
        if (depth < opts.maxDepth) {
          for (const link of outgoingLinks) {
            if (!enqueued.has(link) && crawledCount + queue.length < opts.maxPages && shouldCrawl(link)) {
              enqueued.add(link);
              queue.push([link, depth + 1, url]);
            }
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

  // Detect orphan pages
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
