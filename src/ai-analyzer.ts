/**
 * AI-powered audit analysis module.
 *
 * Uses the Anthropic Claude API to generate:
 * - Executive summary of the entire audit
 * - Per-page content quality and SEO recommendations
 * - Detailed, actionable fix instructions for top issues
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AiInsights, AuditReport, RankedFix, SeoPageResult } from "./types.js";

const MODEL = "claude-sonnet-4-20250514";

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "AI analysis requires ANTHROPIC_API_KEY env var. " +
      "Get a key at https://console.anthropic.com/",
    );
  }
  return new Anthropic({ apiKey: key });
}

// ── Executive Summary ────────────────────────────────────────────────────────

async function generateExecutiveSummary(
  client: Anthropic,
  report: AuditReport,
): Promise<string> {
  const seoSnapshot = {
    totalPages: report.crawl.totalPages,
    orphans: report.crawl.orphanPages.length,
    errors: report.seo.summary.error,
    warnings: report.seo.summary.warning,
    info: report.seo.summary.info,
    statusCodes: report.crawl.statusCodeDistribution,
    avgTtfb: report.crawl.avgTtfb,
    topFixes: report.rankedFixes.slice(0, 10).map((f) => ({
      title: f.title,
      impact: f.impact,
      effort: f.effort,
      pages: f.affectedUrls.length,
      category: f.category,
    })),
    lighthouseAvgScore: report.lighthouse?.pages
      ? Math.round(
          report.lighthouse.pages
            .filter((p) => p.performanceScore !== null)
            .reduce((sum, p) => sum + (p.performanceScore ?? 0), 0) /
          Math.max(1, report.lighthouse.pages.filter((p) => p.performanceScore !== null).length),
        )
      : null,
    brokenExternalLinks: report.externalLinks?.broken ?? 0,
    accessibilityIssues: report.accessibility?.issues.length ?? 0,
  };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are an expert SEO and web performance consultant. Write a concise executive summary (3-5 paragraphs) of this website audit for ${report.startUrl}.

Audit data:
${JSON.stringify(seoSnapshot, null, 2)}

Focus on:
1. Overall health assessment (good/needs work/critical)
2. The most impactful issues that need immediate attention
3. Quick wins (high impact, low effort fixes)
4. Performance assessment if Lighthouse data is available
5. A prioritized action plan

Be direct, specific, and actionable. Use plain language, not jargon. Reference specific numbers from the data.`,
      },
    ],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

// ── Page-Level Insights ──────────────────────────────────────────────────────

async function generatePageInsights(
  client: Anthropic,
  pages: SeoPageResult[],
  startUrl: string,
): Promise<AiInsights["pageInsights"]> {
  // Sample up to 10 pages to keep API costs reasonable
  const sample = pages.slice(0, 10);

  const pageData = sample.map((p) => ({
    url: p.url,
    title: p.title,
    metaDescription: p.metaDescription,
    h1Count: p.h1Count,
    issueCount: p.issues.length,
    issues: p.issues.map((i) => `${i.severity}: ${i.rule} - ${i.message}`),
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are an SEO expert reviewing pages from ${startUrl}. For each page, provide:
1. A content quality assessment (1-2 sentences)
2. 2-3 specific SEO recommendations

Pages:
${JSON.stringify(pageData, null, 2)}

Respond in this exact JSON format (no markdown, just raw JSON):
[
  {
    "url": "...",
    "contentQuality": "...",
    "seoRecommendations": ["...", "..."]
  }
]`,
      },
    ],
  });

  const text = response.content[0];
  if (text.type !== "text") return [];

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonStr = text.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr) as AiInsights["pageInsights"];
  } catch {
    return [];
  }
}

// ── Fix Instructions ─────────────────────────────────────────────────────────

async function generateFixInstructions(
  client: Anthropic,
  fixes: RankedFix[],
  startUrl: string,
): Promise<AiInsights["fixInstructions"]> {
  // Top 10 fixes
  const topFixes = fixes.slice(0, 10).map((f) => ({
    rule: f.title.toLowerCase().replace(/\s+/g, "-"),
    title: f.title,
    description: f.description,
    impact: f.impact,
    effort: f.effort,
    affectedPages: f.affectedUrls.length,
    category: f.category,
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content: `You are a senior web developer. For each of these audit issues found on ${startUrl}, provide detailed step-by-step fix instructions that a developer can follow.

Issues:
${JSON.stringify(topFixes, null, 2)}

Respond in this exact JSON format (no markdown, just raw JSON):
[
  {
    "rule": "...",
    "title": "...",
    "detailedSteps": "Step 1: ... Step 2: ..."
  }
]

Be specific and technical. Include code snippets where helpful (HTML tags, meta tags, header configurations). Mention relevant tools or platforms.`,
      },
    ],
  });

  const text = response.content[0];
  if (text.type !== "text") return [];

  try {
    const jsonStr = text.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr) as AiInsights["fixInstructions"];
  } catch {
    return [];
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function analyzeWithAi(report: AuditReport): Promise<AiInsights> {
  const client = getClient();

  // Run executive summary in parallel with page insights and fix instructions
  const [executiveSummary, pageInsights, fixInstructions] = await Promise.all([
    generateExecutiveSummary(client, report),
    generatePageInsights(client, report.seo.pages, report.startUrl),
    generateFixInstructions(client, report.rankedFixes, report.startUrl),
  ]);

  return {
    executiveSummary,
    pageInsights,
    fixInstructions,
  };
}
