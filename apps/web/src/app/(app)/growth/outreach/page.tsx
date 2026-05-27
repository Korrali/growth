import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { timeAgo } from "@/lib/utils";
import { stopOutreachAction } from "@/lib/actions/outreach";

export default async function OutreachPage() {
  await requireOrgContext();

  const outreaches = await prisma.outreach.findMany({
    where: { status: { in: ["ACTIVE", "PENDING", "REPLIED"] } },
    orderBy: [{ status: "asc" }, { nextSendAt: "asc" }],
    take: 200,
    include: {
      contact: true,
      campaign: { select: { name: true, product: true } },
      company: { select: { name: true } },
    },
  });

  const statusColors: Record<string, string> = {
    PENDING: "default",
    ACTIVE: "success",
    REPLIED: "accent",
    COMPLETED: "outline",
    STOPPED: "destructive",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Active outreach</h1>
        <p className="mt-1 text-sm text-muted-foreground">{outreaches.length} in progress</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {outreaches.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground text-center">No active outreaches.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Step</th>
                  <th className="px-4 py-3 font-medium">Next send</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {outreaches.map((o) => (
                  <tr key={o.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-6 py-2.5">
                      <p className="font-medium">{[o.contact.firstName, o.contact.lastName].filter(Boolean).join(" ") || o.contact.email}</p>
                      {o.company && <p className="text-xs text-muted-foreground">{o.company.name}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <p>{o.campaign.name}</p>
                      <Badge variant="accent" className="mt-0.5">{o.campaign.product}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={statusColors[o.status] as never ?? "default"}>{o.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{o.currentStep}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {o.nextSendAt ? timeAgo(o.nextSendAt) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <form action={stopOutreachAction.bind(null, o.id)}>
                        <button type="submit" className="text-xs text-destructive hover:underline">Stop</button>
                      </form>
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
