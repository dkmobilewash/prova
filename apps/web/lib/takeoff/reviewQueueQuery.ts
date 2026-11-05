import { prisma } from "@prova/db";
import { asCostCategory } from "@/lib/cost-category";
import { pricingRatesFor } from "@/lib/estimating/pricing-rates";
import { HELD_LABEL } from "@/lib/takeoff/estimateHold";
import { UNTYPED_ITEM } from "@/lib/takeoff/untypedItem";
import { groupsFromProposals, storedRunsOrNull } from "@/lib/takeoff/wallProposal";
import { storedLegendCodes } from "@/lib/takeoff/planTextRead";
import type { MatchableWallType } from "@/lib/takeoff/wallTypeMatch";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { sheetIndexFor } from "@/lib/plan-ingest/sheetIndexQuery";
import { effectiveSheetNumber, effectiveTitle } from "@/lib/plan-ingest/sheetIndex";
import { sheetCategory } from "@/lib/takeoff/planSet";
import { heightItem, reviewQueue, suggestType, typeItems, wallItem, type CodeHeight, type QueueSheet, type ReviewItem } from "@/lib/takeoff/reviewQueue";
import { feetLabel, legendOption, type CeilingRoom } from "@/lib/takeoff/wallHeight";

/**
 * The job's review queue (`reviewQueue.ts`), plus the plan-set counts the
 * stepper reads beside it, from the job's NEWEST plan set — the one the
 * workspace opens. Select-only; the job layout runs it on every tab of an
 * estimate.
 */
