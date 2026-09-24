import { randomUUID } from "crypto";
import nodemailer, { type Transporter } from "nodemailer";

// One send path for every email Growth writes: cold steps, auto-replies and
// founder alerts.
//
// Gmail (the Google Workspace mailbox over SMTP, app-password auth) is used
// whenever GMAIL_USER + GMAIL_APP_PASSWORD are set. Resend remains the fallback
// so an environment without mailbox credentials keeps its old behaviour.
//
// Why the mailbox and not Resend for cold outbound: replies land in the same
// mailbox the IMAP poller reads (inbox-poller.ts), so reply capture works with
// no inbound DNS; Google-to-Google delivery places better than a transactional
// API; and Resend's acceptable-use policy restricts sending to purchased lists.

export interface OutboundMail {
  from: string; // "Name <addr@domain>"
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Message-ID of the email this one answers — threads it in the recipient's client. */
  inReplyTo?: string | null;
  references?: string[];
}

export interface SentMail {
  /** Stored in EmailMessage.resendMessageId (unique). */
  providerId: string;
  /** RFC 5322 Message-ID, null when the provider does not expose it. */
  rfcMessageId: string | null;
}

export type MailTransportKind = "gmail" | "resend";

export function mailTransportKind(): MailTransportKind {
  return process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD ? "gmail" : "resend";
}

function domainOf(from: string): string {
  const match = from.match(/@([^>\s]+)/);
  return match?.[1] ?? "localhost";
}

export function makeMessageId(from: string): string {
  return `<${randomUUID()}@${domainOf(from)}>`;
}

let smtp: Transporter | null = null;
function getSmtp(): Transporter {
  if (!smtp) {
    smtp = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return smtp;
}

async function sendViaGmail(mail: OutboundMail): Promise<SentMail> {
  // Set the Message-ID ourselves so it is known before the send returns and is
  // exactly what the recipient's reply will quote back in In-Reply-To.
  const messageId = makeMessageId(mail.from);
  await getSmtp().sendMail({
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    replyTo: mail.replyTo,
    headers: mail.headers,
    messageId,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references?.length ? mail.references : undefined,
  });
  return { providerId: messageId, rfcMessageId: messageId };
}

async function sendViaResend(mail: OutboundMail): Promise<SentMail> {
  const headers: Record<string, string> = { ...(mail.headers ?? {}) };
  if (mail.inReplyTo) headers["In-Reply-To"] = mail.inReplyTo;
  if (mail.references?.length) headers.References = mail.references.join(" ");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mail.from,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      reply_to: mail.replyTo,
      headers: Object.keys(headers).length ? headers : undefined,
    }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${errorText}`);
  }
  const { id } = (await res.json()) as { id: string };
  return { providerId: id, rfcMessageId: null };
}

export async function sendMail(mail: OutboundMail): Promise<SentMail> {
  return mailTransportKind() === "gmail" ? sendViaGmail(mail) : sendViaResend(mail);
}
