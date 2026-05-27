import { requireOrgContext } from "@/lib/org-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { importCompaniesAction } from "@/lib/actions/import";
import { redirect } from "next/navigation";

export default async function ImportPage() {
  await requireOrgContext();

  async function handleImport(formData: FormData) {
    "use server";
    const summary = await importCompaniesAction(formData);
    redirect(`/growth/companies?imported=${summary.inserted}&skipped=${summary.skippedDuplicates + summary.skippedInvalid}`);
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import companies</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a CSV with columns: name, domain (or website), industry, employee_count, description
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
          <CardDescription>
            Duplicates (by domain) are automatically skipped. Rows missing name or domain are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handleImport} className="space-y-4">
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-foreground hover:file:bg-secondary/80"
            />
            <SubmitButton loadingLabel="Importing…">Import</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
