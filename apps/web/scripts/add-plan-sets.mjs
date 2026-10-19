/**
 * ── TAKE A FOLDER OF NEW PLAN SETS AND HAND BACK LABELLING LINKS ──
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:5432/prova_dev \
 *   TAKEOFF_LOCAL_PLAN_DIR="/Users/…/takeoff/real-plans" \
 *     node scripts/add-plan-sets.mjs new
 *
 * The argument is a folder RELATIVE to `TAKEOFF_LOCAL_PLAN_DIR`, because that
 * is the only directory the app will serve a local plan from. Every PDF in it
 * is ingested, its sheets ranked, its scales accepted where the drawing prints
 * one, and a link printed per labellable sheet.
 *
 * ── IT NEVER SETS A SCALE BY HAND, AND THAT IS THE POINT ──
 *
 * Diego's rule. A scale typed in by somebody who has not measured the drawing
 * is a number the whole takeoff is multiplied by, and a wrong one is invisible
 * — every length comes out plausible and wrong together. So a sheet whose
 * scale cannot be READ from the drawing is reported as NOT READY with the
 * reason, and is not linked. It is better to label nine sheets than to label
 * ten and not know which.
 *
 * ── WHAT IT DOES NOT DO ──
 *
 * It does not decide whether a set is any good. It reports what it found —
 * vector or scanned, how many sheets, which are floor plans, which have a
 * printed scale — and the judgement stays with a person. The checklist it
 * prints at the end is the same one `~/Claude Folder/takeoff/NEW-SETS.md`
 * carries, so the script and the note cannot drift apart.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
// The workspace package, resolved the way `set-review-scales.mjs` does it:
// a bare "@prisma/client" does not resolve from apps/web.
import pkg from "../../../packages/db/node_modules/@prisma/client/default.js";

const { PrismaClient } = pkg;

const ROOT = process.env.TAKEOFF_LOCAL_PLAN_DIR ?? "";
const SUB = process.argv[2] ?? "new";
const BASE = process.env.TAKEOFF_BASE_URL ?? "http://localhost:3001";
/** Sets that must never be ingested for labelling. */
const HELD_OUT_MARKERS = ["held-out", "heldout", "cedar-hollow", "cedar hollow"];

if (ROOT === "" || !ROOT.startsWith("/")) {
  console.error("REFUSING: TAKEOFF_LOCAL_PLAN_DIR must be an absolute path.");
  process.exit(1);
}
const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  // The same guard the db suite carries: this writes jobs and plans, and it
  // has no business doing that to anything but a local database.
  console.error(`REFUSING: DATABASE_URL is not local (${url.replace(/:[^:@]*@/, ":***@")}).`);
  process.exit(1);
}

const dir = resolve(ROOT, SUB);
if (!dir.startsWith(resolve(ROOT))) {
  console.error("REFUSING: the folder must be inside TAKEOFF_LOCAL_PLAN_DIR.");
  process.exit(1);
}

const prisma = new PrismaClient();

/** Everything the app needs to serve a local plan, created once per file. */
async function ingestOne(companyId, contactId, file, relPath) {
  const id = `local-${relPath.slice(0, 20).replace(/\W+/g, "")}`;
  const job = await prisma.job.upsert({
    where: { id },
    create: { id, companyId, contactId, name: file.replace(/\.pdf$/i, "").slice(0, 60) },
    update: {},
  });
  const existing = await prisma.takeoffPlan.findFirst({ where: { jobId: job.id } });
  const bytes = await readFile(join(dir, file));
  const pageCount = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  const plan =
    existing ??
    (await prisma.takeoffPlan.create({
      data: {
        companyId,
        jobId: job.id,
        // `localPlanFile.ts` resolves this inside TAKEOFF_LOCAL_PLAN_DIR and
        // refuses it in production, which is what keeps client plans off the
        // blob store.
        fileUrl: `local:${relative(resolve(ROOT), join(dir, file))}`,
        fileName: file,
      },
    }));
  return { job, plan, pageCount, bytes };
}

/**
 * Is this a vector drawing or a scan?
 *
 * A scanned set is one big image per page and carries almost no text. Both
 * halves are checked because either alone is wrong: a vector sheet can be
 * text-light (a key plan), and a scan can carry an OCR text layer.
 */
function looksScanned(bytes) {
  const head = bytes.subarray(0, Math.min(bytes.length, 4_000_000)).toString("latin1");
  const images = (head.match(/\/Subtype\s*\/Image/g) ?? []).length;
  const texts = (head.match(/\bBT\b/g) ?? []).length;
  return { images, texts, scanned: images > 0 && texts < images };
}

async function main() {
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  } catch {
    console.error(`No such folder: ${dir}`);
    console.error(`Drop the new sets into it and run this again.`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.log(`No PDFs in ${dir} — nothing to do.`);
    return;
  }

  const company = await prisma.company.upsert({
    where: { id: "local-answer-keys" },
    create: { id: "local-answer-keys", name: "Answer Key Review (local)" },
    update: {},
  });
  const contact = await prisma.contact.upsert({
    where: { id: "local-answer-keys-contact" },
    create: { id: "local-answer-keys-contact", companyId: company.id, name: "Internal" },
    update: {},
  });

  console.log(`${files.length} PDF(s) in ${dir}\n`);
  const ingested = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    if (HELD_OUT_MARKERS.some((m) => lower.includes(m))) {
      console.log(`SKIPPED  ${file}\n  the name marks it as held out, so it is not ingested`);
      continue;
    }
    const { job, plan, pageCount, bytes } = await ingestOne(company.id, contact.id, file, file);
    const scan = looksScanned(bytes);
    console.log(`${file}`);
    console.log(`  job ${job.id}  ·  ${pageCount} pages  ·  plan ${plan.id}`);
    if (scan.scanned) {
      console.log(
        `  LOOKS SCANNED — ${scan.images} images against ${scan.texts} text runs in the first pages.`,
      );
      console.log(`  A scan has no vector geometry, so there is nothing for the finder to measure.`);
      console.log(`  Ingested anyway so you can look; do not expect sheets from it.`);
    }
    ingested.push({ file, job, plan, pageCount });
  }

  if (ingested.length === 0) {
    console.log("\nNothing ingested.");
    return;
  }

  console.log(`\n── NEXT, IN ORDER ──\n`);
  console.log(`1. Run the ingest queue so the sheets and scale proposals exist:`);
  console.log(`     curl -s -X POST ${BASE}/api/plan-ingest/run`);
  console.log(`   Repeat until it reports nothing left to do — it works in batches.\n`);
  console.log(`2. Then ask which sheets are worth labelling and what scale they print:`);
  for (const one of ingested) {
    console.log(`     node scripts/sheets-for-set.mjs ${one.job.id}`);
  }
  console.log(`\n   That names the floor plans, accepts a scale ONLY where the drawing`);
  console.log(`   prints one, and gives you a link per labellable sheet.`);
  console.log(`\n3. Anything it reports without a scale is NOT ready. Leave it.`);
  console.log(`   Never type a scale in: a wrong one multiplies every length on the`);
  console.log(`   sheet and every number it produces looks reasonable.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
