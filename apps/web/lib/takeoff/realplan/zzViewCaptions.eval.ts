import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";
import { printedScalesAt } from "../printedScales";
import { sheetViews } from "../sheetViews";

/**
 * ── WHY ONE VIEW, ON A SHEET THAT PLAINLY CARRIES SEVERAL ──
 *
 * `sheetViews` reported ONE view on sixteen of eighteen training sheets, which
 * is what made the plan-footprint filter remove nothing: one view owns the
 * whole page. That refuted the filter and named view detection as the next
 * work, so this measures what the detector is missing before anything is
 * written to replace it.
 *
 * A view today is a caption matching `VIEW_NAME` with a READABLE printed scale
 * directly beneath it. The first run of this said which half binds: 274
 * caption-like strings across these sheets against 31 printed scales, and the
 * detector found 32 views. It is SCALE-limited, not vocabulary-limited — most
 * sheets print one scale, in the title block, meaning "everything at this
 * scale unless noted".
 *
 * So the probe below asks whether the drafting convention is available as
 * geometry instead: a view title is drawn with a RULE under it, and a rule is
 * a stroke rather than a scale, so it exists whether or not a scale is printed
 * beside it. Whether those rules are really there decides whether the
 * replacement is worth building.
 *
 * TRAINING SHEETS ONLY. Reports; changes nothing.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

// Deliberately wider than the detector's own pattern: this asks what a person
// would call a caption, so the gap can be measured.
const LOOKS_LIKE_A_CAPTION =
  /\b(PLAN|ELEVATION|ELEV\.?|SECTION|SECT\.?|DETAIL|DET\.?|SCHEDULE|SCHED\.?|DIAGRAM|VIEW|LAYOUT|RCP|CEILING|ROOF|SITE|KEY ?PLAN|ENLARGED|PARTITION|DEMO(LITION)?|FINISH|SLAB|FOUNDATION|FRAMING|AREA)\b/i;

type Saved = { page: number; feetPerUnit: number };

describe.skipIf(DIR === "" || LABELS === "")("what view detection is missing", () => {
  it("counts captions found, matched, scaled and underlined", { timeout: 7_200_000 }, async () => {
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
    let totalDetected = 0;
    let totalCaptions = 0;
    let totalScales = 0;
    let totalUnderlined = 0;
    let totalBig = 0;

    for (const file of files) {
      if (heldOutReason(file.dir) !== null) continue;
      const saved = JSON.parse(
        readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8"),
      ) as Saved;
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) continue;
      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const strokes = await sheetStrokes(bytes, saved.page);
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, height: i.height }));
      const W = strokes.widthPt;

      const detected = sheetViews(items, W);
      const captions = items.filter((i) => LOOKS_LIKE_A_CAPTION.test(i.str));
      const scales = printedScalesAt(items);

      // ── THE UNDERLINE, WHICH IS THE CONVENTION ITSELF ──
      const horizontals = strokes.segments.filter((seg) => {
        const dx = Math.abs(seg.x2 - seg.x1);
        const dy = Math.abs(seg.y2 - seg.y1);
        return dx > 0 && dy <= dx * 0.02;
      });
      const underlined = captions.filter((c) => {
        const cx = c.x / W;
        const cy = c.y / W;
        return horizontals.some((seg) => {
          const sy = seg.y1 / W;
          const below = sy - cy;
          if (below <= 0 || below > 0.018) return false;
          const left = Math.min(seg.x1, seg.x2) / W;
          const right = Math.max(seg.x1, seg.x2) / W;
          return left <= cx + 0.01 && right >= cx + 0.01;
        });
      });

      // ── TEXT HEIGHT, WHICH THE UNDERLINE PROBE CANNOT REPLACE ──
      //
      // The underline count is not trustworthy on its own: Camp Bow Wow A101
      // has 65,512 horizontal strokes, so a stroke sitting just under a piece
      // of text is a coincidence rather than a convention, and 10 of 10
      // captions there scored as "underlined". In dense line work that probe
      // says yes to everything.
      //
      // A view TITLE is drawn larger than a note — that is the other half of
      // the convention, it comes straight off the text item, and no amount of
      // hatching can fake it.
      const heights = items.map((i) => i.height).filter((h) => h > 0).sort((a, b) => a - b);
      const median = heights.length === 0 ? 0 : heights[Math.floor(heights.length / 2)];
      const big = captions.filter((c) => c.height >= median * 1.4);
      const bigAndUnderlined = big.filter((c) => underlined.includes(c));
      console.log(
        `      text height: median ${median.toFixed(2)}pt · ` +
          `${big.length} captions at >= 1.4x median · ${bigAndUnderlined.length} of those also underlined`,
      );
      for (const b of big.slice(0, 8)) {
        console.log(`      BIG  "${b.str.slice(0, 50)}"  ${b.height.toFixed(1)}pt  at ${(b.x / W).toFixed(2)},${(b.y / W).toFixed(2)}`);
      }
      totalBig += big.length;

      read.push(`${file.dir}/${file.sheet}`);
      totalDetected += detected.length;
      totalCaptions += captions.length;
      totalScales += scales.length;
      totalUnderlined += underlined.length;

      console.log(
        `\n  ${file.dir.slice(0, 30)}/${file.sheet} — detected ${detected.length} · ` +
          `captions ${captions.length} · scales ${scales.length} · ` +
          `underlined ${underlined.length} (of ${horizontals.length} horizontal strokes)`,
      );
      for (const d of detected) {
        console.log(
          `      DETECTED  "${d.name.slice(0, 42)}"  scale ${d.scaleName ?? "unreadable"}  ` +
            `band x ${d.from.toFixed(2)}-${d.to.toFixed(2)}`,
        );
      }
      for (const u of underlined.slice(0, 8)) {
        console.log(
          `      underlined  "${u.str.slice(0, 50)}"  at ${(u.x / W).toFixed(2)},${(u.y / W).toFixed(2)}`,
        );
      }
    }

    expect(
      read.length,
      "no training sheets were read, so every count below would be zero",
    ).toBeGreaterThan(0);

    console.log(
      `\n${read.length} sheets · detected ${totalDetected} views · ` +
        `${totalCaptions} caption-like strings · ${totalScales} printed scales · ` +
        `${totalUnderlined} underlined captions · ${totalBig} captions at >= 1.4x median height`,
    );
    console.log(
      "a detector limited by SCALES can never exceed the scale count; one limited by " +
        "RULES is limited by the underlined count instead",
    );
  });
});
