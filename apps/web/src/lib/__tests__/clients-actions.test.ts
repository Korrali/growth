import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/rbac", () => ({
  requireRole: vi.fn().mockResolvedValue(undefined),
  ForbiddenError: class ForbiddenError extends Error {},
}));

const mockPrismaClient = {
  create: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  prisma: {
    client: mockPrismaClient,
  },
}));

// Stripe mock objects — configured per test
const mockStripeInvoiceItems = { create: vi.fn() };
const mockStripeInvoices = {
  create: vi.fn(),
  finalizeInvoice: vi.fn(),
  sendInvoice: vi.fn(),
};
const mockStripeCustomers = { create: vi.fn() };

vi.mock("stripe", () => ({
  default: class MockStripe {
    invoiceItems = mockStripeInvoiceItems;
    invoices = mockStripeInvoices;
    customers = mockStripeCustomers;
    constructor(_key: string) {}
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: "client_abc",
    name: "Acme Corp",
    contactEmail: "billing@acme.com",
    plan: "RETAINER",
    status: "ACTIVE",
    stripeCustomerId: null,
    setupFeeUsd: 1500,
    monthlyFeeUsd: 500,
    perMeetingFeeUsd: 150,
    ...overrides,
  };
}

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";

  mockStripeInvoices.create.mockResolvedValue({ id: "in_test" });
  mockStripeInvoices.finalizeInvoice.mockResolvedValue({
    id: "in_test",
    hosted_invoice_url: "https://invoice.stripe.com/test",
  });
  mockStripeInvoices.sendInvoice.mockResolvedValue({});
  mockStripeInvoiceItems.create.mockResolvedValue({});
  mockStripeCustomers.create.mockResolvedValue({ id: "cus_new" });
});

// ---------------------------------------------------------------------------
// createClientAction
// ---------------------------------------------------------------------------

describe("createClientAction", () => {
  it("creates a client and returns its id", async () => {
    mockPrismaClient.create.mockResolvedValue({ id: "client_xyz" });

    const { createClientAction } = await import("../actions/clients");
    const fd = makeFormData({
      name: "Acme Corp",
      contactEmail: "billing@acme.com",
      plan: "RETAINER",
      fromName: "John from Acme",
      fromEmail: "john@acme.com",
      icpProfile: "B2B SaaS founders, 2-20 employees",
      setupFeeUsd: "1500",
      monthlyFeeUsd: "500",
    });

    const id = await createClientAction(fd);
    expect(id).toBe("client_xyz");
    expect(mockPrismaClient.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Acme Corp" }) }),
    );
  });

  it("throws when required fields are missing", async () => {
    const { createClientAction } = await import("../actions/clients");
    const fd = makeFormData({ name: "Acme" }); // missing contactEmail, plan, etc.
    await expect(createClientAction(fd)).rejects.toThrow(/required/);
  });
});

// ---------------------------------------------------------------------------
// updateClientAction
// ---------------------------------------------------------------------------

describe("updateClientAction", () => {
  it("updates a client with provided fields", async () => {
    mockPrismaClient.update.mockResolvedValue({});

    const { updateClientAction } = await import("../actions/clients");
    const fd = makeFormData({ name: "Acme Corp Updated", monthlyFeeUsd: "600" });

    await expect(updateClientAction("client_abc", fd)).resolves.toBeUndefined();
    expect(mockPrismaClient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "client_abc" } }),
    );
  });
});

// ---------------------------------------------------------------------------
// updateClientStatusAction
// ---------------------------------------------------------------------------

describe("updateClientStatusAction", () => {
  it("updates client status", async () => {
    mockPrismaClient.update.mockResolvedValue({});

    const { updateClientStatusAction } = await import("../actions/clients");
    await updateClientStatusAction("client_abc", "PAUSED");

    expect(mockPrismaClient.update).toHaveBeenCalledWith({
      where: { id: "client_abc" },
      data: { status: "PAUSED" },
    });
  });
});

// ---------------------------------------------------------------------------
// sendSetupInvoiceAction
// ---------------------------------------------------------------------------

