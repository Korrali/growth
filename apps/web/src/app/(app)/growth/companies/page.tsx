import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { triggerBulkScoreAction } from "@/lib/actions/scoring";

export default async function CompaniesPage() {
  await requireOrgContext();

  const companies = await prisma.company.findMany({
    orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  async function bulkScore(formData: FormData) {
    "use server";
    const ids = companies.filter((c) => !c.fitScore).map((c) => c.id);
    await triggerBulkScoreAction(ids);
  }

  const fitColors: Record<string, string> = {
    TRUST: "accent",
    REVENUE: "success",
    BOTH: "warning",
    REJECT: "destructive",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Companies</h1>
          <p className="mt-1 text-sm text-muted-foreground">{companies.length} total</p>
        </div>
        <div className="flex gap-2">
          <form action={bulkScore}>
            <Button type="submit" variant="outline" size="sm">Score unscored</Button>
          </form>
          <Link href="/growth/companies/import">
            <Button size="sm">Import CSV</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {companies.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground text-center">
              No companies yet. Import a CSV to get started.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">Industry</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Pain</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-6 py-2.5">
                      <Link href={`/growth/companies/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{c.domain}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.industry ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {c.fitScore != null ? (
                        <span className={`font-bold tabular-nums ${c.fitScore >= 7 ? "text-success" : c.fitScore >= 5 ? "text-warning" : "text-destructive"}`}>
                          {c.fitScore}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {c.fitProduct ? (
                        <Badge variant={fitColors[c.fitProduct] as never ?? "default"}>
                          {c.fitProduct}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">
                      {c.painHypothesis ?? "—"}
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
