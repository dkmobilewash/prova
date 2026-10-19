/**
 * ── WHICH PAGES OF AN INGESTED SET HAVE A SCALE, AND WHAT ARE THEIR LINKS ──
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:5432/prova_dev \
 *     node scripts/sheets-for-set.mjs local-SomeSet 3 4 5
 *
 * With page numbers it reports those; with none it reports every page. For
 * each one it accepts the scale ingest READ from the drawing and prints a
 * labelling link. A page whose scale could not be read is listed as NOT READY
 * with ingest's own reason, and is not linked.
 *
 * ── IT NEVER SETS A SCALE BY HAND ──
 *
 * Diego's rule, and the reason belongs in front of whoever runs this: a scale
 * is the number every length on the sheet is multiplied by, so a guessed one
 * produces a takeoff wrong by a constant factor with no symptom — every figure
 * it yields looks reasonable. Only three sources are accepted, all of them
 * read from the drawing:
 *
 *   PRINTED     a scale printed on the sheet, e.g. 1/8" = 1'-0"
 *   DIMENSIONS  derived from the sheet's own printed dimension strings
 *   CAPTION     the scale captioned under the sheet's biggest view, used only
 *               where the sheet as a whole declined — weaker evidence, and the
 *               calibration's note says so
 *
 * ── IT DOES NOT DECIDE WHICH SHEETS ARE FLOOR PLANS ──
 *
 * `realSheets.eval.ts` does, with the real `takeoffRank` and the real sheet
 * naming, straight from the PDF and with no model call. An earlier version of
 * this script carried its own copy of that vocabulary and was wrong within a
 * minute of being run: HPL's three floor plans came back as "an equipment
 * plan", because what is stored per page WITHOUT a model call is the whole
 * title-block text — project name, architect, dates, often a legend — and a
 * ranking built for a short title fires on any word anywhere in a blob. A
 * second copy of a canonical list is a mistake this repo has paid for twice.
 */
// The workspace package, resolved the way `set-review-scales.mjs` does it: a
// bare "@prisma/client" does not resolve from apps/web.
import pkg from "../../../packages/db/node_modules/@prisma/client/default.js";

const { PrismaClient } = pkg;

