import { CampaignProduct } from "@prisma/client";

export interface TrialEmailTemplate {
  subject: string;
  body: string;
}

// Trust is an AI-native compliance platform (SOC 2, ISO 27001, ISO 42001) with
// a card-required 14-day trial. The trial emails walk the real first-week path:
// connect a system, fix what fails, adopt policies, then questionnaires.
const TRUST_SEQUENCE: TrialEmailTemplate[] = [
  {
    subject: "Quick start: connect your first system",
    body: `Hi there,

Welcome to Korrali Trust. The fastest way to see where you stand is to connect one system — AWS, Google Cloud, Azure, GitHub or Google Workspace are the usual first picks. It's read-only and takes a few minutes.

Go to Integrations, pick one, and follow the steps on the page. The first checks run as soon as it's connected.

The Korrali Team`,
  },
  {
    subject: "What failed, and how to fix it",
    body: `Hi there,

Every check that failed is now a task with the console steps to fix it. Fix it once and the task closes itself on the next hourly sync; if the setting regresses, it reopens.

On each control, the AI evidence review reads the evidence the way an auditor would and lists what's missing. Your team accepts or dismisses each review, so nothing changes without you.

The Korrali Team`,
  },
  {
    subject: "Your policies, in an afternoon",
    body: `Hi there,

Auditors ask for policies first. Trust has 16 policy templates: adopt the ones you need, edit them, approve and publish, and send them to your people to accept.

If you build with AI, add your AI systems to the AI inventory too. It covers ISO 42001 and the AI section of security reviews.

The Korrali Team`,
  },
  {
    subject: "Your next security questionnaire",
    body: `Hi there,

When a buyer sends a security questionnaire, upload it to Questionnaires. Answers are drafted from your approved facts and what the connectors observed, each with its source; anything it can't support is flagged instead of guessed. You review and approve, then export into the buyer's own spreadsheet.

The same facts power a public trust page you can share before a questionnaire is sent at all.

The Korrali Team`,
  },
  {
    subject: "Checking in on your setup",
    body: `Hi there,

Quick check-in: how far did you get with connecting systems and fixing the first tasks?

If something is blocking you (a connector, a control you're unsure about, an audit date coming up), reply and tell me. Happy to jump on a quick call.

The Korrali Team`,
  },
];

