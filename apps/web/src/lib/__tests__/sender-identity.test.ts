import { describe, it, expect, afterEach } from "vitest";
import { senderFirstName, signOffRule } from "@/lib/sending/sender-identity";

afterEach(() => { delete process.env.GROWTH_FROM_NAME; });

describe("sender identity", () => {
  it("signs with a person's first name", () => {
    expect(senderFirstName("Ashish Bhagat")).toBe("Ashish");
    process.env.GROWTH_FROM_NAME = "Ashish Bhagat";
    expect(signOffRule()).toContain('"Ashish"');
  });

  it("leaves team senders unsigned", () => {
    expect(senderFirstName("The Korrali Team")).toBeNull();
    expect(senderFirstName("Korrali Team")).toBeNull();
    expect(senderFirstName(undefined)).toBeNull();
    process.env.GROWTH_FROM_NAME = "The Korrali Team";
    expect(signOffRule()).toBe("");
  });
});
