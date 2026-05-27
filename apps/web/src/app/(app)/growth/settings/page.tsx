import { requireOrgContext } from "@/lib/org-context";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { globalEmergencyStopAction } from "@/lib/actions/campaigns";
import { addEmailSuppression, addDomainSuppression } from "@/lib/sending/suppression";
import { SuppressionReason } from "@prisma/client";

export default async function SettingsPage() {
  await requireOrgContext();

  const [settings, suppressions] = await Promise.all([
    prisma.growthSettings.findUnique({ where: { id: "global" } }),
    prisma.suppression.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  const inboundDomain = process.env.RESEND_INBOUND_DOMAIN ?? "reply.outreach.korrali.com";
  const appUrl = process.env.APP_URL ?? "(not set)";

  async function addSuppression(formData: FormData) {
    "use server";
    const value = (formData.get("value") as string)?.trim().toLowerCase();
    const type = formData.get("type") as string;
    if (!value) return;
    if (type === "domain") {
      await addDomainSuppression(value, SuppressionReason.MANUAL);
    } else {
      await addEmailSuppression(value, SuppressionReason.MANUAL);
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      </div>

      {/* Emergency stop */}
      <Card>
        <CardHeader>
          <CardTitle>Global emergency stop</CardTitle>
          <CardDescription>
            Halts all outbound sends immediately. Current status:{" "}
            <span className={settings?.globalEmergencyStop ? "text-destructive font-medium" : "text-success font-medium"}>
              {settings?.globalEmergencyStop ? "ACTIVE (no emails can send)" : "off"}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!settings?.globalEmergencyStop ? (
            <form action={globalEmergencyStopAction}>
              <Button type="submit" variant="destructive" size="sm">
                Activate emergency stop
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Emergency stop is active. To resume sending, update GrowthSettings in the database and set globalEmergencyStop = false.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Inbound webhook info */}
      <Card>
        <CardHeader>
          <CardTitle>Inbound webhook</CardTitle>
          <CardDescription>Register this URL in Resend for inbound replies.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><span className="text-muted-foreground">Inbound MX domain:</span> <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{inboundDomain}</code></p>
          <p><span className="text-muted-foreground">Inbound webhook URL:</span> <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{appUrl}/api/email/inbound</code></p>
          <p><span className="text-muted-foreground">Bounce webhook URL:</span> <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{appUrl}/api/email/webhook</code></p>
        </CardContent>
      </Card>

      {/* Model env vars */}
      <Card>
        <CardHeader>
          <CardTitle>AI model routing</CardTitle>
          <CardDescription>Change via environment variables on the server. Requires restart.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-1.5 font-mono">
          {[
            ["BULK_MODEL", process.env.BULK_MODEL ?? "(default: haiku)"],
            ["WRITING_MODEL", process.env.WRITING_MODEL ?? "(default: haiku)"],
            ["HIGH_INTENT_MODEL", process.env.HIGH_INTENT_MODEL ?? "(default: haiku)"],
          ].map(([k, v]) => (
            <p key={k}>
              <span className="text-muted-foreground">{k}=</span>
              <span className="text-foreground">{v}</span>
            </p>
          ))}
        </CardContent>
      </Card>

      {/* Suppression list */}
      <Card>
        <CardHeader>
          <CardTitle>Suppression list ({suppressions.length})</CardTitle>
          <CardDescription>Emails and domains that will never receive outbound messages.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={addSuppression} className="flex items-center gap-2">
            <select name="type" className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="email">Email</option>
              <option value="domain">Domain</option>
            </select>
            <input
              name="value"
              type="text"
              placeholder="user@example.com or example.com"
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <SubmitButton size="sm" loadingLabel="Adding…">Add</SubmitButton>
          </form>

          {suppressions.length > 0 && (
            <table className="w-full text-sm">
              <tbody>
                {suppressions.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{s.value}</td>
                    <td className="py-2 text-muted-foreground">{s.type}</td>
                    <td className="py-2 text-muted-foreground text-xs">{s.reason}</td>
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
