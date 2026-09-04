import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { loadEnvFiles } from "./load-env.mjs";
import { describe } from "./connection-target.mjs";
import {
  HANDLED_MODELS,
  blockingTables,
  delegateName,
  jobNamesFrom,
} from "./scratch-scope.mjs";

/**
 * Removes NAMED test jobs and everything they own — including the two
 * QuickBooks tables nothing else can reach.
 *
 * NOT the same thing as clean-scratch-data.mjs, and the difference is the
 * reason this exists. That script removes every job whose name lacks a
 * [demo] tag, plus every safety incident in the company. That is correct on
 * a dev or demo database and would be a WIPE on production, where the
 * untagged jobs are the real ones. This takes exact job names and touches
 * nothing else.
 *
 *   node scripts/clean-test-jobs.mjs                      # list only
 *   node scripts/clean-test-jobs.mjs ZZQB-TEST            # list one job
 *   CLEAN_EXPECT_HOST=ep-little-sea \
 *     node scripts/clean-test-jobs.mjs --delete           # remove them
 *
 * THE QUICKBOOKS ROWS ARE WHY THIS IS A SCRIPT AND NOT A BUTTON.
 * QuickBooksEntityLink and QuickBooksSyncAttempt are keyed by
 * (entityType, entityId) and carry no jobId, so deleting a job's invoices
 * by any other route leaves links pointing at ids that no longer exist and
 * sync rows for invoices nobody can open. There is no `deleteInvoice` or
 * `deleteJob` action in the app — invoices are evidence records, which is
 * deliberate — so nothing in the product can tidy this up.
 *
 * Everything happens in ONE transaction. A half-finished delete against
 * real data is worse than none, and the seed undo already shipped that bug
 * once by swallowing per-table failures.
 */

loadEnvFiles();

const DELETE = process.argv.includes("--delete");
const DEFAULT_NAMES = ["ZZQB-TEST", "ZZEXPORT-TEST"];
const names = jobNamesFrom(process.argv.slice(2), DEFAULT_NAMES);

const target = describe(process.env.DATABASE_URL);
if (!target) {
  console.error("clean-test-jobs: DATABASE_URL is missing or unreadable. Nothing done.");
  process.exit(1);
}

console.log(`clean-test-jobs: database  ${target.label}`);
console.log(`clean-test-jobs: jobs      ${names.map((n) => `"${n}"`).join(", ")}`);
console.log(
  `clean-test-jobs: mode      ${DELETE ? "DELETE" : "list only (pass --delete to remove)"}\n`,
);

// The host guard is a SECOND opinion, not the first. The first is that this
// script only ever matches exact names. This catches the case where the
// names are right and the database is not — a .env pointing somewhere the
// operator did not expect.
if (DELETE) {
  const expect = process.env.CLEAN_EXPECT_HOST?.trim();
  if (!expect) {
    console.error(
      "clean-test-jobs: refusing to delete without CLEAN_EXPECT_HOST.\n" +
        `clean-test-jobs: name the database you mean, e.g. CLEAN_EXPECT_HOST=${target.host.split(".")[0]}\n` +
        "clean-test-jobs: this cannot be undone.",
    );
    process.exit(1);
  }
  if (!target.host.includes(expect)) {
    console.error(
      `clean-test-jobs: REFUSING — you asked for "${expect}" and DATABASE_URL points at\n` +
        `clean-test-jobs: ${target.host}\nclean-test-jobs: nothing has been deleted.`,
    );
    process.exit(1);
  }
  console.log(`clean-test-jobs: host matches "${expect}" ✓\n`);
}

const prisma = new PrismaClient();

/** Every model carrying a jobId, read from the schema at runtime rather
 * than listed here. This is what lets the script notice a table it has
 * never heard of instead of skipping it. */
const JOB_SCOPED = Prisma.dmmf.datamodel.models
  .filter((m) => m.fields.some((f) => f.name === "jobId"))
  .map((m) => m.name);

