/**
 * Image optimization checker module.
 *
 * Detects non-optimal image formats and optionally checks file sizes
 * via HEAD requests.
 */

import type { CrawlResult, SeoIssue } from "./types.js";

export interface ImageCheckResult {
  issues: SeoIssue[];
}

function extractImageSrcs(html: string): string[] {
  const srcs: string[] = [];
  const re = /<img\s[^>]*src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] && m[1].trim()) srcs.push(m[1]);
  }
  return srcs;
}

function getExtension(src: string): string {
  try {
    const pathname = new URL(src, "https://placeholder.com").pathname;
    const dot = pathname.lastIndexOf(".");
    return dot > -1 ? pathname.slice(dot + 1).toLowerCase() : "";
  } catch {
    return "";
  }
}

const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp", "tiff", "tif"]);

export async function checkImageOptimization(
  crawlResult: CrawlResult,
  options: { checkSizes?: boolean; concurrency?: number; maxSizeKb?: number } = {},
): Promise<ImageCheckResult> {
  const checkSizes = options.checkSizes ?? false;
  const concurrency = options.concurrency ?? 10;
  const maxSizeKb = options.maxSizeKb ?? 500;
  const issues: SeoIssue[] = [];

  // Collect unique images with source pages
  const uniqueSrcs = new Map<string, string[]>();
  for (const [url, node] of crawlResult.pages) {
    for (const src of extractImageSrcs(node.html)) {
      const pages = uniqueSrcs.get(src) ?? [];
      pages.push(url);
      uniqueSrcs.set(src, pages);
    }
  }

  // Check format
  for (const [src, pageUrls] of uniqueSrcs) {
    const ext = getExtension(src);
    if (PHOTO_EXTENSIONS.has(ext)) {
      issues.push({
        rule: "img-format-not-optimal",
        severity: "info",
        message: `Image "${src}" uses ${ext.toUpperCase()}. Consider WebP or AVIF for smaller files.`,
        url: pageUrls[0],
      });
    }
  }

  // Optional: HEAD requests for file sizes
  if (checkSizes) {
    const srcsToCheck = [...uniqueSrcs.keys()].filter((src) => {
      try {
        const u = new URL(src, "https://placeholder.com");
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    });

    for (let i = 0; i < srcsToCheck.length; i += concurrency) {
      const batch = srcsToCheck.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (src) => {
          try {
            const resolved = new URL(src, crawlResult.startUrl).href;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(resolved, { method: "HEAD", signal: controller.signal });
            clearTimeout(timer);
            const cl = res.headers.get("content-length");
            return { src, sizeKb: cl ? parseInt(cl, 10) / 1024 : null };
          } catch {
            return { src, sizeKb: null };
          }
        }),
      );

      for (const { src, sizeKb } of results) {
        if (sizeKb !== null && sizeKb > maxSizeKb) {
          const pageUrls = uniqueSrcs.get(src)!;
          issues.push({
            rule: "img-file-too-large",
            severity: "warning",
            message: `Image "${src}" is ${sizeKb.toFixed(0)}KB (>${maxSizeKb}KB threshold).`,
            url: pageUrls[0],
          });
        }
      }
    }
  }

  return { issues };
}
