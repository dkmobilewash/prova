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
const { postSheetWalls, saveTakeoffMeasurements } = await import("./takeoff");

let companyId = "";
let planId = "";
let jobId = "";
const pageIds: Record<number, string> = {};

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Whole Set Test Co", wholeSetTakeoffOn: false, roomFinderOn: false } });
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
  // Posting the walls (the last cases) gives the job items and estimate lines.
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
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

  it("makes a task for every scaled floor plan, one already found included, so its labels are read again", async () => {
    const result = await startPlanIngest(planId, "WALLS");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(3);
    const tasks = await prisma.planIngestTask.findMany({ where: { jobId: result.value.jobId }, select: { pageNumber: true } });
    expect(tasks.map((task) => task.pageNumber).sort()).toEqual([1, 2, 5]);
  });

  it("runs the detection every sheet would get on its own, and writes what each came to", async () => {
    const run = await prisma.planIngestJob.findFirstOrThrow({ where: { planId, stage: "WALLS" }, select: { id: true } });
    const targets: DetectTarget[] = [];
    const detect = async (target: DetectTarget) => {
      targets.push(target);
      return target.pageNumber === 1 ? ("written" as const) : ("nothing-found" as const);
    };
    const refreshed: number[] = [];
    const refresh = async (target: DetectTarget) => {
      refreshed.push(target.pageNumber);
      return { kind: "replaced" as const };
    };
    // A sheet found again has its windows counted too: one found before #1008 never had (Chrome on Baker).
    const counted: number[] = [];
    const findWindows = async (input: { pageNumber: number }) => {
      counted.push(input.pageNumber);
      return { kind: "counted" as const, windows: 4 };
    };
    const work = wallsWork({ planId, companyId, ingestJobId: run.id, jobId, startedByUserId: context.id }, { detect, refresh, findWindows });
    const report = await runIngest({ ports: claimPorts({ jobId: run.id, work }), budgetMs: 10_000 });
    expect(report).toMatchObject({ done: 3, retryable: 0, exhausted: 0 });
    // The sheet already found is found again, not detected as new.
    expect(refreshed).toEqual([2]);
    expect(counted).toEqual([2]);
    expect(await closeIfSettled(run.id)).toBe(true);
    expect((await ingestViewOf(run.id, "WALLS")).complete).toBe(true);

    expect(targets.map((t) => t.pageNumber).sort()).toEqual([1, 5]);
    expect(targets[0]).toMatchObject({ planId, companyId, feetPerUnit: 100 });
    expect(targets.find((t) => t.pageNumber === 1)?.pageId).toBe(pageIds[1]);

    const tasks = await prisma.planIngestTask.findMany({ where: { jobId: run.id }, select: { pageNumber: true, note: true } });
    expect(Object.fromEntries(tasks.map((t) => [t.pageNumber, t.note]))).toEqual({
      1: "walls found",
      2: "found again; to confirm read again from the wall model, kept and dropped left as decided; 4 windows to confirm",
      5: "nothing found",
    });
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

  it("a second press finds every counted floor plan again", async () => {
    // Page 1's "written" was simulated without rows; give it rows the way real
    // detection would, then press again.
    const calibration = await prisma.takeoffScaleCalibration.findFirstOrThrow({ where: { pageId: pageIds[1] } });
    await prisma.takeoffWallProposal.create({
      data: { pageId: pageIds[1], calibrationId: calibration.id, thicknessInches: 6, source: "REMAINDER", runs: [] },
    });
    const result = await startPlanIngest(planId, "WALLS");
    // Pages 1 and 2 are found again, and page 5, which found nothing, is asked again.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.total).toBe(3);
  });

  it("A SHEET FOUND BUT NEVER POSTED IS POSTED: its stored walls go onto the job (new-customer run v2, M3)", async () => {
    // Page 2 has walls stored under its scale (as saving a scale leaves them)
    // and nothing on the job. The run used to note "already found" and post
    // nothing, so a new job's whole-set run put 0 walls on the job.
    expect(await prisma.takeoffMeasurement.count({ where: { pageId: pageIds[2], source: "DETECTED" } })).toBe(0);
    const run = await prisma.planIngestJob.findFirstOrThrow({ where: { planId, stage: "WALLS" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const held = [{ x1: 0.9, y1: 0.9, x2: 0.95, y2: 0.9 }];
    const work = wallsWork(
      { planId, companyId, ingestJobId: run.id, jobId, startedByUserId: context.id },
      {
        detect: async () => "nothing-found" as const,
        // Found again: the same stored walls, nothing on the job — the real
        // `refreshSheetWalls` answer for this state (its own test pins that).
        refresh: async (target) => (target.pageNumber === 2 ? { kind: "proposals-only" as const, held } : { kind: "posted-left-alone" as const }),
        findRooms: async () => ({ kind: "skipped" as const, why: "room finding is off" }),
      },
    );
    await runIngest({ ports: claimPorts({ jobId: run.id, work }), budgetMs: 10_000 });
    const posted = await prisma.takeoffMeasurement.findMany({ where: { pageId: pageIds[2], source: "DETECTED", kind: "LINEAR" }, select: { xs: true, ys: true, item: { select: { name: true } } } });
    expect(posted.map((m) => [m.xs, m.ys, m.item?.name])).toEqual([[[0.1, 0.4], [0.5, 0.5], "Walls — untyped"]]);
    const note = (await prisma.planIngestTask.findFirstOrThrow({ where: { jobId: run.id, pageNumber: 2 }, select: { note: true } })).note;
    expect(note).toBe("walls found; on the job by type: none typed; untyped 30 ft");
  });

  it("RUN TAKEOFF PUTS A SHEET'S STORED WALLS ON THE JOB, and never twice (postSheetWalls)", async () => {
    // Page 5: a scale just saved, its finder not done yet — "not yet", not nothing (walk v6).
    const calibration = await prisma.takeoffScaleCalibration.findFirstOrThrow({ where: { pageId: pageIds[5] } });
    await prisma.takeoffScaleCalibration.update({ where: { id: calibration.id }, data: { createdAt: new Date() } });
    expect(await postSheetWalls(jobId, planId, 5)).toEqual({ ok: true, value: { note: null, waiting: true } });
    // Then the finder stores the walls, and the next ask posts them.
    await prisma.takeoffWallProposal.create({
      data: { pageId: pageIds[5], calibrationId: calibration.id, thicknessInches: 6, source: "REMAINDER", runs: [{ x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.2, thicknessFeet: 0.5 }] },
    });
    const first = await postSheetWalls(jobId, planId, 5);
    expect(first).toEqual({ ok: true, value: { note: "on the job by type: none typed; untyped 40 ft", waiting: false } });
    const onJob = () => prisma.takeoffMeasurement.count({ where: { pageId: pageIds[5], kind: "LINEAR" } });
    expect(await onJob()).toBe(1);
    // Pressed again: the sheet has walls on the job, so it is left alone.
    expect(await postSheetWalls(jobId, planId, 5)).toEqual({ ok: true, value: { note: null, waiting: false } });
    expect(await onJob()).toBe(1);
  });

  it("a scale saved long ago with no walls stored is nothing found, not waiting", async () => {
    const calibration = await prisma.takeoffScaleCalibration.findFirstOrThrow({ where: { pageId: pageIds[4] } });
    await prisma.takeoffScaleCalibration.update({ where: { id: calibration.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await prisma.takeoffWallProposal.count({ where: { pageId: pageIds[4] } })).toBe(0);
    expect(await postSheetWalls(jobId, planId, 4)).toEqual({ ok: true, value: { note: null, waiting: false } });
  });

  it("RUN TAKEOFF ON A SHEET LOOKS FOR ITS ROOMS, CEILINGS AND WINDOWS, as the whole-set run does (walk v7)", async () => {
    // Page 6, with the room finder on. Whatever the rooms step finds on the test
    // plan, its clause is on the note: what matters is that it was asked at all.
    const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 6 } });
    const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
    await prisma.takeoffWallProposal.create({
      data: { pageId: page.id, calibrationId: calibration.id, thicknessInches: 6, source: "REMAINDER", runs: [{ x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.3, thicknessFeet: 0.5 }] },
    });
    await prisma.company.update({ where: { id: companyId }, data: { roomFinderOn: true } });
    try {
      const posted = await postSheetWalls(jobId, planId, 6);
      expect(posted.ok && posted.value.note).toMatch(/^on the job by type: none typed; untyped 40 ft; rooms (failed|: )/);
    } finally {
      await prisma.company.update({ where: { id: companyId }, data: { roomFinderOn: false } });
    }
  });

  it("ADD THESE NEVER WRITES A RUN THAT IS ALREADY ON THE JOB: all of them refused, some of them left out", async () => {
    const form = (shapes: { xs: number[]; ys: number[] }[]) => {
      const f = new FormData();
      f.set("pageId", pageIds[5]!);
      f.set("label", "6 in wall");
      for (const shape of shapes) f.append("shape", JSON.stringify(shape));
      return f;
    };
    const posted = { xs: [0.2, 0.6], ys: [0.2, 0.2] };
    const all = await saveTakeoffMeasurements(jobId, form([posted, { xs: [0.6, 0.2], ys: [0.2, 0.2] }]));
    expect(all).toEqual({ ok: false, error: "These walls are already on the job. Give them a type with Set type, or in the review queue." });
    expect(await saveTakeoffMeasurements(jobId, form([posted, { xs: [0.2, 0.2], ys: [0.3, 0.7] }]))).toEqual({ ok: true });
    const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId: pageIds[5], kind: "LINEAR" }, select: { xs: true } });
    expect(rows.map((r) => r.xs).sort()).toEqual([[0.2, 0.2], [0.2, 0.6]]);
  });
});
