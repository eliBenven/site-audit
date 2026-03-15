/**
 * Design Evaluator — Beta
 *
 * Uses Playwright to extract every computed style from every page,
 * then scores against the universal design perfection spec.
 *
 * This is opinionated by design. There is no "well, it depends."
 * Either the typography follows a scale or it doesn't. Either the
 * spacing is on a grid or it isn't. Either the colors are
 * consistent or they're chaos.
 */

import { chromium, type Browser, type Page } from "playwright";
import type { CrawlResult } from "./types.js";
import {
  TYPOGRAPHY,
  COLOR,
  SPACING,
  LAYOUT,
  INTERACTION,
  PERFORMANCE,
  CONSISTENCY,
  POLISH,
  DIMENSION_WEIGHTS,
  PERFECTION_THRESHOLD,
  ACCEPTABLE_THRESHOLD,
  type DesignCheck,
  type DesignDimension,
  type DimensionScore,
  type DesignScore,
} from "./design-spec.js";

// ── Types for extracted data ─────────────────────────────────────────────────

interface ExtractedStyles {
  url: string;
  fontFamilies: string[];
  fontSizes: number[];
  fontWeights: number[];
  lineHeights: number[];
  colors: string[];
  bgColors: string[];
  borderColors: string[];
  spacingValues: number[];
  borderRadii: number[];
  shadows: string[];
  opacities: number[];
  zIndices: number[];
  maxContentWidth: number | null;
  hasHorizontalOverflow: boolean;
  interactiveElements: Array<{
    tag: string;
    hasHoverChange: boolean;
    hasFocusIndicator: boolean;
    width: number;
    height: number;
    cursor: string;
  }>;
  images: Array<{
    src: string;
    hasDimensions: boolean;
    hasAlt: boolean;
    naturalWidth: number;
    naturalHeight: number;
    aspectRatio: number;
  }>;
  hasFavicon: boolean;
  bodyFontSize: number;
  bodyLineHeight: number;
  headingLineHeights: number[];
  lineCharCounts: number[];
  cls: number;
  fontDisplay: string[];
  transitionDurations: number[];
}

// ── Style Extraction (runs inside Playwright) ────────────────────────────────

const EXTRACT_STYLES_SCRIPT = `(() => {
  const result = {
    fontFamilies: new Set(),
    fontSizes: [],
    fontWeights: new Set(),
    lineHeights: [],
    colors: [],
    bgColors: [],
    borderColors: [],
    spacingValues: [],
    borderRadii: new Set(),
    shadows: new Set(),
    opacities: new Set(),
    zIndices: new Set(),
    maxContentWidth: null,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    interactiveElements: [],
    images: [],
    hasFavicon: !!document.querySelector('link[rel*="icon"]'),
    bodyFontSize: 16,
    bodyLineHeight: 1.5,
    headingLineHeights: [],
    lineCharCounts: [],
    fontDisplay: [],
    transitionDurations: [],
  };

  const allElements = document.querySelectorAll('*');
  const bodyStyle = getComputedStyle(document.body);
  result.bodyFontSize = parseFloat(bodyStyle.fontSize);
  result.bodyLineHeight = parseFloat(bodyStyle.lineHeight) / parseFloat(bodyStyle.fontSize) || 1.5;

  // Find max-width containers
  for (const el of allElements) {
    const style = getComputedStyle(el);
    const mw = parseFloat(style.maxWidth);
    if (mw > 0 && mw < 3000 && mw > (result.maxContentWidth || 0)) {
      result.maxContentWidth = mw;
    }
  }

  // Extract styles from all visible elements
  for (const el of allElements) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    // Fonts
    const families = style.fontFamily.split(',').map(f => f.trim().replace(/['"]/g, ''));
    for (const f of families) {
      if (f && !f.startsWith('-') && f !== 'inherit' && f !== 'initial') {
        result.fontFamilies.add(f);
      }
    }

    const fontSize = parseFloat(style.fontSize);
    if (fontSize > 0) result.fontSizes.push(Math.round(fontSize * 10) / 10);

    const fontWeight = parseInt(style.fontWeight) || 400;
    result.fontWeights.add(fontWeight);

    // Line height
    const lh = parseFloat(style.lineHeight);
    if (lh > 0 && fontSize > 0) {
      const ratio = lh / fontSize;
      result.lineHeights.push(Math.round(ratio * 100) / 100);
      if (['H1','H2','H3','H4','H5','H6'].includes(el.tagName)) {
        result.headingLineHeights.push(ratio);
      }
    }

    // Colors (only non-transparent)
    const color = style.color;
    if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
      result.colors.push(color);
    }
    const bg = style.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      result.bgColors.push(bg);
    }
    const border = style.borderColor;
    if (border && border !== 'rgba(0, 0, 0, 0)' && border !== 'transparent' &&
        parseFloat(style.borderWidth) > 0) {
      result.borderColors.push(border);
    }

    // Spacing (margin + padding)
    const spacingProps = [
      style.marginTop, style.marginRight, style.marginBottom, style.marginLeft,
      style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft,
      style.gap, style.rowGap, style.columnGap
    ];
    for (const propVal of spacingProps) {
      const val = parseFloat(propVal);
      if (val > 0 && val < 500) result.spacingValues.push(Math.round(val));
    }

    // Border radius
    const br = parseFloat(style.borderRadius);
    if (br > 0) result.borderRadii.add(Math.round(br));

    // Shadows
    const shadow = style.boxShadow;
    if (shadow && shadow !== 'none') result.shadows.add(shadow);

    // Opacity
    const opacity = parseFloat(style.opacity);
    if (opacity < 1 && opacity > 0) result.opacities.add(Math.round(opacity * 100) / 100);

    // Z-index
    const z = parseInt(style.zIndex);
    if (!isNaN(z) && z !== 0) result.zIndices.add(z);

    // Transitions
    const td = style.transitionDuration;
    if (td && td !== '0s') {
      const ms = parseFloat(td) * (td.includes('ms') ? 1 : 1000);
      if (ms > 0) result.transitionDurations.push(ms);
    }
  }

  // Interactive elements
  const interactiveSelectors = 'a, button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"]), [onclick]';
  for (const el of document.querySelectorAll(interactiveSelectors)) {
    const style = getComputedStyle(el);
    if (style.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    result.interactiveElements.push({
      tag: el.tagName.toLowerCase(),
      hasHoverChange: true, // Can't detect hover in snapshot — checked separately
      hasFocusIndicator: true, // Checked separately via focus simulation
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      cursor: style.cursor,
    });
  }

  // Images
  for (const img of document.querySelectorAll('img')) {
    result.images.push({
      src: img.src || img.getAttribute('src') || '',
      hasDimensions: img.hasAttribute('width') && img.hasAttribute('height') ||
                     getComputedStyle(img).aspectRatio !== 'auto',
      hasAlt: img.hasAttribute('alt'),
      naturalWidth: img.naturalWidth || 0,
      naturalHeight: img.naturalHeight || 0,
      aspectRatio: img.naturalWidth && img.naturalHeight
        ? Math.round((img.naturalWidth / img.naturalHeight) * 100) / 100 : 0,
    });
  }

  // Approximate line character count from paragraphs
  for (const p of document.querySelectorAll('p, li, td')) {
    const style = getComputedStyle(p);
    const width = p.clientWidth;
    const fontSize = parseFloat(style.fontSize);
    if (width > 0 && fontSize > 0) {
      // Average character width ≈ 0.5 * fontSize for proportional fonts
      const charsPerLine = Math.round(width / (fontSize * 0.5));
      if (charsPerLine > 10) result.lineCharCounts.push(charsPerLine);
    }
  }

  // Font display
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        if (rule instanceof CSSFontFaceRule) {
          const fd = rule.style.getPropertyValue('font-display');
          if (fd) result.fontDisplay.push(fd);
        }
      }
    } catch { /* cross-origin */ }
  }

  return {
    ...result,
    fontFamilies: [...result.fontFamilies],
    fontWeights: [...result.fontWeights],
    borderRadii: [...result.borderRadii],
    shadows: [...result.shadows],
    opacities: [...result.opacities],
    zIndices: [...result.zIndices],
  };
})()`;

