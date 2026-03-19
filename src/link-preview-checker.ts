/**
 * Link Preview Checker module.
 *
 * Validates the quality and completeness of Open Graph and Twitter Card
 * metadata that controls how links appear when shared on social platforms
 * (Slack, iMessage, Twitter/X, LinkedIn, Discord, Facebook, etc.).
 *
 * Goes beyond presence checks to evaluate:
 * - OG image dimensions (1200x630 ideal for most platforms)
 * - OG image file size (should be <8MB, ideally <1MB)
 * - OG image reachability (does the URL actually return an image?)
 * - Title/description quality for social sharing context
 * - Twitter Card type optimization
 * - Platform-specific requirements
 */

import * as cheerio from "cheerio";
import type { CrawlResult, SeoIssue } from "./types.js";

export interface LinkPreviewResult {
  issues: SeoIssue[];
  previews: LinkPreview[];
}

export interface LinkPreview {
  url: string;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogImageWidth: number | null;
  ogImageHeight: number | null;
  ogImageSizeKb: number | null;
  ogImageReachable: boolean | null;
  ogType: string | null;
  ogSiteName: string | null;
  twitterCard: string | null;
  twitterImage: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  pageTitle: string | null;
  metaDescription: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const OG_IMAGE_IDEAL_WIDTH = 1200;
const OG_IMAGE_IDEAL_HEIGHT = 630;
const OG_IMAGE_MIN_WIDTH = 200;
const OG_IMAGE_MIN_HEIGHT = 200;
const OG_IMAGE_MAX_SIZE_KB = 8192; // 8MB absolute max (Facebook limit)
const OG_IMAGE_IDEAL_SIZE_KB = 1024; // 1MB recommended

// ── Helpers ──────────────────────────────────────────────────────────────────

async function probeImage(
  imageUrl: string,
  pageUrl: string,
): Promise<{ reachable: boolean; sizeKb: number | null; contentType: string | null }> {
  try {
    const resolved = imageUrl.startsWith("http") ? imageUrl : new URL(imageUrl, pageUrl).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(resolved, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { reachable: false, sizeKb: null, contentType: null };
    }

    const contentLength = res.headers.get("content-length");
    const sizeKb = contentLength ? Math.round(parseInt(contentLength, 10) / 1024) : null;
    const contentType = res.headers.get("content-type");

    return { reachable: true, sizeKb, contentType };
  } catch {
    return { reachable: false, sizeKb: null, contentType: null };
  }
}

function extractPreview($: cheerio.CheerioAPI, url: string): LinkPreview {
  const ogImageWidth = $('meta[property="og:image:width"]').attr("content");
  const ogImageHeight = $('meta[property="og:image:height"]').attr("content");

  return {
    url,
    ogTitle: $('meta[property="og:title"]').attr("content")?.trim() ?? null,
    ogDescription: $('meta[property="og:description"]').attr("content")?.trim() ?? null,
    ogImage: $('meta[property="og:image"]').attr("content")?.trim() ?? null,
    ogImageWidth: ogImageWidth ? parseInt(ogImageWidth, 10) : null,
    ogImageHeight: ogImageHeight ? parseInt(ogImageHeight, 10) : null,
    ogImageSizeKb: null, // filled by probeImage
    ogImageReachable: null, // filled by probeImage
    ogType: $('meta[property="og:type"]').attr("content")?.trim() ?? null,
    ogSiteName: $('meta[property="og:site_name"]').attr("content")?.trim() ?? null,
    twitterCard: $('meta[name="twitter:card"]').attr("content")?.trim() ?? null,
    twitterImage: $('meta[name="twitter:image"]').attr("content")?.trim() ?? null,
    twitterTitle: $('meta[name="twitter:title"]').attr("content")?.trim() ?? null,
    twitterDescription: $('meta[name="twitter:description"]').attr("content")?.trim() ?? null,
    pageTitle: $("title").first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? null,
  };
}

// ── Checks ───────────────────────────────────────────────────────────────────

function checkPreviewCompleteness(preview: LinkPreview): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const url = preview.url;

