import { describe, it, expect } from "vitest";
import { analyzeCrawl } from "../src/crawl-analyzer.js";
import type { CrawlResult, PageNode } from "../src/types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCrawlResult(pages: Map<string, PageNode>): CrawlResult {
  return {
    startUrl: "https://example.com/",
    pages,
    orphanPages: [],
    elapsedMs: 100,
  };
}

function makePage(
  url: string,
  overrides: Partial<PageNode> = {},
): PageNode {
  return {
    url,
    statusCode: 200,
    redirectChain: [],
    depth: 1,
    incomingLinks: [],
    outgoingLinks: [],
    html: "<html><body><p>Content</p></body></html>",
    ...overrides,
  };
}

// ── Link Depth ──────────────────────────────────────────────────────────────

describe("analyzeCrawl – link depth", () => {
  it("detects pages with depth > 3", () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage("https://example.com/", { depth: 0 }),
    );
    pages.set(
      "https://example.com/deep",
      makePage("https://example.com/deep", { depth: 4 }),
    );
    pages.set(
      "https://example.com/deeper",
      makePage("https://example.com/deeper", { depth: 7 }),
    );

    const result = analyzeCrawl(makeCrawlResult(pages));
    const depthIssues = result.issues.filter(
      (i) => i.rule === "link-depth-deep",
    );
    expect(depthIssues).toHaveLength(2);
    expect(depthIssues[0].url).toBe("https://example.com/deep");
    expect(depthIssues[0].message).toContain("4 clicks");
    expect(depthIssues[1].url).toBe("https://example.com/deeper");
    expect(depthIssues[1].message).toContain("7 clicks");
  });

  it("does not flag pages with depth <= 3", () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage("https://example.com/", { depth: 0 }),
    );
    pages.set(
      "https://example.com/about",
      makePage("https://example.com/about", { depth: 1 }),
    );
    pages.set(
      "https://example.com/about/team",
      makePage("https://example.com/about/team", { depth: 2 }),
    );
    pages.set(
      "https://example.com/about/team/lead",
      makePage("https://example.com/about/team/lead", { depth: 3 }),
    );

    const result = analyzeCrawl(makeCrawlResult(pages));
    const depthIssues = result.issues.filter(
      (i) => i.rule === "link-depth-deep",
    );
    expect(depthIssues).toHaveLength(0);
  });

  it("flags exactly depth 4 but not depth 3", () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/at-three",
      makePage("https://example.com/at-three", { depth: 3 }),
    );
    pages.set(
      "https://example.com/at-four",
      makePage("https://example.com/at-four", { depth: 4 }),
    );

    const result = analyzeCrawl(makeCrawlResult(pages));
    const depthIssues = result.issues.filter(
      (i) => i.rule === "link-depth-deep",
    );
    expect(depthIssues).toHaveLength(1);
    expect(depthIssues[0].url).toBe("https://example.com/at-four");
  });
});

// ── Crawl Budget / Parameterized URL Bloat ──────────────────────────────────

describe("analyzeCrawl – parameterized URL bloat", () => {
  it("detects 5+ parameterized variants of the same path", () => {
    const pages = new Map<string, PageNode>();
    for (let i = 0; i < 6; i++) {
      const url = `https://example.com/products?page=${i}`;
      pages.set(url, makePage(url));
    }

    const result = analyzeCrawl(makeCrawlResult(pages));
    const budgetIssues = result.issues.filter(
      (i) => i.rule === "crawl-budget-parameterized",
    );
    expect(budgetIssues).toHaveLength(1);
    expect(budgetIssues[0].message).toContain("6 parameterized variants");
    expect(budgetIssues[0].url).toBe("https://example.com/products");
  });

  it("does not flag fewer than 5 parameterized variants", () => {
    const pages = new Map<string, PageNode>();
    for (let i = 0; i < 4; i++) {
      const url = `https://example.com/products?page=${i}`;
      pages.set(url, makePage(url));
    }

    const result = analyzeCrawl(makeCrawlResult(pages));
    const budgetIssues = result.issues.filter(
      (i) => i.rule === "crawl-budget-parameterized",
    );
    expect(budgetIssues).toHaveLength(0);
  });

  it("does not flag URLs without query strings", () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage("https://example.com/"),
    );
    pages.set(
      "https://example.com/about",
      makePage("https://example.com/about"),
    );
    pages.set(
      "https://example.com/contact",
      makePage("https://example.com/contact"),
    );

    const result = analyzeCrawl(makeCrawlResult(pages));
    const budgetIssues = result.issues.filter(
      (i) => i.rule === "crawl-budget-parameterized",
    );
    expect(budgetIssues).toHaveLength(0);
  });

  it("groups by path correctly across different base paths", () => {
    const pages = new Map<string, PageNode>();
    // 5 variants for /search
    for (let i = 0; i < 5; i++) {
      const url = `https://example.com/search?q=term${i}`;
      pages.set(url, makePage(url));
    }
    // 3 variants for /filter (below threshold)
    for (let i = 0; i < 3; i++) {
      const url = `https://example.com/filter?cat=${i}`;
      pages.set(url, makePage(url));
    }

    const result = analyzeCrawl(makeCrawlResult(pages));
    const budgetIssues = result.issues.filter(
      (i) => i.rule === "crawl-budget-parameterized",
    );
    expect(budgetIssues).toHaveLength(1);
    expect(budgetIssues[0].url).toBe("https://example.com/search");
  });
});

// ── No Issues ───────────────────────────────────────────────────────────────

describe("analyzeCrawl – clean site", () => {
  it("returns no issues for a clean crawl", () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage("https://example.com/", { depth: 0 }),
    );
    pages.set(
      "https://example.com/about",
      makePage("https://example.com/about", { depth: 1 }),
    );
    pages.set(
      "https://example.com/contact",
      makePage("https://example.com/contact", { depth: 2 }),
    );

    const result = analyzeCrawl(makeCrawlResult(pages));
    expect(result.issues).toHaveLength(0);
  });
});
