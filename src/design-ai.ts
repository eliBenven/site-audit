/**
 * AI Design Evaluator — Visual Opinion Layer
 *
 * Takes screenshots of pages and uses Claude to evaluate visual
 * design quality with strong opinions. This is not a checklist —
 * it's a design critic that cares about craft.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DesignScore } from "./design-spec.js";

const MODEL = "claude-sonnet-4-20250514";

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI design evaluation requires ANTHROPIC_API_KEY");
  return new Anthropic({ apiKey: key });
}

export interface AiDesignVerdict {
  /** Overall visual design grade: A/B/C/D/F */
  grade: string;
  /** One-sentence verdict */
  headline: string;
  /** Detailed visual assessment */
  assessment: string;
  /** What's working well */
  strengths: string[];
  /** What's wrong — specific, opinionated, actionable */
  problems: string[];
  /** Would a design lead approve this for production? */
  shippable: boolean;
  /** Per-page verdicts */
  pageVerdicts: Array<{
    url: string;
    grade: string;
    verdict: string;
    issues: string[];
  }>;
}

const DESIGN_CRITIC_PROMPT = `You are a ruthlessly honest senior design lead at a top agency. You have extremely high standards and zero tolerance for mediocrity. You evaluate web design the way a Michelin inspector evaluates restaurants — perfection is the baseline, not the aspiration.

You are looking at screenshots of a website. Evaluate the visual design quality.

Your evaluation MUST cover:

**Visual Hierarchy**: Is it immediately clear what to look at first, second, third? Does the eye flow naturally? Or is everything screaming at the same volume?

**Typography**: Is the type beautiful? Is there a clear scale? Are the fonts well-chosen and well-paired? Or is it a random collection of sizes and weights?

**Whitespace**: Is there breathing room? Is the spacing intentional and rhythmic? Or is it cramped and claustrophobic (or wastefully empty)?

**Color**: Is the palette tight and purposeful? Does every color earn its place? Or is it a rainbow of indecision?

**Consistency**: Do similar elements look similar? Is there a system? Or does every section feel like a different designer made it?

**Craft/Polish**: Are the details right? Alignment, borders, shadows, hover states, image treatment? Or are there rough edges everywhere?

**Emotional Impact**: Does the design make you feel something appropriate for the brand? Trust? Excitement? Calm? Or does it feel generic and forgettable?

Be SPECIFIC. Don't say "the typography needs work" — say "the heading at the top uses 48px bold but the section below uses 42px semibold, breaking the scale." Name exact elements you can see.

Be OPINIONATED. If it's boring, say it's boring. If it's beautiful, say it's beautiful. If it looks like a template, say it looks like a template. You are not here to be nice — you are here to push toward perfection.

Grade on this scale:
- **A**: Publication-ready. A design team would be proud to put this in their portfolio.
- **B**: Solid professional work. A few things to refine but the foundation is strong.
- **C**: Competent but unremarkable. Gets the job done but won't win any awards.
- **D**: Noticeable problems. Would not pass design review at a good company.
- **F**: Broken, ugly, or fundamentally flawed. Ship this and you lose credibility.`;

export async function evaluateDesignWithAi(
  screenshots: Array<{ url: string; screenshotBase64: string }>,
  automatedScore: DesignScore,
): Promise<AiDesignVerdict> {
  const client = getClient();

  // Build the image content blocks
  const imageBlocks: Anthropic.Messages.ContentBlockParam[] = [];
  for (const ss of screenshots.slice(0, 8)) { // Max 8 screenshots to keep under token limits
    imageBlocks.push({
      type: "text",
      text: `\n--- Page: ${ss.url} ---`,
    });
    imageBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: ss.screenshotBase64,
      },
    });
  }

  // Include the automated score as context
  const scoreContext = `
AUTOMATED DESIGN SCORE: ${automatedScore.overall}/100 (${automatedScore.perfect ? "PASSED" : "BELOW"} perfection threshold)

Dimension breakdown:
${automatedScore.dimensions.map((d) => `  ${d.dimension}: ${d.score}/100`).join("\n")}

Top automated issues:
${automatedScore.topIssues.slice(0, 5).map((i) => `  - ${i.label}: ${i.actual} (standard: ${i.standard})`).join("\n")}
`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: DESIGN_CRITIC_PROMPT,
          },
          ...imageBlocks,
          {
            type: "text",
            text: `${scoreContext}

Respond in this exact JSON format (no markdown code blocks, just raw JSON):
{
  "grade": "A/B/C/D/F",
  "headline": "One sentence overall verdict",
  "assessment": "2-3 paragraph detailed assessment",
  "strengths": ["specific thing that works", "..."],
  "problems": ["specific problem with specific element", "..."],
  "shippable": true/false,
  "pageVerdicts": [
    {"url": "...", "grade": "A-F", "verdict": "one sentence", "issues": ["..."]}
  ]
}`,
          },
        ],
      },
    ],
  });

  const text = response.content[0];
  if (text.type !== "text") {
    return { grade: "?", headline: "AI evaluation failed", assessment: "", strengths: [], problems: [], shippable: false, pageVerdicts: [] };
  }

  try {
    const jsonStr = text.text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr) as AiDesignVerdict;
  } catch {
    return {
      grade: "?",
      headline: "Could not parse AI response",
      assessment: text.text,
      strengths: [],
      problems: [],
      shippable: false,
      pageVerdicts: [],
    };
  }
}
