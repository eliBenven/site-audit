#!/usr/bin/env node

/**
 * site-audit CLI
 *
 * Commands:
 *   crawl <url>      - Crawl a website and output the site graph as JSON
 *   audit <url>      - Full pipeline: crawl + SEO + Lighthouse + report
 *   report <json>    - Re-generate an HTML report from a previous JSON export
 */

import { Command } from "commander";
import { mkdir } from "node:fs/promises";
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
import type { CrawlOptions, LighthouseOptions } from "./types.js";

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
  .option("-o, --output <dir>", "Output directory", "./site-audit-output")
  .action(async (url: string, opts: Record<string, string>) => {
    const outputDir = path.resolve(opts.output);
    await mkdir(outputDir, { recursive: true });

    const spinner = ora("Crawling...").start();

    try {
      const crawlOpts: Partial<CrawlOptions> = {
        maxDepth: parseInt(opts.depth, 10),
        maxPages: parseInt(opts.maxPages, 10),
        mode: opts.mode as CrawlOptions["mode"],
        concurrency: parseInt(opts.concurrency, 10),
      };

      const result = await crawl(url, crawlOpts);
      spinner.succeed(`Crawled ${result.pages.size} pages in ${(result.elapsedMs / 1000).toFixed(1)}s`);

      // Serialise Map for JSON
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

      const { writeFile } = await import("node:fs/promises");
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
    } catch (err) {
      spinner.fail("Crawl failed");
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

// ── audit ────────────────────────────────────────────────────────────────────

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
  .option("-o, --output <dir>", "Output directory", "./site-audit-output")
  .action(
    async (
      url: string,
      opts: Record<string, string> & { skipLighthouse?: boolean },
    ) => {
      const outputDir = path.resolve(opts.output);
      await mkdir(outputDir, { recursive: true });

      const totalSteps = opts.skipLighthouse ? 7 : 8;
      const step = (n: number) => `Step ${n}/${totalSteps}`;

      // Step 1: Crawl
      const crawlSpinner = ora(`${step(1)}: Crawling website...`).start();
      let crawlResult;
      try {
        const crawlOpts: Partial<CrawlOptions> = {
          maxDepth: parseInt(opts.depth, 10),
          maxPages: parseInt(opts.maxPages, 10),
          mode: opts.mode as CrawlOptions["mode"],
          concurrency: parseInt(opts.concurrency, 10),
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
      const seoSpinner = ora(`${step(2)}: Running SEO checks...`).start();
      const seoResult = checkSeo(crawlResult);
      seoSpinner.succeed(
        `SEO: ${seoResult.summary.error} errors, ${seoResult.summary.warning} warnings, ${seoResult.summary.info} info`,
      );

      // Step 3: Site-level checks (robots.txt, sitemap.xml, security headers)
      const siteSpinner = ora(`${step(3)}: Checking site-level (robots, sitemap, security headers)...`).start();
      let siteLevelResult = null;
      try {
        siteLevelResult = await checkSiteLevel(url);
        const siteIssueCount = siteLevelResult.issues.length;
        siteSpinner.succeed(
          `Site-level: ${siteIssueCount} issue${siteIssueCount === 1 ? "" : "s"} found`,
        );
      } catch (err) {
        siteSpinner.warn(
          `Site-level checks failed: ${err instanceof Error ? err.message : String(err)}. Continuing.`,
        );
      }

      // Step 4: External link checks
      const linkSpinner = ora(`${step(4)}: Checking external links...`).start();
      let externalLinksResult = null;
      try {
        externalLinksResult = await checkExternalLinks(crawlResult);
        linkSpinner.succeed(
          `External links: ${externalLinksResult.checked} checked, ${externalLinksResult.broken} broken`,
        );
      } catch (err) {
        linkSpinner.warn(
          `External link check failed: ${err instanceof Error ? err.message : String(err)}. Continuing.`,
        );
      }

      // Step 5: Extended analysis (accessibility, crawl depth, resources, content, images)
      const extSpinner = ora(`${step(5)}: Running extended analysis...`).start();
      const accessibilityResult = checkAccessibility(crawlResult);
      const crawlAnalysisResult = analyzeCrawl(crawlResult);
      const resourcesResult = analyzeResources(crawlResult);
      const contentAnalysisResult = analyzeContent(crawlResult);
      let imageResult = null;
      try {
        imageResult = await checkImageOptimization(crawlResult);
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
      const lhStep = opts.skipLighthouse ? null : step(6);
      if (!opts.skipLighthouse) {
        const lhSpinner = ora(`${lhStep}: Running Lighthouse audits...`).start();
        try {
          const lhOpts: Partial<LighthouseOptions> = {
            sampleSize: parseInt(opts.lighthouseSamples, 10),
            formFactor: opts.formFactor as LighthouseOptions["formFactor"],
          };
          lighthouseResult = await runLighthouse(crawlResult, lhOpts);
          lhSpinner.succeed(
            `Lighthouse: audited ${lighthouseResult.pages.length} pages`,
          );
        } catch (err) {
          lhSpinner.warn(
            `Lighthouse failed: ${err instanceof Error ? err.message : String(err)}. Continuing.`,
          );
        }
      } else {
        console.log(chalk.dim(`  ${step(6)}: Lighthouse skipped (--skip-lighthouse)`));
      }

      // Final step: Generate report
      const reportStep = opts.skipLighthouse ? step(7) : step(totalSteps);
      const reportSpinner = ora(`${reportStep}: Generating reports...`).start();
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
        };
        const { jsonPath, htmlPath, report } = await generateReport(inputs, outputDir);
        reportSpinner.succeed("Reports generated");

        console.log("");
        console.log(chalk.bold("Audit Complete"));
        console.log(chalk.green(`  JSON: ${jsonPath}`));
        console.log(chalk.green(`  HTML: ${htmlPath}`));
        console.log("");
        console.log(`  Pages crawled:  ${report.crawl.totalPages}`);
        console.log(`  Orphan pages:   ${report.crawl.orphanPages.length}`);
        console.log(`  SEO errors:     ${chalk.red(String(report.seo.summary.error))}`);
        console.log(`  SEO warnings:   ${chalk.yellow(String(report.seo.summary.warning))}`);
        console.log(`  Ranked fixes:   ${report.rankedFixes.length}`);

        if (report.rankedFixes.length > 0) {
          console.log("");
          console.log(chalk.bold("  Top 5 fixes:"));
          for (const fix of report.rankedFixes.slice(0, 5)) {
            console.log(`    ${fix.rank}. ${fix.title} (${fix.impact} impact, ${fix.effort} effort)`);
          }
        }
      } catch (err) {
        reportSpinner.fail("Report generation failed");
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    },
  );

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

program.parse();
