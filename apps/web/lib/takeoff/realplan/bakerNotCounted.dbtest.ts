import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { prisma } from "@prova/db";
import { pageInventoryWork, realDeps } from "@/lib/plan-ingest/pageInventory";
import { wallsSheetsFor, wallsTaskPages, wallsWork, wholeSetSummary } from "@/lib/plan-ingest/walls";
import { detectWallsForCalibration } from "@/lib/takeoff/detectWallsForCalibration";
import { loadTakeoffWorkspace } from "@/lib/takeoff/workspaceLoad";
import { pdfPageCount } from "@/lib/ask/pageCount";

/**
 * Chrome round 7, on the real Baker set: A100 "isn't counted: A101 shows the
 * same level", on load and in the summary, after a whole-set run, after A100's
 * own scale save finds its walls, and after A101's scale is saved again.
 *
 * The last is what Chrome's long-lived job hit. With nothing stored against
 * A101's newest scale, the planner kept A100 (walls against its scale) and
 * called A101 "same level as A100": A100 said nothing and the summary counted
 * it. The sheet whose walls are ON THE JOB is now the one kept.
 *
 * Reads the drawing from BAKER_PDF (outside the repository); skipped without
 * it. Every step is the product's own: the inventory, the walls stage, the
 * scale-save detection, the workspace loader and the summary.
 */
const PDF = process.env.BAKER_PDF ?? "";
const A100 = 12;
const A101 = 13;

describe.skipIf(PDF === "")("Baker A100 is not counted, on the real set", () => {
  it("says so on load and in the summary, through a run, A100's own find, and A101 scaled again", async () => {
    process.env.TAKEOFF_LOCAL_PLAN_DIR = dirname(PDF);
    const company = await prisma.company.create({ data: { name: "Baker not counted", wholeSetTakeoffOn: true } });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Baker", status: "ESTIMATE" } });
    const plan = await prisma.takeoffPlan.create({ data: { companyId: company.id, jobId: job.id, fileUrl: `local:${basename(PDF)}`, fileName: basename(PDF) } });
    const pages = pdfPageCount(readFileSync(PDF)) ?? 0;
    const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId: company.id, stage: "PAGE_INVENTORY", pageCount: pages, finishedAt: new Date() } });
    const inventory = pageInventoryWork({ planId: plan.id, companyId: company.id, ingestJobId: ingest.id, jobId: job.id, startedByUserId: null }, { ...realDeps, sheetNamesOn: async () => true });
    // Every sheet the inventory reads at 1/8", scaled the way the one-press printed scale does.
    const scaled: Record<number, { pageId: string; calibrationId: string }> = {};
    for (let n = 1; n <= pages; n++) {
      expect((await inventory({ id: `inv-${n}`, pageNumber: n, stage: "PAGE_INVENTORY", attempts: 1 })).ok).toBe(true);
      const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: n } });
      const reading = await prisma.planSheetScaleReading.findUnique({ where: { planId_pageNumber: { planId: plan.id, pageNumber: n } } });
      if (reading?.scaleName === `1/8" = 1'-0"`) {
        const calibration = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "288" } });
        scaled[n] = { pageId: page.id, calibrationId: calibration.id };
      }
    }
    expect(Object.keys(scaled)).toEqual(expect.arrayContaining([String(A100), String(A101)]));

    const run = async () => {
      const ingestRun = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId: company.id, stage: "WALLS", pageCount: 1 } });
      const work = wallsWork({ planId: plan.id, companyId: company.id, ingestJobId: ingestRun.id, jobId: job.id, startedByUserId: null });
      const notes: Record<number, string | null> = {};
      for (const n of wallsTaskPages(await wallsSheetsFor(plan.id, company.id))) {
        const task = await prisma.planIngestTask.create({ data: { jobId: ingestRun.id, pageNumber: n, stage: "WALLS" } });
        expect((await work({ id: task.id, pageNumber: n, stage: "WALLS", attempts: 1 })).ok).toBe(true);
        notes[n] = (await prisma.planIngestTask.findUniqueOrThrow({ where: { id: task.id } })).note;
      }
      return notes;
    };
    const notCountedOnLoad = async () => (await loadTakeoffWorkspace(company, job))?.notCountedByPage;
    const summaryOf = async (n: number) => (await wholeSetSummary(plan.id, company.id, 3)).find((row) => row.pageNumber === n)?.status;

    // 1. The whole-set run counts A101, never A100.
    const first = await run();
    expect(first[A100]).toBeUndefined();
    expect(first[A101]).toMatch(/^walls found/);
    expect(await notCountedOnLoad()).toMatchObject({ [A100]: "A101" });

    // 2. A person opens A100 and saves its scale, which finds its walls.
    expect(await detectWallsForCalibration({ ...scaled[A100]!, planId: plan.id, companyId: company.id, pageNumber: A100, feetPerUnit: 288, wallTypes: [] })).toBe("written");
    expect(await notCountedOnLoad()).toMatchObject({ [A100]: "A101" });
    expect(await summaryOf(A100)).toMatchObject({ kind: "walls", notCounted: "same level as A101" });

    // 3. A101's scale saved again, nothing stored against the new one: still A101's count.
    await prisma.takeoffScaleCalibration.create({ data: { pageId: scaled[A101]!.pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "288" } });
    expect(await notCountedOnLoad()).toMatchObject({ [A100]: "A101" });
    expect(await notCountedOnLoad()).not.toHaveProperty(String(A101));
    expect(await summaryOf(A100)).toMatchObject({ notCounted: "same level as A101" });

    // 4. A re-run finds A101 again under its new scale, and A100 stays out of the count.
    const second = await run();
    expect(second[A100]).toBeUndefined();
    expect(second[A101]).toMatch(/^found again/);
    expect(await summaryOf(A101)).toMatchObject({ kind: "walls" });
    expect(await summaryOf(A100)).toMatchObject({ notCounted: "same level as A101" });
    expect(await prisma.takeoffMeasurement.count({ where: { page: { planId: plan.id, pageNumber: A100 }, source: "DETECTED" } })).toBe(0);
  }, 900_000);
});
