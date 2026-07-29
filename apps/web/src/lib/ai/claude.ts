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

// Backup only: when Groq (primary) AND OpenAI both fail, retry on Claude Haiku —
// the cheapest Claude tier, plenty for a rescue. The incoming model string is a
// Groq/Llama id (BULK/WRITING/HIGH_INTENT all resolve to Llama), so it MUST be
// remapped to a real Claude model id or the Anthropic call 404s.
function toClaudeModel(_model: string): string {
  return "claude-haiku-4-5";
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

// ── Provider circuit breaker ────────────────────────────────────────────────
// A billing lapse or exhausted quota makes a provider fail EVERY call, not one.
// Without a breaker the shim re-hammers the dead provider on every job — on
// 2026-07-09 fit.score failed 685× against an empty Anthropic wallet with no
// alert and a silently starved funnel. This tracks per-provider health: on a
// failure we open the breaker for a cooldown so later calls skip straight to a
// working fallback, and we emit ONE loud, greppable alert per outage window
// (grep `[ai][PROVIDER_DOWN]` in the pm2 error log) instead of a silent flood.
type ProviderName = "anthropic" | "openai" | "groq";
const HARD_COOLDOWN_MS = 15 * 60_000; // billing/auth — persistent until a human acts
const SOFT_COOLDOWN_MS = 5 * 60_000; // rate limit / transient
const breaker: Record<ProviderName, { downUntil: number; alertedAt: number }> = {
  anthropic: { downUntil: 0, alertedAt: 0 },
  openai: { downUntil: 0, alertedAt: 0 },
  groq: { downUntil: 0, alertedAt: 0 },
};

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// Hard = the provider will keep failing until a human acts (billing/auth/quota),
// so we back off long and shout. Everything else is treated as transient.
function isHardProviderError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  return /credit balance|billing|insufficient|quota|unauthorized|invalid.*api.*key|permission/i.test(errMessage(err));
}

// Who gets the "a model provider is down" alert, and from where. The alert must
// reach a human when the free Groq path (or a fallback) dies on expired
// credits / a revoked key / an exhausted quota — the exact failure that silently
// starved the funnel on 2026-07-09. Sent via Resend, so the FROM address must be
// on a Resend-verified domain (korrali.com) — NOT the getkorrali.com SES domain.
const AI_ALERT_EMAIL = process.env.AI_ALERT_EMAIL ?? "ashish.bhagat@korrali.com";
const AI_ALERT_FROM = process.env.AI_ALERT_FROM ?? "Korrali Growth <growth@korrali.com>";

// Fire-and-forget founder alert on a provider outage. Called only from inside
// markProviderDown's one-alert-per-cooldown-window guard, so during an outage
// it sends at most ~1 email per provider per window (5 min soft / 15 min hard) —
// no flood. Never awaited and never throws: the AI hot path must not block or
// break on a mail failure.
function emailProviderDownAlert(name: ProviderName, hard: boolean, detail: string): void {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const body = {
    from: AI_ALERT_FROM,
    to: [AI_ALERT_EMAIL],
    subject: `[Growth AI] ${name} provider DOWN — ${hard ? "HARD, needs action" : "transient"}`,
    text: [
      `A model provider in the Growth engine just failed and its circuit breaker opened.`,
      ``,
      `Provider: ${name}`,
      `Class:    ${hard ? "HARD — will keep failing until a human acts (expired credits, revoked/invalid API key, or exhausted quota)" : "soft/transient (rate limit or network blip)"}`,
      `Error:    ${detail}`,
      ``,
      hard
        ? `Action needed: top up or fix the ${name} account/key. The engine has fallen back to the next provider in the chain (Groq → OpenAI → Claude), but the primary free path won't recover on its own.`
        : `Usually self-heals after the cooldown — monitoring only, no action expected.`,
    ].join("\n"),
  };
  void fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((e) => console.error("[ai] provider-down alert email failed to send", e));
}

function markProviderDown(name: ProviderName, err: unknown): void {
  const now = Date.now();
  const hard = isHardProviderError(err);
  const cooldown = hard ? HARD_COOLDOWN_MS : SOFT_COOLDOWN_MS;
  breaker[name].downUntil = now + cooldown;
  // One alert per outage window per provider — loud + greppable for monitoring.
  if (now - breaker[name].alertedAt > cooldown) {
    breaker[name].alertedAt = now;
    console.error(
      `[ai][PROVIDER_DOWN] ${name} ${hard ? "HARD (billing/auth/quota — needs a human)" : "soft (transient)"}: ${errMessage(err)}`,
    );
    // Email the founder too — console alerts went unseen for 685 failed calls
    // on 2026-07-09. Inherits the guard above, so it's deduped to 1/window.
    emailProviderDownAlert(name, hard, errMessage(err));
  }
}

