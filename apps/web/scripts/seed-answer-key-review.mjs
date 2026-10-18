/**
 * ── A LOCAL JOB FOR REVIEWING CONFIDENTIAL DRAWINGS ──
 *
 * Creates the company, job and plan rows an answer-key review needs, with the
 * plan pointing at a file on THIS MACHINE rather than at blob storage. The
 * client's sheets are never uploaded anywhere.
 *
 * It refuses to run against anything but a local database. Writing a client's
 * plan set into the demo project — which every preview deployment reads — is
 * exactly the failure this whole arrangement exists to avoid, and a connection
 * string is one copy-paste away from being the wrong one.
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:…/prova_dev \
 *   TAKEOFF_LOCAL_PLAN_DIR="/path/to/real-plans" \
 *   REVIEWER_EMAIL=you@example.com \
 *     node scripts/seed-answer-key-review.mjs
 */
// Resolved against the db package, which is where the client is generated.
// `apps/web` has no @prisma/client of its own in this pnpm layout, and a bare
// specifier therefore fails from here.
import pkg from "../../../packages/db/node_modules/@prisma/client/default.js";
const { PrismaClient } = pkg;
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
// Absolute, for the same reason the Prisma client is: this script runs
// from a workspace package that does not hold these itself.
import { PDFDocument } from "../../../node_modules/.pnpm/pdf-lib@1.17.1/node_modules/pdf-lib/cjs/index.js";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error(
    `REFUSING: DATABASE_URL points at ${host || "(unreadable)"}, not a local database.\n` +
      "This seeds a client's confidential plan set. It must never reach a shared one.",
  );
  process.exit(1);
}

const dir = process.env.TAKEOFF_LOCAL_PLAN_DIR ?? "";
if (dir === "" || !path.isAbsolute(dir)) {
  console.error("REFUSING: TAKEOFF_LOCAL_PLAN_DIR must be an absolute path.");
  process.exit(1);
}

const email = process.env.REVIEWER_EMAIL ?? "";
if (!email.includes("@")) {
  console.error("REFUSING: set REVIEWER_EMAIL to the address you sign in with.");
  process.exit(1);
}

/** The sets to attach, and the file each one is. */
const SETS = [
  { job: "Camp Bow Wow – Answer Keys", file: "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf" },
  { job: "ELEVEN03 – Answer Keys", file: "2025-03-28_ELEVEN03 PERMIT SET_ARCH.pdf" },
];

const prisma = new PrismaClient();

/**
 * ── THE PAGE-INVENTORY STAGE, QUEUED FOR THE REAL RUNNER ──
 *
 * `PAGE_INVENTORY` is the keyless stage: it opens the PDF, records each page
 * and its title block, and reads the scale. No model call, so it costs nothing
 * and needs no API key.
 *
 * Queued rather than performed here, because the runner is the product's own
 * path — a seed that wrote `TakeoffPlanPage` rows itself would be a second
 * implementation of the very thing being reviewed.
 */
async function queueInventory(prismaClient, planId, companyId, pageCount) {
  const existing = await prismaClient.planIngestJob.findFirst({
    where: { planId, stage: "PAGE_INVENTORY" },
  });
  if (existing) return existing.id;
  const job = await prismaClient.planIngestJob.create({
    data: { planId, companyId, stage: "PAGE_INVENTORY", pageCount },
  });
  await prismaClient.planIngestTask.createMany({
    data: Array.from({ length: pageCount }, (_, i) => ({
      jobId: job.id,
      pageNumber: i + 1,
      stage: "PAGE_INVENTORY",
    })),
  });
  return job.id;
}

async function main() {
  const company = await prisma.company.upsert({
    where: { id: "local-answer-keys" },
    create: { id: "local-answer-keys", name: "Answer Key Review (local)" },
    update: {},
  });

  // ── A USER ROW THE SIGN-IN CAN ADOPT ──
  //
  // `requireCompanyContext` attaches a new Clerk id to an existing row when the
  // VERIFIED email matches, which is how signing in lands in this company
  // rather than creating an empty one. The clerkId here is a placeholder that
  // the first sign-in overwrites.
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      clerkId: `local-seed-${Date.now()}`,
      name: "Answer key reviewer",
      companyId: company.id,
      role: "OWNER",
    },
    update: { companyId: company.id },
  });

  const contact = await prisma.contact.upsert({
    where: { id: "local-answer-keys-contact" },
    create: { id: "local-answer-keys-contact", companyId: company.id, name: "Internal" },
    update: {},
  });

  for (const set of SETS) {
    const full = path.join(dir, set.file);
    if (!existsSync(full)) {
      console.log(`  skipped ${set.job}: no file at that name`);
      continue;
    }
    const job = await prisma.job.upsert({
      where: { id: `local-${set.file.slice(0, 12).replace(/\W+/g, "")}` },
      create: {
        id: `local-${set.file.slice(0, 12).replace(/\W+/g, "")}`,
        companyId: company.id,
        contactId: contact.id,
        name: set.job,
      },
      update: { name: set.job },
    });
    const existing = await prisma.takeoffPlan.findFirst({ where: { jobId: job.id } });
    const plan =
      existing ??
      (await prisma.takeoffPlan.create({
        data: {
          companyId: company.id,
          jobId: job.id,
          // The scheme `localPlanFile.ts` reads, resolved inside
          // TAKEOFF_LOCAL_PLAN_DIR and refused in production.
          fileUrl: `local:${set.file}`,
          fileName: set.file,
        },
      }));
    // The page count comes from the file itself rather than a guess: the
    // runner creates one task per page, so a wrong count either misses sheets
    // or queues work for pages that are not there.
    const bytes = await readFile(full);
    const pageCount = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();

    console.log(`  ${set.job}`);
    console.log(`    job  ${job.id}`);
    console.log(`    plan ${plan.id}`);
    const ingestId = await queueInventory(prisma, plan.id, company.id, pageCount);
    console.log(`    queued PAGE_INVENTORY for ${pageCount} pages (${ingestId})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
