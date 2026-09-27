import { prisma } from "@/lib/db";
import { checkSendEligibility } from "@/lib/sending/eligibility";
import { renderTemplate } from "@/lib/sending/template-renderer";
import { generateUnsubscribeToken } from "@/lib/sending/unsubscribe-token";
import { scheduleNextStep, stopOutreachSequence } from "@/lib/sending/sequence-scheduler";
import { injectUtmIntoText } from "@/lib/utm";
import { PRODUCTS } from "@/lib/products";
import { verifyEmail } from "@/lib/import/email-verifier";
import { enqueueEmailGenerate } from "@/lib/queue";
import { sendMail } from "@/lib/mail/transport";
import { withSignOff } from "@/lib/sending/sender-identity";
import { isStaleDraft } from "@/lib/sending/templates";

// How many times a step may abort for a missing draft before the sequence is
// stopped for good. Each attempt is an hour apart, so this is a ~3 hour window
// for draft generation to succeed before we stop retrying.
const MAX_NO_DRAFT_ATTEMPTS = 3;

// Reasons that mean the outreach should be permanently stopped (never re-queued).
// These are conditions that won't resolve by waiting — a low quality score,
// an exhausted follow-up budget, or a failed content gate need a human (or a
// regeneration job) to act, not a retry loop.
const TERMINAL_ELIGIBILITY_REASONS = new Set([
  "contact_suppressed",
  "email_invalid",
  "email_disposable",
  "email_in_suppression_list",
  "domain_suppressed",
  "outreach_not_found",
  "max_followups_exceeded",
  "fit_score_too_low",
  "quality_gate_blocked",
  "product_not_outbound_viable",
]);

// Transient failures: retry in 1 hour so the cron picks them up again.
// Without this, outreaches first-attempted outside the send window stay stuck
// with nextSendAt=NULL and never surface in the due-check query.
const RETRY_IN_ONE_HOUR_REASONS = new Set([
  "outside_send_window",
  "quiet_hours",
  "daily_limit_reached",
  "per_domain_limit_reached",
  "global_emergency_stop",
  "campaign_not_active",
  "outreach_not_active",
  "already_sent_this_step",
]);

async function rescheduleIn(outreachId: string, hours: number): Promise<void> {
  const retryAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await prisma.outreach.update({
    where: { id: outreachId },
    data: { nextSendAt: retryAt },
  }).catch(() => {});
}

export interface SendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