  // A complete link preview needs: image + title + description
  const hasImage = !!preview.ogImage;
  const hasTitle = !!preview.ogTitle || !!preview.pageTitle;
  const hasDescription = !!preview.ogDescription || !!preview.metaDescription;

  if (!hasImage && !hasTitle && !hasDescription) {
    issues.push({
      rule: "preview-empty",
      severity: "error",
      message: "Page has no OG metadata at all. Shared links will show a blank or ugly preview with just the URL.",
      url,
    });
    return issues; // No point checking further
  }

  if (!hasImage) {
    issues.push({
      rule: "preview-no-image",
      severity: "warning",
      message: "No og:image set. Shared links will appear as small text-only cards — significantly lower engagement than cards with images.",
      url,
    });
  }

  // OG title should exist independently from <title>
  if (!preview.ogTitle && preview.pageTitle) {
    issues.push({
      rule: "preview-title-fallback",
      severity: "info",
      message: `No og:title set — platforms will fall back to the page <title> ("${preview.pageTitle.substring(0, 50)}"). Consider setting a shorter, more engaging og:title optimized for social feeds.`,
      url,
    });
  }

  // OG description should exist independently
  if (!preview.ogDescription && preview.metaDescription) {
    issues.push({
      rule: "preview-description-fallback",
      severity: "info",
      message: "No og:description set — platforms will fall back to the meta description. Consider setting a social-optimized og:description (shorter, more engaging).",
      url,
    });
  }

  return issues;
}

function checkPreviewImage(preview: LinkPreview): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const url = preview.url;

  if (!preview.ogImage) return issues;

  // Check if image URL is absolute
  if (!preview.ogImage.startsWith("http://") && !preview.ogImage.startsWith("https://")) {
    issues.push({
      rule: "preview-image-relative",
      severity: "error",
      message: `og:image URL is relative ("${preview.ogImage.substring(0, 80)}"). All major platforms require absolute URLs — this image will not display.`,
      url,
    });
  }

  // Check reachability
  if (preview.ogImageReachable === false) {
    issues.push({
      rule: "preview-image-broken",
      severity: "error",
      message: `og:image URL returns an error or is unreachable. Shared links will show no image. URL: ${preview.ogImage.substring(0, 100)}`,
      url,
    });
    return issues; // No point checking dimensions of a broken image
  }

  // Check declared dimensions
  if (preview.ogImageWidth && preview.ogImageHeight) {
    if (preview.ogImageWidth < OG_IMAGE_MIN_WIDTH || preview.ogImageHeight < OG_IMAGE_MIN_HEIGHT) {
      issues.push({
        rule: "preview-image-too-small",
        severity: "warning",
        message: `og:image is ${preview.ogImageWidth}x${preview.ogImageHeight}px — too small. Most platforms require at least ${OG_IMAGE_MIN_WIDTH}x${OG_IMAGE_MIN_HEIGHT}px. Ideal is ${OG_IMAGE_IDEAL_WIDTH}x${OG_IMAGE_IDEAL_HEIGHT}px.`,
        url,
      });
    } else if (preview.ogImageWidth < OG_IMAGE_IDEAL_WIDTH || preview.ogImageHeight < OG_IMAGE_IDEAL_HEIGHT) {
      issues.push({
        rule: "preview-image-suboptimal-size",
        severity: "info",
        message: `og:image is ${preview.ogImageWidth}x${preview.ogImageHeight}px. For best display across all platforms, use ${OG_IMAGE_IDEAL_WIDTH}x${OG_IMAGE_IDEAL_HEIGHT}px.`,
        url,
      });
    }
  } else {
    // No declared dimensions — recommend adding them
    issues.push({
      rule: "preview-image-no-dimensions",
      severity: "info",
      message: `og:image has no declared width/height (og:image:width, og:image:height). Adding dimensions helps platforms render previews faster. Ideal: ${OG_IMAGE_IDEAL_WIDTH}x${OG_IMAGE_IDEAL_HEIGHT}px.`,
      url,
    });
  }

  // Check file size
  if (preview.ogImageSizeKb !== null) {
    if (preview.ogImageSizeKb > OG_IMAGE_MAX_SIZE_KB) {
      issues.push({
        rule: "preview-image-too-heavy",
        severity: "warning",
        message: `og:image is ${preview.ogImageSizeKb}KB — exceeds Facebook's 8MB limit. The image may not display on some platforms.`,
        url,
      });
    } else if (preview.ogImageSizeKb > OG_IMAGE_IDEAL_SIZE_KB) {
      issues.push({
        rule: "preview-image-heavy",
        severity: "info",
        message: `og:image is ${preview.ogImageSizeKb}KB. Consider compressing to under 1MB for faster social preview loading.`,
        url,
      });
    }
  }

  return issues;
}

