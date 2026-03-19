/**
 * Crawl analysis module.
 *
 * Post-processes crawl data to detect:
 * - Deep pages (>3 clicks from homepage)
 * - Parameterized URL bloat (crawl budget waste)
 */

import type { CrawlResult, SeoIssue } from "./types.js";

export interface CrawlAnalysisResult {
  issues: SeoIssue[];
}

function checkLinkDepth(crawlResult: CrawlResult): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const maxDesirable = 3;

  for (const [url, node] of crawlResult.pages) {
    if (node.depth > maxDesirable) {
      issues.push({
        rule: "link-depth-deep",
        severity: "warning",
        message: `Page is ${node.depth} clicks from the start URL. Keep important pages within 3 clicks.`,
        url,
      });
    }
  }
  return issues;
}

function checkCrawlBudget(crawlResult: CrawlResult): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Group URLs by path (without query string)
  const pathCounts = new Map<string, string[]>();
  for (const [url] of crawlResult.pages) {
    try {
      const parsed = new URL(url);
      if (parsed.search) {
        const base = parsed.origin + parsed.pathname;
        const urls = pathCounts.get(base) ?? [];
        urls.push(url);
        pathCounts.set(base, urls);
      }
    } catch {
      // skip
    }
  }

  for (const [basePath, urls] of pathCounts) {
    if (urls.length >= 5) {
      issues.push({
        rule: "crawl-budget-parameterized",
        severity: "warning",
        message: `${urls.length} parameterized variants of ${basePath} found. Consider canonicalization.`,
        url: basePath,
      });
    }
  }
  return issues;
}

function checkInternalLinking(crawlResult: CrawlResult): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const startOrigin = new URL(crawlResult.startUrl).origin;
  const pageUrls = new Set(crawlResult.pages.keys());

  for (const [url, node] of crawlResult.pages) {
    // Skip non-HTML pages
    const pathname = new URL(url).pathname;
    if (/\.(xml|txt|json|ico|png|jpg|svg)$/i.test(pathname)) continue;

    // Count internal outgoing links in body content (not just nav)
    const internalOutgoing = node.outgoingLinks.filter((link) => {
      try {
        return new URL(link, url).origin === startOrigin && pageUrls.has(link);
      } catch {
        return false;
      }
    });

    // Dead-end pages: pages with zero or very few internal links
    if (internalOutgoing.length === 0) {
      issues.push({
        rule: "internal-link-dead-end",
        severity: "warning",
        message: "Page has no internal links. Add cross-links to help users and search engines navigate.",
        url,
      });
    }

    // Orphan-like pages: only reachable from one other page
    if (node.incomingLinks.length <= 1 && node.depth > 0) {
      issues.push({
        rule: "internal-link-isolated",
        severity: "info",
        message: `Page only has ${node.incomingLinks.length} incoming internal link(s). Add more cross-links for better discoverability.`,
        url,
      });
    }
  }

  // Check if contact/lead pages are well-linked
  const contactPaths = ["/contact", "/get-in-touch", "/book", "/quote", "/inquiry"];
  for (const [url] of crawlResult.pages) {
    const pathname = new URL(url).pathname.toLowerCase();
    if (contactPaths.some((cp) => pathname.includes(cp))) {
      const incomingCount = crawlResult.pages.get(url)?.incomingLinks.length ?? 0;
      const totalPages = crawlResult.pages.size;
      // Contact page should be linked from most pages
      if (incomingCount < Math.floor(totalPages * 0.5) && totalPages > 3) {
        issues.push({
          rule: "internal-link-contact-underlinked",
          severity: "info",
          message: `Contact page has only ${incomingCount} incoming links out of ${totalPages} pages. Key conversion pages should be linked from most pages.`,
          url,
        });
      }
    }
  }

  return issues;
}

export function analyzeCrawl(crawlResult: CrawlResult): CrawlAnalysisResult {
  return {
    issues: [
      ...checkLinkDepth(crawlResult),
      ...checkCrawlBudget(crawlResult),
      ...checkInternalLinking(crawlResult),
    ],
  };
}