const BASE = process.env.TAKEOFF_BASE_URL ?? "http://localhost:3001";
const [jobId, ...pageArgs] = process.argv.slice(2);
const wanted = new Set(pageArgs.map(Number).filter((n) => Number.isFinite(n)));

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error(`REFUSING: DATABASE_URL is not local (${url.replace(/:[^:@]*@/, ":***@")}).`);
  process.exit(1);
}
if (!jobId) {
  console.error("Name the job, e.g. node scripts/sheets-for-set.mjs local-SomeSet 3 4 5");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, name: true },
  });
  if (job === null) {
    console.error(`No job ${jobId}. Run add-plan-sets.mjs first.`);
    process.exit(1);
  }
  const plan = await prisma.takeoffPlan.findFirst({
    where: { jobId: job.id },
    select: { id: true, fileName: true },
  });
  if (plan === null) {
    console.error(`${job.id} has no plan.`);
    process.exit(1);
  }

  const readings = await prisma.planSheetScaleReading.findMany({
    where: { planId: plan.id },
    select: {
      pageNumber: true,
      scaleName: true,
      source: true,
      x1: true,
      y1: true,
      x2: true,
      y2: true,
      declaredDistanceFeet: true,
      declineReason: true,
      viewScales: true,
    },
    orderBy: { pageNumber: "asc" },
  });

  if (readings.length === 0) {
    console.log(`${job.name}: ingest has read nothing yet.`);
    console.log(`Drain the queue first, repeatedly, until it is quiet:`);
    console.log(`  curl -s -X POST ${BASE}/api/plan-ingest/run`);
    return;
  }

  console.log(`\n${job.name}  (${plan.fileName})`);
  console.log(`${readings.length} pages read${wanted.size > 0 ? `, reporting ${wanted.size}` : ""}\n`);

  const ready = [];
  const notReady = [];

  for (const reading of readings) {
    if (wanted.size > 0 && !wanted.has(reading.pageNumber)) continue;
    const text = await prisma.planSheetText.findFirst({
      where: { planId: plan.id, pageNumber: reading.pageNumber },
      select: { widthPt: true },
    });
    const page =
      (await prisma.takeoffPlanPage.findFirst({
        where: { planId: plan.id, pageNumber: reading.pageNumber },
        select: { id: true },
      })) ??
      (await prisma.takeoffPlanPage.create({
        data: {
          planId: plan.id,
          pageNumber: reading.pageNumber,
          pageWidthPt: text?.widthPt ?? null,
        },
        select: { id: true },
      }));
    const already = await prisma.takeoffScaleCalibration.findFirst({ where: { pageId: page.id } });

    if (already !== null) {
      ready.push({ page: reading.pageNumber, scale: "already set", source: "" });
      continue;
    }

    // 1. A scale the sheet states, or one measured from its own dimensions.
    if (reading.x1 !== null && reading.declaredDistanceFeet !== null) {
      await prisma.takeoffScaleCalibration.create({
        data: {
          pageId: page.id,
          x1: reading.x1,
          y1: reading.y1,
          x2: reading.x2,
          y2: reading.y2,
          declaredDistanceFeet: reading.declaredDistanceFeet,
          note:
            reading.source === "PRINTED"
              ? `From the ${reading.scaleName} printed on this sheet. Nothing measurable on the sheet confirmed it.`
              : `Read from the dimensions printed on this sheet (${reading.scaleName}).`,
        },
      });
      ready.push({
        page: reading.pageNumber,
        scale: reading.scaleName ?? "?",
        source: reading.source ?? "",
      });
      continue;
    }

    // 2. The scale captioned under the sheet's biggest view. A sheet carrying
    //    several drawings at several scales HAS no one scale, so this is the
    //    fallback rather than the rule, and it is recorded as weaker.
    const views = Array.isArray(reading.viewScales) ? reading.viewScales : [];
    const usable = views.filter(
      (v) =>
        v !== null &&
        typeof v === "object" &&
        typeof v.feetPerInch === "number" &&
        v.feetPerInch > 0 &&
        typeof v.to === "number" &&
        typeof v.from === "number",
    );
    if (usable.length > 0 && (text?.widthPt ?? 0) > 0) {
      const view = [...usable].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
      const inset = (view.to - view.from) * 0.05;
      const x1 = view.from + inset;
      const x2 = view.to - inset;
      const y = ((view.fromY ?? 0) + (view.toY ?? 0)) / 2;
      const feetPerUnit = ((text?.widthPt ?? 0) / 72) * view.feetPerInch;
      if (feetPerUnit > 0) {
        await prisma.takeoffScaleCalibration.create({
          data: {
            pageId: page.id,
            x1,
            y1: y,
            x2,
            y2: y,
            declaredDistanceFeet: (x2 - x1) * feetPerUnit,
            note: `From the ${view.scaleName} captioned under ${view.name} on this sheet. Nothing measurable on the sheet confirmed it.`,
          },
        });
        ready.push({
          page: reading.pageNumber,
          scale: view.scaleName ?? "?",
          source: `CAPTION under ${view.name}`,
        });
        continue;
      }
    }

    notReady.push({
      page: reading.pageNumber,
      why: reading.declineReason ?? "ingest recorded no scale and no view caption for this page",
    });
  }

  console.log(`── SCALE SET, READY TO LABEL (${ready.length}) ──\n`);
  for (const one of ready) {
    console.log(
      `  p${String(one.page).padEnd(4)} ${one.scale}${one.source ? ` (${one.source})` : ""}`,
    );
    console.log(`     ${BASE}/takeoff/${job.id}?page=${one.page}&key=1`);
  }
  if (notReady.length > 0) {
    console.log(`\n── NO SCALE COULD BE READ (${notReady.length}) ──`);
    console.log(`   Not linked. Do not type a scale in for these.\n`);
    for (const one of notReady) {
      console.log(`  p${String(one.page).padEnd(4)} ${one.why.slice(0, 110)}`);
    }
  }
  console.log(
    `\nWhich of these are floor plans is a separate question. ` +
      `realSheets.eval.ts answers\nit from the PDF, with no model call:\n` +
      `  REAL_PLAN_DIR="…/real-plans/new" REAL_PLAN_OUT=/tmp/rank \\\n` +
      `    npx vitest run --config vitest.eval.config.mts \\\n` +
      `      lib/takeoff/realplan/realSheets.eval.ts`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
