import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import {
  dimensionsFromWords,
  printedScaleIn,
  roomsFromWords,
  type ExpectedSheet,
} from "./expected";

/**
 * ── WRITES THE ANSWER KEY FROM WHAT THE DRAWING PRINTS ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/extract.eval.ts
 *
 * Run by hand, and the output is COMMITTED — so a key is reviewed once by a
 * person and then held still, rather than being recomputed on every run by the
 * same code it is meant to judge. If this script is ever wrong, the diff says
 * so loudly on the next run.
 *
 * It reads the TEXT LAYER only. No geometry, no detector, nothing from
 * `findWallsOnSheet`. The one thing it borrows from the product is
 * `sheetNumberFrom`, for the sheet number, which is a convenience and is
 * scored by nothing.
 */

const PLANS = join(import.meta.dirname, "plans");
const OUT = join(import.meta.dirname, "expected");

describe.skipIf(!existsSync(PLANS))("extract the printed answers", () => {
  it("writes one expected.json per fixture", async () => {
    const files = readdirSync(PLANS)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort();
    expect(files.length, "no fixtures found").toBeGreaterThan(0);

    const rows: string[] = ["", "id   scale                 rooms  with area  dims  raster  title"];
    for (const file of files) {
      const id = file.replace(/\.pdf$/i, "");
      const doc = await openPlanPdf(readFileSync(join(PLANS, file)));
      let sheet: ExpectedSheet;
      try {
        const text = await doc.pageText(1);
        const strokes = await doc.pageStrokes(1);
        const words = text.items.map((i) => i.str.trim()).filter((s) => s.length > 0);
        const raster = words.length === 0 && strokes.segments.length === 0;

        // EVERY printed scale, in order. A sheet with an enlarged view prints
        // two, and which one governs which view is a question this key does not
        // pretend to answer — it records both and the scorer accepts either.
        const scales = words.map(printedScaleIn).filter((s): s is string => s !== null);
        const unique = [...new Set(scales)];

        sheet = {
          id,
          title: words.find((w) => /^PLAN S\d+$/.test(w)) ? (words[words.indexOf(words.find((w) => /^PLAN S\d+$/.test(w))!) - 1] ?? null) : null,
          page: 1,
          sheetNumber: sheetNumberFrom(text).sheetNumber,
          raster,
          scale: unique[0] ?? null,
          scalesPrinted: unique,
          widthPt: Math.round(text.widthPt),
          heightPt: Math.round(text.heightPt),
          // Defaults to the ordinary case. The one sheet that contradicts
          // itself is marked by hand below, because establishing it took
          // arithmetic a person checked rather than a rule a script applied.
          scaleAuthority: raster ? "none" : unique.length > 0 ? "printed" : "none",
          rooms: roomsFromWords(words),
          dimensions: dimensionsFromWords(words, unique[0] ?? null),
          // NOT PRINTED ANYWHERE ON THIS SET. See `expected.ts` — the number
          // this product exists to get right is the one these cannot score.
          wallLfTotal: null,
          doorCount: null,
          windowCount: null,
          notes: raster
            ? ["No text layer and no vector strokes: this is a scan. Everything is null until the raster path exists."]
            : [],
        };
        if (!raster && unique.length === 0) {
          sheet.notes.push("No scale printed on this sheet. The app must DECLINE rather than guess.");
        }
        // ── HAND-MARKED, WITH THE ARITHMETIC THAT ESTABLISHED IT ──
        //
        // Not a rule, because the only way to DERIVE this is to measure the
        // drawing — and measuring it with the reader under test is how a key
        // stops being evidence. Verified once, by division, on a number any
        // reader can check against the sheet.
        if (id === "S11") {
          sheet.scaleAuthority = "dimensions-disagree";
          sheet.notes.push(
            "The title block prints 1/8\" = 1'-0\" and the sheet's own 31'-0\" dimension is 7.75 inches " +
              "long on a 17-inch page. 31 feet in 7.75 inches is 1/4\" to the foot, and all six dimensions " +
              "agree on it. The printed note is wrong, which is a common defect on a real set. Scale is " +
              "NOT scored here; what is scored is that the app reads the dimensions and says the two disagree.",
          );
        }
        if (unique.length > 1) {
          sheet.notes.push(`More than one view scale printed (${unique.join(", ")}); either is accepted.`);
        }
      } finally {
        await doc.close();
      }

      writeFileSync(join(OUT, `${id}.json`), `${JSON.stringify(sheet, null, 2)}\n`);
      const withArea = sheet.rooms.filter((r) => r.area !== null).length;
      rows.push(
        `${id.padEnd(4)} ${(sheet.scale ?? "—").padEnd(21)} ${String(sheet.rooms.length).padStart(5)}` +
          ` ${String(withArea).padStart(9)} ${String(sheet.dimensions.length).padStart(5)}` +
          ` ${String(sheet.raster).padStart(7)}  ${sheet.title ?? ""}`,
      );
    }
    console.log(rows.join("\n"));
  }, 300_000);
});
