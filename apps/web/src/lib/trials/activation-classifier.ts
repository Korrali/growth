import { ActivationRisk, CampaignProduct } from "@prisma/client";

interface TrialData {
  product: CampaignProduct;
  trialStartedAt: Date;
  hasLogin: boolean;
  hasKbFacts: boolean;
  hasAnsweredQ: boolean;
  hasTrustPage: boolean;
  hasStripeConnected: boolean;
  hasSeenAnomaly: boolean;
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export function classifyActivationRisk(trial: TrialData): ActivationRisk {
  const age = daysSince(trial.trialStartedAt);

  if (trial.product === CampaignProduct.TRUST) {
    if (!trial.hasLogin && age >= 3) return ActivationRisk.CRITICAL;
    if (!trial.hasKbFacts && age >= 5) return ActivationRisk.HIGH;
    if (trial.hasKbFacts && !trial.hasAnsweredQ && age >= 7) return ActivationRisk.MEDIUM;
    if (trial.hasKbFacts && trial.hasAnsweredQ) return ActivationRisk.LOW;
    return ActivationRisk.UNKNOWN;
  }

  if (trial.product === CampaignProduct.REVENUE) {
    if (!trial.hasStripeConnected && age >= 3) return ActivationRisk.CRITICAL;
    if (trial.hasStripeConnected && !trial.hasSeenAnomaly && age >= 5) return ActivationRisk.HIGH;
    if (trial.hasStripeConnected && trial.hasSeenAnomaly) return ActivationRisk.LOW;
    return ActivationRisk.UNKNOWN;
  }

  return ActivationRisk.UNKNOWN;
}
