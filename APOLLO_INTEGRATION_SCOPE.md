# Apollo-as-data-source — integration scope

**Date:** 2026-07-09 · **Status:** scope only, not built · **Premise:** Apollo feeds
the *existing* Growth engine (keep our AI fit-scoring, personalization, sequencing,
Resend sending, deliverability). Apollo is a **data layer**, not a replacement for
the outreach machine.

## Why (grounded in current numbers)
Our #1 bottleneck is **contact supply**, not send infra or AI cost:
- AnymailFinder hit rate ~29–40% (`ceo`-only was 14 found / 34 miss; broadened
  2026-07-09). ~57% of qualified companies yield no email → they get scored (AI
  spend) but never become a send.
- Only ~38 usable contacts exist total; the funnel is starved.

Apollo's ~275M-contact verified DB is strong *exactly* where we're weak.

## Two integration points (independent; can ship either/both)

### Phase 1 — Contact enrichment (highest value, small effort)
Add Apollo as a provider tier in `apps/web/src/lib/import/contact-finder.ts`,
mirroring the existing `findViaAnymailFinder()` pattern.

- **New module:** `apps/web/src/lib/import/apollo.ts`
  - `enrichContactViaApollo(company, personas): Promise<Contact|null>`
  - Apollo People Match/Search (`POST /v1/people/match` or `/v1/mixed_people/search`),
    filter by `organization_domains=[company.domain]` + `person_titles`/`seniorities`
    mapped from our per-product personas. Reveal email (consumes 1 Apollo credit).
- **Wire-in:** in `findContactForCompany()`, tier the providers. Recommended order:
  **AMF first (cheap per verified find) → Apollo on AMF miss** — so Apollo credits
  are spent only on the ~57% gap AMF can't close, not on companies AMF already covers.
- **Data mapping (no schema change):** Apollo person → `Contact`
  `{ email, firstName, lastName, title, linkedinUrl, emailStatus: VALID (Apollo-verified),
  isBuyer: isBuyerTitle(title) }`. Existing verify-at-send (NeverBounce) still gates.
- **Downstream unchanged:** `autoEnqueueOutreach()` → email-generate → sequence → send.

### Phase 2 — Company discovery source (bigger effort, arguably higher quality)
Replace/augment the Tavily keyword-guessing discovery with Apollo's firmographic filters.

- **New module:** `apps/web/src/lib/ai/apollo-discoverer.ts` (parallel to `company-discoverer.ts`)
  - Apollo Organization Search (`POST /v1/mixed_companies/search`) with ICP filters:
    `organization_num_employees_ranges` (30–150 for the $50–150K MRR band),
    `q_organization_keyword_tags`, `technologies` (e.g. Stripe), funding stage.
  - Dedup by `domain` against existing companies (same pattern as
    `company-discoverer.ts:351`), `prisma.company.create({ acquisitionSource: "apollo", … })`,
    then `enqueueFitScore()` per new company.
- **New cron:** `apollo-discover-trigger` in `apps/web/src/worker/index.ts` (weekly,
  matching `company-discover-trigger`).
- **Bonus:** Apollo returns firmographics (industry, employeeCount, technologies) that
  populate `Company` fields directly → richer, more accurate fit-scoring than Tavily snippets.

## Config
- Env: `APOLLO_API_KEY` (header `X-Api-Key`). No schema migration.
- Feature-flag both phases so they can run alongside AMF/Tavily and be A/B compared.

## Cost model
- Apollo plan: ~$49–119/user/mo depending on tier (confirm the tier that includes API
  access + enough email credits — API/bulk historically gated to paid tiers).
- Email credits consumed **per reveal**. Phase-1 "AMF-first → Apollo-on-miss" bounds
  reveals to the ~57% gap, so credit burn is predictable.
- This is *additive* to Claude (~$5–40/mo), not a replacement — different layers.

## Risks / decisions
- **Freshness:** Apollo emails can be stale; keep NeverBounce verify-at-send as the gate.
- **List fatigue:** everyone uses Apollo's DB — our AI personalization + positioning
  guards are the differentiator vs the generic blast.
- **Compliance:** restrict to US contacts (GDPR exposure on EU personal data).
- **Provider order:** AMF-first vs Apollo-first — start AMF-first (measure Apollo's
  incremental lift on the miss set), revisit if Apollo clearly dominates.

## Effort
- Phase 1 (contact tier): ~0.5–1 day. Low risk (mirrors AMF; miss → falls through).
- Phase 2 (discovery source): ~1–2 days. Medium (filter mapping + dedup + cron).

## Recommendation
1. **Gate on conversion first.** We have ~9 real sends about to go out and 0 customers
   yet. Before spending on Apollo, get the first reply/booked-call signal — if a
   well-personalized message converts, Apollo's volume is obviously worth it; if it
   doesn't, more contacts won't fix a message/offer problem.
2. If green-lit, **ship Phase 1 first** (AMF-first → Apollo-on-miss). It directly
   attacks the bottleneck for ~0.5–1 day of work and bounded credit cost.
3. Add Phase 2 only if Phase-1 contact supply still can't keep the sequencer fed.

> API endpoint names/limits above are from general Apollo knowledge — verify against
> current Apollo API docs before implementing.
