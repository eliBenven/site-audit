import { describe, it, expect } from "vitest";
import { checkSeo } from "../src/seo-checker.js";
import type { CrawlResult, PageNode, SeoIssue } from "../src/types.js";

/** Helper: build a minimal CrawlResult from a single HTML string. */
function makeCrawlResult(html: string, url = "https://example.com"): CrawlResult {
  const node: PageNode = {
    url,
    statusCode: 200,
    redirectChain: [],
    depth: 0,
    incomingLinks: [],
    outgoingLinks: [],
    html,
  };
  const pages = new Map<string, PageNode>();
  pages.set(url, node);
  return {
    startUrl: url,
    pages,
    orphanPages: [],
    elapsedMs: 100,
  };
}

/** Convenience: run checkSeo on a single HTML and return the issue list. */
function getIssues(html: string, url?: string): SeoIssue[] {
  const result = checkSeo(makeCrawlResult(html, url));
  return result.pages[0].issues;
}

function hasRule(issues: SeoIssue[], rule: string): boolean {
  return issues.some((i) => i.rule === rule);
}

// ── Title checks ────────────────────────────────────────────────────────────

describe("Title checks", () => {
  it("detects missing title", () => {
    const issues = getIssues("<html><head></head><body></body></html>");
    expect(hasRule(issues, "title-missing")).toBe(true);
  });

  it("detects short title (< 10 chars)", () => {
    const issues = getIssues("<html><head><title>Hi</title></head><body></body></html>");
    expect(hasRule(issues, "title-too-short")).toBe(true);
  });

  it("detects long title (> 70 chars)", () => {
    const longTitle = "A".repeat(71);
    const issues = getIssues(
      `<html><head><title>${longTitle}</title></head><body></body></html>`,
    );
    expect(hasRule(issues, "title-too-long")).toBe(true);
  });

  it("passes for a normal-length title", () => {
    const goodTitle = "A Perfectly Good Page Title Here"; // 31 chars
    const issues = getIssues(
      `<html><head><title>${goodTitle}</title></head><body></body></html>`,
    );
    expect(hasRule(issues, "title-missing")).toBe(false);
    expect(hasRule(issues, "title-too-short")).toBe(false);
    expect(hasRule(issues, "title-too-long")).toBe(false);
  });
});

// ── Meta description checks ─────────────────────────────────────────────────

describe("Meta description checks", () => {
  it("detects missing meta description", () => {
    const issues = getIssues("<html><head><title>Normal Title Page</title></head><body></body></html>");
    expect(hasRule(issues, "meta-description-missing")).toBe(true);
  });

  it("detects short meta description (< 50 chars)", () => {
    const issues = getIssues(
      `<html><head><title>Normal Title Page</title><meta name="description" content="Short"></head><body></body></html>`,
    );
    expect(hasRule(issues, "meta-description-too-short")).toBe(true);
  });

  it("detects long meta description (> 160 chars)", () => {
    const longDesc = "B".repeat(161);
    const issues = getIssues(
      `<html><head><title>Normal Title Page</title><meta name="description" content="${longDesc}"></head><body></body></html>`,
    );
    expect(hasRule(issues, "meta-description-too-long")).toBe(true);
  });

  it("passes for a good meta description", () => {
    const goodDesc = "C".repeat(130); // between 50 and 160
    const issues = getIssues(
      `<html><head><title>Normal Title Page</title><meta name="description" content="${goodDesc}"></head><body></body></html>`,
    );
    expect(hasRule(issues, "meta-description-missing")).toBe(false);
    expect(hasRule(issues, "meta-description-too-short")).toBe(false);
    expect(hasRule(issues, "meta-description-too-long")).toBe(false);
  });
});

// ── H1 checks ───────────────────────────────────────────────────────────────

describe("H1 checks", () => {
  it("detects missing h1", () => {
    const issues = getIssues("<html><body><h2>Subtitle</h2></body></html>");
    expect(hasRule(issues, "h1-missing")).toBe(true);
  });

  it("detects multiple h1 tags", () => {
    const issues = getIssues(
      "<html><body><h1>First</h1><h1>Second</h1></body></html>",
    );
    expect(hasRule(issues, "h1-multiple")).toBe(true);
  });

  it("passes for exactly one h1", () => {
    const issues = getIssues(
      "<html><body><h1>Only Heading</h1></body></html>",
    );
    expect(hasRule(issues, "h1-missing")).toBe(false);
    expect(hasRule(issues, "h1-multiple")).toBe(false);
  });
});

