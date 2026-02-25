/**
 * Site-level checker module.
 *
 * Checks that exist once per domain rather than per page:
 * robots.txt presence & rules, sitemap.xml presence & basic validation.
 */

import type { SeoIssue } from "./types.js";

export interface SiteLevelResult {
  issues: SeoIssue[];
}

async function fetchText(url: string, timeoutMs = 10_000): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

async function checkRobotsTxt(baseUrl: string): Promise<SeoIssue[]> {
  const issues: SeoIssue[] = [];
  const url = new URL("/robots.txt", baseUrl).href;
  const { ok, text } = await fetchText(url);

  if (!ok) {
    issues.push({
      rule: "robots-txt-missing",
      severity: "warning",
      message: "No robots.txt found. Search engines won't have crawl directives.",
      url,
    });
    return issues;
  }

  // Check for blanket Disallow: /
  const lines = text.split("\n").map((l) => l.trim().toLowerCase());
  const hasDisallowAll = lines.some((l) => l === "disallow: /");
  if (hasDisallowAll) {
    issues.push({
      rule: "robots-txt-disallow-all",
      severity: "error",
      message: "robots.txt contains \"Disallow: /\" which blocks all search engine crawling.",
      url,
    });
  }

  return issues;
}

async function checkSitemapXml(baseUrl: string): Promise<SeoIssue[]> {
  const issues: SeoIssue[] = [];
  const url = new URL("/sitemap.xml", baseUrl).href;
  const { ok, text } = await fetchText(url);

  if (!ok) {
    issues.push({
      rule: "sitemap-xml-missing",
      severity: "warning",
      message: "No sitemap.xml found. A sitemap helps search engines discover all pages.",
      url,
    });
    return issues;
  }

  // Basic XML validation: should contain <urlset or <sitemapindex
  const hasValidRoot = /<urlset[\s>]/i.test(text) || /<sitemapindex[\s>]/i.test(text);
  if (!hasValidRoot) {
    issues.push({
      rule: "sitemap-xml-invalid",
      severity: "warning",
      message: "sitemap.xml exists but does not appear to be valid (missing <urlset> or <sitemapindex>).",
      url,
    });
  }

  return issues;
}

export async function checkSiteLevel(startUrl: string): Promise<SiteLevelResult> {
  const origin = new URL(startUrl).origin;
  const [robotsIssues, sitemapIssues] = await Promise.all([
    checkRobotsTxt(origin),
    checkSitemapXml(origin),
  ]);

  return { issues: [...robotsIssues, ...sitemapIssues] };
}
