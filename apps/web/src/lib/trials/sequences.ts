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

const BILLCLEAR_SEQUENCE: TrialEmailTemplate[] = [
  {
    subject: "Getting your BillClear pilot started",
    body: `Hi there,

Welcome to BillClear. The fastest way to see value is to run one real medical bill through the audit — yours or a volunteer employee's.

Upload the bill (a phone photo works) and the audit comes back in under a minute: duplicate charges, upcoding, No Surprises Act violations, all itemised in dollars.

Ashish`,
  },
  {
    subject: "What the audit found — reading your first report",
    body: `Hi there,

Once you've run a bill, the report shows each flagged line item with the billing rule it violates and the dollar amount at stake.

The dispute letter is generated from those findings — it cites the specific codes and regulations, which is what makes providers respond.

If your first bill came back clean, that's normal for ~half of bills. Try one from a hospital visit or ER — error rates there are much higher.

Ashish`,
  },
  {
    subject: "Rolling BillClear out to your employees",
    body: `Hi there,

The pilot works best when 5–10 employees run real bills through it in the first two weeks. That's usually enough to surface a few hundred dollars in errors — the number that makes the benefits case internally.

I can set up a short intro note you can forward to your team. Want me to send it over?

Ashish`,
  },
  {
    subject: "Measuring what BillClear saves your plan",
    body: `Hi there,

A few things benefits teams find most useful in the dashboard:

- Total dollars disputed and recovered across your employees
- Certified-mail tracking on every dispute letter sent
- Per-dispute status so nothing silently stalls

If you're self-funded, recovered billing errors flow straight back to your plan spend.

Ashish`,
  },
  {
    subject: "Checking in on your BillClear pilot",
    body: `Hi there,

Quick check-in — have your employees had a chance to run real bills through BillClear yet?

If uptake is the blocker, the fix is usually a one-line mention in your benefits newsletter or Slack. Happy to draft it, or jump on a call about anything else in the way.

Ashish`,
  },
];

const MEDSCAN_SEQUENCE: TrialEmailTemplate[] = [
  {
    subject: "Trying MedScan with your users",
    body: `Hi there,

Thanks for exploring a MedScan partnership. The quickest way to evaluate it: scan any medicine bottle with the app — identification, FDA label data, and interaction checks come back in seconds.

That's the experience your users or patients would get from day one.

Ashish`,
  },
  {
    subject: "Where MedScan fits in your service",
    body: `Hi there,

Partners typically slot MedScan in at the moment of confusion: a caregiver sorting a parent's medications, a patient unsure if two prescriptions clash, a discharge handover with six new bottles.

A recommendation from you at that moment is what drives adoption — and it costs your team nothing to support.

Ashish`,
  },
  {
    subject: "What a MedScan partnership looks like",
    body: `Hi there,

The simplest partnership is a recommendation: MedScan in your resource list, onboarding materials, or app. For deeper integrations (co-branded experience, referral tracking), we can scope what fits your platform.

Worth a short call to figure out which shape makes sense?

Ashish`,
  },
  {
    subject: "Checking in on MedScan",
    body: `Hi there,

Quick check-in — did you get a chance to try the app with a few real medicine bottles?

If anything felt off for your user base (label data depth, interaction coverage, accessibility), that feedback directly shapes what we build next.

Ashish`,
  },
];

const SEQUENCES: Record<CampaignProduct, TrialEmailTemplate[]> = {
  TRUST: TRUST_SEQUENCE,
  REVENUE: REVENUE_SEQUENCE,
  BILLCLEAR: BILLCLEAR_SEQUENCE,
  MEDSCAN: MEDSCAN_SEQUENCE,
};

export function getTrialSequence(product: CampaignProduct): TrialEmailTemplate[] {
  return SEQUENCES[product];
}

// ─── Post-expiry win-back ─────────────────────────────────────────────────────
// Step 0 sends ~1 day after expiry, step 1 ~7 days after. Tone: useful, not
// desperate — the offer to extend does most of the work.

const TRUST_WINBACK: TrialEmailTemplate[] = [
  {
    subject: "Your Korrali trial ended — want another week?",
    body: `Hi there,

Your 14-day Korrali Trust trial just ended. If you were mid-way through a questionnaire or didn't get a real one through the system yet, that's a bad place to stop evaluating.

Reply to this email and I'll extend your trial a week — no card needed.

If you're ready instead, the annual plans now include 2 months free.

Ashish`,
  },
  {
    subject: "Closing the loop on Korrali",
    body: `Hi there,

I'll stop emailing after this one. Before I do: if Korrali Trust didn't fit, I'd genuinely like to know what was missing — questionnaire format, pricing, something else. One line is plenty.

And if the timing was just wrong, your knowledge base is still saved. Reply whenever an enterprise questionnaire lands in your inbox and I'll reactivate you the same day.

Ashish`,
  },
];

const REVENUE_WINBACK: TrialEmailTemplate[] = [
  {
    subject: "Your Revenue trial ended — leaks don't stop, though",
    body: `Hi there,

Your Korrali Revenue trial just ended. Whatever was leaking in your Stripe account before you connected it is still leaking now — failed payments and quiet lapses don't pause because the trial did.

Reply and I'll extend you a week so you can see a full billing cycle of detection.

Ashish`,
  },
  {
    subject: "Closing the loop on Revenue monitoring",
    body: `Hi there,

Last email from me. If the anomalies we flagged during your trial didn't justify the price, that's a fair outcome — but if you simply didn't get time to look, the dashboard snapshot from your trial is still there.

Reply whenever billing health makes it back up your list and I'll reactivate your account.

Ashish`,
  },
];

const BILLCLEAR_WINBACK: TrialEmailTemplate[] = [
  {
    subject: "Your BillClear pilot ended — one more bill?",
    body: `Hi there,

Your BillClear pilot just wrapped. If your employees didn't get many real bills through it, the savings number you saw understates what a full rollout finds.

Reply and I'll extend the pilot two weeks — enough for one more payroll cycle of bills.

Ashish`,
  },
  {
    subject: "Closing the loop on BillClear",
    body: `Hi there,

Last note from me. If BillClear didn't earn a place in your benefits stack, I'd value one line on why — coverage, employee uptake, or the numbers themselves.

If it's a budget-cycle thing, reply when your next benefits planning window opens and we'll pick the pilot back up.

Ashish`,
  },
];

const MEDSCAN_WINBACK: TrialEmailTemplate[] = [
  {
    subject: "Still open to a MedScan partnership?",
    body: `Hi there,

Our partnership conversation went quiet — that's usually timing, not interest. If your users are still photographing pill bottles and Googling drug interactions, the problem hasn't gone anywhere.

Reply and we'll pick it up where we left off.

Ashish`,
  },
  {
    subject: "Closing the loop on MedScan",
    body: `Hi there,

I'll close this thread after today. If a medication-safety integration isn't on your roadmap, no hard feelings — and if it comes back around next planning cycle, you know where to find me.

Ashish`,
  },
];

const WINBACK_SEQUENCES: Record<CampaignProduct, TrialEmailTemplate[]> = {
  TRUST: TRUST_WINBACK,
  REVENUE: REVENUE_WINBACK,
  BILLCLEAR: BILLCLEAR_WINBACK,
  MEDSCAN: MEDSCAN_WINBACK,
};

export function getWinbackSequence(product: CampaignProduct): TrialEmailTemplate[] {
  return WINBACK_SEQUENCES[product];
}

/** Days after expiry at which each win-back step becomes due. */
export const WINBACK_SCHEDULE_DAYS = [1, 7] as const;
