# Q3 2026 Outbound Campaigns — load into /growth/campaigns/new

Two internal campaigns (no client, founder inbox). Values below map 1:1 to the campaign form + sequence step fields. **Do not activate until DELIVERABILITY_RUNBOOK.md steps A–D are done and the warming domain shows <3% bounce.** Launch both in `testMode: true` for the first 20 contacts, read every generated draft, then flip live.

---

## Campaign 1: TRUST — "AI questions are coming for your deals"

**Settings**
- name: `Trust — AI Act wave Q3`
- product: `TRUST`
- dailyLimit: `10` (warming; raise per runbook schedule)
- perDomainLimit: `1` · sendWindow: `8–18` · timezone: `America/New_York`
- maxFollowUps: `3` · testMode: `true` · client: none
- fromName: `Ashish from Korrali` · fromEmail: `ashish@getkorrali.com` (the verified cold-outbound domain — NOT the root korrali.com address; `outreach.korrali.com` was shelved, see DELIVERABILITY_RUNBOOK.md)

**customIcpProfile** (paste verbatim):
```
AI-native B2B SaaS companies, seed to Series B, 5–100 employees, selling into
mid-market or enterprise buyers. They ship AI features (LLM-powered product,
AI agents, ML models) and their deals increasingly hit security reviews and
vendor questionnaires that now include AI-specific sections: model inventory,
training data provenance, EU AI Act risk classification, AI incident response.
Buyer persona: founder, CTO, or first security hire. They feel the pain as
BLOCKED DEALS and lost weeks, not as abstract compliance. Do not pitch
certification or legal compliance — Korrali Trust is a workflow tool that
drafts questionnaire answers from their own knowledge base and runs an AI
readiness self-assessment. Language must stay operational ("answer in minutes",
"unblock the review") and never claim to make anyone compliant.
Disqualify: companies with no AI in product, pure consumer apps, agencies.
```

**Sequence steps**

| # | delayDays | ctaType | subjectTemplate (hint) |
|---|---|---|---|
| 1 | 0 | REPLY_QUESTION | `AI section in your last security review?` |
| 2 | 4 | REPLY_QUESTION | `the AI questions enterprise buyers now ask` |
| 3 | 10 | QUICK_CALL | `20 min — your AI Act exposure, mapped` |
| 4 | 18 | BREAKUP | `closing the loop` |

**North-star examples** (what a good AI draft looks like — judge generated copy against these):

*Step 1 (day 0):*
> Subject: AI section in your last security review?
>
> Hi {{firstName}} — saw {{companyName}} ships [specific AI feature from research]. Quick question: has an enterprise prospect's security review hit you with AI-specific questions yet (model inventory, training data, EU AI Act tier)?
>
> Since enforcement started August 2, those sections are showing up in most vendor reviews we see. We built a free 2-minute self-check that maps where you'd get stuck: [AI Act readiness checker link]
>
> Worth a look before the next questionnaire lands?
> — Ashish

*Step 2 (day 4):* short, pure value — "We pulled the AI questions from recent enterprise questionnaires. The 5 that stall deals most: …" (list 5, one line each). CTA: "Want the full list? Reply 'list'."

*Step 3 (day 10):* "If a questionnaire with an AI section is sitting in your inbox, I'll walk you through exactly how to clear it in 20 minutes — here's my calendar: [link]. If not, keep the checker for when one lands."

*Step 4 (day 18):* "Closing the loop — I'll leave you with the free checker [link] and get out of your inbox. If an enterprise deal ever stalls on a security review, you know where I am."

**Note:** step-1 phrasing says "since enforcement started August 2" — correct after 2026-08-02. Before that date use "enforcement starts August 2."

---

## Campaign 2: REVENUE — "the number you haven't looked at"

**Settings**
- name: `Revenue — leak audit Q3`
- product: `REVENUE`
- dailyLimit: `10` · perDomainLimit: `1` · sendWindow: `8–18` · timezone: `America/New_York`
- maxFollowUps: `3` · testMode: `true` · client: none
- fromName / fromEmail: same as Campaign 1

**customIcpProfile** (paste verbatim):
```
B2B or prosumer subscription SaaS at roughly $5K–$100K MRR, billing on Stripe,
team of 1–20. Persona: founder or the one person who owns billing. Their pain:
5–9% of revenue silently lost to failed payments, expired cards, and billing
leaks — they know it exists but have never seen THEIR number. The offer is a
free read-only leak audit: connect Stripe, see the dollar figure in minutes,
keep the report. Paid product is performance-priced: 10% of what Korrali
Revenue actually recovers, capped, $0 base — if nothing is recovered, they pay
nothing. Tone: founder-to-founder, concrete dollars, zero enterprise-speak.
Never ask for a call in steps 1–2; the audit IS the call to action.
Disqualify: non-subscription businesses, non-Stripe billing, pre-revenue.
```

**Sequence steps**

| # | delayDays | ctaType | subjectTemplate (hint) |
|---|---|---|---|
| 1 | 0 | REPLY_QUESTION | `{{companyName}}'s failed-payment number` |
| 2 | 4 | REPLY_QUESTION | `5–9% of MRR (the quiet leak)` |
| 3 | 10 | SOFT_CLOSE | `you only pay on what comes back` |
| 4 | 18 | BREAKUP | `last one from me` |

**North-star examples:**

*Step 1 (day 0):*
> Subject: {{companyName}}'s failed-payment number
>
> Hi {{firstName}} — most subscription businesses on Stripe lose 5–9% of revenue to failed payments and billing leaks, and almost nobody has looked at their exact number.
>
> We built a free audit that shows it: read-only Stripe connect, your dollar figure in about 5 minutes, keep the report either way. [audit link]
>
> Curious what {{companyName}}'s number is?
> — Ashish

*Step 2 (day 4):* benchmark value — "Across audits we've run, the median business finds [X]% of MRR recoverable. The three leaks that show up everywhere: expired cards nobody retried smartly, dunning emails that stop too early, failed upgrades that never completed." CTA: audit link again.

*Step 3 (day 10):* the pricing IS the pitch — "Worth being clear about the model since it's unusual: the audit is free and stays free. If you turn recovery on, you pay 10% of what actually comes back, capped — recover nothing, pay nothing. The audit tells you if it's worth it: [link]."

*Step 4 (day 18):* "Last one from me — the free audit link is yours whenever the failed-payment line item gets annoying enough: [link]."

---

## Launch checklist (both campaigns)
1. Deliverability runbook A–D complete; `dig` checks pass on the new domain.
2. Create campaigns with values above; `testMode: true`.
3. Import first 50 contacts per campaign (fit score ≥6 enforced by pipeline).
4. Read the first 20 generated drafts per campaign against the north-star examples. Kill-or-fix if drafts invent claims (especially any compliance claim in Trust copy — positioning doctrine).
5. Flip testMode off; dailyLimit stays 10 for weeks 1–2 per warming schedule.
6. Track in weekly scorecard: sends, positive replies, calls booked, per-domain bounce %.
