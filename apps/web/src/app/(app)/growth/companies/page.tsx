import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { triggerBulkScoreAction } from "@/lib/actions/scoring";
import { enqueueCompanyDiscover } from "@/lib/queue";
import { timeAgo } from "@/lib/utils";

export default async function CompaniesPage() {
  await requireOrgContext();

  const [companies, recentRuns] = await Promise.all([
    prisma.company.findMany({
      orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.discoveryRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  async function bulkScore(formData: FormData) {
    "use server";
    const ids = companies.filter((c) => !c.fitScore).map((c) => c.id);
    await triggerBulkScoreAction(ids);
  }

  async function runDiscovery() {
    "use server";
    const run = await prisma.discoveryRun.create({ data: { source: "web_research" } });
    await enqueueCompanyDiscover({ runId: run.id });
  }

  const fitColors: Record<string, string> = {
    TRUST: "accent",
    REVENUE: "success",
    BILLCLEAR: "accent",
    MEDSCAN: "success",
    BOTH: "warning",
    REJECT: "destructive",
  };

  const latestRun = recentRuns[0];
  const runInProgress =
    latestRun &&
    !latestRun.error &&
    latestRun.companiesFound === 0 &&
    Date.now() - latestRun.createdAt.getTime() < 30 * 60 * 1000;

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
            <Button variant="outline" size="sm">Import CSV</Button>
          </Link>
          <form action={runDiscovery}>
            <Button type="submit" size="sm" disabled={runInProgress}>
              {runInProgress ? "Discovering…" : "Run discovery"}
            </Button>
          </form>
        </div>
      </div>

      {/* Discovery run history */}
      {recentRuns.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Recent discovery runs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Queries</th>
                  <th className="px-4 py-2 font-medium">Found</th>
                  <th className="px-4 py-2 font-medium">New</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => {
                  const isRunning =
                    !run.error &&
                    run.companiesFound === 0 &&
                    Date.now() - run.createdAt.getTime() < 30 * 60 * 1000;
                  return (
                    <tr key={run.id} className="border-t border-border">
                      <td className="px-4 py-2 text-muted-foreground">{timeAgo(run.createdAt)}</td>
                      <td className="px-4 py-2 tabular-nums">{run.queriesRun}</td>
                      <td className="px-4 py-2 tabular-nums">{run.companiesFound}</td>
                      <td className="px-4 py-2 tabular-nums font-medium">{run.companiesNew}</td>
                      <td className="px-4 py-2">
                        {run.error ? (
                          <Badge variant="destructive">Error</Badge>
                        ) : isRunning ? (
                          <Badge variant="warning">Running</Badge>
                        ) : (
                          <Badge variant="default">Done</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {companies.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground text-center">
              No companies yet. Run discovery or import a CSV to get started.
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
                        <span
                          className={`font-bold tabular-nums ${
                            c.fitScore >= 7
                              ? "text-success"
                              : c.fitScore >= 5
                                ? "text-warning"
                                : "text-destructive"
                          }`}
                        >
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
