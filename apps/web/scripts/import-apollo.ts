/**
 * Import an Apollo contacts export into Growth as ready-to-send leads.
 *
 *   pnpm tsx scripts/import-apollo.ts --file "Revenue contacts.csv" \
 *     --env /home/ec2-user/growth/.env.production [--product REVENUE|TRUST|ROUTE] [--per-hour 6] [--dry-run]
 *
 * --product ROUTE cross-uses a mixed list: companies billing through Stripe go
 * to Revenue, the rest to Trust (see routeProduct in src/lib/import/apollo.ts).
 *
 * For each qualifying row (see src/lib/import/apollo.ts for the filter rules):
 *  - creates the Company (or reuses one with the same domain) and the Contact,
 *    marked VALID + isBuyer so the send gates accept it
 *  - queues fit scoring restricted to the lead's product, spread at --per-hour
 *    so the free-tier AI providers are not flooded. A company that is not a
 *    fit is re-scored for the other product (Revenue <-> Trust) an hour later.
 *    Companies scoring >= 6 are enrolled into that product's ACTIVE campaign
 *    automatically; if the product has no ACTIVE campaign they wait for one.
 *
 * Existing contacts (by email) are never touched or re-enrolled. Safe to re-run.
 */
import { readFileSync } from "fs";
import { basename } from "path";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("--file is required");
  const product = (arg("product", "REVENUE") ?? "REVENUE").toUpperCase();
  const perHour = Math.max(1, parseInt(arg("per-hour", "6")!, 10));
  const dryRun = process.argv.includes("--dry-run");
  const envFile = arg("env");
  if (envFile) loadEnvFile(envFile);

  // Imported after the env is loaded: db.ts and queue.ts read it on first use.
  const { parseApolloCsv } = await import("@/lib/import/apollo");
  const { PRODUCTS } = await import("@/lib/products");
  if (product !== "ROUTE" && !PRODUCTS[product as keyof typeof PRODUCTS]?.outboundViable) {
    throw new Error(`--product ${product} is not an outbound product`);
  }

  const text = readFileSync(file, "utf8");
  const { prisma } = await import("@/lib/db");
  const existing = new Set(
    (await prisma.contact.findMany({ select: { email: true } })).map((c) => c.email.toLowerCase()),
  );
  const { leads, skipped } = parseApolloCsv(text, existing, product);

  console.log(`file: ${basename(file)}`);
  console.log(`qualifying leads: ${leads.length}`);
  const perProduct: Record<string, number> = {};
  for (const l of leads) perProduct[l.product] = (perProduct[l.product] ?? 0) + 1;
  console.log(`by product: ${JSON.stringify(perProduct)}`);
  console.log(`skipped: ${JSON.stringify(skipped)}`);
  const days = (leads.length / perHour / 24).toFixed(1);
  console.log(`fit scoring: ${perHour}/hour → ~${days} days to score all`);

  if (dryRun) {
    for (const l of leads.slice(0, 10)) {
      console.log(`  [${l.product}] ${l.email} · ${l.title} · ${l.companyName} (${l.domain}) · ${l.employeeCount ?? "?"} ppl · ${l.country ?? ""}`);
    }
    console.log("dry run — nothing written");
    await prisma.$disconnect();
    return;
  }

  const { enqueueFitScore, getBoss } = await import("@/lib/queue");
  const source = `apollo:${basename(file)}`;
  let companiesCreated = 0;
  let contactsCreated = 0;
  let scoringQueued = 0;

  let otherProduct = 0;
  let alreadyCovered = 0;
  for (const [i, lead] of leads.entries()) {
    let company = await prisma.company.findUnique({
      where: { domain: lead.domain },
      include: { contacts: { where: { isBuyer: true }, select: { id: true } } },
    });
    // One buyer per company across imports, not just within a file —
    // auto-enroll would otherwise email every buyer contact a company has.
    if (company && company.contacts.length > 0) {
      alreadyCovered += 1;
      continue;
    }
    // A company already scored for a different product keeps that product —
    // its contacts enroll into that product's campaign, not this list's.
    if (company?.fitProduct && ![lead.product, "BOTH", "REJECT"].includes(company.fitProduct)) {
      otherProduct += 1;
      continue;
    }
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: lead.companyName,
          domain: lead.domain,
          website: lead.website,
          industry: lead.industry,
          employeeCount: lead.employeeCount,
          detectedTechs: lead.technologies,
          description: lead.description,
          acquisitionSource: source,
        },
        include: { contacts: { where: { isBuyer: true }, select: { id: true } } },
      });
      companiesCreated += 1;
    }

    await prisma.contact.create({
      data: {
        companyId: company.id,
        email: lead.email,
        firstName: lead.firstName,
        lastName: lead.lastName,
        title: lead.title,
        linkedinUrl: lead.linkedinUrl,
        emailStatus: "VALID",
        isBuyer: true,
        buyerPersona: lead.title,
      },
    });
    contactsCreated += 1;

    // Only score companies that have not been scored — a company already in
    // the pipeline keeps its score and gets this contact via auto-enroll.
    if (!company.fitScoredAt) {
      const startAfter = new Date(Date.now() + Math.floor(i / perHour) * 60 * 60 * 1000);
      const other = lead.product === "REVENUE" ? "TRUST" : "REVENUE";
      await enqueueFitScore(
        { companyId: company.id, products: [lead.product], fallbackProducts: [other] },
        { startAfter },
      );
      scoringQueued += 1;
    }
  }

  console.log(`companies created: ${companiesCreated}`);
  console.log(`contacts created: ${contactsCreated}`);
  console.log(`fit scoring queued: ${scoringQueued}`);
  if (alreadyCovered) console.log(`skipped (company already has a buyer contact): ${alreadyCovered}`);
  if (otherProduct) console.log(`skipped (company already scored for another product): ${otherProduct}`);

  await (await getBoss()).stop({ graceful: true }).catch(() => {});
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
