/**
 * Report generator module.
 *
 * Produces a JSON report and a self-contained HTML report with a ranked
 * fix list scored by Impact x Effort. Renders ALL analysis sections:
 * SEO, site-level, accessibility, crawl analysis, resources, content,
 * images, Lighthouse, and AI insights.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AuditReport,
  CrawlResult,
  FixEffort,
  FixImpact,
  IssueGroup,
  LighthouseResult,
  RankedFix,
  SeoResult,
  SiteLevelResult,
  AiInsights,
} from "./types.js";

// ── Impact x Effort scoring ─────────────────────────────────────────────────

const IMPACT_WEIGHT: Record<FixImpact, number> = { high: 3, medium: 2, low: 1 };
const EFFORT_WEIGHT: Record<FixEffort, number> = { low: 3, medium: 2, high: 1 };

export function score(impact: FixImpact, effort: FixEffort): number {
  return IMPACT_WEIGHT[impact] * EFFORT_WEIGHT[effort];
}

/** Build the ranked fix list from all analysis findings. */
export function buildRankedFixes(
  seo: SeoResult,
  lh: LighthouseResult | null,
  siteLevel?: SiteLevelResult | null,
  extras?: Array<IssueGroup | null | undefined>,
): RankedFix[] {
  const fixMap = new Map<string, RankedFix>();

  function addFix(key: string, fix: Omit<RankedFix, "rank" | "score">) {
    const existing = fixMap.get(key);
    if (existing) {
      for (const u of fix.affectedUrls) {
        if (!existing.affectedUrls.includes(u)) existing.affectedUrls.push(u);
      }
    } else {
      fixMap.set(key, {
        ...fix,
        rank: 0,
        score: score(fix.impact, fix.effort),
      });
    }
  }

  const ruleConfig: Record<string, { title: string; impact: FixImpact; effort: FixEffort; category: RankedFix["category"] }> = {
    "title-missing": { title: "Add missing page titles", impact: "high", effort: "low", category: "seo" },
    "title-too-short": { title: "Improve short page titles", impact: "medium", effort: "low", category: "seo" },
    "title-too-long": { title: "Shorten long page titles", impact: "low", effort: "low", category: "seo" },
    "meta-description-missing": { title: "Add meta descriptions", impact: "medium", effort: "low", category: "seo" },
    "meta-description-too-short": { title: "Expand short meta descriptions", impact: "low", effort: "low", category: "seo" },
    "meta-description-too-long": { title: "Trim long meta descriptions", impact: "low", effort: "low", category: "seo" },
    "h1-missing": { title: "Add missing H1 headings", impact: "high", effort: "low", category: "seo" },
    "h1-multiple": { title: "Reduce to a single H1 per page", impact: "medium", effort: "low", category: "seo" },
    "img-broken-src": { title: "Fix broken image sources", impact: "high", effort: "medium", category: "images" },
    "img-missing-alt": { title: "Add alt text to images", impact: "medium", effort: "low", category: "images" },
    "img-empty-alt": { title: "Review empty alt attributes", impact: "low", effort: "low", category: "images" },
    "canonical-missing": { title: "Add canonical link tags", impact: "medium", effort: "low", category: "seo" },
    "status-4xx": { title: "Fix 4xx client errors", impact: "high", effort: "medium", category: "seo" },
    "status-5xx": { title: "Fix 5xx server errors", impact: "high", effort: "high", category: "seo" },
    "og-title-missing": { title: "Add Open Graph title tags", impact: "low", effort: "low", category: "seo" },
    "og-description-missing": { title: "Add Open Graph description tags", impact: "low", effort: "low", category: "seo" },
    "og-image-missing": { title: "Add Open Graph image tags", impact: "medium", effort: "low", category: "seo" },
    "og-url-missing": { title: "Add Open Graph URL tags", impact: "low", effort: "low", category: "seo" },
    "viewport-missing": { title: "Add viewport meta tag", impact: "high", effort: "low", category: "seo" },
    "html-lang-missing": { title: "Add lang attribute to <html>", impact: "medium", effort: "low", category: "accessibility" },
    "structured-data-missing": { title: "Add JSON-LD structured data", impact: "medium", effort: "medium", category: "seo" },
    "robots-txt-missing": { title: "Add robots.txt", impact: "medium", effort: "low", category: "seo" },
    "robots-txt-disallow-all": { title: "Fix robots.txt blocking all crawlers", impact: "high", effort: "low", category: "seo" },
    "sitemap-xml-missing": { title: "Add sitemap.xml", impact: "medium", effort: "low", category: "seo" },
    "sitemap-xml-invalid": { title: "Fix invalid sitemap.xml", impact: "medium", effort: "low", category: "seo" },
    "heading-hierarchy-skip": { title: "Fix heading hierarchy (skipped levels)", impact: "medium", effort: "low", category: "accessibility" },
    "thin-content": { title: "Add more content to thin pages", impact: "medium", effort: "high", category: "seo" },
    "meta-robots-noindex": { title: "Remove accidental noindex directives", impact: "high", effort: "low", category: "seo" },
    "twitter-card-missing": { title: "Add Twitter Card meta tags", impact: "low", effort: "low", category: "seo" },
    "twitter-image-missing": { title: "Add Twitter Card image tags", impact: "low", effort: "low", category: "seo" },
    "mixed-content": { title: "Fix mixed HTTP/HTTPS content", impact: "high", effort: "medium", category: "seo" },
    "redirect-chain-long": { title: "Shorten redirect chains (>2 hops)", impact: "medium", effort: "medium", category: "seo" },
    "duplicate-title": { title: "Fix duplicate page titles", impact: "medium", effort: "low", category: "seo" },
    "duplicate-meta-description": { title: "Fix duplicate meta descriptions", impact: "medium", effort: "low", category: "seo" },
    "security-hsts-missing": { title: "Add Strict-Transport-Security header", impact: "medium", effort: "low", category: "security" },
    "security-csp-missing": { title: "Add Content-Security-Policy header", impact: "medium", effort: "medium", category: "security" },
    "security-x-frame-missing": { title: "Add X-Frame-Options header", impact: "medium", effort: "low", category: "security" },
    "security-x-content-type-missing": { title: "Add X-Content-Type-Options header", impact: "low", effort: "low", category: "security" },
    "external-link-broken": { title: "Fix broken external links", impact: "medium", effort: "medium", category: "seo" },
    "a11y-form-label-missing": { title: "Add labels to form fields", impact: "medium", effort: "low", category: "accessibility" },
    "a11y-landmark-main-missing": { title: "Add <main> landmark element", impact: "medium", effort: "low", category: "accessibility" },
    "a11y-landmark-nav-missing": { title: "Add <nav> landmark element", impact: "low", effort: "low", category: "accessibility" },
    "a11y-skip-nav-missing": { title: "Add skip navigation link", impact: "low", effort: "low", category: "accessibility" },
    "a11y-tabindex-positive": { title: "Remove positive tabindex values", impact: "medium", effort: "low", category: "accessibility" },
    "link-depth-deep": { title: "Reduce page click depth (>3 clicks)", impact: "medium", effort: "medium", category: "seo" },
    "crawl-budget-parameterized": { title: "Reduce parameterized URL variants", impact: "medium", effort: "medium", category: "seo" },
    "resource-render-blocking": { title: "Defer render-blocking scripts", impact: "high", effort: "medium", category: "performance" },
    "resource-excessive": { title: "Reduce external resource count", impact: "medium", effort: "medium", category: "performance" },
    "resource-third-party-heavy": { title: "Reduce third-party dependencies", impact: "medium", effort: "high", category: "performance" },
    "content-near-duplicate": { title: "Consolidate near-duplicate pages", impact: "medium", effort: "high", category: "content" },
    "img-format-not-optimal": { title: "Convert images to WebP/AVIF", impact: "medium", effort: "medium", category: "images" },
    "img-file-too-large": { title: "Compress oversized images", impact: "high", effort: "medium", category: "images" },
  };

  for (const page of seo.pages) {
    for (const issue of page.issues) {
      const cfg = ruleConfig[issue.rule];
      if (cfg) {
        addFix(issue.rule, { title: cfg.title, description: issue.message, impact: cfg.impact, effort: cfg.effort, affectedUrls: [issue.url], category: cfg.category });
      }
    }
  }

  if (siteLevel) {
    for (const issue of siteLevel.issues) {
      const cfg = ruleConfig[issue.rule];
      if (cfg) {
        addFix(issue.rule, { title: cfg.title, description: issue.message, impact: cfg.impact, effort: cfg.effort, affectedUrls: [issue.url], category: cfg.category });
      }
    }
  }

  if (extras) {
    for (const group of extras) {
      if (!group) continue;
      for (const issue of group.issues) {
        const cfg = ruleConfig[issue.rule];
        if (cfg) {
          addFix(issue.rule, { title: cfg.title, description: issue.message, impact: cfg.impact, effort: cfg.effort, affectedUrls: [issue.url], category: cfg.category });
        }
      }
    }
  }

  if (lh) {
    for (const page of lh.pages) {
      for (const opp of page.opportunities) {
        const savingsMs = opp.estimatedSavingsMs ?? 0;
        const impact: FixImpact = savingsMs > 1000 ? "high" : savingsMs > 300 ? "medium" : "low";
        addFix(`lh-${opp.title}`, { title: opp.title, description: opp.description, impact, effort: "medium", affectedUrls: [page.url], category: "performance" });
      }
    }
    for (const offender of lh.topOffenders) {
      addFix(`cwv-${offender.metric}`, {
        title: `Improve ${offender.metric} score`,
        description: `${offender.metric} value of ${offender.value.toFixed(offender.metric === "CLS" ? 3 : 0)} exceeds threshold.`,
        impact: "high", effort: "high", affectedUrls: [offender.url], category: "performance",
      });
    }
  }

  const fixes = [...fixMap.values()].sort((a, b) => b.score - a.score);
  fixes.forEach((f, i) => (f.rank = i + 1));
  return fixes;
}

