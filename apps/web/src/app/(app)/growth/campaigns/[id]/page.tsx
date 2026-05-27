import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateCampaignStatusAction, pauseCampaignAction } from "@/lib/actions/campaigns";
import { CampaignStatus } from "@prisma/client";

interface Props { params: Promise<{ id: string }> }

export default async function CampaignDetailPage({ params }: Props) {
  await requireOrgContext();
  const { id } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      sequenceSteps: { orderBy: { stepNumber: "asc" } },
      _count: { select: { outreaches: true } },
    },
  });

  if (!campaign) notFound();

  async function activateCampaign() {
    "use server";
    await updateCampaignStatusAction(id, CampaignStatus.ACTIVE);
  }

  async function pauseCampaign() {
    "use server";
    await pauseCampaignAction(id);
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
