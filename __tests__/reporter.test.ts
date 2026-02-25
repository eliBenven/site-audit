import { describe, it, expect } from "vitest";
import {
  score,
  buildRankedFixes,
  buildJsonReport,
  generateHtml,
} from "../src/reporter.js";
import type { ReportInputs } from "../src/reporter.js";
import type {
  CrawlResult,
  PageNode,
  SeoResult,
  LighthouseResult,
  AuditReport,
} from "../src/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMinimalCrawlResult(): CrawlResult {
  const pages = new Map<string, PageNode>();
  pages.set("https://example.com", {
    url: "https://example.com",
    statusCode: 200,
    redirectChain: [],
    depth: 0,
    incomingLinks: [],
    outgoingLinks: [],
    html: "<html><body>Hello</body></html>",
  });
  return {
    startUrl: "https://example.com",
    pages,
    orphanPages: [],
    elapsedMs: 500,
  };
}

function makeMinimalSeoResult(): SeoResult {
  return {
    pages: [
      {
        url: "https://example.com",
        title: "Test Page",
        metaDescription: "A test page description",
        h1Count: 1,
        canonicalUrl: "https://example.com",
        issues: [
          {
            rule: "title-too-short",
            severity: "warning",
            message: "Title is too short (9 chars).",
            url: "https://example.com",
          },
        ],
      },
    ],
    summary: { error: 0, warning: 1, info: 0 },
  };
}

function makeSeoResultWithMultipleIssues(): SeoResult {
  return {
    pages: [
      {
        url: "https://example.com",
        title: null,
        metaDescription: null,
        h1Count: 0,
        canonicalUrl: null,
        issues: [
          {
            rule: "title-missing",
            severity: "error",
            message: "Page is missing a <title> tag.",
            url: "https://example.com",
          },
          {
            rule: "h1-missing",
            severity: "error",
            message: "Page has no <h1> heading.",
            url: "https://example.com",
          },
          {
            rule: "meta-description-missing",
            severity: "warning",
            message: "Page is missing a meta description.",
            url: "https://example.com",
          },
          {
            rule: "canonical-missing",
            severity: "info",
            message: "Page does not have a canonical link tag.",
            url: "https://example.com",
          },
          {
            rule: "img-missing-alt",
            severity: "warning",
            message: 'Image is missing an alt attribute: src="photo.jpg".',
            url: "https://example.com",
            element: '<img src="photo.jpg">',
          },
        ],
      },
    ],
    summary: { error: 2, warning: 2, info: 1 },
  };
}

// ── Impact x Effort scoring ─────────────────────────────────────────────────

describe("score(impact, effort)", () => {
  it("scores high impact + low effort as 9 (3 * 3)", () => {
    expect(score("high", "low")).toBe(9);
  });

  it("scores low impact + high effort as 1 (1 * 1)", () => {
    expect(score("low", "high")).toBe(1);
  });

  it("scores medium impact + medium effort as 4 (2 * 2)", () => {
    expect(score("medium", "medium")).toBe(4);
  });

  it("scores high impact + high effort as 3 (3 * 1)", () => {
    expect(score("high", "high")).toBe(3);
  });

  it("scores low impact + low effort as 3 (1 * 3)", () => {
    expect(score("low", "low")).toBe(3);
  });

  it("scores high impact + medium effort as 6 (3 * 2)", () => {
    expect(score("high", "medium")).toBe(6);
  });
});

// ── buildRankedFixes ────────────────────────────────────────────────────────

