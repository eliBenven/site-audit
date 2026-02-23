/**
 * Lighthouse runner module.
 *
 * Samples pages from the crawl result, runs Lighthouse on each, and
 * extracts Core Web Vitals (LCP, INP, CLS), performance score, and
 * optimisation opportunities.
 */

import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import type {
  CoreWebVitals,
  CrawlResult,
  LighthouseOpportunity,
  LighthouseOptions,
  LighthousePageResult,
  LighthouseResult,
} from "./types.js";

const DEFAULT_OPTIONS: LighthouseOptions = {
  sampleSize: 5,
  formFactor: "mobile",
};

/** Pick a representative sample of URLs from the crawl. */
function sampleUrls(crawlResult: CrawlResult, size: number): string[] {
  const allUrls = [...crawlResult.pages.keys()].filter((url) => {
    const node = crawlResult.pages.get(url);
    return node && node.statusCode >= 200 && node.statusCode < 300;
  });

  if (allUrls.length <= size) return allUrls;

  // Stratified sample: pick from different depths
  const byDepth = new Map<number, string[]>();
  for (const url of allUrls) {
    const depth = crawlResult.pages.get(url)!.depth;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(url);
  }

  const sampled: string[] = [];
  const depths = [...byDepth.keys()].sort();
  let idx = 0;

  while (sampled.length < size) {
    const depth = depths[idx % depths.length];
    const pool = byDepth.get(depth)!;
    if (pool.length > 0) {
      // Pick a random URL from this depth
      const pick = Math.floor(Math.random() * pool.length);
      sampled.push(pool.splice(pick, 1)[0]);
    }
    idx++;
    // Safety: if we've exhausted all pools, break
    if ([...byDepth.values()].every((p) => p.length === 0)) break;
  }

  return sampled;
}

/** Extract CWV metrics from a Lighthouse result. */
function extractCwv(lhr: Record<string, unknown>): CoreWebVitals {
  const audits = lhr["audits"] as Record<string, { numericValue?: number }> | undefined;
  return {
    lcp: audits?.["largest-contentful-paint"]?.numericValue ?? null,
    inp: audits?.["interaction-to-next-paint"]?.numericValue ?? null,
    cls: audits?.["cumulative-layout-shift"]?.numericValue ?? null,
  };
}

/** Extract optimisation opportunities from Lighthouse. */
function extractOpportunities(lhr: Record<string, unknown>): LighthouseOpportunity[] {
  const audits = lhr["audits"] as
    | Record<string, { title?: string; description?: string; details?: { overallSavingsMs?: number; overallSavingsBytes?: number }; score?: number | null }>
    | undefined;
  if (!audits) return [];

  const opportunities: LighthouseOpportunity[] = [];
  for (const [, audit] of Object.entries(audits)) {
    const savings = audit.details;
    if (
      savings &&
      (typeof savings.overallSavingsMs === "number" || typeof savings.overallSavingsBytes === "number") &&
      audit.score !== null &&
      audit.score !== undefined &&
      audit.score < 1
    ) {
      opportunities.push({
        title: audit.title ?? "Unknown",
        description: audit.description ?? "",
        estimatedSavingsMs: savings.overallSavingsMs ?? null,
        estimatedSavingsBytes: savings.overallSavingsBytes ?? null,
      });
    }
  }

  // Sort by savings descending
  opportunities.sort((a, b) => (b.estimatedSavingsMs ?? 0) - (a.estimatedSavingsMs ?? 0));
  return opportunities;
}

/** Compute percentile from a sorted numeric array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export async function runLighthouse(
  crawlResult: CrawlResult,
  userOptions?: Partial<LighthouseOptions>,
): Promise<LighthouseResult> {
  const opts: LighthouseOptions = { ...DEFAULT_OPTIONS, ...userOptions };
  const sampledUrls = sampleUrls(crawlResult, opts.sampleSize);

  if (sampledUrls.length === 0) {
    return {
      sampledUrls: [],
      pages: [],
      cwvSummary: {
        p50: { lcp: null, inp: null, cls: null },
        p95: { lcp: null, inp: null, cls: null },
      },
      topOffenders: [],
    };
  }

  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
  });

  const pageResults: LighthousePageResult[] = [];

  try {
    for (const url of sampledUrls) {
      try {
        const lhFlags = {
          port: chrome.port,
          output: "json" as const,
          logLevel: "error" as const,
          formFactor: opts.formFactor,
          screenEmulation: opts.formFactor === "desktop"
            ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
            : undefined,
          throttling: opts.formFactor === "desktop"
            ? { cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0, throughputKbps: 0, rttMs: 0 }
            : undefined,
          onlyCategories: ["performance"],
        };

        const result = await lighthouse(url, lhFlags);
        if (!result || !result.lhr) continue;

        const lhr = result.lhr as unknown as Record<string, unknown>;
        const categories = lhr["categories"] as Record<string, { score?: number | null }> | undefined;
        const perfScore = categories?.["performance"]?.score ?? null;

        pageResults.push({
          url,
          performanceScore: perfScore !== null ? Math.round(perfScore * 100) : null,
          cwv: extractCwv(lhr),
          opportunities: extractOpportunities(lhr),
        });
      } catch {
        // Skip pages that fail Lighthouse
        pageResults.push({
          url,
          performanceScore: null,
          cwv: { lcp: null, inp: null, cls: null },
          opportunities: [],
        });
      }
    }
  } finally {
    await chrome.kill();
  }

  // Compute p50 / p95 CWV
  const lcpValues = pageResults.map((p) => p.cwv.lcp).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const inpValues = pageResults.map((p) => p.cwv.inp).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const clsValues = pageResults.map((p) => p.cwv.cls).filter((v): v is number => v !== null).sort((a, b) => a - b);

  const cwvSummary = {
    p50: {
      lcp: lcpValues.length > 0 ? percentile(lcpValues, 50) : null,
      inp: inpValues.length > 0 ? percentile(inpValues, 50) : null,
      cls: clsValues.length > 0 ? percentile(clsValues, 50) : null,
    },
    p95: {
      lcp: lcpValues.length > 0 ? percentile(lcpValues, 95) : null,
      inp: inpValues.length > 0 ? percentile(inpValues, 95) : null,
      cls: clsValues.length > 0 ? percentile(clsValues, 95) : null,
    },
  };

  // Top offenders: pages with worst CWV
  const topOffenders: Array<{ url: string; metric: string; value: number }> = [];
  for (const page of pageResults) {
    if (page.cwv.lcp !== null && page.cwv.lcp > 2500) {
      topOffenders.push({ url: page.url, metric: "LCP", value: page.cwv.lcp });
    }
    if (page.cwv.cls !== null && page.cwv.cls > 0.1) {
      topOffenders.push({ url: page.url, metric: "CLS", value: page.cwv.cls });
    }
    if (page.cwv.inp !== null && page.cwv.inp > 200) {
      topOffenders.push({ url: page.url, metric: "INP", value: page.cwv.inp });
    }
  }
  topOffenders.sort((a, b) => b.value - a.value);

  return {
    sampledUrls,
    pages: pageResults,
    cwvSummary,
    topOffenders,
  };
}
