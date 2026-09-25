import { prisma } from "@/lib/db";

// Claude Haiku for the one row where writing quality moves revenue: the two
// personalised sentences in each cold email (email-generator.ts). Everything
// else in Growth stays on the free chain (claude.ts).
//
// Spend is capped per ISO week (Monday 00:00 UTC) at HAIKU_WEEKLY_BUDGET_USD,
// default $1 — the founder's budget. Each call's cost is recorded as an
// AuditLog "ai.spend" row, and once the week's total reaches the cap
// haikuAvailable() returns false and the caller uses the free chain instead,
// so the bill can never exceed the cap by more than one call.

export const HAIKU_MODEL = "claude-haiku-4-5";
// USD per million tokens (Haiku 4.5).
const PRICE_IN = 1.0;
const PRICE_OUT = 5.0;

export function weeklyBudgetUsd(): number {
  const v = parseFloat(process.env.HAIKU_WEEKLY_BUDGET_USD ?? "");
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

export function weekStartUtc(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

export function costUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1e6;
}

export async function spentThisWeekUsd(now = new Date()): Promise<number> {
  const rows = await prisma.auditLog.findMany({
    where: { action: "ai.spend", createdAt: { gte: weekStartUtc(now) } },
    select: { metadata: true },
  });
  return rows.reduce((sum, r) => sum + Number((r.metadata as { usd?: number } | null)?.usd ?? 0), 0);
}

export async function haikuAvailable(now = new Date()): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  return (await spentThisWeekUsd(now)) < weeklyBudgetUsd();
}

export interface HaikuResult {
  text: string;
  usd: number;
}

export async function callHaiku(args: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  purpose: string;
}): Promise<HaikuResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      output_config: { format: { type: "json_schema", schema: args.schema } },
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const usd = costUsd(data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);
  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "ai.spend",
      entity: "Anthropic",
      entityId: HAIKU_MODEL,
      metadata: { usd, purpose: args.purpose, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    },
  });
  return { text, usd };
}
