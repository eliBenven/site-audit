/**
 * Google Search Console integration framework.
 *
 * Provides types and a client stub for enriching audit reports with
 * real search performance data (clicks, impressions, CTR, position).
 *
 * Requires a GSC service account JSON key file and a verified property.
 * Set GOOGLE_APPLICATION_CREDENTIALS env var to the key path.
 */

export interface GscQueryRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscPageMetrics {
  url: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  topQueries: Array<{ query: string; clicks: number; impressions: number }>;
}

export interface GscResult {
  siteUrl: string;
  dateRange: { start: string; end: string };
  pages: GscPageMetrics[];
}

/**
 * Fetch GSC search analytics for a site.
 *
 * This is a framework stub. To implement:
 * 1. npm install googleapis
 * 2. Authenticate via service account or OAuth
 * 3. Call searchanalytics.query with dimensions: [query, page]
 *
 * @throws if GOOGLE_APPLICATION_CREDENTIALS is not set
 */
export async function fetchGscData(
  siteUrl: string,
  _options: { days?: number } = {},
): Promise<GscResult> {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error(
      "GSC integration requires GOOGLE_APPLICATION_CREDENTIALS env var. " +
      "See https://developers.google.com/search/apis/indexing-api/v3/prereqs for setup.",
    );
  }

  // Framework stub - replace with actual googleapis calls
  throw new Error(
    `GSC integration not yet implemented. Credentials found at ${credPath}. ` +
    "Install googleapis and implement the searchanalytics.query call.",
  );
}