async function main() {
  const jobs = await prisma.job.findMany({
    // Exact names. Never `contains` — see jobNamesFrom.
    where: { name: { in: names } },
    select: { id: true, name: true, status: true, companyId: true },
  });

  if (jobs.length === 0) {
    console.log("Nothing matched. No job carries any of those exact names.");
    return;
  }

  const jobIds = jobs.map((j) => j.id);
  const invoices = await prisma.invoice.findMany({
    where: { jobId: { in: jobIds } },
    select: { id: true, number: true },
  });
  const invoiceIds = invoices.map((i) => i.id);
  const payments = await prisma.payment.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: { id: true },
  });
  const paymentIds = payments.map((p) => p.id);

  // The rows keyed by entityId rather than jobId — the orphans.
  const qbWhere = { entityId: { in: [...invoiceIds, ...paymentIds] } };
  const qbLinks = await prisma.quickBooksEntityLink.count({ where: qbWhere });
  const qbAttempts = await prisma.quickBooksSyncAttempt.count({ where: qbWhere });

  // Count EVERY job-scoped table, including the ones expected to be empty.
  // The zeros are the evidence that nothing is being left behind.
  const counts = {};
  for (const model of JOB_SCOPED) {
    counts[model] = await prisma[delegateName(model)].count({
      where: { jobId: { in: jobIds } },
    });
  }
  // Reached through Invoice, so they carry no jobId of their own.
  counts.InvoiceLineItem = await prisma.invoiceLineItem.count({
    where: { invoiceId: { in: invoiceIds } },
  });
  counts.Payment = payments.length;
  counts.CostEntry = await prisma.costEntry.count({
    where: { lineItem: { jobId: { in: jobIds } } },
  });

  console.log("MATCHED:");
  jobs.forEach((j) => console.log(`  job  "${j.name}"  (${j.status})`));
  console.log("\nWOULD REMOVE:");
  for (const model of HANDLED_MODELS) {
    if (counts[model] > 0) console.log(`  ${model.padEnd(26)} ${counts[model]}`);
  }
  console.log(`  ${"QuickBooksEntityLink".padEnd(26)} ${qbLinks}`);
  console.log(`  ${"QuickBooksSyncAttempt".padEnd(26)} ${qbAttempts}`);
  console.log(`  ${"Job".padEnd(26)} ${jobs.length}`);

  const empty = HANDLED_MODELS.filter((m) => !counts[m]);
  if (empty.length) console.log(`\n  (empty: ${empty.join(", ")})`);

  // The anti-rot guard. Anything with rows that this script does not delete
  // stops the run and is named, rather than being skipped into an orphan or
  // a foreign-key failure halfway through.
  const blockers = blockingTables(counts);
  if (blockers.length) {
    console.error("\nclean-test-jobs: REFUSING — rows exist in tables this script will not touch:");
    blockers.forEach((b) => console.error(`  ${b.model} — ${b.rows} row(s): ${b.reason}`));
    console.error(
      "\nclean-test-jobs: nothing has been deleted. Either clear those by hand, or\n" +
        "clean-test-jobs: add the table to HANDLED_MODELS in scratch-scope.mjs if it is\n" +
        "clean-test-jobs: genuinely job-owned and safe to remove.",
    );
    process.exit(1);
  }

  if (!DELETE) {
    console.log("\nclean-test-jobs: nothing removed. Re-run with --delete once the list looks right.");
    return;
  }

  // One transaction. Every delete lands or none of them do — no swallowed
  // per-table failures, no half-deleted job.
  console.log("\nDELETING (one transaction, children first):");
  const removed = await prisma.$transaction(async (tx) => {
    const out = [];
    const run = async (label, fn) => {
      const r = await fn();
      out.push([label, r.count]);
    };

    await run("CostEntry", () =>
      tx.costEntry.deleteMany({ where: { lineItem: { jobId: { in: jobIds } } } }),
    );
    await run("InvoiceLineItem", () =>
      tx.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } }),
    );
    await run("Payment", () =>
      tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } }),
    );
    await run("QuickBooksSyncAttempt", () =>
      tx.quickBooksSyncAttempt.deleteMany({ where: qbWhere }),
    );
    await run("QuickBooksEntityLink", () => tx.quickBooksEntityLink.deleteMany({ where: qbWhere }));

    // The remaining job-scoped tables, in HANDLED_MODELS order — which is
    // foreign-key order, not alphabetical.
    for (const model of HANDLED_MODELS) {
      if (["CostEntry", "InvoiceLineItem", "Payment"].includes(model)) continue;
      await run(model, () =>
        tx[delegateName(model)].deleteMany({ where: { jobId: { in: jobIds } } }),
      );
    }

    await run("Job", () => tx.job.deleteMany({ where: { id: { in: jobIds } } }));

    // Verified inside the transaction, so a job that somehow survived rolls
    // the whole thing back rather than reporting success. "It said it
    // worked" is the claim this repo has been burned by more than once.
    const left = await tx.job.count({ where: { id: { in: jobIds } } });
    if (left > 0) throw new Error(`${left} job(s) still present after delete — rolled back.`);
    return out;
  });

  removed.forEach(([label, n]) => {
    if (n > 0) console.log(`  removed ${label.padEnd(24)} ${n}`);
  });

  // Read back on a fresh connection, outside the transaction, because a
  // transaction reporting on itself is the weaker of the two checks.
  const survivors = await prisma.job.findMany({
    where: { name: { in: names } },
    select: { name: true },
  });
  console.log(
    survivors.length === 0
      ? "\nclean-test-jobs: verified — none of those jobs remain."
      : `\nclean-test-jobs: WARNING — still present: ${survivors.map((s) => s.name).join(", ")}`,
  );
}

main()
  .catch((e) => {
    console.error(`\nclean-test-jobs: FAILED — ${e.message}`);
    console.error("clean-test-jobs: the transaction rolled back; nothing was deleted.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
