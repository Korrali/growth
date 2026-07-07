# Outbound Deliverability Runbook

**Audit date:** 2026-07-07 · **Status 2026-07-07 (night): ✅ COMPLETE — getkorrali.com verified and live; warming phase 1 (10/day) in effect.**

## Final state (what's actually running)
- **Sending domain:** getkorrali.com, verified in the dedicated free Resend account (login: ashish.bhagat@getkorrali.com). Send-only restricted key deployed to all Growth envs (least privilege); the full-access key is used only for domain admin.
- **From:** `Ashish from Korrali <ashish@getkorrali.com>` · Reply-To falls back to the same address (receives via Google). System/auth emails: `system@getkorrali.com`.
- **Env flips done** (local `.env` + EC2 `.env.production` + `.env.uat`, backups `*.bak-20260707`, pm2 restarted): new `RESEND_API_KEY`, `GROWTH_FROM_EMAIL`, `EMAIL_FROM`, `RESEND_INBOUND_DOMAIN=` (empty — the old prod value `korrali.com` was generating dead `reply+…@korrali.com` Reply-To addresses; replies were bouncing), `MAX_SENDS_PER_DAY=10` (warming).
- **DNS verified at public resolvers:** Resend DKIM, send-subdomain SPF + MX, DMARC `p=quarantine` (single record — the conflicting parked `p=reject` was deleted). Root korrali.com untouched: transactional only, forever.
- **End-to-end test send:** delivered from ashish@getkorrali.com via the send-only key (Resend id `2866598f`).
- **Raise `MAX_SENDS_PER_DAY` per the warming schedule below** (10 → 20 → 30 → 50), conditions-gated, via the same env edit + pm2 restart.

## What the audit found

1. **All cold outbound currently sends from the ROOT domain.** `GROWTH_FROM_EMAIL=outreach@korrali.com` — that's an address on `korrali.com`, which is also the domain carrying Trust + Revenue transactional email (Resend, verified 2026-06-15). The ~78% bounce incident therefore damaged the root domain's reputation, not a burner. Cold outbound must move off the root before any volume ramp.
2. **`outreach.korrali.com` was never set up.** No SPF TXT, no DKIM (`resend._domainkey.outreach.korrali.com` empty), no MX, not registered in Resend. The memory item "confirm SPF/DKIM/DMARC on outreach.korrali.com" turned out to be moot — nothing exists to confirm.
3. **Root DMARC is `p=reject` with no `sp=` tag** → subdomains inherit reject. Any unauthenticated subdomain mail is silently killed. (Good policy — but it means the subdomain MUST be fully verified in Resend before first send.)
4. **Resend plan blocker:** current plan allows 1 domain. Adding `outreach.korrali.com` returned `403: Your plan includes 1 domain. Upgrade to add more.`
5. **What's already healthy:** root SPF (`google + resend`), root DKIM present, root DMARC strict, `send.korrali.com` return-path records correct. The Growth send pipeline has 13 eligibility gates incl. global kill switch, daily cap (default 20), per-recipient-domain cap (default 1/day), quiet hours, NeverBounce verify-at-send, quality gates. Code needs no changes for warming — caps are env/campaign-driven.

## Status update 2026-07-07 (evening): automated with Cloudflare API access

- ✅ **Subdomain DMARC is LIVE** — `_dmarc.outreach.korrali.com` TXT (`p=quarantine`) added via Cloudflare API and verified at the authoritative NS. Move to `p=reject` after 60 clean days.
- ✅ **Everything else is scripted** — `/Users/ashishbhagat/products/infra/setup-outreach-domain.py` (idempotent; takes `RESEND_API_KEY` + `CF_API_TOKEN` env vars) registers the domain in Resend, pushes the DKIM/SPF/MX records to Cloudflare, triggers verification, and polls until verified. Tested: runs cleanly up to the Resend plan limit.

## Plan change 2026-07-07 (late): getkorrali.com + second free Resend account ($0 path)

Founder can't spend on Resend Pro. New plan — **getkorrali.com** (already owned, already a Cloudflare zone) becomes THE cold-outbound domain, registered in a **second, free Resend account** (free tier = 1 domain, 100/day, 3,000/mo — covers the warming schedule AND the 50/day steady state). This is better isolation than the subdomain plan anyway. The outreach.korrali.com subdomain plan is shelved.

**Investigated state of getkorrali.com (2026-07-07):**
- DNS carries STALE records from an earlier setup: `resend._domainkey` DKIM, `send.`/`reply.` subdomains, root SPF with resend include, Google Workspace MX on root. The domain is NOT currently verified in any accessible Resend account (send test → 403 unverified; the "second" prod API key `re_EqGz***` turned out to be a send-restricted key of the same single account).
- ✅ DMARC fixed: parked `p=reject` record deleted (was an invalid duplicate); `p=quarantine` live.
- ✅ Setup script updated: defaults to getkorrali.com / zone `1838dead...`; re-registering will rotate the stale DKIM automatically (upsert).

**The ONE founder action ($0, ~2 min):** create a new free Resend account (e.g. sign up with bhagat.ashish.a+outreach@gmail.com), create a full-access API key, paste it to Claude. Claude then runs `infra/setup-outreach-domain.py`, verifies the domain, flips Growth env (`GROWTH_FROM_EMAIL=ashish@getkorrali.com`, new `RESEND_API_KEY` — Growth only; Trust/Revenue keep the original account) locally + on EC2, and warming starts at 10/day.

**Open check — reply reception:** root MX points to `smtp.google.com`. If getkorrali.com is NOT added as a secondary domain in Google Workspace, replies to ashish@getkorrali.com bounce. Confirm in Workspace admin, or Claude swaps root MX to Cloudflare Email Routing (free forward to Gmail — needs Email Routing enabled in the CF dashboard once, ~2 min; current API token lacks that permission).

**Later, out of first revenue:** Resend Pro on the outbound account restores automated inbound reply parsing into Growth's inbox (the `reply.getkorrali.com → inbound.resend.com` MX is already in place for it). Until then, replies are handled in the founder's mailbox.

## Warming schedule (enforced via campaign `dailyLimit`, per sending domain)

| Week | Cap/day | Condition to advance |
|---|---|---|
| 1–2 | 10 | bounce <3%, no spam complaints |
| 3 | 20 | opens >40% on warming sends |
| 4 | 30 | bounce still <3% |
| 5+ | 50 (steady state) | complaint rate <0.1% |

Any week failing its condition → drop back one level for a full week. Bounce >5% on any day → global emergency stop (`growthSettings.globalEmergencyStop`), diagnose before resuming. Never raise `MAX_SENDS_PER_DAY` env default; set per-campaign `dailyLimit` instead so the global cap stays as backstop.

## Standing rules
- Root `korrali.com` = transactional + newsletter ONLY. No cold sends, ever, from root — retire `outreach@korrali.com` as a from-address once the subdomain is live.
- Keep per-recipient-domain cap at 1/day (default) — it's your anti-spamtrap throttle.
- Weekly scorecard rows: bounce %, complaint %, open % per sending domain (OS §8 "domain health").