// ── Focus indicator check ────────────────────────────────────────────────────

const CHECK_FOCUS_SCRIPT = `(() => {
  const results = [];
  const interactiveEls = document.querySelectorAll(
    'a, button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  for (const el of [...interactiveEls].slice(0, 20)) {
    const beforeStyle = getComputedStyle(el);
    const beforeOutline = beforeStyle.outline;
    const beforeBoxShadow = beforeStyle.boxShadow;
    const beforeBorder = beforeStyle.border;

    el.focus();
    const afterStyle = getComputedStyle(el);
    const afterOutline = afterStyle.outline;
    const afterBoxShadow = afterStyle.boxShadow;
    const afterBorder = afterStyle.border;

    const changed = afterOutline !== beforeOutline ||
                    afterBoxShadow !== beforeBoxShadow ||
                    afterBorder !== beforeBorder;

    results.push({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 30),
      hasFocusIndicator: changed || afterOutline !== 'none' && afterOutline !== '',
    });

    el.blur();
  }
  return results;
})()`;

// ── Color Utilities ──────────────────────────────────────────────────────────

function parseRGB(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  return null;
}

function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(c1: [number, number, number], c2: [number, number, number]): number {
  const l1 = luminance(...c1);
  const l2 = luminance(...c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function isNeutral(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (max - min) < 15; // Low saturation = gray
}

function colorToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function uniqueColors(colors: string[]): string[] {
  const seen = new Set<string>();
  for (const c of colors) {
    const rgb = parseRGB(c);
    if (rgb) seen.add(colorToHex(...rgb));
  }
  return [...seen];
}

// ── Scoring Helpers ──────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Score 0-100 based on how close a value is to a target range. */
function rangeScore(value: number, min: number, max: number, hardMin?: number, hardMax?: number): number {
  if (value >= min && value <= max) return 100;
  if (hardMin !== undefined && value < hardMin) return 0;
  if (hardMax !== undefined && value > hardMax) return 0;
  const distBelow = value < min ? min - value : 0;
  const distAbove = value > max ? value - max : 0;
  const dist = Math.max(distBelow, distAbove);
  return clamp(100 - dist * 10, 0, 100);
}

/** Score based on a ratio: actual / target * 100. */
function ratioScore(actual: number, target: number): number {
  if (target === 0) return actual === 0 ? 100 : 0;
  return clamp(Math.round((actual / target) * 100), 0, 100);
}

/** Score: lower is better. 0 deviations = 100. */
function deviationScore(count: number, maxAcceptable: number): number {
  if (count === 0) return 100;
  if (count >= maxAcceptable) return 0;
  return Math.round(100 * (1 - count / maxAcceptable));
}

// ── The Evaluator ────────────────────────────────────────────────────────────

async function extractFromPage(page: Page, url: string): Promise<ExtractedStyles> {
  const data = await page.evaluate(EXTRACT_STYLES_SCRIPT) as Omit<ExtractedStyles, "url" | "cls"> | null;
  if (!data) throw new Error("Style extraction returned null");

  let focusData: Array<{ hasFocusIndicator: boolean }> = [];
  try {
    focusData = (await page.evaluate(CHECK_FOCUS_SCRIPT) as Array<{ hasFocusIndicator: boolean }>) ?? [];
  } catch { /* Focus check can fail on some pages */ }

  // Merge focus data into interactive elements
  const interactiveEls = data.interactiveElements ?? [];
  for (let i = 0; i < Math.min(focusData.length, interactiveEls.length); i++) {
    interactiveEls[i].hasFocusIndicator = focusData[i].hasFocusIndicator;
  }

  // CLS — measure via PerformanceObserver
  let cls = 0;
  try {
    cls = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsValue = 0;
        try {
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as unknown as { hadRecentInput?: boolean; value?: number };
              if (!shift.hadRecentInput) {
                clsValue += shift.value ?? 0;
              }
            }
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          observer.observe({ entryTypes: ["layout-shift"] } as any);
          setTimeout(() => {
            observer.disconnect();
            resolve(clsValue);
          }, 500);
        } catch {
          resolve(0);
        }
      });
    });
  } catch { /* CLS measurement failed */ }

  return {
    ...Object.assign({}, data),
    url,
    cls,
  } as ExtractedStyles;
}

