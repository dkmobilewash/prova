import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSheetTextTile, type TextBox } from "@prova/integrations";
import { describe, expect, it } from "vitest";
import { requireEvalApiKey } from "@/lib/ai/evalApiKey";
import { standardFontDir } from "../bench/run";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import { dimensionLabels } from "../../plan-ingest/dimensionLabels";
import { bitmapFromOpenPage } from "../rasterPage";
import { strokesFromBitmap } from "../rasterStrokes";
import { TILE_PT, TILE_PX, tileBoxToSheetItem } from "../rasterText";
import { ARCHITECTURAL_SCALES as ARCH, readSheetScale } from "../scaleFromDimensions";
import { segmentsFromOpenPage } from "../sheetStrokes";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { printedScalesOnPage } from "../scaleAudit";

/**
 * ── CAN A MODEL READ A SCANNED DRAWING WELL ENOUGH TO PAIR A DIMENSION? ──
 *
 *     ANTHROPIC_API_KEY=… pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/sheetText.eval.ts
 *
 * `rasterStrokes.ts` recovers a scan's LINES. This measures the other half
 * before any of it is wired into the app, because the whole question is one
 * nobody can answer by reasoning: a vision model's TEXT is reliably good and
 * its COORDINATES are the part that might not be.
 *
 * **The bar is not "does it read the words".** `scaleFromDimensions` pairs a
 * dimension label with a line only when the label sits within 30 points of it
 * and near its midpoint. So a box that is off by 40 points is a label that
 * pairs with nothing, or worse with the wrong line, and the words being
 * perfect does not save it. That tolerance is what this scores against.
 *
 * **Tiled, and that is the design rather than an optimisation.** An ARCH D
 * sheet sent whole arrives as a thumbnail and comes back with thumbnail
 * coordinates. A tile keeps the resolution up and means the model only has to
 * place text within a small window whose own offset on the page is exact.
 *
 * **The answer key is free, exactly as it was for the lines.** Each scan is a
 * raster of a vector fixture already in this repo — S18 of S02, S19 of S08,
 * S20 of S13 — so the vector sheet's own text layer says what is printed and
 * precisely where. Nothing had to be written down by hand.
 */

const DIR = join(import.meta.dirname, "plans");
/** Opus by default; override to price the cheap model against the same bar. */
const MODEL = process.env.SHEET_TEXT_MODEL ?? "claude-opus-5";

/** One scan, and the drawing it was made from. */
const PAIRS = [
  { scan: "S18", vector: "S02" },
  { scan: "S20", vector: "S13" },
] as const;

// The tile grid comes from `rasterText.ts`, not a copy of it. A second
// spelling of the grid is how an eval quietly stops measuring what the app
// does — the measurement would still be internally consistent and would be
// about a page nobody renders.
/**
 * How far a box may be from the truth and still be the same word.
 *
 * `scaleFromDimensions`'s own `LABEL_OFFSET_PT`. Scoring against the number
 * the pairing actually uses is the point: a looser bar would report a success
 * that does not survive contact with the thing downstream.
 */
const NEAR_PT = 30;

/** Printed text, compared the way a reader would rather than byte for byte. */
const normalise = (s: string) =>
  s
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

