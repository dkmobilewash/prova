/**
 * ── THE SCALE ON THE SHEETS AN ANSWER KEY IS WANTED FOR ──
 *
 * `Find the walls` is disabled until a sheet has a scale, so a review sheet
 * with none cannot be started. Ingest has already READ a scale for each page
 * and stored it as a proposal; this accepts the proposal for the named sheets,
 * which is the same thing pressing the button in the app does.
 *
 * Where ingest declined the page outright — a sheet carrying several drawings
 * at several scales has no one scale, which is the honest answer — it falls
 * back to the scale captioned under the biggest VIEW, exactly as the workspace
 * now offers. That is the weaker evidence and it is recorded as such in the
 * calibration's note, so the key says where its scale came from.
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:…/prova_dev \
 *   TAKEOFF_LOCAL_PLAN_DIR="/path/to/real-plans" \
 *     node scripts/set-review-scales.mjs A120 A102 A101
 */
import pkg from "../../../packages/db/node_modules/@prisma/client/default.js";
const { PrismaClient } = pkg;

const url = process.env.DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error(`REFUSING: DATABASE_URL points at ${host || "(unreadable)"}, not a local database.`);
  process.exit(1);
}

/**
 * Pages to scale, as `fileNameFragment:page`.
 *
 * BY PAGE AND NOT BY SHEET NUMBER, because the number is read by the
 * TITLE_BLOCK stage, which calls a model. The keyless inventory stage stores
 * the title block's raw TEXT and no number, so keying on one would mean
 * running a paid stage to set a scale.
 */
const wanted = process.argv.slice(2).map((part) => {
  const [file, page] = part.split(":");
  return { file: file.trim(), page: Number(page) };
});
if (wanted.length === 0 || wanted.some((w) => !Number.isFinite(w.page))) {
  console.error('Name the pages to scale, e.g. "Camp Bow Wow:15" "ELEVEN03:119"');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const readings = await prisma.planSheetScaleReading.findMany({
    select: {
      planId: true,
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
  });
  const plans = await prisma.takeoffPlan.findMany({ select: { id: true, fileName: true } });
  const fileOf = new Map(plans.map((one) => [one.id, one.fileName ?? ""]));

  for (const reading of readings) {
    const file = fileOf.get(reading.planId) ?? "";
    const asked = wanted.find(
      (w) => file.includes(w.file) && w.page === reading.pageNumber,
    );
    if (!asked) continue;
    const number = `${asked.file} p${reading.pageNumber}`;

    // ── THE PAGE ROW IS CREATED HERE, AS THE APP CREATES IT ──
    //
    // A `TakeoffPlanPage` only exists once somebody saves a calibration on
    // that page; the inventory stage stores the sheet's TEXT and its scale
    // READING and no page. So setting a scale means creating the page, which
    // is exactly what the calibration action does in the app.
    const text = await prisma.planSheetText.findFirst({
      where: { planId: reading.planId, pageNumber: reading.pageNumber },
      select: { widthPt: true },
    });
    const page =
      (await prisma.takeoffPlanPage.findFirst({
        where: { planId: reading.planId, pageNumber: reading.pageNumber },
        select: { id: true },
      })) ??
      (await prisma.takeoffPlanPage.create({
        data: {
          planId: reading.planId,
          pageNumber: reading.pageNumber,
          pageWidthPt: text?.widthPt ?? null,
        },
        select: { id: true },
      }));
    const already = await prisma.takeoffScaleCalibration.findFirst({ where: { pageId: page.id } });
    if (already) {
      console.log(`  ${number}: already has a scale`);
      continue;
    }

    // The proposal ingest read, when it found one.
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
      console.log(`  ${number} p${reading.pageNumber}: ${reading.scaleName} (${reading.source})`);
      continue;
    }

    // Otherwise the per-view answer, if the sheet carries one.
    const views = reading.viewScales?.views ?? [];
    if (views.length === 0) {
      console.log(`  ${number} p${reading.pageNumber}: no scale and no captioned view — ${reading.declineReason ?? ""}`);
      continue;
    }
    // The widest view, which is the drawing somebody is most likely measuring.
    const view = [...views].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    const inset = (view.to - view.from) * 0.05;
    const x1 = view.from + inset;
    const x2 = view.to - inset;
    const y = (view.fromY + view.toY) / 2;
    const feetPerUnit = ((text?.widthPt ?? 0) / 72) * view.feetPerInch;
    if (!(feetPerUnit > 0)) {
      console.log(`  ${number}: the sheet's width is unknown, so a caption cannot be turned into feet`);
      continue;
    }
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
    console.log(`  ${number} p${reading.pageNumber}: ${view.scaleName} from the caption under ${view.name}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
