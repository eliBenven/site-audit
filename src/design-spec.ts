/**
 * Universal Design Perfection Specification.
 *
 * This is NOT configurable. It defines what design perfection looks like
 * across every dimension — typography, color, spacing, layout, interaction,
 * and visual polish. A site either meets the standard or it doesn't.
 *
 * The principles here are derived from:
 * - Typographic scale theory (modular scales)
 * - WCAG AAA accessibility standards
 * - Gestalt principles of visual perception
 * - Material Design / Apple HIG spacing systems
 * - Empirical readability research (line length, line height)
 * - Performance-as-design (CLS, font loading, image stability)
 */

// ── Typography ───────────────────────────────────────────────────────────────

export const TYPOGRAPHY = {
  /** Maximum number of font families. 1 is ideal, 2 is acceptable. */
  maxFontFamilies: 2,

  /** Body text must be at least this size (px). Anything smaller is unreadable. */
  minBodyFontSize: 16,

  /** Body text should not exceed this size (px). */
  maxBodyFontSize: 21,

  /** Maximum distinct font sizes across the entire site. A tight scale. */
  maxDistinctFontSizes: 8,

  /**
   * Font sizes must follow a modular scale. The ratio between consecutive
   * sizes should be within this range. Common ratios: 1.2 (minor third),
   * 1.25 (major third), 1.333 (perfect fourth), 1.5 (perfect fifth).
   */
  scaleRatioRange: { min: 1.125, max: 1.618 } as const,

  /** Body line height range (unitless). Research says 1.4-1.6 is optimal. */
  bodyLineHeight: { min: 1.4, max: 1.65 } as const,

  /** Heading line height range (unitless). Tighter than body. */
  headingLineHeight: { min: 1.05, max: 1.35 } as const,

  /** Optimal line length in characters. 45-75 is the readability sweet spot. */
  lineLength: { min: 45, max: 75 } as const,

  /** Font weight range: at least 2 weights used (regular + bold), no more than 4. */
  fontWeights: { min: 2, max: 4 } as const,
} as const;

// ── Color ────────────────────────────────────────────────────────────────────

export const COLOR = {
  /** Maximum unique colors across the entire site (including shades). */
  maxUniqueColors: 16,

  /** Maximum brand/accent colors (excluding neutrals/grays). */
  maxBrandColors: 5,

  /** WCAG AAA contrast ratio for normal text. */
  contrastAAANormal: 7,

  /** WCAG AAA contrast ratio for large text (≥18px bold or ≥24px). */
  contrastAAALarge: 4.5,

  /** WCAG AA contrast ratio (minimum acceptable). */
  contrastAANormal: 4.5,

  /**
   * Minimum perceptual distance (CIE ΔE2000) between any two colors in
   * the palette. If two colors are closer than this, they're redundant.
   */
  minColorDistance: 8,

  /**
   * Neutral colors (grays) should form a consistent ramp.
   * Maximum deviation from a linear lightness progression.
   */
  neutralRampTolerance: 10,
} as const;

// ── Spacing ──────────────────────────────────────────────────────────────────

export const SPACING = {
  /**
   * The base unit (px). All spacing should be a multiple of this.
   * 4px is the industry standard (Material, Tailwind, etc.).
   */
  baseUnit: 4,

  /**
   * Tolerance in px for off-scale values. Accounts for browser rounding,
   * border widths, etc. 0 = perfection, 2 = reasonable.
   */
  tolerance: 2,

  /** Maximum distinct spacing values. A tight system uses 10-16. */
  maxDistinctValues: 16,

  /**
   * Percentage of all measured spacing values that must be on the
   * base-unit grid. 100% = perfect, 90%+ = excellent.
   */
  onGridThreshold: 0.90,
} as const;

// ── Layout ───────────────────────────────────────────────────────────────────

export const LAYOUT = {
  /** Maximum content width (px). Prevents unreadable wide lines. */
  maxContentWidth: 1440,

  /** Content should have a max-width set. */
  requireMaxWidth: true,

  /** No horizontal scrollbar at any viewport width. */
  noHorizontalOverflow: true,

  /** Required responsive breakpoints (minimum set). */
  requiredBreakpoints: {
    /** Mobile-first: content works at 320px+ */
    minViewport: 320,
    /** Must have at least one breakpoint below this width */
    tabletBelow: 900,
  },

  /** Images must have explicit dimensions or aspect-ratio to prevent reflow. */
  imagesDimensioned: true,

  /** Z-index values should be from a defined scale, not arbitrary numbers. */
  maxDistinctZIndices: 6,
} as const;

