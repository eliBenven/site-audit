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

export function analyzeCrawl(crawlResult: CrawlResult): CrawlAnalysisResult {
  return {
    issues: [...checkLinkDepth(crawlResult), ...checkCrawlBudget(crawlResult)],
  };
}
