import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { existingMarks } from "../existingMarks";

/**
 * What `existingMarks` reads off real sheets — legend entries with their
 * swatch pens, the (E)-style tokens, and the tags — one block per sheet.
 *
 *     REAL_PLAN_DIR="<dir>[:<dir>]" EXISTING_SHEETS="<file>:<page>;<file>:<page>" \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/existingMarks.eval.ts
 *
 * No model, no labels, no database: it prints and asserts only that it read
 * something. Training sheets only; the output names legend WORDS, so it
 * goes under the takeoff shots folder, never into the repo.
 */
const DIRS = (process.env.REAL_PLAN_DIR ?? "").split(":").filter((d) => d !== "");
const SHEETS = (process.env.EXISTING_SHEETS ?? "").split(";").filter((s) => s.includes(":"));

describe.skipIf(DIRS.length === 0 || SHEETS.length === 0)("existing marks on real sheets", () => {
  for (const spec of SHEETS) {
    const at = spec.lastIndexOf(":");
    const set = spec.slice(0, at);
    const page = Number(spec.slice(at + 1));
    it(`${set} p${page}`, { timeout: 600_000 }, async () => {
      const path = DIRS.map((d) => join(d, set)).find((p) => existsSync(p));
      if (path === undefined) throw new Error(`${set} is in none of ${DIRS.join(", ")}`);
      const doc = await openPlanPdf(Buffer.from(readFileSync(path)));
      const text = await doc.pageText(page);
      const strokes = await doc.pageStrokes(page);
      if (text.items.length === 0 && strokes.pathOperators === 0) throw new Error(`${set} p${page}: no text and no paths — a bad page, not a result`);
      const m = existingMarks({ textItems: text.items, segments: strokes.segments, widthPt: text.widthPt });
      const pen = (p: { strokes: number; grayMedian: number; medianPieceIn: number; diagonalShare: number; widthMaxPt: number; grey: boolean; dashed: boolean; hatched: boolean }) =>
        `${p.strokes} strokes, gray ${p.grayMedian.toFixed(2)}, piece ${p.medianPieceIn.toFixed(2)} in, diag ${(100 * p.diagonalShare).toFixed(0)}%, w ${p.widthMaxPt.toFixed(1)}` +
        `${p.grey ? " GREY" : ""}${p.dashed ? " DASHED" : ""}${p.hatched ? " HATCHED" : ""}`;
      const lines = [`\nEM ${set} p${page}: legend ${m.legend.length}, tokens ${m.tokens.join(" ")}, tags ${m.tags.length} (${m.tags.filter((t) => t.kind === "NIC").length} NIC)`];
      for (const e of m.legend) lines.push(`   ${e.kind.padEnd(8)} "${e.words}" @ ${(e.x * 36).toFixed(1)},${(e.y * 36).toFixed(1)} in — ${pen(e.swatch)}`);
      for (const t of m.tags.slice(0, 12)) lines.push(`   tag ${t.kind.padEnd(8)} "${t.words}" @ ${(t.x * 36).toFixed(1)},${(t.y * 36).toFixed(1)} in`);
      if (m.tags.length > 12) lines.push(`   … ${m.tags.length - 12} more tags`);
      console.log(lines.join("\n"));
    });
  }
});
