import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { claimPorts, closeIfSettled, ingestViewOf } from "@/lib/plan-ingest/claim";
import { runIngest } from "@/lib/plan-ingest/runner";
import { wallsWork } from "@/lib/plan-ingest/walls";
import type { DetectTarget } from "@/lib/takeoff/detectWallsForCalibration";

/**
 * Whole-set takeoff on a scratch database: the switch, which sheets become
 * tasks, what a run leaves behind, and what the summary says. Detection itself
 * is injected — it needs a plan file and is measured on real sets by
 * `lib/takeoff/realplan/wholeSet.eval.ts` — so what is proved here is the
 * plumbing around it, which is where the rows are.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
// `startPlanIngest` counts the file's pages, so the plan is a fixture PDF read
// the way a dev build reads a local set (`lib/plan-ingest/localPlanFile.ts`).
process.env.TAKEOFF_LOCAL_PLAN_DIR = `${process.cwd()}/e2e/fixtures`;
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveWholeSetTakeoffSwitch, wholeSetTakeoffSummary } = await import("./wholeSetTakeoff");
const { startPlanIngest } = await import("./planIngest");

let companyId = "";
let planId = "";
let jobId = "";
const pageIds: Record<number, string> = {};

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Whole Set Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({
    data: { companyId, clerkId: `wholeset_${Date.now()}`, email: `wholeset_${Date.now()}@example.test`, role: "OWNER" },
  });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Whole Set Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan-sheet.pdf" } });
  planId = plan.id;
  // Pages: 1 scaled floor plan (no walls yet) · 2 scaled, walls already found ·
  // 3 no scale · 4 scaled but the inventory calls it a schedule · 5 scaled, unnamed.
  for (const n of [1, 2, 3, 4, 5]) {
    // The inventory's row per page: the sheet index hangs off these.
    await prisma.planSheetText.create({ data: { planId, pageNumber: n, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: n } });
    pageIds[n] = page.id;
    if (n !== 3) {
      const calibration = await prisma.takeoffScaleCalibration.create({
        data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" },
      });
      if (n === 2) {
        await prisma.takeoffWallProposal.create({
          data: {
            pageId: page.id,
            calibrationId: calibration.id,
            thicknessInches: 6,
            source: "REMAINDER",
            runs: [{ x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5, thicknessFeet: 0.5 }],
          },
        });
      }
    }
  }
  const inventory = await prisma.planIngestJob.create({
    data: { planId, companyId, stage: "PAGE_INVENTORY", pageCount: 5, finishedAt: new Date() },
  });
  await prisma.planSheetProposal.create({
    data: {
      ingestJobId: inventory.id,
      planId,
      pageNumber: 4,
      proposedSheetNumber: "A601",
      proposedTitle: "DOOR SCHEDULE",
      proposedReason: "test",
      proposedConfidence: "HIGH",
      model: "test",
      promptVersion: "test",
      status: "ACCEPTED",
      acceptedSheetNumber: "A601",
      acceptedTitle: "DOOR SCHEDULE",
    },
  });
});

afterAll(async () => {
  await prisma.planIngestJob.deleteMany({ where: { planId } });
  await prisma.planSheetText.deleteMany({ where: { planId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("whole-set takeoff", () => {
  it("refuses to start while the company's switch is off, and says where the switch is", async () => {
    const result = await startPlanIngest(planId, "WALLS");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Settings/);
  });

  it("the owner turns it on", async () => {
    const form = new FormData();
    form.set("wholeSetTakeoffOn", "on");
    expect(await saveWholeSetTakeoffSwitch(form)).toEqual({ ok: true });
    const row = await prisma.company.findUnique({ where: { id: companyId }, select: { wholeSetTakeoffOn: true } });
    expect(row?.wholeSetTakeoffOn).toBe(true);
  });

  it("makes a task for exactly the scaled floor plans that have no walls yet", async () => {
    const result = await startPlanIngest(planId, "WALLS");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(2);
    const tasks = await prisma.planIngestTask.findMany({ where: { jobId: result.value.jobId }, select: { pageNumber: true } });
    expect(tasks.map((task) => task.pageNumber).sort()).toEqual([1, 5]);
  });

  it("runs the detection every sheet would get on its own, and writes what each came to", async () => {
    const run = await prisma.planIngestJob.findFirstOrThrow({ where: { planId, stage: "WALLS" }, select: { id: true } });
    const targets: DetectTarget[] = [];
    const detect = async (target: DetectTarget) => {
      targets.push(target);
      return target.pageNumber === 1 ? ("written" as const) : ("nothing-found" as const);
    };
    const work = wallsWork({ planId, companyId, ingestJobId: run.id, jobId, startedByUserId: context.id }, { detect });
    const report = await runIngest({ ports: claimPorts({ jobId: run.id, work }), budgetMs: 10_000 });
    expect(report).toMatchObject({ done: 2, retryable: 0, exhausted: 0 });
    expect(await closeIfSettled(run.id)).toBe(true);
    expect((await ingestViewOf(run.id, "WALLS")).complete).toBe(true);

    expect(targets.map((t) => t.pageNumber).sort()).toEqual([1, 5]);
    expect(targets[0]).toMatchObject({ planId, companyId, feetPerUnit: 100 });
    expect(targets.find((t) => t.pageNumber === 1)?.pageId).toBe(pageIds[1]);

    const tasks = await prisma.planIngestTask.findMany({ where: { jobId: run.id }, select: { pageNumber: true, note: true } });
    expect(Object.fromEntries(tasks.map((t) => [t.pageNumber, t.note]))).toEqual({ 1: "walls found", 5: "nothing found" });
  });

  it("the summary says what became of every sheet of the set", async () => {
    const result = await wholeSetTakeoffSummary(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const by = Object.fromEntries(result.value.map((row) => [row.pageNumber, row]));
    expect(by[1].status).toEqual({ kind: "looked", note: "walls found" });
    expect(by[2].status).toMatchObject({ kind: "walls", groups: 1 });
    expect(by[3].status).toEqual({ kind: "skipped", why: "no scale" });
    expect(by[4].status).toEqual({ kind: "skipped", why: "not a floor plan" });
    expect(by[4].label).toBe("A601 — DOOR SCHEDULE");
    expect(by[5].status).toEqual({ kind: "looked", note: "nothing found" });
  });

  it("a second press hands back nothing to do when every sheet is settled, rather than a run of zero", async () => {
    // Page 1's "written" was simulated without rows, so it is eligible again;
    // give it rows the way real detection would, then press again.
    const calibration = await prisma.takeoffScaleCalibration.findFirstOrThrow({ where: { pageId: pageIds[1] } });
    await prisma.takeoffWallProposal.create({
      data: { pageId: pageIds[1], calibrationId: calibration.id, thicknessInches: 6, source: "REMAINDER", runs: [] },
    });
    const result = await startPlanIngest(planId, "WALLS");
    // Page 5 found nothing and stays eligible: pressing again is asking again.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.total).toBe(1);
  });
});
