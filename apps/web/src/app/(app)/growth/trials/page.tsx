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

export default async function TrialsPage() {
  await requireOrgContext();

  const trials = await prisma.trial.findMany({
    where: { status: "ACTIVE" },
    orderBy: [
      { activationRisk: "desc" },
      { trialStartedAt: "asc" },
    ],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Trials</h1>
        <p className="mt-1 text-sm text-muted-foreground">{trials.length} active</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {trials.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted-foreground text-center">No active trials.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-6 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Risk</th>
                  <th className="px-4 py-3 font-medium">Activation signals</th>
                  <th className="px-4 py-3 font-medium">Interventions</th>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Ends</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => {
                  const trustSignals = [
                    { label: "Login", ok: t.hasLogin },
                    { label: "KB facts", ok: t.hasKbFacts },
                    { label: "Questionnaire", ok: t.hasAnsweredQ },
                    { label: "Trust page", ok: t.hasTrustPage },
                  ];
                  const revSignals = [
                    { label: "Stripe connected", ok: t.hasStripeConnected },
                    { label: "Anomaly seen", ok: t.hasSeenAnomaly },
                  ];
                  const loginSignals = [{ label: "Login", ok: t.hasLogin }];
                  const signals =
                    t.product === "TRUST" ? trustSignals :
                    t.product === "REVENUE" ? revSignals :
                    loginSignals;

                  return (
                    <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-6 py-2.5">
                        <Link href={`/growth/trials/${t.id}`} className="font-medium hover:underline">
                          {t.companyName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{t.contactEmail}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="accent">{t.product}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={RISK_VARIANTS[t.activationRisk] as never ?? "default"}>
                          {t.activationRisk}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1 flex-wrap">
                          {signals.map((s) => (
                            <span key={s.label} className={`text-xs ${s.ok ? "text-success" : "text-muted-foreground line-through"}`}>
                              {s.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{t.interventionsSent}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{formatDate(t.trialStartedAt)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{formatDate(t.trialEndsAt)}</td>
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