function providerAvailable(name: ProviderName): boolean {
  return Date.now() >= breaker[name].downUntil;
}

function markProviderUp(name: ProviderName): void {
  if (breaker[name].downUntil !== 0) {
    console.error(`[ai][PROVIDER_RECOVERED] ${name} is serving again`);
    breaker[name] = { downUntil: 0, alertedAt: 0 };
  }
}

// Anthropic-shaped client. Every feature in this codebase calls
// anthropic.messages.create() directly (no shared generateText() wrapper),
// so this is the single place resilience needs to live for all of them.
//
// Every feature runs Groq-first (the model slots all resolve to Llama ids):
//   Groq (primary, free) -> OpenAI gpt-4o-mini -> Claude Haiku (final).
// A request that explicitly asks for a claude-* model instead runs:
//   Claude (primary) -> OpenAI gpt-4o-mini -> Groq (final).
// OpenAI and Claude are BACKUP ONLY — present in the chain solely so a Groq
// outage (expired key/quota) degrades gracefully instead of starving the funnel.
// Each is included only when its API key is set. A provider whose breaker is
// open is skipped for its cooldown window.
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

      const hasOpenAI = !!process.env.OPENAI_API_KEY;
      const wantsClaude =
        !!process.env.ANTHROPIC_API_KEY &&
        typeof params.model === "string" &&
        params.model.startsWith("claude");

      // Ordered provider attempts for this call. claude-* → Anthropic first;
      // everything else → Groq first. OpenAI is only in the chain when keyed.
      // Order is preserved from the original chain (see claude-fallback.test.ts).
      // No return-type annotation on `run`: let TS infer the same response union
      // the original inline returns produced, so callers keep their `.content` types.
      const attempts = wantsClaude
        ? [
            { name: "anthropic" as const, run: () => getRealAnthropic().messages.create(params) },
            ...(hasOpenAI
              ? [{ name: "openai" as const, run: () => callOpenAICompatible(getRealOpenAI(), "gpt-4o-mini", params) }]
              : []),
            { name: "groq" as const, run: () => callOpenAICompatible(getGroq(), toGroqModel(params.model as string), params) },
          ]
        : [
            { name: "groq" as const, run: () => callOpenAICompatible(getGroq(), toGroqModel((params.model as string) ?? CLAUDE_MODELS.default), params) },
            ...(hasOpenAI
              ? [{ name: "openai" as const, run: () => callOpenAICompatible(getRealOpenAI(), "gpt-4o-mini", params) }]
              : []),
            // Final backup: Claude Haiku. The model string is a Llama id, so it
            // must be remapped or Anthropic 404s. Only when ANTHROPIC_API_KEY is set.
            ...(process.env.ANTHROPIC_API_KEY
              ? [{ name: "anthropic" as const, run: () => getRealAnthropic().messages.create({ ...params, model: toClaudeModel(params.model as string) }) }]
              : []),
          ];

      let lastErr: unknown = new Error("no AI provider configured");
      let anyAttempted = false;
      for (const attempt of attempts) {
        if (!providerAvailable(attempt.name)) continue; // breaker open — skip fast
        anyAttempted = true;
        try {
          const res = await attempt.run();
          markProviderUp(attempt.name);
          return res;
        } catch (err) {
          lastErr = err;
          markProviderDown(attempt.name, err);
          console.warn(`[ai] ${attempt.name} call failed, trying next fallback:`, errMessage(err));
        }
      }

      // Everything was skipped by an open breaker. Don't fail blind on a stale
      // cooldown guess — try the last (most-likely-up) provider once anyway.
      if (!anyAttempted && attempts.length > 0) {
        const last = attempts[attempts.length - 1];
        try {
          const res = await last.run();
          markProviderUp(last.name);
          return res;
        } catch (err) {
          lastErr = err;
          markProviderDown(last.name, err);
        }
      }

      throw new Error(`[ai][ALL_PROVIDERS_DOWN] every provider failed or is cooling down. Last error: ${errMessage(lastErr)}`);
    },
  },
};
