import { describe, it, expect } from "vitest";
import { classifyActivationRisk } from "@/lib/trials/activation-classifier";
import { CampaignProduct, ActivationRisk } from "@prisma/client";

// ─── Activation Risk Classifier ───────────────────────────────────────────────

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

describe("classifyActivationRisk — Trust", () => {
  it("CRITICAL: no login after 3 days", () => {
    const risk = classifyActivationRisk({
      product: CampaignProduct.TRUST,
      trialStartedAt: daysAgo(4),
      hasLogin: false,
      hasKbFacts: false,
      hasAnsweredQ: false,
      hasTrustPage: false,
      hasStripeConnected: false,
      hasSeenAnomaly: false,
    });
    expect(risk).toBe(ActivationRisk.CRITICAL);
  });

  it("HIGH: has login but no KB facts after 5 days", () => {
    const risk = classifyActivationRisk({
      product: CampaignProduct.TRUST,
      trialStartedAt: daysAgo(6),
      hasLogin: true,
      hasKbFacts: false,
      hasAnsweredQ: false,
      hasTrustPage: false,
      hasStripeConnected: false,
      hasSeenAnomaly: false,
    });
    expect(risk).toBe(ActivationRisk.HIGH);
  });

  it("MEDIUM: has KB facts but no questionnaire after 7 days", () => {
    const risk = classifyActivationRisk({
      product: CampaignProduct.TRUST,
      trialStartedAt: daysAgo(8),
      hasLogin: true,
      hasKbFacts: true,
      hasAnsweredQ: false,
      hasTrustPage: false,
      hasStripeConnected: false,
      hasSeenAnomaly: false,
    });
    expect(risk).toBe(ActivationRisk.MEDIUM);
  });

  it("LOW: has KB facts and answered a questionnaire", () => {
    const risk = classifyActivationRisk({
      product: CampaignProduct.TRUST,
      trialStartedAt: daysAgo(10),
      hasLogin: true,
      hasKbFacts: true,
      hasAnsweredQ: true,
      hasTrustPage: false,
      hasStripeConnected: false,
      hasSeenAnomaly: false,
    });
    expect(risk).toBe(ActivationRisk.LOW);
  });

  it("UNKNOWN: new trial, no signals yet", () => {
    const risk = classifyActivationRisk({
      product: CampaignProduct.TRUST,
      trialStartedAt: daysAgo(1),
      hasLogin: false,
      hasKbFacts: false,
      hasAnsweredQ: false,
      hasTrustPage: false,
      hasStripeConnected: false,
      hasSeenAnomaly: false,
    });
    expect(risk).toBe(ActivationRisk.UNKNOWN);
  });
});

describe("classifyActivationRisk — Revenue", () => {
  it("CRITICAL: no Stripe connected after 3 days", () => {
    const risk = classifyActivationRisk({
      product: CampaignProduct.REVENUE,
      trialStartedAt: daysAgo(4),
      hasLogin: false,
      hasKbFacts: false,
      hasAnsweredQ: false,
      hasTrustPage: false,
      hasStripeConnected: false,
      hasSeenAnomaly: false,
    });
    expect(risk).toBe(ActivationRisk.CRITICAL);
  });

  it("HIGH: Stripe connected but no anomaly seen after 5 days", () => {
    const risk = classifyActivationRisk({
      product: CampaignProduct.REVENUE,
      trialStartedAt: daysAgo(6),
      hasLogin: false,
      hasKbFacts: false,
      hasAnsweredQ: false,
      hasTrustPage: false,
      hasStripeConnected: true,
      hasSeenAnomaly: false,
    });
    expect(risk).toBe(ActivationRisk.HIGH);
  });

  it("LOW: connected and has seen an anomaly", () => {
    const risk = classifyActivationRisk({
      product: CampaignProduct.REVENUE,
      trialStartedAt: daysAgo(7),
      hasLogin: false,
      hasKbFacts: false,
      hasAnsweredQ: false,
      hasTrustPage: false,
      hasStripeConnected: true,
      hasSeenAnomaly: true,
    });
    expect(risk).toBe(ActivationRisk.LOW);
  });
});

// ─── Email Quality Gates ───────────────────────────────────────────────────────

