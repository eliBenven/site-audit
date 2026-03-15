/**
 * SEO checker module.
 *
 * Analyses crawled pages for common SEO issues using cheerio for
 * reliable HTML parsing: title, meta description, h1 tags, image alt text,
 * broken images, canonical tags, OG tags, structured data, and more.
 */

import * as cheerio from "cheerio";
import type {
  CrawlResult,
  SeoIssue,
  SeoPageResult,
  SeoResult,
  SeoSeverity,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadPage(html: string) {
  return cheerio.load(html);
}

// ── Rule checks ──────────────────────────────────────────────────────────────

function checkTitle($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const title = $("title").first().text().trim();

  if (!title) {
    issues.push({ rule: "title-missing", severity: "error", message: "Page is missing a <title> tag.", url });
  } else if (title.length < 10) {
    issues.push({ rule: "title-too-short", severity: "warning", message: `Title is too short (${title.length} chars). Aim for 30-60 characters.`, url });
  } else if (title.length > 70) {
    issues.push({ rule: "title-too-long", severity: "warning", message: `Title is too long (${title.length} chars). Search engines truncate after ~60 chars.`, url });
  }

  return issues;
}

function checkMetaDescription($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const desc = $('meta[name="description"]').attr("content")?.trim() ?? null;

  if (!desc) {
    issues.push({ rule: "meta-description-missing", severity: "warning", message: "Page is missing a meta description.", url });
  } else if (desc.length < 50) {
    issues.push({ rule: "meta-description-too-short", severity: "info", message: `Meta description is too short (${desc.length} chars). Aim for 120-160 characters.`, url });
  } else if (desc.length > 160) {
    issues.push({ rule: "meta-description-too-long", severity: "info", message: `Meta description is too long (${desc.length} chars). Search engines truncate after ~160 chars.`, url });
  }

  return issues;
}

function checkH1($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const h1Count = $("h1").length;

  if (h1Count === 0) {
    issues.push({ rule: "h1-missing", severity: "error", message: "Page has no <h1> heading.", url });
  } else if (h1Count > 1) {
    issues.push({ rule: "h1-multiple", severity: "warning", message: `Page has ${h1Count} <h1> headings. Best practice is exactly one.`, url });
  }

  return issues;
}

function checkImages($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];

  $("img").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    const alt = $(el).attr("alt");

    if (!src.trim()) {
      issues.push({ rule: "img-broken-src", severity: "error", message: "Image has an empty or missing src attribute.", url, element: $.html(el) ?? undefined });
    }

    if (alt === undefined) {
      issues.push({ rule: "img-missing-alt", severity: "warning", message: `Image is missing an alt attribute: src="${src}".`, url, element: $.html(el) ?? undefined });
    } else if (alt.trim() === "") {
      issues.push({ rule: "img-empty-alt", severity: "info", message: `Image has an empty alt attribute (OK if decorative): src="${src}".`, url, element: $.html(el) ?? undefined });
    }
  });

  return issues;
}

function checkCanonical($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const canonical = $('link[rel="canonical"]').attr("href");

  if (!canonical) {
    issues.push({ rule: "canonical-missing", severity: "info", message: "Page does not have a canonical link tag.", url });
  }

  return issues;
}

function checkOpenGraph($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (!$('meta[property="og:title"]').attr("content")) {
    issues.push({ rule: "og-title-missing", severity: "info", message: "Page is missing an og:title meta tag.", url });
  }
  if (!$('meta[property="og:description"]').attr("content")) {
    issues.push({ rule: "og-description-missing", severity: "info", message: "Page is missing an og:description meta tag.", url });
  }
  if (!$('meta[property="og:image"]').attr("content")) {
    issues.push({ rule: "og-image-missing", severity: "warning", message: "Page is missing an og:image meta tag. Social shares will lack a preview image.", url });
  }
  if (!$('meta[property="og:url"]').attr("content")) {
    issues.push({ rule: "og-url-missing", severity: "info", message: "Page is missing an og:url meta tag.", url });
  }

  return issues;
}

function checkViewport($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if ($('meta[name="viewport"]').length === 0) {
    issues.push({ rule: "viewport-missing", severity: "warning", message: 'Page is missing a <meta name="viewport"> tag. Mobile rendering may be broken.', url });
  }
  return issues;
}

function checkLang($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const lang = $("html").attr("lang");
  if (!lang) {
    issues.push({ rule: "html-lang-missing", severity: "warning", message: "The <html> element is missing a lang attribute. This hurts accessibility and SEO.", url });
  }
  return issues;
}

function checkStructuredData($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if ($('script[type="application/ld+json"]').length === 0) {
    issues.push({ rule: "structured-data-missing", severity: "info", message: "Page has no JSON-LD structured data. Adding schema markup can improve rich results.", url });
  }
  return issues;
}

function checkHeadingHierarchy($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const levels: number[] = [];

  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const tag = (el as unknown as { tagName: string }).tagName;
    levels.push(parseInt(tag[1], 10));
  });

  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      issues.push({
        rule: "heading-hierarchy-skip",
        severity: "warning",
        message: `Heading jumps from <h${levels[i - 1]}> to <h${levels[i]}>. Don't skip levels.`,
        url,
      });
      break;
    }
  }
  return issues;
}

function checkThinContent($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  // Remove script and style, then get text
  const clone = $.root().clone();
  clone.find("script, style").remove();
  const text = clone.text().replace(/\s+/g, " ").trim();
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

  if (wordCount < 300) {
    issues.push({ rule: "thin-content", severity: "info", message: `Page has only ${wordCount} words. Thin content may rank poorly.`, url });
  }
  return issues;
}

