import { describe, it, expect, vi, beforeEach } from "vitest";

const anthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreate };
    constructor(_opts?: unknown) {}
  },
}));

const openaiCreate = vi.fn();
vi.mock("openai", () => ({
  default: class MockOpenAI {
    baseURL: string;
    chat = { completions: { create: (params: any) => openaiCreate(this.baseURL, params) } };
    constructor(opts?: { baseURL?: string }) {
      this.baseURL = opts?.baseURL ?? "https://api.openai.com";
    }
  },
}));

describe("Growth claude.ts fallback chain", () => {
  beforeEach(() => {
    vi.resetModules();
    anthropicCreate.mockReset();
    openaiCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GROQ_API_KEY = "test-key";
    delete process.env.MOCK_AI;
  });

  it("claude-* model: uses real Anthropic when it succeeds", async () => {
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "from-anthropic" }] });
    const { anthropic } = await import("../claude");
    const res = await anthropic.messages.create({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0].text).toBe("from-anthropic");
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("claude-* model: falls back to OpenAI gpt-4o-mini when Anthropic fails", async () => {
    anthropicCreate.mockRejectedValue(new Error("anthropic down"));
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: "from-openai" } }], usage: {}, model: "gpt-4o-mini" });
    const { anthropic } = await import("../claude");
    const res = await anthropic.messages.create({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0].text).toBe("from-openai");
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    const [baseURL, params] = openaiCreate.mock.calls[0];
    expect(baseURL).toBe("https://api.openai.com"); // real OpenAI, not Groq's baseURL
    expect(params.model).toBe("gpt-4o-mini");
  });

  it("claude-* model: falls back to Groq when both Anthropic and OpenAI fail", async () => {
    anthropicCreate.mockRejectedValue(new Error("anthropic down"));
    openaiCreate.mockImplementation((baseURL: string) => {
      if (baseURL === "https://api.openai.com") throw new Error("openai down too");
      return Promise.resolve({ choices: [{ message: { content: "from-groq" } }], usage: {}, model: "llama-3.1-8b-instant" });
    });
    const { anthropic } = await import("../claude");
    const res = await anthropic.messages.create({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0].text).toBe("from-groq");
    expect(openaiCreate).toHaveBeenCalledTimes(2);
    const groqCall = openaiCreate.mock.calls[1];
    expect(groqCall[0]).toBe("https://api.groq.com/openai/v1");
  });

  it("non-claude model (HIGH_INTENT_MODEL tier): uses Groq as primary, not OpenAI", async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: "from-groq-primary" } }], usage: {}, model: "meta-llama/llama-4-scout-17b-16e-instruct" });
    const { anthropic } = await import("../claude");
    const res = await anthropic.messages.create({ model: "llama-4-scout", messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0].text).toBe("from-groq-primary");
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(openaiCreate.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1");
  });

  it("non-claude model: falls back to OpenAI gpt-4o-mini when Groq fails", async () => {
    openaiCreate.mockImplementation((baseURL: string) => {
      if (baseURL === "https://api.groq.com/openai/v1") throw new Error("groq down");
      return Promise.resolve({ choices: [{ message: { content: "from-openai-fallback" } }], usage: {}, model: "gpt-4o-mini" });
    });
    const { anthropic } = await import("../claude");
    const res = await anthropic.messages.create({ model: "llama-4-scout", messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0].text).toBe("from-openai-fallback");
    expect(openaiCreate).toHaveBeenCalledTimes(2);
    expect(openaiCreate.mock.calls[1][1].model).toBe("gpt-4o-mini");
  });
});
