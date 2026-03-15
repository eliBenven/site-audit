/**
 * Content analyzer module.
 *
 * Detects near-duplicate pages using MinHash for efficient approximate
 * Jaccard similarity (O(n) comparisons instead of O(n^2) shingle sets).
 * Uses cheerio for text extraction.
 */

import * as cheerio from "cheerio";
import type { CrawlResult, SeoIssue } from "./types.js";

export interface ContentAnalysisResult {
  duplicateGroups: Array<{ urls: string[]; similarity: number }>;
  issues: SeoIssue[];
}

function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return $.text().replace(/\s+/g, " ").trim().toLowerCase();
}

// ── MinHash Implementation ───────────────────────────────────────────────────

const NUM_HASHES = 128;

/** Simple string hash — FNV-1a variant with seed. */
function hashWithSeed(str: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function createShingles(text: string, k = 5): string[] {
  const words = text.split(/\s+/);
  const shingles: string[] = [];
  for (let i = 0; i <= words.length - k; i++) {
    shingles.push(words.slice(i, i + k).join(" "));
  }
  return shingles;
}

function computeMinHash(shingles: string[]): Uint32Array {
  const signature = new Uint32Array(NUM_HASHES).fill(0xFFFFFFFF);
  for (const shingle of shingles) {
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = hashWithSeed(shingle, i);
      if (h < signature[i]) signature[i] = h;
    }
  }
  return signature;
}

function estimateJaccard(a: Uint32Array, b: Uint32Array): number {
  let matches = 0;
  for (let i = 0; i < NUM_HASHES; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / NUM_HASHES;
}

// For small page counts (< 20), use exact Jaccard for accuracy
function exactJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function analyzeContent(
  crawlResult: CrawlResult,
  options: { threshold?: number } = {},
): ContentAnalysisResult {
  const threshold = options.threshold ?? 0.8;
  const issues: SeoIssue[] = [];
  const duplicateGroups: ContentAnalysisResult["duplicateGroups"] = [];

  const pages: Array<{ url: string; shingles: string[]; shingleSet: Set<string>; minHash: Uint32Array }> = [];
  for (const [url, node] of crawlResult.pages) {
    const text = extractText(node.html);
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length < 50) continue;
    const shingles = createShingles(text);
    pages.push({
      url,
      shingles,
      shingleSet: new Set(shingles),
      minHash: computeMinHash(shingles),
    });
  }

  const useExact = pages.length < 20;
  const flagged = new Set<string>();

  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const sim = useExact
        ? exactJaccard(pages[i].shingleSet, pages[j].shingleSet)
        : estimateJaccard(pages[i].minHash, pages[j].minHash);

      if (sim >= threshold) {
        const group = [pages[i].url, pages[j].url];
        duplicateGroups.push({ urls: group, similarity: sim });

        for (const url of group) {
          if (!flagged.has(url)) {
            flagged.add(url);
            issues.push({
              rule: "content-near-duplicate",
              severity: "warning",
              message: `Page content is ${(sim * 100).toFixed(0)}% similar to another page. Consider consolidating.`,
              url,
            });
          }
        }
      }
    }
  }

  return { duplicateGroups, issues };
}
