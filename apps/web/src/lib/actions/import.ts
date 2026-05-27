"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { parseCSV, validateCompanyRow, deduplicateByDomain, normalizeDomain } from "@/lib/import/csv-parser";

export interface ImportSummary {
  total: number;
  inserted: number;
  skippedDuplicates: number;
  skippedInvalid: number;
}

export async function importCompaniesAction(formData: FormData): Promise<ImportSummary> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file provided");

  const text = await file.text();
  const { rows: rawRows, errors: parseErrors } = parseCSV(text);

  if (parseErrors.length > 0) {
    console.warn("CSV parse warnings:", parseErrors);
  }

  const existingDomains = await prisma.company
    .findMany({ select: { domain: true } })
    .then((c) => c.map((r) => r.domain));

  const validRows: ReturnType<typeof validateCompanyRow>["data"][] = [];
  let skippedInvalid = 0;

  for (const raw of rawRows) {
    const { valid, data } = validateCompanyRow(raw);
    if (valid) validRows.push(data);
    else skippedInvalid++;
  }

  const { unique, skipped: skippedDuplicates } = deduplicateByDomain(validRows, existingDomains);

  if (unique.length > 0) {
    await prisma.company.createMany({
      data: unique.map((row) => ({
        name: row.name!,
        domain: normalizeDomain(row.domain!),
        website: row.website,
        industry: row.industry,
        employeeCount: row.employeeCount,
        description: row.description,
      })),
      skipDuplicates: true,
    });
  }

  return {
    total: rawRows.length,
    inserted: unique.length,
    skippedDuplicates,
    skippedInvalid,
  };
}