// ── JSON Report ──────────────────────────────────────────────────────────────

export interface ReportInputs {
  crawlResult: CrawlResult;
  seo: SeoResult;
  lh: LighthouseResult | null;
  siteLevel?: SiteLevelResult | null;
  externalLinks?: IssueGroup & { checked: number; broken: number } | null;
  accessibility?: IssueGroup | null;
  crawlAnalysis?: IssueGroup | null;
  resources?: IssueGroup | null;
  contentAnalysis?: IssueGroup | null;
  imageOptimization?: IssueGroup | null;
  ai?: AiInsights | null;
}

export function buildJsonReport(inputs: ReportInputs): AuditReport {
  const { crawlResult, seo, lh, siteLevel } = inputs;

  const statusCodeDist: Record<number, number> = {};
  const redirectChains: Array<{ from: string; chain: string[] }> = [];
  const ttfbs: number[] = [];
  const responseTimes: number[] = [];

  for (const [url, node] of crawlResult.pages) {
    const code = node.statusCode;
    statusCodeDist[code] = (statusCodeDist[code] ?? 0) + 1;
    if (node.redirectChain.length > 0) {
      redirectChains.push({ from: url, chain: node.redirectChain });
    }
    if (node.ttfb !== undefined && node.ttfb > 0) ttfbs.push(node.ttfb);
    if (node.responseTime !== undefined && node.responseTime > 0) responseTimes.push(node.responseTime);
  }

  const avgTtfb = ttfbs.length > 0 ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : undefined;
  const avgResponseTime = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : undefined;

  const extras = [
    inputs.externalLinks,
    inputs.accessibility,
    inputs.crawlAnalysis,
    inputs.resources,
    inputs.contentAnalysis,
    inputs.imageOptimization,
  ];

  return {
    generatedAt: new Date().toISOString(),
    startUrl: crawlResult.startUrl,
    crawl: {
      totalPages: crawlResult.pages.size,
      orphanPages: crawlResult.orphanPages,
      elapsedMs: crawlResult.elapsedMs,
      statusCodeDistribution: statusCodeDist,
      redirectChains,
      avgTtfb,
      avgResponseTime,
    },
    seo,
    ...(siteLevel ? { siteLevel } : {}),
    ...(inputs.externalLinks ? { externalLinks: inputs.externalLinks } : {}),
    ...(inputs.accessibility ? { accessibility: inputs.accessibility } : {}),
    ...(inputs.crawlAnalysis ? { crawlAnalysis: inputs.crawlAnalysis } : {}),
    ...(inputs.resources ? { resources: inputs.resources } : {}),
    ...(inputs.contentAnalysis ? { contentAnalysis: inputs.contentAnalysis } : {}),
    ...(inputs.imageOptimization ? { imageOptimization: inputs.imageOptimization } : {}),
    lighthouse: lh,
    rankedFixes: buildRankedFixes(seo, lh, siteLevel, extras),
    ...(inputs.ai ? { ai: inputs.ai } : {}),
  };
}