function aggregateStyles(pages: ExtractedStyles[]): ExtractedStyles {
  const agg: ExtractedStyles = {
    url: "aggregate",
    fontFamilies: [],
    fontSizes: [],
    fontWeights: [],
    lineHeights: [],
    colors: [],
    bgColors: [],
    borderColors: [],
    spacingValues: [],
    borderRadii: [],
    shadows: [],
    opacities: [],
    zIndices: [],
    maxContentWidth: null,
    hasHorizontalOverflow: false,
    interactiveElements: [],
    images: [],
    hasFavicon: true,
    bodyFontSize: 16,
    bodyLineHeight: 1.5,
    headingLineHeights: [],
    lineCharCounts: [],
    cls: 0,
    fontDisplay: [],
    transitionDurations: [],
  };

  const fontFamilySet = new Set<string>();
  const borderRadiiSet = new Set<number>();
  const shadowSet = new Set<string>();
  const opacitySet = new Set<number>();
  const zIndexSet = new Set<number>();

  for (const p of pages) {
    for (const f of p.fontFamilies) fontFamilySet.add(f);
    agg.fontSizes.push(...p.fontSizes);
    for (const w of p.fontWeights) agg.fontWeights.push(w);
    agg.lineHeights.push(...p.lineHeights);
    agg.colors.push(...p.colors);
    agg.bgColors.push(...p.bgColors);
    agg.borderColors.push(...p.borderColors);
    agg.spacingValues.push(...p.spacingValues);
    for (const r of p.borderRadii) borderRadiiSet.add(r);
    for (const s of p.shadows) shadowSet.add(s);
    for (const o of p.opacities) opacitySet.add(o);
    for (const z of p.zIndices) zIndexSet.add(z);
    agg.interactiveElements.push(...p.interactiveElements);
    agg.images.push(...p.images);
    agg.headingLineHeights.push(...p.headingLineHeights);
    agg.lineCharCounts.push(...p.lineCharCounts);
    agg.transitionDurations.push(...p.transitionDurations);
    if (p.hasHorizontalOverflow) agg.hasHorizontalOverflow = true;
    if (!p.hasFavicon) agg.hasFavicon = false;
    agg.cls = Math.max(agg.cls, p.cls);
    if (p.maxContentWidth && (!agg.maxContentWidth || p.maxContentWidth > agg.maxContentWidth)) {
      agg.maxContentWidth = p.maxContentWidth;
    }
    agg.fontDisplay.push(...p.fontDisplay);
  }

  // Use median body font size / line height
  const bodySizes = pages.map((p) => p.bodyFontSize).sort((a, b) => a - b);
  const bodyLHs = pages.map((p) => p.bodyLineHeight).sort((a, b) => a - b);
  agg.bodyFontSize = bodySizes[Math.floor(bodySizes.length / 2)] || 16;
  agg.bodyLineHeight = bodyLHs[Math.floor(bodyLHs.length / 2)] || 1.5;

  agg.fontFamilies = [...fontFamilySet];
  agg.borderRadii = [...borderRadiiSet];
  agg.shadows = [...shadowSet];
  agg.opacities = [...opacitySet];
  agg.zIndices = [...zIndexSet];

  return agg;
}

// ── Check Implementations ────────────────────────────────────────────────────

