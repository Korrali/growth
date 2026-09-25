// Cold email templates. The founder approved the structure; the AI writes
// only two sentences per prospect (whyLine for step 1, angleLine for step 3,
// see email-generator.ts). Greeting, subject, offer, links, signature and
// capitalisation are fixed here so every email is consistent — free-form AI
// sequences produced lowercase subjects, no greeting, no "who I am", and
// filler the prompt had banned.
//
// Claims here must stay provable: Revenue was reviewed and approved by
// Stripe for the App Marketplace (not "certified" or "endorsed"); Trust helps
// companies PREPARE for SOC 2 / ISO 27001 (only an auditor makes anyone
// compliant — see the positioning doctrine).
//
// Follow-ups (steps 2-4) are sent as replies in the step-1 thread
// ("Re: <step 1 subject>", see sender.ts), so their subjects are not shown.

export type TemplateProduct = "REVENUE" | "TRUST";

export interface TemplateContext {
  firstName: string | null;
  company: string;
  /** Step 1: one sentence tying a verified fact about them to the problem. */
  whyLine: string;
  /** Step 3: one or two sentences on a different, relevant angle. */
  angleLine: string;
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
  return `Best,\nAshish Bhagat\nFounder, ${p.name}\n${p.site}`;
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

I'm Ashish, founder of Korrali Revenue. It's a Stripe app that finds revenue Stripe itself can't flag: customers still on prices you've retired, coupons that never expired, and subscriptions that quietly stopped invoicing. It's listed on the Stripe App Marketplace, where Stripe reviewed and approved it.

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

Who on your team looks after billing in Stripe?

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

  return [
    {
      stepNumber: 1,
      subject: `Security questionnaires at ${co}`,
      body: `${hi}

I'm Ashish, founder of Korrali Trust. It drafts answers to enterprise security questionnaires from your existing security documents: every answer cites its source, gaps are flagged instead of guessed, and it exports back into the buyer's original spreadsheet. It also helps you prepare for SOC 2 and ISO 27001, with a control dashboard mapped to both, a generated policy pack, and a public trust page.

${why}

Your first questionnaire is free, with no card and no time limit. Who handles these at ${co} today?

${sig}`,
    },
    {
      stepNumber: 2,
      subject: `Security questionnaires at ${co}`,
      body: `${hi}

The next time a customer sends ${co} a security questionnaire, you can run it through Korrali Trust. The first one is free:

${p.link}

From the same documents it also builds your policy pack and a public trust page, so buyers can check your security posture before they send a questionnaire at all. You review and approve everything before it goes out. Would that save your team time?

${sig}`,
    },
    {
      stepNumber: 3,
      subject: `Security questionnaires at ${co}`,
      body: `${hi}

${angle}

Korrali Trust drafts those answers from the documents you already have, with the source cited for each:

${p.link}

Is there a security review on your desk right now?

${sig}`,
    },
    {
      stepNumber: 4,
      subject: `Security questionnaires at ${co}`,
      body: `${hi}

I'll leave it here. If security reviews aren't on your plate, who at ${co} handles them?

Your first questionnaire is free whenever one comes in:

${p.link}

${sig}`,
    },
  ];
}

/** Used when the writer is unavailable or its lines fail the checks twice. */
export const FALLBACK_LINES: Record<TemplateProduct, { whyLine: (co: string) => string; angleLine: string }> = {
  REVENUE: {
    whyLine: (co) => `Subscription businesses on Stripe like ${co} tend to collect a few of these as pricing and plans change over time.`,
    angleLine:
      "Stripe retries failed payments on its own, but it can't know which price or coupon you meant a customer to be on, so billing that drifted from what you intended stays invisible.",
  },
  TRUST: {
    whyLine: (co) => `Companies selling to larger customers, like ${co}, usually get a security questionnaire with almost every deal.`,
    angleLine:
      "More and more security reviews now include a section on AI: which models you use, what data they see, and who oversees them.",
  },
};
