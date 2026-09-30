// Cold email templates. The founder approved the structure; the AI writes
// only two sentences per prospect (whyLine for step 1, angleLine for step 3,
// see email-generator.ts). Greeting, subject, offer, links, signature and
// capitalisation are fixed here so every email is consistent — free-form AI
// sequences produced lowercase subjects, no greeting, no "who I am", and
// filler the prompt had banned.
//
// Claims here must stay provable: Revenue was tested by Stripe's app review
// team (a Stripe QA engineer, versions 0.1.0–0.1.2) and approved for the App
// Marketplace — never "certified" or "endorsed" by Stripe, which Marketplace
// rules don't allow apps to imply; Trust helps
// companies PREPARE for SOC 2 / ISO 27001 / ISO 42001 (only an auditor makes
// anyone compliant — see the positioning doctrine), and nothing in Trust is
// free (card-required 14-day trial).
//
// Follow-ups (steps 2-4) are sent as replies in the step-1 thread
// ("Re: <step 1 subject>", see sender.ts), so their subjects are not shown.

export type TemplateProduct = "REVENUE" | "TRUST";

// When each product's template text last changed. BUMP THE PRODUCT'S DATE
// WITH EVERY EDIT TO ITS TEMPLATE, and never to a time in the future: a draft
// written after the deploy but before the date counts as stale, and every
// stale draft costs a send attempt (sender.ts stops an outreach after three).
// Drafts are stored per prospect, so a draft written before a change keeps
// the old text; on 2026-09-25 18 prospects got the pre-template format from
// drafts written the night before. The sender rewrites any draft older than
// its product's date before sending it (sender.ts).
export const TEMPLATE_REVISED_AT: Record<TemplateProduct, Date> = {
  REVENUE: new Date("2026-09-25T07:12:00Z"),
  // Trust relaunch copy deployed ~18:25Z; every older Trust draft was deleted
  // and the new ones were written from 18:29:15Z.
  TRUST: new Date("2026-09-27T18:29:00Z"),
};

// Trust was relaunched as an AI-native compliance platform. Anyone sent a
// Trust email before this got the old questionnaire-tool pitch (with a free
// first questionnaire that no longer exists), so their email 1 re-introduces
// the product instead of introducing it (email-generator.ts).
export const TRUST_RELAUNCH_AT = TEMPLATE_REVISED_AT.TRUST;

// Same rule for the FIRM templates (buildFirmSequence), dated separately so
// an edit to one audience's copy doesn't rewrite the other's drafts.
export const FIRM_TEMPLATE_REVISED_AT: Record<TemplateProduct, Date> = {
  REVENUE: new Date("2026-09-30T12:50:00Z"),
  TRUST: new Date("2026-09-30T12:50:00Z"),
};

export type TemplateAudience = "DIRECT" | "FIRM";

export function isStaleDraft(
  product: TemplateProduct,
  draftUpdatedAt: Date,
  audience: TemplateAudience = "DIRECT",
): boolean {
  const revised = audience === "FIRM" ? FIRM_TEMPLATE_REVISED_AT : TEMPLATE_REVISED_AT;
  return draftUpdatedAt < revised[product];
}

export interface TemplateContext {
  firstName: string | null;
  company: string;
  /** Step 1: one sentence tying a verified fact about them to the problem. */
  whyLine: string;
  /** Step 3: one or two sentences on a different, relevant angle. */
  angleLine: string;
  /** Trust: they got an earlier Trust email, so email 1 re-introduces instead of introducing. */
  previouslyContacted?: boolean;
}

export interface TemplateStep {
  stepNumber: number;
  subject: string;
  body: string;
}

const PRODUCT = {
  REVENUE: {
    name: "Korrali Revenue",
    site: "revenue.korrali.com",
    link: "https://marketplace.stripe.com/apps/korrali-revenue-recovery",
  },
  TRUST: {
    name: "Korrali Trust",
    site: "trust.korrali.com",
    link: "https://trust.korrali.com",
  },
} as const;

function signature(product: TemplateProduct): string {
  const p = PRODUCT[product];
  return `Best,\nAshish Bhagat\nFounder, ${p.name}\nKorrali LLC, a US company\n${p.site}`;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name.charAt(0).toUpperCase()}${name.slice(1)},` : "Hi there,";
}

/** Keep the AI's sentence a sentence: trimmed, capitalised, ending in punctuation. */
export function tidySentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

export function buildSequence(product: TemplateProduct, ctx: TemplateContext): TemplateStep[] {
  const p = PRODUCT[product];
  const hi = greeting(ctx.firstName);
  const sig = signature(product);
  const why = tidySentence(ctx.whyLine);
  const angle = tidySentence(ctx.angleLine);
  const co = ctx.company;

  if (product === "REVENUE") {
    return [
      {
        stepNumber: 1,
        subject: `Stripe billing leaks at ${co}`,
        body: `${hi}

