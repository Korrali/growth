import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const { toTrackerRow } = await import("@/lib/tracker/sheet-sync");
type Outreach = Parameters<typeof toTrackerRow>[0];
type Message = Outreach["messages"][number];

const NOW = new Date("2026-09-30T12:00:00Z");

const sent = (date: string, extra: Partial<Message> = {}): Message => ({
  direction: "OUTBOUND", sentAt: new Date(date), bouncedAt: null, createdAt: new Date(date), body: "email", classification: null, ...extra,
});
const reply = (date: string, category: string | null, body = "Thanks, tell me more", extra: Partial<NonNullable<Message["classification"]>> = {}): Message => ({
  direction: "INBOUND", sentAt: null, bouncedAt: null, createdAt: new Date(date), body,
  classification: category ? { category: category as never, autoSendAt: null, autoSentAt: null, autoSendCancelledAt: null, ...extra } : null,
});

function outreach(overrides: Partial<Outreach> = {}): Outreach {
  return {
    status: "ACTIVE",
    nextSendAt: new Date("2026-10-03T14:00:00Z"),
    stoppedReason: null,
    updatedAt: new Date("2026-09-28T14:00:00Z"),
    product: "REVENUE",
    contact: { email: "dana@acme.example", firstName: "Dana", lastName: "Lee", linkedinUrl: "https://www.linkedin.com/in/danalee" },
    companyName: "Acme",
    messages: [sent("2026-09-28T14:00:00Z")],
    ...overrides,
  };
}

describe("toTrackerRow", () => {
  it("fills the tracker's columns for a prospect who was emailed", () => {
    expect(toTrackerRow(outreach(), NOW)).toEqual({
      Name: "Dana Lee",
      Company: "Acme",
      Product: "Revenue",
      Type: "buyer",
      Source: "Growth cold email",
      Status: "Contacted",
      "Next step": "Next email due 2026-10-03.",
      Date: "2026-09-28",
      Email: "dana@acme.example",
      LinkedIn: "https://www.linkedin.com/in/danalee",
      "Emails sent": 1,
      "Reply type": "",
      "Last reply": "",
    });
  });

  it("marks a human reply as Replied and dates the row by it", () => {
    const row = toTrackerRow(outreach({ status: "REPLIED", messages: [sent("2026-09-28T14:00:00Z"), reply("2026-09-29T09:00:00Z", "OBJECTION", "We already\n use  Baremetrics")] }), NOW);
    expect(row.Status).toBe("Replied");
    expect(row["Next step"]).toBe("Answer their objection.");
    expect(row.Date).toBe("2026-09-29");
    expect(row["Reply type"]).toBe("objection");
    expect(row["Last reply"]).toBe("We already use Baremetrics");
  });

  it("counts a reply the classifier hasn't reached yet", () => {
    const row = toTrackerRow(outreach({ status: "REPLIED", messages: [sent("2026-09-28T14:00:00Z"), reply("2026-09-29T09:00:00Z", null)] }), NOW);
    expect(row.Status).toBe("Replied");
    expect(row["Reply type"]).toBe("unclassified");
  });

  it("ignores out-of-office replies", () => {
    const row = toTrackerRow(outreach({ messages: [sent("2026-09-28T14:00:00Z"), reply("2026-09-28T15:00:00Z", "AUTO_REPLY", "I'm away")] }), NOW);
    expect(row.Status).toBe("Contacted");
    expect(row["Last reply"]).toBe("");
  });

  it("says when an interested prospect's drafted reply goes out", () => {
    const pending = reply("2026-09-30T10:00:00Z", "INTERESTED", "Yes please", { autoSendAt: new Date("2026-09-30T12:00:01Z") });
    expect(toTrackerRow(outreach({ messages: [sent("2026-09-28T14:00:00Z"), pending] }), NOW)["Next step"]).toBe(
      "Interested. Drafted reply sends 2026-09-30 unless you cancel it in Growth.",
    );
    const done = reply("2026-09-30T10:00:00Z", "INTERESTED", "Yes please", { autoSentAt: new Date("2026-09-30T12:00:00Z") });
    expect(toTrackerRow(outreach({ messages: [sent("2026-09-28T14:00:00Z"), done] }), NOW)["Next step"]).toBe(
      "Interested. Reply sent 2026-09-30; book the call.",
    );
  });

  it("marks unsubscribes, refusals and bounces as Lost", () => {
    expect(toTrackerRow(outreach({ status: "UNSUBSCRIBED" }), NOW).Status).toBe("Lost");
    expect(toTrackerRow(outreach({ messages: [sent("2026-09-28T14:00:00Z"), reply("2026-09-29T09:00:00Z", "NEGATIVE", "No")] }), NOW)["Next step"]).toBe("Said no.");
    const bounced = toTrackerRow(outreach({ messages: [sent("2026-09-28T14:00:00Z", { bouncedAt: new Date("2026-09-28T14:05:00Z") })] }), NOW);
    expect(bounced.Status).toBe("Lost");
    expect(bounced["Next step"]).toBe("Email bounced. Find another contact.");
  });

  it("says when the sequence ran out without a reply", () => {
    const row = toTrackerRow(outreach({ status: "COMPLETED", nextSendAt: null, messages: [sent("2026-09-20T14:00:00Z"), sent("2026-09-23T14:00:00Z"), sent("2026-09-27T14:00:00Z")] }), NOW);
    expect(row["Next step"]).toBe("Sequence finished, no reply.");
    expect(row["Emails sent"]).toBe(3);
    expect(row.Date).toBe("2026-09-27");
  });
});
