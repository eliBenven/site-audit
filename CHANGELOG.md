# Changelog

## [1.0.0] - 2026-03-15

### Added
- **Crawler**: Playwright-based website crawler with HTML fallback mode
  - Robots.txt parsing and respect
  - Retry logic for transient failures
  - `<base href>` tag support
  - TTFB and response time tracking per page
  - Custom User-Agent, include/exclude patterns, cookie support
  - Progress callback API
- **SEO Checker**: 20+ rule checks using cheerio for reliable HTML parsing
  - Title, meta description, H1, heading hierarchy
  - Open Graph, Twitter Cards, canonical tags
  - Structured data, viewport, lang attribute
  - Mixed content, redirect chains, status codes
  - Cross-page duplicate detection
- **Site-Level Checks**: robots.txt, sitemap.xml, security headers
- **External Link Checker**: Rate-limited by domain, retry with HEAD-to-GET fallback
- **Accessibility Checker**: Form labels, landmarks, skip-nav, tabindex
- **Content Analyzer**: Near-duplicate detection via MinHash
- **Resource Analyzer**: Render-blocking scripts (framework-aware), third-party domains
- **Image Checker**: Format optimization, file size checks via HEAD requests
- **Lighthouse Runner**: CWV extraction, performance scoring, opportunity detection
- **Design Evaluator** (beta): Universal design perfection standard
  - Typography, color, spacing, layout, interaction, performance, consistency, polish
  - Playwright-based computed style extraction across all pages
  - AI visual evaluation layer via Claude API
- **AI Analysis**: Executive summary, per-page insights, detailed fix instructions via Anthropic Claude API
- **Reporter**: JSON + self-contained HTML reports with ranked fix list (Impact x Effort scoring)
- **CLI**: `audit`, `crawl`, `design`, `report`, `history`, `diff` commands
  - `--json` stdout output, `--ci` mode, `--fail-on` CI gate
  - `--pdf` export via Playwright
- **History**: Timestamped audit snapshots with diff comparison