I'm Ashish, founder of Korrali Revenue. It's a Stripe app that finds revenue Stripe itself can't flag: customers still on prices you've retired, coupons that never expired, and subscriptions that quietly stopped invoicing. It's listed on the Stripe App Marketplace, and Stripe's app review team tested it over several review rounds before approving it.

${why}

It's free to install and detection stays free. If it finds nothing, uninstall. Would it be worth a look?

${sig}`,
      },
      {
        stepNumber: 2,
        subject: `Stripe billing leaks at ${co}`,
        body: `${hi}

In case it's easier to just look, here's the free install from the Stripe App Marketplace:

${p.link}

On security: it connects through Stripe's own app permissions, your Stripe access token is encrypted at rest, and we never see card numbers because Stripe never shares them. Recovery only runs when you turn it on, and you can disconnect at any time.

Every finding shows the customer and the amount, so you can check it in your own Stripe dashboard. Would that be useful for ${co}?

${sig}`,
      },
      {
        stepNumber: 3,
        subject: `Stripe billing leaks at ${co}`,
        body: `${hi}

${angle}

Korrali Revenue flags these automatically, and detection is free with no card:

${p.link}

If you'd rather not dig through it yourself, install it and reply here: I'll email you a one-page report of what's leaking at ${co}, with the fix for each, within two days.

${sig}`,
      },
      {
        stepNumber: 4,
        subject: `Stripe billing leaks at ${co}`,
        body: `${hi}

I'll leave it here. If Stripe billing isn't on your plate, who at ${co} would be the right person?

The free install is here if it's ever useful:

${p.link}

${sig}`,
      },
    ];
  }

  // Trust: an AI-native compliance platform since the 2026-09 relaunch. Every
  // claim below is backed by code on trust.korrali.com — AI evidence review
  // (lib/ai/evidence-reviewer.ts), answers citing live evidence
  // (lib/ai/evidence-context.ts), the AI inventory + ISO 42001, the read-only
  // MCP server (lib/mcp) — and the published price and card-required trial
  // (lib/pricing.ts, actions/checkout.ts). Nothing is free: never promise a
  // free questionnaire or "no card". Workflow language only: it helps you
  // prepare; only an auditor issues a report.
  const trustSubject = `SOC 2 and security reviews at ${co}`;
  const opener = ctx.previouslyContacted
    ? `I wrote to you a while back about Korrali Trust. It has changed a lot since: it's now an AI-native compliance platform for SOC 2, ISO 27001 and ISO 42001.`
    : `I'm Ashish, founder of Korrali Trust, an AI-native compliance platform for SOC 2, ISO 27001 and ISO 42001.`;
  return [
    {
      stepNumber: 1,
      subject: trustSubject,
      body: `${hi}

${opener} It connects read-only to your cloud, code and identity tools, and AI reviews each control's evidence the way an auditor would. The same live evidence answers your security questionnaires, with the source cited for every answer. An AI inventory covers the AI questions buyers now ask, and your own agents can read all of it through a read-only MCP server.

${why}

It's $3,000 a year for up to 50 people, everything included, with a 14-day trial. Worth a look for ${co}?

${sig}`,
    },
    {
      stepNumber: 2,
      subject: trustSubject,
      body: `${hi}

In case it's easier to just look:

${p.link}

What the AI does, concretely:
- Reads each control's evidence like an auditor: whether it's enough, what's missing, and on which system. Your team approves every verdict.
- Answers security questionnaires from your approved facts and what the connectors observed, like "MFA is enforced for every AWS user, checked 2 hours ago". Anything it can't support is flagged instead of guessed, and answers export into the buyer's own spreadsheet.
- Keeps an AI inventory (models, data, human oversight) for ISO 42001 and the AI section of security reviews.

It connects read-only to AWS, Google Cloud, Azure, GitHub, GitLab, Google Workspace, Okta, Microsoft 365, Jira, Slack and more, and re-checks them every hour. Would that save ${co} time?

${sig}`,
    },
    {
      stepNumber: 3,
      subject: trustSubject,
      body: `${hi}

${angle}

Korrali Trust keeps that evidence current and answers from it, citing the source for each answer:

${p.link}

Or, if a security questionnaire is on your desk right now, reply with it attached and I'll send it back completed within two days.

${sig}`,
    },
    {
      stepNumber: 4,
      subject: trustSubject,
      body: `${hi}

I'll leave it here. If compliance and security reviews aren't on your plate, who at ${co} handles them?

The 14-day trial is here whenever it's useful:

${p.link}

${sig}`,
    },
  ];
}

