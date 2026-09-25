import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  markLinkedInSentAction,
  markLinkedInDeadAction,
  generateLinkedInDraftsAction,
} from "@/lib/actions/linkedin";
import { CopyButton } from "@/app/(app)/growth/community/CopyButton";
import { formatDate } from "@/lib/utils";

export default async function LinkedInPage() {
  await requireOrgContext();

  const [pending, sent, replied, totalWithUrl, totalNoDraft] = await Promise.all([
    prisma.linkedInOutreach.findMany({
      where: { status: "PENDING" },
      include: {
        contact: {
          include: {
            company: true,
            _count: { select: { emailMessages: { where: { direction: "OUTBOUND" } } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    prisma.linkedInOutreach.findMany({
      where: { status: "SENT" },
      include: { contact: { include: { company: true } } },
      orderBy: { connectionSentAt: "desc" },
      take: 20,
    }),
    prisma.linkedInOutreach.count({ where: { status: "REPLIED" } }),
    prisma.contact.count({ where: { linkedinUrl: { not: null }, isBuyer: true } }),
    prisma.contact.count({
      where: { linkedinUrl: { not: null }, isBuyer: true, linkedInOutreach: null },
    }),
  ]);

  // People who already got a cold email come first: a connection request
  // right after the email is what lifts replies. Then oldest draft first.
  const queue = [...pending]
    .sort((a, b) => Number(b.contact._count.emailMessages > 0) - Number(a.contact._count.emailMessages > 0))
    .slice(0, 50);
  const emailedWaiting = pending.filter((p) => p.contact._count.emailMessages > 0).length;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">LinkedIn Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending.length} ready to send ({emailedWaiting} already emailed — shown first) · {sent.length} sent · {replied} replied · {totalWithUrl} contacts with URL
          </p>
        </div>
        {totalNoDraft > 0 && (
          <form action={generateLinkedInDraftsAction}>
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Generate drafts ({totalNoDraft})
            </button>
          </form>
        )}
      </div>

      {/* Pending — ready to copy-paste and send */}
      {queue.length > 0 && (
        <section className="space-y-4">
          {queue.map((outreach) => {
            const contact = outreach.contact;
            const company = contact.company;
            return (
              <Card key={outreach.id}>
                <CardContent className="pt-5 pb-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {contact.firstName} {contact.lastName}
                        </span>
                        {contact.title && (
                          <Badge variant="outline">{contact.title}</Badge>
                        )}
                        {company?.name && (
                          <span className="text-xs text-muted-foreground">{company.name}</span>
                        )}
                        {company?.fitProduct && (
                          <Badge variant="default">{company.fitProduct}</Badge>
                        )}
                        {outreach.contact._count.emailMessages > 0 && (
                          <Badge variant="outline">Emailed</Badge>
                        )}
                        {company?.fitScore != null && (
                          <span className="text-xs text-muted-foreground">fit {company.fitScore}/10</span>
                        )}
                      </div>
                      {contact.linkedinUrl && (
                        <a
                          href={contact.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Open LinkedIn profile ↗
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Connection note ({outreach.connectionNoteDraft.length}/300 chars)
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{outreach.connectionNoteDraft}</p>
                      <CopyButton text={outreach.connectionNoteDraft} />
                    </div>

                    <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        First message (after acceptance)
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{outreach.messageDraft}</p>
                      <CopyButton text={outreach.messageDraft} />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <form action={markLinkedInSentAction.bind(null, outreach.id)}>
                      <button
                        type="submit"
                        className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        Mark sent
                      </button>
                    </form>
                    <form action={markLinkedInDeadAction.bind(null, outreach.id)}>
                      <button
                        type="submit"
                        className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        Skip
                      </button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {/* Sent — awaiting acceptance */}
      {sent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sent — awaiting acceptance
          </h2>
          {sent.map((outreach) => {
            const contact = outreach.contact;
            const company = contact.company;
            return (
              <Card key={outreach.id} className="opacity-70">
                <CardContent className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="text-sm font-medium">
                        {contact.firstName} {contact.lastName}
                      </span>
                      {contact.title && (
                        <Badge variant="outline">{contact.title}</Badge>
                      )}
                      {company?.name && (
                        <span className="text-xs text-muted-foreground">{company.name}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      sent {outreach.connectionSentAt ? formatDate(outreach.connectionSentAt) : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {pending.length === 0 && sent.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {totalNoDraft > 0
              ? `${totalNoDraft} contacts are waiting for drafts — click "Generate drafts" above.`
              : "No pending LinkedIn drafts. Drafts are generated daily for contacts marked as buyers with a LinkedIn URL."}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
