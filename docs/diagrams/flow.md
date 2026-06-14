# Korrali Growth — End-to-End Flow

Internal founder tool for outbound, trials, and content ops across Korrali Trust + Revenue. **Not customer-facing, no billing.** Diagrams use Mermaid.

## The growth engine (high level)

![diagram](./flow-1.png)

## Async pipeline — pg-boss queues and cron triggers

![diagram](./flow-2.png)

## Inbound reply loop

![diagram](./flow-3.png)

## Trial lifecycle and intervention

![diagram](./flow-4.png)

## Content and demand engine

![diagram](./flow-5.png)

## Infrastructure

![diagram](./flow-6.png)

---

**One-line summary:** AI discovers and fit-scores companies, finds contacts, writes and sends personalized outreach, classifies replies, nudges at-risk trials, and generates content — all as pg-boss queues driven by cron schedules and webhooks, for the founder's eyes only.
