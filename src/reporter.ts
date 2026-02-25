/**
 * Report generator module.
 *
 * Produces a JSON report and a self-contained HTML report with a ranked
 * fix list scored by Impact x Effort.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AuditReport,
  CrawlResult,
  FixEffort,
  FixImpact,
  LighthouseResult,
  RankedFix,
  SeoResult,
  SiteLevelResult,
} from "./types.js";

// ── Impact x Effort scoring ─────────────────────────────────────────────────

const IMPACT_WEIGHT: Record<FixImpact, number> = { high: 3, medium: 2, low: 1 };
const EFFORT_WEIGHT: Record<FixEffort, number> = { low: 3, medium: 2, high: 1 };

export function score(impact: FixImpact, effort: FixEffort): number {
  return IMPACT_WEIGHT[impact] * EFFORT_WEIGHT[effort];
}

/** Build the ranked fix list from SEO + site-level + Lighthouse findings. */
export function buildRankedFixes(seo: SeoResult, lh: LighthouseResult | null, siteLevel?: SiteLevelResult | null): RankedFix[] {
  const fixMap = new Map<string, RankedFix>();

  // Helper to add/merge a fix
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

  // SEO-derived fixes
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
  };

  for (const page of seo.pages) {
    for (const issue of page.issues) {
      const cfg = ruleConfig[issue.rule];
      if (cfg) {
        addFix(issue.rule, {
          title: cfg.title,
          description: issue.message,
          impact: cfg.impact,
          effort: cfg.effort,
          affectedUrls: [issue.url],
          category: cfg.category,
        });
      }
    }
  }

  // Site-level fixes (robots.txt, sitemap.xml)
  if (siteLevel) {
    for (const issue of siteLevel.issues) {
      const cfg = ruleConfig[issue.rule];
      if (cfg) {
        addFix(issue.rule, {
          title: cfg.title,
          description: issue.message,
          impact: cfg.impact,
          effort: cfg.effort,
          affectedUrls: [issue.url],
          category: cfg.category,
        });
      }
    }
  }

  // Lighthouse-derived fixes
  if (lh) {
    for (const page of lh.pages) {
      for (const opp of page.opportunities) {
        const savingsMs = opp.estimatedSavingsMs ?? 0;
        const impact: FixImpact = savingsMs > 1000 ? "high" : savingsMs > 300 ? "medium" : "low";
        addFix(`lh-${opp.title}`, {
          title: opp.title,
          description: opp.description,
          impact,
          effort: "medium",
          affectedUrls: [page.url],
          category: "performance",
        });
      }
    }

    // CWV offenders
    for (const offender of lh.topOffenders) {
      addFix(`cwv-${offender.metric}`, {
        title: `Improve ${offender.metric} score`,
        description: `${offender.metric} value of ${offender.value.toFixed(offender.metric === "CLS" ? 3 : 0)} exceeds threshold.`,
        impact: "high",
        effort: "high",
        affectedUrls: [offender.url],
        category: "performance",
      });
    }
  }

  // Sort by score descending, then assign ranks
  const fixes = [...fixMap.values()].sort((a, b) => b.score - a.score);
  fixes.forEach((f, i) => (f.rank = i + 1));
  return fixes;
}

// ── JSON Report ──────────────────────────────────────────────────────────────

export function buildJsonReport(
  crawlResult: CrawlResult,
  seo: SeoResult,
  lh: LighthouseResult | null,
  siteLevel?: SiteLevelResult | null,
): AuditReport {
  // Status code distribution
  const statusCodeDist: Record<number, number> = {};
  const redirectChains: Array<{ from: string; chain: string[] }> = [];

  for (const [url, node] of crawlResult.pages) {
    const code = node.statusCode;
    statusCodeDist[code] = (statusCodeDist[code] ?? 0) + 1;
    if (node.redirectChain.length > 0) {
      redirectChains.push({ from: url, chain: node.redirectChain });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    startUrl: crawlResult.startUrl,
    crawl: {
      totalPages: crawlResult.pages.size,
      orphanPages: crawlResult.orphanPages,
      elapsedMs: crawlResult.elapsedMs,
      statusCodeDistribution: statusCodeDist,
      redirectChains,
    },
    seo,
    ...(siteLevel ? { siteLevel } : {}),
    lighthouse: lh,
    rankedFixes: buildRankedFixes(seo, lh, siteLevel),
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
    siteLevelHtml = `<ul>`;
    for (const issue of report.siteLevel.issues) {
      siteLevelHtml += `<li>${severityBadge(issue.severity)} <strong>${escapeHtml(issue.rule)}</strong>: ${escapeHtml(issue.message)}</li>`;
    }
    siteLevelHtml += `</ul>`;
  } else {
    siteLevelHtml = "<p>No site-level issues found.</p>";
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
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; }
    .card .label { font-size: 0.85rem; color: var(--muted); }
    .card .value { font-size: 1.5rem; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; background: var(--card); border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); }
    th { background: #e9ecef; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:last-child td { border-bottom: none; }
    ul { margin: 0.5rem 0 1rem 1.5rem; }
    li { margin: 0.35rem 0; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; text-align: center; }
  </style>
</head>
<body>
  <h1>Site Audit Report</h1>
  <p class="meta">${escapeHtml(report.startUrl)} &mdash; Generated ${report.generatedAt}</p>

  <h2>Crawl Summary</h2>
  <div class="summary-grid">
    <div class="card"><div class="label">Pages Crawled</div><div class="value">${report.crawl.totalPages}</div></div>
    <div class="card"><div class="label">Orphan Pages</div><div class="value">${report.crawl.orphanPages.length}</div></div>
    <div class="card"><div class="label">Crawl Time</div><div class="value">${(report.crawl.elapsedMs / 1000).toFixed(1)}s</div></div>
    <div class="card"><div class="label">SEO Errors</div><div class="value" style="color:#dc3545">${report.seo.summary.error}</div></div>
    <div class="card"><div class="label">SEO Warnings</div><div class="value" style="color:#ffc107">${report.seo.summary.warning}</div></div>
  </div>

  <h3>Status Codes</h3>
  <table><tr><th>Code</th><th>Count</th></tr>${statusCodes}</table>

  <h2>Ranked Fix List (Impact x Effort)</h2>
  <table>
    <tr><th>#</th><th>Fix</th><th>Impact</th><th>Effort</th><th>Score</th><th>Pages</th><th>Category</th></tr>
    ${fixesHtml}
  </table>

  <h2>SEO Issues</h2>
  ${seoIssuesHtml || "<p>No SEO issues found.</p>"}

  <h2>Site-Level Checks</h2>
  ${siteLevelHtml}

  <h2>Lighthouse Performance</h2>
  ${lighthouseHtml}

  <footer>Generated by site-audit v1.0.0</footer>
</body>
</html>`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateReport(
  crawlResult: CrawlResult,
  seo: SeoResult,
  lh: LighthouseResult | null,
  outputDir: string,
  siteLevel?: SiteLevelResult | null,
): Promise<{ jsonPath: string; htmlPath: string; report: AuditReport }> {
  const report = buildJsonReport(crawlResult, seo, lh, siteLevel);
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

/**
 * Generate a report from a previously saved JSON file.
 */
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
