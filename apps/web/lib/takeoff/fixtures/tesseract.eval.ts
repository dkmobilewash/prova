import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { standardFontDir } from "../bench/run";
import { TILE_PT, tileBoxToSheetItem } from "../rasterText";

/**
 * Pixels across a tile FOR TESSERACT, and deliberately not the app's 1600.
 *
 * 1600 over a 600-point tile is about 190 dpi, chosen because that is what
 * made a drawing legible to a vision model. An OCR engine is a different
 * instrument with a different appetite: Tesseract's own documentation asks for
 * 300 dpi and upward, and thin architectural lettering is the hard case for
 * it. Measuring it at the model's resolution would be testing the harness
 * rather than the engine — so it gets 3200, about 384 dpi, and the comparison
 * is of each tool at a resolution that suits it.
 */
const TESSERACT_TILE_PX = 3200;

/**
 * ── COULD AN OCR ENGINE DO THIS FOR NOTHING? ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/tesseract.eval.ts
 *
 * Reading a scanned sheet costs about fifteen Opus calls, and a contractor
 * with a scanned set has a lot of sheets. Tesseract is Apache-2.0, runs as
 * WASM, and would cost nothing per page — and because it can run in the
 * BROWSER, the drawing would never leave the machine at all, which is
 * stronger than the confidentiality rule requires rather than weaker.
 *
 * **It is measured against exactly the bar the model was measured against**,
 * on the same two fixtures, the same tiles, the same 30-point tolerance, and
 * the same answer key — the vector drawings the scans were made from. A
 * cheaper thing that is measured differently has not been compared.
 *
 *   Opus 5:   101 of 101 strings read exactly, 99 (98%) placed within 30pt
 *
 * **Placement is the half that decides.** Haiku read 88% of the words and
 * placed 16%, and was refused for it: a label more than 30 points from its
 * line pairs with nothing and votes on nothing. An OCR engine's native output
 * is word boxes, so this is the thing it should be good at — which is the
 * whole reason the experiment is worth running.
 */

const DIR = join(import.meta.dirname, "plans");

const PAIRS = [
  { scan: "S18", vector: "S02" },
  { scan: "S20", vector: "S13" },
] as const;

/** `scaleFromDimensions`'s own `LABEL_OFFSET_PT` — the bar that matters. */
const NEAR_PT = 30;

/** One recognised word, as tesseract.js nests them under blocks. */
type TessWord = { text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number } };

/**
 * Every word in a recognition result, however deep it is nested.
 *
 * Walked defensively rather than reached for by path: the shape has moved
 * between tesseract.js majors (`data.words` at the top in v4, under
 * blocks → paragraphs → lines → words since), and a path that silently
 * resolves to nothing would report this engine as reading zero words — a
 * verdict indistinguishable from it being bad at the job.
 */
function wordsOf(data: unknown): TessWord[] {
  const out: TessWord[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const row = node as Record<string, unknown>;
    const bbox = row.bbox as TessWord["bbox"];
    const isContainer = "words" in row || "lines" in row || "paragraphs" in row || "blocks" in row;
    if (typeof row.text === "string" && bbox && typeof bbox.x0 === "number" && !isContainer) {
      out.push({ text: row.text, bbox });
    }
    for (const key of ["blocks", "paragraphs", "lines", "words"]) {
      if (key in row) walk(row[key]);
    }
  };
  walk(data);
  return out;
}

const normalise = (s: string) =>
  s
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

