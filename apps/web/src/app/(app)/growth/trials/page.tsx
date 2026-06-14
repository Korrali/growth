import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

const RISK_VARIANTS: Record<string, string> = {
  CRITICAL: "destructive",
  HIGH: "warning",
  MEDIUM: "warning",
  LOW: "success",
  UNKNOWN: "default",
};

const STATUS_VARIANTS: Record<string, string> = {
  ACTIVE: "accent",
  CONVERTED: "success",
  CHURNED: "destructive",
  EXPIRED: "secondary",
};

export default async function TrialsPage() {
  await requireOrgContext();

  const [trials, funnelCounts] = await Promise.all([
    prisma.trial.findMany({
      orderBy: [
        { status: "asc" },
        { activationRisk: "desc" },
        { trialStartedAt: "asc" },
      ],
    }),
    prisma.trial.groupBy({
      by: ["status"],
      _count: true,
    }),
  ]);

  const byStatus = Object.fromEntries(funnelCounts.map((r) => [r.status, r._count]));
  const total = trials.length;
  const converted = byStatus["CONVERTED"] ?? 0;
  const active = byStatus["ACTIVE"] ?? 0;
  const atRisk = trials.filter(
    (t) => t.status === "ACTIVE" && (t.activationRisk === "HIGH" || t.activationRisk === "CRITICAL")
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Trial Funnel</h1>
        <p className="mt-1 text-sm text-muted-foreground">Signup source → activation → intervention → conversion</p>
      </div>

      {/* Funnel summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total trials", value: total, sub: "all time" },
          { label: "Active", value: active, sub: "in trial now" },
          { label: "At risk", value: atRisk, sub: "high/critical activation risk" },
          { label: "Converted", value: converted, sub: `${total > 0 ? Math.round((converted / total) * 100) : 0}% conversion rate` },
        ].map(({ label, value, sub }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-2xl font-bold tabular-nums">{value}</p>
              <p className="text-xs font-medium text-foreground mt-0.5">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {trials.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground text-center">No trials yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Activation</th>
                  <th className="px-4 py-3 font-medium">Interventions</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => {
                  const trustSignals = [
                    { label: "Login", ok: t.hasLogin },
                    { label: "KB", ok: t.hasKbFacts },
                    { label: "Q", ok: t.hasAnsweredQ },
                    { label: "Page", ok: t.hasTrustPage },
                  ];
                  const revSignals = [
                    { label: "Stripe", ok: t.hasStripeConnected },
                    { label: "Anomaly", ok: t.hasSeenAnomaly },
                  ];
                  const loginSignals = [{ label: "Login", ok: t.hasLogin }];
                  const signals =
                    t.product === "TRUST" ? trustSignals :
                    t.product === "REVENUE" ? revSignals :
                    loginSignals;

                  const activatedCount = signals.filter((s) => s.ok).length;
                  const activationPct = Math.round((activatedCount / signals.length) * 100);

                  return (
                    <tr key={t.id} className={`border-t border-border hover:bg-muted/30 ${t.status === "CONVERTED" ? "bg-success/5" : ""}`}>
                      <td className="px-6 py-2.5">
                        <Link href={`/growth/trials/${t.id}`} className="font-medium hover:underline">
                          {t.companyName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{t.contactEmail}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="accent">{t.product}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[120px] truncate">
                        {t.acquisitionSource ?? "organic"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {signals.map((s) => (
                              <span
                                key={s.label}
                                title={s.label}
                                className={`text-xs px-1 rounded ${s.ok ? "bg-success/15 text-success font-medium" : "bg-muted text-muted-foreground"}`}
                              >
                                {s.label}
                              </span>
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">{activationPct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-sm">{t.interventionsSent}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={STATUS_VARIANTS[t.status] as never ?? "default"}>
                          {t.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(t.trialStartedAt)}</td>
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
