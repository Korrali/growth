import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// Real Anthropic client — used for claude-* models when ANTHROPIC_API_KEY is
// set. Unlike Groq's json_object mode (no schema enforcement — the source of
// invalid-enum fit scores and reasoning/score contradictions), the Anthropic
// API hard-enforces output_config json_schema.
let _anthropic: Anthropic | null = null;
function getRealAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 3, timeout: 60_000 });
  return _anthropic;
}

// Real OpenAI client — the runtime fallback when the primary provider call
// (Claude, or Groq for HIGH_INTENT_MODEL-tier features) fails.
let _openai: OpenAI | null = null;
function getRealOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "", maxRetries: 3, timeout: 45_000 });
  return _openai;
}

// Groq: OpenAI-compatible, free tier 14,400 req/day.
// TPM: 6,000 for 70B (cheap model), 131,072 for 8B — well within cash-sprint volume.
let _groq: OpenAI | null = null;
function getGroq() {
  if (!_groq) _groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY ?? "", baseURL: "https://api.groq.com/openai/v1", maxRetries: 3, timeout: 45_000 });
  return _groq;
}

export const CLAUDE_MODELS = {
  default: "llama-3.3-70b-versatile",
  premium: "llama-3.3-70b-versatile",
  cheap: "llama-3.1-8b-instant",      // 131K TPM — no throttle risk for email gen
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

function toGroqModel(model: string): string {
  if (model.includes("haiku") || model.includes("8b-instant")) return "llama-3.1-8b-instant";
  // llama-4-scout: 500K TPD (vs 70B's 100K) — mandatory switch to avoid TPD exhaustion on large prompts
  return "meta-llama/llama-4-scout-17b-16e-instruct";
}

function flattenSystem(system: unknown): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return (system as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return "";
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return String(content ?? "");
}

// Builds a minimal, schema-valid stand-in for MOCK_AI mode. Every feature
// (fit-scorer, email-generator, reply-classifier, etc.) calls anthropic.messages.create()
// directly rather than through a shared generateText() wrapper, so this is the
// one place that needs to short-circuit real API calls for all of them.
// Prefers "safe" enum values (REJECT/NONE/OTHER/unknown) so mocked scores never
// cross real thresholds (e.g. auto-triggering contact discovery or auto-send).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockValueForSchema(schema: any): unknown {
  if (!schema) return null;
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.find((t: string) => t !== "null") ?? schema.type[0];
    return mockValueForSchema({ ...schema, type: nonNull });
  }
  if (Array.isArray(schema.enum)) {
    const safe = schema.enum.find((v: unknown) => /^(reject|none|other|unknown)$/i.test(String(v)));
    return safe ?? schema.enum[0];
  }
  switch (schema.type) {
    case "object": {
      const obj: Record<string, unknown> = {};
      const keys = schema.required ?? Object.keys(schema.properties ?? {});
      for (const key of keys) obj[key] = mockValueForSchema(schema.properties?.[key]);
      return obj;
    }
    case "array":
      // A representative single item, not [] — some callers (e.g. email-generator's
      // "steps") throw on an empty array.
      return schema.items ? [mockValueForSchema(schema.items)] : [];
    case "string":
      return "MOCK_AI_RESPONSE";
    case "number":
      return 1;
    case "boolean":
      return false;
    default:
      return null;
  }
}

// Builds OpenAI-compatible messages from Anthropic-shaped params and calls
// any OpenAI-compatible client (real OpenAI or Groq), returning an
// Anthropic-shaped response so callers never know which provider served it.
async function callOpenAICompatible(
  client: OpenAI,
  model: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any,
) {
  const systemText = flattenSystem(params.system);
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemText) msgs.push({ role: "system", content: systemText });

  for (const msg of (params.messages as Array<{ role: string; content: unknown }>) ?? []) {
    msgs.push({ role: msg.role as "user" | "assistant", content: flattenContent(msg.content) });
  }

  const needsJson = !!(params.output_config as { format?: unknown } | undefined)?.format;

  const completion = await client.chat.completions.create({
    model,
    max_tokens: (params.max_tokens as number) ?? 1024,
    messages: msgs,
    temperature: params.temperature as number | undefined,
    ...(needsJson ? { response_format: { type: "json_object" as const } } : {}),
  });

  const text = completion.choices[0]?.message?.content ?? "";
  return {
    content: [{ type: "text" as const, text }],
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
    },
    model: completion.model,
    stop_reason: "end_turn" as const,
  };
}

// Anthropic-shaped client. Every feature in this codebase calls
// anthropic.messages.create() directly (no shared generateText() wrapper),
// so this is the single place resilience needs to live for all of them.
//
// claude-* models: Claude (primary) -> OpenAI gpt-4o-mini -> Groq (final).
// Non-claude models (e.g. HIGH_INTENT_MODEL-tier features not yet migrated
// to Claude): Groq (primary, unchanged) -> OpenAI gpt-4o-mini (fallback).
export const anthropic = {
  messages: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async create(params: any) {
      if (process.env.MOCK_AI === "true") {
        const schema = (params.output_config as { format?: { schema?: unknown } } | undefined)
          ?.format?.schema;
        const text = schema ? JSON.stringify(mockValueForSchema(schema)) : "MOCK_AI_RESPONSE";
        return {
          content: [{ type: "text" as const, text }],
          usage: { input_tokens: 0, output_tokens: 0 },
          model: params.model,
          stop_reason: "end_turn" as const,
        };
      }

      const wantsClaude =
        !!process.env.ANTHROPIC_API_KEY &&
        typeof params.model === "string" &&
        params.model.startsWith("claude");

      if (wantsClaude) {
        try {
          return await getRealAnthropic().messages.create(params);
        } catch (err) {
          console.warn("[ai] Anthropic call failed, falling back to OpenAI:", err instanceof Error ? err.message : err);
          try {
            if (!process.env.OPENAI_API_KEY) throw new Error("No OPENAI_API_KEY configured");
            return await callOpenAICompatible(getRealOpenAI(), "gpt-4o-mini", params);
          } catch (openaiErr) {
            console.warn("[ai] OpenAI fallback failed, falling back to Groq:", openaiErr instanceof Error ? openaiErr.message : openaiErr);
            return await callOpenAICompatible(getGroq(), toGroqModel(params.model as string), params);
          }
        }
      }

      // Primary here is Groq (non-claude model string, e.g. HIGH_INTENT_MODEL).
      try {
        return await callOpenAICompatible(
          getGroq(),
          toGroqModel((params.model as string) ?? CLAUDE_MODELS.default),
          params,
        );
      } catch (err) {
        console.warn("[ai] Groq call failed, falling back to OpenAI:", err instanceof Error ? err.message : err);
        if (!process.env.OPENAI_API_KEY) throw err;
        return await callOpenAICompatible(getRealOpenAI(), "gpt-4o-mini", params);
      }
    },
  },
};
