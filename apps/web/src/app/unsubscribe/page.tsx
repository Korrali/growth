import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/sending/unsubscribe-token";
import { addEmailSuppression } from "@/lib/sending/suppression";
import { stopOutreachSequence } from "@/lib/sending/sequence-scheduler";
import { SuppressionReason } from "@prisma/client";

interface Props {
  searchParams: Promise<{ email?: string; token?: string }>;
}

export default async function UnsubscribePage({ searchParams }: Props) {
  const { email: emailB64, token } = await searchParams;

  let email = "";
  let tokenValid = false;

  if (emailB64 && token) {
    try {
      email = Buffer.from(emailB64, "base64url").toString("utf8");
      tokenValid = verifyUnsubscribeToken(email, token);
    } catch {
      tokenValid = false;
    }
  }

  if (!tokenValid) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-lg font-semibold">Invalid link</h1>
          <p className="text-sm text-muted-foreground">
            This unsubscribe link is invalid or has expired. If you&apos;d like to opt out, reply to any email with "unsubscribe" and we&apos;ll remove you immediately.
          </p>
        </div>
      </main>
    );
  }

  async function confirmUnsubscribe() {
    "use server";
    if (!tokenValid || !email) return;

    await addEmailSuppression(email, SuppressionReason.UNSUBSCRIBED);

    await prisma.contact.updateMany({
      where: { email: email.toLowerCase() },
      data: { suppressedAt: new Date(), suppressReason: SuppressionReason.UNSUBSCRIBED },
    });

    const contact = await prisma.contact.findUnique({ where: { email: email.toLowerCase() } });
    if (contact) {
      const activeOutreaches = await prisma.outreach.findMany({
        where: { contactId: contact.id, status: { in: ["ACTIVE", "PENDING"] } },
        select: { id: true },
      });
      for (const o of activeOutreaches) {
        await stopOutreachSequence(o.id, "unsubscribe");
      }
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-lg font-semibold">Unsubscribe</h1>
        <p className="text-sm text-muted-foreground">
          Click below to remove <strong>{email}</strong> from all future emails.
        </p>
        <form action={confirmUnsubscribe}>
          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Confirm unsubscribe
          </button>
        </form>
        <p className="text-xs text-muted-foreground">
          You can always reply to any of our emails instead.
        </p>
      </div>
    </main>
  );
}
