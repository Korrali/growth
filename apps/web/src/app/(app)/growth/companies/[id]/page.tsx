import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { triggerSingleScoreAction } from "@/lib/actions/scoring";
import { formatDate } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CompanyDetailPage({ params }: Props) {
  await requireOrgContext();
  const { id } = await params;

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { createdAt: "desc" }, take: 20 },
      outreaches: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { campaign: true },
      },
    },
  });

  if (!company) notFound();

  async function reScore() {
    "use server";
    await triggerSingleScoreAction(id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{company.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">{company.domain}</p>
        </div>
        <div className="flex items-center gap-2">
          {company.fitProduct && (
            <Badge variant="accent">{company.fitProduct}</Badge>
          )}
          {company.fitScore != null && (
            <span className="text-lg font-bold tabular-nums">{company.fitScore}/10</span>
          )}
          <form action={reScore}>
            <Button type="submit" variant="outline" size="sm">Re-score</Button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Fit analysis</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {company.painHypothesis && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pain hypothesis</p>
                <p>{company.painHypothesis}</p>
              </div>
            )}
            {company.trigger && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Trigger</p>
                <p>{company.trigger}</p>
              </div>
            )}
            {company.personalizedObservation && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Observation</p>
                <p>{company.personalizedObservation}</p>
              </div>
            )}
            {company.fitReasoning && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Reasoning</p>
                <p className="text-muted-foreground">{company.fitReasoning}</p>
              </div>
            )}
            {!company.fitScore && (
              <p className="text-muted-foreground">Not yet scored.</p>
            )}
            {company.fitScoredAt && (
              <p className="text-xs text-muted-foreground">Scored {formatDate(company.fitScoredAt)}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Contacts ({company.contacts.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {company.contacts.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No contacts.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {company.contacts.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-6 py-2">
                        <span className="font-medium">{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</span>
                        {c.title && <span className="text-muted-foreground ml-2">{c.title}</span>}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{c.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
