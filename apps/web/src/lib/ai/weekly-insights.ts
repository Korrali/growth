import { prisma } from "@/lib/db";
import { anthropic } from "@/lib/ai/claude";
import { BULK_MODEL } from "@/lib/ai/models";
import { ReplyCategory } from "@prisma/client";
import { enqueueContentGenerate } from "@/lib/queue";

export async function generateWeeklyInsights(weekOf: Date): Promise<void> {
  const weekStart = new Date(weekOf);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [sends, replies, interestedReplies, companies, trials] = await Promise.all([
    prisma.emailMessage.count({
      where: { direction: "OUTBOUND", sentAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.emailMessage.count({
      where: { direction: "INBOUND", createdAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.replyClassification.count({
      where: {
        category: ReplyCategory.INTERESTED,
        createdAt: { gte: weekStart, lt: weekEnd },
      },
    }),
    prisma.company.count({ where: { fitScore: { gte: 7 } } }),
    prisma.trial.count({ where: { status: "ACTIVE" } }),
  ]);

  const replyRate = sends > 0 ? ((replies / sends) * 100).toFixed(1) : "0";

  const rawStats = { sends, replies, replyRate, interestedReplies, highFitCompanies: companies, activeTrials: trials };

  const response = await anthropic.messages.create({
    model: BULK_MODEL,
    max_tokens: 1024,
    system: `You are analyzing growth metrics for Korrali, a B2B SaaS founder's internal growth platform. Provide a concise weekly summary with actionable recommendations. Respond with JSON only.`,
    messages: [
      {
        role: "user",
        content: `Weekly stats for ${weekStart.toISOString().slice(0, 10)}:\n${JSON.stringify(rawStats, null, 2)}\n\nGenerate: { "summary": string, "bestSegments": string[], "bestSubjectLines": string[], "topObjections": string[], "recommendations": string[] }`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            bestSegments: { type: "array", items: { type: "string" } },
            bestSubjectLines: { type: "array", items: { type: "string" } },
            topObjections: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "bestSegments", "bestSubjectLines", "topObjections", "recommendations"],
          additionalProperties: false,
        },
      },
    },
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block");

  const parsed = JSON.parse(block.text) as {
    summary: string;
    bestSegments: string[];
    bestSubjectLines: string[];
    topObjections: string[];
    recommendations: string[];
  };

  await prisma.growthInsight.upsert({
    where: { weekOf: weekStart },
    create: {
      weekOf: weekStart,
      summary: parsed.summary,
      bestSegments: parsed.bestSegments,
      bestSubjectLines: parsed.bestSubjectLines,
      topObjections: parsed.topObjections,
      recommendations: parsed.recommendations,
      rawStats,
    },
    update: {
      summary: parsed.summary,
      bestSegments: parsed.bestSegments,
      bestSubjectLines: parsed.bestSubjectLines,
      topObjections: parsed.topObjections,
      recommendations: parsed.recommendations,
      rawStats,
    },
  });

  // Auto-atomize this week's insight into draft content for review
  const sourceData = {
    summary: parsed.summary,
    recommendations: parsed.recommendations,
    bestSegments: parsed.bestSegments,
    topObjections: parsed.topObjections,
    weekOf: weekStart.toISOString(),
  };
  for (const type of ["LINKEDIN_POST", "X_THREAD", "INDIE_HACKERS_POST"] as const) {
    await enqueueContentGenerate({ type, sourceData });
  }
}