// ── Image alt text checks ───────────────────────────────────────────────────

describe("Image alt text checks", () => {
  it("detects missing alt attribute", () => {
    const issues = getIssues(
      '<html><body><img src="photo.jpg"></body></html>',
    );
    expect(hasRule(issues, "img-missing-alt")).toBe(true);
  });

  it("detects empty alt attribute (flagged as info)", () => {
    const issues = getIssues(
      '<html><body><img src="photo.jpg" alt=""></body></html>',
    );
    expect(hasRule(issues, "img-empty-alt")).toBe(true);
    const emptyAlt = issues.find((i) => i.rule === "img-empty-alt");
    expect(emptyAlt?.severity).toBe("info");
  });

  it("passes when alt text is present", () => {
    const issues = getIssues(
      '<html><body><img src="photo.jpg" alt="A nice photo"></body></html>',
    );
    expect(hasRule(issues, "img-missing-alt")).toBe(false);
    expect(hasRule(issues, "img-empty-alt")).toBe(false);
  });

  it("detects broken (empty) image src", () => {
    const issues = getIssues(
      '<html><body><img src="" alt="something"></body></html>',
    );
    expect(hasRule(issues, "img-broken-src")).toBe(true);
  });
});

// ── Canonical checks ────────────────────────────────────────────────────────

describe("Canonical checks", () => {
  it("detects missing canonical", () => {
    const issues = getIssues("<html><head></head><body></body></html>");
    expect(hasRule(issues, "canonical-missing")).toBe(true);
  });

  it("passes when canonical is present", () => {
    const issues = getIssues(
      '<html><head><link rel="canonical" href="https://example.com/page"></head><body></body></html>',
    );
    expect(hasRule(issues, "canonical-missing")).toBe(false);
  });
});

// ── Status code checks ──────────────────────────────────────────────────────

describe("Status code checks", () => {
  it("reports 4xx errors", () => {
    const node: PageNode = {
      url: "https://example.com/missing",
      statusCode: 404,
      redirectChain: [],
      depth: 0,
      incomingLinks: [],
      outgoingLinks: [],
      html: "",
    };
    const pages = new Map<string, PageNode>();
    pages.set(node.url, node);
    const crawlResult: CrawlResult = {
      startUrl: node.url,
      pages,
      orphanPages: [],
      elapsedMs: 10,
    };
    const result = checkSeo(crawlResult);
    const issues = result.pages[0].issues;
    expect(hasRule(issues, "status-4xx")).toBe(true);
  });

  it("reports 5xx errors", () => {
    const node: PageNode = {
      url: "https://example.com/error",
      statusCode: 500,
      redirectChain: [],
      depth: 0,
      incomingLinks: [],
      outgoingLinks: [],
      html: "",
    };
    const pages = new Map<string, PageNode>();
    pages.set(node.url, node);
    const crawlResult: CrawlResult = {
      startUrl: node.url,
      pages,
      orphanPages: [],
      elapsedMs: 10,
    };
    const result = checkSeo(crawlResult);
    const issues = result.pages[0].issues;
    expect(hasRule(issues, "status-5xx")).toBe(true);
  });
});

// ── Summary aggregation ─────────────────────────────────────────────────────

describe("Summary aggregation", () => {
  it("correctly counts issues by severity", () => {
    // Missing title = error, missing meta = warning, missing canonical = info, missing h1 = error
    const html = "<html><head></head><body><p>no heading</p></body></html>";
    const result = checkSeo(makeCrawlResult(html));
    // title-missing (error), meta-description-missing (warning), h1-missing (error), canonical-missing (info)
    expect(result.summary.error).toBe(2); // title-missing + h1-missing
    expect(result.summary.warning).toBe(1); // meta-description-missing
    expect(result.summary.info).toBe(1); // canonical-missing
  });
});
