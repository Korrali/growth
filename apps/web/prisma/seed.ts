import { PrismaClient, CampaignProduct, CampaignStatus, CtaType, SuppressionReason, SuppressionType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const founderEmail = process.env.FOUNDER_EMAIL ?? "bhagat.ashish.a@gmail.com";

  // GrowthSettings singleton — production seeds with globalEmergencyStop: true
  // so no emails fire until DNS, Resend inbound, sender domain, and a full
  // test-mode campaign run are manually verified. Flip off via /growth/settings.
  await prisma.growthSettings.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      globalEmergencyStop: true,
      defaultDailyLimit: 20,
      defaultPerDomainLimit: 1,
    },
    update: {},
  });
  console.log("✓ GrowthSettings");

  // Founder org + user
  const user = await prisma.user.upsert({
    where: { email: founderEmail },
    create: { email: founderEmail, name: "Ashish Bhagat" },
    update: {},
  });

  let org = await prisma.organization.findFirst({ where: { slug: "korrali-growth" } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "Korrali",
        slug: "korrali-growth",
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
  }
  console.log(`✓ Org: ${org.name} | User: ${user.email}`);

  // Campaign 1: Trust
  const trustCampaign = await prisma.campaign.upsert({
    where: { id: "seed-trust-campaign" },
    create: {
      id: "seed-trust-campaign",
      name: "Enterprise Security Buyers",
      product: CampaignProduct.TRUST,
      status: CampaignStatus.DRAFT,
      testMode: true,
      dailyLimit: 10,
      perDomainLimit: 1,
      maxFollowUps: 3,
    },
    update: {},
  });

  const trustSteps = [
    { step: 1, delay: 0, subject: "Questionnaire workflow at {{companyName}}", cta: CtaType.SOFT_CLOSE },
    { step: 2, delay: 3, subject: "How {{companyName}} answers enterprise security reviews", cta: CtaType.REPLY_QUESTION },
    { step: 3, delay: 7, subject: "Following up — {{companyName}} + Korrali Trust", cta: CtaType.QUICK_CALL },
    { step: 4, delay: 14, subject: "Closing the loop", cta: CtaType.BREAKUP },
  ];

  for (const s of trustSteps) {
    await prisma.sequenceStep.upsert({
      where: { campaignId_stepNumber: { campaignId: trustCampaign.id, stepNumber: s.step } },
      create: {
        campaignId: trustCampaign.id,
        stepNumber: s.step,
        delayDays: s.delay,
        subjectTemplate: s.subject,
        bodyTemplate: `Hi {{firstName}},\n\n[Step ${s.step} body — AI will personalize this for each contact.]\n\nAshish`,
        ctaType: s.cta,
      },
      update: {},
    });
  }
  console.log(`✓ Trust campaign (${trustSteps.length} steps)`);

  // Campaign 2: Revenue
  const revenueCampaign = await prisma.campaign.upsert({
    where: { id: "seed-revenue-campaign" },
    create: {
      id: "seed-revenue-campaign",
      name: "Stripe Founders",
      product: CampaignProduct.REVENUE,
      status: CampaignStatus.DRAFT,
      testMode: true,
      dailyLimit: 10,
      perDomainLimit: 1,
      maxFollowUps: 3,
    },
    update: {},
  });

  const revenueSteps = [
    { step: 1, delay: 0, subject: "Stripe leakage check for {{companyName}}", cta: CtaType.SOFT_CLOSE },
    { step: 2, delay: 3, subject: "A pattern I see on most Stripe accounts", cta: CtaType.REPLY_QUESTION },
    { step: 3, delay: 7, subject: "Quick follow up — {{companyName}} + Korrali Revenue", cta: CtaType.QUICK_CALL },
    { step: 4, delay: 14, subject: "Wrapping up", cta: CtaType.BREAKUP },
  ];

  for (const s of revenueSteps) {
    await prisma.sequenceStep.upsert({
      where: { campaignId_stepNumber: { campaignId: revenueCampaign.id, stepNumber: s.step } },
      create: {
        campaignId: revenueCampaign.id,
        stepNumber: s.step,
        delayDays: s.delay,
        subjectTemplate: s.subject,
        bodyTemplate: `Hi {{firstName}},\n\n[Step ${s.step} body — AI will personalize this for each contact.]\n\nAshish`,
        ctaType: s.cta,
      },
      update: {},
    });
  }
  console.log(`✓ Revenue campaign (${revenueSteps.length} steps)`);

  // Suppression entries
  await prisma.suppression.upsert({
    where: { value: "unsubscribetest@example.com" },
    create: { type: SuppressionType.EMAIL, value: "unsubscribetest@example.com", reason: SuppressionReason.UNSUBSCRIBED },
    update: {},
  });
  await prisma.suppression.upsert({
    where: { value: "competitor.com" },
    create: { type: SuppressionType.DOMAIN, value: "competitor.com", reason: SuppressionReason.COMPETITOR },
    update: {},
  });
  console.log("✓ Suppressions (2 entries)");

  console.log("\n✅ Seed complete.");
  console.log("⚠️  globalEmergencyStop=true — flip off in /growth/settings after DNS + Resend setup.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
