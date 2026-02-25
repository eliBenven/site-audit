import { describe, it, expect } from "vitest";
import { analyzeResources } from "../src/resource-analyzer.js";
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

function makePage(url: string, html: string): PageNode {
  return {
    url,
    statusCode: 200,
    redirectChain: [],
    depth: 1,
    incomingLinks: [],
    outgoingLinks: [],
    html,
  };
}

function singlePageCrawl(html: string): CrawlResult {
  const url = "https://example.com/";
  const pages = new Map<string, PageNode>();
  pages.set(url, makePage(url, html));
  return makeCrawlResult(pages);
}

// ── Render-blocking Scripts ─────────────────────────────────────────────────

describe("analyzeResources – render-blocking scripts", () => {
  it("detects render-blocking scripts in <head> without async/defer", () => {
    const html = `
      <html>
      <head>
        <title>Test</title>
        <script src="/js/app.js"></script>
        <script src="/js/vendor.js"></script>
      </head>
      <body><p>Content</p></body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const blockingIssues = result.issues.filter(
      (i) => i.rule === "resource-render-blocking",
    );
    expect(blockingIssues).toHaveLength(1);
    expect(blockingIssues[0].message).toContain("2 script(s)");
    expect(blockingIssues[0].severity).toBe("warning");
  });

  it("passes when scripts have async attribute", () => {
    const html = `
      <html>
      <head>
        <title>Test</title>
        <script src="/js/app.js" async></script>
        <script src="/js/vendor.js" async></script>
      </head>
      <body><p>Content</p></body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const blockingIssues = result.issues.filter(
      (i) => i.rule === "resource-render-blocking",
    );
    expect(blockingIssues).toHaveLength(0);
  });

  it("passes when scripts have defer attribute", () => {
    const html = `
      <html>
      <head>
        <title>Test</title>
        <script src="/js/app.js" defer></script>
      </head>
      <body><p>Content</p></body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const blockingIssues = result.issues.filter(
      (i) => i.rule === "resource-render-blocking",
    );
    expect(blockingIssues).toHaveLength(0);
  });

  it("does not flag scripts in <body> (outside <head>)", () => {
    const html = `
      <html>
      <head><title>Test</title></head>
      <body>
        <p>Content</p>
        <script src="/js/app.js"></script>
      </body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const blockingIssues = result.issues.filter(
      (i) => i.rule === "resource-render-blocking",
    );
    expect(blockingIssues).toHaveLength(0);
  });

  it("does not flag inline scripts (no src attribute)", () => {
    const html = `
      <html>
      <head>
        <title>Test</title>
        <script>var x = 1;</script>
      </head>
      <body><p>Content</p></body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const blockingIssues = result.issues.filter(
      (i) => i.rule === "resource-render-blocking",
    );
    expect(blockingIssues).toHaveLength(0);
  });
});

// ── Excessive External Resources ────────────────────────────────────────────

describe("analyzeResources – excessive external resources", () => {
  it("detects excessive external resources (>20)", () => {
    const scripts = Array.from(
      { length: 15 },
      (_, i) => `<script src="/js/lib${i}.js" defer></script>`,
    ).join("\n");
    const stylesheets = Array.from(
      { length: 8 },
      (_, i) => `<link rel="stylesheet" href="/css/style${i}.css">`,
    ).join("\n");

    const html = `
      <html>
      <head>
        <title>Test</title>
        ${stylesheets}
      </head>
      <body>
        <p>Content</p>
        ${scripts}
      </body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const excessiveIssues = result.issues.filter(
      (i) => i.rule === "resource-excessive",
    );
    expect(excessiveIssues).toHaveLength(1);
    expect(excessiveIssues[0].message).toContain("23 external resources");
    expect(excessiveIssues[0].severity).toBe("info");
  });

  it("does not flag 20 or fewer external resources", () => {
    const scripts = Array.from(
      { length: 10 },
      (_, i) => `<script src="/js/lib${i}.js" defer></script>`,
    ).join("\n");
    const stylesheets = Array.from(
      { length: 10 },
      (_, i) => `<link rel="stylesheet" href="/css/style${i}.css">`,
    ).join("\n");

    const html = `
      <html>
      <head>
        <title>Test</title>
        ${stylesheets}
      </head>
      <body>
        <p>Content</p>
        ${scripts}
      </body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const excessiveIssues = result.issues.filter(
      (i) => i.rule === "resource-excessive",
    );
    expect(excessiveIssues).toHaveLength(0);
  });
});

// ── Third-party Domains ─────────────────────────────────────────────────────

describe("analyzeResources – third-party domains", () => {
  it("detects heavy third-party usage (>5 domains)", () => {
    const thirdPartyScripts = [
      "https://cdn1.example.org/lib.js",
      "https://cdn2.example.org/lib.js",
      "https://analytics.example.net/track.js",
      "https://ads.example.biz/show.js",
      "https://fonts.googleapis.com/font.js",
      "https://widget.social.io/embed.js",
    ]
      .map((src) => `<script src="${src}" defer></script>`)
      .join("\n");

    const html = `
      <html>
      <head><title>Test</title></head>
      <body>
        <p>Content</p>
        ${thirdPartyScripts}
      </body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const tpIssues = result.issues.filter(
      (i) => i.rule === "resource-third-party-heavy",
    );
    expect(tpIssues).toHaveLength(1);
    expect(tpIssues[0].message).toContain("6 third-party domains");
    expect(tpIssues[0].severity).toBe("info");
  });

  it("does not flag 5 or fewer third-party domains", () => {
    const thirdPartyScripts = [
      "https://cdn.example.org/lib.js",
      "https://analytics.example.net/track.js",
    ]
      .map((src) => `<script src="${src}" defer></script>`)
      .join("\n");

    const html = `
      <html>
      <head><title>Test</title></head>
      <body>
        <p>Content</p>
        ${thirdPartyScripts}
      </body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const tpIssues = result.issues.filter(
      (i) => i.rule === "resource-third-party-heavy",
    );
    expect(tpIssues).toHaveLength(0);
  });

  it("counts same-origin scripts as first-party, not third-party", () => {
    const html = `
      <html>
      <head><title>Test</title></head>
      <body>
        <p>Content</p>
        <script src="https://example.com/js/a.js" defer></script>
        <script src="https://example.com/js/b.js" defer></script>
        <script src="/js/c.js" defer></script>
      </body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    const tpIssues = result.issues.filter(
      (i) => i.rule === "resource-third-party-heavy",
    );
    expect(tpIssues).toHaveLength(0);
  });
});

// ── Lightweight Page ────────────────────────────────────────────────────────

describe("analyzeResources – lightweight page", () => {
  it("returns no issues for a lightweight, well-optimized page", () => {
    const html = `
      <html>
      <head>
        <title>Clean Page</title>
        <link rel="stylesheet" href="/css/main.css">
        <script src="/js/app.js" defer></script>
      </head>
      <body>
        <p>Minimal resources, all first-party, scripts deferred.</p>
      </body>
      </html>
    `;
    const result = analyzeResources(singlePageCrawl(html));
    expect(result.issues).toHaveLength(0);
  });
});
