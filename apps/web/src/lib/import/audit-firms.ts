import Papa from "papaparse";

// Turns the hand-built audit-firm list (scripts/data/audit-firms.csv) into
// leads for an AUDITOR campaign. Unlike an Apollo export, these are mostly a
// firm's shared inbox with no named person, so there is no title or
// verified-status filter: the sender verifies each mailbox before step 1.

export interface AuditFirmLead {
  firm: string;
  email: string;
  firstName: string | null;
  domain: string;
  country: string | null;
  /** 1 sends as soon as the campaign is active; 2 waits for the second send date. */
  batch: 1 | 2;
}

export type AuditFirmSkipReason = "no_firm" | "bad_email" | "bad_batch" | "duplicate_email" | "duplicate_domain";

export interface AuditFirmParseResult {
  leads: AuditFirmLead[];
  skipped: { row: number; firm: string; reason: AuditFirmSkipReason }[];
}

export function parseAuditFirmsCsv(text: string): AuditFirmParseResult {
  const { data } = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const leads: AuditFirmLead[] = [];
  const skipped: AuditFirmParseResult["skipped"] = [];
  const emails = new Set<string>();
  const domains = new Set<string>();

  data.forEach((row, i) => {
    const col = (name: string) => (row[name] ?? "").trim();
    const firm = col("Firm");
    const skip = (reason: AuditFirmSkipReason) => skipped.push({ row: i + 2, firm, reason });
    if (!firm) return skip("no_firm");
    const email = col("Email").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return skip("bad_email");
    const batch = col("Batch");
    if (batch !== "1" && batch !== "2") return skip("bad_batch");
    const domain = email.split("@")[1]!;
    if (emails.has(email)) return skip("duplicate_email");
    // One contact per firm, as everywhere else in Growth.
    if (domains.has(domain)) return skip("duplicate_domain");
    emails.add(email);
    domains.add(domain);
    leads.push({
      firm,
      email,
      firstName: col("First Name") || null,
      domain,
      country: col("Country") || null,
      batch: batch === "1" ? 1 : 2,
    });
  });

  return { leads, skipped };
}
