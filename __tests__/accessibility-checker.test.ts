import { describe, it, expect } from "vitest";
import { checkAccessibility } from "../src/accessibility-checker.js";
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

// ── Form Labels ─────────────────────────────────────────────────────────────

describe("checkAccessibility – form labels", () => {
  it("detects missing form labels (input without label or aria-label)", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main>
          <nav><a href="#content">Skip</a></nav>
          <form>
            <input type="text" name="username">
            <select name="country"></select>
            <textarea name="bio"></textarea>
          </form>
        </main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const labelIssues = result.issues.filter(
      (i) => i.rule === "a11y-form-label-missing",
    );
    expect(labelIssues).toHaveLength(1);
    expect(labelIssues[0].message).toContain("3 form field(s)");
  });

  it("passes when form labels are present via <label for>", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main>
          <nav><a href="#content">Skip</a></nav>
          <form>
            <label for="user">Username</label>
            <input type="text" id="user" name="username">
          </form>
        </main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const labelIssues = result.issues.filter(
      (i) => i.rule === "a11y-form-label-missing",
    );
    expect(labelIssues).toHaveLength(0);
  });

  it("passes when form fields use aria-label", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main>
          <nav><a href="#content">Skip</a></nav>
          <form>
            <input type="text" aria-label="Search query">
          </form>
        </main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const labelIssues = result.issues.filter(
      (i) => i.rule === "a11y-form-label-missing",
    );
    expect(labelIssues).toHaveLength(0);
  });

  it("ignores hidden, submit, button, reset, and image inputs", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main>
          <nav><a href="#content">Skip</a></nav>
          <form>
            <input type="hidden" name="token" value="abc">
            <input type="submit" value="Go">
            <input type="button" value="Click">
            <input type="reset" value="Clear">
            <input type="image" src="btn.png" alt="Submit">
          </form>
        </main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const labelIssues = result.issues.filter(
      (i) => i.rule === "a11y-form-label-missing",
    );
    expect(labelIssues).toHaveLength(0);
  });
});

// ── Landmarks ───────────────────────────────────────────────────────────────

describe("checkAccessibility – landmarks", () => {
  it("detects missing <main> landmark", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <div>Content without main landmark</div>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const mainIssues = result.issues.filter(
      (i) => i.rule === "a11y-landmark-main-missing",
    );
    expect(mainIssues).toHaveLength(1);
    expect(mainIssues[0].severity).toBe("warning");
  });

  it("detects missing <nav> landmark", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main><p>Content</p></main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const navIssues = result.issues.filter(
      (i) => i.rule === "a11y-landmark-nav-missing",
    );
    expect(navIssues).toHaveLength(1);
    expect(navIssues[0].severity).toBe("info");
  });

  it("accepts role=\"main\" as a valid main landmark", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <div role="main"><p>Content</p></div>
        <nav><a href="/">Home</a></nav>
        <a href="#content">Skip to content</a>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const mainIssues = result.issues.filter(
      (i) => i.rule === "a11y-landmark-main-missing",
    );
    expect(mainIssues).toHaveLength(0);
  });

  it("accepts role=\"navigation\" as a valid nav landmark", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main><p>Content</p></main>
        <div role="navigation"><a href="/">Home</a></div>
        <a href="#content">Skip to content</a>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const navIssues = result.issues.filter(
      (i) => i.rule === "a11y-landmark-nav-missing",
    );
    expect(navIssues).toHaveLength(0);
  });
});

// ── Skip Navigation ─────────────────────────────────────────────────────────

describe("checkAccessibility – skip navigation", () => {
  it("detects missing skip navigation link", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main><nav><a href="/">Home</a></nav></main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const skipIssues = result.issues.filter(
      (i) => i.rule === "a11y-skip-nav-missing",
    );
    expect(skipIssues).toHaveLength(1);
    expect(skipIssues[0].severity).toBe("info");
  });

  it("passes when skip navigation link is present", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <a href="#main-content">Skip to main content</a>
        <main id="main-content"><nav><a href="/">Home</a></nav></main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const skipIssues = result.issues.filter(
      (i) => i.rule === "a11y-skip-nav-missing",
    );
    expect(skipIssues).toHaveLength(0);
  });
});

// ── Tabindex ────────────────────────────────────────────────────────────────

describe("checkAccessibility – tabindex", () => {
  it("detects positive tabindex values", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main><nav><a href="#c">Skip</a></nav>
          <button tabindex="1">First</button>
          <button tabindex="5">Second</button>
          <button tabindex="0">OK</button>
        </main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const tabIssues = result.issues.filter(
      (i) => i.rule === "a11y-tabindex-positive",
    );
    expect(tabIssues).toHaveLength(1);
    expect(tabIssues[0].message).toContain("2 element(s)");
  });

  it("does not flag tabindex=\"0\" or tabindex=\"-1\"", () => {
    const html = `
      <html><head><title>Test</title></head>
      <body>
        <main><nav><a href="#c">Skip</a></nav>
          <div tabindex="0">Focusable</div>
          <div tabindex="-1">Programmatically focusable</div>
        </main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    const tabIssues = result.issues.filter(
      (i) => i.rule === "a11y-tabindex-positive",
    );
    expect(tabIssues).toHaveLength(0);
  });
});

// ── Well-formed HTML ────────────────────────────────────────────────────────

describe("checkAccessibility – well-formed HTML", () => {
  it("returns no issues for well-formed accessible HTML", () => {
    const html = `
      <html><head><title>Accessible Page</title></head>
      <body>
        <a href="#main-content">Skip to main content</a>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
        <main id="main-content">
          <h1>Welcome</h1>
          <form>
            <label for="email">Email</label>
            <input type="text" id="email" name="email">
            <input type="submit" value="Subscribe">
          </form>
          <div tabindex="0">Interactive widget</div>
        </main>
      </body></html>
    `;
    const result = checkAccessibility(singlePageCrawl(html));
    expect(result.issues).toHaveLength(0);
  });

  it("checks all pages in a multi-page crawl", () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        `<html><head><title>Home</title></head>
         <body><main><nav><a href="#c">Skip</a></nav><p>Home</p></main></body></html>`,
      ),
    );
    pages.set(
      "https://example.com/about",
      makePage(
        "https://example.com/about",
        `<html><head><title>About</title></head>
         <body><div>No landmarks here</div></body></html>`,
      ),
    );
    const result = checkAccessibility(makeCrawlResult(pages));

    // The about page should have landmark issues
    const aboutIssues = result.issues.filter(
      (i) => i.url === "https://example.com/about",
    );
    expect(aboutIssues.length).toBeGreaterThan(0);
    expect(aboutIssues.some((i) => i.rule === "a11y-landmark-main-missing")).toBe(
      true,
    );
  });
});