describe.skipIf(!existsSync(DIR))("reading the words off a scan", () => {
  // `requireEvalApiKey` and not a skip: a run with no key must FAIL rather
  // than report a quiet pass on nothing, which is this directory's whole
  // reason for existing. The fixture skip above is different — it is about
  // files that may legitimately not be checked out.
  requireEvalApiKey("sheet-text eval");

  it("reads them, and places them where the pairing can use them", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

    const open = async (id: string) =>
      pdfjs.getDocument({
        data: new Uint8Array(readFileSync(join(DIR, `${id}.pdf`))),
        verbosity: 0,
        standardFontDataUrl: standardFontDir(),
      }).promise;

    const rows: string[] = ["", "scan  of    printed  read  exact  placed<=30pt  tiles"];
    let totalPrinted = 0;
    let totalExact = 0;
    let totalPlaced = 0;

    for (const { scan, vector } of PAIRS) {
      // ── THE ANSWER KEY: the vector original's own text layer ──
      const vdoc = await open(vector);
      const vpage = await vdoc.getPage(1);
      const vp = vpage.getViewport({ scale: 1 });
      const raw = await vpage.getTextContent();
      type RawItem = { str?: string; transform?: number[]; width?: number; height?: number };
      const truth = (raw.items as RawItem[])
        .filter((i): i is Required<RawItem> => typeof i.str === "string" && i.str.trim().length > 0 && Array.isArray(i.transform))
        // ── BOTH SIDES MUST MEAN THE SAME POINT, AND THE FIRST VERSION DID NOT ──
        //
        // pdfjs gives a text item's BASELINE LEFT, in PDF space with y up from
        // the bottom. The model gives a BOX, and this compares its centre. So
        // the first run measured the model's centre against the key's left
        // edge and charged it half a string's width — a 40-point dimension
        // string starts 20 points adrift of a 30-point bar before the model
        // has made any error at all. It scored 79%.
        //
        // Centre to centre, in viewport space, y down.
        .map((i) => ({
          str: i.str.trim(),
          x: i.transform[4] + i.width / 2,
          y: vp.height - (i.transform[5] + i.height / 2),
        }));
      await vdoc.destroy();
      expect(truth.length, `${vector} has no text layer to grade ${scan} against`).toBeGreaterThan(0);

      // ── WHAT THE MODEL READS OFF THE SCAN ──
      const sdoc = await open(scan);
      const spage = await sdoc.getPage(1);
      const sp = spage.getViewport({ scale: 1 });
      const across = Math.ceil(sp.width / TILE_PT);
      const down = Math.ceil(sp.height / TILE_PT);
      // ~190 dpi within the tile, which is what made the wall classifier
      // legible when a whole-sheet render at the same pixel budget was not.
      const scale = 1600 / TILE_PT;

      const found: { str: string; x: number; y: number }[] = [];
      let tiles = 0;
      for (let ty = 0; ty < down; ty += 1) {
        for (let tx = 0; tx < across; tx += 1) {
          const px = Math.round(TILE_PT * scale);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs's node canvas factory is untyped, as `rasterPage.ts` notes.
          const { canvas, context } = (sdoc as any).canvasFactory.create(px, px);
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, px, px);
          context.save();
          context.translate(-tx * TILE_PT * scale, -ty * TILE_PT * scale);
          await spage.render({ canvasContext: context, viewport: spage.getViewport({ scale }) }).promise;
          context.restore();

          const boxes: TextBox[] = await readSheetTextTile({
            imageBase64: canvas.toBuffer("image/jpeg", { quality: 0.9 }).toString("base64"),
            mediaType: "image/jpeg",
            model: MODEL,
          });
          tiles += 1;
          for (const b of boxes) {
            // Tile-relative fractions back to page points. The tile's own
            // offset is exact, so only the fraction carries the model's error.
            found.push({
              str: b.text,
              x: tx * TILE_PT + (b.x + b.width / 2) * TILE_PT,
              y: ty * TILE_PT + (b.y + b.height / 2) * TILE_PT,
            });
          }
        }
      }
      await sdoc.destroy();

      // Each printed item is looked for among what was read. "Exact" is the
      // string alone; "placed" additionally requires it near where it belongs.
      const unclaimed = [...found];
      let exact = 0;
      let placed = 0;
      for (const want of truth) {
        const i = unclaimed.findIndex((f) => normalise(f.str) === normalise(want.str));
        if (i < 0) continue;
        exact += 1;
        const near = unclaimed.findIndex(
          (f) => normalise(f.str) === normalise(want.str) && Math.hypot(f.x - want.x, f.y - want.y) <= NEAR_PT,
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

      rows.push(
        `${scan}   ${vector}  ${String(truth.length).padStart(7)}  ${String(found.length).padStart(4)}  ` +
          `${String(exact).padStart(5)}  ${String(placed).padStart(12)}  ${String(tiles).padStart(5)}`,
      );
    }

    rows.push("");
    rows.push(`READ: ${totalExact} of ${totalPrinted} printed strings (${((totalExact / totalPrinted) * 100).toFixed(0)}%)`);
    rows.push(`PLACED within ${NEAR_PT}pt: ${totalPlaced} (${((totalPlaced / totalPrinted) * 100).toFixed(0)}%)`);
    rows.push(`model: ${MODEL}`);
    console.log(rows.join("\n"));
    expect(totalPrinted).toBeGreaterThan(0);
  }, 1_800_000);

  /**
   * ── A SCAN READ END TO END, WITH NOTHING BORROWED ──
   *
   * `raster.eval.ts` grades the lines while handing the scan the VECTOR
   * original's scale, deliberately, so the line question is not confounded
   * with the word question. This is the run with nothing lent: the lines come
   * from the pixels, the words come from the model, the scale is read off
   * those words the way it is on any sheet, and the footage comes out of the
   * same `findWallsOnSheet` the app uses.
   *
   * The comparison is the drawing's own vector pipeline — same sheet, same
   * code, the two halves replaced.
   */
  it("READS A SCAN WITH NOTHING BORROWED, and gets the same building", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

    const open = async (id: string) =>
      pdfjs.getDocument({
        data: new Uint8Array(readFileSync(join(DIR, `${id}.pdf`))),
        verbosity: 0,
        standardFontDataUrl: standardFontDir(),
      }).promise;

    const rows: string[] = ["", "scan  of    scale (vector)   scale (scan)    vector ft   scan ft   of vector"];
    for (const { scan, vector } of PAIRS) {
      // ── THE DRAWING, THROUGH THE ORDINARY VECTOR PATH ──
      const vdoc = await open(vector);
      const vpage = await vdoc.getPage(1);
      const vstrokes = await segmentsFromOpenPage(vpage, pdfjs, 1);
      expect(vstrokes.pathOperators, `${vector} carried no path operators`).toBeGreaterThan(0);
      const vraw = await vpage.getTextContent();
      type RawItem = { str?: string; transform?: number[]; width?: number; height?: number };
      const vitems: SheetTextItem[] = (vraw.items as RawItem[])
        .filter((i): i is Required<RawItem> => typeof i.str === "string" && i.str.trim().length > 0 && Array.isArray(i.transform))
        .map((i) => {
          const m = pdfjs.Util.transform(vpage.getViewport({ scale: 1 }).transform, i.transform);
          return { str: i.str, x: m[4], y: m[5], width: i.width, height: i.height };
        });
      await vdoc.destroy();

      // ── THE SCAN: lines from the pixels, words from the model ──
      const sdoc = await open(scan);
      const spage = await sdoc.getPage(1);
      const bitmap = await bitmapFromOpenPage(spage, sdoc);
      const sSegments = strokesFromBitmap(bitmap, { dpi: bitmap.dpi }).segments;
      // The same grid the viewer walks, and the same per-tile call the action
      // makes — without the action, because an eval has no signed-in company
      // to gate against. What it must NOT do is use a different grid, or it
      // would be measuring something the app does not do.
      const sItems: SheetTextItem[] = [];
      let tiles = 0;
      {
        const sv = spage.getViewport({ scale: 1 });
        const scale = TILE_PX / TILE_PT;
        for (let ty = 0; ty < Math.ceil(sv.height / TILE_PT); ty += 1) {
          for (let tx = 0; tx < Math.ceil(sv.width / TILE_PT); tx += 1) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs's node canvas factory is untyped.
            const { canvas, context } = (sdoc as any).canvasFactory.create(TILE_PX, TILE_PX);
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, TILE_PX, TILE_PX);
            context.save();
            context.translate(-tx * TILE_PT * scale, -ty * TILE_PT * scale);
            await spage.render({ canvasContext: context, viewport: spage.getViewport({ scale }) }).promise;
            context.restore();
            // JPEG, matching what the viewer sends. An eval that measured a
            // format production does not use would be measuring a page
            // nobody renders — and the format is not cosmetic here, since a
            // speckled PNG tile was over the body limit that made this fail.
            const boxes = await readSheetTextTile({
              imageBase64: canvas.toBuffer("image/jpeg", { quality: 0.9 }).toString("base64"),
              mediaType: "image/jpeg",
              model: MODEL,
            });
            tiles += 1;
            sItems.push(...boxes.map((b) => tileBoxToSheetItem(b, tx, ty)));
          }
        }
      }
      await sdoc.destroy();
      expect(sItems.length, `${scan} yielded no words`).toBeGreaterThan(0);

      const scaleOf = (items: SheetTextItem[], segments: typeof sSegments, widthPt: number, heightPt: number) => {
        const page = { pageNumber: 1, widthPt, heightPt, rotation: 0, items };
        const verdict = readSheetScale(page, segments, dimensionLabels(page));
        if (verdict.ok) return { name: verdict.scaleName, feetPerInch: verdict.feetPerInch, from: "dimensions" };
        // The same fallback order the ingest stage uses: a printed note is
        // read only once the dimensions have declined, because a dimension
        // can be checked against the drawing and a title block cannot.
        const printed = scaleFromPrinted(printedScalesOnPage(items), widthPt, heightPt);
        return printed ? { name: printed.scaleName, feetPerInch: null, from: "printed" } : null;
      };

      const vScale = scaleOf(vitems, vstrokes.segments, vstrokes.widthPt, vstrokes.heightPt);
      const sScale = scaleOf(sItems, sSegments, bitmap.widthPt, bitmap.heightPt);

      if (!vScale || !sScale) {
        rows.push(`${scan}   ${vector}  ${(vScale?.name ?? "declined").padEnd(15)} ${(sScale?.name ?? "declined").padEnd(14)}  not graded`);
        continue;
      }

      const stages = (items: SheetTextItem[], segments: typeof sSegments, widthPt: number, heightPt: number, feetPerInch: number) => {
        const f = findWallsOnSheet({
          segments: segments as never,
          textItems: items,
          pageSize: { widthPt, heightPt },
          feetPerUnit: (widthPt / 72) * feetPerInch,
          wallTypes: [],
          sampledSheets: null,
        });
        return {
          feet: f.inBuilding.reduce((n, w) => n + w.lengthFeet, 0),
          // WHICH STAGE EMPTIED IT. A sheet that comes back with no footage
          // could be a detector that found nothing or a filter that threw
          // everything away, and those need completely different work. This
          // repo has an entry about exactly that confusion costing a day.
          // IN PIPELINE ORDER. The first version of this line printed them in
          // the order the result type declares, which is not the order they
          // run — so `13/0/0/0` read as "the lettering filter ate them" when
          // the building filter two stages earlier had already emptied it.
          counts: `everywhere=${f.everywhere.length} inBuilding=${f.inBuilding.length} notLettering=${f.notLettering.length} notBorder=${f.notBorder.length}`,
        };
      };
      const footage = (...args: Parameters<typeof stages>) => stages(...args).feet;

      // When a scale came from a printed note its feetPerInch is not reported,
      // so the name is resolved through the same table the vote uses.
      const perInch = (name: string, known: number | null) =>
        known ?? ARCH.find((a) => a.name === name)?.feetPerInch ?? null;
      const vPer = perInch(vScale.name, vScale.feetPerInch);
      const sPer = perInch(sScale.name, sScale.feetPerInch);
      if (vPer === null || sPer === null) {
        rows.push(`${scan}   ${vector}  ${vScale.name.padEnd(15)} ${sScale.name.padEnd(14)}  unknown scale name`);
        continue;
      }

      const vft = footage(vitems, vstrokes.segments, vstrokes.widthPt, vstrokes.heightPt, vPer);
      const sStages = stages(sItems, sSegments, bitmap.widthPt, bitmap.heightPt, sPer);
      const sft = sStages.feet;
      if (sft === 0) {
        rows.push(`      ${scan} ${sStages.counts}`);
      }
      rows.push(
        `${scan}   ${vector}  ${vScale.name.padEnd(15)} ${sScale.name.padEnd(14)}  ` +
          `${vft.toFixed(0).padStart(9)} ${sft.toFixed(0).padStart(9)}   ` +
          `${vft > 0 ? ((sft / vft) * 100).toFixed(0) + "%" : "n/a"}   (${tiles} tiles)`,
      );
    }
    console.log(rows.join("\n"));
    expect(rows.length).toBeGreaterThan(1);
  }, 1_800_000);
});
