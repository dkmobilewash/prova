import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";
import { pagesToSample } from "../sheetTemplate";

/**
 * ── DOES THE EVAL SEE THE SAME CANDIDATES THE APP SHOWED? ──
 *
 * The miss analysis concluded that 1,826 ft of traced wall sat on candidates
 * "nobody judged — the row was there and went unseen". Diego pointed out that
 * Chrome's panel read "109 of 109", "82 of 82", "38 of 38" on these sheets:
 * every candidate reviewed. If that is so, those rows were NOT in the list,
 * and the conclusion is wrong in a way that matters — it blames the review for
 * something the finder did.
 *
 * Two possibilities, and they need opposite responses:
 *
 *   (a) the CURRENT finder proposes them and the build Chrome labelled on did
 *       not. The traces are still valid key; the miss count just has to be
 *       taken against the current finder.
 *
 *   (b) this eval runs the finder DIFFERENTLY from the app — a different
 *       scale, a view filter, wall types from the schedule, another page.
 *       Then no measurement in this directory is of what a customer sees,
 *       which is worth more than any of the numbers.
 *
 * The saved file answers it without a browser. It records what the panel
 * showed: `counts.accepted + rejected + unsure + unreviewed` is the size of
 * the list Chrome worked through, and `finderVersion` is the build that drew
 * it. So the comparison is that count against this eval's own, per sheet, on
 * the same build.
 *
 * TRAINING SHEETS ONLY.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

type Saved = {
  page: number;
  feetPerUnit: number;
  finderVersion?: string;
  counts?: { accepted?: number; rejected?: number; unsure?: number; unreviewed?: number; traced?: number };
  verdicts: { verdict: string }[];
};

describe.skipIf(DIR === "" || LABELS === "")("the app's candidate list against this eval's", () => {
  it("compares the list the panel showed with the one the eval builds", { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();

    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const here = join(LABELS, dir);
      if (!existsSync(here)) continue;
      for (const name of readdirSync(here)) {
        if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
      }
    }

    const read: string[] = [];
    const rows: string[] = [];
    let worstGap = 0;

    for (const file of files.sort((a, b) => `${a.dir}`.localeCompare(`${b.dir}`))) {
      if (heldOutReason(file.dir) !== null) continue;
      const saved = JSON.parse(
        readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8"),
      ) as Saved;
      const traced = (saved.verdicts ?? []).filter((v) => v.verdict === "traced").length;
      if (traced === 0) continue;

      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) continue;

      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const strokes = await sheetStrokes(bytes, saved.page);
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      // ── THE SET'S OWN TEMPLATE, WHICH THIS EVAL WAS NOT PASSING ──
      //
      // `detectWallsForCalibration` — the path the APP runs — hands
      // `sampledSheets` to the finder: the frame, the title block and the logo
      // read off six other sheets of the same set, because that is the only
      // geometry at the same page position on every sheet. Without it the
      // template filter never runs, so the eval keeps the frame and the title
      // block as wall candidates.
      //
      // Passing `sampledSheets: null` is what made this eval disagree with
      // the app by 128 candidates on Murray A101 and 109 on Crosslines A100 —
      // and both are sheets where the miss analysis concentrated its
      // "nobody judged" footage. Measured here rather than assumed.
      const sampled: (typeof strokes.segments)[] = [];
      for (const pageNumber of pagesToSample(doc.pageCount, saved.page)) {
        if (pageNumber === saved.page) continue;
        try {
          const other = await doc.pageStrokes(pageNumber);
          sampled.push(other.segments);
        } catch {
          // A sheet that will not parse costs the template filter, not the run.
        }
      }

      // ── THE LAST INPUT THAT DIFFERS: WHICH STROKE READER ──
      //
      // Everything else has been checked and MATCHES the app:
      //   textItems   identical construction, baseline y unshifted
      //   feetPerUnit identical — the live calibration computes to exactly
      //               the value the label file recorded (336, 287.98)
      //   wallTypes   the WallType table is EMPTY, so the app passes [] too
      //   sampledSheets passed here now, and it removes 0 candidates
      //
      // What is left is that `detectWallsForCalibration` reads strokes with
      // `openPlanPdf(...).pageStrokes(page)` while every eval in this folder
      // uses `sheetStrokes(bytes, page)`. Two readers for one job is the
      // shape this repo keeps paying for, so the counts are compared rather
      // than assumed equal.
      const viaPageStrokes = await doc.pageStrokes(saved.page);
      const strokeGap = strokes.segments.length - viaPageStrokes.segments.length;

      const textItems = text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));
      const withTemplate = findWallsOnSheet({
        segments: strokes.segments,
        textItems,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: sampled.length === 0 ? null : sampled,
      });
      const found = findWallsOnSheet({
        segments: strokes.segments,
        textItems,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      // The app's own reader, everything else held equal.
      const asApp = findWallsOnSheet({
        segments: viaPageStrokes.segments,
        textItems,
        pageSize: { widthPt: viaPageStrokes.widthPt, heightPt: viaPageStrokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: sampled.length === 0 ? null : sampled,
      });

      // What the PANEL showed: every candidate it offered carries a verdict or
      // was counted unreviewed. Traces are excluded — they are not candidates.
      const c = saved.counts ?? {};
      const inApp =
        (c.accepted ?? 0) + (c.rejected ?? 0) + (c.unsure ?? 0) + (c.unreviewed ?? 0);
      const inEval = found.walls.length;
      const inEvalTemplated = withTemplate.walls.length;
      const gap = inEvalTemplated - inApp;
      worstGap = Math.max(worstGap, Math.abs(gap));
      read.push(`${file.dir}/${file.sheet}`);
      rows.push(
        `  ${`${file.dir.slice(0, 26)}/${file.sheet}`.padEnd(34)} ` +
          `app ${String(inApp).padStart(4)} · eval ${String(inEval).padStart(4)} · ` +
          `eval+template ${String(inEvalTemplated).padStart(4)} · ` +
          `APP PATH ${String(asApp.walls.length).padStart(4)} · ` +
          `strokes ${strokes.segments.length} vs ${viaPageStrokes.segments.length} (${strokeGap >= 0 ? "+" : ""}${strokeGap}) · ` +
          `${gap === 0 ? "SAME as app" : `${gap > 0 ? "+" : ""}${gap} vs app`} · ` +
          `template removed ${inEval - inEvalTemplated} · ` +
          `saved by ${(saved.finderVersion ?? "none").slice(0, 12)}`,
      );
    }

    expect(read.length, "no training sheet with traces was read").toBeGreaterThan(0);

    console.log(`\n${read.length} training sheets with traces\n`);
    for (const row of rows) console.log(row);
    console.log(
      `\nworst difference: ${worstGap} candidates. A difference means the eval and the app ` +
        `are not running the same finder on the same sheet, which would make every measurement ` +
        `here about something a customer never sees.`,
    );
  });
});