describe("sendSetupInvoiceAction", () => {
  it("creates and sends a setup invoice, returns invoiceUrl and invoiceId", async () => {
    const client = makeClient({ stripeCustomerId: "cus_existing" });
    mockPrismaClient.findUnique.mockResolvedValue(client);

    const { sendSetupInvoiceAction } = await import("../actions/clients");
    const result = await sendSetupInvoiceAction("client_abc");

    expect(result.invoiceUrl).toBe("https://invoice.stripe.com/test");
    expect(result.invoiceId).toBe("in_test");

    // Verify the invoice item was created with the correct amount ($1500 × 100 = 150000 cents)
    expect(mockStripeInvoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 150000, description: expect.stringContaining("Setup Fee") }),
    );
  });

  it("creates a Stripe customer when none exists", async () => {
    const client = makeClient({ stripeCustomerId: null });
    mockPrismaClient.findUnique.mockResolvedValue(client);
    mockPrismaClient.update.mockResolvedValue({});

    const { sendSetupInvoiceAction } = await import("../actions/clients");
    await sendSetupInvoiceAction("client_abc");

    expect(mockStripeCustomers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "billing@acme.com" }),
    );
    expect(mockPrismaClient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stripeCustomerId: "cus_new" } }),
    );
  });

  it("throws when client not found", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(null);
    const { sendSetupInvoiceAction } = await import("../actions/clients");
    await expect(sendSetupInvoiceAction("bad_id")).rejects.toThrow("Client not found");
  });

  it("throws when setup fee is $0", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(makeClient({ setupFeeUsd: 0 }));
    const { sendSetupInvoiceAction } = await import("../actions/clients");
    await expect(sendSetupInvoiceAction("client_abc")).rejects.toThrow("Setup fee is $0");
  });

  it("skips Stripe customer creation when stripeCustomerId already set", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(makeClient({ stripeCustomerId: "cus_already" }));

    const { sendSetupInvoiceAction } = await import("../actions/clients");
    await sendSetupInvoiceAction("client_abc");

    expect(mockStripeCustomers.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendRetainerInvoiceAction
// ---------------------------------------------------------------------------

describe("sendRetainerInvoiceAction", () => {
  it("creates and sends a monthly retainer invoice", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(makeClient({ stripeCustomerId: "cus_existing" }));

    const { sendRetainerInvoiceAction } = await import("../actions/clients");
    const result = await sendRetainerInvoiceAction("client_abc");

    expect(result.invoiceUrl).toBe("https://invoice.stripe.com/test");
    expect(mockStripeInvoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 50000, // $500 × 100
        description: expect.stringContaining("Retainer"),
      }),
    );
  });

  it("throws when client is on PAY_PER_MEETING plan", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(makeClient({ plan: "PAY_PER_MEETING" }));
    const { sendRetainerInvoiceAction } = await import("../actions/clients");
    await expect(sendRetainerInvoiceAction("client_abc")).rejects.toThrow("pay-per-meeting plan");
  });

  it("throws when monthly fee is $0", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(makeClient({ monthlyFeeUsd: 0 }));
    const { sendRetainerInvoiceAction } = await import("../actions/clients");
    await expect(sendRetainerInvoiceAction("client_abc")).rejects.toThrow("Monthly fee is $0");
  });

  it("throws when client not found", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(null);
    const { sendRetainerInvoiceAction } = await import("../actions/clients");
    await expect(sendRetainerInvoiceAction("bad_id")).rejects.toThrow("Client not found");
  });
});

// ---------------------------------------------------------------------------
// sendMeetingInvoiceAction
// ---------------------------------------------------------------------------

describe("sendMeetingInvoiceAction", () => {
  it("creates and sends a meeting invoice for N meetings", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(makeClient({ stripeCustomerId: "cus_existing" }));

    const { sendMeetingInvoiceAction } = await import("../actions/clients");
    const result = await sendMeetingInvoiceAction("client_abc", 3);

    expect(result.invoiceUrl).toBe("https://invoice.stripe.com/test");
    // $150 × 100 = 15000 cents per meeting × quantity=3 → invoiceItems.create amount = 15000*3 = 45000
    expect(mockStripeInvoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 45000,
        description: expect.stringContaining("3 qualified meetings"),
      }),
    );
  });

  it("throws when meetingCount is 0", async () => {
    const { sendMeetingInvoiceAction } = await import("../actions/clients");
    await expect(sendMeetingInvoiceAction("client_abc", 0)).rejects.toThrow("meetingCount must be at least 1");
  });

  it("throws when per-meeting fee is $0", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(makeClient({ perMeetingFeeUsd: 0 }));
    const { sendMeetingInvoiceAction } = await import("../actions/clients");
    await expect(sendMeetingInvoiceAction("client_abc", 1)).rejects.toThrow("Per-meeting fee is $0");
  });

  it("throws when client not found", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(null);
    const { sendMeetingInvoiceAction } = await import("../actions/clients");
    await expect(sendMeetingInvoiceAction("bad_id", 1)).rejects.toThrow("Client not found");
  });

  it("uses singular 'meeting' for meetingCount=1", async () => {
    mockPrismaClient.findUnique.mockResolvedValue(makeClient({ stripeCustomerId: "cus_existing" }));

    const { sendMeetingInvoiceAction } = await import("../actions/clients");
    await sendMeetingInvoiceAction("client_abc", 1);

    expect(mockStripeInvoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("1 qualified meeting "),
      }),
    );
  });
});
