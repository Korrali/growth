import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";

export interface CriticResult {
  passed: boolean;
  flags: string[];
}

const CRITICS_SYSTEM = `You are reviewing a cold outbound email as 5 hostile reader personas.
For each persona, decide if the email passes their filter. Respond with valid JSON only.`;

const PERSONAS_TEXT = `Personas. Each flags ONLY a genuine problem — a specific, direct,
offer-clear cold email is EXPECTED to pass. Never flag an email merely for being a cold
email, for making a clear pitch, or for having a problem->product structure.
1. AI-Allergic — flags generic AI-speak and filler: "I hope this finds you well", "I wanted
   to reach out", "I came across your company", corporate buzzwords, and claims so vague they'd
   fit any company. A specific, verifiable observation about THIS company passes.
2. Time-Crunched CEO — flags emails that bury the ask, open with preamble, or exceed ~90 words.
   Passes if who-you-are + the problem + one clear ask land in the first 3 sentences.
3. Skeptic — flags brand puffery ("leading platform", "best-in-class") and vague social proof
   ("companies like yours"). Does NOT flag a specific, quantified pain given as an estimate or
   industry range (e.g. "5-15% of revenue", "40+ hours") — concrete numbers are good as long as
   they are not stated as a personalized guarantee.
4. Pattern-Matcher — flags fill-in-the-blank templates with NO company-specific substance:
   "quick question" subjects, or the company name as the ONLY personalization. A clear
   problem->product structure is fine when anchored in a specific, verifiable detail about the recipient.
5. Legal-Averse — flags compliance/certification/guaranteed-outcome claims ("makes you compliant",
   "you WILL save X%", "audit-ready"). The product's own stated pricing or performance model
   (e.g. "10% of what we recover", "$999/mo") is the OFFER, not a claim — do not flag it.`;

const CRITICS_SCHEMA = {
  type: "object" as const,
  properties: {
    critiques: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          persona: { type: "string" },
          passed: { type: "boolean" },
          flag: { type: "string" },
        },
        required: ["persona", "passed", "flag"],
        additionalProperties: false,
      },
    },
  },
  required: ["critiques"],
  additionalProperties: false,
};

export async function reviewWithCritics(draft: {
  subject: string;
  body: string;
}): Promise<CriticResult> {
  try {
    const response = await anthropic.messages.create({
      model: BULK_MODEL,
      max_tokens: 512,
      system: CRITICS_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${PERSONAS_TEXT}

Email:
Subject: ${draft.subject}
Body: ${draft.body}

For each persona: passed=true if the email clears their filter, passed=false with a brief flag if it fails.`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: CRITICS_SCHEMA } },
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { passed: true, flags: [] };

    const parsed = JSON.parse(block.text) as {
      critiques?: Array<{ persona?: string; passed?: boolean; flag?: string }>;
    };

    const critiques = parsed.critiques ?? [];
    const failures = critiques.filter((c) => c.passed === false);
    // Pass if 3+ of the 5 hostile personas approve. At <=1 nearly every real
    // cold email drew 2+ nitpicks and was discarded (near-0 pass rate); <=2
    // keeps a meaningful bar (buzzwords, buried ask, puffery, compliance
    // guarantees still block) without rejecting specific, offer-clear copy.
    return {
      passed: failures.length <= 2,
      flags: failures.map((c) => `[${c.persona ?? "critic"}] ${c.flag ?? "failed"}`),
    };
  } catch {
    // Best-effort — never block email generation due to critic errors
    return { passed: true, flags: [] };
  }
}
