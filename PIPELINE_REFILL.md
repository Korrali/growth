# Growth — Contact Pipeline Refill (fastest path to sendable volume)

**Why this beats waiting on discovery:** Auto-discovery adds ~168 companies/week but only
~8% clear fit≥6, and AnymailFinder can't find a contact for ~34% of the qualified ones. A
targeted CSV import skips both — you hand the engine verified decision-makers directly, and
they flow straight into fit-scoring → enroll → send. This is the "do things that don't scale"
lever for the first real cohort.

## Import mechanism
1. Build the CSV (formats below).
2. In the app: **/growth/companies/import** → upload. The engine dedupes by domain,
   verifies each email (NeverBounce — fail-closed), fit-scores, and the 2h auto-enroll cron
   picks up new buyers → sequences → sends (gated to 08:00–18:00 ET + warming caps).

## CSV formats (headers are case-insensitive; spaces→underscores)
**Contacts** (the one you want — feeds sends directly):
```
email,first_name,last_name,title,company_domain
jane@acme.com,Jane,Doe,VP Finance,acme.com
```
**Companies** (optional, if importing accounts without contacts):
```
name,domain,website,industry,employee_count,description
```

## Where to source the list (Apollo.io or LinkedIn Sales Navigator)

### Korrali Revenue ICP — $50–150K MRR SaaS on Stripe
Apollo / Sales Nav filters:
- Industry: SaaS / Software / Internet
- Headcount: ~15–80 (proxy for $50–150K MRR; avoids sub-$30K noise)
- Uses Stripe (Apollo technographic filter "Stripe"; or Sales Nav → keyword "Stripe" in bio/site)
- Titles: Founder, CEO, CFO, VP Finance, Head of RevOps, Head of Finance, Controller
- Geography: US / UK / EU first (deliverability + timezone)
- Pull email + name + title + company domain.
- **Do NOT** target sub-$30K MRR / indie-hacker milestones — they net tens of $/mo on
  performance pricing and can't be upsold. (This was deliberately removed from discovery.)

### Korrali Trust ICP — AI-native companies needing compliance
- Industry: AI / ML / Developer Tools / Data
- Headcount: ~10–100, recently funded (seed–Series B) = compliance pressure
- Titles: Founder, CTO, Head of Security, Head of Compliance, GRC, Head of Legal/Ops
- Signals: "SOC 2", "security questionnaire", "GDPR", "EU AI Act" in job posts / site

## Volume guidance
- First import: **50–100 contacts per product**, high-precision. Don't dump 1,000 —
  the domain is unwarmed (warming cap ~10 sends/day), so precision > volume right now.
- Watch bounce rate on the first batch; keep it <3% or the finder/list quality needs work.

## Durable fixes (code — flag for later, not now)
- **Contact-find coverage gap (34%):** AnymailFinder alone misses a third of qualified
  companies. Add a second provider — Hunter.io (free tier) or wire the scoped-but-unbuilt
  Apollo tier (`APOLLO_INTEGRATION_SCOPE.md`) — to close it.
- **Discovery cadence:** currently weekly (Tavily free-plan throttle). Raising it needs a
  paid Tavily plan; only worth it once the import + finder are maxed.
