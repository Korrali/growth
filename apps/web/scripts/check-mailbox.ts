/**
 * Confirm the Workspace mailbox credentials work for both halves of the loop:
 * SMTP (sending) and IMAP (reading replies). Sends nothing.
 *
 *   pnpm tsx scripts/check-mailbox.ts --env /home/ec2-user/growth/.env.production [--send-test you@example.com]
 *
 * --send-test sends one email as GROWTH_FROM_NAME <GROWTH_FROM_EMAIL>. Check its
 * From line: if Gmail shows the login address instead, the alias is missing
 * from Gmail → Settings → Accounts → "Send mail as".
 */
import { readFileSync } from "fs";

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const i = process.argv.indexOf("--env");
  if (i >= 0) loadEnvFile(process.argv[i + 1]!);

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD not set");
  console.log(`mailbox: ${user}`);
  console.log(`sends as: ${process.env.GROWTH_FROM_NAME ?? "?"} <${process.env.GROWTH_FROM_EMAIL ?? "?"}>`);

  const nodemailer = (await import("nodemailer")).default;
  const smtp = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
  });
  try {
    await smtp.verify();
    console.log("SMTP (send): OK");
  } catch (err) {
    console.log(`SMTP (send): FAILED — ${err instanceof Error ? err.message : err}`);
  }

  const t = process.argv.indexOf("--send-test");
  if (t >= 0) {
    const to = process.argv[t + 1]!;
    const from = `${process.env.GROWTH_FROM_NAME ?? ""} <${process.env.GROWTH_FROM_EMAIL ?? user}>`;
    const info = await smtp.sendMail({
      from,
      to,
      subject: "Growth mailbox check",
      text: `Test from Growth. It should show as: ${from}`,
    });
    console.log(`test email sent to ${to} (${info.messageId})`);
  }

  const { ImapFlow } = await import("imapflow");
  const imap = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  try {
    await imap.connect();
    const status = await imap.status("INBOX", { messages: true });
    console.log(`IMAP (read replies): OK — ${status.messages ?? 0} messages in INBOX`);
    await imap.logout();
  } catch (err) {
    console.log(`IMAP (read replies): FAILED — ${err instanceof Error ? err.message : err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
