/**
 * SEO checker module.
 *
 * Analyses crawled pages for common SEO issues: title, meta description,
 * h1 tags, image alt text, broken images, and canonical tags.
 */

import type {
  CrawlResult,
  SeoIssue,
  SeoPageResult,
  SeoResult,
  SeoSeverity,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Tiny DOM-in-regex helpers. Good enough for auditing; no dep on JSDOM. */

function getMetaContent(html: string, nameOrProperty: string): string | null {
  const re = new RegExp(
    `<meta\\s[^>]*(?:name|property)=["']${nameOrProperty}["'][^>]*content=["']([^"']*)["']` +
      `|<meta\\s[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProperty}["']`,
    "i",
  );
  const m = html.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

function getTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

function getCanonical(html: string): string | null {
  const m = html.match(/<link\s[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  return m ? m[1] : null;
}

interface ImgTag {
  src: string;
  alt: string | null;
  full: string;
}

function getImages(html: string): ImgTag[] {
  const imgs: ImgTag[] = [];
  const re = /<img\s([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src=["']([^"']*)["']/i);
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    imgs.push({
      src: srcMatch ? srcMatch[1] : "",
      alt: altMatch ? altMatch[1] : null,
      full: m[0],
    });
  }
  return imgs;
}

function countTag(html: string, tag: string): number {
  const re = new RegExp(`<${tag}[\\s>]`, "gi");
  const matches = html.match(re);
  return matches ? matches.length : 0;
}

// ── Rule checks ──────────────────────────────────────────────────────────────

function checkTitle(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const title = getTitle(html);

  if (!title) {
    issues.push({
      rule: "title-missing",
      severity: "error",
      message: "Page is missing a <title> tag.",
      url,
    });
  } else if (title.length < 10) {
    issues.push({
      rule: "title-too-short",
      severity: "warning",
      message: `Title is too short (${title.length} chars). Aim for 30-60 characters.`,
      url,
    });
  } else if (title.length > 70) {
    issues.push({
      rule: "title-too-long",
      severity: "warning",
      message: `Title is too long (${title.length} chars). Search engines truncate after ~60 chars.`,
      url,
    });
  }

  return issues;
}

function checkMetaDescription(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const desc = getMetaContent(html, "description");

  if (!desc) {
    issues.push({
      rule: "meta-description-missing",
      severity: "warning",
      message: "Page is missing a meta description.",
      url,
    });
  } else if (desc.length < 50) {
    issues.push({
      rule: "meta-description-too-short",
      severity: "info",
      message: `Meta description is too short (${desc.length} chars). Aim for 120-160 characters.`,
      url,
    });
  } else if (desc.length > 160) {
    issues.push({
      rule: "meta-description-too-long",
      severity: "info",
      message: `Meta description is too long (${desc.length} chars). Search engines truncate after ~160 chars.`,
      url,
    });
  }

  return issues;
}

function checkH1(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const h1Count = countTag(html, "h1");

  if (h1Count === 0) {
    issues.push({
      rule: "h1-missing",
      severity: "error",
      message: "Page has no <h1> heading.",
      url,
    });
  } else if (h1Count > 1) {
    issues.push({
      rule: "h1-multiple",
      severity: "warning",
      message: `Page has ${h1Count} <h1> headings. Best practice is exactly one.`,
      url,
    });
  }

  return issues;
}

function checkImages(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const imgs = getImages(html);

  for (const img of imgs) {
    if (!img.src || img.src.trim() === "") {
      issues.push({
        rule: "img-broken-src",
        severity: "error",
        message: "Image has an empty or missing src attribute.",
        url,
        element: img.full,
      });
    }

    if (img.alt === null) {
      issues.push({
        rule: "img-missing-alt",
        severity: "warning",
        message: `Image is missing an alt attribute: src="${img.src}".`,
        url,
        element: img.full,
      });
    } else if (img.alt.trim() === "") {
      // Empty alt is acceptable for decorative images, but flag as info
      issues.push({
        rule: "img-empty-alt",
        severity: "info",
        message: `Image has an empty alt attribute (OK if decorative): src="${img.src}".`,
        url,
        element: img.full,
      });
    }
  }

  return issues;
}

function checkCanonical(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const canonical = getCanonical(html);

  if (!canonical) {
    issues.push({
      rule: "canonical-missing",
      severity: "info",
      message: "Page does not have a canonical link tag.",
      url,
    });
  }

  return issues;
}

function checkStatusCode(statusCode: number, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (statusCode >= 400 && statusCode < 500) {
    issues.push({
      rule: "status-4xx",
      severity: "error",
      message: `Page returned HTTP ${statusCode} (client error).`,
      url,
    });
  } else if (statusCode >= 500) {
    issues.push({
      rule: "status-5xx",
      severity: "error",
      message: `Page returned HTTP ${statusCode} (server error).`,
      url,
    });
  }

  return issues;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function checkSeo(crawlResult: CrawlResult): SeoResult {
  const pageResults: SeoPageResult[] = [];
  const summary: Record<SeoSeverity, number> = { error: 0, warning: 0, info: 0 };

  for (const [url, node] of crawlResult.pages) {
    const html = node.html;
    const issues: SeoIssue[] = [
      ...checkTitle(html, url),
      ...checkMetaDescription(html, url),
      ...checkH1(html, url),
      ...checkImages(html, url),
      ...checkCanonical(html, url),
      ...checkStatusCode(node.statusCode, url),
    ];

    for (const issue of issues) {
      summary[issue.severity]++;
    }

    pageResults.push({
      url,
      title: getTitle(html),
      metaDescription: getMetaContent(html, "description"),
      h1Count: countTag(html, "h1"),
      canonicalUrl: getCanonical(html),
      issues,
    });
  }

  return { pages: pageResults, summary };
}
