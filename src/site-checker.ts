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

interface FetchResult {
  ok: boolean;
  status: number;
  text: string;
  headers: Map<string, string>;
}

async function fetchWithHeaders(url: string, timeoutMs = 10_000): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    const text = await res.text();
    const headers = new Map<string, string>();
    res.headers.forEach((v, k) => headers.set(k.toLowerCase(), v));
    return { ok: res.ok, status: res.status, text, headers };
  } catch {
    return { ok: false, status: 0, text: "", headers: new Map() };
  }
}

async function checkRobotsTxt(baseUrl: string): Promise<SeoIssue[]> {
  const issues: SeoIssue[] = [];
  const url = new URL("/robots.txt", baseUrl).href;
  const { ok, text } = await fetchWithHeaders(url);

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
  const { ok, text } = await fetchWithHeaders(url);

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

async function checkSecurityHeaders(baseUrl: string): Promise<SeoIssue[]> {
  const issues: SeoIssue[] = [];
  const { ok, headers } = await fetchWithHeaders(baseUrl);
  if (!ok) return issues;

  const checks: Array<{ header: string; rule: string; message: string }> = [
    {
      header: "strict-transport-security",
      rule: "security-hsts-missing",
      message: "Missing Strict-Transport-Security header. Browsers won't enforce HTTPS.",
    },
    {
      header: "content-security-policy",
      rule: "security-csp-missing",
      message: "Missing Content-Security-Policy header. Site is more vulnerable to XSS.",
    },
    {
      header: "x-frame-options",
      rule: "security-x-frame-missing",
      message: "Missing X-Frame-Options header. Site may be vulnerable to clickjacking.",
    },
    {
      header: "x-content-type-options",
      rule: "security-x-content-type-missing",
      message: "Missing X-Content-Type-Options header. Browsers may MIME-sniff responses.",
    },
  ];

  for (const check of checks) {
    if (!headers.has(check.header)) {
      issues.push({
        rule: check.rule,
        severity: "warning",
        message: check.message,
        url: baseUrl,
      });
    }
  }

  return issues;
}

// Known framework default favicon hashes (SHA-256 of first 256 bytes)
// These detect the most common "you forgot to change the favicon" cases
const DEFAULT_FAVICON_SIGNATURES = new Set([
  // Rather than hashing, we check Content-Length for known defaults
  // Next.js default favicon: 25931 bytes (Vercel triangle)
  // Create React App: 3870 bytes
  // Vite: 1547 bytes (Vite logo)
]);

const KNOWN_DEFAULT_FAVICON_SIZES = new Set([25931, 3870, 1547, 15406, 4286]);

async function checkFaviconDefault(baseUrl: string): Promise<SeoIssue[]> {
  const issues: SeoIssue[] = [];
  const candidates = ["/favicon.ico", "/favicon.png", "/favicon.svg"];

  for (const path of candidates) {
    const url = new URL(path, baseUrl).href;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
      clearTimeout(timer);

      if (res.ok) {
        const contentLength = parseInt(res.headers.get("content-length") ?? "0", 10);
        if (KNOWN_DEFAULT_FAVICON_SIZES.has(contentLength)) {
          issues.push({
            rule: "favicon-framework-default",
            severity: "warning",
            message: `Favicon at ${path} appears to be a framework default (${contentLength} bytes). Replace it with your brand logo.`,
            url,
          });
        }
        break; // Found a favicon, stop checking
      }
    } catch {
      // ignore
    }
  }

  return issues;
}

async function checkLightweightPerf(baseUrl: string): Promise<SeoIssue[]> {
  const issues: SeoIssue[] = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const start = Date.now();
    const res = await fetch(baseUrl, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    const html = await res.text();
    const ttfb = Date.now() - start;

    // Slow TTFB
    if (ttfb > 3000) {
      issues.push({
        rule: "perf-slow-ttfb",
        severity: "warning",
        message: `Homepage TTFB is ${ttfb}ms (>3s). This indicates slow server response.`,
        url: baseUrl,
      });
    }

    // Large HTML payload
    const htmlSizeKb = Math.round(html.length / 1024);
    if (htmlSizeKb > 200) {
      issues.push({
        rule: "perf-large-html",
        severity: "info",
        message: `Homepage HTML is ${htmlSizeKb}KB. Large HTML payloads slow initial render.`,
        url: baseUrl,
      });
    }

    // Count images without lazy loading (simple heuristic)
    const imgMatches = html.match(/<img\b[^>]*>/gi) ?? [];
    const nonLazyImages = imgMatches.filter((tag) =>
      !tag.includes('loading="lazy"') && !tag.includes("loading='lazy'"),
    );
    // First image should be eager (hero), rest should be lazy
    if (nonLazyImages.length > 3) {
      issues.push({
        rule: "perf-images-not-lazy",
        severity: "info",
        message: `${nonLazyImages.length} images lack loading="lazy". Lazy-load below-fold images to improve initial load.`,
        url: baseUrl,
      });
    }
  } catch {
    // Silently skip — perf checks are best-effort
  }

  return issues;
}

export async function checkSiteLevel(startUrl: string): Promise<SiteLevelResult> {
  const origin = new URL(startUrl).origin;
  const [robotsIssues, sitemapIssues, securityIssues, faviconIssues, perfIssues] = await Promise.all([
    checkRobotsTxt(origin),
    checkSitemapXml(origin),
    checkSecurityHeaders(origin),
    checkFaviconDefault(origin),
    checkLightweightPerf(startUrl),
  ]);

  return { issues: [...robotsIssues, ...sitemapIssues, ...securityIssues, ...faviconIssues, ...perfIssues] };
}