function checkTypography(styles: ExtractedStyles): DesignCheck[] {
  const checks: DesignCheck[] = [];

  // Font families
  // Filter out generic families
  const generics = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);
  const customFonts = styles.fontFamilies.filter((f) => !generics.has(f.toLowerCase()));
  checks.push({
    id: "type-font-families",
    label: "Font family count",
    dimension: "typography",
    score: customFonts.length <= TYPOGRAPHY.maxFontFamilies ? 100 : deviationScore(customFonts.length - TYPOGRAPHY.maxFontFamilies, 3),
    standard: `≤${TYPOGRAPHY.maxFontFamilies} font families`,
    actual: `${customFonts.length} font families: ${customFonts.slice(0, 4).join(", ")}`,
    deviations: customFonts.length > TYPOGRAPHY.maxFontFamilies ? [`${customFonts.length} fonts found — pick ${TYPOGRAPHY.maxFontFamilies} and kill the rest`] : [],
  });

  // Body font size
  checks.push({
    id: "type-body-size",
    label: "Body font size",
    dimension: "typography",
    score: rangeScore(styles.bodyFontSize, TYPOGRAPHY.minBodyFontSize, TYPOGRAPHY.maxBodyFontSize, 12, 28),
    standard: `${TYPOGRAPHY.minBodyFontSize}-${TYPOGRAPHY.maxBodyFontSize}px`,
    actual: `${styles.bodyFontSize}px`,
    deviations: styles.bodyFontSize < TYPOGRAPHY.minBodyFontSize ? [`Body text at ${styles.bodyFontSize}px is too small — ${TYPOGRAPHY.minBodyFontSize}px minimum`] : [],
  });

  // Distinct font sizes
  const uniqueSizes = [...new Set(styles.fontSizes.map((s) => Math.round(s)))];
  checks.push({
    id: "type-size-count",
    label: "Distinct font sizes",
    dimension: "typography",
    score: uniqueSizes.length <= TYPOGRAPHY.maxDistinctFontSizes ? 100 : deviationScore(uniqueSizes.length - TYPOGRAPHY.maxDistinctFontSizes, 8),
    standard: `≤${TYPOGRAPHY.maxDistinctFontSizes} distinct sizes (tight typographic scale)`,
    actual: `${uniqueSizes.length} sizes: ${uniqueSizes.sort((a, b) => a - b).join(", ")}px`,
    deviations: uniqueSizes.length > TYPOGRAPHY.maxDistinctFontSizes
      ? [`${uniqueSizes.length - TYPOGRAPHY.maxDistinctFontSizes} excess font sizes — consolidate to a modular scale`]
      : [],
  });

  // Modular scale check
  const sortedSizes = uniqueSizes.filter((s) => s >= 12).sort((a, b) => a - b);
  if (sortedSizes.length >= 3) {
    const ratios: number[] = [];
    for (let i = 1; i < sortedSizes.length; i++) {
      ratios.push(sortedSizes[i] / sortedSizes[i - 1]);
    }
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const ratioVariance = ratios.reduce((sum, r) => sum + Math.pow(r - avgRatio, 2), 0) / ratios.length;
    const isConsistent = ratioVariance < 0.05;
    const inRange = avgRatio >= TYPOGRAPHY.scaleRatioRange.min && avgRatio <= TYPOGRAPHY.scaleRatioRange.max;
    checks.push({
      id: "type-modular-scale",
      label: "Typographic scale consistency",
      dimension: "typography",
      score: isConsistent && inRange ? 100 : isConsistent || inRange ? 60 : 25,
      standard: `Consistent ratio between ${TYPOGRAPHY.scaleRatioRange.min}-${TYPOGRAPHY.scaleRatioRange.max} (modular scale)`,
      actual: `Average ratio ${avgRatio.toFixed(3)}, variance ${ratioVariance.toFixed(4)}`,
      deviations: !isConsistent ? ["Font sizes don't follow a consistent mathematical scale — use a modular scale calculator"] : [],
    });
  }

  // Body line height
  checks.push({
    id: "type-body-line-height",
    label: "Body line height",
    dimension: "typography",
    score: rangeScore(styles.bodyLineHeight, TYPOGRAPHY.bodyLineHeight.min, TYPOGRAPHY.bodyLineHeight.max),
    standard: `${TYPOGRAPHY.bodyLineHeight.min}-${TYPOGRAPHY.bodyLineHeight.max}`,
    actual: `${styles.bodyLineHeight.toFixed(2)}`,
    deviations: styles.bodyLineHeight < TYPOGRAPHY.bodyLineHeight.min ? ["Line height is too tight — text feels cramped"] :
               styles.bodyLineHeight > TYPOGRAPHY.bodyLineHeight.max ? ["Line height is too loose — text feels disconnected"] : [],
  });

  // Heading line heights
  if (styles.headingLineHeights.length > 0) {
    const avgHeadingLH = styles.headingLineHeights.reduce((a, b) => a + b, 0) / styles.headingLineHeights.length;
    checks.push({
      id: "type-heading-line-height",
      label: "Heading line height",
      dimension: "typography",
      score: rangeScore(avgHeadingLH, TYPOGRAPHY.headingLineHeight.min, TYPOGRAPHY.headingLineHeight.max),
      standard: `${TYPOGRAPHY.headingLineHeight.min}-${TYPOGRAPHY.headingLineHeight.max}`,
      actual: `${avgHeadingLH.toFixed(2)} (average)`,
      deviations: avgHeadingLH > TYPOGRAPHY.headingLineHeight.max ? ["Heading line heights are too loose — tighten them up"] : [],
    });
  }

  // Line length
  if (styles.lineCharCounts.length > 0) {
    const median = styles.lineCharCounts.sort((a, b) => a - b)[Math.floor(styles.lineCharCounts.length / 2)];
    checks.push({
      id: "type-line-length",
      label: "Line length (characters)",
      dimension: "typography",
      score: rangeScore(median, TYPOGRAPHY.lineLength.min, TYPOGRAPHY.lineLength.max, 20, 120),
      standard: `${TYPOGRAPHY.lineLength.min}-${TYPOGRAPHY.lineLength.max} characters per line`,
      actual: `~${median} characters (median)`,
      deviations: median > TYPOGRAPHY.lineLength.max ? ["Lines are too wide — readers lose their place. Add max-width to text containers"] :
                 median < TYPOGRAPHY.lineLength.min ? ["Lines are too narrow — feels cramped. Widen text containers"] : [],
    });
  }

  // Font weights
  const uniqueWeights = [...new Set(styles.fontWeights)];
  checks.push({
    id: "type-font-weights",
    label: "Font weight variety",
    dimension: "typography",
    score: uniqueWeights.length >= TYPOGRAPHY.fontWeights.min && uniqueWeights.length <= TYPOGRAPHY.fontWeights.max ? 100 : 60,
    standard: `${TYPOGRAPHY.fontWeights.min}-${TYPOGRAPHY.fontWeights.max} distinct weights`,
    actual: `${uniqueWeights.length} weights: ${uniqueWeights.sort((a, b) => a - b).join(", ")}`,
    deviations: uniqueWeights.length < TYPOGRAPHY.fontWeights.min ? ["Only 1 font weight — add bold for emphasis"] :
               uniqueWeights.length > TYPOGRAPHY.fontWeights.max ? ["Too many font weights — simplify to regular, medium, bold"] : [],
  });

  return checks;
}

