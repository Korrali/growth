import Papa from "papaparse";

export interface CompanyRow {
  name?: string;
  domain?: string;
  website?: string;
  industry?: string;
  employeeCount?: number;
  description?: string;
}

export interface ContactRow {
  email?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  companyDomain?: string;
}

export interface ParseResult<T> {
  rows: T[];
  errors: string[];
}

export function normalizeDomain(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  // Strip protocol
  s = s.replace(/^https?:\/\//, "");
  // Strip www.
  s = s.replace(/^www\./, "");
  // Strip path
  s = s.split("/")[0] ?? "";
  // Strip port
  s = s.split(":")[0] ?? "";
  // Strip trailing dot
  s = s.replace(/\.$/, "");
  return s;
}

export function parseCSV(text: string): ParseResult<Record<string, string>> {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  return {
    rows: result.data,
    errors: result.errors.map((e) => `Row ${e.row}: ${e.message}`),
  };
}

export function deduplicateByDomain<T extends { domain?: string }>(
  rows: T[],
  existingDomains: string[],
): { unique: T[]; skipped: number } {
  const seen = new Set(existingDomains.map((d) => d.toLowerCase()));
  const unique: T[] = [];
  let skipped = 0;

  for (const row of rows) {
    const domain = (row.domain ?? "").toLowerCase();
    if (!domain || seen.has(domain)) {
      skipped++;
    } else {
      seen.add(domain);
      unique.push(row);
    }
  }

  return { unique, skipped };
}

export function deduplicateByEmail<T extends { email?: string }>(
  rows: T[],
  existingEmails: string[],
): { unique: T[]; skipped: number } {
  const seen = new Set(existingEmails.map((e) => e.toLowerCase()));
  const unique: T[] = [];
  let skipped = 0;

  for (const row of rows) {
    const email = (row.email ?? "").toLowerCase();
    if (!email || seen.has(email)) {
      skipped++;
    } else {
      seen.add(email);
      unique.push(row);
    }
  }

  return { unique, skipped };
}

export function validateCompanyRow(row: Record<string, string>): {
  valid: boolean;
  errors: string[];
  data: CompanyRow;
} {
  const errors: string[] = [];

  const name = row.name?.trim() ?? row.company_name?.trim() ?? "";
  const domainRaw = row.domain?.trim() ?? row.website?.trim() ?? "";
  const domain = normalizeDomain(domainRaw);

  if (!name) errors.push("Missing: name");
  if (!domain) errors.push("Missing: domain or website");

  const empCount = row.employee_count ?? row.employees ?? "";
  const employeeCount = empCount ? parseInt(empCount, 10) : undefined;

  return {
    valid: errors.length === 0,
    errors,
    data: {
      name,
      domain,
      website: domainRaw.startsWith("http") ? domainRaw : undefined,
      industry: row.industry?.trim(),
      employeeCount: isNaN(employeeCount ?? NaN) ? undefined : employeeCount,
      description: row.description?.trim(),
    },
  };
}
