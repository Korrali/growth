import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default async function ClientsPage() {
  await requireOrgContext();

  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      campaigns: {
        include: {
          _count: { select: { outreaches: true } },
        },
      },
    },
  });

  // Count INTERESTED replies per client via campaigns
  const clientIds = clients.map((c) => c.id);
  const interestedCounts = await prisma.$queryRaw<{ clientId: string; cnt: bigint }[]>`
    SELECT c."clientId", COUNT(rc.id) AS cnt
    FROM "ReplyClassification" rc
    JOIN "EmailMessage" em ON em.id = rc."messageId"
    JOIN "Outreach" o ON o.id = em."outreachId"
    JOIN "Campaign" c ON c.id = o."campaignId"
    WHERE c."clientId" = ANY(${clientIds})
    AND rc.category = 'INTERESTED'
    GROUP BY c."clientId"
  `;
  const interestedByClient = new Map(interestedCounts.map((r) => [r.clientId, Number(r.cnt)]));

  const statusColors: Record<string, string> = {
    ACTIVE: "success",
    PAUSED: "warning",
    CHURNED: "outline",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {clients.length} client{clients.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link href="/growth/clients/new">
          <Button size="sm">Add client</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          {clients.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">No clients yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add your first DFY client to start running outreach on their behalf.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Campaigns</th>
                  <th className="px-4 py-3 font-medium">Outreaches</th>
                  <th className="px-4 py-3 font-medium">Interested</th>
                  <th className="px-4 py-3 font-medium">Fees</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const totalOutreaches = client.campaigns.reduce(
                    (sum, c) => sum + c._count.outreaches,
                    0,
                  );
                  const interested = interestedByClient.get(client.id) ?? 0;
                  return (
                    <tr key={client.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-6 py-2.5">
                        <Link
                          href={`/growth/clients/${client.id}`}
                          className="font-medium hover:underline"
                        >
                          {client.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{client.contactEmail}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {client.plan === "RETAINER" ? "Retainer" : "Pay-per-meeting"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={statusColors[client.status] as never ?? "default"}>
                          {client.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{client.campaigns.length}</td>
                      <td className="px-4 py-2.5 tabular-nums">{totalOutreaches}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        <span className={cn("font-medium", interested > 0 && "text-success")}>
                          {interested}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {client.plan === "RETAINER"
                          ? `$${client.setupFeeUsd} setup · $${client.monthlyFeeUsd}/mo`
                          : `$${client.setupFeeUsd} setup · $${client.perMeetingFeeUsd}/meeting`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
