import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";

export default async function GrowthOverviewPage() {
  await requireOrgContext();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalCompanies,
    scoredCompanies,
    activeCampaigns,
    sendsToday,
    repliesThisWeek,
    interestedLeads,
    trialsAtRisk,
    recentLogs,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { fitScore: { not: null } } }),
    prisma.campaign.count({ where: { status: "ACTIVE" } }),
    prisma.emailMessage.count({ where: { direction: "OUTBOUND", sentAt: { gte: today } } }),
    prisma.emailMessage.count({ where: { direction: "INBOUND", createdAt: { gte: weekAgo } } }),
    prisma.replyClassification.count({ where: { category: "INTERESTED", createdAt: { gte: weekAgo } } }),
    prisma.trial.count({ where: { status: "ACTIVE", activationRisk: { in: ["HIGH", "CRITICAL"] } } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const metrics = [
    { label: "Companies", value: totalCompanies },
    { label: "Scored", value: scoredCompanies },
    { label: "Active campaigns", value: activeCampaigns },
    { label: "Sends today", value: sendsToday },
    { label: "Replies (7d)", value: repliesThisWeek },
    { label: "Interested (7d)", value: interestedLeads },
    { label: "Trials at risk", value: trialsAtRisk },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Growth operations dashboard</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-2xl font-bold tabular-nums">{m.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentLogs.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {recentLogs.map((log) => (
                  <tr key={log.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-6 py-2.5 font-mono text-xs text-muted-foreground w-40">
                      {timeAgo(log.createdAt)}
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">{log.actor}</td>
                    <td className="px-2 py-2.5 font-medium">{log.action}</td>
                    <td className="px-6 py-2.5 text-muted-foreground text-xs">
                      {log.entity}{log.entityId ? ` ${log.entityId.slice(0, 8)}` : ""}
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
