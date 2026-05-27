import { CampaignProduct } from "@prisma/client";

export interface TrialEmailTemplate {
  subject: string;
  body: string;
}

const TRUST_SEQUENCE: TrialEmailTemplate[] = [
  {
    subject: "Quick start: your first knowledge base fact",
    body: `Hi there,

Welcome to Korrali Trust. The fastest way to get value is to add your first knowledge base fact — it takes about 2 minutes.

Head to your Knowledge Base and paste in one fact about your infrastructure or data handling. That's it.

Once you have a few facts in, you can paste any questionnaire and watch the answers generate.

Ashish`,
  },
  {
    subject: "You've added facts — try a questionnaire",
    body: `Hi there,

You've got knowledge base facts in — great start.

The next step is to paste a questionnaire. Even a single question works. Go to Questionnaires, paste a question, and see how the answer is generated from your facts.

If you have a security questionnaire sitting in your inbox right now, that's the perfect test case.

Ashish`,
  },
  {
    subject: "Your trust page is one step away",
    body: `Hi there,

A trust page gives enterprise buyers a public-facing signal that you take security seriously. It takes about 5 minutes to set up from your existing knowledge base.

Head to Trust Page and publish. You can share the link directly from your next enterprise call.

Ashish`,
  },
  {
    subject: "Getting the most out of Korrali Trust",
    body: `Hi there,

A few things Korrali Trust customers find most useful:

- The policy pack generates 6 governance documents from your KB (useful when a buyer asks "do you have an AI policy?")
- Approved answers get stored in your answer library so you don't retype them next time
- The trust page URL is something you can put in your sales deck

Let me know if you hit any friction.

Ashish`,
  },
  {
    subject: "Checking in on your questionnaire workflow",
    body: `Hi there,

Quick check-in — have you had a chance to run a real questionnaire through Korrali yet?

If there's anything blocking you (questionnaire format, specific question types, integration needs), I'd like to know. Happy to jump on a quick call.

Ashish`,
  },
];

const REVENUE_SEQUENCE: TrialEmailTemplate[] = [
  {
    subject: "Connect Stripe to see your first anomalies",
    body: `Hi there,

Welcome to Korrali Revenue Recovery. Connect your Stripe account and we'll start scanning for revenue leaks right away — most accounts have at least one pattern worth looking at.

Takes about 2 minutes: go to Settings > Connect Stripe.

Ashish`,
  },
  {
    subject: "What to look for in your first Stripe scan",
    body: `Hi there,

Once Stripe is connected, here's what we detect:

- Failed payment spikes (more than your baseline)
- Invoice past-due patterns (customers quietly lapsing)
- Duplicate charges (rare but costly)
- Revenue drops vs. prior period

The anomaly feed shows everything. CRITICAL anomalies are worth a same-day look.

Ashish`,
  },
  {
    subject: "Recovery actions: what happens after detection",
    body: `Hi there,

When we find an anomaly, you can take a recovery action directly from the dashboard — retry a payment, send a dunning email, or flag for manual follow-up.

The goal is to close the gap between "detected" and "recovered" to under 24 hours.

Ashish`,
  },
  {
    subject: "Getting your team set up on Revenue Recovery",
    body: `Hi there,

A few things that make Korrali Revenue more useful with more context:

- Set your alert email so anomalies surface to the right person
- Configure per-detector thresholds if your business has seasonal patterns
- The recovery action log shows what's been retried and recovered

Let me know if the anomaly types don't match what you're seeing in Stripe.

Ashish`,
  },
  {
    subject: "Checking in — how's the Stripe monitoring going?",
    body: `Hi there,

Quick check-in on your Revenue Recovery setup. Have you seen any anomalies flagged yet?

If your Stripe volume is relatively low or new, it may take a few days to build a baseline. That's normal.

If there's anything specific you wanted to detect that's not in the product yet, I'd like to hear it.

Ashish`,
  },
];

export function getTrialSequence(product: CampaignProduct): TrialEmailTemplate[] {
  return product === CampaignProduct.TRUST ? TRUST_SEQUENCE : REVENUE_SEQUENCE;
}
