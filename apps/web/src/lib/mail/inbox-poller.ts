import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "@/lib/db";
import { enqueueReplyClassify } from "@/lib/queue";
import { stopOutreachSequence } from "@/lib/sending/sequence-scheduler";

// Reads replies out of the Workspace mailbox that cold outbound is sent from
// (see transport.ts) and hands each one to the reply classifier.
//
// A reply is matched to its outreach by the Message-IDs it quotes back
// (In-Reply-To / References) against the ids stored on our outbound rows. If a
// client stripped those headers, the sender's address is matched against
// contacts instead. Mail that matches neither (newsletters, vendor mail, the
// founder's own notes) is left alone.
//
// The moment a human reply is matched, the outreach moves to REPLIED, which the
// eligibility gate treats as not sendable — so no automated follow-up can go
// out between the reply arriving and the classifier getting to it. The
// classifier puts pure auto-replies (out-of-office) back to ACTIVE.

const LOOKBACK_DAYS = 3;

export interface PollSummary {
  scanned: number;
  captured: number;
  bounces: number;
  unmatched: number;
}

export function parseAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/) ?? value.match(/([^\s<>"]+@[^\s<>"]+)/);
  return match?.[1]?.trim().toLowerCase() ?? null;
}

export function isBounceSender(from: string | null): boolean {
  return !!from && /^(mailer-daemon|postmaster)@/i.test(from);
}

/**
 * Drop the quoted history under a reply so the classifier (and the founder)
 * see only what the prospect wrote. Cuts at the first attribution line
 * ("On Mon, … wrote:") or the first run of ">"-quoted lines.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Gmail wraps long attributions, so "On …" may end with "wrote:" a line later.
    if (/^\s*On\b.*\bwrote:\s*$/i.test(line)) break;
    if (/^\s*On\b/i.test(line) && /\bwrote:\s*$/i.test(lines[i + 1] ?? "")) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && out.length > 0 && /^\s*(Sent|Date):/i.test(lines[i + 1] ?? "")) break;
    if (/^\s*>/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Message-IDs a reply refers to, newest first. */
export function referencedIds(mail: Pick<ParsedMail, "inReplyTo" | "references">): string[] {
  const refs = Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [];
  const ids = [mail.inReplyTo, ...[...refs].reverse()].filter((v): v is string => !!v);
  return [...new Set(ids)];
}

function headerValue(mail: ParsedMail, name: string): string | null {
  const value = mail.headers.get(name.toLowerCase());
  if (!value) return null;
  return typeof value === "string" ? value : String(value);
}

async function findOutreachForReply(mail: ParsedMail, fromAddress: string) {
  const ids = referencedIds(mail);
  if (ids.length) {
    const quoted = await prisma.emailMessage.findFirst({
      where: { direction: "OUTBOUND", rfcMessageId: { in: ids }, outreachId: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { outreachId: true, contactId: true },
    });
    if (quoted?.outreachId) return { outreachId: quoted.outreachId, contactId: quoted.contactId };
  }

  const contact = await prisma.contact.findUnique({
    where: { email: fromAddress },
    include: { outreaches: { orderBy: { updatedAt: "desc" }, take: 1, select: { id: true } } },
  });
  const outreach = contact?.outreaches[0];
  if (contact && outreach) return { outreachId: outreach.id, contactId: contact.id };
  return null;
}

async function recordBounce(mail: ParsedMail, messageId: string): Promise<boolean> {
  const failed = parseAddress(headerValue(mail, "x-failed-recipients"));
  if (!failed) return false;
  const contact = await prisma.contact.findUnique({
    where: { email: failed },
    include: { outreaches: { orderBy: { updatedAt: "desc" }, take: 1, select: { id: true } } },
  });
  if (!contact) return false;

  const outreachId = contact.outreaches[0]?.id ?? null;
  await prisma.emailMessage.create({
    data: {
      outreachId,
      contactId: contact.id,
      direction: "INBOUND",
      subject: mail.subject ?? "(bounce)",
      body: (mail.text ?? "").slice(0, 4000),
      rfcMessageId: messageId,
      bouncedAt: new Date(),
    },
  });
  // stopOutreachSequence("bounce") suppresses the address as well.
  if (outreachId) await stopOutreachSequence(outreachId, "bounce");
  return true;
}

export async function processInboundMail(
  mail: ParsedMail,
  selfAddresses: string[],
): Promise<"captured" | "bounce" | "skipped" | "unmatched"> {
  const messageId = mail.messageId;
  if (!messageId) return "skipped";

  const already = await prisma.emailMessage.findFirst({
    where: { rfcMessageId: messageId },
    select: { id: true },
  });
  if (already) return "skipped";

  const fromAddress = parseAddress(mail.from?.text);
  if (!fromAddress || selfAddresses.includes(fromAddress)) return "skipped";

  if (isBounceSender(fromAddress)) {
    return (await recordBounce(mail, messageId)) ? "bounce" : "unmatched";
  }

  const match = await findOutreachForReply(mail, fromAddress);
  if (!match) return "unmatched";

  const message = await prisma.emailMessage.create({
    data: {
      outreachId: match.outreachId,
      contactId: match.contactId,
      direction: "INBOUND",
      subject: mail.subject ?? "",
      body: stripQuotedReply(mail.text ?? "") || (mail.text ?? ""),
      rfcMessageId: messageId,
      sentAt: mail.date ?? new Date(),
    },
  });

  // Hold the sequence before anything else can send (see header comment).
  await prisma.outreach.updateMany({
    where: { id: match.outreachId, status: { in: ["PENDING", "ACTIVE"] } },
    data: { status: "REPLIED" },
  });

  await enqueueReplyClassify({ messageId: message.id });
  return "captured";
}

export async function pollInbox(): Promise<PollSummary> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const summary: PollSummary = { scanned: 0, captured: 0, bounces: 0, unmatched: 0 };
  if (!user || !pass) return summary;
  // The mailbox login and the address cold mail is sent as can differ (a
  // send-as alias), and mail from either is ours, never a prospect's reply.
  const selfAddresses = [user, process.env.GROWTH_FROM_EMAIL ?? ""]
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) return summary;

      for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
        if (!msg.source) continue;
        summary.scanned += 1;
        const mail = await simpleParser(msg.source);
        try {
          const result = await processInboundMail(mail, selfAddresses);
          if (result === "captured") summary.captured += 1;
          else if (result === "bounce") summary.bounces += 1;
          else if (result === "unmatched") summary.unmatched += 1;
        } catch (err) {
          console.error(`[inbox] failed to process ${mail.messageId ?? "?"}:`, err);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return summary;
}
