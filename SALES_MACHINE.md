# Sales machine

Growth sells Korrali Revenue and Korrali Trust by cold email, on its own. It finds nothing
new by itself — you feed it Apollo lists — and everything after the import is automatic.

```
Apollo CSV ──import──▶ scored by AI ──fit ≥ 6──▶ 4 personalised emails written
                      (not a fit? re-scored             │
                       for the other product)           ▼
                                        sent from ashish@getkorrali.com, weekdays,
                                        8:00–17:00 New York, within the daily budget
                                                        │
                        replies read every 5 min ◀──────┘
                                    │
    human reply → sequence stops · bounce → address suppressed · out-of-office → resumes
                                    │
          INTERESTED → AI answers with the free-trial / install link after 2h
          anything worth a human look → email alert to you
                                    │
                    08:00 IST digest: what happened, who needs you, what's broken
```

## The two offers

| | Revenue | Trust |
|---|---|---|
| Who | Founders / finance at subscription companies billing through Stripe | CTOs, security, founders at B2B companies selling to enterprise |
| Ask | Free install from the Stripe App Marketplace; uninstall if it finds nothing; then $99/mo or 10% of recovered | First questionnaire free (no card, no time limit); then $299/mo founding price for the first 10 customers, $599/mo after |
| Link | marketplace.stripe.com/apps/korrali-revenue-recovery | trust.korrali.com |
| Campaign | Revenue — marketplace install (weight 60) | Trust — questionnaire trial (weight 40) |

Step 1 has no link. Steps 2–4 (day 3, 7, 14) carry the link once and thread as `Re:` under
step 1. Every email is signed "Ashish".

## What runs by itself

- **Volume**: 30 emails a day in total in week 1, +10 each week, up to 80 (`SEND_CAP_CEILING`).
  Revenue gets 60%, Trust 40%. Nobody needs to raise a limit.
- **Safety**: 1 email per company domain per day; human replies stop the sequence; bounces
  and unsubscribes are suppressed forever; weekday-only sending.
- **Bounce brake**: if more than 5% of a day's sends bounce, the digest turns the emergency
  stop on by itself and tells you.
- **Cross-use**: a company that is not a fit for one product is re-scored for the other.

## What still needs you

1. **Every ~4–5 weeks: a new Apollo list.** The digest warns when fewer than 5 days of
   prospects are left. Pull verified founders/CTOs/finance, 10–500 employees, excluding
   everyone already exported, and import it (below).
2. **Optional**: answer the replies the digest lists. INTERESTED prospects already got the AI
   reply with the link; objections and "not now" are yours if you want them.
3. **Optional**: LinkedIn. `/Users/ashishbhagat/products/all-contacts-linkedin-2026-09-24.csv`
   has everyone, with their product and whether Growth is emailing them.

## Commands (on the server, in `~/growth/prod/apps/web`)

```bash
E=/home/ec2-user/growth/.env.production

# campaigns + go live (idempotent; without --start the emergency stop goes ON)
pnpm tsx scripts/setup-sales-machine.ts --env $E --start

# import a new list — ROUTE sends Stripe billers to Revenue, the rest to Trust
pnpm tsx scripts/import-apollo.ts --env $E --file ~/growth/imports/NEW.csv --product ROUTE --dry-run
pnpm tsx scripts/import-apollo.ts --env $E --file ~/growth/imports/NEW.csv --product ROUTE

# mailbox check (send + read); --send-test mails you one test to check the From line
pnpm tsx scripts/check-mailbox.ts --env $E --send-test ashish.bhagat@korrali.com
```

Copy a list up first: `scp -i ~/.ssh/angel-bot-key.pem NEW.csv ec2-user@3.216.168.27:growth/imports/`.
The server throttles new SSH connections — if you see `Connection closed by … port 22`, wait a
minute and retry. `deploy.sh` reuses one connection and retries on its own.

## Stop buttons

- Everything: `setup-sales-machine.ts --env $E` (no `--start`) — emergency stop ON.
- Trust only: `setup-sales-machine.ts --env $E --start --trust-weight 0`.
- Hard stop: `pm2 stop growth-worker-prod`.

## Configuration (`~/growth/.env.production`)

```
GMAIL_USER=ashish.bhagat@getkorrali.com   # dedicated cold-email user; ashish@ is its alias
GMAIL_APP_PASSWORD=…                      # myaccount.google.com/apppasswords (needs 2-Step Verification)
GROWTH_FROM_NAME=Ashish Bhagat
GROWTH_FROM_EMAIL=ashish@getkorrali.com   # alias; must be in Gmail → Settings → Accounts → "Send mail as"
FOUNDER_EMAIL=bhagat.ashish.a@gmail.com   # alerts + daily digest
SEND_CAP_CEILING=80                       # optional; max emails/day once warmed up
```

getkorrali.com has its own SPF, DKIM and DMARC, so cold-email reputation never touches korrali.com.
Never use campaign test mode with a real list: it advances leads through all 4 steps without
sending.