describe("buildRankedFixes", () => {
  it("returns ranked fixes sorted by score descending", () => {
    const seo = makeSeoResultWithMultipleIssues();
    const fixes = buildRankedFixes(seo, null);

    expect(fixes.length).toBeGreaterThan(0);

    // Check that each subsequent fix has a score <= the previous
    for (let i = 1; i < fixes.length; i++) {
      expect(fixes[i].score).toBeLessThanOrEqual(fixes[i - 1].score);
    }
  });

  it("assigns rank numbers starting from 1", () => {
    const seo = makeSeoResultWithMultipleIssues();
    const fixes = buildRankedFixes(seo, null);
    expect(fixes[0].rank).toBe(1);
    expect(fixes[fixes.length - 1].rank).toBe(fixes.length);
  });

  it("high-impact/low-effort fixes rank before low-impact/high-effort fixes", () => {
    const seo = makeSeoResultWithMultipleIssues();
    const fixes = buildRankedFixes(seo, null);

    // title-missing is high impact / low effort (score 9)
    // canonical-missing is medium impact / low effort (score 6)
    const titleFix = fixes.find((f) => f.title === "Add missing page titles");
    const canonicalFix = fixes.find((f) => f.title === "Add canonical link tags");

    expect(titleFix).toBeDefined();
    expect(canonicalFix).toBeDefined();
    expect(titleFix!.rank).toBeLessThan(canonicalFix!.rank);
  });

  it("merges affected URLs for the same rule across pages", () => {
    const seo: SeoResult = {
      pages: [
        {
          url: "https://example.com/page1",
          title: null,
          metaDescription: null,
          h1Count: 1,
          canonicalUrl: null,
          issues: [
            {
              rule: "title-missing",
              severity: "error",
              message: "Page is missing a <title> tag.",
              url: "https://example.com/page1",
            },
          ],
        },
        {
          url: "https://example.com/page2",
          title: null,
          metaDescription: null,
          h1Count: 1,
          canonicalUrl: null,
          issues: [
            {
              rule: "title-missing",
              severity: "error",
              message: "Page is missing a <title> tag.",
              url: "https://example.com/page2",
            },
          ],
        },
      ],
      summary: { error: 2, warning: 0, info: 0 },
    };

    const fixes = buildRankedFixes(seo, null);
    const titleFix = fixes.find((f) => f.title === "Add missing page titles");
    expect(titleFix).toBeDefined();
    expect(titleFix!.affectedUrls).toContain("https://example.com/page1");
    expect(titleFix!.affectedUrls).toContain("https://example.com/page2");
    expect(titleFix!.affectedUrls.length).toBe(2);
  });

  it("includes Lighthouse-derived fixes when provided", () => {
    const seo: SeoResult = { pages: [], summary: { error: 0, warning: 0, info: 0 } };
    const lh: LighthouseResult = {
      sampledUrls: ["https://example.com"],
      pages: [
        {
          url: "https://example.com",
          performanceScore: 45,
          cwv: { lcp: 3500, inp: null, cls: 0.05 },
          opportunities: [
            {
              title: "Reduce unused JavaScript",
              description: "Remove dead code",
              estimatedSavingsMs: 1500,
              estimatedSavingsBytes: 50000,
            },
          ],
        },
      ],
      cwvSummary: {
        p50: { lcp: 3500, inp: null, cls: 0.05 },
        p95: { lcp: 3500, inp: null, cls: 0.05 },
      },
      topOffenders: [
        { url: "https://example.com", metric: "LCP", value: 3500 },
      ],
    };

    const fixes = buildRankedFixes(seo, lh);
    const jsFix = fixes.find((f) => f.title === "Reduce unused JavaScript");
    expect(jsFix).toBeDefined();
    expect(jsFix!.category).toBe("performance");

    const lcpFix = fixes.find((f) => f.title === "Improve LCP score");
    expect(lcpFix).toBeDefined();
  });
});

// ── buildJsonReport ─────────────────────────────────────────────────────────

