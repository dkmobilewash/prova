import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import {
  excludedViews,
  primaryView,
  sheetViews,
  viewRegions,
  viewsInRegions,
  wallsPerView,
} from "../sheetViews";
import { viewKind } from "../viewKind";
import type { WallCandidate } from "../wallVectors";

/**
 * ── IS THIS SHEET READY TO BE LABELLED? ──
 *
 * One line per page: which view the product picks, how many candidates the
 * finder offers, and how much footage. A sheet that offers nothing cannot be
 * labelled, and finding that out from a browser costs a minute a sheet while
 * finding it out here costs a second.
 *
 * `realSheets.eval.ts` beside this file answers a different question and
 * refuses this one: it only measures sheets on its own fixed answer-key list,
 * so every page asked about here came back "not on the fixed list". Its title
 * RANKING is what it is good for, and this fills in the rest.
 *
 *     REAL_PLAN_DIR=… READY_SHEETS="<file>:122,123" FEET_PER_UNIT=287.7 \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzReady.eval.ts
 *
 * The scale is passed in rather than read: `set-review-scales.mjs` has already
 * accepted one per page and printed it, and re-deriving it here would be
 * measuring a different thing from the one the app will use.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SHEETS = (process.env.READY_SHEETS ?? "").trim();

describe.skipIf(DIR === "" || SHEETS === "")("sheets ready to label", () => {
  it("reports the view picked and what the finder offers", { timeout: 3_600_000 }, async () => {
    let offeredAnywhere = 0;
    /** Every page whose geometry was read, so a wrong path fails loudly. */
    const pagesRead: number[] = [];
    for (const token of SHEETS.split(";").filter((t) => t.includes(":"))) {
      const at = token.lastIndexOf(":");
      const file = token.slice(0, at);
      const spec = token.slice(at + 1);
      const [pagesPart, scalePart] = spec.split("@");
      const feetPerUnit = Number(scalePart ?? "287.7032051498188");
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));

      for (const page of pagesPart.split(",").map(Number)) {
        const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, file))), page);
        if (read === null) {
          // eslint-disable-next-line no-console
          console.log(`  p${page}  COULD NOT READ`);
          continue;
        }
        const text = await doc.pageText(page);
        const textItems = text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        }));
        const pageSize = { widthPt: read.widthPt, heightPt: read.heightPt };
        const views = viewsInRegions(
          sheetViews(textItems, pageSize.widthPt),
          viewRegions(read.segments, pageSize),
        );

        const candidates: WallCandidate[] = [];
        const collect = (_f: number[], wall: WallCandidate) => candidates.push(wall);
        let picked = "the whole sheet";
        let runs = 0;
        let feet = 0;
        let left = "";

        if (views.length >= 2) {
          const measured = wallsPerView({
            segments: read.segments,
            textItems,
            pageSize,
            views,
            wallTypes: [],
            feetPerUnit,
            sampledSheets: null,
            onCandidate: collect,
          });
          const best = primaryView(measured);
          picked = best.primary?.view.name ?? "NOTHING — no plan view on this sheet";
          runs = best.primary?.walls.length ?? 0;
          feet = best.primary?.lengthFeet ?? 0;
          left = excludedViews(views)
            .map((e) => e.reason)
            .slice(0, 3)
            .join(", ");
        } else {
          const found = findWallsOnSheet({
            segments: read.segments,
            textItems,
            pageSize,
            feetPerUnit,
            wallTypes: [],
            sampledSheets: null,
            onCandidate: collect,
          });
          runs = found.walls.length;
          feet = found.walls.reduce((n, w) => n + w.lengthFeet, 0);
          if (views.length === 1) picked = views[0].name;
        }

        pagesRead.push(page);
        offeredAnywhere += candidates.length;
        // eslint-disable-next-line no-console
        console.log(
          `  p${String(page).padEnd(4)} ${runs === 0 ? "NOTHING OFFERED" : `${String(runs).padStart(4)} runs`}` +
            `  ${feet.toFixed(0).padStart(6)} ft  ${String(candidates.length).padStart(5)} pairings` +
            `  view: ${picked}${views.length >= 2 ? ` (${views.length} views${left === "" ? "" : `; left out ${left}`})` : ""}` +
            `${views.length >= 1 ? ` [${viewKind(picked).kind}]` : ""}`,
        );
      }
    }
    expect(
      pagesRead.length,
      "no page was read at all — check REAL_PLAN_DIR and READY_SHEETS",
    ).toBeGreaterThan(0);
    expect(
      offeredAnywhere,
      "no sheet offered a single pairing, so this run says nothing about readiness",
    ).toBeGreaterThan(0);
  });
});
