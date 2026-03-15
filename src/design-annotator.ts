/**
 * Design Annotator — AI-powered visual annotation of design issues.
 *
 * Takes screenshots and design check results, generates annotated images
 * with arrows and labels pointing to specific problems. Uses Claude's
 * vision capabilities to identify exact locations of issues.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DesignCheck } from "./design-spec.js";

const MODEL = "claude-sonnet-4-20250514";

export interface AnnotationResult {
  /** URL of the page */
  url: string;
  /** Base64 PNG of the original screenshot */
  originalScreenshot: string;
  /** AI-generated annotations describing exact locations */
  annotations: Array<{
    issue: string;
    location: string;
    severity: "critical" | "major" | "minor";
    fix: string;
  }>;
  /** Overall visual assessment */
  assessment: string;
}

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI annotation requires ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey: key });
}

const ANNOTATOR_PROMPT = `You are a design QA engineer reviewing a screenshot of a web page. You have been given specific design issues found by automated checks. Your job is to locate EXACTLY where each issue appears in the screenshot and describe the location precisely.

For each issue, provide:
1. The exact location in the screenshot (e.g., "top navigation bar, third link from left", "hero section, the large heading", "footer, second column, third link")
2. What's wrong visually
3. How to fix it

Also identify any ADDITIONAL visual problems you see that the automated checks missed — things like:
- Misaligned elements
- Inconsistent padding/margins that look wrong
- Text that's hard to read
- Colors that clash
- Elements that look out of place
- Awkward whitespace
- Images that are stretched or cropped poorly
- Buttons that look different from each other when they shouldn't

Be extremely specific about locations. "The heading" is not enough — say "the h1 heading that reads 'Software solutions that start with your problem' in the hero section."`;

export async function annotateDesignIssues(
  screenshots: Array<{ url: string; screenshotBase64: string }>,
  checks: DesignCheck[],
): Promise<AnnotationResult[]> {
  const client = getClient();
  const results: AnnotationResult[] = [];

  // Process up to 5 pages
  for (const ss of screenshots.slice(0, 5)) {
    const relevantChecks = checks
      .filter((c) => c.score < 90)
      .slice(0, 8)
      .map((c) => `- ${c.label}: ${c.actual} (standard: ${c.standard})${c.deviations.length > 0 ? "\n  " + c.deviations[0] : ""}`);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: ANNOTATOR_PROMPT },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: ss.screenshotBase64,
              },
            },
            {
              type: "text",
              text: `Page: ${ss.url}

Known issues from automated checks:
${relevantChecks.join("\n")}

Respond in this exact JSON format (no markdown, just raw JSON):
{
  "annotations": [
    {
      "issue": "what's wrong",
      "location": "exact location in the screenshot",
      "severity": "critical|major|minor",
      "fix": "specific fix instruction"
    }
  ],
  "assessment": "2-3 sentence overall visual assessment of this page"
}`,
            },
          ],
        },
      ],
    });

    const text = response.content[0];
    if (text.type !== "text") continue;

    try {
      const jsonStr = text.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(jsonStr) as {
        annotations: AnnotationResult["annotations"];
        assessment: string;
      };
      results.push({
        url: ss.url,
        originalScreenshot: ss.screenshotBase64,
        annotations: parsed.annotations,
        assessment: parsed.assessment,
      });
    } catch {
      results.push({
        url: ss.url,
        originalScreenshot: ss.screenshotBase64,
        annotations: [],
        assessment: text.text.slice(0, 500),
      });
    }
  }

  return results;
}

/**
 * Generate an HTML report of annotated design issues.
 * Shows the screenshot alongside numbered annotations.
 */
export function generateAnnotationHtml(results: AnnotationResult[]): string {
  let pagesHtml = "";
  for (const result of results) {
    const annotationList = result.annotations
      .map((a, i) => {
        const severityColor =
          a.severity === "critical" ? "#dc3545" : a.severity === "major" ? "#ffc107" : "#17a2b8";
        const severityBg =
          a.severity === "critical" ? "#dc354520" : a.severity === "major" ? "#ffc10720" : "#17a2b820";
        return `
        <div style="background:${severityBg};border-left:3px solid ${severityColor};padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="background:${severityColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;">${a.severity}</span>
            <strong style="font-size:14px;">${escapeHtml(a.issue)}</strong>
          </div>
          <p style="color:#666;font-size:13px;margin:4px 0;"><strong>Location:</strong> ${escapeHtml(a.location)}</p>
          <p style="color:#444;font-size:13px;margin:4px 0;"><strong>Fix:</strong> ${escapeHtml(a.fix)}</p>
        </div>`;
      })
      .join("");

    pagesHtml += `
    <div style="margin-bottom:48px;">
      <h2 style="font-size:18px;color:#333;margin-bottom:16px;word-break:break-all;">${escapeHtml(result.url)}</h2>
      <p style="color:#666;font-size:14px;margin-bottom:16px;font-style:italic;">${escapeHtml(result.assessment)}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
        <div>
          <img src="data:image/png;base64,${result.originalScreenshot}" style="width:100%;border:1px solid #ddd;border-radius:8px;" alt="Screenshot of ${escapeHtml(result.url)}" />
        </div>
        <div>
          <h3 style="font-size:14px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Annotations (${result.annotations.length})</h3>
          ${annotationList || "<p style='color:#28a745;'>No issues found on this page.</p>"}
        </div>
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Design Annotations</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f9fa; color: #212529; padding: 32px; max-width: 1400px; margin: 0 auto; line-height: 1.6; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .meta { color: #888; font-size: 14px; margin-bottom: 32px; }
  </style>
</head>
<body>
  <h1>Design Annotations</h1>
  <p class="meta">AI-identified design issues with exact locations and fixes</p>
  ${pagesHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
