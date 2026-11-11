import { prisma } from "@prova/db";
import { detectWallsForCalibration } from "@/lib/takeoff/detectWallsForCalibration";
import { feetPerPageWidth } from "@/lib/takeoff-plan";
import { loadReviewQueue } from "@/lib/takeoff/reviewQueueQuery";
import { SAMPLE_PLANS, SAMPLE_PLAN_KEY, samplePlanUrl, sheetWidthFeet } from "./samplePlan";

/**
 * ── THE SAMPLE JOB, BUILT THE WAY A PILOT'S JOB IS ──
 *
 * The same steps the screens take, in order, on the invented sample sheet:
 *   1. the plan (`sample:` scheme, the deployment's own file);
 *   2. the scale, from what the sheet prints (the line across the full width);
 *   3. the wall finder, awaited here rather than after the response, with no model;
 *   4. Run takeoff's posting (`postSheetWalls`): the walls on the job, untyped;
 *   5. the review queue's Enter on its biggest group (`confirmSheetSuggestions`),
 *      which writes the estimate lines. The other groups stay in the queue as the
 *      suggestions a new user confirms themselves.
 * Nothing is seeded, so the sample is exactly what the product does today.
 *
 * The two server actions are passed in rather than imported, because this file is
 * not "use server" and the action module imports it.
 */
export const SAMPLE_JOB_NAME = `Sample — ${SAMPLE_PLANS[SAMPLE_PLAN_KEY].title.toLowerCase().replace(/^./, (c) => c.toUpperCase())}`;
export const SAMPLE_GC_NAME = "Sample GC (invented)";
/** The height the sample's typed walls get: a common partition height, said in the job's scope. */
export const SAMPLE_WALL_HEIGHT_FT = 10;

export type SampleSteps = {
  postSheetWalls: (jobId: string, planId: string, pageNumber: number) => Promise<{ ok: boolean }>;
  confirmSheetSuggestions: (
    jobId: string,
    groups: { planId: string; pageNumber: number; code: string; inches: number; runs: { x1: number; y1: number; x2: number; y2: number }[]; heightFt: number | null; level?: string | null }[],
  ) => Promise<{ ok: true; value: { accepted: number } } | { ok: false; error: string }>;
};

export type SampleOutcome = { ok: true; jobId: string; existed: boolean } | { ok: false; error: string };

export async function buildSampleJob(companyId: string, userId: string, steps: SampleSteps): Promise<SampleOutcome> {
  const existing = await prisma.job.findFirst({ where: { companyId, isSample: true }, select: { id: true } });
  if (existing) return { ok: true, jobId: existing.id, existed: true };

  const plan = SAMPLE_PLANS[SAMPLE_PLAN_KEY];
  const contact = (await prisma.contact.findFirst({ where: { companyId, name: SAMPLE_GC_NAME }, select: { id: true } })) ??
    (await prisma.contact.create({ data: { companyId, name: SAMPLE_GC_NAME }, select: { id: true } }));
  const job = await prisma.job.create({
    data: {
      companyId,
      contactId: contact.id,
      name: SAMPLE_JOB_NAME,
      isSample: true,
      status: "ESTIMATE",
      scope: `A sample on an invented drawing (${plan.sheet}, ${plan.title}), so you can see the whole flow before you upload your own plans. Walls typed at ${SAMPLE_WALL_HEIGHT_FT} ft. Delete it whenever you like.`,
    },
    select: { id: true },
  });
  const jobId = job.id;

  const takeoffPlan = await prisma.takeoffPlan.create({
    data: { companyId, jobId, fileUrl: samplePlanUrl(SAMPLE_PLAN_KEY), fileName: `Sample ${plan.sheet} ${plan.title}.pdf` },
    select: { id: true },
  });
  const planId = takeoffPlan.id;
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1, label: plan.sheet, pageWidthPt: plan.widthPt } });
  const declared = sheetWidthFeet(plan);
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: page.id, x1: 0, y1: 0.5, x2: 1, y2: 0.5, declaredDistanceFeet: String(declared), note: `Printed scale ${plan.scaleText}`, createdByUserId: userId },
    select: { id: true },
  });
  const feetPerUnit = feetPerPageWidth({ x1: 0, y1: 0.5, x2: 1, y2: 0.5, declaredDistanceFeet: declared });
  if (feetPerUnit === null) return { ok: false, error: "The sample sheet's scale could not be set." };

  const types = await prisma.wallType.findMany({
    where: { companyId },
    select: { id: true, code: true, name: true, thicknessIn: true, _count: { select: { components: true } } },
    orderBy: { sortOrder: "asc" },
  });
  const found = await detectWallsForCalibration({
    pageId: page.id,
    calibrationId: calibration.id,
    planId,
    companyId,
    pageNumber: 1,
    feetPerUnit,
    noModel: true,
    wallTypes: types.map((t) => ({ id: t.id, code: t.code, name: t.name, hasParts: t._count.components > 0, thicknessIn: t.thicknessIn === null ? null : Number(t.thicknessIn) })),
  });
  if (found === "unreadable") return { ok: false, error: "The sample drawing could not be read on this deployment." };

  const posted = await steps.postSheetWalls(jobId, planId, 1);
  if (!posted.ok) return { ok: false, error: "The sample's walls could not be put on the job." };

  // One group typed, so the estimate has lines; the rest stay as suggestions.
  const priced = types.find((t) => t._count.components > 0);
  const queue = await loadReviewQueue(companyId, jobId);
  const groups = queue.items.filter((item) => item.kind === "type");
  const biggest = [...groups].sort((a, b) => (b.feet ?? 0) - (a.feet ?? 0))[0];
  if (priced && biggest) {
    const typed = await steps.confirmSheetSuggestions(jobId, [
      { planId, pageNumber: biggest.pageNumber, code: priced.code, inches: biggest.inches, runs: biggest.runs.map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 })), heightFt: SAMPLE_WALL_HEIGHT_FT, level: null },
    ]);
    if (!typed.ok) console.error("[sample-job] typing the biggest group failed", { jobId, error: typed.error });
  }
  return { ok: true, jobId, existed: false };
}