function checkColor(styles: ExtractedStyles): DesignCheck[] {
  const checks: DesignCheck[] = [];
  const allColors = [...styles.colors, ...styles.bgColors, ...styles.borderColors];
  const unique = uniqueColors(allColors);

  // Total unique colors
  checks.push({
    id: "color-total-unique",
    label: "Total unique colors",
    dimension: "color",
    score: unique.length <= COLOR.maxUniqueColors ? 100 : deviationScore(unique.length - COLOR.maxUniqueColors, 20),
    standard: `≤${COLOR.maxUniqueColors} unique colors`,
    actual: `${unique.length} unique colors`,
    deviations: unique.length > COLOR.maxUniqueColors ? [`${unique.length - COLOR.maxUniqueColors} excess colors — consolidate to a tight palette`] : [],
  });

  // Brand vs neutral split
  const brandColors: string[] = [];
  const neutralColors: string[] = [];
  for (const hex of unique) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNeutral(r, g, b)) neutralColors.push(hex);
    else brandColors.push(hex);
  }
  checks.push({
    id: "color-brand-count",
    label: "Brand/accent colors",
    dimension: "color",
    score: brandColors.length <= COLOR.maxBrandColors ? 100 : deviationScore(brandColors.length - COLOR.maxBrandColors, 5),
    standard: `≤${COLOR.maxBrandColors} brand/accent colors (excluding neutrals)`,
    actual: `${brandColors.length} brand colors, ${neutralColors.length} neutrals`,
    deviations: brandColors.length > COLOR.maxBrandColors ? ["Too many brand colors — a strong brand uses 2-3 colors max"] : [],
  });

  // Contrast check (sample text/bg pairs)
  const textColors = uniqueColors(styles.colors).slice(0, 10);
  const bgColorsUnique = uniqueColors(styles.bgColors).slice(0, 10);
  let lowContrastPairs = 0;
  let totalPairs = 0;
  const lowContrastExamples: string[] = [];

  for (const text of textColors) {
    const textRGB = parseRGB(`rgb(${parseInt(text.slice(1, 3), 16)},${parseInt(text.slice(3, 5), 16)},${parseInt(text.slice(5, 7), 16)})`);
    if (!textRGB) continue;
    for (const bg of bgColorsUnique) {
      const bgRGB = parseRGB(`rgb(${parseInt(bg.slice(1, 3), 16)},${parseInt(bg.slice(3, 5), 16)},${parseInt(bg.slice(5, 7), 16)})`);
      if (!bgRGB) continue;
      totalPairs++;
      const ratio = contrastRatio(textRGB, bgRGB);
      if (ratio < COLOR.contrastAANormal && ratio > 1.2) {
        lowContrastPairs++;
        if (lowContrastExamples.length < 3) {
          lowContrastExamples.push(`${text} on ${bg} = ${ratio.toFixed(1)}:1`);
        }
      }
    }
  }

  const contrastScore = totalPairs > 0 ? Math.round(100 * (1 - lowContrastPairs / totalPairs)) : 100;
  checks.push({
    id: "color-contrast",
    label: "Text contrast ratios",
    dimension: "color",
    score: contrastScore,
    standard: `WCAG AA minimum (${COLOR.contrastAANormal}:1), AAA preferred (${COLOR.contrastAAANormal}:1)`,
    actual: `${lowContrastPairs}/${totalPairs} color pairs below AA threshold`,
    deviations: lowContrastExamples,
  });

  return checks;
}