// FIRM campaigns write to service firms that run the problem for many clients
// (fractional CFOs and bookkeepers for Revenue, vCISOs and compliance
// consultancies for Trust). The ask is a conversation about how they handle it
// today, not a sign-up: no price and no install link, because a firm that
// first sees a single-company price anchors on it (firm-channel strategy).
// The free offer in step 2 needs the client's sign-off — the firm having
// access does not authorise us to touch its client's data.
export function buildFirmSequence(product: TemplateProduct, ctx: TemplateContext): TemplateStep[] {
  const hi = greeting(ctx.firstName);
  const sig = signature(product);
  const why = tidySentence(ctx.whyLine);
  const angle = tidySentence(ctx.angleLine);
  const co = ctx.company;
  const leave = `${hi}

I'll leave it here. If this isn't something ${co} looks after, no problem, and thanks for reading.

If it ever is, a reply to this email reaches me directly.

${sig}`;

  if (product === "REVENUE") {
    const subject = `Stripe billing checks for ${co}'s clients`;
    return [
      {
        stepNumber: 1,
        subject,
        body: `${hi}

I'm Ashish, founder of Korrali Revenue, an app on the Stripe App Marketplace that flags billing that has drifted from what a business intended: customers still on prices it retired, coupons that never expired, subscriptions that quietly stopped invoicing, and failed payments nobody followed up.

${why}

I'm speaking with fractional CFOs and finance firms about how they check client billing in Stripe today, before deciding what to build for firms. Would you be open to a 20-minute call? I want to learn how you handle it, not sell you anything.

${sig}`,
      },
      {
        stepNumber: 2,
        subject,
        body: `${hi}

To make a call worth your time: pick one client that bills through Stripe and, with their sign-off, I'll run Korrali Revenue on that account and walk you through what it flags. It's free, and you keep the findings.

Every finding shows the customer and the amount, so you can check it in the client's own Stripe dashboard. A retired price or a long-running coupon can be an agreed deal term, so nothing counts as lost revenue until you or the client confirm it.

Would that be useful for one of ${co}'s clients?

${sig}`,
      },
      {
        stepNumber: 3,
        subject,
        body: `${hi}

${angle}

How does ${co} check for this across clients today, if at all? Even a two-line reply would help me.

${sig}`,
      },
      { stepNumber: 4, subject, body: leave },
    ];
  }

  const subject = `Security questionnaires for ${co}'s clients`;
  return [
    {
      stepNumber: 1,
      subject,
      body: `${hi}

I'm Ashish, founder of Korrali Trust, an AI-native compliance platform for SOC 2, ISO 27001 and ISO 42001. It keeps each control's evidence current through read-only connections to cloud, code and identity tools, and answers security questionnaires from that evidence, citing the source for every answer.

${why}

I'm speaking with vCISOs and compliance consultants about how they handle client questionnaires and audit evidence today, before deciding what to build for firms. Would you be open to a 20-minute call? I want to learn how you handle it, not sell you anything.

${sig}`,
    },
    {
      stepNumber: 2,
      subject,
      body: `${hi}

To make a call worth your time: send me one security questionnaire a client of yours is working on, with their sign-off, and I'll send back draft answers within two days, with every answer the client needs to confirm clearly flagged. It's free.

Would that help with one of ${co}'s clients?

${sig}`,
    },
    {
      stepNumber: 3,
      subject,
      body: `${hi}

${angle}

How does ${co} handle this across clients today? Even a two-line reply would help me.

${sig}`,
    },
    { stepNumber: 4, subject, body: leave },
  ];
}

/** "Thryve Group LLC" → "Thryve Group": legal suffixes read badly in "…'s clients". */
export function shortFirmName(name: string): string {
  return name
    .replace(/,?\s+(LLC|L\.L\.C\.|PLLC|LLP|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.|Ltd\.?|P\.?A\.|P\.?C\.)$/i, "")
    .trim() || name;
}

/** Used when the writer is unavailable or its lines fail the checks twice (FIRM campaigns). */
export const FIRM_FALLBACK_LINES: Record<TemplateProduct, { whyLine: (co: string) => string; angleLine: string }> = {
  REVENUE: {
    whyLine: (co) => `Firms like ${co} that run finance for subscription clients are often the first to see billing that no longer matches what was sold.`,
    angleLine:
      "A client can keep billing customers on a price it retired, or on a discount that outlived the deal, and Stripe has no way to know that wasn't intended.",
  },
  TRUST: {
    whyLine: (co) => `Firms like ${co} that look after security and compliance for several clients tend to answer the same questionnaire questions again for each one.`,
    angleLine:
      "More security reviews now include a section on AI: which models a company uses, what data they see, and who oversees them.",
  },
};

/** Used when the writer is unavailable or its lines fail the checks twice. */
export const FALLBACK_LINES: Record<TemplateProduct, { whyLine: (co: string) => string; angleLine: string }> = {
  REVENUE: {
    whyLine: (co) => `Subscription businesses on Stripe like ${co} tend to collect a few of these as pricing and plans change over time.`,
    angleLine:
      "Stripe retries failed payments on its own, but it can't know which price or coupon you meant a customer to be on, so billing that drifted from what you intended stays invisible.",
  },
  TRUST: {
    whyLine: (co) => `Companies selling to larger customers, like ${co}, are usually asked for a SOC 2 report or a security questionnaire before a deal closes.`,
    angleLine:
      "More and more security reviews now include a section on AI: which models you use, what data they see, and who oversees them.",
  },
};
