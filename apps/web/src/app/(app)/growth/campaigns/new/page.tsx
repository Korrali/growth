import { requireOrgContext } from "@/lib/org-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label } from "@/components/ui/label";
import { createCampaignAction } from "@/lib/actions/campaigns";
import { redirect } from "next/navigation";

export default async function NewCampaignPage() {
  await requireOrgContext();

  async function handleCreate(formData: FormData) {
    "use server";
    await createCampaignAction(formData);
    redirect("/growth/campaigns");
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">New campaign</h1>

      <Card>
        <CardHeader><CardTitle>Campaign details</CardTitle></CardHeader>
        <CardContent>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Campaign name</Label>
              <input
                id="name"
                name="name"
                required
                placeholder="Enterprise Security Buyers"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product">Product</Label>
              <select
                id="product"
                name="product"
                required
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              >
                <option value="">Select product</option>
                <option value="TRUST">Korrali Trust</option>
                <option value="REVENUE">Korrali Revenue</option>
              </select>
            </div>
            <SubmitButton loadingLabel="Creating…">Create campaign</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
