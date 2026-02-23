# Quickstart

Get a full website audit in one command.

## Prerequisites

- Node.js >= 18
- Google Chrome installed (for Lighthouse)

## Setup

```bash
git clone <repo-url> && cd site-audit
npm install
npm run build
npx playwright install chromium
```

## One-command demo

Run a full audit (SEO only, no Lighthouse for speed):

```bash
npx site-audit audit https://example.com --skip-lighthouse --depth 2 --max-pages 10
```

This will:
1. Crawl `https://example.com` up to depth 2 (max 10 pages)
2. Check every page for SEO issues (titles, meta tags, headings, images)
3. Generate `./site-audit-output/report.json` and `./site-audit-output/report.html`

Open the HTML report:

```bash
open ./site-audit-output/report.html
```

## Full audit with Lighthouse

To include Core Web Vitals and performance data:

```bash
npx site-audit audit https://example.com --lighthouse-samples 3
```

## Crawl only

If you just want the site graph without SEO checks or reports:

```bash
npx site-audit crawl https://example.com --depth 2 --max-pages 20
```

## Re-generate a report

If you already have a `report.json`, regenerate the HTML:

```bash
npx site-audit report ./site-audit-output/report.json -o ./new-report
```
