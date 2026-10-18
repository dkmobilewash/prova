import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import { standardFontDir } from "../bench/run";
import type { ExpectedSheet } from "./expected";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── LOOK AT THE DRAWING ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/overlay.eval.ts
 *
 * Writes one PNG per fixture into `fixtures/overlays/`: the sheet, faded, with
 * every run the pipeline claims drawn over it in red and the scale it read
 * printed in the corner.
 *
 * This is not decoration. A scorecard says a sheet produced no walls; only the
 * picture says WHY — that the pairer found the furniture and not the
 * partitions, or that it found one wall of a pair, or that the whole plan sits
 * outside the region something filtered. Every number in `score.eval.ts` that
 * surprises somebody should be followed by opening the matching image.
 *
 * The overlays are NOT committed. They are an output, they are large, and a
 * stale one is worse than none — regenerate before looking.
 */

const DIR = import.meta.dirname;
const OUT = join(DIR, "overlays");
const SIDE = 1600;

describe.skipIf(!existsSync(join(DIR, "plans")))("draw what the pipeline found", () => {
  it("writes one overlay per fixture", async () => {
    mkdirSync(OUT, { recursive: true });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

    const keys = readdirSync(join(DIR, "expected"))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(DIR, "expected", f), "utf8")) as ExpectedSheet);
    expect(keys.length).toBeGreaterThan(0);

    let drawn = 0;
    for (const key of keys) {
      const bytes = readFileSync(join(DIR, "plans", `${key.id}.pdf`));
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(bytes),
        verbosity: 0,
        standardFontDataUrl: standardFontDir(),
      }).promise;
      try {
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = SIDE / base.width;
        const vp = page.getViewport({ scale });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs's node canvas factory is untyped.
        const { canvas, context } = (doc as any).canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, vp.width, vp.height);
        await page.render({ canvasContext: context, viewport: vp }).promise;
        // Fade the drawing so the overlay reads over it.
        context.fillStyle = "rgba(255,255,255,0.6)";
        context.fillRect(0, 0, vp.width, vp.height);

        // The product's own path, read through the same functions the scorer
        // uses — an overlay drawn from a second implementation would be a
        // picture of something nobody ships.
        const { segmentsFromOpenPage } = await import("../sheetStrokes");
        const strokes = await segmentsFromOpenPage(page, pdfjs, 1);
        const content = await page.getTextContent();
        const items: SheetTextItem[] = (content.items as unknown[]).flatMap((raw) => {
          const i = raw as { str?: string; transform?: number[]; width?: number; height?: number };
          if (typeof i.str !== "string" || i.str.trim() === "" || !Array.isArray(i.transform)) return [];
          const m = pdfjs.Util.transform(base.transform, i.transform);
          return [{ str: i.str, x: m[4], y: m[5], width: i.width ?? 0, height: i.height ?? 0 }];
        });

        const verdict = readSheetScale(
          { widthPt: base.width, items },
          strokes.segments,
          dimensionLabels({
            pageNumber: 1,
            widthPt: base.width,
            heightPt: base.height,
            rotation: 0,
            items,
          }),
        );

        let caption = `${key.id}  —  printed ${key.scale ?? "no scale"}`;
        if (verdict.ok) {
          const feetPerUnit = (base.width / 72) * verdict.feetPerInch;
          const found = findWallsOnSheet({
            segments: strokes.segments as StrokeSegment[],
            textItems: items,
            pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
            feetPerUnit,
            wallTypes: [],
            sampledSheets: null,
          });
          const px = (u: number) => u * vp.width;
          context.lineWidth = Math.max(2.5, vp.width / 450);
          context.strokeStyle = "rgba(225,17,17,0.9)";
          for (const w of found.walls) {
            context.beginPath();
            context.moveTo(px(w.x1), px(w.y1));
            context.lineTo(px(w.x2), px(w.y2));
            context.stroke();
          }
          const ft = found.walls.reduce((n, w) => n + w.lengthFeet, 0);
          caption += `  —  read ${verdict.scaleName}  —  ${found.walls.length} runs, ${ft.toFixed(0)} ft`;
        } else {
          caption += `  —  SCALE DECLINED, nothing drawn`;
        }

        context.fillStyle = "#111";
        context.font = `bold ${Math.round(vp.width / 70)}px sans-serif`;
        context.fillText(caption, 20, Math.round(vp.width / 55));
        writeFileSync(join(OUT, `${key.id}.png`), canvas.toBuffer("image/png"));
        drawn += 1;
      } finally {
        await doc.destroy();
      }
    }
    console.log(`\nwrote ${drawn} overlays to ${OUT}\n`);
    expect(drawn).toBe(keys.length);
  }, 900_000);
});
