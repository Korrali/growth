import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/sending/template-renderer";

describe("renderTemplate", () => {
  it("replaces known tokens", () => {
    const result = renderTemplate("Hi {{firstName}}!", { firstName: "Alice" });
    expect(result).toBe("Hi Alice!");
  });

  it("falls back to 'there' when firstName is null", () => {
    const result = renderTemplate("Hi {{firstName}}!", { firstName: null });
    expect(result).toBe("Hi there!");
  });

  it("falls back to 'there' when firstName is undefined", () => {
    const result = renderTemplate("Hi {{firstName}}!", {});
    expect(result).toBe("Hi there!");
  });

  it("replaces companyName token", () => {
    const result = renderTemplate("{{companyName}} uses Stripe", { companyName: "Acme" });
    expect(result).toBe("Acme uses Stripe");
  });

  it("falls back to 'your company' when companyName is null", () => {
    const result = renderTemplate("{{companyName}} uses Stripe", { companyName: null });
    expect(result).toBe("your company uses Stripe");
  });

  it("leaves unknown tokens as-is", () => {
    const result = renderTemplate("Hello {{unknownToken}}", {});
    expect(result).toBe("Hello {{unknownToken}}");
  });

  it("replaces multiple tokens in one pass", () => {
    const result = renderTemplate(
      "Hi {{firstName}} at {{companyName}}",
      { firstName: "Bob", companyName: "Widgets Inc" },
    );
    expect(result).toBe("Hi Bob at Widgets Inc");
  });

  it("handles empty string values as falsy — uses fallback", () => {
    const result = renderTemplate("Hi {{firstName}}", { firstName: "" });
    expect(result).toBe("Hi there");
  });

  it("does not replace tokens that don't match the pattern", () => {
    const result = renderTemplate("Price: {firstName}", { firstName: "Bob" });
    expect(result).toBe("Price: {firstName}");
  });
});
