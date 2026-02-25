/**
 * Resource analyzer module.
 *
 * Parses HTML to detect:
 * - Render-blocking scripts (in <head> without defer/async)
 * - Excessive external resources
 * - Third-party script domains
 */

import type { CrawlResult, SeoIssue } from "./types.js";

export interface ResourceResult {
  issues: SeoIssue[];
}

interface PageResources {
  scripts: Array<{ src: string; isAsync: boolean; isDefer: boolean; inHead: boolean }>;
  stylesheets: string[];
  thirdPartyDomains: Set<string>;
}

function parseResources(html: string, pageUrl: string): PageResources {
  const pageOrigin = new URL(pageUrl).origin;
  const headEnd = html.toLowerCase().indexOf("</head>");

  const scripts: PageResources["scripts"] = [];
  const scriptRe = /<script\s([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src=["']([^"']*)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    const isAsync = /\basync\b/i.test(attrs);
    const isDefer = /\bdefer\b/i.test(attrs);
    const inHead = headEnd > -1 && m.index < headEnd;
    scripts.push({ src, isAsync, isDefer, inHead });
  }

  const stylesheets: string[] = [];
  const cssRe = /<link\s[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']*)["']/gi;
  while ((m = cssRe.exec(html)) !== null) {
    stylesheets.push(m[1]);
  }

  const thirdPartyDomains = new Set<string>();
  for (const script of scripts) {
    try {
      const scriptOrigin = new URL(script.src, pageUrl).origin;
      if (scriptOrigin !== pageOrigin) {
        thirdPartyDomains.add(new URL(script.src, pageUrl).hostname);
      }
    } catch { /* skip */ }
  }
  for (const css of stylesheets) {
    try {
      const cssOrigin = new URL(css, pageUrl).origin;
      if (cssOrigin !== pageOrigin) {
        thirdPartyDomains.add(new URL(css, pageUrl).hostname);
      }
    } catch { /* skip */ }
  }

  return { scripts, stylesheets, thirdPartyDomains };
}

export function analyzeResources(crawlResult: CrawlResult): ResourceResult {
  const issues: SeoIssue[] = [];

  for (const [url, node] of crawlResult.pages) {
    const res = parseResources(node.html, url);

    const blocking = res.scripts.filter((s) => s.inHead && !s.isAsync && !s.isDefer);
    if (blocking.length > 0) {
      issues.push({
        rule: "resource-render-blocking",
        severity: "warning",
        message: `${blocking.length} script(s) in <head> without async/defer are render-blocking.`,
        url,
      });
    }

    const totalExternal = res.scripts.length + res.stylesheets.length;
    if (totalExternal > 20) {
      issues.push({
        rule: "resource-excessive",
        severity: "info",
        message: `Page loads ${totalExternal} external resources (${res.scripts.length} scripts, ${res.stylesheets.length} stylesheets).`,
        url,
      });
    }

    if (res.thirdPartyDomains.size > 5) {
      issues.push({
        rule: "resource-third-party-heavy",
        severity: "info",
        message: `Page loads resources from ${res.thirdPartyDomains.size} third-party domains.`,
        url,
      });
    }
  }

  return { issues };
}