function checkSpacing(styles: ExtractedStyles): DesignCheck[] {
  const checks: DesignCheck[] = [];
  const values = styles.spacingValues.filter((v) => v > 0);

  if (values.length === 0) {
    checks.push({ id: "spacing-grid", label: "Spacing grid adherence", dimension: "spacing", score: 50, standard: "All spacing on 4px grid", actual: "No spacing values extracted", deviations: [] });
    return checks;
  }

  // On-grid check
  const base = SPACING.baseUnit;
  let onGrid = 0;
  const offGridValues = new Set<number>();
  for (const v of values) {
    if (v % base <= SPACING.tolerance || (base - (v % base)) <= SPACING.tolerance) {
      onGrid++;
    } else {
      offGridValues.add(v);
    }
  }
  const gridRatio = onGrid / values.length;
  checks.push({
    id: "spacing-grid",
    label: "Spacing grid adherence",
    dimension: "spacing",
    score: Math.round(gridRatio * 100),
    standard: `≥${Math.round(SPACING.onGridThreshold * 100)}% of values on ${base}px grid`,
    actual: `${Math.round(gridRatio * 100)}% on grid (${onGrid}/${values.length})`,
    deviations: offGridValues.size > 0 ? [`Off-grid values: ${[...offGridValues].sort((a, b) => a - b).slice(0, 10).join(", ")}px`] : [],
  });

  // Distinct values
  const uniqueSpacing = [...new Set(values)];
  checks.push({
    id: "spacing-distinct",
    label: "Distinct spacing values",
    dimension: "spacing",
    score: uniqueSpacing.length <= SPACING.maxDistinctValues ? 100 : deviationScore(uniqueSpacing.length - SPACING.maxDistinctValues, 15),
    standard: `≤${SPACING.maxDistinctValues} distinct values (tight spacing scale)`,
    actual: `${uniqueSpacing.length} distinct values`,
    deviations: uniqueSpacing.length > SPACING.maxDistinctValues ? ["Too many spacing values — define a scale and stick to it"] : [],
  });

  return checks;
}

function checkLayout(styles: ExtractedStyles): DesignCheck[] {
  const checks: DesignCheck[] = [];

  // Max content width
  if (styles.maxContentWidth) {
    checks.push({
      id: "layout-max-width",
      label: "Content max-width",
      dimension: "layout",
      score: styles.maxContentWidth <= LAYOUT.maxContentWidth ? 100 : 70,
      standard: `≤${LAYOUT.maxContentWidth}px`,
      actual: `${styles.maxContentWidth}px`,
      deviations: styles.maxContentWidth > LAYOUT.maxContentWidth ? ["Content too wide — hurts readability"] : [],
    });
  }

  // Horizontal overflow
  checks.push({
    id: "layout-overflow",
    label: "No horizontal overflow",
    dimension: "layout",
    score: styles.hasHorizontalOverflow ? 0 : 100,
    standard: "No horizontal scrollbar at any viewport",
    actual: styles.hasHorizontalOverflow ? "Horizontal overflow detected" : "No overflow",
    deviations: styles.hasHorizontalOverflow ? ["Horizontal scroll detected — fix with overflow-x: hidden or fix the overflowing element"] : [],
  });

  // Images dimensioned
  const undimensioned = styles.images.filter((i) => !i.hasDimensions);
  checks.push({
    id: "layout-image-dimensions",
    label: "Images have explicit dimensions",
    dimension: "layout",
    score: styles.images.length > 0 ? Math.round(100 * (1 - undimensioned.length / styles.images.length)) : 100,
    standard: "All images have width/height or aspect-ratio to prevent layout shift",
    actual: `${undimensioned.length}/${styles.images.length} images missing dimensions`,
    deviations: undimensioned.slice(0, 3).map((i) => `Missing dimensions: ${i.src.slice(0, 60)}`),
  });

  // Z-index discipline
  checks.push({
    id: "layout-z-index",
    label: "Z-index discipline",
    dimension: "layout",
    score: styles.zIndices.length <= LAYOUT.maxDistinctZIndices ? 100 : deviationScore(styles.zIndices.length - LAYOUT.maxDistinctZIndices, 10),
    standard: `≤${LAYOUT.maxDistinctZIndices} distinct z-index values`,
    actual: `${styles.zIndices.length} values: ${styles.zIndices.sort((a, b) => a - b).join(", ")}`,
    deviations: styles.zIndices.length > LAYOUT.maxDistinctZIndices ? ["Too many z-index values — define a z-index scale"] : [],
  });

  return checks;
}

function checkInteraction(styles: ExtractedStyles): DesignCheck[] {
  const checks: DesignCheck[] = [];
  const interactive = styles.interactiveElements;

  if (interactive.length === 0) return checks;

  // Focus indicators
  const withFocus = interactive.filter((e) => e.hasFocusIndicator);
  checks.push({
    id: "interaction-focus",
    label: "Focus indicators",
    dimension: "interaction",
    score: interactive.length > 0 ? Math.round(100 * withFocus.length / interactive.length) : 100,
    standard: "100% of interactive elements have visible focus indicators",
    actual: `${withFocus.length}/${interactive.length} have focus indicators`,
    deviations: withFocus.length < interactive.length ? [`${interactive.length - withFocus.length} elements lack focus indicators — keyboard users can't see where they are`] : [],
  });

  // Touch targets
  const tooSmall = interactive.filter((e) => e.width > 0 && e.height > 0 && (e.width < INTERACTION.minTouchTarget || e.height < INTERACTION.minTouchTarget));
  checks.push({
    id: "interaction-touch-target",
    label: "Touch target size",
    dimension: "interaction",
    score: interactive.length > 0 ? Math.round(100 * (1 - tooSmall.length / interactive.length)) : 100,
    standard: `≥${INTERACTION.minTouchTarget}x${INTERACTION.minTouchTarget}px for all interactive elements`,
    actual: `${tooSmall.length} elements below minimum`,
    deviations: tooSmall.slice(0, 3).map((e) => `${e.tag} is ${e.width}x${e.height}px — too small for touch`),
  });

  // Pointer cursor
  const missingPointer = interactive.filter((e) => e.cursor !== "pointer" && e.tag !== "input" && e.tag !== "textarea" && e.tag !== "select");
  checks.push({
    id: "interaction-cursor",
    label: "Pointer cursor on clickables",
    dimension: "interaction",
    score: interactive.length > 0 ? Math.round(100 * (1 - missingPointer.length / interactive.length)) : 100,
    standard: "All clickable elements show pointer cursor",
    actual: `${missingPointer.length} clickable elements don't show pointer cursor`,
    deviations: missingPointer.length > 0 ? [`${missingPointer.length} elements use default cursor — add cursor: pointer`] : [],
  });

  // Transition durations
  if (styles.transitionDurations.length > 0) {
    const outOfRange = styles.transitionDurations.filter(
      (d) => d < INTERACTION.transitionDuration.min || d > INTERACTION.transitionDuration.max,
    );
    checks.push({
      id: "interaction-transitions",
      label: "Transition timing",
      dimension: "interaction",
      score: Math.round(100 * (1 - outOfRange.length / styles.transitionDurations.length)),
      standard: `${INTERACTION.transitionDuration.min}-${INTERACTION.transitionDuration.max}ms`,
      actual: `${outOfRange.length}/${styles.transitionDurations.length} transitions out of range`,
      deviations: outOfRange.length > 0 ? [`Transitions outside ${INTERACTION.transitionDuration.min}-${INTERACTION.transitionDuration.max}ms feel unnatural`] : [],
    });
  }

  return checks;
}

