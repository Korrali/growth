import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateCampaignStatusAction, pauseCampaignAction, updateCampaignClientAction } from "@/lib/actions/campaigns";
import { CampaignStatus } from "@prisma/client";

interface Props { params: Promise<{ id: string }> }

export default async function CampaignDetailPage({ params }: Props) {
  await requireOrgContext();
  const { id } = await params;

  const [campaign, clients] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id },
      include: {
        sequenceSteps: { orderBy: { stepNumber: "asc" } },
        _count: { select: { outreaches: true } },
        client: { select: { id: true, name: true } },
      },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  if (!campaign) notFound();

  async function activateCampaign() {
    "use server";
    await updateCampaignStatusAction(id, CampaignStatus.ACTIVE);
  }

  async function pauseCampaign() {
    "use server";
    await pauseCampaignAction(id);
  }

  async function handleClientUpdate(formData: FormData) {
    "use server";
    await updateCampaignClientAction(id, formData);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="accent">{campaign.product}</Badge>
            <Badge variant="default">{campaign.status}</Badge>
            {campaign.testMode && <Badge variant="warning">test mode</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {campaign.status === "DRAFT" || campaign.status === "PAUSED" ? (
            <form action={activateCampaign}>
              <Button type="submit" size="sm">Activate</Button>
            </form>
          ) : campaign.status === "ACTIVE" ? (
            <form action={pauseCampaign}>
              <Button type="submit" variant="outline" size="sm">Pause</Button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <div><span className="text-muted-foreground">Daily limit:</span> {campaign.dailyLimit}</div>
        <div><span className="text-muted-foreground">Per-domain:</span> {campaign.perDomainLimit}</div>
        <div><span className="text-muted-foreground">Max follow-ups:</span> {campaign.maxFollowUps}</div>
        <div><span className="text-muted-foreground">Send window:</span> {campaign.sendWindowStart}:00–{campaign.sendWindowEnd}:00</div>
        <div><span className="text-muted-foreground">Timezone:</span> {campaign.timezone}</div>
        <div><span className="text-muted-foreground">Outreaches:</span> {campaign._count.outreaches}</div>
      </div>

      {/* Client config */}
      <Card>
        <CardHeader><CardTitle>Client config</CardTitle></CardHeader>
        <CardContent>
          <form action={handleClientUpdate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="clientId">Client</Label>
              <select
                id="clientId"
                name="clientId"
                defaultValue={campaign.client?.id ?? ""}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              >
                <option value="">(none — internal campaign)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Link this campaign to a client to enable per-client sending identity and reply forwarding.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fromName">From name override</Label>
                <input
                  id="fromName"
                  name="fromName"
                  defaultValue={campaign.fromName ?? ""}
                  placeholder="John from Acme (leave blank to use client default)"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fromEmail">From email override</Label>
                <input
                  id="fromEmail"
                  name="fromEmail"
                  type="email"
                  defaultValue={campaign.fromEmail ?? ""}
                  placeholder="john@getacme.com (leave blank to use client default)"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="replyForwardTo">Forward INTERESTED replies to</Label>
              <input
                id="replyForwardTo"
                name="replyForwardTo"
                type="email"
                defaultValue={campaign.replyForwardTo ?? ""}
                placeholder="founder@client.com (leave blank to skip forwarding)"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
              <p className="text-xs text-muted-foreground">Overrides the client&apos;s contactEmail for this specific campaign.</p>
            </div>
            <SubmitButton loadingLabel="Saving…">Save client config</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sequence steps ({campaign.sequenceSteps.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {campaign.sequenceSteps.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No sequence steps defined.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Step</th>
                  <th className="px-4 py-3 font-medium">Delay</th>
                  <th className="px-4 py-3 font-medium">Subject template</th>
                  <th className="px-4 py-3 font-medium">CTA</th>
                </tr>
              </thead>
              <tbody>
                {campaign.sequenceSteps.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-6 py-2.5 tabular-nums font-medium">{s.stepNumber}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">Day {s.delayDays}</td>
                    <td className="px-4 py-2.5">{s.subjectTemplate}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{s.ctaType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
