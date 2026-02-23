# site-audit

A comprehensive website auditing CLI tool. Crawls your site with Playwright, runs SEO checks, measures Core Web Vitals with Lighthouse, and generates a prioritised HTML report.

## What it does

- **Crawls** your website using Playwright (rendered JS) or plain HTTP, building a full internal link graph
- **Detects SEO issues**: missing titles, meta descriptions, H1 tags, broken images, missing alt text, canonical tags, HTTP errors
- **Measures performance**: runs Lighthouse on sampled pages, extracts LCP, INP, CLS, and optimisation opportunities
- **Generates reports**: a self-contained HTML report with a ranked fix list (Impact x Effort scoring), plus raw JSON export

## Quickstart

```bash
npx site-audit audit https://example.com --skip-lighthouse
```

See [QUICKSTART.md](./QUICKSTART.md) for a full walkthrough.

## Installation

```bash
# Clone and install
git clone <repo-url> && cd site-audit
npm install
npm run build

# Or run directly with npx after building
npx site-audit audit https://example.com
```

### Prerequisites

- Node.js >= 18
- Google Chrome (for Lighthouse)
- Playwright browsers: `npx playwright install chromium`

## CLI Reference

### `site-audit crawl <url>`

Crawl a website and save the site graph as JSON.

| Flag | Default | Description |
|------|---------|-------------|
| `-d, --depth <n>` | `3` | Maximum crawl depth |
| `-p, --max-pages <n>` | `50` | Maximum pages to crawl |
| `-m, --mode <mode>` | `rendered` | `rendered` (Playwright) or `html` (plain HTTP) |
| `-c, --concurrency <n>` | `5` | Concurrent page fetches |
| `-o, --output <dir>` | `./site-audit-output` | Output directory |

### `site-audit audit <url>`

Full pipeline: crawl + SEO checks + Lighthouse + HTML report.

| Flag | Default | Description |
|------|---------|-------------|
| `-d, --depth <n>` | `3` | Maximum crawl depth |
| `-p, --max-pages <n>` | `50` | Maximum pages to crawl |
| `-m, --mode <mode>` | `rendered` | `rendered` or `html` |
| `-c, --concurrency <n>` | `5` | Concurrent page fetches |
| `-s, --lighthouse-samples <n>` | `5` | Number of pages to run Lighthouse on |
| `-f, --form-factor <factor>` | `mobile` | `mobile` or `desktop` |
| `--skip-lighthouse` | `false` | Skip Lighthouse (faster, SEO-only) |
| `-o, --output <dir>` | `./site-audit-output` | Output directory |

### `site-audit report <json-file>`

Re-generate an HTML report from a previous `report.json` export.

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <dir>` | `.` | Output directory |

## Output

### `report.json`

Structured audit data including:
- Crawl metadata (pages, orphans, status codes, redirect chains)
- SEO issues per page with severity levels
- Lighthouse CWV (p50/p95), performance scores, and opportunities
- Ranked fix list with impact/effort scoring

### `report.html`

Self-contained HTML file with:
- Crawl summary dashboard
- Status code distribution
- Ranked fix table sorted by priority score
- Per-page SEO issues with severity badges
- Lighthouse CWV summary and per-page scores

## Architecture

```
src/
  cli.ts              CLI entry point (Commander)
  crawler.ts          Playwright-based website crawler
  seo-checker.ts      SEO rule engine
  lighthouse-runner.ts  Lighthouse CWV runner
  reporter.ts         JSON + HTML report generator
  types.ts            Shared TypeScript types
```

## License

MIT
