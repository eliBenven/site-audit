#!/usr/bin/env node

/**
 * site-audit CLI
 *
 * Commands:
 *   crawl <url>      - Crawl a website and output the site graph as JSON
 *   audit <url>      - Full pipeline: crawl + SEO + Lighthouse + report
 *   report <json>    - Re-generate an HTML report from a previous JSON export
 *   history          - List past audit runs
 *   diff <a> <b>     - Compare two audit reports
 */

import { Command } from "commander";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { crawl } from "./crawler.js";
import { checkSeo } from "./seo-checker.js";
import { runLighthouse } from "./lighthouse-runner.js";
import { generateReport, generateHtmlFromJson } from "./reporter.js";
import type { ReportInputs } from "./reporter.js";
import { checkSiteLevel } from "./site-checker.js";
import { checkExternalLinks } from "./link-checker.js";
import { checkAccessibility } from "./accessibility-checker.js";
import { analyzeCrawl } from "./crawl-analyzer.js";
import { analyzeResources } from "./resource-analyzer.js";
import { analyzeContent } from "./content-analyzer.js";
import { checkImageOptimization } from "./image-checker.js";
import type { CrawlOptions, LighthouseOptions, SeoSeverity } from "./types.js";

const program = new Command();

program
  .name("site-audit")
  .description("Comprehensive website auditing CLI: crawl, SEO checks, Lighthouse CWV, and HTML reports")
  .version("1.0.0");

// ── crawl ────────────────────────────────────────────────────────────────────

