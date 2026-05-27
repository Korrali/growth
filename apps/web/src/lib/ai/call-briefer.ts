import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { HIGH_INTENT_MODEL } from "@/lib/ai/models";

export async function generateCallBrief(callId: string): Promise<string> {
  const call = await prisma.call.findUniqueOrThrow({
    where: { id: callId },
    include: {
      contact: true,
      company: true,
      outreach: {
        include: {
          emailMessages: { orderBy: { createdAt: "asc" }, take: 10 },
          campaign: true,
        },
      },
    },
  });

  const context = {
    contact: {
      name: [call.contact.firstName, call.contact.lastName].filter(Boolean).join(" "),
      title: call.contact.title,
      email: call.contact.email,
    },
    company: call.company
      ? {
          name: call.company.name,
          domain: call.company.domain,
          industry: call.company.industry,
          employeeCount: call.company.employeeCount,
          fitScore: call.company.fitScore,
          fitProduct: call.company.fitProduct,
          painHypothesis: call.company.painHypothesis,
          trigger: call.company.trigger,
          personalizedObservation: call.company.personalizedObservation,
        }
      : null,
    emailThread: call.outreach?.emailMessages.map((m) => ({
      direction: m.direction,
      subject: m.subject,
      body: m.body.slice(0, 500),
      sentAt: m.sentAt,
    })),
    scheduledAt: call.scheduledAt,
  };

  const response = await anthropic.messages.create({
    model: HIGH_INTENT_MODEL,
    max_tokens: 1024,
    system: `You are preparing a founder for a sales discovery call. Produce a concise brief with these sections:
1. Company background (2-3 sentences)
2. Why they replied / what they want (infer from email thread)
3. Likely objections (2-3 bullet points)
4. Suggested talking points (3-4 bullet points)
5. Recommended CTA for this call (one clear ask)

Be specific. Use only information provided. No fluff.`,
    messages: [
      {
        role: "user",
        content: `Prepare a call brief:\n${JSON.stringify(context, null, 2)}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block");

  await prisma.call.update({
    where: { id: callId },
    data: { brief: block.text },
  });

  return block.text;
}

export async function generateCallFollowup(callId: string): Promise<{
  email: string;
  actionItems: string[];
  nextStep: string;
}> {
  const call = await prisma.call.findUniqueOrThrow({
    where: { id: callId },
    include: { contact: true, company: true },
  });

  if (!call.notes && !call.transcript) {
    throw new Error("Call has no notes or transcript to generate follow-up from");
  }

  const response = await anthropic.messages.create({
    model: HIGH_INTENT_MODEL,
    max_tokens: 1024,
    system: `You are writing a post-call follow-up email and extracting action items. Respond with JSON only.`,
    messages: [
      {
        role: "user",
        content: `Contact: ${call.contact.firstName} ${call.contact.lastName} at ${call.company?.name ?? "their company"}
Notes: ${call.notes ?? "(none)"}
Transcript excerpt: ${call.transcript?.slice(0, 1000) ?? "(none)"}

Generate:
1. A follow-up email (warm, specific, references what was discussed, clear next step)
2. Action items as an array of strings
3. nextStep: one sentence on what happens next

Respond as JSON: { "email": string, "actionItems": string[], "nextStep": string }`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            email: { type: "string" },
            actionItems: { type: "array", items: { type: "string" } },
            nextStep: { type: "string" },
          },
          required: ["email", "actionItems", "nextStep"],
          additionalProperties: false,
        },
      },
    },
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block");

  const result = JSON.parse(block.text) as {
    email: string;
    actionItems: string[];
    nextStep: string;
  };

  await prisma.call.update({
    where: { id: callId },
    data: {
      followUpEmail: result.email,
      actionItems: result.actionItems,
      nextStep: result.nextStep,
    },
  });

  return result;
}
