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
  /** Respect robots.txt directives. */
  respectRobotsTxt: boolean;
  /** Custom User-Agent string. */
  userAgent?: string;
  /** URL patterns to include (glob-like). */
  include?: string[];
  /** URL patterns to exclude (glob-like). */
  exclude?: string[];
  /** Number of retries on transient failures (timeout, 5xx). */
  retries: number;
  /** Cookie string to send with requests (e.g. "session=abc123"). */
  cookie?: string;
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
  /** Time to first byte in ms. */
  ttfb?: number;
  /** Total response time in ms. */
  responseTime?: number;
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
  category: "seo" | "performance" | "accessibility" | "images" | "security" | "content";
}

export interface SiteLevelResult {
  issues: SeoIssue[];
}

export interface IssueGroup {
  issues: SeoIssue[];
}

export interface AiInsights {
  /** Executive summary of the entire audit. */
  executiveSummary: string;
  /** Per-page content quality & SEO recommendations. */
  pageInsights: Array<{
    url: string;
    contentQuality: string;
    seoRecommendations: string[];
  }>;
  /** Detailed, actionable fix instructions for top issues. */
  fixInstructions: Array<{
    rule: string;
    title: string;
    detailedSteps: string;
  }>;
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
    /** Average TTFB across crawled pages. */
    avgTtfb?: number;
    /** Average response time across crawled pages. */
    avgResponseTime?: number;
  };
  seo: SeoResult;
  /** Site-level checks (robots.txt, sitemap.xml, security headers). */
  siteLevel?: SiteLevelResult;
  /** External link check results. */
  externalLinks?: IssueGroup & { checked: number; broken: number };
  /** Accessibility check results. */
  accessibility?: IssueGroup;
  /** Crawl analysis (depth, crawl budget). */
  crawlAnalysis?: IssueGroup;
  /** Resource analysis (scripts, stylesheets). */
  resources?: IssueGroup;
  /** Content analysis (near-duplicate detection). */
  contentAnalysis?: IssueGroup;
  /** Image optimization results. */
  imageOptimization?: IssueGroup;
  lighthouse: LighthouseResult | null;
  rankedFixes: RankedFix[];
  /** AI-generated insights (requires ANTHROPIC_API_KEY). */
  ai?: AiInsights;
}
