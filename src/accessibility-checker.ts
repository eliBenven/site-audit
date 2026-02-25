/**
 * Basic accessibility checker module.
 *
 * Checks for common WCAG issues detectable via HTML analysis:
 * form labels, ARIA landmarks, skip navigation, tabindex misuse.
 */

import type { CrawlResult, SeoIssue } from "./types.js";

export interface AccessibilityResult {
  issues: SeoIssue[];
}

function checkFormLabels(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const inputRe = /<(?:input|select|textarea)\s([^>]*)>/gi;
  let m: RegExpExecArray | null;
  let unlabeled = 0;

  while ((m = inputRe.exec(html)) !== null) {
    const attrs = m[1];
    if (/type=["'](?:hidden|submit|button|reset|image)["']/i.test(attrs)) continue;

    const hasAriaLabel = /aria-label=["'][^"']+["']/i.test(attrs);
    const hasAriaLabelledBy = /aria-labelledby=["'][^"']+["']/i.test(attrs);
    if (hasAriaLabel || hasAriaLabelledBy) continue;

    const idMatch = attrs.match(/id=["']([^"']*)["']/i);
    if (idMatch) {
      const labelRe = new RegExp(`<label\\s[^>]*for=["']${idMatch[1]}["']`, "i");
      if (labelRe.test(html)) continue;
    }

    unlabeled++;
  }

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

function checkLandmarks(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const hasMain = /<main[\s>]/i.test(html) || /role=["']main["']/i.test(html);
  const hasNav = /<nav[\s>]/i.test(html) || /role=["']navigation["']/i.test(html);

  if (!hasMain) {
    issues.push({
      rule: "a11y-landmark-main-missing",
      severity: "warning",
      message: "Page has no <main> element or role=\"main\". Screen readers need landmarks.",
      url,
    });
  }
  if (!hasNav) {
    issues.push({
      rule: "a11y-landmark-nav-missing",
      severity: "info",
      message: "Page has no <nav> element or role=\"navigation\".",
      url,
    });
  }
  return issues;
}

function checkSkipNav(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const hasSkipLink = /<a\s[^>]*href=["']#[^"']+["'][^>]*>.*?skip/i.test(html);
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

function checkTabindex(html: string, url: string): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const tabindexRe = /tabindex=["'](\d+)["']/gi;
  let m: RegExpExecArray | null;
  let positiveCount = 0;

  while ((m = tabindexRe.exec(html)) !== null) {
    if (parseInt(m[1], 10) > 0) positiveCount++;
  }

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
    issues.push(
      ...checkFormLabels(node.html, url),
      ...checkLandmarks(node.html, url),
      ...checkSkipNav(node.html, url),
      ...checkTabindex(node.html, url),
    );
  }
  return { issues };
}
