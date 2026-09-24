# Revenue machine — operating manual

Growth runs one motion: Stripe-using SaaS founders → 4-step cold sequence →
free Korrali Revenue install from the Stripe App Marketplace. The founder's only
jobs are answering replies, LinkedIn, and install walkthroughs.

## How it flows

1. **Import** an Apollo export → companies + buyer contacts (`scripts/import-apollo.ts`).
2. **Fit scoring** (Revenue only, spread ~6/hour for the free AI tiers). Score ≥ 6 → enrolled
   into the ACTIVE Revenue campaign, and 4 personalised emails are written per lead.
3. **Sending** from the Workspace mailbox over SMTP: weekdays 8:00–17:00 New York, cap 30/day,
   1 per domain per day. Step 1 has no link. Steps 2–4 carry the marketplace link and thread as
   `Re:` under step 1.
4. **Replies** are read from the mailbox every 5 min over IMAP. Any human reply stops the
   sequence immediately. Bounces stop the sequence and suppress the address. Out-of-office
   replies resume the next day.
5. **Classification**: INTERESTED / OBJECTION / NOT_NOW / WRONG_PERSON / OTHER → email alert to
   `FOUNDER_EMAIL`. INTERESTED also gets an AI reply with the install link, auto-sent after 2h
   unless cancelled in Growth → Inbox.
6. **Daily digest** at 08:00 IST to `FOUNDER_EMAIL`: sends, replies, who needs you, warnings
   (emergency stop, silent day, bounce rate > 3%, list running low).

## One-time setup

### 1. Mailbox app password (5 min)

For the Workspace user that owns `outreach@getkorrali.com` (if outreach@ is an alias, that is
the main user, e.g. `ashish@getkorrali.com`):

1. Admin console → Security → Authentication → 2-Step Verification → allow users to turn it on.
2. Sign in as that user → myaccount.google.com → Security → turn on 2-Step Verification.
3. myaccount.google.com/apppasswords → create one named "Growth" → copy the 16 characters.
4. If outreach@ is an alias: Gmail → Settings → Accounts → "Send mail as" → add
   `outreach@getkorrali.com` (otherwise Gmail rewrites the From to the main address).
5. Gmail → Settings → Forwarding and POP/IMAP → IMAP enabled.

### 2. Server env (`~/growth/.env.production`)

```
GMAIL_USER=ashish@getkorrali.com        # the login from step 1
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
GROWTH_FROM_EMAIL=outreach@getkorrali.com
FOUNDER_EMAIL=bhagat.ashish.a@gmail.com
MAX_SENDS_PER_DAY=30
```

With `GMAIL_USER` + `GMAIL_APP_PASSWORD` set, every Growth email (cold, auto-replies, alerts,
digest) goes through the mailbox. Without them it falls back to Resend and the inbox poll is
a no-op.

### 3. Deploy, import, set up

```bash
/Users/ashishbhagat/products/deploy.sh growth prod     # must end with "✓ deployed"

# copy the lists up (the Trust lists overlap heavily; only the full one is needed)
ssh -i ~/.ssh/angel-bot-key.pem ec2-user@3.216.168.27 'mkdir -p ~/growth/imports'
scp -i ~/.ssh/angel-bot-key.pem "/Users/ashishbhagat/products/revenue/Revenue contacts.csv" \
    "/Users/ashishbhagat/products/revenue/Revenue contact list 3.csv" \
    "/Users/ashishbhagat/products/trust/trust contacts list.csv" ec2-user@3.216.168.27:~/growth/imports/

# on the server, in ~/growth/prod/apps/web
E=/home/ec2-user/growth/.env.production
I=/home/ec2-user/growth/imports
pnpm tsx scripts/setup-revenue-machine.ts --env $E              # campaign + pause others, stop ON
pnpm tsx scripts/import-apollo.ts --env $E --file "$I/Revenue contacts.csv" --product REVENUE --dry-run
pnpm tsx scripts/import-apollo.ts --env $E --file "$I/Revenue contacts.csv" --product REVENUE
pnpm tsx scripts/import-apollo.ts --env $E --file "$I/Revenue contact list 3.csv" --product ROUTE
pnpm tsx scripts/import-apollo.ts --env $E --file "$I/trust contacts list.csv" --product ROUTE
```

Cross-use: `--product ROUTE` sends companies that bill through Stripe to Revenue and the rest
to Trust, keeping one contact per company (founder first). Any company that scores below 6 for
its product is re-scored for the other one an hour later. Expected split from the current
files: ~701 Revenue, ~660 Trust. Trust leads wait (scored, not emailed) until a Trust campaign
is ACTIVE (`setup-revenue-machine.ts --keep-trust <n>` keeps one running).

Next day: open Growth → Outreach, read 10–20 drafts. If they are good:

```bash
pnpm tsx scripts/setup-revenue-machine.ts --env $E --start      # LIVE
```

Never use campaign test mode with a real list: it advances every lead through all 4 steps
without sending, which burns the list.

## Daily routine (founder, ~60 min)

1. Read the digest. Fix anything under FIX FIRST.
2. Answer every NEEDS YOU line. INTERESTED first, within 2 hours.
3. LinkedIn: connect with 20 founders from yesterday's sends. No pitch in the note.
4. Anyone who installed: offer a 15-minute findings walkthrough.

## Weekly

- The digest's "prospects left" line drops under ~5 days → pull the next Apollo batch
  (founders/CEOs, Stripe, SaaS, 10–200 employees, verified) and import it.
- Replies under 1% after ~300 sends → change the message, not the product.
- Bounce rate above 3% → pause and clean the list.

## Kill switches

- Stop everything: `setup-revenue-machine.ts --env $E` (no `--start`) sets the emergency stop ON.
- Stop one campaign: Growth → Campaigns → Pause.
- Full stop: `pm2 stop growth-worker-prod`.
