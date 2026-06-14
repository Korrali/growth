import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateClientAction, updateClientStatusAction } from "@/lib/actions/clients";
import { ClientStatus } from "@prisma/client";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Props { params: Promise<{ id: string }> }

const inputCls =
  "flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default async function ClientDetailPage({ params }: Props) {
  await requireOrgContext();
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      campaigns: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { outreaches: true } } },
      },
    },
  });

  if (!client) notFound();

  // Last 10 INTERESTED replies for this client
  const interestedReplies = await prisma.$queryRaw<{
    messageId: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    companyName: string | null;
    title: string | null;
    founderDraft: string | null;
    body: string;
    sentAt: Date | null;
    campaignName: string;
  }[]>`
    SELECT
      em.id AS "messageId",
      ct."firstName",
      ct."lastName",
      ct.email,
      co.name AS "companyName",
      ct.title,
      rc."founderDraft",
      em.body,
      em."sentAt",
      camp.name AS "campaignName"
    FROM "ReplyClassification" rc
    JOIN "EmailMessage" em ON em.id = rc."messageId"
    JOIN "Contact" ct ON ct.id = em."contactId"
    LEFT JOIN "Company" co ON co.id = ct."companyId"
    JOIN "Outreach" o ON o.id = em."outreachId"
    JOIN "Campaign" camp ON camp.id = o."campaignId"
    WHERE camp."clientId" = ${id}
    AND rc.category = 'INTERESTED'
    ORDER BY em."sentAt" DESC NULLS LAST
    LIMIT 10
  `;

  async function handleUpdate(formData: FormData) {
    "use server";
    await updateClientAction(id, formData);
  }

  async function handleActivate() {
    "use server";
    await updateClientStatusAction(id, ClientStatus.ACTIVE);
  }

  async function handlePause() {
    "use server";
    await updateClientStatusAction(id, ClientStatus.PAUSED);
  }

  async function handleChurn() {
    "use server";
    await updateClientStatusAction(id, ClientStatus.CHURNED);
  }

  const statusColors: Record<string, string> = {
    ACTIVE: "success",
    PAUSED: "warning",
    CHURNED: "outline",
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/growth/clients" className="text-sm text-muted-foreground hover:underline">
              Clients
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusColors[client.status] as never ?? "default"}>{client.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {client.plan === "RETAINER" ? "Retainer" : "Pay-per-meeting"}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {client.status !== "ACTIVE" && (
            <form action={handleActivate}>
              <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                Activate
              </button>
            </form>
          )}
          {client.status === "ACTIVE" && (
            <form action={handlePause}>
              <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                Pause
              </button>
            </form>
          )}
          {client.status !== "CHURNED" && (
            <form action={handleChurn}>
              <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">
                Mark churned
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Edit form */}
      <form action={handleUpdate} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Client info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Company name</Label>
                <input id="name" name="name" required defaultValue={client.name} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactEmail">Notification email</Label>
                <input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  required
                  defaultValue={client.contactEmail}
                  className={inputCls}
                />
                <p className="text-xs text-muted-foreground">INTERESTED replies are forwarded here.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan">Pricing model</Label>
                <select id="plan" name="plan" required defaultValue={client.plan} className={inputCls + " h-9"}>
                  <option value="RETAINER">Retainer ($X setup + $Y/mo)</option>
                  <option value="PAY_PER_MEETING">Pay-per-meeting ($X setup + $Y/meeting)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <select id="status" name="status" required defaultValue={client.status} className={inputCls + " h-9"}>
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused</option>
                  <option value="CHURNED">Churned</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="setupFeeUsd">Setup fee ($)</Label>
                <input id="setupFeeUsd" name="setupFeeUsd" type="number" min="0" defaultValue={client.setupFeeUsd} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monthlyFeeUsd">Monthly fee ($)</Label>
                <input id="monthlyFeeUsd" name="monthlyFeeUsd" type="number" min="0" defaultValue={client.monthlyFeeUsd} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perMeetingFeeUsd">Per-meeting fee ($)</Label>
                <input id="perMeetingFeeUsd" name="perMeetingFeeUsd" type="number" min="0" defaultValue={client.perMeetingFeeUsd} className={inputCls} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="stripeCustomerId">Stripe customer ID</Label>
                <input id="stripeCustomerId" name="stripeCustomerId" defaultValue={client.stripeCustomerId ?? ""} placeholder="cus_..." className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stripeSubscriptionId">Stripe subscription ID</Label>
                <input id="stripeSubscriptionId" name="stripeSubscriptionId" defaultValue={client.stripeSubscriptionId ?? ""} placeholder="sub_..." className={inputCls} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Email identity</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fromName">From name</Label>
                <input id="fromName" name="fromName" required defaultValue={client.fromName} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fromEmail">From email</Label>
                <input id="fromEmail" name="fromEmail" type="email" required defaultValue={client.fromEmail} className={inputCls} />
                <p className="text-xs text-muted-foreground">Must be a verified sender in Resend.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inboundDomain">Inbound reply domain (optional)</Label>
              <input
                id="inboundDomain"
                name="inboundDomain"
                defaultValue={client.inboundDomain ?? ""}
                placeholder="reply.getacme.com  (leave blank to use shared reply.outreach.korrali.com)"
                className={inputCls}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>ICP profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="icpProfile">Ideal Customer Profile</Label>
              <textarea
                id="icpProfile"
                name="icpProfile"
                required
                rows={6}
                defaultValue={client.icpProfile}
                className={inputCls + " resize-y"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Internal notes (optional)</Label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                defaultValue={client.notes ?? ""}
                className={inputCls + " resize-y"}
              />
            </div>
          </CardContent>
        </Card>

        <SubmitButton loadingLabel="Saving…">Save changes</SubmitButton>
      </form>

      {/* Campaigns */}
      <Card>
        <CardHeader><CardTitle>Campaigns ({client.campaigns.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {client.campaigns.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No campaigns linked to this client yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Outreaches</th>
                </tr>
              </thead>
              <tbody>
                {client.campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-6 py-2.5">
                      <Link href={`/growth/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="default">{c.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{c._count.outreaches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* INTERESTED reply feed */}
      {interestedReplies.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent interested replies ({interestedReplies.length})</CardTitle></CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {interestedReplies.map((r) => (
              <div key={r.messageId} className="px-6 py-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">
                      {r.firstName ?? ""} {r.lastName ?? ""}{" "}
                      <span className="text-muted-foreground font-normal">({r.email})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.companyName ?? "unknown"} · {r.title ?? "unknown title"} · {r.campaignName}
                    </p>
                  </div>
                  {r.sentAt && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.sentAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-3">{r.body}</p>
                {r.founderDraft && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      AI draft response
                    </summary>
                    <p className={cn("mt-1.5 rounded-md bg-muted px-3 py-2 whitespace-pre-wrap")}>
                      {r.founderDraft}
                    </p>
                  </details>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
