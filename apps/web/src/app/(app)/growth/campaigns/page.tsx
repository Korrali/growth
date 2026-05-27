import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function CampaignsPage() {
  await requireOrgContext();

  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { outreaches: true, sequenceSteps: true } },
    },
  });

  const statusColors: Record<string, string> = {
    DRAFT: "default",
    ACTIVE: "success",
    PAUSED: "warning",
    COMPLETED: "outline",
    ARCHIVED: "outline",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">{campaigns.length} total</p>
        </div>
        <Link href="/growth/campaigns/new">
          <Button size="sm">New campaign</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          {campaigns.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground text-center">No campaigns yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Steps</th>
                  <th className="px-4 py-3 font-medium">Outreaches</th>
                  <th className="px-4 py-3 font-medium">Test mode</th>
                  <th className="px-4 py-3 font-medium">Limits</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-6 py-2.5">
                      <Link href={`/growth/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="accent">{c.product}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={statusColors[c.status] as never ?? "default"}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{c._count.sequenceSteps}</td>
                    <td className="px-4 py-2.5 tabular-nums">{c._count.outreaches}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {c.testMode ? <span className="text-warning font-medium">ON</span> : <span className="text-success">off</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {c.dailyLimit}/day · {c.perDomainLimit}/domain
                    </td>
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
