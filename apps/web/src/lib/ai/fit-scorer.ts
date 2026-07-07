import { prisma } from "@/lib/db";
import { anthropic, CLAUDE_MODELS } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";
import { FitProduct } from "@prisma/client";
import { enqueueFitScore, enqueueContactFind } from "@/lib/queue";
import { PRODUCTS, MARKETED_PRODUCT_KEYS } from "@/lib/products";

// ─── Landing page analysis ────────────────────────────────────────────────────

interface LandingPageAnalysis {
  headline: string;
  cta: string;
  positioningSuggestion: string;
}

const LANDING_ANALYSIS_SCHEMA = {
  type: "object" as const,
  properties: {
    headline: { type: "string" },
    cta: { type: "string" },
    positioningSuggestion: {
      type: "string",
      description: "One specific, actionable observation about how they could improve their positioning to better convert their ideal buyers",
    },
  },
  required: ["headline", "cta", "positioningSuggestion"],
  additionalProperties: false,
};

async function fetchPageContent(url: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, urls: [url] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ raw_content?: string }> };
    return data.results?.[0]?.raw_content?.slice(0, 3000) ?? null;
  } catch {
    return null;
  }
}

async function analyzeLandingPage(url: string): Promise<LandingPageAnalysis | null> {
  const content = await fetchPageContent(url);
  if (!content) return null;
  try {
    const response = await anthropic.messages.create({
      model: BULK_MODEL,
      max_tokens: 256,
      system: "Extract landing page signals for cold email personalization. Respond with valid JSON only.",
      messages: [
        {
          role: "user",
          content: `From this landing page content, extract:
- headline: the main headline text
- cta: the primary call-to-action button text
- positioningSuggestion: one specific observation about how they could sharpen their positioning to better convert their ideal buyers (1-2 sentences)

Page content:
${content}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: LANDING_ANALYSIS_SCHEMA } },
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    return JSON.parse(block.text) as LandingPageAnalysis;
  } catch {
    return null;
  }
}

const CONTACT_FIND_THRESHOLD = 6;

export interface FitScoreResult {
  fitProduct: FitProduct;
  fitScore: number;
  painHypothesis: string;
  trigger: string;
  personalizedObservation: string;
  recommendedCta: string;
  fitReasoning: string;
}

// Only outbound-viable products are scorable — frozen products (BillClear,
// MedScan, GROWTH_SERVICE) must not attract new fits even though existing
// Company rows may still carry their fitProduct values.
const SCORABLE_KEYS = MARKETED_PRODUCT_KEYS.filter((k) => PRODUCTS[k].outboundViable);

const SYSTEM_PROMPT = `You are an ICP fit scorer for ${SCORABLE_KEYS.length} products:

${SCORABLE_KEYS.map((k) => {
  const p = PRODUCTS[k];
  return `**${p.name}** (${k}) — ${p.oneLiner}\n\n${p.icp}`;
}).join("\n\n---\n\n")}

BOTH: if a company clearly fits both Korrali Trust and Korrali Revenue, use BOTH.

A company can only receive one fitProduct — pick the product where the pain is most acute and observable.

Score 1–5 = weak or no fit (REJECT unless clearly 5). Score 6–7 = decent fit, worth outreach. Score 8–10 = strong fit, high priority.

Respond with valid JSON only. No prose before or after the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    fitProduct: { type: "string", enum: [...SCORABLE_KEYS, "BOTH", "REJECT"] },
    fitScore: { type: "number", description: "1-10, where 10 = perfect ICP match" },
    painHypothesis: { type: "string", description: "One sentence: the specific pain this company is feeling right now" },
    trigger: { type: "string", description: "The observable signal that makes this the right time to reach out" },
    personalizedObservation: { type: "string", description: "One verifiable, specific thing noticed about this company from public signals" },
    recommendedCta: { type: "string", description: "The best CTA to use: demo, quick call, or soft question" },
    fitReasoning: { type: "string", description: "2-3 sentences explaining the fit score and product choice" },
  },
  required: ["fitProduct", "fitScore", "painHypothesis", "trigger", "personalizedObservation", "recommendedCta", "fitReasoning"],
  additionalProperties: false,
};

export async function scoreFitForCompany(companyId: string): Promise<FitScoreResult> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  const startedAt = Date.now();
  const inputData = {
    name: company.name,
    domain: company.domain,
    website: company.website,
    description: company.description,
    industry: company.industry,
    employeeCount: company.employeeCount,
    detectedTechs: company.detectedTechs,
  };

  let outputData: FitScoreResult | null = null;
  let error: string | null = null;

  try {
    const response = await anthropic.messages.create({
      model: BULK_MODEL,
      max_tokens: 512,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Score this company:\n${JSON.stringify(inputData, null, 2)}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text block in response");

    const parsed = JSON.parse(block.text) as FitScoreResult;

    // Validate enum
    if (!Object.values(FitProduct).includes(parsed.fitProduct as FitProduct)) {
      throw new Error(`Invalid fitProduct: ${parsed.fitProduct}`);
    }
    if (parsed.fitScore < 1 || parsed.fitScore > 10) {
      throw new Error(`fitScore out of range: ${parsed.fitScore}`);
    }

    outputData = parsed;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await prisma.scoringRun.create({
      data: {
        companyId,
        model: BULK_MODEL,
        inputData: JSON.parse(JSON.stringify(inputData)),
        outputData: outputData ? JSON.parse(JSON.stringify(outputData)) : undefined,
        error,
        durationMs: Date.now() - startedAt,
      },
    });
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      fitProduct: outputData!.fitProduct as FitProduct,
      fitScore: outputData!.fitScore,
      painHypothesis: outputData!.painHypothesis,
      trigger: outputData!.trigger,
      personalizedObservation: outputData!.personalizedObservation,
      recommendedCta: outputData!.recommendedCta,
      fitReasoning: outputData!.fitReasoning,
      fitScoredAt: new Date(),
    },
  });

  // Auto-trigger contact discovery for high-fit companies
  if (
    outputData!.fitScore >= CONTACT_FIND_THRESHOLD &&
    outputData!.fitProduct !== "REJECT"
  ) {
    // Analyze landing page before contact find so Step 1 emails have website context.
    // Best-effort: errors are swallowed so contact find is never blocked.
    const websiteUrl = company.website || `https://${company.domain}`;
    const landingAnalysis = await analyzeLandingPage(websiteUrl).catch(() => null);
    if (landingAnalysis) {
      await prisma.company.update({
        where: { id: companyId },
        data: { landingPageAnalysis: landingAnalysis as unknown as import("@prisma/client").Prisma.JsonObject },
      });
    }

    await enqueueContactFind({ companyId });
  }

  return outputData!;
}

export async function bulkScoreCompanies(companyIds: string[]): Promise<void> {
  for (const id of companyIds) {
    await enqueueFitScore({ companyId: id });
  }
}
