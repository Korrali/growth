import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export default async function CallsPage() {
  await requireOrgContext();

  const calls = await prisma.call.findMany({
    orderBy: { scheduledAt: "desc" },
    take: 100,
    include: {
      contact: true,
      company: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Calls</h1>
        <p className="mt-1 text-sm text-muted-foreground">{calls.length} total</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {calls.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground text-center">No calls logged yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Brief</th>
                  <th className="px-4 py-3 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-6 py-2.5">
                      <Link href={`/growth/calls/${c.id}`} className="font-medium hover:underline">
                        {[c.contact.firstName, c.contact.lastName].filter(Boolean).join(" ") || c.contact.email}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.company?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {c.scheduledAt ? formatDate(c.scheduledAt) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {c.brief ? <span className="text-success">ready</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {c.followUpEmail ? <span className="text-success">ready</span> : <span className="text-muted-foreground">—</span>}
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
