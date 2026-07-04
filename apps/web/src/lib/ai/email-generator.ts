import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { WRITING_MODEL } from "@/lib/ai/models";
import { PRODUCTS } from "@/lib/products";
import { reviewWithCritics } from "@/lib/ai/critics-reviewer";
import type { CampaignProduct } from "@prisma/client";

export interface GeneratedStep {
  stepNumber: number;
  subject: string;
  body: string;
  relevanceScore: number;
  personalizationScore: number;
  riskScore: number;
}

export interface QualityGateResult {
  passed: boolean;
  blockedReasons: string[];
}

export function checkQualityGates(
  step: GeneratedStep,
  fitScore: number,
): QualityGateResult {
  const blocked: string[] = [];
  if (step.riskScore > 4) blocked.push(`riskScore ${step.riskScore} > 4`);
  if (step.relevanceScore < 6) blocked.push(`relevanceScore ${step.relevanceScore} < 6`);
  if (step.personalizationScore < 5) blocked.push(`personalizationScore ${step.personalizationScore} < 5`);
  if (fitScore < 6) blocked.push(`fitScore ${fitScore} < 6`);
  return { passed: blocked.length === 0, blockedReasons: blocked };
}

function systemPromptFor(product: CampaignProduct): string {
  const profile = PRODUCTS[product];
  return `You are Ashish, founder of ${profile.brand}. Write cold outbound emails founder-to-founder.

The product you are selling: **${profile.name}** — ${profile.oneLiner}
The buyer: ${profile.buyers}

Rules:
- Reference only verifiable signals from the input data. Never imply research depth you cannot support.
- Step 1 body must be under 120 words. Other steps may be slightly longer but stay under 150 words.
- No "quick question" subject lines. No "I hope this finds you well". No fluffy openers.
- Direct, specific, and human. One genuine observation per email. No bullet lists.
- Each step builds on the previous one narratively — they should feel like a cohesive sequence.
- Subject lines: lowercase, punchy, 4-7 words max. No clickbait.
- Step 1 only: if landingPageAnalysis.positioningSuggestion is provided in the input, use it as the email's opening hook — reference it as if you just visited their site and noticed something specific. This makes the email feel genuinely researched, not templated.

For each step provide relevanceScore (1-10), personalizationScore (1-10), riskScore (1-10 where 1=safe, 10=risky/spammy).

Respond with valid JSON only: an object with a "steps" array of 4 objects.`;
}

// Root must be an object — structured outputs mishandles top-level array
// schemas (same bug that broke company discovery: "extracted is not iterable").
const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    steps: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          stepNumber: { type: "number" },
          subject: { type: "string" },
          body: { type: "string" },
          relevanceScore: { type: "number" },
          personalizationScore: { type: "number" },
          riskScore: { type: "number" },
        },
        required: ["stepNumber", "subject", "body", "relevanceScore", "personalizationScore", "riskScore"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
};

export async function generateEmailSequence(input: {
  outreachId: string;
  contactId: string;
  campaignId: string;
}): Promise<GeneratedStep[]> {
  const [outreach, contact, campaign] = await Promise.all([
    prisma.outreach.findUniqueOrThrow({
      where: { id: input.outreachId },
      include: { company: true },
    }),
    prisma.contact.findUniqueOrThrow({ where: { id: input.contactId } }),
    prisma.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
      include: { sequenceSteps: { orderBy: { stepNumber: "asc" } } },
    }),
  ]);

  const fitScore = outreach.company?.fitScore ?? 0;
  const inputData = {
    contact: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title,
      email: contact.email,
    },
    company: {
      name: outreach.company?.name,
      domain: outreach.company?.domain,
      industry: outreach.company?.industry,
      employeeCount: outreach.company?.employeeCount,
      detectedTechs: outreach.company?.detectedTechs ?? [],
      painHypothesis: outreach.company?.painHypothesis,
      trigger: outreach.company?.trigger,
      personalizedObservation: outreach.company?.personalizedObservation,
      fitScore,
      landingPageAnalysis: outreach.company?.landingPageAnalysis ?? null,
    },
    campaign: {
      name: campaign.name,
      product: campaign.product,
      steps: campaign.sequenceSteps.map((s) => ({
        stepNumber: s.stepNumber,
        delayDays: s.delayDays,
        ctaType: s.ctaType,
        subjectHint: s.subjectTemplate,
      })),
    },
  };

  const startedAt = Date.now();
  let outputData: GeneratedStep[] | null = null;
  let error: string | null = null;
  let qualityGatesJson: Record<string, unknown> | null = null;

  try {
    const response = await anthropic.messages.create({
      model: WRITING_MODEL,
      max_tokens: 2048,
      system: systemPromptFor(campaign.product),
      messages: [
        {
          role: "user",
          content: `Generate a 4-step email sequence:\n${JSON.stringify(inputData, null, 2)}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text block");

    const rawParsed = JSON.parse(block.text) as
      | GeneratedStep[]
      | { steps?: GeneratedStep[] };
    const parsed = Array.isArray(rawParsed) ? rawParsed : (rawParsed.steps ?? []);
    if (parsed.length === 0) throw new Error("Empty step array from model");
    outputData = parsed;

    // Run quality gates (including critics review) and write drafts
    const gatesMap: Record<number, QualityGateResult> = {};
    for (const step of parsed) {
      const gates = checkQualityGates(step, fitScore);

      // Adversarial critics review — run on every step, cheap 8B model, best-effort
      const critics = await reviewWithCritics({ subject: step.subject, body: step.body });
      if (!critics.passed) {
        critics.flags.forEach((f) => gates.blockedReasons.push(f));
        gates.passed = false;
      }

      gatesMap[step.stepNumber] = gates;

      await prisma.outreachEmailDraft.upsert({
        where: { outreachId_stepNumber: { outreachId: input.outreachId, stepNumber: step.stepNumber } },
        create: {
          outreachId: input.outreachId,
          stepNumber: step.stepNumber,
          subject: step.subject,
          body: step.body,
          relevanceScore: step.relevanceScore,
          personalizationScore: step.personalizationScore,
          riskScore: step.riskScore,
          qualityGates: JSON.parse(JSON.stringify(gates)),
          criticsPassed: critics.passed,
          criticsFlags: critics.flags,
        },
        update: {
          subject: step.subject,
          body: step.body,
          relevanceScore: step.relevanceScore,
          personalizationScore: step.personalizationScore,
          riskScore: step.riskScore,
          qualityGates: JSON.parse(JSON.stringify(gates)),
          criticsPassed: critics.passed,
          criticsFlags: critics.flags,
          approvedAt: null,
        },
      });
    }
    qualityGatesJson = gatesMap as unknown as Record<string, unknown>;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await prisma.emailGenerationRun.create({
      data: {
        outreachId: input.outreachId,
        contactId: input.contactId,
        campaignId: input.campaignId,
        model: WRITING_MODEL,
        inputData: JSON.parse(JSON.stringify(inputData)),
        outputData: outputData ? JSON.parse(JSON.stringify(outputData)) : undefined,
        qualityGates: qualityGatesJson ? JSON.parse(JSON.stringify(qualityGatesJson)) : undefined,
        error,
      },
    });
  }

  return outputData!;
}