const REVENUE_SEQUENCE: TrialEmailTemplate[] = [
  {
    subject: "Connect Stripe to see your first anomalies",
    body: `Hi there,

Welcome to Korrali Revenue Recovery. Connect your Stripe account and we'll start scanning for revenue leaks right away — most accounts have at least one pattern worth looking at.

Takes about 2 minutes: go to Settings > Connect Stripe.

The Korrali Team`,
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

The Korrali Team`,
  },
  {
    subject: "Recovery actions: what happens after detection",
    body: `Hi there,

When we find an anomaly, you can take a recovery action directly from the dashboard — retry a payment, send a dunning email, or flag for manual follow-up.

The goal is to close the gap between "detected" and "recovered" to under 24 hours.

The Korrali Team`,
  },
  {
    subject: "Getting your team set up on Revenue Recovery",
    body: `Hi there,

A few things that make Korrali Revenue more useful with more context:

- Set your alert email so anomalies surface to the right person
- Configure per-detector thresholds if your business has seasonal patterns
- The recovery action log shows what's been retried and recovered

Let me know if the anomaly types don't match what you're seeing in Stripe.

The Korrali Team`,
  },
  {
    subject: "Checking in — how's the Stripe monitoring going?",
    body: `Hi there,

Quick check-in on your Revenue Recovery setup. Have you seen any anomalies flagged yet?

If your Stripe volume is relatively low or new, it may take a few days to build a baseline. That's normal.

If there's anything specific you wanted to detect that's not in the product yet, I'd like to hear it.

The Korrali Team`,
  },
];

const BILLCLEAR_SEQUENCE: TrialEmailTemplate[] = [
  {
    subject: "Getting your BillClear pilot started",
    body: `Hi there,

Welcome to BillClear. The fastest way to see value is to run one real medical bill through the audit — yours or a volunteer employee's.

Upload the bill (a phone photo works) and the audit comes back in under a minute: duplicate charges, upcoding, No Surprises Act violations, all itemised in dollars.

The BillClear Team`,
  },
  {
    subject: "What the audit found — reading your first report",
    body: `Hi there,

Once you've run a bill, the report shows each flagged line item with the billing rule it violates and the dollar amount at stake.

The dispute letter is generated from those findings — it cites the specific codes and regulations, which is what makes providers respond.

If your first bill came back clean, that's normal for ~half of bills. Try one from a hospital visit or ER — error rates there are much higher.

The BillClear Team`,
  },
  {
    subject: "Rolling BillClear out to your employees",
    body: `Hi there,

The pilot works best when 5–10 employees run real bills through it in the first two weeks. That's usually enough to surface a few hundred dollars in errors — the number that makes the benefits case internally.

I can set up a short intro note you can forward to your team. Want me to send it over?

The BillClear Team`,
  },
  {
    subject: "Measuring what BillClear saves your plan",
    body: `Hi there,

A few things benefits teams find most useful in the dashboard:

- Total dollars disputed and recovered across your employees
- Certified-mail tracking on every dispute letter sent
- Per-dispute status so nothing silently stalls

If you're self-funded, recovered billing errors flow straight back to your plan spend.

The BillClear Team`,
  },
  {
    subject: "Checking in on your BillClear pilot",
    body: `Hi there,

Quick check-in — have your employees had a chance to run real bills through BillClear yet?

If uptake is the blocker, the fix is usually a one-line mention in your benefits newsletter or Slack. Happy to draft it, or jump on a call about anything else in the way.

The BillClear Team`,
  },
];

const MEDSCAN_SEQUENCE: TrialEmailTemplate[] = [
  {
    subject: "Trying MedScan with your users",
    body: `Hi there,

Thanks for exploring a MedScan partnership. The quickest way to evaluate it: scan any medicine bottle with the app — identification, FDA label data, and interaction checks come back in seconds.

That's the experience your users or patients would get from day one.

The MedScan Team`,
  },
  {
    subject: "Where MedScan fits in your service",
    body: `Hi there,

Partners typically slot MedScan in at the moment of confusion: a caregiver sorting a parent's medications, a patient unsure if two prescriptions clash, a discharge handover with six new bottles.

A recommendation from you at that moment is what drives adoption — and it costs your team nothing to support.

The MedScan Team`,
  },
  {
    subject: "What a MedScan partnership looks like",
    body: `Hi there,

The simplest partnership is a recommendation: MedScan in your resource list, onboarding materials, or app. For deeper integrations (co-branded experience, referral tracking), we can scope what fits your platform.

Worth a short call to figure out which shape makes sense?

The MedScan Team`,
  },
  {
    subject: "Checking in on MedScan",
    body: `Hi there,

Quick check-in — did you get a chance to try the app with a few real medicine bottles?

If anything felt off for your user base (label data depth, interaction coverage, accessibility), that feedback directly shapes what we build next.

The MedScan Team`,
  },
];

const SEQUENCES: Record<CampaignProduct, TrialEmailTemplate[]> = {
  TRUST: TRUST_SEQUENCE,
  REVENUE: REVENUE_SEQUENCE,
  BILLCLEAR: BILLCLEAR_SEQUENCE,
  MEDSCAN: MEDSCAN_SEQUENCE,
  // Data/Web are pay-per-use, not trial-based — no nurture sequence yet.
  DATA: [],
  WEB: [],
  GROWTH_SERVICE: [],
};

export function getTrialSequence(product: CampaignProduct): TrialEmailTemplate[] {
  return SEQUENCES[product];
}

// ─── Post-expiry win-back ─────────────────────────────────────────────────────
// Step 0 sends ~1 day after expiry, step 1 ~7 days after. Tone: useful, not
// desperate — the offer to extend does most of the work.

const TRUST_WINBACK: TrialEmailTemplate[] = [
  {
    subject: "Your Korrali Trust workspace is still here",
    body: `Hi there,

Your Korrali Trust subscription ended. Your workspace is saved — connected systems, evidence history, policies and answers — so if you come back, you pick up where you left off.

If you stopped because something didn't work or didn't fit, reply and tell me. One line is plenty.

The Korrali Team`,
  },
  {
    subject: "Closing the loop on Korrali",
    body: `Hi there,

I'll stop emailing after this one. Before I do: if Korrali Trust didn't fit, I'd genuinely like to know what was missing — a connector, a framework, pricing, something else.

And if the timing was just wrong, your workspace is still saved. Reply whenever an audit or a security review comes up.

The Korrali Team`,
  },
];

const REVENUE_WINBACK: TrialEmailTemplate[] = [
  {
    subject: "Your Revenue trial ended — leaks don't stop, though",
    body: `Hi there,

Your Korrali Revenue trial just ended. Whatever was leaking in your Stripe account before you connected it is still leaking now — failed payments and quiet lapses don't pause because the trial did.

Reply and I'll extend you a week so you can see a full billing cycle of detection.

The Korrali Team`,
  },
  {
    subject: "Closing the loop on Revenue monitoring",
    body: `Hi there,

Last email from me. If the anomalies we flagged during your trial didn't justify the price, that's a fair outcome — but if you simply didn't get time to look, the dashboard snapshot from your trial is still there.

Reply whenever billing health makes it back up your list and I'll reactivate your account.

The Korrali Team`,
  },
];

const BILLCLEAR_WINBACK: TrialEmailTemplate[] = [
  {
    subject: "Your BillClear pilot ended — one more bill?",
    body: `Hi there,

Your BillClear pilot just wrapped. If your employees didn't get many real bills through it, the savings number you saw understates what a full rollout finds.

Reply and I'll extend the pilot two weeks — enough for one more payroll cycle of bills.

The BillClear Team`,
  },
  {
    subject: "Closing the loop on BillClear",
    body: `Hi there,

Last note from me. If BillClear didn't earn a place in your benefits stack, I'd value one line on why — coverage, employee uptake, or the numbers themselves.

If it's a budget-cycle thing, reply when your next benefits planning window opens and we'll pick the pilot back up.

The BillClear Team`,
  },
];

const MEDSCAN_WINBACK: TrialEmailTemplate[] = [
  {
    subject: "Still open to a MedScan partnership?",
    body: `Hi there,

Our partnership conversation went quiet — that's usually timing, not interest. If your users are still photographing pill bottles and Googling drug interactions, the problem hasn't gone anywhere.

Reply and we'll pick it up where we left off.

The MedScan Team`,
  },
  {
    subject: "Closing the loop on MedScan",
    body: `Hi there,

I'll close this thread after today. If a medication-safety integration isn't on your roadmap, no hard feelings — and if it comes back around next planning cycle, you know where to find me.

The MedScan Team`,
  },
];

const WINBACK_SEQUENCES: Record<CampaignProduct, TrialEmailTemplate[]> = {
  TRUST: TRUST_WINBACK,
  REVENUE: REVENUE_WINBACK,
  BILLCLEAR: BILLCLEAR_WINBACK,
  MEDSCAN: MEDSCAN_WINBACK,
  // Data/Web are pay-per-use, not trial-based — no win-back sequence yet.
  DATA: [],
  WEB: [],
  GROWTH_SERVICE: [],
};

export function getWinbackSequence(product: CampaignProduct): TrialEmailTemplate[] {
  return WINBACK_SEQUENCES[product];
}

/** Days after expiry at which each win-back step becomes due. */
export const WINBACK_SCHEDULE_DAYS = [1, 7] as const;
