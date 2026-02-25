/**
 * Core types for site-audit.
 */

// ── Crawler ──────────────────────────────────────────────────────────────────

export interface CrawlOptions {
  /** Maximum link-follow depth from the start URL. */
  maxDepth: number;
  /** Maximum number of pages to crawl. */
  maxPages: number;
  /** Use Playwright (rendered) or plain HTTP (html) fetch mode. */
  mode: "rendered" | "html";
  /** Concurrency limit for simultaneous page fetches. */
  concurrency: number;
  /** Request timeout in milliseconds. */
  timeout: number;
  /** Respect robots.txt (best-effort). */
  respectRobotsTxt: boolean;
}

export interface PageNode {
  url: string;
  /** Final status code (after redirects). */
  statusCode: number;
  /** Redirect chain URLs (empty if no redirects). */
  redirectChain: string[];
  /** Depth at which the page was discovered. */
  depth: number;
  /** URLs of pages that link to this page. */
  incomingLinks: string[];
  /** URLs this page links to (internal only). */
  outgoingLinks: string[];
  /** Raw HTML content (truncated for storage if needed). */
  html: string;
  /** Error message if the page could not be fetched. */
  error?: string;
}

export interface CrawlResult {
  startUrl: string;
  pages: Map<string, PageNode>;
  /** Pages with zero incoming internal links. */
  orphanPages: string[];
  /** Total time in ms. */
  elapsedMs: number;
}

// ── SEO Checker ──────────────────────────────────────────────────────────────

export type SeoSeverity = "error" | "warning" | "info";

export interface SeoIssue {
  rule: string;
  severity: SeoSeverity;
  message: string;
  url: string;
  /** Optional CSS selector or element description for context. */
  element?: string;
}

export interface SeoPageResult {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  canonicalUrl: string | null;
  issues: SeoIssue[];
}

export interface SeoResult {
  pages: SeoPageResult[];
  /** Aggregated issue counts by severity. */
  summary: Record<SeoSeverity, number>;
}

// ── Lighthouse Runner ────────────────────────────────────────────────────────

export interface LighthouseOptions {
  /** Maximum number of pages to sample for Lighthouse. */
  sampleSize: number;
  /** Lighthouse form factor. */
  formFactor: "mobile" | "desktop";
}

export interface CoreWebVitals {
  /** Largest Contentful Paint in ms. */
  lcp: number | null;
  /** Interaction to Next Paint in ms (replaces FID). */
  inp: number | null;
  /** Cumulative Layout Shift (unitless). */
  cls: number | null;
}

export interface LighthousePageResult {
  url: string;
  performanceScore: number | null;
  cwv: CoreWebVitals;
  opportunities: LighthouseOpportunity[];
}

export interface LighthouseOpportunity {
  title: string;
  description: string;
  /** Estimated savings in ms. */
  estimatedSavingsMs: number | null;
  /** Estimated savings in bytes. */
  estimatedSavingsBytes: number | null;
}

export interface LighthouseResult {
  sampledUrls: string[];
  pages: LighthousePageResult[];
  /** p50 / p95 aggregates across sampled pages. */
  cwvSummary: {
    p50: CoreWebVitals;
    p95: CoreWebVitals;
  };
  topOffenders: Array<{ url: string; metric: string; value: number }>;
}

// ── Report ───────────────────────────────────────────────────────────────────

export type FixEffort = "low" | "medium" | "high";
export type FixImpact = "low" | "medium" | "high";

export interface RankedFix {
  rank: number;
  title: string;
  description: string;
  impact: FixImpact;
  effort: FixEffort;
  /** impact * effort score (higher = fix first). */
  score: number;
  affectedUrls: string[];
  category: "seo" | "performance" | "accessibility" | "images";
}

export interface SiteLevelResult {
  issues: SeoIssue[];
}

export interface AuditReport {
  /** ISO-8601 timestamp. */
  generatedAt: string;
  startUrl: string;
  crawl: {
    totalPages: number;
    orphanPages: string[];
    elapsedMs: number;
    statusCodeDistribution: Record<number, number>;
    redirectChains: Array<{ from: string; chain: string[] }>;
  };
  seo: SeoResult;
  /** Site-level checks (robots.txt, sitemap.xml). */
  siteLevel?: SiteLevelResult;
  lighthouse: LighthouseResult | null;
  rankedFixes: RankedFix[];
}
