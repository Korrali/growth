import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/ai/claude";

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
    throw new LLMUnavailableError(message);
  }
}
