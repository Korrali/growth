import { prisma } from "@/lib/db";
import { anthropic, CLAUDE_MODELS } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";
import { FitProduct } from "@prisma/client";
import { enqueueFitScore } from "@/lib/queue";

export interface FitScoreResult {
  fitProduct: FitProduct;
  fitScore: number;
  painHypothesis: string;
  trigger: string;
  personalizedObservation: string;
  recommendedCta: string;
  fitReasoning: string;
}

const SYSTEM_PROMPT = `You are an ICP fit scorer for two B2B SaaS products:

**Korrali Trust** — AI trust workspace for B2B SaaS companies (10–200 employees) that sell to enterprise. The product helps them answer security/privacy/AI questionnaires, generate governance policy docs, and publish a trust page. Trigger signals: upcoming enterprise deals, SOC2/ISO27001 audits, frequent questionnaire requests from prospects, no DPA or privacy policy in place, AI usage without governance docs, SaaS company with named enterprise customers or investors.

**Korrali Revenue** — Stripe revenue leak detection for SaaS companies. Detects failed payments, duplicate charges, and billing anomalies in Stripe. Trigger signals: scaling fast (Series A+), Stripe volume >$50k MRR, engineering team focused on product not billing infra, known Stripe pricing complexity, subscription SaaS without dedicated billing ops.

Given a company's public signals, score their fit for each product and pick the best match.

Respond with valid JSON only. No prose before or after the JSON.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    fitProduct: { type: "string", enum: ["TRUST", "REVENUE", "BOTH", "REJECT"] },
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

  return outputData!;
}

export async function bulkScoreCompanies(companyIds: string[]): Promise<void> {
  for (const id of companyIds) {
    await enqueueFitScore({ companyId: id });
  }
}
