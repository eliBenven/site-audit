import { describe, it, expect } from "vitest";
import { analyzeContent } from "../src/content-analyzer.js";
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

/**
 * Generate a block of filler text with the given number of words.
 * Each vocabulary set is fully distinct so different sets produce
 * text with near-zero shingling overlap.
 */
function generateText(wordCount: number, vocabSet: number = 0): string {
  const vocabularies = [
    [
      "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
      "a", "bright", "red", "car", "drives", "through", "narrow", "street",
      "she", "writes", "beautiful", "poems", "about", "nature", "and", "life",
      "tall", "green", "trees", "grow", "in", "vast", "forest", "clearing",
      "warm", "summer", "breeze", "flows", "across", "open", "golden", "field",
      "small", "blue", "bird", "sings", "on", "old", "wooden", "fence",
      "deep", "ocean", "waves", "crash", "against", "rocky", "shore", "below",
      "young", "children", "play", "happily", "at", "local", "park", "today",
    ],
    [
      "cloud", "computing", "infrastructure", "deployment", "monitoring",
      "kubernetes", "container", "orchestration", "pipeline", "artifact",
      "registry", "terraform", "provisioning", "scaling", "horizontal",
      "vertical", "latency", "throughput", "bandwidth", "ingress",
      "egress", "firewall", "subnet", "routing", "gateway",
      "certificate", "encryption", "protocol", "handshake", "payload",
      "serialization", "deserialization", "middleware", "interceptor", "proxy",
      "upstream", "downstream", "failover", "redundancy", "replication",
      "partition", "sharding", "consensus", "quorum", "leader",
      "follower", "snapshot", "checkpoint", "recovery", "rollback",
      "migration", "schema", "indexing", "optimizer", "execution",
      "planner", "statistics", "histogram", "cardinality", "selectivity",
      "materialized", "projection", "aggregation", "windowing", "cursor",
    ],
  ];
  const vocab = vocabularies[vocabSet % vocabularies.length];
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(vocab[i % vocab.length]);
  }
  return words.join(" ");
}

function wrapInHtml(bodyText: string): string {
  return `<html><head><title>Page</title></head><body><p>${bodyText}</p></body></html>`;
}

// ── Near-duplicate Detection ────────────────────────────────────────────────

describe("analyzeContent – near-duplicate detection", () => {
  it("detects near-duplicate content (same text on two pages)", () => {
    const sharedText = generateText(100);
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/page-a",
      makePage("https://example.com/page-a", wrapInHtml(sharedText)),
    );
    pages.set(
      "https://example.com/page-b",
      makePage("https://example.com/page-b", wrapInHtml(sharedText)),
    );

    const result = analyzeContent(makeCrawlResult(pages));
    expect(result.duplicateGroups.length).toBeGreaterThanOrEqual(1);

    const dupIssues = result.issues.filter(
      (i) => i.rule === "content-near-duplicate",
    );
    expect(dupIssues).toHaveLength(2);
    const urls = dupIssues.map((i) => i.url).sort();
    expect(urls).toEqual([
      "https://example.com/page-a",
      "https://example.com/page-b",
    ]);
  });

  it("returns duplicate groups with similarity scores", () => {
    const sharedText = generateText(100);
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/one",
      makePage("https://example.com/one", wrapInHtml(sharedText)),
    );
    pages.set(
      "https://example.com/two",
      makePage("https://example.com/two", wrapInHtml(sharedText)),
    );

    const result = analyzeContent(makeCrawlResult(pages));
    expect(result.duplicateGroups).toHaveLength(1);

    const group = result.duplicateGroups[0];
    expect(group.urls).toHaveLength(2);
    expect(group.urls).toContain("https://example.com/one");
    expect(group.urls).toContain("https://example.com/two");
    // Identical content should have similarity = 1.0
    expect(group.similarity).toBe(1);
  });

  it("detects pages that are highly similar but not identical", () => {
    // Build two texts that share ~90% of their words
    const baseWords = generateText(100).split(" ");
    const variantWords = [...baseWords];
    // Change the last 8 words to something different
    for (let i = 92; i < 100; i++) {
      variantWords[i] = "completely_different_word_" + i;
    }

    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/alpha",
      makePage(
        "https://example.com/alpha",
        wrapInHtml(baseWords.join(" ")),
      ),
    );
    pages.set(
      "https://example.com/beta",
      makePage(
        "https://example.com/beta",
        wrapInHtml(variantWords.join(" ")),
      ),
    );

    const result = analyzeContent(makeCrawlResult(pages));
    expect(result.duplicateGroups.length).toBeGreaterThanOrEqual(1);
    expect(result.duplicateGroups[0].similarity).toBeGreaterThanOrEqual(0.8);
    expect(result.duplicateGroups[0].similarity).toBeLessThan(1);
  });
});

