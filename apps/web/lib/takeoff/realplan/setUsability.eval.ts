import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf, hasTextLayer } from "../../plan-ingest/planPdf";
import { dimensionLabels } from "../../plan-ingest/dimensionLabels";
import { printedScalesOnPage } from "../scaleAudit";
import { scaleFromPrinted, standardSheetSize } from "../scaleFromPrinted";

/**
 * ── IS THIS PLAN SET USABLE FOR LABELLING AT ALL? ──
 *
 *     REAL_PLAN_DIR="/path/to/a folder of new sets" \
 *       pnpm --filter @prova/web exec vitest run \
 *         --config vitest.eval.config.mts lib/takeoff/realplan/setUsability.eval.ts
 *
 * The first two items of `~/Claude Folder/takeoff/NEW-SETS.md`'s checklist,
 * answered per page and summed per set, before anybody spends a model call or
 * an estimator's hour on it:
 *
 *   1. is it a VECTOR PDF — does the page carry path operators and a text
 *      layer, or is it one photograph per page with nothing to measure;
 *   2. does it PRINT A SCALE a machine can read — a title-block scale this
 *      app accepts (`printedScalesOnPage` → `scaleFromPrinted`), or printed
 *      dimension strings the dimension reader could vote on.
 *
 * It does NOT pick floor plans. That needs the product's own ranking
 * vocabulary (`takeoffRank`, `nameSheet`) and `realSheets.eval.ts`, which a
 * copy of in this file would be the second hand-rolled list this repo keeps
 * paying for. A set this file calls usable still needs a person to page
 * through it, per `sheets-to-label.md`: density and titles can shortlist a
 * plan view, and neither can confirm one.
 *
 * Nothing from the drawings is written into the repository: input from
 * `REAL_PLAN_DIR`, output to `REAL_PLAN_OUT`, both outside the tree.
 */

const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.REAL_PLAN_OUT ?? join(process.env.TMPDIR ?? "/tmp", "set-usability");

/**
 * Below this many stroked segments a page is treated as carrying no vector
 * drawing. A scanned page reports a handful (its border) and a real plan sheet
 * reports thousands; `realSheets.eval.ts` uses 400 as its "enough to measure"
 * floor and this is the same number for the same reason.
 */
const MIN_SEGMENTS = 400;

type PageRow = {
  page: number;
  size: string;
  items: number;
  pathOperators: number;
  segments: number;
  printed: string[];
  /** The one printed scale `scaleFromPrinted` would accept, or "". */
  accepted: string;
  dims: number;
};

describe.skipIf(DIR === "")("usability of a folder of plan sets", () => {
  it("says, per set, whether it is vector and whether it prints a scale", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
    expect(files.length, `no PDFs under ${DIR}`).toBeGreaterThan(0);
    mkdirSync(OUT, { recursive: true });

    const lines: string[] = [];
    const say = (line: string) => {
      lines.push(line);
      console.log(line);
    };
    const csv: string[] = ["set,page,size,textItems,pathOperators,segments,printedScales,accepted,dimensions"];

    for (const file of files) {
      const label = basename(file, ".pdf");
      const doc = await openPlanPdf(readFileSync(join(DIR, file)));
      const rows: PageRow[] = [];
      const started = Date.now();
      try {
        for (let page = 1; page <= doc.pageCount; page += 1) {
          let row: PageRow = { page, size: "?", items: 0, pathOperators: 0, segments: 0, printed: [], accepted: "", dims: 0 };
          try {
            const text = await doc.pageText(page);
            const strokes = await doc.pageStrokes(page);
            const printed = printedScalesOnPage(text.items);
            const accepted = scaleFromPrinted(printed, text.widthPt, text.heightPt);
            row = {
              page,
              size: standardSheetSize(text.widthPt, text.heightPt) ?? `${(text.widthPt / 72).toFixed(1)}x${(text.heightPt / 72).toFixed(1)}in`,
              items: hasTextLayer(text) ? text.items.length : 0,
              pathOperators: strokes.pathOperators,
              segments: strokes.segments.length,
              printed,
              accepted: accepted?.scaleName ?? "",
              dims: dimensionLabels(text).length,
            };
          } catch (err) {
            row.size = `unreadable: ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`;
          }
          rows.push(row);
          csv.push(
            [label, row.page, row.size, row.items, row.pathOperators, row.segments, `"${row.printed.join("; ")}"`, row.accepted, row.dims].join(","),
          );
        }
      } finally {
        await doc.close();
      }

      const vector = rows.filter((r) => r.segments >= MIN_SEGMENTS).length;
      const text = rows.filter((r) => r.items > 0).length;
      const withAccepted = rows.filter((r) => r.accepted !== "").length;
      const withAnyPrinted = rows.filter((r) => r.printed.length > 0).length;
      const withDims = rows.filter((r) => r.dims >= 3).length;
      const sizes = [...new Set(rows.map((r) => r.size))].join(", ");

      // ── THE VERDICT, IN THE CHECKLIST'S OWN TERMS ──
      //
      // "Scanned" means NO page carries a drawing's worth of vectors; a set
      // with a scanned cover and vector sheets is still vector. "No scale"
      // means no page prints one this app accepts AND no page carries enough
      // dimensions to vote from — either source is a scale read off the
      // drawing, and the one thing this never does is suggest typing one in.
      const verdict =
        vector === 0
          ? "SCANNED — nothing to measure"
          : withAccepted === 0 && withDims === 0
            ? "VECTOR, NO READABLE SCALE — unusable as it stands"
            : "VECTOR WITH A READABLE SCALE — needs a person to pick the plan views";

      say(`## ${label}  (${rows.length} pages, ${((Date.now() - started) / 1000).toFixed(0)}s)`);
      say(`   verdict       ${verdict}`);
      say(`   sheet sizes   ${sizes}`);
      say(`   vector pages  ${vector} of ${rows.length} carry >= ${MIN_SEGMENTS} segments`);
      say(`   text pages    ${text} of ${rows.length} have a text layer`);
      say(`   printed scale ${withAccepted} pages print ONE scale this app accepts; ${withAnyPrinted} print any`);
      say(`   dimensions    ${withDims} pages carry 3+ printed dimension strings`);
      say("");
    }

    writeFileSync(join(OUT, "usability.txt"), `${lines.join("\n")}\n`, "utf8");
    writeFileSync(join(OUT, "pages.csv"), `${csv.join("\n")}\n`, "utf8");
    console.log(`# written to ${OUT}`);
  }, 3_600_000);
});
