import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkImageOptimization } from "../src/image-checker.js";
import type { CrawlResult, PageNode } from "../src/types.js";

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
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

// ── Non-optimal image formats ───────────────────────────────────────────────

describe("non-optimal image format detection", () => {
  it("detects JPG images and suggests WebP/AVIF", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><img src="https://example.com/photo.jpg"></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    const result = await checkImageOptimization(crawl);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].rule).toBe("img-format-not-optimal");
    expect(result.issues[0].message).toContain("JPG");
    expect(result.issues[0].message).toContain("WebP or AVIF");
  });

  it("detects PNG images and suggests WebP/AVIF", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><img src="https://example.com/banner.png"></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    const result = await checkImageOptimization(crawl);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].rule).toBe("img-format-not-optimal");
    expect(result.issues[0].message).toContain("PNG");
    expect(result.issues[0].message).toContain("WebP or AVIF");
  });

  it("detects multiple non-optimal formats on one page", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        `<html><body>
          <img src="https://example.com/a.jpg">
          <img src="https://example.com/b.jpeg">
          <img src="https://example.com/c.png">
          <img src="https://example.com/d.bmp">
        </body></html>`,
      ),
    );
    const crawl = makeCrawlResult(pages);

    const result = await checkImageOptimization(crawl);

    expect(result.issues).toHaveLength(4);
    const rules = result.issues.map((i) => i.rule);
    expect(rules.every((r) => r === "img-format-not-optimal")).toBe(true);
  });
});

// ── Modern image formats ────────────────────────────────────────────────────

describe("modern image format handling", () => {
  it("passes for WebP images", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><img src="https://example.com/hero.webp"></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    const result = await checkImageOptimization(crawl);

    expect(result.issues).toHaveLength(0);
  });

  it("passes for AVIF images", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><img src="https://example.com/hero.avif"></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    const result = await checkImageOptimization(crawl);

    expect(result.issues).toHaveLength(0);
  });

  it("passes for SVG images", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><img src="https://example.com/logo.svg"></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    const result = await checkImageOptimization(crawl);

    expect(result.issues).toHaveLength(0);
  });
});

// ── Oversized images (checkSizes enabled) ───────────────────────────────────

describe("oversized image detection", () => {
  it("detects oversized images when checkSizes is enabled", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><img src="https://example.com/huge.webp"></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    // 800KB = 819200 bytes, exceeds default 500KB threshold
    mockFetch.mockImplementation(() =>
      mockResponse(200, { "content-length": "819200" }),
    );

    const result = await checkImageOptimization(crawl, { checkSizes: true });

    const sizeIssues = result.issues.filter((i) => i.rule === "img-file-too-large");
    expect(sizeIssues).toHaveLength(1);
    expect(sizeIssues[0].message).toContain("huge.webp");
    expect(sizeIssues[0].message).toContain("800KB");
    expect(sizeIssues[0].severity).toBe("warning");
  });

  it("does not flag images under the size threshold", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><img src="https://example.com/small.webp"></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    // 100KB = 102400 bytes, under default 500KB threshold
    mockFetch.mockImplementation(() =>
      mockResponse(200, { "content-length": "102400" }),
    );

    const result = await checkImageOptimization(crawl, { checkSizes: true });

    const sizeIssues = result.issues.filter((i) => i.rule === "img-file-too-large");
    expect(sizeIssues).toHaveLength(0);
  });

  it("respects custom maxSizeKb threshold", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        '<html><body><img src="https://example.com/medium.webp"></body></html>',
      ),
    );
    const crawl = makeCrawlResult(pages);

    // 200KB = 204800 bytes, over a 100KB custom threshold
    mockFetch.mockImplementation(() =>
      mockResponse(200, { "content-length": "204800" }),
    );

    const result = await checkImageOptimization(crawl, {
      checkSizes: true,
      maxSizeKb: 100,
    });

    const sizeIssues = result.issues.filter((i) => i.rule === "img-file-too-large");
    expect(sizeIssues).toHaveLength(1);
    expect(sizeIssues[0].message).toContain(">100KB");
  });
});

// ── No images ───────────────────────────────────────────────────────────────

describe("pages with no images", () => {
  it("returns no issues for a page with no images", async () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/",
      makePage(
        "https://example.com/",
        "<html><body><p>No images here</p></body></html>",
      ),
    );
    const crawl = makeCrawlResult(pages);

    const result = await checkImageOptimization(crawl);

    expect(result.issues).toHaveLength(0);
  });

  it("returns no issues for an empty pages map", async () => {
    const pages = new Map<string, PageNode>();
    const crawl = makeCrawlResult(pages);

    const result = await checkImageOptimization(crawl);

    expect(result.issues).toHaveLength(0);
  });
});
