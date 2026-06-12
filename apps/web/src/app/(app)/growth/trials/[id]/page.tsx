import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

const RISK_VARIANTS: Record<string, string> = {
  CRITICAL: "destructive",
  HIGH: "warning",
  MEDIUM: "warning",
  LOW: "success",
  UNKNOWN: "default",
};

interface Props { params: Promise<{ id: string }> }

export default async function TrialDetailPage({ params }: Props) {
  await requireOrgContext();
  const { id } = await params;

  const trial = await prisma.trial.findUnique({ where: { id } });
  if (!trial) notFound();

  const logs = await prisma.auditLog.findMany({
    where: { entity: "Trial", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{trial.companyName}</h1>
        <p className="text-sm text-muted-foreground">{trial.contactEmail}</p>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="accent">{trial.product}</Badge>
        <Badge variant={RISK_VARIANTS[trial.activationRisk] as never ?? "default"}>{trial.activationRisk}</Badge>
        <Badge variant="default">{trial.status}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle>Activation signals</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {trial.product === "TRUST" ? (
            <>
              <SignalRow label="Login" ok={trial.hasLogin} />
              <SignalRow label="Knowledge base facts added" ok={trial.hasKbFacts} />
              <SignalRow label="Questionnaire answered" ok={trial.hasAnsweredQ} />
              <SignalRow label="Trust page published" ok={trial.hasTrustPage} />
            </>
          ) : trial.product === "REVENUE" ? (
            <>
              <SignalRow label="Stripe connected" ok={trial.hasStripeConnected} />
              <SignalRow label="Anomaly detected" ok={trial.hasSeenAnomaly} />
            </>
          ) : (
            <SignalRow label="Login" ok={trial.hasLogin} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <p><span className="text-muted-foreground">Trial started:</span> {formatDate(trial.trialStartedAt)}</p>
          <p><span className="text-muted-foreground">Trial ends:</span> {formatDate(trial.trialEndsAt)}</p>
          <p><span className="text-muted-foreground">Interventions sent:</span> {trial.interventionsSent}</p>
        </CardContent>
      </Card>

      {logs.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Intervention log</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-6 py-2 text-xs text-muted-foreground">{formatDate(l.createdAt)}</td>
                    <td className="px-4 py-2">{l.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SignalRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={ok ? "text-success" : "text-muted-foreground"}>
        {ok ? "✓" : "○"}
      </span>
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
