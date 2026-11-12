import { prisma } from "@prova/db";
import { loadReviewQueue } from "@/lib/takeoff/reviewQueueQuery";
import { pairingsForPlan, storedPriorsOf } from "@/lib/takeoff/priorPlanLoad";
import { sheetIndexFor } from "@/lib/plan-ingest/sheetIndexQuery";
import { effectiveSheetNumber } from "@/lib/plan-ingest/sheetIndex";
import { loadSpecBookView } from "@/lib/specs/specBookQuery";
import { bidChecks, boardSqFtOf, type BidCheck, type BidCheckFacts } from "./bidCheck";
import { laborPlanFor, wallsForLabor } from "./laborLines";
import { materialKey } from "./materialKey";

/** The bid check's facts for one job, read from rows that already exist (`bidCheck.ts`). */
export async function loadBidChecks(companyId: string, jobId: string): Promise<BidCheck[]> {
  return bidChecks(await loadBidCheckFacts(companyId, jobId));
}

export async function loadBidCheckFacts(companyId: string, jobId: string): Promise<BidCheckFacts> {
  const [queue, job, company, lines, runs, spec] = await Promise.all([
    loadReviewQueue(companyId, jobId),
    prisma.job.findFirstOrThrow({ where: { id: jobId, companyId }, select: { grossAreaSqFt: true } }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { planCompareOn: true } }),
    prisma.jobLineItem.findMany({ where: { jobId, job: { companyId }, isDeleted: false }, select: { description: true, quantity: true, unit: true, unitPrice: true, budgetedUnitCost: true } }),
    prisma.wallRun.findMany({ where: { jobId, companyId, heightFt: null }, select: { label: true, wallType: { select: { code: true, defaultHeightFt: true } } } }),
    loadSpecBookView(jobId, companyId),
  ]);
  const { labor, walls } = await prisma.$transaction(async (tx) => {
    const labor = await laborPlanFor(tx, companyId, jobId);
    return { labor, walls: await wallsForLabor(tx, companyId, jobId, labor.rates.defaultFinishLevel) };
  });

  const count = (kind: string) => queue.items.filter((i) => i.kind === kind).length;
  const boards = lines.filter((l) => materialKey(l.description)?.startsWith("board|")).map((l) => boardSqFtOf({ description: l.description, quantity: Number(l.quantity ?? 0), unit: l.unit }));

  return {
    jobId,
    heights: {
      queueGroups: count("height"),
      runs: runs.filter((r) => r.wallType.defaultHeightFt === null).map((r) => `${r.label} (${r.wallType.code})`),
      assumed: {
        walls: await prisma.takeoffMeasurement.count({ where: { kind: "LINEAR", heightAssumed: true, heightFt: { not: null }, item: { jobId, companyId, heightFt: null } } }),
        feet: ((d) => (d == null ? null : Number(d)))((await prisma.company.findUnique({ where: { id: companyId }, select: { defaultWallHeightFt: true } }))?.defaultWallHeightFt),
      },
    },
    unpriced: lines.filter((l) => l.unitPrice === null && l.budgetedUnitCost === null).map((l) => l.description),
    laborMissing: labor.plan.missing,
    review: { type: count("type"), wall: count("wall"), windows: count("windows"), scale: count("scale") },
    specConflicts: spec.wallTypes.flatMap((t) => t.conflicts.map((c) => ({ code: t.code, what: c.what, legend: c.legend, spec: c.spec, sectionNumber: c.sectionNumber }))),
    quantities: {
      grossAreaSqFt: job.grossAreaSqFt === null ? null : Number(job.grossAreaSqFt),
      // `wallsForLabor` leaves out a wall with no height, so every wall here has a face.
      wallLf: walls.reduce((n, w) => n + w.linearFt, 0),
      wallFaceSqFt: walls.reduce((n, w) => n + w.linearFt * w.heightFt, 0),
      boardSqFt: boards.length === 0 || boards.some((b) => b === null) ? null : boards.reduce((n: number, b) => n + b!, 0),
    },
    existing: { compareOn: company.planCompareOn, sheets: queue.planId === null ? [] : await uncomparedRenovationSheets(companyId, queue.planId) },
  };
}

/**
 * Sheets of the newest set that show existing work (`renovationMarks`, read without a model),
 * carry walls taken off, and have no stored comparison with a demolition plan (`storedPriorsOf`):
 * their existing walls to remain may be on the bid as new work.
 */
async function uncomparedRenovationSheets(companyId: string, planId: string): Promise<{ pageNumber: number; sheet: string; walls: number; demoPlan: boolean }[]> {
  const marked = await prisma.planSheetText.findMany({ where: { planId, renovationMarks: { isEmpty: false } }, select: { pageNumber: true } });
  if (marked.length === 0) return [];
  const pages = marked.map((m) => m.pageNumber);
  const [measured, priors, index, pairings] = await Promise.all([
    prisma.takeoffPlanPage.findMany({
      where: { planId, pageNumber: { in: pages } },
      select: {
        pageNumber: true,
        _count: { select: { measurements: { where: { kind: "LINEAR" } } } },
        // A person's set-aside (a work area, or walls drawn like one they picked) answers the check.
        exclusions: { where: { kind: { in: ["EXCLUDE_LIKE", "WORK_AREA"] } }, select: { id: true }, take: 1 },
      },
    }),
    storedPriorsOf(planId),
    sheetIndexFor(planId, companyId),
    pairingsForPlan(planId),
  ]);
  const rowByPage = new Map(index.map((row) => [row.pageNumber, row]));
  return measured
    .filter((p) => p._count.measurements > 0 && priors[p.pageNumber] === undefined && p.exclusions.length === 0)
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((p) => {
      const row = rowByPage.get(p.pageNumber);
      return { pageNumber: p.pageNumber, sheet: (row && effectiveSheetNumber(row)) ?? `p${p.pageNumber}`, walls: p._count.measurements, demoPlan: pairings.byPage.has(p.pageNumber) };
    });
}
