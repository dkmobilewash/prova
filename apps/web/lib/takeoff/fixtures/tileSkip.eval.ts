import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { standardFontDir } from "../bench/run";
import { TILE_PT, TILE_PX } from "../rasterText";

/**
 * ── COULD A NEAR-BLANK TILE BE SKIPPED, AND WHAT WOULD IT COST? ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/tileSkip.eval.ts
 *
 * Reading a scanned sheet is one model call per tile — nine on a 24x18, fifteen
 * on a 36x24 — and most of a drawing is white paper. Skipping the empty ones
 * is the obvious saving, and the obvious saving is exactly the kind that
 * quietly loses a dimension string and takes the sheet's scale with it.
 *
 * **So the question is not "how many tiles are nearly blank".** It is whether
 * any threshold separates the tiles that hold WORDS from the tiles that do
 * not — and that is answerable for free, twice over: ink is counted from the
 * render, and the vector drawing each scan was made from says exactly where
 * its words are.
 *
 * No model is called. This measures whether a call could be skipped, not what
 * the call would have said.
 */

const DIR = join(import.meta.dirname, "plans");

const PAIRS = [
  { scan: "S18", vector: "S02" },
  { scan: "S19", vector: "S08" },
  { scan: "S20", vector: "S13" },
] as const;

/** A pixel this dark or darker is ink — the same figure `rasterStrokes` uses. */
const DARK_MAX = 160;

describe.skipIf(!existsSync(DIR))("skipping a tile with nothing on it", () => {
  it("says whether ink separates the tiles that hold words from the ones that do not", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

    const open = async (id: string) =>
      pdfjs.getDocument({
        data: new Uint8Array(readFileSync(join(DIR, `${id}.pdf`))),
        verbosity: 0,
        standardFontDataUrl: standardFontDir(),
      }).promise;

    const rows: string[] = [
      "",
      "scan  tiles  with words  empty  ink% of the emptiest WORDED tile  ink% of the inkiest EMPTY tile",
    ];
    let worstWorded = Number.POSITIVE_INFINITY;
    let worstEmpty = 0;
    let totalTiles = 0;
    let totalEmpty = 0;

    for (const { scan, vector } of PAIRS) {
      // ── WHERE THE WORDS REALLY ARE: the vector original's own text layer ──
      const vdoc = await open(vector);
      const vpage = await vdoc.getPage(1);
      const vp = vpage.getViewport({ scale: 1 });
      const raw = await vpage.getTextContent();
      type RawItem = { str?: string; transform?: number[] };
      const words = (raw.items as RawItem[])
        .filter((i): i is Required<RawItem> => typeof i.str === "string" && i.str.trim().length > 0 && Array.isArray(i.transform))
        .map((i) => {
          const m = pdfjs.Util.transform(vp.transform, i.transform);
          return { x: m[4], y: m[5] };
        });
      await vdoc.destroy();
      expect(words.length, `${vector} has no text layer to locate words with`).toBeGreaterThan(0);

      const sdoc = await open(scan);
      const spage = await sdoc.getPage(1);
      const sv = spage.getViewport({ scale: 1 });
      const scale = TILE_PX / TILE_PT;
      const across = Math.ceil(sv.width / TILE_PT);
      const down = Math.ceil(sv.height / TILE_PT);

      let tiles = 0;
      let worded = 0;
      let empty = 0;
      let emptiestWorded = Number.POSITIVE_INFINITY;
      let inkiestEmpty = 0;

      for (let ty = 0; ty < down; ty += 1) {
        for (let tx = 0; tx < across; tx += 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs's node canvas factory is untyped.
          const { canvas, context } = (sdoc as any).canvasFactory.create(TILE_PX, TILE_PX);
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, TILE_PX, TILE_PX);
          context.save();
          context.translate(-tx * TILE_PT * scale, -ty * TILE_PT * scale);
          await spage.render({ canvasContext: context, viewport: spage.getViewport({ scale }) }).promise;
          context.restore();

          const { data } = context.getImageData(0, 0, TILE_PX, TILE_PX);
          let ink = 0;
          for (let i = 0; i < data.length; i += 4) {
            if ((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 <= DARK_MAX) ink += 1;
          }
          const inkFraction = ink / (TILE_PX * TILE_PX);

          const x0 = tx * TILE_PT;
          const y0 = ty * TILE_PT;
          const hasWords = words.some(
            (w) => w.x >= x0 && w.x < x0 + TILE_PT && w.y >= y0 && w.y < y0 + TILE_PT,
          );

          tiles += 1;
          if (hasWords) {
            worded += 1;
            emptiestWorded = Math.min(emptiestWorded, inkFraction);
          } else {
            empty += 1;
            inkiestEmpty = Math.max(inkiestEmpty, inkFraction);
          }
          void canvas;
        }
      }
      await sdoc.destroy();

      totalTiles += tiles;
      totalEmpty += empty;
      worstWorded = Math.min(worstWorded, emptiestWorded);
      worstEmpty = Math.max(worstEmpty, inkiestEmpty);

      const pct = (v: number) => (v * 100).toFixed(3);
      rows.push(
        `${scan}  ${String(tiles).padStart(5)}  ${String(worded).padStart(10)}  ${String(empty).padStart(5)}  ` +
          `${pct(emptiestWorded).padStart(28)}  ${pct(inkiestEmpty).padStart(29)}`,
      );
    }

    rows.push("");
    rows.push(`tiles that hold no words: ${totalEmpty} of ${totalTiles} (${((totalEmpty / totalTiles) * 100).toFixed(0)}%)`);
    rows.push(`emptiest WORDED tile anywhere: ${(worstWorded * 100).toFixed(3)}% ink`);
    rows.push(`inkiest WORDLESS tile anywhere: ${(worstEmpty * 100).toFixed(3)}% ink`);
    rows.push(
      worstEmpty < worstWorded
        ? `SEPARABLE: any threshold between them skips ${totalEmpty} calls and loses no word.`
        : `NOT SEPARABLE: a wordless tile carries more ink than a worded one, so no ink threshold is safe.`,
    );
    console.log(rows.join("\n"));
    expect(totalTiles).toBeGreaterThan(0);
  }, 900_000);
});