export async function sendOutreachStep(
  outreachId: string,
  stepNumber: number,
): Promise<SendResult> {
  // Gate check
  const eligibility = await checkSendEligibility(outreachId, stepNumber);
  if (!eligibility.eligible) {
    const reason = eligibility.reason ?? "unknown";
    const baseReason = reason.split(":")[0];
    if (TERMINAL_ELIGIBILITY_REASONS.has(baseReason)) {
      // Terminal: move outreach to STOPPED so the cron never re-queues it.
      await stopOutreachSequence(outreachId, reason).catch(() => {});
    } else if (RETRY_IN_ONE_HOUR_REASONS.has(baseReason)) {
      // Transient: set nextSendAt so the cron rescues the outreach.
      await rescheduleIn(outreachId, 1);
    } else {
      // Uncategorized reason — never leave nextSendAt untouched here. Without
      // this, an eligibility check added later (or any reason we haven't
      // explicitly bucketed) silently re-triggers every cron cycle forever
      // with zero forward progress, since nothing else advances nextSendAt.
      // A conservative 1-hour retry surfaces it again without spinning.
      await rescheduleIn(outreachId, 1);
    }
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.skipped",
        entity: "Outreach",
        entityId: outreachId,
        metadata: { stepNumber, reason },
      },
    });
    return { sent: false, reason };
  }

  const outreach = await prisma.outreach.findUniqueOrThrow({
    where: { id: outreachId },
    include: {
      contact: true,
      company: true,
      campaign: {
        include: {
          client: true,
          sequenceSteps: { orderBy: { stepNumber: "asc" } },
        },
      },
    },
  });

  // Test mode — log without sending
  if (outreach.campaign.testMode) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.test_mode_send",
        entity: "Outreach",
        entityId: outreachId,
        metadata: { stepNumber, testMode: true },
      },
    });
    await scheduleNextStep(outreachId);
    return { sent: false, reason: "test-mode" };
  }

  // Load AI-generated draft
  const draft = await prisma.outreachEmailDraft.findUnique({
    where: { outreachId_stepNumber: { outreachId, stepNumber } },
  });

  // Only Revenue/Trust drafts come from the template; client campaigns don't.
  const product = outreach.campaign.product;
  const stale =
    !!draft &&
    (product === "REVENUE" || product === "TRUST") &&
    isStaleDraft(product, draft.updatedAt);
  if (!draft || stale) {
    // A stale draft (written before the current template) is treated like a
    // missing one: regenerated, then sent on the retry.
    // No draft yet. This is the normal path for a first email: drafts are
    // written just before sending, not at enrollment (auto-enroll.ts), so the
    // weekly Haiku budget only pays for emails that actually go out.
    //
    // This used to return without touching nextSendAt or the outreach status,
    // which left the record permanently due: the cron re-queued it every hour,
    // it aborted here again, forever, with zero forward progress. That is the
    // same trap the eligibility block above explicitly guards against — the
    // guard just never covered this branch. Observed in prod at 61 aborts on a
    // single outreach before anyone noticed, because it looks like activity.
    //
    // Self-heal instead: ask for the draft to be generated and retry in an
    // hour. Give up permanently once retries are exhausted so a record whose
    // generation keeps failing can't spin forever.
    const priorAborts = await prisma.auditLog.count({
      where: { action: "outreach.aborted", entityId: outreachId },
    });

    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.aborted",
        entity: "Outreach",
        entityId: outreachId,
        metadata: { stepNumber, reason: stale ? "stale-draft" : "no-draft", priorAborts },
      },
    });

    if (priorAborts + 1 >= MAX_NO_DRAFT_ATTEMPTS) {
      await stopOutreachSequence(outreachId, "no-draft:retries-exhausted").catch(() => {});
    } else {
      // singletonKey on the generate queue dedupes concurrent requests for us.
      await enqueueEmailGenerate({ outreachId }).catch(() => {});
      await rescheduleIn(outreachId, 1);
    }
    return { sent: false, reason: "no-draft" };
  }

  const contact = outreach.contact;
  const company = outreach.company;

  // ── Final deliverability guard (belt-and-suspenders) ───────────────────────
  // The contact finder verifies mailboxes at creation, but outreach queued
  // BEFORE that fix can still point at a guessed address. Re-verify on the first
  // send so already-queued guesses can't bounce and degrade domain reputation.
  // Only step 1 needs this — follow-up steps only run after a deliverable step 1.
  //   • undeliverable → suppress the contact (never retry a known-bad mailbox)
  //   • unknown (incl. NO verification provider configured) → fail-closed: skip
  //     WITHOUT suppressing, so the contact resumes once a provider key is set
  //   • deliverable / risky (catch-all) → send
  if (stepNumber === 1) {
    const verdict = await verifyEmail(contact.email);

    // Persist verification result so Gate 3 and future steps reflect reality.
    const statusMap = {
      deliverable: "VALID",
      risky: "CATCH_ALL",
      undeliverable: "INVALID",
    } as const;
    if (verdict in statusMap) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { emailStatus: statusMap[verdict as keyof typeof statusMap] },
      }).catch(() => {});
    }

    if (verdict === "undeliverable") {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { suppressedAt: new Date() },
      }).catch(() => { /* contact may already be suppressed */ });
      await stopOutreachSequence(outreachId, "undeliverable").catch(() => {});
      await prisma.auditLog.create({
        data: {
          actor: "system",
          action: "outreach.skipped_undeliverable",
          entity: "Outreach",
          entityId: outreachId,
          metadata: { stepNumber, email: contact.email, verdict },
        },
      });
      return { sent: false, reason: "undeliverable" };
    }
    const sendable =
      verdict === "deliverable" ||
      verdict === "risky" ||
      process.env.GROWTH_ALLOW_UNVERIFIED_SEND === "true";
    if (!sendable) {
      // "unknown" — provider unavailable or timed out. Reschedule; do not suppress.
      await rescheduleIn(outreachId, 4);
      await prisma.auditLog.create({
        data: {
          actor: "system",
          action: "outreach.skipped_unverified",
          entity: "Outreach",
          entityId: outreachId,
          metadata: { stepNumber, email: contact.email, verdict },
        },
      });
      return { sent: false, reason: `unverified:${verdict}` };
    }
  }

  // Build unsubscribe footer
  const appUrl = process.env.APP_URL ?? "";
  const token = generateUnsubscribeToken(contact.email);
  const emailB64 = Buffer.from(contact.email.toLowerCase()).toString("base64url");
  const unsubscribeUrl = `${appUrl}/unsubscribe?email=${emailB64}&token=${token}`;
  // Plain-text email: a markdown link rendered as raw "[Unsubscribe](https://…token…)".
  // Opt-out is a reply ("no thanks" is classified as an unsubscribe) plus the
  // List-Unsubscribe header below, which Gmail/Outlook show as a native link.
  const footer = `\n\n—\nNot relevant? Reply "no thanks" and I won't email again.`;

  const bodyWithUtm = injectUtmIntoText(withSignOff(draft.body), {
    source:   "cold_email",
    medium:   "email",
    campaign: outreach.campaign.id,
    content:  `step${stepNumber}`,
  });
  const bodyWithFooter = bodyWithUtm + footer;

  // Sender identity: per-campaign overrides take precedence over env defaults.
  // Client campaigns set fromName/fromEmail so the email appears to come from
  // the client's team. Internal campaigns fall back to the product brand.
  const fromName = outreach.campaign.fromName
    ?? (() => {
      const product = PRODUCTS[outreach.campaign.product as keyof typeof PRODUCTS];
      if (!product) return process.env.GROWTH_FROM_NAME ?? "The Korrali Team";
      return product.brand === "Korrali"
        ? (process.env.GROWTH_FROM_NAME ?? "The Korrali Team")
        : `The ${product.brand} Team`;
    })();
  const fromEmail = outreach.campaign.fromEmail
    ?? process.env.GROWTH_FROM_EMAIL
    ?? "outreach@korrali.com";
  const inboundDomain = outreach.campaign.client?.inboundDomain
    ?? process.env.RESEND_INBOUND_DOMAIN
    ?? null;
  const replyTo = inboundDomain
    ? `reply+${outreachId}@${inboundDomain}`
    : fromEmail;

  // Follow-ups go out as replies in the step-1 thread ("Re: <first subject>"),
  // so the prospect sees one conversation, not four unrelated cold emails.
  const priorOutbound = stepNumber > 1
    ? await prisma.emailMessage.findMany({
        // Sequence steps only: an email that was superseded (stepNumber
        // cleared by scripts/resend-first-email.ts) or an auto-reply must not
        // become the thread root.
        where: { outreachId, direction: "OUTBOUND", rfcMessageId: { not: null }, stepNumber: { not: null } },
        orderBy: { sentAt: "asc" },
        select: { subject: true, rfcMessageId: true },
      })
    : [];
  const threadRoot = priorOutbound[0];
  const references = priorOutbound.map((m) => m.rfcMessageId!).filter(Boolean);
  const subject = threadRoot?.subject
    ? (/^re:/i.test(threadRoot.subject) ? threadRoot.subject : `Re: ${threadRoot.subject}`)
    : draft.subject;

  let sent;
  try {
    sent = await sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: contact.email,
      subject,
      text: bodyWithFooter,
      replyTo,
      // RFC 2369 List-Unsubscribe — lets Gmail/Outlook render a native
      // "Unsubscribe" control and marks us as a legitimate list sender, which
      // improves inbox placement (Microsoft especially weights this, and honors
      // the mailto form even where it distrusts the HTTPS link). We intentionally
      // omit List-Unsubscribe-Post (one-click) because /unsubscribe is a GET-only
      // page — advertising one-click would make providers POST to a 405 and read
      // as broken. mailto + the existing tokenized HTTPS link is the safe win.
      headers: {
        "List-Unsubscribe": `<mailto:${fromEmail}?subject=unsubscribe>, <${unsubscribeUrl}>`,
      },
      inReplyTo: references.at(-1) ?? null,
      references,
    });
  } catch (err) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.send.failed",
        entity: "Outreach",
        entityId: outreachId,
        metadata: { stepNumber, error: err instanceof Error ? err.message : String(err) },
      },
    });
    throw err;
  }

  // Record EmailMessage
  await prisma.emailMessage.create({
    data: {
      outreachId,
      contactId: contact.id,
      direction: "OUTBOUND",
      subject,
      body: bodyWithFooter,
      resendMessageId: sent.providerId,
      rfcMessageId: sent.rfcMessageId,
      sentAt: new Date(),
      stepNumber,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "outreach.sent",
      entity: "Outreach",
      entityId: outreachId,
      metadata: { stepNumber, providerId: sent.providerId, to: contact.email },
    },
  });

  // Schedule next step
  await scheduleNextStep(outreachId);

  return { sent: true, messageId: sent.providerId };
}
