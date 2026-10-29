import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { rasterizeSheet } from "@/lib/takeoff/raster/rasterizeSheet";
import { rasterWork, type RasterRow } from "./raster";
import { runIngest, type ClaimedTask, type RunnerPorts } from "./runner";

/**
 * ── THE RASTER STAGE, THROUGH THE INGEST RUNNER ──
 *
 * `rasterStage.eval.ts` runs `rasterizeSheet` and reports that a page takes
 * 16 s. Evergreen's 106 pages on the SERVER finished 0 of them, with attempts
 * spent and no error recorded, because the eval never goes through what the
 * server goes through: the stage's work function, the runner's claim and
 * fail ports, and (the actual cause) the bundle. This test covers the first
 * two in-process: the real `rasterWork` and the real `rasterizeSheet`, driven
 * by `runIngest` with in-memory ports, a drawn ARCH D sheet for the plan and
 * a stood-in OCR so Tesseract's model is not fetched. The bundle half is
 * `rasterWorkerPath()` below plus the production build's own chunk grep in
 * the PR.
 */
async function sheet(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([2592, 1728]);
  page.drawLine({ start: { x: 300, y: 900 }, end: { x: 1500, y: 900 }, thickness: 2 });
  page.drawLine({ start: { x: 300, y: 940 }, end: { x: 1500, y: 940 }, thickness: 2 });
  return Buffer.from(await doc.save());
}

function memoryPorts(tasks: ClaimedTask[], work: RunnerPorts["work"]) {
  const queue = [...tasks];
  const finished: ClaimedTask[] = [];
  const failed: { task: ClaimedTask; error: string; exhausted: boolean }[] = [];
  const ports: RunnerPorts = {
    claim: async () => { const next = queue.shift(); return next === undefined ? null : { ...next, attempts: next.attempts + 1 }; },
    work,
    finish: async (task) => { finished.push(task); },
    fail: async (task, error, _retryAt, exhausted) => { failed.push({ task, error, exhausted }); },
  };
  return { ports, finished, failed };
}

const ctx = { planId: "plan-1", companyId: "co-1", ingestJobId: "ingest-1", jobId: "job-1", startedByUserId: null };

describe("the RASTER stage through the ingest runner", () => {
  it("READS A PAGE, STORES ITS LINES AND TEXT, AND REPORTS IT DONE", async () => {
    const bytes = await sheet();
    const stored = new Map<string, RasterRow>();
    const work = rasterWork(ctx, {
      readPlanBytes: async () => ({ ok: true, bytes }),
      rasterize: (b, page) => rasterizeSheet(b, page, { dpi: 72, ocr: async (gray) => [{ str: `SCALE: 1/4" = 1'-0"`, x: 10, y: gray.height - 10, width: 120, height: 10, confidence: 90 }] }),
      store: async (planId, pageNumber, row) => { stored.set(`${planId}/${pageNumber}`, row); },
    });
    const { ports, finished, failed } = memoryPorts([{ id: "t1", pageNumber: 1, stage: "RASTER", attempts: 0 }], work);
    const report = await runIngest({ ports, budgetMs: 60_000 });
    expect(failed).toEqual([]);
    expect(finished.map((t) => t.id)).toEqual(["t1"]);
    expect(report).toMatchObject({ done: 1, retryable: 0, exhausted: 0, stopped: "drained" });
    const row = stored.get("plan-1/1");
    expect(row?.lines.filter((l) => Math.abs(l.x2 - l.x1) > 1000).length).toBe(2);
    expect(row?.printedScale).toBe(`1/4" = 1'-0"`);
  }, 60_000);

  it("records a page whose read HANGS as a failure with the stage and the seconds, instead of holding the claim", async () => {
    const work = rasterWork(ctx, {
      readPlanBytes: async () => ({ ok: true, bytes: await sheet() }),
      rasterize: () => new Promise(() => {}),
      store: async () => {},
    });
    const { ports, finished, failed } = memoryPorts([{ id: "t1", pageNumber: 7, stage: "RASTER", attempts: 2 }], work);
    const report = await runIngest({ ports, budgetMs: 60_000, workTimeoutMs: 200, maxAttempts: 3 });
    expect(finished).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0].exhausted).toBe(true);
    expect(failed[0].error).toMatch(/did not finish within 0 seconds at the RASTER stage/);
    expect(report).toMatchObject({ done: 0, exhausted: 1 });
  });

  it("records a plan that cannot be read as the stage's own sentence", async () => {
    const work = rasterWork(ctx, {
      readPlanBytes: async () => ({ ok: false, error: "That plan set is no longer on file, so nothing was read." }),
      rasterize: () => { throw new Error("never reached"); },
      store: async () => {},
    });
    const { ports, failed } = memoryPorts([{ id: "t1", pageNumber: 1, stage: "RASTER", attempts: 0 }], work);
    await runIngest({ ports, budgetMs: 60_000 });
    expect(failed[0]?.error).toBe("That plan set is no longer on file, so nothing was read.");
  });
});
