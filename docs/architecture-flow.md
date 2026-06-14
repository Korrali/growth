# Korrali Growth — End-to-End Flow

Internal founder tool for outbound, trials, and content ops across Korrali Trust + Revenue. **Not customer-facing, no billing.** Diagrams use Mermaid.

## The growth engine (high level)

```mermaid
flowchart TD
    subgraph Sources["Lead sources"]
        DISC["Company discovery<br/>(AI web research, cron Mon-Fri)"]
        CSV["CSV import + enrichment"]
        VIS["Website visitor tracking"]
        COMM["Community scan<br/>(Reddit / HN / IH, daily)"]
    end
    DISC --> CO["Companies"]
    CSV --> CO
    VIS --> CO
    CO --> FS["AI fit score<br/>(TRUST / REVENUE / BOTH / REJECT)"]
    FS -->|"score >= 7"| CF["Find contacts"]
    CF --> CT["Contacts"]
    CT --> CAMP["Campaign -> Outreach sequence"]
    CAMP --> EG["AI email generation<br/>(personalized per step)"]
    EG --> SEND["Send via Resend<br/>(cron checks due every 15m)"]
    SEND --> REPLY["Inbound reply"]
    REPLY --> RC["AI reply classify<br/>(INTERESTED / OBJECTION / ...)"]
    RC -->|"INTERESTED"| AUTO["Draft + auto-send<br/>(after 2h founder window)"]
    RC --> TRIAL["Trial tracking + interventions"]
    COMM --> INTENT["Intent scoring -> SEO topics + content"]
```

## Async pipeline — pg-boss queues and cron triggers

```mermaid
flowchart LR
    subgraph Crons["Scheduled (cron)"]
        K1["outreach-due-check (15m)"]
        K2["trial-daily-check (7am)"]
        K3["company-discover (Mon-Fri 5am)"]
        K4["community-scan (8am)"]
        K6["linkedin-draft (9am)"]
        K7["content-distribute (30m)"]
        K8["weekly-insights (Mon 6am)"]
    end
    subgraph Events["Event triggers"]
        E1["/api/email/inbound"]
        E2["/api/visitor"]
        E3["Create campaign"]
        E4["Log a call"]
    end
    subgraph Q["Work queues -> handlers"]
        H1["outreach.send -> Resend"]
        H2["company.discover -> Tavily + Claude"]
        H3["fit.score -> Claude"]
        H4["contact.find"]
        H5["email.generate -> Claude"]
        H6["reply.classify -> Claude"]
        H7["reply.auto-send -> Resend"]
        H8["trial.intervention"]
        H9["community.scan -> Tavily"]
        H10["linkedin.draft -> Claude"]
        H11["content.generate / distribute"]
        H12["call.brief / call.followup -> Claude"]
        H13["visitor.process -> Claude"]
        H14["weekly.insights -> Claude"]
    end
    K1 --> H1
    K2 --> H8
    K3 --> H2
    H2 --> H3
    H3 -->|"fit >= 7"| H4
    K4 --> H9
    K6 --> H10
    K7 --> H11
    K8 --> H14
    E1 --> H6
    H6 -->|"INTERESTED"| H7
    E2 --> H13
    E3 --> H5
    E4 --> H12
```

## Inbound reply loop

```mermaid
sequenceDiagram
    participant P as Prospect
    participant WH as /api/email/inbound
    participant Q as pg-boss
    participant W as Worker
    participant AI as Claude
    participant F as Founder

    P->>WH: reply email
    WH->>Q: enqueue reply.classify
    W->>AI: classify intent + draft a reply
    AI-->>W: INTERESTED / OBJECTION / NOT_INTERESTED / ...
    alt INTERESTED
        W->>Q: enqueue reply.auto-send (startAfter +2h)
        Note over W,F: 2h window for founder to edit or cancel
        W->>P: auto-send reply via Resend
    else needs a human
        W->>F: surface in Inbox for manual reply
    end
```

## Trial lifecycle and intervention

```mermaid
flowchart LR
    T0["Trial starts<br/>(TRUST or REVENUE)"] --> AC["activation-classifier<br/>(login, KB facts, Q answered, Stripe connected)"]
    AC --> RISK{"activationRisk"}
    RISK -->|"HIGH / CRITICAL"| INT["trial.intervention<br/>(daily 7am check)"]
    INT --> SEQ["intervention sequence<br/>(email nudges)"]
    RISK -->|"healthy"| WATCH["monitor"]
    T0 --> OUT{"outcome"}
    OUT --> CONV["CONVERTED"]
    OUT --> CHURN["CHURNED"]
```

## Content and demand engine

```mermaid
flowchart LR
    COMM["Community mentions<br/>(Reddit / HN / IH)"] --> TOP["seo-topic-analyzer<br/>(weekly cache)"]
    PERF["Campaign performance<br/>(best segments / subject lines)"] --> INS["weekly-insights (Claude)"]
    TOP --> GEN["content.generate (Claude)<br/>SEO articles + LinkedIn posts"]
    INS --> GEN
    GEN --> SCHED["ContentDraft (scheduled)"]
    SCHED --> DIST["content.distribute<br/>(cron every 30m)"]
```

## Infrastructure

```mermaid
flowchart LR
    subgraph EC2["EC2 (nginx)"]
        WEB["Next.js web<br/>(single-tenant, founder only)"]
        WK["Worker (pm2)<br/>16 queues + 8 cron jobs"]
        PG[("Postgres")]
        QB["pg-boss (queues + schedules)"]
    end
    WEB <--> PG
    WK <--> PG
    WEB --> QB
    QB --> WK
    WK --> AI["Claude API"]
    WK --> TV["Tavily (web research)"]
    WK --> RS["Resend (email send + inbound)"]
    WK --> RD["Reddit / HN / IH"]
    WEB -.-> SE["Sentry / GlitchTip"]
```

---

**One-line summary:** AI discovers and fit-scores companies, finds contacts, writes and sends personalized outreach, classifies replies, nudges at-risk trials, and generates content — all as pg-boss queues driven by cron schedules and webhooks, for the founder's eyes only.
