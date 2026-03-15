# Contributing to site-audit

Thank you for your interest in contributing to site-audit! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js >= 18
- Google Chrome (for Lighthouse audits)
- Git

### Getting Started

```bash
# Fork and clone the repository
git clone https://github.com/<your-username>/site-audit.git
cd site-audit

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Build the project
npm run build

# Run tests
npm test
```

### Development Workflow

```bash
# Watch mode for TypeScript compilation
npm run dev

# Type check without emitting
npm run typecheck

# Run a quick test audit
node dist/cli.js audit https://example.com --skip-lighthouse --depth 1 --max-pages 5
```

## Project Structure

```
src/
  cli.ts                 CLI entry point (Commander)
  crawler.ts             Playwright-based website crawler
  seo-checker.ts         SEO rule engine
  lighthouse-runner.ts   Lighthouse CWV runner
  reporter.ts            JSON + HTML report generator
  types.ts               Shared TypeScript types
  site-checker.ts        Site-level checks (robots.txt, sitemap, headers)
  link-checker.ts        External link validation
  accessibility-checker.ts  Accessibility checks
  crawl-analyzer.ts      Crawl graph analysis
  resource-analyzer.ts   Resource optimization analysis
  content-analyzer.ts    Content quality analysis
  image-checker.ts       Image optimization checks
  design-evaluator.ts    Visual design scoring
  design-ai.ts           AI-powered design evaluation
  design-spec.ts         Design specification constants
  ai-analyzer.ts         AI-powered audit analysis
```

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/elibenveniste/site-audit/issues)
2. If not, create a new issue using the bug report template
3. Include reproduction steps, expected behavior, and actual behavior

### Suggesting Features

1. Open an issue using the feature request template
2. Describe the use case and why it would be valuable
3. If possible, sketch out how the feature might work

### Submitting Pull Requests

1. Fork the repository and create a branch from `main`
2. Name your branch descriptively: `feature/add-schema-validation`, `fix/broken-link-timeout`
3. Make your changes, following the coding standards below
4. Add or update tests for your changes
5. Ensure all tests pass: `npm test`
6. Ensure type checking passes: `npm run typecheck`
7. Submit a pull request using the PR template

## Coding Standards

### TypeScript

- Use strict TypeScript — no `any` types unless absolutely necessary
- Define interfaces and types in `types.ts` for shared types
- Use `import type` for type-only imports
- Prefer `const` over `let`; never use `var`

### Code Style

- Use 2-space indentation
- Use double quotes for strings
- Include trailing commas in multi-line arrays and objects
- Add JSDoc comments to exported functions

### Testing

- Write tests using Vitest
- Place tests in the `__tests__/` directory
- Name test files to match source files: `seo-checker.test.ts`
- Test both success and failure cases

### Commit Messages

- Use present tense: "Add feature" not "Added feature"
- Keep the first line under 72 characters
- Reference issue numbers when applicable: "Fix timeout in link checker (#42)"

### Adding a New Checker Module

If you are adding a new analysis module:

1. Create the module in `src/` with a clear name (e.g., `schema-checker.ts`)
2. Export a main function that accepts `CrawlResult` and returns issues
3. Define any new types in `types.ts`
4. Integrate it into the audit pipeline in `cli.ts`
5. Add the results to the reporter in `reporter.ts`
6. Write tests in `__tests__/`
7. Update the README with the new feature

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Questions?

If you have questions about contributing, open a discussion or issue on GitHub.
