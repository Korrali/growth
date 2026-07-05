import { prisma } from "@/lib/db";
import { isEmailSuppressed, isDomainSuppressed, extractDomain } from "@/lib/sending/suppression";
import { EmailStatus, OutreachStatus, CampaignStatus } from "@prisma/client";
import { PRODUCTS, type MarketedProduct } from "@/lib/products";

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

function getEnvInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function todayBucketStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isInSendWindow(
  start: number,
  end: number,
  timezone: string,
): boolean {
  try {
    const now = new Date();
    const hourStr = now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: timezone });
    const hour = parseInt(hourStr, 10);
    return hour >= start && hour < end;
  } catch {
    // If timezone is invalid, fall back to UTC
    const hour = new Date().getUTCHours();
    return hour >= start && hour < end;
  }
}

function isInQuietHours(quietStart: number, quietEnd: number): boolean {
  const hour = new Date().getUTCHours();
  if (quietStart > quietEnd) {
    // Overnight quiet period, e.g. 20–8
    return hour >= quietStart || hour < quietEnd;
  }
  return hour >= quietStart && hour < quietEnd;
}

export async function checkSendEligibility(
  outreachId: string,
  stepNumber: number,
): Promise<EligibilityResult> {
  const ineligible = (reason: string): EligibilityResult => ({ eligible: false, reason });

  // Gate 1: Global emergency stop
  const settings = await prisma.growthSettings.findUnique({ where: { id: "global" } });
  if (settings?.globalEmergencyStop) return ineligible("global_emergency_stop");

  // Load outreach + relations
  const outreach = await prisma.outreach.findUnique({
    where: { id: outreachId },
    include: {
      contact: true,
      campaign: true,
      company: { select: { fitScore: true, domain: true } },
    },
  });

  if (!outreach) return ineligible("outreach_not_found");

  // Gate 1.5: Product must be marked outbound-viable (products.ts). This is
  // the hard, last-line-of-defense check — it fires regardless of how the
  // Outreach row came to exist (campaign misconfiguration, manual import,
  // a future code path). MedScan is outboundViable=false: it's a consumer
  // app not ready for outbound, and until now that flag was never actually
  // read anywhere — purely descriptive, enforced nowhere.
  const productKey = outreach.campaign.product as MarketedProduct;
  if (!PRODUCTS[productKey]?.outboundViable) {
    return ineligible(`product_not_outbound_viable:${productKey}`);
  }

  // Gate 2: Campaign status = ACTIVE
  if (outreach.campaign.status !== CampaignStatus.ACTIVE) {
    return ineligible(`campaign_not_active:${outreach.campaign.status}`);
  }

  const contact = outreach.contact;

  // Gate 3: Contact not suppressed + emailStatus ≠ INVALID or DISPOSABLE.
  // UNVERIFIED is allowed here — sender.ts verifies at send time for step 1
  // and updates emailStatus, so subsequent steps see the real result.
  if (contact.suppressedAt) return ineligible("contact_suppressed");
  if (contact.emailStatus === EmailStatus.INVALID) return ineligible("email_invalid");
  if (contact.emailStatus === EmailStatus.DISPOSABLE) return ineligible("email_disposable");

  // Gate 4: Suppression table checks
  if (await isEmailSuppressed(contact.email)) return ineligible("email_in_suppression_list");
  const domain = extractDomain(contact.email);
  if (domain && await isDomainSuppressed(domain)) return ineligible("domain_suppressed");

  // Gate 5: Outreach status
  if (outreach.status !== OutreachStatus.ACTIVE && outreach.status !== OutreachStatus.PENDING) {
    return ineligible(`outreach_not_active:${outreach.status}`);
  }

  // Gate 6: No double-send — check if EmailMessage already exists for this step
  const existingMessage = await prisma.emailMessage.findFirst({
    where: { outreachId, stepNumber, direction: "OUTBOUND" },
  });
  if (existingMessage) return ineligible("already_sent_this_step");

  // Gate 7: Daily send limit
  const dailyLimit = outreach.campaign.dailyLimit ?? getEnvInt("MAX_SENDS_PER_DAY", 20);
  const todaySends = await prisma.emailMessage.count({
    where: { direction: "OUTBOUND", sentAt: { gte: todayBucketStart() } },
  });
  if (todaySends >= dailyLimit) return ineligible(`daily_limit_reached:${todaySends}/${dailyLimit}`);

  // Gate 8: Per-domain daily limit
  const perDomainLimit = outreach.campaign.perDomainLimit ?? getEnvInt("MAX_SENDS_PER_DOMAIN_PER_DAY", 1);
  if (domain) {
    const domainContacts = await prisma.contact.findMany({
      where: { email: { endsWith: `@${domain}` } },
      select: { id: true },
    });
    const domainContactIds = domainContacts.map((c) => c.id);
    const domainSendsToday = await prisma.emailMessage.count({
      where: {
        direction: "OUTBOUND",
        sentAt: { gte: todayBucketStart() },
        contactId: { in: domainContactIds },
      },
    });
    if (domainSendsToday >= perDomainLimit) {
      return ineligible(`per_domain_limit_reached:${domain}:${domainSendsToday}/${perDomainLimit}`);
    }
  }

  // Gate 9: Max follow-ups not exceeded
  const sentSteps = await prisma.emailMessage.count({
    where: { outreachId, direction: "OUTBOUND" },
  });
  if (sentSteps > outreach.campaign.maxFollowUps) {
    return ineligible(`max_followups_exceeded:${sentSteps}`);
  }

  // Gate 10: Inside sending window (timezone-aware)
  const sendStart = outreach.campaign.sendWindowStart;
  const sendEnd = outreach.campaign.sendWindowEnd;
  const tz = outreach.campaign.timezone ?? process.env.SEND_TIMEZONE ?? "America/New_York";
  if (!isInSendWindow(sendStart, sendEnd, tz)) {
    return ineligible(`outside_send_window:${sendStart}-${sendEnd}_${tz}`);
  }

  // Gate 11: Quiet hours
  const quietStart = getEnvInt("QUIET_HOURS_START", 20);
  const quietEnd = getEnvInt("QUIET_HOURS_END", 8);
  if (isInQuietHours(quietStart, quietEnd)) {
    return ineligible(`quiet_hours:${quietStart}-${quietEnd}`);
  }

  // Gate 12: Company fitScore ≥ 6
  const fitScore = outreach.company?.fitScore ?? 0;
  if (fitScore < 6) return ineligible(`fit_score_too_low:${fitScore}`);

  // Gate 13: Latest EmailGenerationRun qualityGates not blocked
  const latestRun = await prisma.emailGenerationRun.findFirst({
    where: { outreachId },
    orderBy: { createdAt: "desc" },
    select: { qualityGates: true },
  });
  if (latestRun?.qualityGates) {
    const gates = latestRun.qualityGates as Record<string, { passed: boolean }>;
    const stepGate = gates[String(stepNumber)];
    if (stepGate && !stepGate.passed) {
      return ineligible(`quality_gate_blocked:step${stepNumber}`);
    }
  }

  return { eligible: true };
}
