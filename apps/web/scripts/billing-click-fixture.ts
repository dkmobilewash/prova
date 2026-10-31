import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, localDatabaseProblem } from "../../../packages/db/scripts/connection-target.mjs";

/**
 * Builds the test job for the billing click test, in a LOCAL database.
 *
 *     DATABASE_URL=postgresql://diego@localhost:5432/prova_dev \
 *     pnpm --filter web exec tsx scripts/billing-click-fixture.ts [--company <id>] [--pdf-dir <dir>]
 *     … --remove     # takes the fixture back out
 *
 * REFUSES ANYTHING BUT A LOCAL DATABASE, BEFORE PRISMA LOADS, WITH NO OVERRIDE,
 * the same refusal as backfill-scanned-page-rows.ts. `DATABASE_URL` must be in
 * the shell. It also refuses a database missing the migrations the click test
 * reads, so a half-updated server fails here rather than as a broken page.
 * Re-running replaces the fixture and touches nothing else. It runs no
 * migration: bringing the database up to date is the server owner's step.
 */
const REQUIRED_MIGRATIONS = [
  "20261030210000_invoice_period_to",
  "20261030220000_tm_ticket_change_order_link",
  "20261030230000_change_order_proposal_cost_category",
  "20261031000000_submittal_package_contents",
  "20261031010000_purchase_orders",
];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  const problem = localDatabaseProblem(url, "DATABASE_URL");
  if (problem) {
    console.error(`billing click fixture REFUSED: ${problem}`);
    process.exit(2);
  }
  console.log(`billing click fixture: database ${describe(url)?.label}`);

  const { prisma } = await import("@prova/db");
  const fixture = await import("./billingClickFixture");

  const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  const names = new Set(applied.map((row) => row.migration_name));
  const missing = REQUIRED_MIGRATIONS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    console.error(`billing click fixture REFUSED: this database is missing ${missing.join(", ")}. Nothing was written.`);
    process.exit(3);
  }

  const companyId = argument("--company") ?? "local-answer-keys";
  if (!(await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }))) {
    console.error(`billing click fixture REFUSED: no company ${companyId} in this database. Nothing was written.`);
    process.exit(4);
  }

  if (process.argv.includes("--remove")) {
    await fixture.removeBillingClickFixture(prisma, companyId);
    console.log("fixture removed");
    return;
  }

  const result = await fixture.seedBillingClickFixture(prisma, companyId);
  console.log(`job ${result.jobId}, applications ${result.invoiceIds.join(", ")}`);
  if (result.burdenPreexisted) {
    console.log("NOTE: this company already has a burden rate, so labor figures may differ from the click-list.");
  }
  const pdfDir = argument("--pdf-dir");
  if (pdfDir) {
    mkdirSync(pdfDir, { recursive: true });
    writeFileSync(join(pdfDir, "click-test-board.pdf"), await fixture.samplePdf("Click test board data", 3));
    writeFileSync(join(pdfDir, "click-test-track.pdf"), await fixture.samplePdf("Click test track data", 2));
    console.log(`sample PDFs in ${pdfDir}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
