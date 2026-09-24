import { prisma } from "@/lib/db";
import { enqueueEmailGenerate, enqueueOutreachSend, enqueueContactFind } from "@/lib/queue";
import { CampaignStatus, EmailStatus, FitProduct } from "@prisma/client";

// Automates the founder's manual motion: fit ≥6 company → find contact →
// enroll into the matching ACTIVE internal campaign. Runs on a worker cron.
//
// Safety properties:
// - respects globalEmergencyStop
// - one contact per company, one campaign per contact — a contact with ANY
//   existing outreach is never enrolled again (no cross-campaign double-sends)
// - enrollment is capped per run; actual send volume is governed downstream
//   by the send budget (warm-up total split across campaigns, send-budget.ts)
// - only internal campaigns (clientId = null) are auto-enrolled

const MAX_ENROLLMENTS_PER_RUN = 20;
const MAX_CONTACT_FINDS_PER_RUN = 25;

// REPOINTED 2026-07-31: Revenue is the single bet to Jan 2027.
//
// BOTH now goes to Revenue. The old rule sent it to Trust on "higher ACV wins
// the first touch", which is sound in a two-product portfolio but not when one
// product is the declared bet and the other is coasting on a backlog.
const CAMPAIGN_PRODUCT_FOR_FIT: Partial<Record<FitProduct, "TRUST" | "REVENUE">> = {
  [FitProduct.TRUST]: "TRUST",
  [FitProduct.REVENUE]: "REVENUE",
  [FitProduct.BOTH]: "REVENUE",
};

// Which product gets first claim on the per-run enrollment budget.
//
// Enrollment was previously ordered by fitScore alone. With 54 enrollable Trust
// companies (best score 9) against 6 for Revenue (best 7), Trust won every one
// of the 20 slots on merit — which is how the pipeline ended up at 21 active
// Trust outreaches against 2 for Revenue while Revenue was the stated bet. No
// one chose that; the sort did.
//
// Revenue-fit companies now sort ahead of Trust ones regardless of score, and
// Trust takes whatever capacity is left. Trust is throttled, not stopped: its
// banked backlog still gets worked, just after Revenue has had its pick. Set
// this to "TRUST" to reverse.
const PRIORITY_PRODUCT: "TRUST" | "REVENUE" = "REVENUE";

export interface AutoEnrollSummary {
  enrolled: number;
  contactFindsQueued: number;
  skippedNoCampaign: number;
}

export async function runAutoEnroll(): Promise<AutoEnrollSummary> {
  const summary: AutoEnrollSummary = { enrolled: 0, contactFindsQueued: 0, skippedNoCampaign: 0 };

  const settings = await prisma.growthSettings.findUnique({ where: { id: "global" } });
  if (settings?.globalEmergencyStop) return summary;

  // Resolve the current target campaign per product once per run.
  const campaignFor: Record<string, string | null> = {};
  for (const product of ["TRUST", "REVENUE"] as const) {
    const campaign = await prisma.campaign.findFirst({
      where: { product, status: CampaignStatus.ACTIVE, clientId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    campaignFor[product] = campaign?.id ?? null;
  }

  const companiesUnsorted = await prisma.company.findMany({
    where: {
      fitScore: { gte: 6 },
      fitProduct: { in: [FitProduct.TRUST, FitProduct.REVENUE, FitProduct.BOTH] },
    },
    orderBy: [{ fitScore: "desc" }, { createdAt: "asc" }],
    include: {
      contacts: {
        where: {
          suppressedAt: null,
          emailStatus: { notIn: [EmailStatus.INVALID, EmailStatus.DISPOSABLE] },
        },
        include: { outreaches: { select: { id: true } } },
      },
    },
  });

  // Stable partition: priority-product companies first, each group still in the
  // fitScore-desc order the query returned. Done in JS rather than SQL because
  // the target product is derived from fitProduct via CAMPAIGN_PRODUCT_FOR_FIT
  // (BOTH maps to a real product), which the database cannot express.
  const companies = [
    ...companiesUnsorted.filter(
      (c) => c.fitProduct && CAMPAIGN_PRODUCT_FOR_FIT[c.fitProduct] === PRIORITY_PRODUCT,
    ),
    ...companiesUnsorted.filter(
      (c) => !c.fitProduct || CAMPAIGN_PRODUCT_FOR_FIT[c.fitProduct] !== PRIORITY_PRODUCT,
    ),
  ];

  for (const company of companies) {
    if (summary.enrolled >= MAX_ENROLLMENTS_PER_RUN) break;

    const product = company.fitProduct ? CAMPAIGN_PRODUCT_FOR_FIT[company.fitProduct] : undefined;
    if (!product) continue;

    if (company.contacts.length === 0) {
      // No usable contact yet — (re)queue the finder. singletonKey in
      // enqueueContactFind dedupes concurrent attempts for the same company.
      if (summary.contactFindsQueued < MAX_CONTACT_FINDS_PER_RUN) {
        await enqueueContactFind({ companyId: company.id });
        summary.contactFindsQueued += 1;
      }
      continue;
    }

    // Decision-makers only — a non-buyer contact (engineer, staff role found
    // incidentally) never auto-enrolls. Observed 2026-07-08: a "Healthcare
    // Professional" contact was auto-enrolled and emailed before this check.
    const contact = company.contacts.find((c) => c.isBuyer && c.outreaches.length === 0);
    if (!contact) continue; // no un-enrolled buyer contact

    const campaignId = campaignFor[product];
    if (!campaignId) {
      summary.skippedNoCampaign += 1;
      continue;
    }

    const outreach = await prisma.outreach.upsert({
      where: { contactId_campaignId: { contactId: contact.id, campaignId } },
      create: {
        contactId: contact.id,
        campaignId,
        companyId: company.id,
        status: "PENDING",
        currentStep: 1,
      },
      update: {},
    });

    await enqueueEmailGenerate({ outreachId: outreach.id });
    await enqueueOutreachSend({ outreachId: outreach.id, stepNumber: 1 });
    summary.enrolled += 1;
  }

  return summary;
}