describe.skipIf(!existsSync(DIR))("reading a scan with Tesseract instead of a model", () => {
  it("reads them, and places them where the pairing can use them", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const { createWorker } = await import("tesseract.js");

    const open = async (id: string) =>
      pdfjs.getDocument({
        data: new Uint8Array(readFileSync(join(DIR, `${id}.pdf`))),
        verbosity: 0,
        standardFontDataUrl: standardFontDir(),
      }).promise;

    const worker = await createWorker("eng");
    const rows: string[] = ["", "scan  of    printed  read  exact  placed<=30pt  tiles  seconds"];
    let totalPrinted = 0;
    let totalExact = 0;
    let totalPlaced = 0;

    try {
      for (const { scan, vector } of PAIRS) {
        // ── THE ANSWER KEY: the vector original's own text layer ──
        const vdoc = await open(vector);
        const vpage = await vdoc.getPage(1);
        const vp = vpage.getViewport({ scale: 1 });
        const raw = await vpage.getTextContent();
        type RawItem = { str?: string; transform?: number[]; width?: number; height?: number };
        const truth = (raw.items as RawItem[])
          .filter(
            (i): i is Required<RawItem> =>
              typeof i.str === "string" && i.str.trim().length > 0 && Array.isArray(i.transform),
          )
          // Centre to centre, as `sheetText.eval.ts` does — comparing a centre
          // against a baseline-left charges half a string's width before
          // anything has gone wrong, which is a ruler fault and cost an
          // earlier measurement 19 points.
          .map((i) => ({
            str: i.str.trim(),
            x: i.transform[4] + i.width / 2,
            y: vp.height - (i.transform[5] + i.height / 2),
          }));
        await vdoc.destroy();
        expect(truth.length, `${vector} has no text layer to grade ${scan} against`).toBeGreaterThan(0);

        const sdoc = await open(scan);
        const spage = await sdoc.getPage(1);
        const sv = spage.getViewport({ scale: 1 });
        const scale = TESSERACT_TILE_PX / TILE_PT;
        const found: { str: string; x: number; y: number }[] = [];
        let tiles = 0;
        const started = Date.now();

        for (let ty = 0; ty < Math.ceil(sv.height / TILE_PT); ty += 1) {
          for (let tx = 0; tx < Math.ceil(sv.width / TILE_PT); tx += 1) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs's node canvas factory is untyped.
            const { canvas, context } = (sdoc as any).canvasFactory.create(TESSERACT_TILE_PX, TESSERACT_TILE_PX);
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, TESSERACT_TILE_PX, TESSERACT_TILE_PX);
            await spage.render({
              canvasContext: context,
              viewport: spage.getViewport({ scale }),
              transform: [1, 0, 0, 1, -tx * TILE_PT * scale, -ty * TILE_PT * scale],
            }).promise;

            // `blocks: true` is what makes word boxes available at all in
            // tesseract.js 7 — without it the reply carries only the page's
            // text, and the COORDINATES are the entire point of this test.
            const { data } = await worker.recognize(
              canvas.toBuffer("image/png"),
              {},
              { blocks: true },
            );
            tiles += 1;
            for (const word of wordsOf(data)) {
              const b = word.bbox;
              if (!b || typeof word.text !== "string" || word.text.trim() === "") continue;
              // Tesseract gives PIXEL boxes on the tile. The same conversion
              // the model's fractional boxes go through, so both are scored in
              // identical page coordinates.
              found.push(
                (({ x, y, str }) => ({ x, y, str }))({
                  ...tileBoxToSheetItem(
                    {
                      text: word.text,
                      x: b.x0 / TESSERACT_TILE_PX,
                      y: b.y0 / TESSERACT_TILE_PX,
                      width: (b.x1 - b.x0) / TESSERACT_TILE_PX,
                      height: (b.y1 - b.y0) / TESSERACT_TILE_PX,
                    },
                    tx,
                    ty,
                  ),
                  // tileBoxToSheetItem reports the BASELINE; centre for scoring.
                  x: tx * TILE_PT + ((b.x0 + b.x1) / 2 / TESSERACT_TILE_PX) * TILE_PT,
                  y: ty * TILE_PT + ((b.y0 + b.y1) / 2 / TESSERACT_TILE_PX) * TILE_PT,
                  str: word.text,
                }),
              );
            }
          }
        }
        const seconds = (Date.now() - started) / 1000;
        await sdoc.destroy();

        const unclaimed = [...found];
        let exact = 0;
        let placed = 0;
        for (const want of truth) {
          const i = unclaimed.findIndex((f) => normalise(f.str) === normalise(want.str));
          if (i < 0) continue;
          exact += 1;
          const near = unclaimed.findIndex(
            (f) =>
              normalise(f.str) === normalise(want.str) &&
              Math.hypot(f.x - want.x, f.y - want.y) <= NEAR_PT,
          );
          if (near >= 0) {
            placed += 1;
            unclaimed.splice(near, 1);
          } else {
            unclaimed.splice(i, 1);
          }
        }
        totalPrinted += truth.length;
        totalExact += exact;
        totalPlaced += placed;

        // ── WHAT IT ACTUALLY SAW, BEFORE ANY VERDICT ──
        //
        // A low score has two very different causes and the number cannot
        // tell them apart: the engine misread the drawing, or it TOKENISES
        // differently — Tesseract emits words, the answer key holds whole
        // strings, so `24'-6 1/2"` arriving as three words scores zero while
        // being perfectly read. Printing both sides is the only way to know
        // which, and the conclusion is worthless without it.
        rows.push(`      ${scan} tesseract read, first 12: ${found.slice(0, 12).map((f) => JSON.stringify(f.str)).join(" ")}`);
        rows.push(`      ${scan} key wanted,    first 12: ${truth.slice(0, 12).map((t) => JSON.stringify(t.str)).join(" ")}`);

        rows.push(
          `${scan}   ${vector}  ${String(truth.length).padStart(7)}  ${String(found.length).padStart(4)}  ` +
            `${String(exact).padStart(5)}  ${String(placed).padStart(12)}  ${String(tiles).padStart(5)}  ${seconds.toFixed(0).padStart(7)}`,
        );
      }
    } finally {
      await worker.terminate();
    }

    rows.push("");
    rows.push(`READ: ${totalExact} of ${totalPrinted} printed strings (${((totalExact / totalPrinted) * 100).toFixed(0)}%)`);
    rows.push(`PLACED within ${NEAR_PT}pt: ${totalPlaced} (${((totalPlaced / totalPrinted) * 100).toFixed(0)}%)`);
    rows.push("the bar, from sheetText.eval.ts on Opus 5: 101 of 101 read (100%), 99 placed (98%)");
    console.log(rows.join("\n"));
    expect(totalPrinted).toBeGreaterThan(0);
  }, 1_800_000);
});
