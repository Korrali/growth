import OpenAI from "openai";

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

// Anthropic-shaped client backed by Groq.
export const anthropic = {
  messages: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async create(params: any) {
      const systemText = flattenSystem(params.system);
      const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (systemText) msgs.push({ role: "system", content: systemText });

      for (const msg of (params.messages as Array<{ role: string; content: unknown }>) ?? []) {
        msgs.push({ role: msg.role as "user" | "assistant", content: flattenContent(msg.content) });
      }

      const needsJson = !!(params.output_config as { format?: unknown } | undefined)?.format;

      const completion = await getGroq().chat.completions.create({
        model: toGroqModel((params.model as string) ?? CLAUDE_MODELS.default),
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
    },
  },
};