// ── Below Word Threshold ────────────────────────────────────────────────────

describe("analyzeContent – word threshold", () => {
  it("does not flag pages below the 50-word threshold", () => {
    const shortText = generateText(30); // only 30 words
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/short-a",
      makePage("https://example.com/short-a", wrapInHtml(shortText)),
    );
    pages.set(
      "https://example.com/short-b",
      makePage("https://example.com/short-b", wrapInHtml(shortText)),
    );

    const result = analyzeContent(makeCrawlResult(pages));
    expect(result.duplicateGroups).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });

  it("skips pages with minimal content even alongside long pages", () => {
    const longText = generateText(100);
    const shortText = generateText(20);
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/long",
      makePage("https://example.com/long", wrapInHtml(longText)),
    );
    pages.set(
      "https://example.com/short",
      makePage("https://example.com/short", wrapInHtml(shortText)),
    );

    const result = analyzeContent(makeCrawlResult(pages));
    // Only one page meets the threshold, so no pairs can form
    expect(result.duplicateGroups).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });
});

// ── Dissimilar Pages ────────────────────────────────────────────────────────

describe("analyzeContent – dissimilar pages", () => {
  it("does not flag pages with very different content", () => {
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/about",
      makePage(
        "https://example.com/about",
        wrapInHtml(generateText(100, 0)),
      ),
    );
    pages.set(
      "https://example.com/contact",
      makePage(
        "https://example.com/contact",
        wrapInHtml(generateText(100, 1)),
      ),
    );

    const result = analyzeContent(makeCrawlResult(pages));
    const dupIssues = result.issues.filter(
      (i) => i.rule === "content-near-duplicate",
    );
    expect(dupIssues).toHaveLength(0);
    expect(result.duplicateGroups).toHaveLength(0);
  });

  it("handles a mix of duplicates and unique pages", () => {
    const duplicateText = generateText(100, 0);
    const uniqueText = generateText(100, 1);

    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/dup-1",
      makePage("https://example.com/dup-1", wrapInHtml(duplicateText)),
    );
    pages.set(
      "https://example.com/dup-2",
      makePage("https://example.com/dup-2", wrapInHtml(duplicateText)),
    );
    pages.set(
      "https://example.com/unique",
      makePage("https://example.com/unique", wrapInHtml(uniqueText)),
    );

    const result = analyzeContent(makeCrawlResult(pages));

    // Should detect exactly one duplicate group between dup-1 and dup-2
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0].urls.sort()).toEqual([
      "https://example.com/dup-1",
      "https://example.com/dup-2",
    ]);

    // Unique page should not appear in issues
    const dupIssues = result.issues.filter(
      (i) => i.rule === "content-near-duplicate",
    );
    expect(dupIssues.every((i) => i.url !== "https://example.com/unique")).toBe(
      true,
    );
  });
});

// ── Custom Threshold ────────────────────────────────────────────────────────

describe("analyzeContent – custom threshold", () => {
  it("respects a stricter threshold", () => {
    const sharedText = generateText(100);
    const pages = new Map<string, PageNode>();
    pages.set(
      "https://example.com/a",
      makePage("https://example.com/a", wrapInHtml(sharedText)),
    );
    pages.set(
      "https://example.com/b",
      makePage("https://example.com/b", wrapInHtml(sharedText)),
    );

    // With threshold 1.0, identical pages should still match
    const result = analyzeContent(makeCrawlResult(pages), { threshold: 1.0 });
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0].similarity).toBe(1);
  });
});
