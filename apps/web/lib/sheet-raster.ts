
/**
 * A PLAN SHEET AS A PICTURE, BECAUSE THE PHONE CANNOT RENDER A PDF.
 *
 * `apps/mobile` carries no PDF renderer and no WebView; its only graphics
 * dependency is `react-native-svg`. So the field half of plan pinning is an
 * `<Image>` of this raster with an SVG overlay on top — no new native module,
 * no EAS risk, and offline comes free because an image caches like any other.
 *
 * **CLAUDE.md SAYS `page.render()` FAILS SERVER-SIDE AND THAT WAS TRUE WHEN IT
 * WAS WRITTEN.** `lib/plan-ingest/planPdf.ts` records it: `Cannot read
 * properties of null (reading 'canvas')`. The cause was that pdfjs declares
 * `@napi-rs/canvas` as an OPTIONAL dependency and nothing had installed it.
 * With it present a page rasterises fine — measured 2026-10-04 against the
 * repo's own `e2e/fixtures/plan-sheet.pdf`. That paragraph in planPdf.ts is
 * still right about ITS job: plan INGEST reads text and wants no raster, and
 * "rasterising throws away the thing we came for" stands. This file wants the
 * opposite thing from the same library.
 *
 * **PNG, NOT JPEG, AND THAT IS MEASURED RATHER THAN ASSUMED.** On line-work a
 * PNG came out 27KB against JPEG's 43KB at the same width — the reverse of the
 * photo case, because a drawing is flat colour with hard edges and that is the
 * one thing PNG is good at and JPEG is worst at. JPEG also puts ringing on
 * every line, which on a drawing is noise exactly where the information is.
 */

/** How wide the raster is, in pixels.
 *
 * A NUMBER THAT IS A COMPROMISE AND SHOULD BE READ AS ONE. A D-size sheet is
 * 42 inches wide, so 2000px is about 48 dpi — legible for finding a wall and
 * dropping a pin on it, and NOT enough to read a dimension string. The phone
 * shows it at ~390pt wide, so this is roughly 5x what the screen has, which is
 * what makes pinch-zoom worth anything.
 *
 * Raising it is cheap to do and expensive on a tower crane with one bar of
 * signal, which is the deciding constraint rather than the file size itself. */
export const RASTER_WIDTH_PX = 2000;

export type RasterisedPage = {
  pageNumber: number;
  png: Buffer;
  widthPx: number;
  heightPx: number;
  /** The page's own size at scale 1, after pdf.js has applied /Rotate. The
   * page-width box is computed from these, so they travel with the image. */
  widthPt: number;
  heightPt: number;
};

/**
 * Render one page of a PDF to a PNG.
 *
 * The pdfjs import is dynamic for the reason `planPdf.ts` gives at length:
 * importing it at module scope drags it into every server graph that touches
 * this file, and the `Can't resolve 'canvas'` build failure follows.
 */
export async function rasterisePage(bytes: Buffer, pageNumber: number): Promise<RasterisedPage> {
  // BOTH IMPORTS ARE DYNAMIC AND NEITHER IS A STYLE CHOICE. `@napi-rs/canvas`
  // ships a native `.node` binary; imported at module scope it reaches the
  // actions barrel through `lib/actions/sheetPins.ts`, webpack tries to PARSE
  // the binary, and the build dies with "Module parse failed: Unexpected
  // character". Tests and typecheck stay green the whole time, because neither
  // bundles anything — this repo's rule that a passing build is necessary and
  // nowhere near sufficient, arriving from the other direction for once.
  //
  // `planPdf.ts` gives the same reasoning for pdfjs and adds the fix that does
  // NOT work: `serverExternalPackages` was tried there, was unnecessary, and
  // was actively breaking. Do not reach for it here either.
  const [{ createCanvas }, pdfjs] = await Promise.all([
    import("@napi-rs/canvas"),
    import("pdfjs-dist/legacy/build/pdf.mjs"),
  ]);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // Nothing here runs author-supplied script, and a plan set is a file a GC
    // sent us rather than one we wrote.
    isEvalSupported: false,
  }).promise;
  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error(`That PDF has ${doc.numPages} pages; page ${pageNumber} was asked for.`);
  }
  const page = await doc.getPage(pageNumber);
  const unit = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: RASTER_WIDTH_PX / unit.width });
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext("2d");

  // NO WHITE FILL HERE, AND THAT IS A DELETION RATHER THAN AN OMISSION.
  // This file carried `fillRect` with a comment saying a PDF page is
  // transparent where nothing is drawn. A mutation run would not go red
  // without it, which is the signal that something is dead — and the probe
  // said why: pdf.js paints the canvas white itself (its `background` option
  // defaults to white), so the pixel is 255,255,255,255 either way. The fill
  // was redundant and its comment was wrong. If a future pdf.js stops doing
  // that, the "paints paper white" test is what will say so.

  // THE CAST IS A TYPE MISMATCH, NOT A BEHAVIOUR ONE. pdf.js declares
  // `canvasContext` as the DOM `CanvasRenderingContext2D`; @napi-rs/canvas
  // hands back `SKRSContext2D`, which implements everything pdf.js calls and
  // omits `drawFocusIfNeeded` — a method that moves the browser's focus ring
  // and has no meaning off a page. Proved by running it: this renders the
  // repo's own plan-sheet fixture to a 2000px PNG.
  // `canvas` is not in pdf.js's published `RenderParameters` type but IS read
  // by the implementation off-DOM — without it the render throws
  // "Cannot read properties of null (reading 'canvas')", which is the exact
  // error CLAUDE.md records as "server-side rendering fails". It does not; the
  // argument was missing.
  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
    canvas,
  } as Parameters<typeof page.render>[0]).promise;
  return {
    pageNumber,
    png: canvas.toBuffer("image/png"),
    widthPx: canvas.width,
    heightPx: canvas.height,
    widthPt: unit.width,
    heightPt: unit.height,
  };
}

/** How many pages a plan set has, without rendering any of them. */
export async function countPages(bytes: Buffer): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  return doc.numPages;
}
