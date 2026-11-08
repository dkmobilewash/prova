import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import { drawingSpecNotes, searchesSheet } from "./drawingSpecs";

/**
 * What the drawing-notes finder keeps on real plan sets, for a person to judge note by note.
 * Never collected by CI (`.eval.ts`), and it writes only where DRAWING_SPECS_OUT says — the
 * notes are a client's words and stay off the repo. REAL_PLAN_DIR holds the sets;
 * DRAWING_SPECS_SETS is a comma list of file names.
 *
 *   REAL_PLAN_DIR=… DRAWING_SPECS_SETS="a.pdf,b.pdf" DRAWING_SPECS_OUT=/tmp/x.txt \
 *     npx vitest run --config vitest.eval.config.mts lib/specs/drawingSpecs.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.DRAWING_SPECS_OUT ?? "";
const SETS = (process.env.DRAWING_SPECS_SETS ?? "").split(",").filter(Boolean);

describe.skipIf(DIR === "" || OUT === "" || SETS.length === 0)("specs printed on real drawings", () => {
it("lists every requirement kept, by set and sheet", async () => {
  const out: string[] = [];
  const pagesRead: number[] = [];
  for (const set of SETS) {
    const pdf = await openPlanPdf(readFileSync(join(DIR, set)));
    let kept = 0;
    for (let page = 1; page <= pdf.pageCount; page++) {
      const text = await pdf.pageText(page);
      const sheet = sheetNumberFrom(text).sheetNumber;
      if (!searchesSheet(sheet)) continue;
      for (const note of drawingSpecNotes(text.items)) {
        kept += 1;
        out.push(`${set}\tp${page}\t${sheet ?? "?"}\t${note.sectionNumber}\t${note.text}`);
      }
    }
    for (let n = 1; n <= pdf.pageCount; n++) pagesRead.push(n);
    out.push(`# ${set}: ${kept} kept of ${pdf.pageCount} pages`);
    await pdf.close();
  }
  writeFileSync(OUT, out.join("\n") + "\n");
  // A mistyped folder or set name must fail, not read as "no specs printed anywhere".
  expect(pagesRead.length).toBeGreaterThan(0);
}, 900_000);
});
