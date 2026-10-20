import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { heldOutReason } from "../heldOutSets";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── DOES EVERY CHOSEN SHEET OPEN, WITH A SCALE, AND FIND WALLS? ──
 *
 * The three things a labeller needs, checked from the same database the app
 * reads: a calibration exists, it converts to a sane feet-per-page-width, and
 * the finder returns runs when given it. A sheet that fails any of the three
 * is reported rather than linked.
 *
 * It takes the SCALE FROM THE DATABASE rather than a constant, because that
 * is what the app will use — checking against a number typed here would
 * confirm the arithmetic and tell nobody whether the sheet is ready.
 *
 *     DATABASE_URL=…local… REAL_PLAN_DIR=… READY_LIST="<job>:<page>,…" \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzSheetsReady.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LIST = (process.env.READY_LIST ?? "").trim();

describe.skipIf(DIR === "" || LIST === "")("the chosen sheets", () => {
  it("each opens with a scale and finds walls", { timeout: 7_200_000 }, async () => {
    const url = process.env.DATABASE_URL ?? "";
    expect(/127\.0\.0\.1|localhost/.test(url), "DATABASE_URL is not local").toBe(true);

    const asked = LIST.split(",")
      .map((one) => one.trim())
      .filter((one) => one.includes(":"))
      .map((one) => {
        const at = one.lastIndexOf(":");
        return { jobId: one.slice(0, at), page: Number(one.slice(at + 1)) };
      });
    expect(asked.length, "READY_LIST named no sheets").toBeGreaterThan(0);

    const lines: string[] = [];
    let ready = 0;
    for (const { jobId, page } of asked) {
      const plan = await prisma.takeoffPlan.findFirst({
        where: { job: { id: jobId } },
        select: { id: true, fileName: true, fileUrl: true },
      });
      if (plan === null) {
        lines.push(`  ${jobId.padEnd(26)} p${String(page).padEnd(4)} NO PLAN`);
        continue;
      }
      const pageRow = await prisma.takeoffPlanPage.findFirst({
        where: { planId: plan.id, pageNumber: page },
        select: { id: true, pageWidthPt: true },
      });
      const calibration =
        pageRow === null
          ? null
          : await prisma.takeoffScaleCalibration.findFirst({
              where: { pageId: pageRow.id },
              select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true },
            });
      if (calibration === null) {
        lines.push(`  ${jobId.padEnd(26)} p${String(page).padEnd(4)} NO SCALE — not ready`);
        continue;
      }

      // Feet per page WIDTH, which is what the finder takes. The calibration
      // is a line somebody (or ingest) drew and the distance it represents, so
      // this is its length in page-width units against that distance.
      const drawn = Math.hypot(calibration.x2 - calibration.x1, calibration.y2 - calibration.y1);
      const feetPerUnit = drawn > 0 ? Number(calibration.declaredDistanceFeet) / drawn : 0;
      if (!(feetPerUnit > 0)) {
        lines.push(`  ${jobId.padEnd(26)} p${String(page).padEnd(4)} SCALE UNUSABLE`);
        continue;
      }

      const file = (plan.fileUrl ?? "").replace(/^local:/, "");
      const bytes = Buffer.from(readFileSync(join(DIR, file)));
      const read = await sheetStrokes(bytes, page);
      if (read === null) {
        lines.push(`  ${jobId.padEnd(26)} p${String(page).padEnd(4)} COULD NOT READ`);
        continue;
      }
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));
      const text = await doc.pageText(page);
      const found = findWallsOnSheet({
        segments: read.segments,
        textItems: text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        })),
        pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
        feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      const feet = found.walls.reduce((n, w) => n + w.lengthFeet, 0);
      const held = heldOutReason(plan.fileName ?? file);
      if (found.walls.length === 0) {
        lines.push(
          `  ${jobId.padEnd(26)} p${String(page).padEnd(4)} scale ok but NO WALLS FOUND`,
        );
        continue;
      }
      ready += 1;
      lines.push(
        `  ${jobId.padEnd(26)} p${String(page).padEnd(4)}` +
          `${String(found.walls.length).padStart(5)} runs ${feet.toFixed(0).padStart(7)} ft` +
          `  ${feetPerUnit.toFixed(0).padStart(5)} ft/width` +
          `${held === null ? "" : "   HELD-OUT"}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(`\n${ready} of ${asked.length} sheets ready\n${lines.join("\n")}`);
    expect(ready, "not one sheet was ready, so this says nothing about any of them").toBeGreaterThan(
      0,
    );
    expect(ready, `${asked.length - ready} sheets are not ready to label`).toBe(asked.length);
  });
});
