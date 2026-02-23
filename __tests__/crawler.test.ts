import { describe, it, expect } from "vitest";
import {
  normalizeUrl,
  isSameOrigin,
  extractLinksFromHtml,
} from "../src/crawler.js";

// ── normalizeUrl ────────────────────────────────────────────────────────────

describe("normalizeUrl", () => {
  it("strips the hash fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
  });

  it("strips a trailing slash (non-root path)", () => {
    expect(normalizeUrl("https://example.com/about/")).toBe(
      "https://example.com/about",
    );
  });

  it("preserves the trailing slash on root path", () => {
    expect(normalizeUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("sorts search params alphabetically", () => {
    const result = normalizeUrl("https://example.com/search?z=1&a=2&m=3");
    expect(result).toBe("https://example.com/search?a=2&m=3&z=1");
  });

  it("resolves a relative URL against a base", () => {
    const result = normalizeUrl("/about", "https://example.com/page");
    expect(result).toBe("https://example.com/about");
  });

  it("returns null for non-http(s) protocols", () => {
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("ftp://example.com")).toBeNull();
  });

  it("returns null for completely invalid URLs without a base", () => {
    expect(normalizeUrl("not a url at all")).toBeNull();
  });

  it("strips hash and trailing slash together", () => {
    expect(normalizeUrl("https://example.com/page/#top")).toBe(
      "https://example.com/page",
    );
  });
});

// ── isSameOrigin ────────────────────────────────────────────────────────────

describe("isSameOrigin", () => {
  it("returns true for same origin (same scheme + host + port)", () => {
    expect(
      isSameOrigin("https://example.com/a", "https://example.com/b"),
    ).toBe(true);
  });

  it("returns false for different hosts", () => {
    expect(
      isSameOrigin("https://example.com/a", "https://other.com/a"),
    ).toBe(false);
  });

  it("returns false for different schemes", () => {
    expect(
      isSameOrigin("http://example.com/a", "https://example.com/a"),
    ).toBe(false);
  });

  it("returns false for different ports", () => {
    expect(
      isSameOrigin("https://example.com:443/a", "https://example.com:8080/a"),
    ).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isSameOrigin("not a url", "https://example.com")).toBe(false);
  });
});

// ── extractLinksFromHtml ────────────────────────────────────────────────────

describe("extractLinksFromHtml", () => {
  const baseUrl = "https://example.com/page";

  it("extracts internal links from anchor tags", () => {
    const html = `
      <a href="/about">About</a>
      <a href="https://example.com/contact">Contact</a>
    `;
    const links = extractLinksFromHtml(html, baseUrl);
    expect(links).toContain("https://example.com/about");
    expect(links).toContain("https://example.com/contact");
  });

  it("excludes external links", () => {
    const html = `
      <a href="https://other.com/page">External</a>
      <a href="/internal">Internal</a>
    `;
    const links = extractLinksFromHtml(html, baseUrl);
    expect(links).not.toContain("https://other.com/page");
    expect(links).toContain("https://example.com/internal");
  });

  it("de-duplicates links", () => {
    const html = `
      <a href="/dup">Link 1</a>
      <a href="/dup">Link 2</a>
      <a href="/dup">Link 3</a>
    `;
    const links = extractLinksFromHtml(html, baseUrl);
    const dupCount = links.filter(
      (l) => l === "https://example.com/dup",
    ).length;
    expect(dupCount).toBe(1);
  });

  it("returns empty array for html with no links", () => {
    const html = "<p>No links here</p>";
    const links = extractLinksFromHtml(html, baseUrl);
    expect(links).toEqual([]);
  });

  it("normalises extracted links (strips hash, trailing slash)", () => {
    const html = `<a href="/page/#section">Link</a>`;
    const links = extractLinksFromHtml(html, baseUrl);
    // After normalization: hash stripped, trailing slash stripped
    expect(links).toContain("https://example.com/page");
  });
});
