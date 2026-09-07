import { anthropic } from "@/lib/ai/claude";
import { HIGH_INTENT_MODEL } from "@/lib/ai/models";
import { productCatalogueBlock } from "@/lib/products";

const SYSTEM_PROMPT = `You are writing LinkedIn outreach copy for Ashish, founder of the product indicated by the contact's fitProduct.

${productCatalogueBlock()}

Write as the founder of that specific product's brand (Korrali for TRUST/REVENUE/BOTH, BillClear for BILLCLEAR, MedScan for MEDSCAN).

Write two pieces of copy:

1. connectionNote (≤295 chars): A LinkedIn connection request note. No greetings. One specific observation about their company or role. One brief value hook. No CTAs, no links. Feels like a founder, not a sales rep.

2. firstMessage (≤800 chars): The message sent after they accept the connection. Reference the connection note context. Share one concrete problem you solve that maps to their situation. Soft CTA: offer to share something useful or ask a specific question. No demos, no product links.

Respond with valid JSON only.`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    connectionNote: { type: "string", description: "≤295 chars, connection request note" },
    firstMessage:   { type: "string", description: "≤800 chars, first message after acceptance" },
  },
  required: ["connectionNote", "firstMessage"],
  additionalProperties: false,
};

export interface LinkedInCopyResult {
  connectionNote: string;
  firstMessage: string;
}

interface ContactContext {
  firstName: string;
  lastName: string;
  title: string;
  companyName: string;
  companyDescription?: string | null;
  industry?: string | null;
  fitProduct?: string | null;
  painHypothesis?: string | null;
  trigger?: string | null;
}

export async function generateLinkedInCopy(ctx: ContactContext): Promise<LinkedInCopyResult> {
  const response = await anthropic.messages.create({
    model: HIGH_INTENT_MODEL,
    max_tokens: 512,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Generate LinkedIn copy for:\n${JSON.stringify(ctx, null, 2)}`,
    }],
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block");

  const result = JSON.parse(block.text) as LinkedInCopyResult;

  if (result.connectionNote.length > 300) {
    result.connectionNote = result.connectionNote.slice(0, 297) + "...";
  }

  return result;
}