describe("buildJsonReport", () => {
  it("produces a valid AuditReport structure", () => {
    const crawl = makeMinimalCrawlResult();
    const seo = makeMinimalSeoResult();
    const report = buildJsonReport({ crawlResult: crawl, seo, lh: null });

    expect(report.generatedAt).toBeDefined();
    expect(report.startUrl).toBe("https://example.com");
    expect(report.crawl.totalPages).toBe(1);
    expect(report.crawl.orphanPages).toEqual([]);
    expect(report.crawl.elapsedMs).toBe(500);
    expect(report.seo).toBe(seo);
    expect(report.lighthouse).toBeNull();
    expect(Array.isArray(report.rankedFixes)).toBe(true);
  });

  it("includes status code distribution", () => {
    const crawl = makeMinimalCrawlResult();
    const seo = makeMinimalSeoResult();
    const report = buildJsonReport({ crawlResult: crawl, seo, lh: null });

    expect(report.crawl.statusCodeDistribution[200]).toBe(1);
  });

  it("includes redirect chains when present", () => {
    const pages = new Map<string, PageNode>();
    pages.set("https://example.com/old", {
      url: "https://example.com/old",
      statusCode: 200,
      redirectChain: ["https://example.com/redirect1"],
      depth: 0,
      incomingLinks: [],
      outgoingLinks: [],
      html: "",
    });
    const crawl: CrawlResult = {
      startUrl: "https://example.com/old",
      pages,
      orphanPages: [],
      elapsedMs: 100,
    };
    const seo: SeoResult = { pages: [], summary: { error: 0, warning: 0, info: 0 } };
    const report = buildJsonReport({ crawlResult: crawl, seo, lh: null });

    expect(report.crawl.redirectChains.length).toBe(1);
    expect(report.crawl.redirectChains[0].from).toBe("https://example.com/old");
    expect(report.crawl.redirectChains[0].chain).toContain(
      "https://example.com/redirect1",
    );
  });

  it("generatedAt is a valid ISO-8601 string", () => {
    const crawl = makeMinimalCrawlResult();
    const seo = makeMinimalSeoResult();
    const report = buildJsonReport({ crawlResult: crawl, seo, lh: null });

    const date = new Date(report.generatedAt);
    expect(date.toISOString()).toBe(report.generatedAt);
  });
});

// ── generateHtml ────────────────────────────────────────────────────────────

describe("generateHtml", () => {
  function makeReport(): AuditReport {
    const crawl = makeMinimalCrawlResult();
    const seo = makeSeoResultWithMultipleIssues();
    return buildJsonReport({ crawlResult: crawl, seo, lh: null });
  }

  it("returns valid HTML with DOCTYPE", () => {
    const html = generateHtml(makeReport());
    expect(html).toMatch(/^<!DOCTYPE html>/);
  });

  it("contains the Site Audit Report heading", () => {
    const html = generateHtml(makeReport());
    expect(html).toContain("Site Audit Report");
  });

  it("contains the Crawl Summary section", () => {
    const html = generateHtml(makeReport());
    expect(html).toContain("Crawl Summary");
  });

  it("contains the Ranked Fix List section", () => {
    const html = generateHtml(makeReport());
    expect(html).toContain("Ranked Fix List");
  });

  it("contains the SEO Issues section", () => {
    const html = generateHtml(makeReport());
    expect(html).toContain("SEO Issues");
  });

  it("contains the Lighthouse Performance section", () => {
    const html = generateHtml(makeReport());
    expect(html).toContain("Lighthouse Performance");
  });

  it("contains the start URL", () => {
    const html = generateHtml(makeReport());
    expect(html).toContain("example.com");
  });

  it("escapes special HTML characters in URLs", () => {
    const report = makeReport();
    report.startUrl = "https://example.com/?a=1&b=2";
    const html = generateHtml(report);
    // The ampersand should be escaped as &amp;
    expect(html).toContain("&amp;");
  });

  it("shows fix ranks in the table", () => {
    const report = makeReport();
    const html = generateHtml(report);
    // The table should contain fix rank numbers
    for (const fix of report.rankedFixes) {
      expect(html).toContain(`<td>${fix.rank}</td>`);
    }
  });

  it("shows 'Lighthouse audit was not run' when lighthouse is null", () => {
    const report = makeReport();
    report.lighthouse = null;
    const html = generateHtml(report);
    expect(html).toContain("Lighthouse audit was not run");
  });
});