function checkMetaRobots($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const content = $('meta[name="robots"]').attr("content");
  if (content) {
    const directives = content.toLowerCase().split(",").map((d) => d.trim());
    if (directives.includes("noindex")) {
      issues.push({ rule: "meta-robots-noindex", severity: "error", message: "Page has a noindex directive — it will be excluded from search results.", url });
    }
  }
  return issues;
}

function checkTwitterCards($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if (!$('meta[name="twitter:card"]').attr("content")) {
    issues.push({ rule: "twitter-card-missing", severity: "info", message: "Page is missing a twitter:card meta tag.", url });
  }
  if (!$('meta[name="twitter:image"]').attr("content")) {
    issues.push({ rule: "twitter-image-missing", severity: "info", message: "Page is missing a twitter:image meta tag.", url });
  }
  return issues;
}

function checkMixedContent($: cheerio.CheerioAPI, html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if (!url.startsWith("https://")) return issues;

  let httpCount = 0;
  $("[src], [href]").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("href") || "";
    if (src.startsWith("http://")) httpCount++;
  });

  if (httpCount > 0) {
    issues.push({ rule: "mixed-content", severity: "warning", message: `Page loads ${httpCount} resource(s) over insecure HTTP.`, url });
  }
  return issues;
}

function checkRedirectChain(redirectChain: string[], url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if (redirectChain.length > 2) {
    issues.push({ rule: "redirect-chain-long", severity: "warning", message: `Redirect chain has ${redirectChain.length} hops. Keep chains under 3 to preserve link equity.`, url });
  }
  return issues;
}

function checkStatusCode(statusCode: number, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if (statusCode >= 400 && statusCode < 500) {
    issues.push({ rule: "status-4xx", severity: "error", message: `Page returned HTTP ${statusCode} (client error).`, url });
  } else if (statusCode >= 500) {
    issues.push({ rule: "status-5xx", severity: "error", message: `Page returned HTTP ${statusCode} (server error).`, url });
  }
  return issues;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function checkSeo(crawlResult: CrawlResult): SeoResult {
  const pageResults: SeoPageResult[] = [];
  const summary: Record<SeoSeverity, number> = { error: 0, warning: 0, info: 0 };

  for (const [url, node] of crawlResult.pages) {
    // Skip non-HTML pages (plain text files, JSON, XML, etc.)
    // Only skip if the URL has a non-HTML extension OR the page has substantial
    // content that isn't HTML. Empty/error pages should still be checked for status codes.
    const pathname = new URL(url).pathname;
    const hasNonHtmlExt = /\.(txt|json|xml|pdf|csv|ico|png|jpg|svg|woff2?)$/i.test(pathname);
    const trimmed = node.html.trim();
    const hasContentButNotHtml = trimmed.length > 50 && !trimmed.startsWith("<!") && !trimmed.startsWith("<html") && !trimmed.includes("<head");
    if (hasNonHtmlExt || hasContentButNotHtml) continue;

    const $ = loadPage(node.html);
    const issues: SeoIssue[] = [
      ...checkTitle($, url),
      ...checkMetaDescription($, url),
      ...checkH1($, url),
      ...checkHeadingHierarchy($, url),
      ...checkImages($, url),
      ...checkCanonical($, url),
      ...checkOpenGraph($, url),
      ...checkViewport($, url),
      ...checkLang($, url),
      ...checkStructuredData($, url),
      ...checkMetaRobots($, url),
      ...checkTwitterCards($, url),
      ...checkMixedContent($, node.html, url),
      ...checkThinContent($, url),
      ...checkRedirectChain(node.redirectChain, url),
      ...checkStatusCode(node.statusCode, url),
    ];

    for (const issue of issues) {
      summary[issue.severity]++;
    }

    pageResults.push({
      url,
      title: $("title").first().text().trim() || null,
      metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? null,
      h1Count: $("h1").length,
      canonicalUrl: $('link[rel="canonical"]').attr("href") ?? null,
      issues,
    });
  }

  // Cross-page: duplicate titles
  const titleMap = new Map<string, string[]>();
  for (const page of pageResults) {
    if (page.title) {
      const urls = titleMap.get(page.title) ?? [];
      urls.push(page.url);
      titleMap.set(page.title, urls);
    }
  }
  for (const [title, urls] of titleMap) {
    if (urls.length > 1) {
      for (const url of urls) {
        const page = pageResults.find((p) => p.url === url)!;
        const issue: SeoIssue = {
          rule: "duplicate-title",
          severity: "warning",
          message: `Title "${title}" is shared by ${urls.length} pages.`,
          url,
        };
        page.issues.push(issue);
        summary.warning++;
      }
    }
  }

  // Cross-page: duplicate meta descriptions
  const descMap = new Map<string, string[]>();
  for (const page of pageResults) {
    if (page.metaDescription) {
      const urls = descMap.get(page.metaDescription) ?? [];
      urls.push(page.url);
      descMap.set(page.metaDescription, urls);
    }
  }
  for (const [, urls] of descMap) {
    if (urls.length > 1) {
      for (const url of urls) {
        const page = pageResults.find((p) => p.url === url)!;
        const issue: SeoIssue = {
          rule: "duplicate-meta-description",
          severity: "warning",
          message: `Meta description is shared by ${urls.length} pages.`,
          url,
        };
        page.issues.push(issue);
        summary.warning++;
      }
    }
  }

  return { pages: pageResults, summary };
}
