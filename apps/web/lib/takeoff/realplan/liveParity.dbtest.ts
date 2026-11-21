import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { detectWallsForCalibration, type DetectedBoundary } from "@/lib/takeoff/detectWallsForCalibration";
import { feetPerPageWidth } from "@/lib/takeoff-plan";

/**
 * ── SERVER DETECTION'S LIST, FOR THE SHEETS THE BROWSER RECORDED (prereg-live-list-parity.md) ──
 *
 * For every line `e2e/local/takeoff-live-parity.local.spec.ts` wrote to LIVE_OUT, this runs
 * `detectWallsForCalibration` ITSELF — nothing re-implemented — on a scratch company with the same PDF (read from
 * disk), the same page and the calibration line the app stored, and appends offered-minus-held to SERVER_OUT.
 * `coordination/live-parity/compare.py` then compares the two run for run. Company settings are the defaults on both sides
 * (demoted walls on, plan comparison off), and the models come from the same env.
 *
 *     DATABASE_URL=<local scratch> REAL_PLAN_DIR=… LIVE_OUT=… SERVER_OUT=… TAKEOFF_WALL_MODEL=… \
 *       TAKEOFF_WALL_RUN_MODEL=… TAKEOFF_WALL_RENO_MODEL=… npx vitest run --config vitest.db.config.mts \
 *       lib/takeoff/realplan/liveParity.dbtest.ts
 */
const LIVE = process.env.LIVE_OUT ?? "";
const PLANS = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.SERVER_OUT ?? "";

type LiveLine = { file: string; page: number; calibration: { points: string; declaredDistanceFeet: string } | null };

describe.skipIf(LIVE === "" || PLANS === "" || OUT === "")("server detection's offered-minus-held, sheet by sheet", () => {
  it("runs detection on every recorded sheet", async () => {
    const lines = readFileSync(LIVE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LiveLine);
    const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l) as LiveLine; return `${r.file}:${r.page}`; }) : []);
    const company = await prisma.company.create({ data: { name: `Live parity ${Date.now()}` } });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Live parity", status: "ESTIMATE" } });
    try {
      for (const line of lines) {
        if (done.has(`${line.file}:${line.page}`)) continue;
        // A sheet the browser could not finish has no calibration and no list: compare.py counts it missing.
        if (line.calibration === null) continue;
        const real = realpathSync(join(PLANS, line.file));
        process.env.TAKEOFF_LOCAL_PLAN_DIR = dirname(real);
        const plan = await prisma.takeoffPlan.create({ data: { companyId: company.id, jobId: job.id, fileUrl: `local:${basename(real)}`, fileName: basename(real) } });
        const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: line.page } });
        const points = JSON.parse(line.calibration.points) as { xs: number[]; ys: number[] };
        const calibration = await prisma.takeoffScaleCalibration.create({
          data: { pageId: page.id, x1: points.xs[0]!, y1: points.ys[0]!, x2: points.xs[1]!, y2: points.ys[1]!, declaredDistanceFeet: line.calibration.declaredDistanceFeet },
        });
        const feetPerUnit = feetPerPageWidth({ x1: points.xs[0]!, y1: points.ys[0]!, x2: points.xs[1]!, y2: points.ys[1]!, declaredDistanceFeet: Number(line.calibration.declaredDistanceFeet) });
        expect(feetPerUnit).not.toBeNull();
        let boundary: DetectedBoundary | null = null;
        const outcome = await detectWallsForCalibration({
          pageId: page.id, calibrationId: calibration.id, planId: plan.id, companyId: company.id, pageNumber: line.page, feetPerUnit: feetPerUnit!, wallTypes: [],
          onBoundary: (b) => { boundary = b; },
        });
        const b = boundary as DetectedBoundary | null;
        const offered = b?.offered ?? [];
        const held = new Set(b?.held ?? []);
        appendFileSync(OUT, JSON.stringify({
          file: line.file, page: line.page, outcome, offered: offered.length, held: held.size,
          list: offered.filter((r) => !held.has(r)).map((r) => [r.x1, r.y1, r.x2, r.y2]),
          offeredRuns: offered.map((r) => [r.x1, r.y1, r.x2, r.y2]),
          heldRuns: [...held].map((r) => [r.x1, r.y1, r.x2, r.y2]),
        }) + "\n");
      }
    } finally {
      await prisma.takeoffPlan.deleteMany({ where: { companyId: company.id } });
      await prisma.job.deleteMany({ where: { companyId: company.id } });
      await prisma.contact.deleteMany({ where: { companyId: company.id } });
      await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    }
  }, 1_400_000);
});
