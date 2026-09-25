/**
 * Set Contact.timezone from the Apollo country for contacts imported before
 * the column existed. Reads the same Apollo CSVs used for import; only fills
 * contacts whose timezone is still null. Safe to re-run.
 *
 *   pnpm tsx scripts/backfill-timezones.ts --env /home/ec2-user/growth/.env.production ~/growth/imports/*.csv
 */
import { readFileSync } from "fs";
import Papa from "papaparse";

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const e = args.indexOf("--env");
  if (e >= 0) loadEnvFile(args.splice(e, 2)[1]!);
  const { prisma } = await import("@/lib/db");
  const { timezoneForCountry } = await import("@/lib/sending/timezone");

  const zoneByEmail = new Map<string, string>();
  for (const file of args) {
    const { data } = Papa.parse<Record<string, string>>(readFileSync(file, "utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
    for (const row of data) {
      const email = (row["Email"] ?? "").trim().toLowerCase();
      const zone = timezoneForCountry(row["Country"] || row["Company Country"]);
      if (email && zone) zoneByEmail.set(email, zone);
    }
  }

  const contacts = await prisma.contact.findMany({ where: { timezone: null }, select: { id: true, email: true } });
  let updated = 0;
  for (const c of contacts) {
    const zone = zoneByEmail.get(c.email.toLowerCase());
    if (!zone) continue;
    await prisma.contact.update({ where: { id: c.id }, data: { timezone: zone } });
    updated += 1;
  }
  const byZone: Record<string, number> = {};
  for (const z of zoneByEmail.values()) byZone[z] = (byZone[z] ?? 0) + 1;
  console.log(`contacts without timezone: ${contacts.length}, updated: ${updated}`);
  console.log(`zones in files: ${JSON.stringify(byZone)}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
