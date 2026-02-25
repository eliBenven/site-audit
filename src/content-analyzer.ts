/**
 * Content analyzer module.
 *
 * Detects near-duplicate pages using text shingling + Jaccard similarity.
 */

import type { CrawlResult, SeoIssue } from "./types.js";

export interface ContentAnalysisResult {
  duplicateGroups: Array<{ urls: string[]; similarity: number }>;
  issues: SeoIssue[];
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function shingles(text: string, k = 5): Set<string> {
  const words = text.split(/\s+/);
  const result = new Set<string>();
  for (let i = 0; i <= words.length - k; i++) {
    result.add(words.slice(i, i + k).join(" "));
  }
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
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

  const pages: Array<{ url: string; shingles: Set<string> }> = [];
  for (const [url, node] of crawlResult.pages) {
    const text = extractText(node.html);
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length < 50) continue;
    pages.push({ url, shingles: shingles(text) });
  }

  const flagged = new Set<string>();
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const sim = jaccard(pages[i].shingles, pages[j].shingles);
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
