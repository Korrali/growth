import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { WRITING_MODEL } from "@/lib/ai/models";
import { PRODUCTS } from "@/lib/products";
import { HAIKU_MODEL, callHaiku, haikuAvailable } from "@/lib/ai/haiku";
import {
  buildSequence,
  FALLBACK_LINES,
  type TemplateProduct,
  type TemplateStep,
} from "@/lib/sending/templates";

// Cold emails are a fixed, founder-approved template (lib/sending/templates.ts)
// with two AI-written sentences per prospect: whyLine (step 1) and angleLine
// (step 3). The AI used to write whole sequences; those came back with
// lowercase subjects, no greeting, no "who I am", and banned filler.
//
// Writer: Claude Haiku while this week's spend is under the cap (haiku.ts,
// $1/week), else the free chain. Lines are linted; a failing pair is sent
// back once with the problems listed, then replaced by safe fallback lines —
// a prospect is never stuck waiting on a draft.

const BANNED_PHRASES: RegExp[] = [
  /\bI noticed\b/i,
  /\bI don['’]t see any mention\b/i,
  /\b(many|most) (growing |subscription[- ]?|saas |b2b )*(teams|companies|founders|platforms|businesses)\b/i,
  /\bjust checking\b/i,
  /\bany thoughts\b/i,
  /\bcircling back\b/i,
  /\bhope (you['’]re|this finds you) well\b/i,
  /\bI['’]d love to\b/i,
  /\banother common leak\b/i,
  /\bI haven['’]t heard back\b/i,
  /\bquick (check|follow)[- ]?(back|up)?\b/i,
];

/** Deterministic checks the critics panel kept letting through. */
export function lintDraft(text: string): string[] {
  const problems: string[] = [];
  for (const re of BANNED_PHRASES) {
    const m = text.match(re);
    if (m) problems.push(`banned phrase "${m[0]}"`);
  }
  const money = text.match(/\$\d[\d,.]*[-‐-― ]?(person|people|employee|employees|staff|member)/i);
  if (money) problems.push(`headcount written as money "${money[0]}"`);
  return problems;
}

export interface GeneratedLines {
  whyLine: string;
  angleLine: string;
}

const LINES_SCHEMA = {
  type: "object" as const,
  properties: {
    whyLine: { type: "string" },
    angleLine: { type: "string" },
  },
  required: ["whyLine", "angleLine"],
  additionalProperties: false,
};

const RETRY_CONTEXT = /\b(retr(y|ies|ied|ying)|dunning|failed (payments?|charges?|renewals?)|declin(e|es|ed))\b/i;
const TIME_SPAN =
  /\b(?:(?:a|an|one|two|three|four|five|six|seven|ten|a few|few|several|a couple of|a couple|couple of|some|many|a number of)\s+)?(?:hours?|days?|weeks?|months?)\b/i;

function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length;
}

/**
 * Checks on the two AI sentences, on top of the banned-phrase lint.
 * `techNames`: the company's Apollo technology list. Those lists are noisy
 * (a live draft told a prospect "your use of AI models like Claude"), so no
 * tool or vendor from it may be named except `allowedTech`.
 */
export function lintLines(
  lines: GeneratedLines,
  opts: { techNames?: string[]; allowedTech?: string[] } = {},
): string[] {
  const problems: string[] = [];
  const allowed = new Set((opts.allowedTech ?? []).map((t) => t.toLowerCase()));
  const techWords = (opts.techNames ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !allowed.has(t.toLowerCase()));
  for (const [key, text, max] of [
    ["whyLine", lines.whyLine, 32],
    ["angleLine", lines.angleLine, 45],
  ] as const) {
    if (!text?.trim()) {
      problems.push(`${key} is empty`);
      continue;
    }
    for (const p of lintDraft(text)) problems.push(`${key}: ${p}`);
    if (wordCount(text) > max) problems.push(`${key}: ${wordCount(text)} words (max ${max})`);
    if (/https?:\/\/|www\./i.test(text)) problems.push(`${key}: contains a link`);
    if (/^\s*(hi|hello|hey|dear)\b/i.test(text)) problems.push(`${key}: starts with a greeting`);
    if (/\?/.test(text)) problems.push(`${key}: is a question`);
    if (/\b(Korrali|I'm Ashish|my name)\b/i.test(text)) problems.push(`${key}: re-introduces the product or sender`);
    // No figures at all: a live draft quoted Apollo's revenue estimate back
    // at the prospect ("$11M in annual revenue").
    if (/\d/.test(text)) problems.push(`${key}: contains a number`);
    // Stripe's retry window is configurable per account, so any stated
    // timing ("after a few days", "within a week") is a guess about them.
    if (RETRY_CONTEXT.test(text) && TIME_SPAN.test(text)) {
      problems.push(`${key}: states retry timing "${text.match(TIME_SPAN)![0]}"`);
    }
    for (const t of techWords) {
      const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(text)) problems.push(`${key}: names "${t}" from their tech list`);
    }
  }
  return problems;
}

const PRODUCT_GUIDE: Record<TemplateProduct, { problem: string; angles: string; facts: string }> = {
  REVENUE: {
    problem: "revenue slipping through their Stripe billing",
    angles:
      "failed renewals that stay unpaid after Stripe's automatic retries end; customers still billed on a price they retired; coupons that never expired; subscriptions that quietly stopped invoicing; duplicate charges",
    facts:
      "Stripe retries failed payments automatically for a limited period, then stops. Stripe cannot know which price or coupon a business intended a customer to be on.",
  },
  TRUST: {
    problem: "the time enterprise security questionnaires take",
    angles:
      "security reviews now adding a section on AI (models used, data they see, oversight); every buyer asking the same questions in a different spreadsheet; security review holding up a deal; answers scattered across old questionnaires and documents",
    facts: "Enterprise buyers usually send a security questionnaire before signing a new vendor.",
  },
};

function systemPrompt(product: TemplateProduct): string {
  const profile = PRODUCTS[product];
  const g = PRODUCT_GUIDE[product];
  return `You write two short sentences that get inserted into a fixed cold email from Ashish, founder of ${profile.name}.

${profile.name}: ${profile.oneLiner}

whyLine (goes in email 1, right after Ashish has introduced himself and the product): ONE sentence, at most 30 words, that ties a specific fact about THIS company from the input to why ${g.problem} is likely for them. It must read naturally as the next sentence. Do not greet, do not introduce the product or Ashish, do not ask a question.

angleLine (opens email 3): one or two sentences, at most 40 words, about ONE specific problem that fits how this company bills or sells, different from whyLine. Choose from: ${g.angles}. Not a question.

Hard rules:
- Use only facts present in the input. Never invent customers, tools, markets or certifications.
- No numbers of any kind: never mention their revenue, funding, headcount or any figure.
- Never name a technology, vendor or AI model they use (detectedTechs is unreliable)${""} — describe what the company does instead.
- Write complete, grammatical sentences.
- The only general facts you may state: ${g.facts}
- Never say how long Stripe retries or when it stops (no "after a few days", "within a week", "for weeks"): each business configures its own retry window.
- No compliments, no hype, no links, no exclamation marks.
- Never use: "I noticed", "many teams", "most companies", "most businesses", "just checking", "quick follow-up", "another common leak", "I'd love to".
- Plain, specific, human sentences in normal capitalisation.

Respond with JSON only: {"whyLine": "...", "angleLine": "..."}`;
}

async function writeLines(
  product: TemplateProduct,
  userPrompt: string,
): Promise<{ lines: GeneratedLines; model: string }> {
  const system = systemPrompt(product);
  if (await haikuAvailable()) {
    const { text } = await callHaiku({ system, user: userPrompt, schema: LINES_SCHEMA, maxTokens: 400, purpose: "cold-email-lines" });
    return { lines: JSON.parse(text) as GeneratedLines, model: HAIKU_MODEL };
  }
  const response = await anthropic.messages.create({
    model: WRITING_MODEL,
    max_tokens: 400,
    system,
    messages: [{ role: "user", content: userPrompt }],
    output_config: { format: { type: "json_schema", schema: LINES_SCHEMA } },
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block");
  return { lines: JSON.parse(block.text) as GeneratedLines, model: WRITING_MODEL };
}

export async function generateEmailSequence(input: {
  outreachId: string;
  contactId: string;
  campaignId: string;
}): Promise<TemplateStep[]> {
  const [outreach, contact, campaign] = await Promise.all([
    prisma.outreach.findUniqueOrThrow({
      where: { id: input.outreachId },
      include: { company: true },
    }),
    prisma.contact.findUniqueOrThrow({ where: { id: input.contactId } }),
    prisma.campaign.findUniqueOrThrow({ where: { id: input.campaignId } }),
  ]);

  if (campaign.product !== "REVENUE" && campaign.product !== "TRUST") {
    throw new Error(`No cold email template for product ${campaign.product}`);
  }
  const product: TemplateProduct = campaign.product;
  const companyName = outreach.company?.name ?? outreach.company?.domain ?? "your team";

  const inputData = {
    contact: { firstName: contact.firstName, title: contact.title },
    company: {
      name: companyName,
      domain: outreach.company?.domain,
      industry: outreach.company?.industry,
      teamSize: outreach.company?.employeeCount ? `${outreach.company.employeeCount} employees` : null,
      detectedTechs: outreach.company?.detectedTechs ?? [],
      description: outreach.company?.description,
      painHypothesis: outreach.company?.painHypothesis,
      personalizedObservation: outreach.company?.personalizedObservation,
    },
  };

  let lines: GeneratedLines | null = null;
  let model = "fallback";
  let problems: string[] = [];
  let error: string | null = null;
  const userPrompt = `Write whyLine and angleLine for this prospect:\n${JSON.stringify(inputData, null, 2)}`;

  for (let attempt = 0; attempt < 2 && !lines; attempt++) {
    try {
      const feedback = problems.length
        ? `\n\nYour previous lines broke these rules — rewrite both:\n- ${problems.join("\n- ")}`
        : "";
      const out = await writeLines(product, userPrompt + feedback);
      problems = lintLines(out.lines, {
        techNames: outreach.company?.detectedTechs ?? [],
        allowedTech: product === "REVENUE" ? ["Stripe"] : [],
      });
      if (problems.length === 0) {
        lines = out.lines;
        model = out.model;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  if (!lines) {
    const fb = FALLBACK_LINES[product];
    lines = { whyLine: fb.whyLine(companyName), angleLine: fb.angleLine };
  }

  const steps = buildSequence(product, {
    firstName: contact.firstName,
    company: companyName,
    whyLine: lines.whyLine,
    angleLine: lines.angleLine,
  });

  // The template is founder-approved, so every step passes the send gate
  // (eligibility.ts gate 13 reads these).
  const gates: Record<number, { passed: boolean; blockedReasons: string[] }> = {};
  for (const step of steps) {
    gates[step.stepNumber] = { passed: true, blockedReasons: [] };
    await prisma.outreachEmailDraft.upsert({
      where: { outreachId_stepNumber: { outreachId: input.outreachId, stepNumber: step.stepNumber } },
      create: {
        outreachId: input.outreachId,
        stepNumber: step.stepNumber,
        subject: step.subject,
        body: step.body,
        qualityGates: gates[step.stepNumber],
        criticsFlags: [],
      },
      update: {
        subject: step.subject,
        body: step.body,
        relevanceScore: null,
        personalizationScore: null,
        riskScore: null,
        qualityGates: gates[step.stepNumber],
        criticsPassed: null,
        criticsFlags: [],
        approvedAt: null,
      },
    });
  }

  await prisma.emailGenerationRun.create({
    data: {
      outreachId: input.outreachId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      model,
      inputData: JSON.parse(JSON.stringify(inputData)),
      outputData: JSON.parse(JSON.stringify({ lines, fallback: model === "fallback", lastProblems: problems })),
      qualityGates: gates,
      error,
    },
  });

  return steps;
}
