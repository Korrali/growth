import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/ai/claude";
import { openai } from "@/lib/ai/openai";

export class LLMUnavailableError extends Error {
  public readonly cause: string;

  constructor(cause: string) {
    super(`AI provider failed: ${cause}`);
    this.name = "LLMUnavailableError";
    this.cause = cause;
  }
}

export interface GenerateTextResult {
  text: string;
}

type AnthropicParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

export async function generateText(
  params: AnthropicParams,
): Promise<GenerateTextResult> {
  try {
    const response = await anthropic.messages.create(params);
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("Anthropic returned no text block");
    }
    return { text: block.text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    
    // Fallback: OpenAI
    try {
      const messages = translateMessages(params);
      
      let model = "gpt-4o"; // fallback default
      if (params.model.includes("haiku")) {
        model = "gpt-4o-mini";
      }

      const completion = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: params.max_tokens,
      });

      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("OpenAI returned no content");

      return { text };
    } catch (fallbackErr) {
      const fbMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new LLMUnavailableError(`Anthropic: ${message} | OpenAI Fallback: ${fbMessage}`);
    }
  }
}

// ---------- Shared helpers ----------

function translateMessages(
  params: AnthropicParams,
): { role: "system" | "user" | "assistant"; content: string }[] {
  const out: { role: "system" | "user" | "assistant"; content: string }[] = [];
  const systemText = flattenSystem(params.system);
  if (systemText) out.push({ role: "system", content: systemText });
  for (const msg of params.messages) {
    const content =
      typeof msg.content === "string" ? msg.content : flattenContent(msg.content);
    if (!content) continue;
    if (msg.role === "user" || msg.role === "assistant") {
      out.push({ role: msg.role, content });
    }
  }
  return out;
}

function flattenSystem(system: AnthropicParams["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function flattenContent(
  content: Anthropic.Messages.ContentBlockParam[],
): string {
  return content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n\n");
}
