import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { takeoffRank } from "../sheetSuitability";
import { sheetStrokes } from "../sheetStrokes";
import {
  primaryView,
  sheetViews,
  viewRegions,
  viewsInRegions,
  wallsPerView,
  type ViewWalls,
} from "../sheetViews";
import { viewKind } from "../viewKind";

/**
 * ── WHICH VIEW DOES A MULTI-VIEW SHEET MEASURE? ──
 *
 * HPL p3 carries four drawings of the same floor — finish, lighting, partition
 * and reflected ceiling — and the finder measured the LIGHTING plan. Two
 * separate causes, both in this eval's output:
 *
 *   - `takeoffRank` had no entry for LIGHTING, so the caption scored 40 as "a
 *     plan of some kind" and counted as a plan to measure;
 *   - `primaryView` chose between the plans it had by FOOTAGE, and a
 *     decorative lighting layout over one floor has more line work than the
 *     partition plan underneath it.
 *
 * So this prints, per sheet: every view, what `takeoffRank` makes of its
 * caption, whether it was measured, its footage, and which one was picked.
 * Run it against both arrangements of the code to see the pick move.
 *
 *     REAL_PLAN_DIR=… npx vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzViewPick.eval.ts
 *
 * ── THE CONTROL, WHICH IS THE ONLY REASON THE OUTPUT MEANS ANYTHING ──
 *
 * A sheet with ONE view has nothing to choose between, and a sheet whose text
 * failed to read has no captions at all — both produce a confident-looking
 * single line. So every sheet reports its view COUNT, the run asserts that it
 * found at least one sheet with two or more plan views, and a sheet that
 * yields no views at all is named rather than skipped. Otherwise this is the
 * census that walked no directory.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
/** Sheets worth looking at, as "<file>:<page>". Everything else is skipped. */
const SHEETS = (process.env.VIEW_PICK_SHEETS ?? "").trim();

type Row = {
  set: string;
  page: number;
  views: { name: string; kind: string; score: number; feet: number | null }[];
  picked: string | null;
};

function describeRow(row: Row): string {
  const lines = [`\n${row.set} p${row.page} — ${row.views.length} view(s)`];
  for (const v of row.views) {
    const mark = v.name === row.picked ? "->" : "  ";
    const feet = v.feet === null ? "not measured" : `${v.feet.toFixed(1)} ft`;
    lines.push(`  ${mark} ${v.name.padEnd(42)} ${String(v.score).padStart(5)}  ${v.kind.padEnd(11)} ${feet}`);
  }
  if (row.picked === null) lines.push("     (nothing picked — no plan on this sheet)");
  return lines.join("\n");
}

describe.skipIf(DIR === "")("which view a multi-view sheet measures", () => {
  it("names every view, its rank, and the one picked", { timeout: 3_600_000 }, async () => {
    const wanted = new Map<string, number[]>();
    for (const token of SHEETS.split(/\s*,\s*/).filter((t) => t !== "")) {
      const at = token.lastIndexOf(":");
      const file = token.slice(0, at);
      const page = Number(token.slice(at + 1));
      wanted.set(file, [...(wanted.get(file) ?? []), page]);
    }
    if (wanted.size === 0) {
      // No list given: every PDF in the directory, first twenty pages each.
      for (const f of readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
        wanted.set(f, []);
      }
    }

    const rows: Row[] = [];
    const noViews: string[] = [];
    const noScale: string[] = [];
    for (const [file, pages] of wanted) {
      // `openPlanPdf` takes a VIEW of these bytes and detaches the buffer, so
      // `sheetStrokes` needs its own copy — read fresh inside the page loop
      // rather than shared, which is what failed here first.
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));
      const list = pages.length > 0 ? pages : [...Array(Math.min(doc.pageCount, 20)).keys()].map((i) => i + 1);
      for (const page of list) {
        const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, file))), page);
        if (read === null) continue;
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
        if (views.length === 0) {
          noViews.push(`${file} p${page}`);
          continue;
        }
        // Sheets where there was a CHOICE, which is two or more views — not
        // two or more PLANS. Filtering on plans hid the sheet this eval was
        // written for: once LIGHTING is demoted, HPL p3 has exactly one plan
        // view left, which is the fix working rather than nothing to see.
        if (views.length < 2) continue;

        // The sheet's scale, from the captions the views themselves carry:
        // feet per inch of paper times the page's width in inches.
        const captioned = views.map((v) => v.feetPerInch).filter((f): f is number => f !== null);
        if (captioned.length === 0) {
          noScale.push(`${file} p${page}`);
          continue;
        }
        const feetPerUnit = Math.max(...captioned) * (pageSize.widthPt / 72);

        let measured: ViewWalls[] = [];
        try {
          measured = wallsPerView({
            segments: read.segments,
            textItems,
            pageSize,
            views,
            wallTypes: [],
            // ── A PLACEHOLDER SCALE HERE RETURNS ZERO FOOTAGE FOR EVERY VIEW ──
            //
            // This passed 1, reasoning that every view is measured against the
            // same number so the ORDERING is unaffected. Wrong, and wrong in
            // the way `sheetViews.ts`'s own header warns about: the grouping
            // threshold is in FEET, so at one foot per page width the whole
            // sheet is a single foot across and no two segments are in the
            // same building. Every view measured 0.0 ft, which made the
            // footage column read like data and meant the tie-break was never
            // exercised at all.
            feetPerUnit,
            sampledSheets: null,
          });
        } catch {
          measured = [];
        }
        const feetOf = new Map(measured.map((m) => [m.view.name, m.lengthFeet]));
        const picked = primaryView(measured).primary?.view.name ?? null;
        rows.push({
          set: file.replace(/\.pdf$/i, "").slice(0, 28),
          page,
          views: views.map((v) => ({
            name: v.name.slice(0, 42),
            kind: viewKind(v.name).kind,
            score: takeoffRank(null, v.name).score,
            feet: feetOf.get(v.name) ?? null,
          })),
          picked,
        });
      }
    }

    // eslint-disable-next-line no-console
    console.log(rows.map(describeRow).join("\n"));
    // eslint-disable-next-line no-console
    console.log(
      `\n${rows.length} sheet(s) with two or more views` +
        (noViews.length > 0 ? `\nno views read at all on: ${noViews.slice(0, 8).join(", ")}` : "") +
        (noScale.length > 0 ? `\nno readable caption scale on: ${noScale.slice(0, 8).join(", ")}` : ""),
    );
    expect(
      rows.length,
      "no sheet had two or more views, so this run chose nothing and proves nothing",
    ).toBeGreaterThan(0);
  });
});