// ── Interaction ──────────────────────────────────────────────────────────────

export const INTERACTION = {
  /** Every interactive element must have a distinct hover state. */
  requireHoverStates: true,

  /** Every interactive element must have a visible focus indicator. */
  requireFocusIndicators: true,

  /** Focus indicators must have at least this contrast against background. */
  focusIndicatorContrast: 3,

  /** Transition duration range (ms). Too fast = jarring, too slow = sluggish. */
  transitionDuration: { min: 100, max: 400 } as const,

  /** Minimum touch target size (px). Apple says 44, Google says 48. We say 44. */
  minTouchTarget: 44,

  /** Cursor must change to pointer on clickable elements. */
  requirePointerCursor: true,
} as const;

// ── Performance as Design ────────────────────────────────────────────────────

export const PERFORMANCE = {
  /** Cumulative Layout Shift must be zero. Layout shifts are design failures. */
  maxCLS: 0.0,

  /** No flash of unstyled text. Fonts must load without visible swap. */
  noFOUT: true,

  /** All images must have width/height attributes or CSS aspect-ratio. */
  imagesPreventReflow: true,

  /** Largest Contentful Paint threshold (ms). */
  maxLCP: 2500,
} as const;

// ── Visual Consistency ───────────────────────────────────────────────────────

export const CONSISTENCY = {
  /** Border radius values should come from a defined set. Max distinct values. */
  maxDistinctBorderRadii: 4,

  /** Shadow definitions should come from a defined set. Max distinct shadows. */
  maxDistinctShadows: 4,

  /** Opacity values should be intentional, not arbitrary. Max distinct values. */
  maxDistinctOpacities: 6,

  /**
   * Component pattern consistency: similar components (cards, buttons, etc.)
   * must share the same styles. Measured as % of style properties that match
   * across instances of the same component type.
   */
  componentConsistencyThreshold: 0.95,
} as const;

// ── Polish ───────────────────────────────────────────────────────────────────

export const POLISH = {
  /** Favicon must be present. */
  requireFavicon: true,

  /** No broken/missing images. */
  noBrokenImages: true,

  /** All images must have alt text (empty string for decorative is OK). */
  allImagesHaveAlt: true,

  /** Consistent image aspect ratios within card grids / repeating components. */
  consistentImageAspectRatios: true,

  /** No text selection color that clashes with the design. */
  intentionalSelectionColor: true,

  /** Scrollbar should be styled or hidden (not default browser chrome). */
  styledScrollbar: false, // Controversial — false by default

  /** Print stylesheet or at least not broken when printed. */
  printFriendly: false, // Nice to have, not perfection-blocking
} as const;

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Each dimension has a weight. These determine how much each category
 * contributes to the overall design score.
 */
export const DIMENSION_WEIGHTS = {
  typography: 20,
  color: 15,
  spacing: 15,
  layout: 15,
  interaction: 10,
  performance: 10,
  consistency: 10,
  polish: 5,
} as const;

export type DesignDimension = keyof typeof DIMENSION_WEIGHTS;

/** The threshold for "perfection". Below this = not done. */
export const PERFECTION_THRESHOLD = 95;

/** The threshold for "acceptable". Below this = significant issues. */
export const ACCEPTABLE_THRESHOLD = 75;

// ── Score Types ──────────────────────────────────────────────────────────────

export interface DesignCheck {
  /** Machine-readable check ID. */
  id: string;
  /** Human-readable description. */
  label: string;
  /** Which dimension this belongs to. */
  dimension: DesignDimension;
  /** 0-100 score for this individual check. */
  score: number;
  /** What perfection looks like for this check. */
  standard: string;
  /** What was actually found. */
  actual: string;
  /** Specific items to fix, if any. */
  deviations: string[];
}

export interface DimensionScore {
  dimension: DesignDimension;
  score: number;
  weight: number;
  weightedScore: number;
  checks: DesignCheck[];
}

export interface DesignScore {
  /** Overall weighted score 0-100. */
  overall: number;
  /** Pass/fail against perfection threshold. */
  perfect: boolean;
  /** Pass/fail against acceptable threshold. */
  acceptable: boolean;
  /** Per-dimension breakdown. */
  dimensions: DimensionScore[];
  /** Flat list of all checks, sorted by score ascending (worst first). */
  allChecks: DesignCheck[];
  /** Top issues to fix, in priority order. */
  topIssues: DesignCheck[];
  /** Pages evaluated. */
  pagesEvaluated: number;
  /** Timestamp. */
  evaluatedAt: string;
}
