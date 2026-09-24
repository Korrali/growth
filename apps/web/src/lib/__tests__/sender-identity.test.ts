import { describe, it, expect, afterEach } from "vitest";
import { senderFirstName, signOffRule, withSignOff } from "@/lib/sending/sender-identity";

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

describe("withSignOff", () => {
  it("appends the first name when missing", () => {
    expect(withSignOff("Hi Matt.\n\nWorth a look?", "Ashish Bhagat")).toBe("Hi Matt.\n\nWorth a look?\n\nAshish");
  });
  it("does not double-sign", () => {
    expect(withSignOff("Worth a look?\n\nAshish", "Ashish Bhagat")).toBe("Worth a look?\n\nAshish");
    expect(withSignOff("Worth a look?\n\n— Ashish", "Ashish Bhagat")).toBe("Worth a look?\n\n— Ashish");
    expect(withSignOff("Worth a look?\nBest, Ashish", "Ashish Bhagat")).toBe("Worth a look?\nBest, Ashish");
  });
  it("leaves team senders alone", () => {
    expect(withSignOff("Body", "The Korrali Team")).toBe("Body");
  });
});
