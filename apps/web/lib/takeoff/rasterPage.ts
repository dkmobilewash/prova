import type { Bitmap } from "./rasterStrokes";

/**
 * ── A PAGE OF PIXELS, FROM A PAGE THAT IS ALREADY OPEN ──
 *
 * Split from `rasterStrokes.ts` on purpose: the detector is pure and testable
 * on a bitmap written by hand, and nothing in it should need a PDF. This is
 * the one piece that does.
 *
 * It takes an OPEN page, the way `segmentsFromOpenPage` does, so a caller that
 * already has the document open does not pay to parse it twice.
 */

/** What a page costs to rasterise, and what it refuses. */
export const RASTER_DPI = 150;

/**
 * The most pixels this will allocate for one page.
 *
 * An ARCH E sheet at 300 dpi is 10,800 x 7,200, and the RGBA buffer behind
 * that is over 300 MB — enough to take a build runner down. 150 dpi on the
 * same sheet is a quarter of it, and the detector's thresholds are in points
 * so the answer does not move with the resolution (`rasterStrokes.test.ts`
 * pins that at 72, 150 and 300).
 *
 * A page that would exceed this is rendered SMALLER rather than refused, and
 * the dpi actually used is reported — so a very large sheet degrades instead
 * of disappearing, and the caller can see that it did.
 */
export const MAX_PIXELS = 40_000_000;

export type RasterPage = Bitmap & {
  /** The resolution actually used, which is not always the one asked for. */
  dpi: number;
  widthPt: number;
  heightPt: number;
};

export async function bitmapFromOpenPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs ships no types for the legacy build entry; `sheetStrokes.ts` takes the same position.
  page: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the document, for its canvas factory.
  doc: any,
  dpi: number = RASTER_DPI,
): Promise<RasterPage> {
  const base = page.getViewport({ scale: 1 });
  const wanted = dpi / 72;
  const would = Math.ceil(base.width * wanted) * Math.ceil(base.height * wanted);
  const scale = would > MAX_PIXELS ? wanted * Math.sqrt(MAX_PIXELS / would) : wanted;

  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const { canvas, context } = doc.canvasFactory.create(width, height);

  // A PDF page is transparent where nothing is drawn, and a transparent pixel
  // reads as BLACK once alpha is dropped — which would make every blank sheet
  // solid ink. Paper first.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context, viewport }).promise;

  const { data } = context.getImageData(0, 0, width, height);
  const grey = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < grey.length; i += 4, p += 1) {
    // Rec. 601 luma. The exact weights do not matter on a black-on-white
    // drawing, but a plan can carry a coloured revision cloud or a red stamp,
    // and a plain channel average would read those lighter than they look.
    grey[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  void canvas;

  return { grey, width, height, dpi: scale * 72, widthPt: base.width, heightPt: base.height };
}
