import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkExternalLinks } from "../src/link-checker.js";
import type { CrawlResult, PageNode } from "../src/types.js";

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockResponse(status = 200, headers: Record<string, string> = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
      forEach: (cb: (v: string, k: string) => void) => headerMap.forEach((v, k) => cb(v, k)),
    },
    text: () => Promise.resolve(""),
  });
}

function makePage(url: string, html: string): PageNode {
  return {
    url,
    statusCode: 200,
    redirectChain: [],
    depth: 0,
    incomingLinks: [],
    outgoingLinks: [],
    html,
  };
}

function makeCrawlResult(pages: Map<string, PageNode>): CrawlResult {
  return {
    startUrl: "https://example.com",
    pages,
    orphanPages: [],
    elapsedMs: 100,
  };
}

// ── Broken external links ───────────────────────────────────────────────────

describe("broken external link detection", () => {
  it("detects broken external links (HEAD returns 404)", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><a href="https://external.com/broken-page">link</a></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    mockFetch.mockImplementation(() => mockResponse(404));

    const result = await checkExternalLinks(crawl);

    expect(result.checked).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].rule).toBe("external-link-broken");
    expect(result.issues[0].message).toContain("https://external.com/broken-page");
    expect(result.issues[0].message).toContain("404");
    expect(result.issues[0].url).toBe("https://example.com/");
  });
});

// ── Valid external links ────────────────────────────────────────────────────

describe("valid external link detection", () => {
  it("passes for valid external links (HEAD returns 200)", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><a href="https://good-site.com/page">link</a></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    mockFetch.mockImplementation(() => mockResponse(200));

    const result = await checkExternalLinks(crawl);

    expect(result.checked).toBe(1);
    expect(result.broken).toBe(0);
    expect(result.issues).toHaveLength(0);
  });
});

// ── Internal links are skipped ──────────────────────────────────────────────

describe("internal link filtering", () => {
  it("skips internal links and only checks external ones", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        `<html><body>
          <a href="https://example.com/about">internal</a>
          <a href="/contact">internal relative</a>
          <a href="https://other-domain.com/page">external</a>
        </body></html>`,
      ),
    );
    const crawl = makeCrawlResult(pages);

    mockFetch.mockImplementation(() => mockResponse(200));

    const result = await checkExternalLinks(crawl);

    // Only the one external link should have been checked
    expect(result.checked).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://other-domain.com/page",
      expect.objectContaining({ method: "HEAD" }),
    );
  });
});

// ── Checked / broken counts ─────────────────────────────────────────────────

describe("checked and broken counts", () => {
  it("returns correct checked/broken counts for multiple links", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        `<html><body>
          <a href="https://a.com/ok">ok</a>
          <a href="https://b.com/bad">bad</a>
          <a href="https://c.com/ok">ok</a>
          <a href="https://d.com/bad">bad</a>
        </body></html>`,
      ),
    );
    const crawl = makeCrawlResult(pages);

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("a.com") || url.includes("c.com")) {
        return mockResponse(200);
      }
      return mockResponse(404);
    });

    const result = await checkExternalLinks(crawl);

    expect(result.checked).toBe(4);
    expect(result.broken).toBe(2);
    expect(result.issues).toHaveLength(2);
  });
});

// ── Network errors ──────────────────────────────────────────────────────────

describe("fetch error handling", () => {
  it("handles network errors gracefully", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><a href="https://unreachable.com/page">link</a></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await checkExternalLinks(crawl);

    expect(result.checked).toBe(1);
    expect(result.broken).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].rule).toBe("external-link-broken");
    // status 0 maps to "timeout/error" in the message
    expect(result.issues[0].message).toContain("timeout/error");
  });
});