function checkTwitterCard(preview: LinkPreview): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const url = preview.url;

  if (!preview.twitterCard && preview.ogImage) {
    issues.push({
      rule: "preview-twitter-card-missing",
      severity: "info",
      message: 'No twitter:card meta tag. Add <meta name="twitter:card" content="summary_large_image"> to show a large image card on Twitter/X.',
      url,
    });
  } else if (preview.twitterCard === "summary" && preview.ogImage) {
    issues.push({
      rule: "preview-twitter-card-small",
      severity: "info",
      message: 'Twitter card type is "summary" (small square image). Use "summary_large_image" for a more prominent, full-width preview that gets more clicks.',
      url,
    });
  }

  return issues;
}

function checkPreviewContent(preview: LinkPreview): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const url = preview.url;
  const title = preview.ogTitle ?? preview.pageTitle;
  const description = preview.ogDescription ?? preview.metaDescription;

  // Title length for social (shorter is better — truncated at ~60-70 chars on most platforms)
  if (title && title.length > 70) {
    issues.push({
      rule: "preview-title-too-long",
      severity: "info",
      message: `Preview title is ${title.length} chars ("${title.substring(0, 50)}..."). Most platforms truncate at ~60-70 characters. Consider a shorter og:title.`,
      url,
    });
  }

  // Description length for social (Facebook truncates at ~200 chars, Twitter at ~200)
  if (description && description.length > 200) {
    issues.push({
      rule: "preview-description-too-long",
      severity: "info",
      message: `Preview description is ${description.length} chars. Social platforms truncate at ~200 characters. Consider a shorter og:description.`,
      url,
    });
  }

  // Missing og:site_name
  if (!preview.ogSiteName) {
    issues.push({
      rule: "preview-site-name-missing",
      severity: "info",
      message: "No og:site_name set. Adding it shows your brand name above the title in previews (Facebook, LinkedIn).",
      url,
    });
  }

  return issues;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function checkLinkPreviews(
  crawlResult: CrawlResult,
  options: { probeImages?: boolean } = {},
): Promise<LinkPreviewResult> {
  const issues: SeoIssue[] = [];
  const previews: LinkPreview[] = [];
  const probeImages = options.probeImages ?? true;

  for (const [url, node] of crawlResult.pages) {
    // Skip non-HTML
    const pathname = new URL(url).pathname;
    if (/\.(xml|txt|json|ico|png|jpg|svg)$/i.test(pathname)) continue;
    if (!node.html.includes("<head")) continue;

    const $ = cheerio.load(node.html);
    const preview = extractPreview($, url);

    // Probe the OG image URL if it exists
    if (probeImages && preview.ogImage && preview.ogImage.startsWith("http")) {
      const probe = await probeImage(preview.ogImage, url);
      preview.ogImageReachable = probe.reachable;
      preview.ogImageSizeKb = probe.sizeKb;
    }

    previews.push(preview);

    issues.push(
      ...checkPreviewCompleteness(preview),
      ...checkPreviewImage(preview),
      ...checkTwitterCard(preview),
      ...checkPreviewContent(preview),
    );
  }

  return { issues, previews };
}