program
  .command("crawl <url>")
  .description("Crawl a website and output the site graph as JSON")
  .option("-d, --depth <number>", "Maximum crawl depth", "3")
  .option("-p, --max-pages <number>", "Maximum pages to crawl", "50")
  .option("-m, --mode <mode>", "Fetch mode: rendered (Playwright) or html", "rendered")
  .option("-c, --concurrency <number>", "Concurrent fetches", "5")
  .option("--user-agent <string>", "Custom User-Agent string")
  .option("--include <patterns...>", "URL patterns to include")
  .option("--exclude <patterns...>", "URL patterns to exclude")
  .option("--cookie <string>", "Cookie string to send with requests")
  .option("--no-robots", "Ignore robots.txt")
  .option("--retries <number>", "Retries on transient failures", "1")
  .option("--json", "Output JSON to stdout instead of file", false)
  .option("-o, --output <dir>", "Output directory", "./site-audit-output")
  .action(async (url: string, opts: Record<string, unknown>) => {
    const outputDir = path.resolve(opts.output as string);
    const jsonMode = opts.json as boolean;

    if (!jsonMode) await mkdir(outputDir, { recursive: true });

    const spinner = jsonMode ? null : ora("Crawling...").start();

    try {
      const crawlOpts: Partial<CrawlOptions> = {
        maxDepth: parseInt(opts.depth as string, 10),
        maxPages: parseInt(opts.maxPages as string, 10),
        mode: opts.mode as CrawlOptions["mode"],
        concurrency: parseInt(opts.concurrency as string, 10),
        respectRobotsTxt: opts.robots !== false,
        retries: parseInt(opts.retries as string, 10),
        userAgent: opts.userAgent as string | undefined,
        include: opts.include as string[] | undefined,
        exclude: opts.exclude as string[] | undefined,
        cookie: opts.cookie as string | undefined,
      };

      const result = await crawl(url, crawlOpts);
      spinner?.succeed(`Crawled ${result.pages.size} pages in ${(result.elapsedMs / 1000).toFixed(1)}s`);

      const serialisable = {
        startUrl: result.startUrl,
        pages: Object.fromEntries(
          [...result.pages.entries()].map(([k, v]) => [
            k,
            { ...v, html: v.html.slice(0, 500) + (v.html.length > 500 ? "... (truncated)" : "") },
          ]),
        ),
        orphanPages: result.orphanPages,
        elapsedMs: result.elapsedMs,
      };

      if (jsonMode) {
        process.stdout.write(JSON.stringify(serialisable, null, 2));
      } else {
        const outPath = path.join(outputDir, "crawl.json");
        await writeFile(outPath, JSON.stringify(serialisable, null, 2), "utf-8");

        console.log(chalk.green(`\nCrawl results saved to ${outPath}`));
        console.log(`  Pages discovered: ${result.pages.size}`);
        console.log(`  Orphan pages: ${result.orphanPages.length}`);

        if (result.orphanPages.length > 0) {
          console.log(chalk.yellow("  Orphans:"));
          for (const orphan of result.orphanPages) {
            console.log(`    - ${orphan}`);
          }
        }
      }
    } catch (err) {
      spinner?.fail("Crawl failed");
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// ── audit ────────────────────────────────────────────────────────────────────

interface AuditOpts {
  depth: string;
  maxPages: string;
  mode: string;
  concurrency: string;
  lighthouseSamples: string;
  formFactor: string;
  skipLighthouse?: boolean;
  ci?: boolean;
  failOn?: string;
  pdf?: boolean;
  json?: boolean;
  output: string;
  userAgent?: string;
  include?: string[];
  exclude?: string[];
  cookie?: string;
  robots?: boolean;
  retries: string;
  checkImageSizes?: boolean;
  ai?: boolean;
}

program
  .command("audit <url>")
  .description("Full audit pipeline: crawl + SEO checks + Lighthouse + HTML report")
  .option("-d, --depth <number>", "Maximum crawl depth", "3")
  .option("-p, --max-pages <number>", "Maximum pages to crawl", "50")
  .option("-m, --mode <mode>", "Fetch mode: rendered or html", "rendered")
  .option("-c, --concurrency <number>", "Concurrent fetches", "5")
  .option("-s, --lighthouse-samples <number>", "Lighthouse sample size", "5")
  .option("-f, --form-factor <factor>", "Lighthouse form factor: mobile or desktop", "mobile")
  .option("--skip-lighthouse", "Skip Lighthouse performance audit", false)
  .option("--ci", "CI mode: suppress spinners, output plain text", false)
  .option("--fail-on <severity>", "Exit non-zero if issues at this severity or above exist (error, warning, info)")
  .option("--pdf", "Also generate a PDF report (requires Playwright)", false)
  .option("--json", "Output JSON report to stdout", false)
  .option("--user-agent <string>", "Custom User-Agent string")
  .option("--include <patterns...>", "URL patterns to include")
  .option("--exclude <patterns...>", "URL patterns to exclude")
  .option("--cookie <string>", "Cookie string to send with requests")
  .option("--no-robots", "Ignore robots.txt")
  .option("--retries <number>", "Retries on transient failures", "1")
  .option("--check-image-sizes", "Check actual image file sizes via HEAD requests", false)
  .option("--ai", "Run AI analysis (requires ANTHROPIC_API_KEY)", false)
  .option("-o, --output <dir>", "Output directory", "./site-audit-output")
  .action(async (url: string, opts: AuditOpts) => {
    const outputDir = path.resolve(opts.output);
    await mkdir(outputDir, { recursive: true });

    const ciMode = opts.ci ?? false;
    const jsonMode = opts.json ?? false;

    function ciSpinner(text: string) {
      if (ciMode || jsonMode) {
        if (!jsonMode) console.log(text);
        return {
          succeed: (msg: string) => { if (!jsonMode) console.log(`OK: ${msg}`); },
          fail: (msg: string) => { if (!jsonMode) console.error(`FAIL: ${msg}`); },
          warn: (msg: string) => { if (!jsonMode) console.warn(`WARN: ${msg}`); },
        };
      }
      return ora(text).start();
    }

    const useAi = opts.ai && !!process.env.ANTHROPIC_API_KEY;
    const totalSteps = (opts.skipLighthouse ? 7 : 8) + (useAi ? 1 : 0);
    let currentStep = 0;
    const step = () => `Step ${++currentStep}/${totalSteps}`;

    // Step 1: Crawl
    const crawlSpinner = ciSpinner(`${step()}: Crawling website...`);
    let crawlResult;
    try {
      const crawlOpts: Partial<CrawlOptions> = {
        maxDepth: parseInt(opts.depth, 10),
        maxPages: parseInt(opts.maxPages, 10),
        mode: opts.mode as CrawlOptions["mode"],
        concurrency: parseInt(opts.concurrency, 10),
        respectRobotsTxt: opts.robots !== false,
        retries: parseInt(opts.retries, 10),
        userAgent: opts.userAgent,
        include: opts.include,
        exclude: opts.exclude,
        cookie: opts.cookie,
      };
      crawlResult = await crawl(url, crawlOpts);
      crawlSpinner.succeed(
        `Crawled ${crawlResult.pages.size} pages in ${(crawlResult.elapsedMs / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      crawlSpinner.fail("Crawl failed");
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }

    // Step 2: SEO checks
    const seoSpinner = ciSpinner(`${step()}: Running SEO checks...`);
    const seoResult = checkSeo(crawlResult);
    seoSpinner.succeed(
      `SEO: ${seoResult.summary.error} errors, ${seoResult.summary.warning} warnings, ${seoResult.summary.info} info`,
    );

    // Step 3: Site-level checks
    const siteSpinner = ciSpinner(`${step()}: Checking site-level (robots, sitemap, security headers)...`);
    let siteLevelResult = null;
    try {
      siteLevelResult = await checkSiteLevel(url);
      const siteIssueCount = siteLevelResult.issues.length;
      siteSpinner.succeed(`Site-level: ${siteIssueCount} issue${siteIssueCount === 1 ? "" : "s"} found`);
    } catch (err) {
      siteSpinner.warn(`Site-level checks failed: ${err instanceof Error ? err.message : String(err)}. Continuing.`);
    }

    // Step 4: External link checks
    const linkSpinner = ciSpinner(`${step()}: Checking external links...`);
    let externalLinksResult = null;
    try {
      externalLinksResult = await checkExternalLinks(crawlResult);
      linkSpinner.succeed(`External links: ${externalLinksResult.checked} checked, ${externalLinksResult.broken} broken`);
    } catch (err) {
      linkSpinner.warn(`External link check failed: ${err instanceof Error ? err.message : String(err)}. Continuing.`);
    }

    // Step 5: Extended analysis
    const extSpinner = ciSpinner(`${step()}: Running extended analysis...`);
    const accessibilityResult = checkAccessibility(crawlResult);
    const crawlAnalysisResult = analyzeCrawl(crawlResult);
    const resourcesResult = analyzeResources(crawlResult);
    const contentAnalysisResult = analyzeContent(crawlResult);
    let imageResult = null;
    try {
      imageResult = await checkImageOptimization(crawlResult, {
        checkSizes: opts.checkImageSizes ?? false,
      });
    } catch { /* non-fatal */ }
    const extIssueCount =
      accessibilityResult.issues.length +
      crawlAnalysisResult.issues.length +
      resourcesResult.issues.length +
      contentAnalysisResult.issues.length +
      (imageResult?.issues.length ?? 0);
    extSpinner.succeed(`Extended analysis: ${extIssueCount} issues found`);

    // Step 6: Lighthouse
    let lighthouseResult = null;
    if (!opts.skipLighthouse) {
      const lhSpinner = ciSpinner(`${step()}: Running Lighthouse audits...`);
      try {
        const lhOpts: Partial<LighthouseOptions> = {
          sampleSize: parseInt(opts.lighthouseSamples, 10),
          formFactor: opts.formFactor as LighthouseOptions["formFactor"],
        };
        lighthouseResult = await runLighthouse(crawlResult, lhOpts);
        lhSpinner.succeed(`Lighthouse: audited ${lighthouseResult.pages.length} pages`);
      } catch (err) {
        lhSpinner.warn(`Lighthouse failed: ${err instanceof Error ? err.message : String(err)}. Continuing.`);
      }
    } else {
      if (!jsonMode) console.log(chalk.dim(`  ${step()}: Lighthouse skipped (--skip-lighthouse)`));
    }

    // Step N-1 (optional): AI analysis
    let aiResult = null;
    if (useAi) {
      const aiSpinner = ciSpinner(`${step()}: Running AI analysis...`);
      try {
        const { analyzeWithAi } = await import("./ai-analyzer.js");
        // Build a preliminary report for the AI to analyze
        const { buildJsonReport } = await import("./reporter.js");
        const prelimInputs: ReportInputs = {
          crawlResult, seo: seoResult, lh: lighthouseResult,
          siteLevel: siteLevelResult, externalLinks: externalLinksResult,
          accessibility: accessibilityResult, crawlAnalysis: crawlAnalysisResult,
          resources: resourcesResult, contentAnalysis: contentAnalysisResult,
          imageOptimization: imageResult,
        };
        const prelimReport = buildJsonReport(prelimInputs);
        aiResult = await analyzeWithAi(prelimReport);
        aiSpinner.succeed("AI analysis complete");
      } catch (err) {
        aiSpinner.warn(`AI analysis failed: ${err instanceof Error ? err.message : String(err)}. Continuing.`);
      }
    }

    // Final step: Generate report
    const reportSpinner = ciSpinner(`${step()}: Generating reports...`);
    try {
      const inputs: ReportInputs = {
        crawlResult,
        seo: seoResult,
        lh: lighthouseResult,
        siteLevel: siteLevelResult,
        externalLinks: externalLinksResult,
        accessibility: accessibilityResult,
        crawlAnalysis: crawlAnalysisResult,
        resources: resourcesResult,
        contentAnalysis: contentAnalysisResult,
        imageOptimization: imageResult,
        ai: aiResult,
      };
      const { jsonPath, htmlPath, report } = await generateReport(inputs, outputDir);

      // Save timestamped copy for history
      const historyDir = path.join(outputDir, "history");
      await mkdir(historyDir, { recursive: true });
      const ts = report.generatedAt.replace(/[:.]/g, "-");
      const historyPath = path.join(historyDir, `report-${ts}.json`);
      await writeFile(historyPath, JSON.stringify(report, null, 2), "utf-8");

      reportSpinner.succeed("Reports generated");

      // JSON stdout mode
      if (jsonMode) {
        process.stdout.write(JSON.stringify(report, null, 2));
        return;
      }

      // Optional PDF export
      let pdfPath: string | null = null;
      if (opts.pdf) {
        try {
          const { chromium } = await import("playwright");
          const browser = await chromium.launch();
          const page = await browser.newPage();
          await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
          pdfPath = path.join(outputDir, "report.pdf");
          await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
          await browser.close();
        } catch (err) {
          console.warn(chalk.yellow(
            `  PDF export failed: ${err instanceof Error ? err.message : String(err)}. ` +
            `Install Playwright (npx playwright install chromium) for PDF support.`,
          ));
        }
      }

      console.log("");
      console.log(chalk.bold("Audit Complete"));
      console.log(chalk.green(`  JSON: ${jsonPath}`));
      console.log(chalk.green(`  HTML: ${htmlPath}`));
      if (pdfPath) console.log(chalk.green(`  PDF:  ${pdfPath}`));
      console.log("");
      console.log(`  Pages crawled:  ${report.crawl.totalPages}`);
      console.log(`  Orphan pages:   ${report.crawl.orphanPages.length}`);
      if (report.crawl.avgTtfb) console.log(`  Avg TTFB:       ${report.crawl.avgTtfb}ms`);
      if (report.crawl.avgResponseTime) console.log(`  Avg Response:   ${report.crawl.avgResponseTime}ms`);
      console.log(`  SEO errors:     ${chalk.red(String(report.seo.summary.error))}`);
      console.log(`  SEO warnings:   ${chalk.yellow(String(report.seo.summary.warning))}`);
      console.log(`  Ranked fixes:   ${report.rankedFixes.length}`);

      if (report.ai) {
        console.log("");
        console.log(chalk.bold("  AI Summary:"));
        // Print first 3 lines of the executive summary
        const summaryLines = report.ai.executiveSummary.split("\n").filter((l) => l.trim());
        for (const line of summaryLines.slice(0, 3)) {
          console.log(`    ${line.trim()}`);
        }
        if (summaryLines.length > 3) console.log("    ...(see full report)");
      }

      if (report.rankedFixes.length > 0) {
        console.log("");
        console.log(chalk.bold("  Top 5 fixes:"));
        for (const fix of report.rankedFixes.slice(0, 5)) {
          console.log(`    ${fix.rank}. ${fix.title} (${fix.impact} impact, ${fix.effort} effort)`);
        }
      }

      // --fail-on: count ALL issues across all sections, not just SEO
      if (opts.failOn) {
        const severityLevels: Record<string, number> = { error: 3, warning: 2, info: 1 };
        const threshold = severityLevels[opts.failOn];
        if (!threshold) {
          console.error(chalk.red(`Invalid --fail-on value: "${opts.failOn}". Use error, warning, or info.`));
          process.exit(2);
        }

        // Collect all issues from every section
        const allIssues: Array<{ severity: string }> = [];
        for (const page of report.seo.pages) {
          allIssues.push(...page.issues);
        }
        if (report.siteLevel) allIssues.push(...report.siteLevel.issues);
        if (report.externalLinks) allIssues.push(...report.externalLinks.issues);
        if (report.accessibility) allIssues.push(...report.accessibility.issues);
        if (report.crawlAnalysis) allIssues.push(...report.crawlAnalysis.issues);
        if (report.resources) allIssues.push(...report.resources.issues);
        if (report.contentAnalysis) allIssues.push(...report.contentAnalysis.issues);
        if (report.imageOptimization) allIssues.push(...report.imageOptimization.issues);

        const severityToLevel: Record<string, number> = { error: 3, warning: 2, info: 1 };
        const failCount = allIssues.filter((i) => (severityToLevel[i.severity as SeoSeverity] ?? 0) >= threshold).length;

        if (failCount > 0) {
          console.log("");
          console.log(chalk.red(`CI gate failed: ${failCount} issue(s) at severity "${opts.failOn}" or above.`));
          process.exit(1);
        }
      }
    } catch (err) {
      reportSpinner.fail("Report generation failed");
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// ── report ───────────────────────────────────────────────────────────────────

program
  .command("report <json-file>")
  .description("Re-generate an HTML report from a previous JSON export")
  .option("-o, --output <dir>", "Output directory", ".")
  .action(async (jsonFile: string, opts: Record<string, string>) => {
    const outputDir = path.resolve(opts.output);
    await mkdir(outputDir, { recursive: true });

    const spinner = ora("Generating HTML report...").start();
    try {
      const htmlPath = await generateHtmlFromJson(path.resolve(jsonFile), outputDir);
      spinner.succeed(`HTML report generated: ${htmlPath}`);
    } catch (err) {
      spinner.fail("Report generation failed");
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// ── history ─────────────────────────────────────────────────────────────────

program
  .command("history")
  .description("List past audit runs from the history directory")
  .option("-o, --output <dir>", "Output directory with history", "./site-audit-output")
  .action(async (opts: Record<string, string>) => {
    const historyDir = path.join(path.resolve(opts.output), "history");
    try {
      const files = (await readdir(historyDir)).filter((f) => f.endsWith(".json")).sort();
      if (files.length === 0) {
        console.log("No audit history found.");
        return;
      }
      console.log(chalk.bold(`${files.length} past audit(s):\n`));
      for (const file of files) {
        const raw = await readFile(path.join(historyDir, file), "utf-8");
        const report = JSON.parse(raw) as { generatedAt: string; startUrl: string; seo: { summary: { error: number; warning: number } }; crawl: { totalPages: number } };
        console.log(
          `  ${report.generatedAt}  ${report.startUrl}  ` +
          `${report.crawl.totalPages} pages  ` +
          `${chalk.red(String(report.seo.summary.error))} errors  ` +
          `${chalk.yellow(String(report.seo.summary.warning))} warnings`,
        );
      }
    } catch {
      console.log("No audit history found. Run `site-audit audit <url>` first.");
    }
  });

// ── diff ────────────────────────────────────────────────────────────────────

program
  .command("diff <before-json> <after-json>")
  .description("Compare two audit reports and show changes")
  .action(async (beforePath: string, afterPath: string) => {
    try {
      const [beforeRaw, afterRaw] = await Promise.all([
        readFile(path.resolve(beforePath), "utf-8"),
        readFile(path.resolve(afterPath), "utf-8"),
      ]);
      const before = JSON.parse(beforeRaw) as { seo: { summary: Record<string, number>; pages: Array<{ issues: Array<{ rule: string }> }> }; rankedFixes: Array<{ title: string }> };
      const after = JSON.parse(afterRaw) as typeof before;

      console.log(chalk.bold("Audit Diff Report\n"));

      for (const sev of ["error", "warning", "info"]) {
        const bCount = before.seo.summary[sev] ?? 0;
        const aCount = after.seo.summary[sev] ?? 0;
        const delta = aCount - bCount;
        const arrow = delta > 0 ? chalk.red(`+${delta}`) : delta < 0 ? chalk.green(`${delta}`) : chalk.dim("0");
        console.log(`  ${sev.padEnd(8)} ${bCount} -> ${aCount} (${arrow})`);
      }

      const beforeRules = new Set(before.seo.pages.flatMap((p) => p.issues.map((i) => i.rule)));
      const afterRules = new Set(after.seo.pages.flatMap((p) => p.issues.map((i) => i.rule)));

      const newRules = [...afterRules].filter((r) => !beforeRules.has(r));
      const resolvedRules = [...beforeRules].filter((r) => !afterRules.has(r));

      if (newRules.length > 0) {
        console.log(chalk.red(`\n  New issue types (${newRules.length}):`));
        for (const r of newRules) console.log(`    + ${r}`);
      }
      if (resolvedRules.length > 0) {
        console.log(chalk.green(`\n  Resolved issue types (${resolvedRules.length}):`));
        for (const r of resolvedRules) console.log(`    - ${r}`);
      }

      const bFixes = before.rankedFixes?.length ?? 0;
      const aFixes = after.rankedFixes?.length ?? 0;
      console.log(`\n  Ranked fixes: ${bFixes} -> ${aFixes}`);

      if (newRules.length === 0 && resolvedRules.length === 0) {
        console.log(chalk.dim("\n  No new or resolved issue types between reports."));
      }
    } catch (err) {
      console.error(chalk.red(`Failed to diff: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

program.parse();
