import { requireOrgContext } from "@/lib/org-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { createClientAction } from "@/lib/actions/clients";
import { redirect } from "next/navigation";

const inputCls =
  "flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default async function NewClientPage() {
  await requireOrgContext();

  async function handleCreate(formData: FormData) {
    "use server";
    const id = await createClientAction(formData);
    redirect(`/growth/clients/${id}`);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Add client</h1>

      <form action={handleCreate} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Client info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Company name</Label>
                <input id="name" name="name" required placeholder="Acme Corp" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactEmail">Notification email</Label>
                <input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  required
                  placeholder="founder@acme.com"
                  className={inputCls}
                />
                <p className="text-xs text-muted-foreground">
                  INTERESTED replies are forwarded here.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan">Pricing model</Label>
                <select id="plan" name="plan" required className={inputCls + " h-9"}>
                  <option value="">Select plan</option>
                  <option value="RETAINER">Retainer ($X setup + $Y/mo)</option>
                  <option value="PAY_PER_MEETING">Pay-per-meeting ($X setup + $Y/meeting)</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="setupFeeUsd">Setup fee ($)</Label>
                <input
                  id="setupFeeUsd"
                  name="setupFeeUsd"
                  type="number"
                  min="0"
                  defaultValue="1500"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="monthlyFeeUsd">Monthly fee ($)</Label>
                <input
                  id="monthlyFeeUsd"
                  name="monthlyFeeUsd"
                  type="number"
                  min="0"
                  defaultValue="500"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perMeetingFeeUsd">Per-meeting fee ($)</Label>
                <input
                  id="perMeetingFeeUsd"
                  name="perMeetingFeeUsd"
                  type="number"
                  min="0"
                  defaultValue="150"
                  className={inputCls}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Email identity</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fromName">From name</Label>
                <input
                  id="fromName"
                  name="fromName"
                  required
                  placeholder="John from Acme"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fromEmail">From email</Label>
                <input
                  id="fromEmail"
                  name="fromEmail"
                  type="email"
                  required
                  placeholder="john@getacme.com"
                  className={inputCls}
                />
                <p className="text-xs text-muted-foreground">
                  Must be a verified sender in Resend.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inboundDomain">Inbound reply domain (optional)</Label>
              <input
                id="inboundDomain"
                name="inboundDomain"
                placeholder="reply.getacme.com  (leave blank to use shared reply.outreach.korrali.com)"
                className={inputCls}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>ICP profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="icpProfile">Ideal Customer Profile</Label>
              <textarea
                id="icpProfile"
                name="icpProfile"
                required
                rows={6}
                placeholder="Describe the client's ICP: who are they targeting, what pain do they solve, what signals indicate a good fit, who to reject..."
                className={inputCls + " resize-y"}
              />
              <p className="text-xs text-muted-foreground">
                Injected into the email generator so every sequence is written for this client's product, not Korrali's.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Internal notes (optional)</Label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                placeholder="Call notes, onboarding details, special instructions..."
                className={inputCls + " resize-y"}
              />
            </div>
          </CardContent>
        </Card>

        <SubmitButton loadingLabel="Creating…">Create client</SubmitButton>
      </form>
    </div>
  );
}
