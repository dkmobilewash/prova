import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { writeLabels } from "../../plan-ingest/labelStore";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { labelFile, type LabelCandidate, type LabelVerdict } from "../labelRows";
import { sheetStrokes } from "../sheetStrokes";
import type { WallCandidate } from "../wallVectors";

/**
 * ── REBUILDING A101's LABEL FILE FROM RECOVERED VERDICTS ──
 *
 * Written because I overwrote the saved review: a scripted pass through the
 * UI pressed Save on a fresh 15-verdict state, replacing 143 verdicts and
 * about 24 minutes of somebody's work. The app has no way to RELOAD a saved
 * review, so any re-save necessarily starts from a blank sheet — which makes
 * the Save button a silent overwrite of everything that came before.
 *
 * The verdicts were recoverable because the review image embeds each one as a
 * coloured path with its exact endpoints. That is luck, not a design, and the
 * guard added alongside this is the part that matters.
 *
 * This goes through `labelFile` and `writeLabels`, the same path the route
 * uses, so the file it writes is a file the app could have written — not a
 * hand-assembled JSON that happens to parse.
 *
 *     REAL_PLAN_DIR=… A101_VERDICTS=… TAKEOFF_LABEL_DIR=… \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzA101Rebuild.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const VERDICTS = process.env.A101_VERDICTS ?? "";
const SET = "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const PAGE = 8;
const FEET_PER_UNIT = Number(process.env.A101_FEET_PER_UNIT ?? "288.4866205070642");

/** Where the building's east wall crosses, as a fraction along each run. */
function splitAt(
  run: LabelVerdict,
  xCut: number,
): [LabelVerdict, LabelVerdict] {
  const t = (xCut - Math.min(run.x1, run.x2)) / Math.abs(run.x2 - run.x1);
  const west = {
    ...run,
    x1: Math.min(run.x1, run.x2),
    x2: xCut,
    lengthFeet: run.lengthFeet * t,
    verdict: "wall" as const,
  };
  const east = {
    ...run,
    x1: xCut,
    x2: Math.max(run.x1, run.x2),
    lengthFeet: run.lengthFeet * (1 - t),
    verdict: "not-wall" as const,
  };
  return [west, east];
}

describe.skipIf(DIR === "" || VERDICTS === "")("rebuilding A101", () => {
  it("writes the recovered review with the two long walls split", { timeout: 1_800_000 }, async () => {
    const bytes = Buffer.from(readFileSync(join(DIR, SET)));
    const read = await sheetStrokes(bytes, PAGE);
    expect(read, "the sheet could not be read").not.toBeNull();
    if (read === null) return;
    const doc = await openPlanPdf(bytes);
    const text = await doc.pageText(PAGE);

    const candidates: LabelCandidate[] = [];
    findWallsOnSheet({
      segments: read.segments,
      textItems: text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      })),
      pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
      feetPerUnit: FEET_PER_UNIT,
      wallTypes: [],
      sampledSheets: null,
      onCandidate: (features: number[], wall: WallCandidate) =>
        candidates.push({
          x1: wall.x1,
          y1: wall.y1,
          x2: wall.x2,
          y2: wall.y2,
          lengthFeet: wall.lengthFeet,
          thicknessFeet: wall.thicknessFeet,
          features: [...features],
        }),
    });
    expect(candidates.length, "no pairings, so there is nothing to label").toBeGreaterThan(0);

    const recovered = JSON.parse(readFileSync(VERDICTS, "utf8")) as LabelVerdict[];
    expect(recovered.length, "no verdicts recovered").toBeGreaterThan(100);

    // The east wall's x, read from the run list: the boundary between the
    // building and OUTDOOR PLAY YARD 1-4.
    const X_CUT = 0.6814;
    const verdicts: LabelVerdict[] = [];
    let splits = 0;
    for (const v of recovered) {
      const horizontal = Math.abs(v.y2 - v.y1) < Math.abs(v.x2 - v.x1) * 0.02;
      const crossesCut =
        horizontal &&
        v.verdict === "wall" &&
        Math.min(v.x1, v.x2) < X_CUT - 0.02 &&
        Math.max(v.x1, v.x2) > X_CUT + 0.02 &&
        v.lengthFeet > 100;
      if (!crossesCut) {
        verdicts.push(v);
        continue;
      }
      const [west, east] = splitAt(v, X_CUT);
      verdicts.push(west, east);
      splits += 1;
      // eslint-disable-next-line no-console
      console.log(
        `  split ${v.lengthFeet.toFixed(1)} ft into ${west.lengthFeet.toFixed(1)} ft wall` +
          ` + ${east.lengthFeet.toFixed(1)} ft yard`,
      );
    }
    expect(splits, "neither long wall was split").toBe(2);

    const file = labelFile({
      set: SET,
      sheet: "A101",
      page: PAGE,
      reviewedBy: "AI-Claude-Chrome",
      secondsSpent: 1420,
      feetPerUnit: FEET_PER_UNIT,
      reviewComplete: true,
      candidates,
      verdicts,
      unreviewed: 0,
    });

    const accepted = verdicts.filter((v) => v.verdict === "wall");
    const ft = accepted.reduce((n, v) => n + v.lengthFeet, 0);
    // eslint-disable-next-line no-console
    console.log(
      `\n${verdicts.length} verdicts · ${accepted.length} accepted · ${ft.toFixed(1)} ft` +
        `\n${file.rows.length} rows, ${file.rows.filter((r) => r.label === 1).length} positive`,
    );

    const written = await writeLabels(SET, "A101", file, process.env);
    expect(written.ok ? "" : written.error).toBe("");
    // eslint-disable-next-line no-console
    if (written.ok) console.log(`wrote ${written.path}`);
  });
});
