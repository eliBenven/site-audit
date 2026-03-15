/**
 * Basic accessibility checker module.
 *
 * Checks for common WCAG issues detectable via HTML analysis:
 * form labels, ARIA landmarks, skip navigation, tabindex misuse.
 * Uses cheerio for reliable HTML parsing.
 */

import * as cheerio from "cheerio";
import type { CrawlResult, SeoIssue } from "./types.js";

export interface AccessibilityResult {
  issues: SeoIssue[];
}

const HIDDEN_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

function checkFormLabels($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  let unlabeled = 0;

  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") ?? "").toLowerCase();
    if (HIDDEN_INPUT_TYPES.has(type)) return;

    if ($el.attr("aria-label") || $el.attr("aria-labelledby")) return;

    const id = $el.attr("id");
    if (id && $(`label[for="${id}"]`).length > 0) return;

    // Check if wrapped in a <label>
    if ($el.closest("label").length > 0) return;

    unlabeled++;
  });

  if (unlabeled > 0) {
    issues.push({
      rule: "a11y-form-label-missing",
      severity: "warning",
      message: `${unlabeled} form field(s) have no associated <label>, aria-label, or aria-labelledby.`,
      url,
    });
  }
  return issues;
}

function checkLandmarks($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const hasMain = $("main, [role='main']").length > 0;
  const hasNav = $("nav, [role='navigation']").length > 0;

  if (!hasMain) {
    issues.push({
      rule: "a11y-landmark-main-missing",
      severity: "warning",
      message: 'Page has no <main> element or role="main". Screen readers need landmarks.',
      url,
    });
  }
  if (!hasNav) {
    issues.push({
      rule: "a11y-landmark-nav-missing",
      severity: "info",
      message: 'Page has no <nav> element or role="navigation".',
      url,
    });
  }
  return issues;
}

function checkSkipNav($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  let hasSkipLink = false;

  $('a[href^="#"]').each((_, el) => {
    const text = $(el).text().toLowerCase();
    if (text.includes("skip")) hasSkipLink = true;
  });

  if (!hasSkipLink) {
    issues.push({
      rule: "a11y-skip-nav-missing",
      severity: "info",
      message: "Page has no skip navigation link. Keyboard users must tab through all nav items.",
      url,
    });
  }
  return issues;
}

function checkTabindex($: cheerio.CheerioAPI, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  let positiveCount = 0;

  $("[tabindex]").each((_, el) => {
    const val = parseInt($(el).attr("tabindex") ?? "0", 10);
    if (val > 0) positiveCount++;
  });

  if (positiveCount > 0) {
    issues.push({
      rule: "a11y-tabindex-positive",
      severity: "warning",
      message: `${positiveCount} element(s) use positive tabindex, which disrupts natural tab order.`,
      url,
    });
  }
  return issues;
}

export function checkAccessibility(crawlResult: CrawlResult): AccessibilityResult {
  const issues: SeoIssue[] = [];
  for (const [url, node] of crawlResult.pages) {
    const $ = cheerio.load(node.html);
    issues.push(
      ...checkFormLabels($, url),
      ...checkLandmarks($, url),
      ...checkSkipNav($, url),
      ...checkTabindex($, url),
    );
  }
  return { issues };
}
