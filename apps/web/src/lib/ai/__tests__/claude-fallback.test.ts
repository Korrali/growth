import { describe, it, expect, vi, beforeEach } from "vitest";

// Growth is free-tier-only by explicit policy: no OpenAI, no Anthropic, at
// any tier. The chain is Groq gpt-oss (primary) -> Gemini (fallback 1,
// different vendor) -> Groq Llama (fallback 2, different model family from
// gpt-oss) — see claude.ts and MODEL_REGISTRY.md.

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

const geminiGenerateContent = vi.fn();
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    getGenerativeModel(opts: { model: string }) {
      return { generateContent: (text: string) => geminiGenerateContent(opts.model, text) };
    }
  },
}));

describe("Growth claude.ts fallback chain", () => {
  beforeEach(() => {
    vi.resetModules();
    openaiCreate.mockReset();
    geminiGenerateContent.mockReset();
    process.env.GROQ_API_KEY = "test-key";
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.MOCK_AI;
    // Sanity guard: these tests must never see a paid vendor's key exercised.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("uses Groq (gpt-oss) as primary", async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: "from-groq" } }], usage: {}, model: "openai/gpt-oss-20b" });
    const { anthropic } = await import("../claude");
    const res = await anthropic.messages.create({ model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0].text).toBe("from-groq");
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(openaiCreate.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1");
    expect(geminiGenerateContent).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when Groq fails", async () => {
    openaiCreate.mockRejectedValue(new Error("groq down"));
    geminiGenerateContent.mockResolvedValue({ response: { text: () => "from-gemini" } });
    const { anthropic } = await import("../claude");
    const res = await anthropic.messages.create({ model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0].text).toBe("from-gemini");
    expect(geminiGenerateContent).toHaveBeenCalledTimes(1);
    expect(geminiGenerateContent.mock.calls[0][0]).toBe("gemini-flash-lite-latest");
  });

  it("falls back to Groq Llama (a different model family) when Groq gpt-oss and Gemini both fail", async () => {
    geminiGenerateContent.mockRejectedValue(new Error("gemini down"));
    openaiCreate.mockImplementation((_baseURL: string, params: { model: string }) => {
      if (params.model === "openai/gpt-oss-20b") throw new Error("groq gpt-oss down");
      return Promise.resolve({ choices: [{ message: { content: "from-groq-llama" } }], usage: {}, model: "llama-3.1-8b-instant" });
    });
    const { anthropic } = await import("../claude");
    const res = await anthropic.messages.create({ model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "hi" }] });
    expect(res.content[0].text).toBe("from-groq-llama");
    expect(openaiCreate).toHaveBeenCalledTimes(2);
    expect(openaiCreate.mock.calls[1][1].model).toBe("llama-3.1-8b-instant");
  });

  it("premium tier (gpt-oss-120b) routes its fallbacks to the premium sibling model, not the cheap one", async () => {
    openaiCreate.mockRejectedValue(new Error("groq down"));
    geminiGenerateContent.mockRejectedValue(new Error("gemini down"));
    const { anthropic } = await import("../claude");
    await expect(
      anthropic.messages.create({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow();
    // Gemini fallback used the premium sibling (gemini-3.6-flash), not flash-lite.
    expect(geminiGenerateContent.mock.calls[0][0]).toBe("gemini-3.6-flash");
    // Groq rescue used the premium Llama sibling (70b), not the 8b cheap tier.
    expect(openaiCreate.mock.calls[1][1].model).toBe("llama-3.3-70b-versatile");
  });

  it("throws when Groq, Gemini, and Groq-rescue all fail — never silently reaches for a paid vendor", async () => {
    openaiCreate.mockRejectedValue(new Error("groq down"));
    geminiGenerateContent.mockRejectedValue(new Error("gemini down"));
    const { anthropic } = await import("../claude");
    await expect(
      anthropic.messages.create({ model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/ALL_PROVIDERS_DOWN/);
  });

  it("opens the circuit breaker on a hard error and skips the dead provider on the next call", async () => {
    // Groq is out of quota — a persistent failure that would otherwise be
    // re-hammered on every job (fit.score failed 685× this way on 2026-07-09).
    openaiCreate.mockRejectedValue(new Error("quota exceeded"));
    geminiGenerateContent.mockResolvedValue({ response: { text: () => "from-gemini" } });
    const { anthropic } = await import("../claude");

    const res1 = await anthropic.messages.create({ model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "one" }] });
    const res2 = await anthropic.messages.create({ model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "two" }] });

    // Both calls succeed via the Gemini fallback...
    expect((res1.content[0] as { text: string }).text).toBe("from-gemini");
    expect((res2.content[0] as { text: string }).text).toBe("from-gemini");
    // ...but Groq was only hit ONCE — the breaker skipped it the second time.
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(geminiGenerateContent).toHaveBeenCalledTimes(2);
  });
});