export async function loadReviewQueue(
  companyId: string,
  jobId: string,
): Promise<{ planId: string | null; items: ReviewItem[]; heights: Record<string, CodeHeight>; scaledSheets: number; floorPlans: number; floorPlansScaled: number }> {
  const plan = await prisma.takeoffPlan.findFirst({ where: { jobId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const unpriced = await prisma.jobLineItem.findMany({
    where: { jobId, job: { companyId }, isDeleted: false, unitPrice: null, budgetedUnitCost: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, description: true, quantity: true, unit: true, costCategory: true },
  });
  // With the company's own markup set, a price item asks for the line's cost.
  const askCost = unpriced.length > 0 && (await pricingRatesFor(companyId, jobId)) !== null;
  const prices: ReviewItem[] = unpriced.map((line) => ({
    kind: "price",
    key: `price:${line.id}`,
    lineItemId: line.id,
    description: line.description,
    quantity: line.quantity.toString(),
    unit: line.unit,
    askCost,
    costCategory: asCostCategory(line.costCategory),
  }));
  if (plan === null) return { planId: null, items: prices, heights: {}, scaledSheets: 0, floorPlans: 0, floorPlansScaled: 0 };

  const [pages, sheetRows] = await Promise.all([
    prisma.takeoffPlanPage.findMany({
      where: { planId: plan.id },
      select: {
        id: true,
        pageNumber: true,
        calibrations: { orderBy: { createdAt: "desc" }, take: 1, select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } },
        measurements: {
          where: { kind: "LINEAR", source: "DETECTED", OR: [{ label: HELD_LABEL }, { item: { name: UNTYPED_ITEM } }] },
          select: { id: true, xs: true, ys: true, label: true },
        },
      },
    }),
    sheetIndexFor(plan.id, companyId),
  ]);
  const rowByPage = new Map(sheetRows.map((row) => [row.pageNumber, row]));
  const sheetOf = (pageNumber: number, calibration?: { x1: number; y1: number; x2: number; y2: number; declaredDistanceFeet: { toNumber(): number } }): QueueSheet => {
    const row = rowByPage.get(pageNumber);
    return {
      pageNumber,
      sheet: (row && effectiveSheetNumber(row)) ?? `p${pageNumber}`,
      feetPerUnit: calibration === undefined ? null : feetPerPageWidth({ ...calibration, declaredDistanceFeet: calibration.declaredDistanceFeet.toNumber() }),
    };
  };

  const items: ReviewItem[] = [...prices];
  const untypedPages = pages.filter((page) => page.measurements.some((m) => m.label !== HELD_LABEL));
  // Only the sheets with untyped walls need their stored groups, which are big.
  const proposals = untypedPages.length === 0
    ? []
    : await prisma.takeoffWallProposal.findMany({
        where: { pageId: { in: untypedPages.map((page) => page.id) } },
        orderBy: { createdAt: "desc" },
        select: { id: true, pageId: true, thicknessInches: true, runs: true, createdAt: true, source: true, sourceLabel: true, namedCode: true, itemId: true },
      });
  // ── WHAT EACH GROUP IS SUGGESTED AS, AND AT WHAT HEIGHT ──
  // The company's types (with the height the legend read gave them), the job's
  // typed items (with the height set on this job), the set's legend codes, and
  // the rooms whose ceilings were read.
  const [libraryTypes, typedItems, legendCodes, rooms] = await Promise.all([
    prisma.wallType.findMany({ where: { companyId }, select: { id: true, code: true, name: true, thicknessIn: true, defaultHeightFt: true, notes: true, _count: { select: { components: true } } } }),
    prisma.takeoffItem.findMany({ where: { jobId, companyId, wallTypeId: { not: null }, heightFt: { not: null } }, orderBy: { createdAt: "asc" }, select: { wallTypeId: true, heightFt: true } }),
    storedLegendCodes(plan.id),
    prisma.takeoffMeasurement.findMany({
      where: { kind: "AREA", ceilingHeightFeet: { not: null }, page: { planId: plan.id } },
      select: { xs: true, ys: true, roomNumber: true, roomName: true, label: true, ceilingHeightFeet: true, ceilingFrom: true, page: { select: { pageNumber: true } } },
    }),
  ]);
  const wallTypes: MatchableWallType[] = libraryTypes.map((t) => ({ id: t.id, code: t.code, name: t.name, hasParts: t._count.components > 0, thicknessIn: t.thicknessIn === null ? null : Number(t.thicknessIn) }));
  const heights: Record<string, CodeHeight> = {};
  for (const type of libraryTypes) {
    const legend = legendOption({ code: type.code, defaultHeightFt: type.defaultHeightFt === null ? null : Number(type.defaultHeightFt), notes: type.notes });
    const onJob = typedItems.find((item) => item.wallTypeId === type.id);
    const feet = onJob ? Number(onJob.heightFt) : null;
    if (feet !== null) heights[type.code.toUpperCase()] = { feet, from: legend !== null && Math.abs(legend.feet - feet) < 0.005 ? legend.from : `set on this job: ${feetLabel(feet)}` };
    else if (legend !== null) heights[type.code.toUpperCase()] = { feet: legend.feet, from: legend.from };
  }
  const roomsOn = (pageNumber: number): CeilingRoom[] =>
    rooms
      .filter((r) => r.page.pageNumber === pageNumber)
      .map((r) => ({ xs: r.xs, ys: r.ys, heightFeet: r.ceilingHeightFeet, name: [r.roomNumber, r.roomName].filter(Boolean).join(" ") || (r.label ?? "room"), from: r.ceilingFrom }));
  for (const page of pages) {
    const sheet = sheetOf(page.pageNumber, page.calibrations[0]);
    for (const m of page.measurements) {
      if (m.label !== HELD_LABEL) continue;
      const item = wallItem(sheet, m);
      if (item !== null) items.push(item);
    }
    const mine = proposals.filter((row) => row.pageId === page.id);
    // One detection run writes every row at one timestamp: the newest run.
    const newest = mine[0]?.createdAt.getTime();
    const rows = mine.filter((row) => row.createdAt.getTime() === newest);
    const named = groupsFromProposals(rows, wallTypes, sheet.feetPerUnit ?? 1);
    const groups = rows.map((row, at) => ({
      id: row.id,
      inches: row.thicknessInches,
      runs: storedRunsOrNull(row.runs) ?? [],
      suggested: named === null ? null : suggestType(named[at]!, sheet.sheet, legendCodes),
      rooms: roomsOn(page.pageNumber),
    }));
    items.push(...typeItems(sheet, page.measurements.filter((m) => m.label !== HELD_LABEL), groups));
  }

  // ── WALL GROUPS WITH NO HEIGHT ──
  // A typed wall item, or "Walls — untyped", on this plan with no height of
  // its own: the figure the estimate prices square feet at. A run a type item
  // above already holds is asked once, there, with its type.
  // Only where the queue can type it: with no legend codes and no suggestion, the
  // group's row cannot be confirmed there, so its height is still asked on its own.
  const typing = new Set(items.flatMap((item) => (item.kind === "type" && (legendCodes.length > 0 || item.suggested !== null) ? item.runs.map((r) => `${item.pageNumber}:${r.x1},${r.y1},${r.x2},${r.y2}`) : [])));
  const [heightless] = await Promise.all([
    prisma.takeoffItem.findMany({
      where: { jobId, companyId, heightFt: null, OR: [{ wallTypeId: { not: null } }, { name: UNTYPED_ITEM }], measurements: { some: { kind: "LINEAR", page: { planId: plan.id } } } },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        wallType: { select: { code: true, defaultHeightFt: true, notes: true } },
        measurements: { where: { kind: "LINEAR", page: { planId: plan.id } }, select: { xs: true, ys: true, label: true, page: { select: { pageNumber: true } } } },
      },
    }),
  ]);
  for (const item of heightless) {
    const sheets = pages.map((page) => ({
      sheet: sheetOf(page.pageNumber, page.calibrations[0]),
      runs: item.measurements
        .filter((m) => m.page.pageNumber === page.pageNumber && m.xs.length === 2 && m.label !== HELD_LABEL)
        .map((m) => ({ x1: m.xs[0]!, y1: m.ys[0]!, x2: m.xs[1]!, y2: m.ys[1]! }))
        .filter((r) => !typing.has(`${page.pageNumber}:${r.x1},${r.y1},${r.x2},${r.y2}`)),
      rooms: roomsOn(page.pageNumber),
    }));
    const type = item.wallType;
    const legend = type === null ? null : legendOption({ code: type.code, defaultHeightFt: type.defaultHeightFt === null ? null : Number(type.defaultHeightFt), notes: type.notes });
    const queued = heightItem(item, sheets, legend);
    if (queued !== null) items.push(queued);
  }

  const scaled = new Set(pages.filter((page) => page.calibrations.length > 0).map((page) => page.pageNumber));
  const floors = sheetRows
    .filter((row) => sheetCategory(effectiveSheetNumber(row), effectiveTitle(row), row.proposal?.pageType ?? null) === "floor")
    .map((row) => row.pageNumber);
  for (const pageNumber of floors) if (!scaled.has(pageNumber)) items.push({ kind: "scale", key: `scale:${pageNumber}`, pageNumber, sheet: sheetOf(pageNumber).sheet });

  return {
    planId: plan.id,
    items: reviewQueue(items),
    heights,
    scaledSheets: scaled.size,
    floorPlans: floors.length,
    floorPlansScaled: floors.filter((page) => scaled.has(page)).length,
  };
}
