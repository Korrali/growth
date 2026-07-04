import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";

export interface CriticResult {
  passed: boolean;
  flags: string[];
}

const CRITICS_SYSTEM = `You are reviewing a cold outbound email as 5 hostile reader personas.
For each persona, decide if the email passes their filter. Respond with valid JSON only.`;

const PERSONAS_TEXT = `Personas:
1. AI-Allergic — flags generic language, "I hope this finds you well", "I wanted to reach out", "I came across your company", corporate buzzwords, vague claims that could apply to any company.
2. Time-Crunched CEO — flags emails that bury the ask, use preamble, or exceed ~90 words. Wants: who you are, the problem, and one clear ask in the first 3 sentences.
3. Skeptic — flags unverifiable claims ("leading platform", "companies like yours", "best-in-class"), vague social proof, and over-promises with no proof.
4. Pattern-Matcher — flags known cold email templates: compliment + pitch structure, problem-agitate-solution in sequence, "quick question" subject lines, mentioning the company name as the only "personalization".
5. Legal-Averse — flags compliance guarantees ("you will save X%"), binding-sounding commitments, and anything a lawyer would flag as a claim.`;

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
    return {
      passed: failures.length <= 1,
      flags: failures.map((c) => `[${c.persona ?? "critic"}] ${c.flag ?? "failed"}`),
    };
  } catch {
    // Best-effort — never block email generation due to critic errors
    return { passed: true, flags: [] };
  }
}
