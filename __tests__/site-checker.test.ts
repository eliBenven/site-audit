import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkSiteLevel } from "../src/site-checker.js";

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockResponse(body: string, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

// ── robots.txt checks ──────────────────────────────────────────────────────

describe("robots.txt checks", () => {
  it("reports missing robots.txt", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("robots.txt")) return mockResponse("", 404);
      if (url.includes("sitemap.xml")) return mockResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      return mockResponse("", 404);
    });

    const result = await checkSiteLevel("https://example.com");
    const rules = result.issues.map((i) => i.rule);
    expect(rules).toContain("robots-txt-missing");
  });

  it("reports Disallow: / in robots.txt", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("robots.txt")) return mockResponse("User-agent: *\nDisallow: /\n");
      if (url.includes("sitemap.xml")) return mockResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      return mockResponse("", 404);
    });

    const result = await checkSiteLevel("https://example.com");
    const rules = result.issues.map((i) => i.rule);
    expect(rules).toContain("robots-txt-disallow-all");
  });

  it("does not flag a valid robots.txt", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("robots.txt")) return mockResponse("User-agent: *\nAllow: /\nDisallow: /admin\n");
      if (url.includes("sitemap.xml")) return mockResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      return mockResponse("", 404);
    });

    const result = await checkSiteLevel("https://example.com");
    const rules = result.issues.map((i) => i.rule);
    expect(rules).not.toContain("robots-txt-missing");
    expect(rules).not.toContain("robots-txt-disallow-all");
  });
});

// ── sitemap.xml checks ─────────────────────────────────────────────────────

describe("sitemap.xml checks", () => {
  it("reports missing sitemap.xml", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("robots.txt")) return mockResponse("User-agent: *\nAllow: /\n");
      if (url.includes("sitemap.xml")) return mockResponse("", 404);
      return mockResponse("", 404);
    });

    const result = await checkSiteLevel("https://example.com");
    const rules = result.issues.map((i) => i.rule);
    expect(rules).toContain("sitemap-xml-missing");
  });

  it("reports invalid sitemap.xml (no <urlset> or <sitemapindex>)", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("robots.txt")) return mockResponse("User-agent: *\nAllow: /\n");
      if (url.includes("sitemap.xml")) return mockResponse("<html><body>Not a sitemap</body></html>");
      return mockResponse("", 404);
    });

    const result = await checkSiteLevel("https://example.com");
    const rules = result.issues.map((i) => i.rule);
    expect(rules).toContain("sitemap-xml-invalid");
  });

  it("passes for a valid sitemap with <urlset>", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("robots.txt")) return mockResponse("User-agent: *\nAllow: /\n");
      if (url.includes("sitemap.xml")) {
        return mockResponse('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>');
      }
      return mockResponse("", 404);
    });

    const result = await checkSiteLevel("https://example.com");
    const rules = result.issues.map((i) => i.rule);
    expect(rules).not.toContain("sitemap-xml-missing");
    expect(rules).not.toContain("sitemap-xml-invalid");
  });

  it("passes for a valid sitemap index", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("robots.txt")) return mockResponse("User-agent: *\nAllow: /\n");
      if (url.includes("sitemap.xml")) {
        return mockResponse('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap></sitemapindex>');
      }
      return mockResponse("", 404);
    });

    const result = await checkSiteLevel("https://example.com");
    const rules = result.issues.map((i) => i.rule);
    expect(rules).not.toContain("sitemap-xml-missing");
    expect(rules).not.toContain("sitemap-xml-invalid");
  });
});

// ── Combined checks ────────────────────────────────────────────────────────

describe("checkSiteLevel integration", () => {
  it("returns no issues when both files are valid", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("robots.txt")) return mockResponse("User-agent: *\nAllow: /\n");
      if (url.includes("sitemap.xml")) return mockResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      return mockResponse("", 404);
    });

    const result = await checkSiteLevel("https://example.com");
    expect(result.issues).toHaveLength(0);
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await checkSiteLevel("https://example.com");
    const rules = result.issues.map((i) => i.rule);
    expect(rules).toContain("robots-txt-missing");
    expect(rules).toContain("sitemap-xml-missing");
  });
});