// ── HTML Report ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderIssueList(issues: Array<{ severity: string; rule: string; message: string; url: string }>): string {
  if (issues.length === 0) return "<p>No issues found.</p>";
  const severityBadge = (sev: string) => {
    const colors: Record<string, string> = { error: "#dc3545", warning: "#ffc107", info: "#17a2b8" };
    const bg = colors[sev] ?? "#6c757d";
    const fg = sev === "warning" ? "#000" : "#fff";
    return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:600;">${sev.toUpperCase()}</span>`;
  };

  // Group by URL
  const byUrl = new Map<string, typeof issues>();
  for (const issue of issues) {
    const list = byUrl.get(issue.url) ?? [];
    list.push(issue);
    byUrl.set(issue.url, list);
  }

  let html = "";
  for (const [url, urlIssues] of byUrl) {
    html += `<h4>${escapeHtml(url)}</h4><ul>`;
    for (const issue of urlIssues) {
      html += `<li>${severityBadge(issue.severity)} <strong>${escapeHtml(issue.rule)}</strong>: ${escapeHtml(issue.message)}</li>`;
    }
    html += `</ul>`;
  }
  return html;
}

export function generateHtml(report: AuditReport): string {
  const severityBadge = (sev: string) => {
    const colors: Record<string, string> = { error: "#dc3545", warning: "#ffc107", info: "#17a2b8" };
    const bg = colors[sev] ?? "#6c757d";
    const fg = sev === "warning" ? "#000" : "#fff";
    return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:4px;font-size:0.8em;font-weight:600;">${sev.toUpperCase()}</span>`;
  };

  const impactBadge = (impact: string) => {
    const colors: Record<string, string> = { high: "#dc3545", medium: "#ffc107", low: "#28a745" };
    const bg = colors[impact] ?? "#6c757d";
    const fg = impact === "medium" ? "#000" : "#fff";
    return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:4px;font-size:0.8em;">${impact}</span>`;
  };

  // AI Executive Summary
  let aiHtml = "";
  if (report.ai) {
    aiHtml = `<h2>AI Analysis</h2>`;
    if (report.ai.executiveSummary) {
      aiHtml += `<div class="card" style="padding:1.5rem;margin-bottom:1.5rem;white-space:pre-wrap;">${escapeHtml(report.ai.executiveSummary)}</div>`;
    }
    if (report.ai.pageInsights && report.ai.pageInsights.length > 0) {
      aiHtml += `<h3>Page Insights</h3>`;
      for (const insight of report.ai.pageInsights) {
        aiHtml += `<div class="card" style="margin-bottom:1rem;padding:1rem;">
          <h4 style="margin-bottom:0.5rem;">${escapeHtml(insight.url)}</h4>
          <p><strong>Quality:</strong> ${escapeHtml(insight.contentQuality)}</p>
          <ul>${insight.seoRecommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
        </div>`;
      }
    }
    if (report.ai.fixInstructions && report.ai.fixInstructions.length > 0) {
      aiHtml += `<h3>Detailed Fix Instructions</h3>`;
      for (const fix of report.ai.fixInstructions) {
        aiHtml += `<div class="card" style="margin-bottom:1rem;padding:1rem;">
          <h4 style="margin-bottom:0.5rem;">${escapeHtml(fix.title)}</h4>
          <div style="white-space:pre-wrap;">${escapeHtml(fix.detailedSteps)}</div>
        </div>`;
      }
    }
  }

  // Ranked fixes table
  let fixesHtml = "";
  for (const fix of report.rankedFixes) {
    fixesHtml += `
      <tr>
        <td>${fix.rank}</td>
        <td>${escapeHtml(fix.title)}</td>
        <td>${impactBadge(fix.impact)}</td>
        <td>${fix.effort}</td>
        <td>${fix.score}</td>
        <td>${fix.affectedUrls.length}</td>
        <td>${fix.category}</td>
      </tr>`;
  }

  // SEO issues list
  let seoIssuesHtml = "";
  for (const page of report.seo.pages) {
    if (page.issues.length === 0) continue;
    seoIssuesHtml += `<h4>${escapeHtml(page.url)}</h4><ul>`;
    for (const issue of page.issues) {
      seoIssuesHtml += `<li>${severityBadge(issue.severity)} <strong>${escapeHtml(issue.rule)}</strong>: ${escapeHtml(issue.message)}</li>`;
    }
    seoIssuesHtml += `</ul>`;
  }

  // Site-level section
  let siteLevelHtml = "";
  if (report.siteLevel && report.siteLevel.issues.length > 0) {
    siteLevelHtml = renderIssueList(report.siteLevel.issues);
  } else {
    siteLevelHtml = "<p>No site-level issues found.</p>";
  }

  // Accessibility section
  let a11yHtml = "<p>No accessibility issues found.</p>";
  if (report.accessibility && report.accessibility.issues.length > 0) {
    a11yHtml = renderIssueList(report.accessibility.issues);
  }

  // Crawl analysis section
  let crawlAnalysisHtml = "<p>No crawl issues found.</p>";
  if (report.crawlAnalysis && report.crawlAnalysis.issues.length > 0) {
    crawlAnalysisHtml = renderIssueList(report.crawlAnalysis.issues);
  }

  // Resource analysis section
  let resourceHtml = "<p>No resource issues found.</p>";
  if (report.resources && report.resources.issues.length > 0) {
    resourceHtml = renderIssueList(report.resources.issues);
  }

  // Content analysis section
  let contentHtml = "<p>No content issues found.</p>";
  if (report.contentAnalysis && report.contentAnalysis.issues.length > 0) {
    contentHtml = renderIssueList(report.contentAnalysis.issues);
  }

  // Image optimization section
  let imageHtml = "<p>No image issues found.</p>";
  if (report.imageOptimization && report.imageOptimization.issues.length > 0) {
    imageHtml = renderIssueList(report.imageOptimization.issues);
  }

  // External links section — group by broken URL rather than by source page
  let extLinksHtml = "<p>External link check was not run.</p>";
  if (report.externalLinks) {
    const el = report.externalLinks;
    extLinksHtml = `<p>Checked ${el.checked} external links. <strong>${el.broken} broken.</strong></p>`;
    if (el.issues.length > 0) {
      // Group issues by the broken external URL (extract from message)
      const byBrokenUrl = new Map<string, string[]>();
      for (const issue of el.issues) {
        const match = issue.message.match(/External link to (\S+)/);
        const brokenUrl = match ? match[1] : issue.message;
        const sources = byBrokenUrl.get(brokenUrl) ?? [];
        sources.push(issue.url);
        byBrokenUrl.set(brokenUrl, sources);
      }
      extLinksHtml += `<table><tr><th>Broken URL</th><th>Status</th><th>Found On</th></tr>`;
      for (const [brokenUrl, sources] of byBrokenUrl) {
        const issue = el.issues.find((i) => i.message.includes(brokenUrl));
        const statusMatch = issue?.message.match(/returned (.+)\.$/);
        const status = statusMatch ? statusMatch[1] : "error";
        const uniqueSources = [...new Set(sources)];
        extLinksHtml += `<tr>
          <td style="word-break:break-all;">${escapeHtml(brokenUrl)}</td>
          <td>${escapeHtml(status)}</td>
          <td>${uniqueSources.length} page${uniqueSources.length === 1 ? "" : "s"}</td>
        </tr>`;
      }
      extLinksHtml += `</table>`;
    }
  }

  // Lighthouse section
  let lighthouseHtml = "<p>Lighthouse audit was not run.</p>";
  if (report.lighthouse && report.lighthouse.pages.length > 0) {
    const lh = report.lighthouse;
    lighthouseHtml = `
      <h3>Core Web Vitals Summary</h3>
      <table>
        <tr><th>Metric</th><th>p50</th><th>p95</th></tr>
        <tr><td>LCP (ms)</td><td>${lh.cwvSummary.p50.lcp?.toFixed(0) ?? "N/A"}</td><td>${lh.cwvSummary.p95.lcp?.toFixed(0) ?? "N/A"}</td></tr>
        <tr><td>INP (ms)</td><td>${lh.cwvSummary.p50.inp?.toFixed(0) ?? "N/A"}</td><td>${lh.cwvSummary.p95.inp?.toFixed(0) ?? "N/A"}</td></tr>
        <tr><td>CLS</td><td>${lh.cwvSummary.p50.cls?.toFixed(3) ?? "N/A"}</td><td>${lh.cwvSummary.p95.cls?.toFixed(3) ?? "N/A"}</td></tr>
      </table>
      <h3>Page Scores</h3>
      <table>
        <tr><th>URL</th><th>Perf Score</th><th>LCP</th><th>CLS</th><th>Opportunities</th></tr>
        ${lh.pages
          .map(
            (p) => `<tr>
              <td>${escapeHtml(p.url)}</td>
              <td>${p.performanceScore ?? "N/A"}</td>
              <td>${p.cwv.lcp?.toFixed(0) ?? "N/A"} ms</td>
              <td>${p.cwv.cls?.toFixed(3) ?? "N/A"}</td>
              <td>${p.opportunities.length}</td>
            </tr>`,
          )
          .join("")}
      </table>`;

    if (lh.topOffenders.length > 0) {
      lighthouseHtml += `
        <h3>Top Offenders</h3>
        <table>
          <tr><th>URL</th><th>Metric</th><th>Value</th></tr>
          ${lh.topOffenders
            .map(
              (o) =>
                `<tr><td>${escapeHtml(o.url)}</td><td>${o.metric}</td><td>${o.value.toFixed(o.metric === "CLS" ? 3 : 0)}</td></tr>`,
            )
            .join("")}
        </table>`;
    }
  }

  // Status code distribution
  const statusCodes = Object.entries(report.crawl.statusCodeDistribution)
    .map(([code, count]) => `<tr><td>${code}</td><td>${count}</td></tr>`)
    .join("");

  // TTFB / Response time cards
  const ttfbCard = report.crawl.avgTtfb
    ? `<div class="card"><div class="label">Avg TTFB</div><div class="value">${report.crawl.avgTtfb}ms</div></div>`
    : "";
  const rtCard = report.crawl.avgResponseTime
    ? `<div class="card"><div class="label">Avg Response</div><div class="value">${report.crawl.avgResponseTime}ms</div></div>`
    : "";

  // Count all issues across all sections for the summary
  const totalIssues =
    report.seo.summary.error + report.seo.summary.warning + report.seo.summary.info +
    (report.siteLevel?.issues.length ?? 0) +
    (report.externalLinks?.issues.length ?? 0) +
    (report.accessibility?.issues.length ?? 0) +
    (report.crawlAnalysis?.issues.length ?? 0) +
    (report.resources?.issues.length ?? 0) +
    (report.contentAnalysis?.issues.length ?? 0) +
    (report.imageOptimization?.issues.length ?? 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Site Audit Report - ${escapeHtml(report.startUrl)}</title>
  <style>
    :root { --bg: #f8f9fa; --card: #fff; --border: #dee2e6; --text: #212529; --muted: #6c757d; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; padding: 2rem; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.8rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.4rem; margin: 2rem 0 1rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; }
    h3 { font-size: 1.15rem; margin: 1.5rem 0 0.75rem; }
    h4 { font-size: 1rem; margin: 1rem 0 0.5rem; color: var(--muted); word-break: break-all; }
    .meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 2rem; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; }
    .card .label { font-size: 0.85rem; color: var(--muted); }
    .card .value { font-size: 1.5rem; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; background: var(--card); border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); }
    th { background: #e9ecef; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:last-child td { border-bottom: none; }
    ul { margin: 0.5rem 0 1rem 1.5rem; }
    li { margin: 0.35rem 0; }
    .toc { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.5rem; margin: 1rem 0 2rem; }
    .toc a { color: #0366d6; text-decoration: none; }
    .toc a:hover { text-decoration: underline; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; text-align: center; }
  </style>
</head>
<body>
  <h1>Site Audit Report</h1>
  <p class="meta">${escapeHtml(report.startUrl)} &mdash; Generated ${report.generatedAt}</p>

  <div class="toc">
    <strong>Contents:</strong>
    ${report.ai ? '<a href="#ai">AI Analysis</a> | ' : ""}
    <a href="#summary">Summary</a> |
    <a href="#fixes">Ranked Fixes</a> |
    <a href="#seo">SEO Issues</a> |
    <a href="#site-level">Site-Level</a> |
    <a href="#a11y">Accessibility</a> |
    <a href="#ext-links">External Links</a> |
    <a href="#crawl-analysis">Crawl Analysis</a> |
    <a href="#resources">Resources</a> |
    <a href="#content">Content</a> |
    <a href="#images">Images</a> |
    <a href="#lighthouse">Lighthouse</a>
  </div>

  ${aiHtml}

  <h2 id="summary">Crawl Summary</h2>
  <div class="summary-grid">
    <div class="card"><div class="label">Pages Crawled</div><div class="value">${report.crawl.totalPages}</div></div>
    <div class="card"><div class="label">Orphan Pages</div><div class="value">${report.crawl.orphanPages.length}</div></div>
    <div class="card"><div class="label">Crawl Time</div><div class="value">${(report.crawl.elapsedMs / 1000).toFixed(1)}s</div></div>
    <div class="card"><div class="label">Total Issues</div><div class="value">${totalIssues}</div></div>
    <div class="card"><div class="label">SEO Errors</div><div class="value" style="color:#dc3545">${report.seo.summary.error}</div></div>
    <div class="card"><div class="label">SEO Warnings</div><div class="value" style="color:#ffc107">${report.seo.summary.warning}</div></div>
    ${ttfbCard}
    ${rtCard}
  </div>

  <h3>Status Codes</h3>
  <table><tr><th>Code</th><th>Count</th></tr>${statusCodes}</table>

  <h2 id="fixes">Ranked Fix List (Impact x Effort)</h2>
  <table>
    <tr><th>#</th><th>Fix</th><th>Impact</th><th>Effort</th><th>Score</th><th>Pages</th><th>Category</th></tr>
    ${fixesHtml}
  </table>

  <h2 id="seo">SEO Issues</h2>
  ${seoIssuesHtml || "<p>No SEO issues found.</p>"}

  <h2 id="site-level">Site-Level Checks</h2>
  ${siteLevelHtml}

  <h2 id="a11y">Accessibility</h2>
  ${a11yHtml}

  <h2 id="ext-links">External Links</h2>
  ${extLinksHtml}

  <h2 id="crawl-analysis">Crawl Analysis</h2>
  ${crawlAnalysisHtml}

  <h2 id="resources">Resource Analysis</h2>
  ${resourceHtml}

  <h2 id="content">Content Analysis</h2>
  ${contentHtml}

  <h2 id="images">Image Optimization</h2>
  ${imageHtml}

  <h2 id="lighthouse">Lighthouse Performance</h2>
  ${lighthouseHtml}

  <footer>Generated by site-audit v1.0.0</footer>
</body>
</html>`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateReport(
  inputs: ReportInputs,
  outputDir: string,
): Promise<{ jsonPath: string; htmlPath: string; report: AuditReport }> {
  const report = buildJsonReport(inputs);
  const html = generateHtml(report);

  const jsonPath = path.join(outputDir, "report.json");
  const htmlPath = path.join(outputDir, "report.html");

  // Strip HTML from pages in JSON to keep file size reasonable
  const jsonReport = {
    ...report,
    seo: {
      ...report.seo,
      pages: report.seo.pages.map((p) => ({ ...p })),
    },
  };

  await writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), "utf-8");
  await writeFile(htmlPath, html, "utf-8");

  return { jsonPath, htmlPath, report };
}

export async function generateHtmlFromJson(
  jsonPath: string,
  outputDir: string,
): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(jsonPath, "utf-8");
  const report = JSON.parse(raw) as AuditReport;
  const html = generateHtml(report);
  const htmlPath = path.join(outputDir, "report.html");
  await writeFile(htmlPath, html, "utf-8");
  return htmlPath;
}