function checkPerformance(styles: ExtractedStyles): DesignCheck[] {
  const checks: DesignCheck[] = [];

  // CLS
  checks.push({
    id: "perf-cls",
    label: "Cumulative Layout Shift",
    dimension: "performance",
    score: styles.cls <= PERFORMANCE.maxCLS ? 100 : styles.cls < 0.1 ? 70 : styles.cls < 0.25 ? 40 : 0,
    standard: `CLS = ${PERFORMANCE.maxCLS} (zero layout shift)`,
    actual: `CLS = ${styles.cls.toFixed(4)}`,
    deviations: styles.cls > 0 ? ["Layout shifts are visible design failures — elements jump around as the page loads. Fix image dimensions, font loading, and dynamic content injection"] : [],
  });

  // Font display
  const hasFontSwap = styles.fontDisplay.some((d) => d === "swap" || d === "fallback" || d === "optional");
  checks.push({
    id: "perf-font-loading",
    label: "Font loading strategy",
    dimension: "performance",
    score: hasFontSwap || styles.fontDisplay.length === 0 ? 80 : 40,
    standard: "font-display: swap/fallback/optional to prevent invisible text",
    actual: styles.fontDisplay.length > 0 ? `font-display: ${[...new Set(styles.fontDisplay)].join(", ")}` : "No @font-face rules detected (may use system fonts or preloaded)",
    deviations: [],
  });

  // Images preventing reflow
  const imgsWithoutDims = styles.images.filter((i) => !i.hasDimensions);
  checks.push({
    id: "perf-image-reflow",
    label: "Images prevent reflow",
    dimension: "performance",
    score: styles.images.length > 0 ? Math.round(100 * (1 - imgsWithoutDims.length / styles.images.length)) : 100,
    standard: "All images have width+height or CSS aspect-ratio",
    actual: `${imgsWithoutDims.length}/${styles.images.length} images could cause reflow`,
    deviations: imgsWithoutDims.slice(0, 2).map((i) => `${i.src.slice(0, 50)} — add width/height attributes`),
  });

  return checks;
}

function checkConsistency(styles: ExtractedStyles): DesignCheck[] {
  const checks: DesignCheck[] = [];

  // Border radii
  checks.push({
    id: "consistency-border-radius",
    label: "Border radius consistency",
    dimension: "consistency",
    score: styles.borderRadii.length <= CONSISTENCY.maxDistinctBorderRadii ? 100 :
           deviationScore(styles.borderRadii.length - CONSISTENCY.maxDistinctBorderRadii, 6),
    standard: `≤${CONSISTENCY.maxDistinctBorderRadii} distinct border-radius values`,
    actual: `${styles.borderRadii.length} values: ${styles.borderRadii.sort((a, b) => a - b).join(", ")}px`,
    deviations: styles.borderRadii.length > CONSISTENCY.maxDistinctBorderRadii ? ["Too many border-radius values — pick 2-3 sizes and standardize"] : [],
  });

  // Shadows
  checks.push({
    id: "consistency-shadows",
    label: "Box shadow consistency",
    dimension: "consistency",
    score: styles.shadows.length <= CONSISTENCY.maxDistinctShadows ? 100 :
           deviationScore(styles.shadows.length - CONSISTENCY.maxDistinctShadows, 6),
    standard: `≤${CONSISTENCY.maxDistinctShadows} distinct shadow definitions`,
    actual: `${styles.shadows.length} distinct shadows`,
    deviations: styles.shadows.length > CONSISTENCY.maxDistinctShadows ? ["Too many shadow variants — define sm/md/lg/xl and reuse them"] : [],
  });

  // Opacity values
  checks.push({
    id: "consistency-opacity",
    label: "Opacity consistency",
    dimension: "consistency",
    score: styles.opacities.length <= CONSISTENCY.maxDistinctOpacities ? 100 :
           deviationScore(styles.opacities.length - CONSISTENCY.maxDistinctOpacities, 8),
    standard: `≤${CONSISTENCY.maxDistinctOpacities} distinct opacity values`,
    actual: `${styles.opacities.length} values: ${styles.opacities.sort((a, b) => a - b).join(", ")}`,
    deviations: styles.opacities.length > CONSISTENCY.maxDistinctOpacities ? ["Too many opacity values — standardize to a few intentional levels"] : [],
  });

  return checks;
}

