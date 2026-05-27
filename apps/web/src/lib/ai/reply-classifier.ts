import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";
import { ReplyCategory, SuppressionReason } from "@prisma/client";
import { addEmailSuppression } from "@/lib/sending/suppression";

const STOP_CATEGORIES = new Set<ReplyCategory>([
  ReplyCategory.UNSUBSCRIBE,
  ReplyCategory.BOUNCE,
  ReplyCategory.NEGATIVE,
]);

const SUPPRESSION_MAP: Partial<Record<ReplyCategory, SuppressionReason>> = {
  [ReplyCategory.UNSUBSCRIBE]: SuppressionReason.UNSUBSCRIBED,
  [ReplyCategory.BOUNCE]: SuppressionReason.BOUNCED,
};

const SYSTEM_PROMPT = `Classify this cold email reply. Respond with JSON only.

Categories:
- INTERESTED: positive signal, wants to learn more or schedule
- NOT_NOW: politely declines but leaves door open
- WRONG_PERSON: forward me to someone else, not the right contact
- OBJECTION: specific objection that could be addressed
- UNSUBSCRIBE: explicitly asks to be removed
- BOUNCE: automated out-of-office or bounce-like message
- AUTO_REPLY: auto-responder with no human signal
- NEGATIVE: strong negative, hostile, or "not interested ever"
- OTHER: doesn't fit above

Provide priority 0-10 (10 = needs immediate founder attention).
founderDraft: a 2-3 sentence suggested reply matching the tone the founder should use.
- INTERESTED → warm, move to schedule: "Great to hear from you..."
- OBJECTION → address it directly
- UNSUBSCRIBE → "Will do, I've removed you."
- NEGATIVE → empty string (don't reply)`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    category: { type: "string", enum: Object.values(ReplyCategory) },
    priority: { type: "number", description: "0-10" },
    founderDraft: { type: "string" },
  },
  required: ["category", "priority", "founderDraft"],
  additionalProperties: false,
};

export async function classifyReply(messageId: string) {
  const message = await prisma.emailMessage.findUniqueOrThrow({
    where: { id: messageId },
    include: { contact: true, outreach: true },
  });

  const response = await anthropic.messages.create({
    model: BULK_MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Subject: ${message.subject ?? "(none)"}\n\nBody:\n${message.body}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block");

  const parsed = JSON.parse(block.text) as {
    category: ReplyCategory;
    priority: number;
    founderDraft: string;
  };

  const classification = await prisma.replyClassification.upsert({
    where: { messageId },
    create: {
      messageId,
      category: parsed.category,
      priority: parsed.priority,
      founderDraft: parsed.founderDraft,
    },
    update: {
      category: parsed.category,
      priority: parsed.priority,
      founderDraft: parsed.founderDraft,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "reply.classified",
      entity: "EmailMessage",
      entityId: messageId,
      metadata: { category: parsed.category, priority: parsed.priority },
    },
  });

  // Stop sequence and suppress for terminal categories
  if (STOP_CATEGORIES.has(parsed.category) && message.outreachId) {
    await prisma.outreach.update({
      where: { id: message.outreachId },
      data: { status: "STOPPED", stoppedAt: new Date(), stoppedReason: parsed.category },
    });
  }

  if (STOP_CATEGORIES.has(parsed.category)) {
    const reason = SUPPRESSION_MAP[parsed.category] ?? SuppressionReason.MANUAL;
    await addEmailSuppression(message.contact.email, reason);
    await prisma.contact.update({
      where: { id: message.contactId },
      data: { suppressedAt: new Date(), suppressReason: reason },
    });
  }

  return classification;
}
