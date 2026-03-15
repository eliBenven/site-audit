/**
 * Resource analyzer module.
 *
 * Uses cheerio to reliably detect:
 * - Render-blocking scripts (in <head> without defer/async)
 * - Excessive external resources
 * - Third-party script domains
 */

import * as cheerio from "cheerio";
import type { CrawlResult, SeoIssue } from "./types.js";

export interface ResourceResult {
  issues: SeoIssue[];
}

interface PageResources {
  scripts: Array<{ src: string; isAsync: boolean; isDefer: boolean; isModule: boolean; inHead: boolean }>;
  stylesheets: string[];
  thirdPartyDomains: Set<string>;
}

/** Framework polyfill/runtime scripts that are intentionally synchronous and tiny. */
const FRAMEWORK_POLYFILL_PATTERNS = [
  /\/_next\/static\/chunks\/polyfills/,   // Next.js
  /\/_next\/static\/chunks\/webpack/,     // Next.js webpack runtime
  /__next/,                               // Next.js internals
  /nuxt/,                                 // Nuxt.js
  /gatsby-chunk/,                         // Gatsby
  /polyfill(?:s)?[\.-]/i,                 // Generic polyfill bundles
];

function parseResources(html: string, pageUrl: string): PageResources {
  const $ = cheerio.load(html);
  const pageOrigin = new URL(pageUrl).origin;

  const scripts: PageResources["scripts"] = [];
  $("script[src]").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") ?? "";
    const isAsync = $el.attr("async") !== undefined;
    const isDefer = $el.attr("defer") !== undefined;
    const isModule = $el.attr("type") === "module";
    const inHead = $el.closest("head").length > 0;
    scripts.push({ src, isAsync, isDefer, isModule, inHead });
  });

  const stylesheets: string[] = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) stylesheets.push(href);
  });

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

    // type="module" scripts are deferred by spec, so they're not blocking.
    // Framework polyfill/runtime scripts are intentionally synchronous and tiny.
    const blocking = res.scripts.filter((s) => {
      if (!s.inHead || s.isAsync || s.isDefer || s.isModule) return false;
      // Exclude known framework polyfill/runtime scripts
      return !FRAMEWORK_POLYFILL_PATTERNS.some((re) => re.test(s.src));
    });
    if (blocking.length > 0) {
      issues.push({
        rule: "resource-render-blocking",
        severity: "warning",
        message: `${blocking.length} script(s) in <head> without async/defer are render-blocking: ${blocking.map((s) => s.src.split("/").pop()?.split("?")[0] ?? s.src).join(", ")}`,
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
