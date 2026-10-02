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
//
// OpenAI's small model is the backup, used when the Anthropic call fails (no
// credit, outage) or Haiku's cap is reached. It has its own weekly cap,
// OPENAI_WEEKLY_BUDGET_USD (default $1), and its cost is recorded the same way.

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

// Haiku-class OpenAI model, overridable without a deploy. USD per million
// tokens (gpt-5-mini).
export function openaiBackupModel(): string {
  return process.env.OPENAI_BACKUP_MODEL || "gpt-5-mini";
}
const OPENAI_PRICE_IN = 0.25;
const OPENAI_PRICE_OUT = 2.0;

export function openaiCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * OPENAI_PRICE_IN + outputTokens * OPENAI_PRICE_OUT) / 1e6;
}

export function openaiWeeklyBudgetUsd(): number {
  const v = parseFloat(process.env.OPENAI_WEEKLY_BUDGET_USD ?? "");
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

/** This week's paid AI spend: one vendor's ("Anthropic" | "OpenAI"), or all of it. */
export async function spentThisWeekUsd(now = new Date(), vendor?: "Anthropic" | "OpenAI"): Promise<number> {
  const rows = await prisma.auditLog.findMany({
    where: { action: "ai.spend", createdAt: { gte: weekStartUtc(now) }, ...(vendor ? { entity: vendor } : {}) },
    select: { metadata: true },
  });
  return rows.reduce((sum, r) => sum + Number((r.metadata as { usd?: number } | null)?.usd ?? 0), 0);
}

export async function haikuAvailable(now = new Date()): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  return (await spentThisWeekUsd(now, "Anthropic")) < weeklyBudgetUsd();
}

export async function openaiBackupAvailable(now = new Date()): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY) return false;
  return (await spentThisWeekUsd(now, "OpenAI")) < openaiWeeklyBudgetUsd();
}

async function recordSpend(vendor: string, model: string, purpose: string, inputTokens: number, outputTokens: number, usd: number) {
  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "ai.spend",
      entity: vendor,
      entityId: model,
      metadata: { usd, purpose, inputTokens, outputTokens },
    },
  });
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
  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const usd = costUsd(inputTokens, outputTokens);
  await recordSpend("Anthropic", HAIKU_MODEL, args.purpose, inputTokens, outputTokens, usd);
  return { text, usd };
}

export async function callOpenAIBackup(args: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  purpose: string;
}): Promise<HaikuResult> {
  const model = openaiBackupModel();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      // gpt-5-mini is a reasoning model: thinking tokens share this limit, so
      // keep it minimal and leave headroom over the answer's own budget.
      reasoning_effort: "minimal",
      max_completion_tokens: args.maxTokens + 1000,
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: args.schema } },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenAI returned no content");
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const usd = openaiCostUsd(inputTokens, outputTokens);
  await recordSpend("OpenAI", model, args.purpose, inputTokens, outputTokens, usd);
  return { text, usd };
}