function checkPolish(styles: ExtractedStyles): DesignCheck[] {
  const checks: DesignCheck[] = [];

  // Favicon
  checks.push({
    id: "polish-favicon",
    label: "Favicon present",
    dimension: "polish",
    score: styles.hasFavicon ? 100 : 0,
    standard: "Site has a favicon",
    actual: styles.hasFavicon ? "Favicon found" : "No favicon",
    deviations: !styles.hasFavicon ? ["Missing favicon — the most visible sign of an unfinished site"] : [],
  });

  // All images have alt
  const missingAlt = styles.images.filter((i) => !i.hasAlt);
  checks.push({
    id: "polish-image-alt",
    label: "Image alt attributes",
    dimension: "polish",
    score: styles.images.length > 0 ? Math.round(100 * (1 - missingAlt.length / styles.images.length)) : 100,
    standard: "All images have alt text (empty string for decorative is OK)",
    actual: `${missingAlt.length}/${styles.images.length} missing alt`,
    deviations: missingAlt.slice(0, 3).map((i) => `Missing alt: ${i.src.slice(0, 50)}`),
  });

  // Broken images
  const brokenImages = styles.images.filter((i) => i.src && i.naturalWidth === 0);
  checks.push({
    id: "polish-broken-images",
    label: "No broken images",
    dimension: "polish",
    score: brokenImages.length === 0 ? 100 : deviationScore(brokenImages.length, 5),
    standard: "Zero broken images",
    actual: `${brokenImages.length} broken images`,
    deviations: brokenImages.slice(0, 3).map((i) => `Broken: ${i.src.slice(0, 60)}`),
  });

  return checks;
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

export type DesignProgressCallback = (progress: {
  evaluated: number;
  total: number;
  currentUrl: string;
}) => void;

export async function evaluateDesign(
  crawlResult: CrawlResult,
  options: {
    maxPages?: number;
    viewport?: { width: number; height: number };
    captureScreenshots?: boolean;
  } = {},
  onProgress?: DesignProgressCallback,
): Promise<{ score: DesignScore; screenshots: Array<{ url: string; screenshotBase64: string }> }> {
  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const captureScreenshots = options.captureScreenshots ?? false;

  // Evaluate ALL valid pages — design perfection means every page, not a sample.
  // If maxPages is explicitly set, respect it. Otherwise: all pages.
  const allUrls = [...crawlResult.pages.keys()].filter((url) => {
    const node = crawlResult.pages.get(url);
    return node && node.statusCode >= 200 && node.statusCode < 300;
  });
  const urls = options.maxPages ? allUrls.slice(0, options.maxPages) : allUrls;

  if (urls.length === 0) {
    throw new Error("No valid pages to evaluate design on");
  }

  const browser = await chromium.launch({ headless: true });
  const pageStyles: ExtractedStyles[] = [];
  const screenshots: Array<{ url: string; screenshotBase64: string }> = [];

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      onProgress?.({ evaluated: i + 1, total: urls.length, currentUrl: url });

      const page = await browser.newPage({ viewport });
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        // Wait for fonts and images to load
        await page.waitForTimeout(1000);
        const extracted = await extractFromPage(page, url);
        pageStyles.push(extracted);

        // Capture screenshots for AI evaluation
        if (captureScreenshots) {
          const buf = await page.screenshot({ fullPage: true, type: "png" });
          screenshots.push({ url, screenshotBase64: buf.toString("base64") });
        }
      } catch (err) {
        // Log but continue — one failed page shouldn't kill the whole evaluation
        console.error(`  Warning: failed to evaluate ${url}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (pageStyles.length === 0) {
    throw new Error("Failed to extract styles from any page");
  }

  // Aggregate styles across all pages
  const agg = aggregateStyles(pageStyles);

  // Run all checks
  const allChecks: DesignCheck[] = [
    ...checkTypography(agg),
    ...checkColor(agg),
    ...checkSpacing(agg),
    ...checkLayout(agg),
    ...checkInteraction(agg),
    ...checkPerformance(agg),
    ...checkConsistency(agg),
    ...checkPolish(agg),
  ];

  // Compute dimension scores
  const dimensions: DimensionScore[] = [];
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    const dimChecks = allChecks.filter((c) => c.dimension === dim);
    const avgScore = dimChecks.length > 0
      ? Math.round(dimChecks.reduce((sum, c) => sum + c.score, 0) / dimChecks.length)
      : 0;
    dimensions.push({
      dimension: dim as DesignDimension,
      score: avgScore,
      weight,
      weightedScore: Math.round((avgScore * weight) / 100),
      checks: dimChecks,
    });
  }

  // Overall weighted score
  const totalWeight = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
  const overall = Math.round(dimensions.reduce((sum, d) => sum + d.weightedScore, 0) * 100 / totalWeight);

  // Sort checks by score ascending (worst first)
  allChecks.sort((a, b) => a.score - b.score);

  const score: DesignScore = {
    overall,
    perfect: overall >= PERFECTION_THRESHOLD,
    acceptable: overall >= ACCEPTABLE_THRESHOLD,
    dimensions,
    allChecks,
    topIssues: allChecks.filter((c) => c.score < 80).slice(0, 10),
    pagesEvaluated: pageStyles.length,
    evaluatedAt: new Date().toISOString(),
  };

  return { score, screenshots };
}
