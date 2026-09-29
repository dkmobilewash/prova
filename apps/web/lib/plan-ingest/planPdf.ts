import type { Buffer } from "node:buffer";

/**
 * READING A PLAN PDF ON THE SERVER — which six comments in this repo said was
 * impossible, and which is the premise this whole stage rests on.
 *
 * `takeoff.prisma`, `stages.ts`, `actions/planIngest.ts`, `takeoff/page.tsx` and
 * `docs/ai/DECISIONS.md` all said, in one form or another, that "the server has no
 * PDF library to read it with" and that "no server-side stage can open a plan file
 * at all until something rasterises it". Both halves are false, and the second is
 * the one that cost a week: it CONFLATES READING A PDF WITH RASTERISING ONE.
 *
 * Measured rather than argued, in Node, with the `pdfjs-dist` this app already
 * ships as a production dependency:
 *
 *   doc.numPages            works
 *   page.view / getViewport works — so the sheet's size in inches, and its
 *                           ROTATION, are both knowable server-side
 *   page.getTextContent()   works — and every item carries a `transform` matrix,
 *                           so each string's position is known, which is what
 *                           makes a title-block region filter possible at all
 *   page.render()           FAILS — `Cannot read properties of null (reading
 *                           'canvas')`. That is the only thing needing a canvas,
 *                           and nothing here calls it.
 *
 * WHY TEXT AND NOT AN IMAGE, since the step-1 plan's first option was to send the
 * page itself. An ARCH D sheet is 36 inches wide. Fitted to the high-resolution
 * tier's 2576px long edge that is 65 DPI, which puts the 1/8" text a title block
 * is lettered in at about EIGHT PIXELS tall (four and a half on the standard
 * tier's 1568px). Text extraction is not merely the cheap option, it is the only
 * one that can read a title block at all. The vector text is already in the file;
 * rasterising throws away the thing we came for.
 *
 * WHY THE WHOLE FILE IS HELD IN MEMORY, AND WHY THAT IS SAFE AT 250MB — measured,
 * after an earlier version of this comment asserted the opposite.
 *
 * It said a 250MB set "would need pdfjs opened with range support so memory stays
 * bounded, which is unproven here". Both halves turned out wrong. Ranging was tried:
 * pdfjs over HTTP with `disableAutoFetch` DOES issue Range requests and then fetches
 * the whole document anyway — 203 requests and 25.8MB served for a 12.9MB file — so it
 * bounds nothing. And the memory it was supposed to bound is not the problem:
 *
 *   119MB file, 900 pages, 200 pages read: peak RSS never rose above the process
 *   baseline, while genuinely extracting 112,092 characters.
 *
 * pdfjs is LAZY. It parses the objects a page needs, `page.cleanup()` releases them,
 * and the cost does not grow with how many pages a slice reads. So what is held is the
 * buffer, and `Buffer.from(arrayBuffer)` is a view rather than a copy, so the fetch
 * does not transiently double it. `PLAN_SET_UPLOAD_MAX_BYTES` carries the number and
 * the caveat the measurement cannot cover: a Vercel function's real ceiling.
 *
 * This is read ONCE PER INVOCATION by `PAGE_INVENTORY`, which makes no model call and
 * therefore gets the whole 45-second budget: the fetch is amortised over many pages
 * rather than over the one or two a model-calling stage would fit.
 */

/** One string as it is printed on the page, positioned in VIEWPORT space. */
export type PlanTextItem = {
  str: string;
  /** Points from the left edge of the page AS DISPLAYED. */
  x: number;
  /** Points from the TOP edge of the page as displayed. Screen convention, not
   *  PDF user space — see `openPlanPdf` for why the difference matters. */
  y: number;
  width: number;
  height: number;
};

/** One page's text and the size of the sheet it is printed on, as displayed. */
export type PlanPageText = {
  pageNumber: number;
  /** The page as DISPLAYED, in points — 72 to the inch, so a 36" sheet is 2592.
   *  Taken from the viewport, so a `/Rotate 90` landscape sheet reports its
   *  landscape dimensions rather than the portrait box underneath. */
  widthPt: number;
  heightPt: number;
  /** The page's own `/Rotate`, kept because a rotated sheet is the case this
   *  module's coordinate handling exists for and a reader should see it. */
  rotation: number;
  items: PlanTextItem[];
};

/** An open document. `close()` matters: pdfjs holds per-document state, and a
 *  stage that opens one per invocation must let each go. */
export type PlanPdf = {
  pageCount: number;
  pageText: (pageNumber: number) => Promise<PlanPageText>;
  close: () => Promise<void>;
};

/**
 * Opens a plan set for reading.
 *
 * THE IMPORT IS DYNAMIC AND THAT IS NOT A STYLE CHOICE. `TakeoffPlanViewer.tsx`
 * imports pdfjs inside a `useEffect` specifically to keep it "out of every server
 * graph so the `Can't resolve 'canvas'` build failure cannot arise" — pdfjs
 * declares `@napi-rs/canvas` as an OPTIONAL dependency. Requiring it at call time
 * rather than at module scope is what keeps this out of the client graph.
 *
 * AND IT NEEDS NOTHING IN `next.config.mjs`, WHICH THE FIRST VERSION GOT WRONG AND
 * CI CAUGHT. That version added `serverExternalPackages: ["pdfjs-dist"]`, reasoning
 * that the optional `canvas` import would fail resolution if webpack tried to bundle
 * it. That reasoning was untested, and it was wrong twice over. It was unnecessary —
 * the compile passes without it, because pdfjs's optional dependency does not break
 * resolution — and it was ACTIVELY BREAKING, because `serverExternalPackages` is
 * package-global: marking pdfjs external stopped webpack emitting the worker asset
 * the VIEWER references with `new URL("pdfjs-dist/legacy/build/pdf.worker.mjs",
 * import.meta.url)`, and the build failed in `TakeoffPlanViewer.tsx` — a file this
 * change never touched.
 *
 * Three CI jobs went red on it, all one root cause, and none of it was reachable
 * locally from `typecheck`, `lint` or 8,236 unit tests: a unit test imports this
 * through vitest and never through webpack. The build is the only instrument, and it
 * IS runnable here — it reaches `✓ Compiled successfully` before it exits on the
 * missing Clerk key, so the compile can be checked without any credentials at all.
 * Do that before touching how this module is loaded.
 *
 * EVERY POSITION IS PUT THROUGH THE VIEWPORT TRANSFORM, and this is a correctness
 * fix rather than tidiness. `getTextContent()` returns each item's `transform` in
 * UNROTATED PDF user space; `getViewport()` is what applies the page's own
 * `/Rotate`, which `takeoff.prisma:20` already says of the viewer. Plan sheets
 * exported from AutoCAD routinely carry `/Rotate 90`, so filtering on the raw x/y
 * would read a strip down the wrong edge on exactly those sheets — and the model
 * would then be handed a region with no title block in it, which reads as the
 * model failing. The first draft of this file had that bug.
 */
export async function openPlanPdf(bytes: Buffer): Promise<PlanPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    // A VIEW, NOT A COPY, and at 250MB the difference is 250MB. `new Uint8Array(buf)`
    // COPIES — a Node Buffer is already a Uint8Array, so that constructor allocates a
    // second one the same size and holds both until the first is collected. This form
    // shares the bytes. Found while raising the upload ceiling, at which point the
    // measurement this file rests on would have been off by a factor of two.
    data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    // The base-fourteen fonts need no embedding, and glyph outlines are only
    // needed to DRAW text. `getTextContent` reads the content stream's string
    // operators, so the missing-standard-fonts warning is irrelevant here — the
    // same reasoning `quoteFixtures.test.ts` records.
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  return {
    pageCount: doc.numPages,
    pageText: async (pageNumber: number) => {
      const page = await doc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: PlanTextItem[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !("transform" in item)) continue;
          const str = item.str;
          if (str.trim().length === 0) continue;
          // [a, b, c, d, e, f]; e and f are the translation once the viewport's
          // rotation and flip have been composed in, so y runs DOWN from the top.
          const m = pdfjs.Util.transform(viewport.transform, item.transform);
          items.push({ str, x: m[4], y: m[5], width: item.width, height: item.height });
        }
        return {
          pageNumber,
          widthPt: viewport.width,
          heightPt: viewport.height,
          rotation: page.rotate,
          items,
        };
      } finally {
        page.cleanup();
      }
    },
    close: async () => {
      await doc.destroy();
    },
  };
}

/**
 * WHERE A TITLE BLOCK IS, expressed as the union of the two conventions rather
 * than one guess.
 *
 * On almost every architectural sheet the title block is either a vertical strip
 * down the RIGHT edge or a horizontal band along the BOTTOM, and plenty of sheets
 * put the sheet number in the bottom-right corner of whichever they use. A filter
 * assuming one convention would silently drop the sheet number on every set drawn
 * the other way — and a dropped sheet number reads as the model failing, which is
 * the most expensive kind of wrong.
 *
 * So: the right 40% of the width, OR the bottom 25% of the height, in DISPLAYED
 * coordinates. Generous on purpose. Taking in too much costs a few hundred tokens;
 * taking in too little costs a wrong answer nobody can attribute.
 */
export const TITLE_BLOCK_RIGHT_FRACTION = 0.6;
export const TITLE_BLOCK_BOTTOM_FRACTION = 0.75;

/**
 * Whether the region was found, or the whole page is being used instead.
 *
 * THE FALLBACK IS NOT A CONVENIENCE. A sheet whose title block sits somewhere this
 * module does not expect — a European set, a consultant's own template, a sheet
 * rotated in a way the viewport does not normalise — would otherwise hand the
 * model an empty or near-empty region, and an empty region is indistinguishable
 * from a scanned page. Falling back to the whole page costs tokens and answers
 * correctly; refusing costs nothing and answers wrongly. `source` is carried
 * through to the proposal so a reader can see which happened.
 */
export type TitleBlockRegion = {
  items: PlanTextItem[];
  source: "region" | "whole-page";
};

/**
 * The title block's items, falling back to the whole page when the region is too
 * thin to be a title block.
 */
export function titleBlockRegion(page: PlanPageText): TitleBlockRegion {
  const xFrom = page.widthPt * TITLE_BLOCK_RIGHT_FRACTION;
  const yFrom = page.heightPt * TITLE_BLOCK_BOTTOM_FRACTION;
  const inRegion = page.items.filter((item) => item.x >= xFrom || item.y >= yFrom);
  if (inRegion.length >= MIN_TITLE_BLOCK_ITEMS) return { items: inRegion, source: "region" };
  return { items: page.items, source: "whole-page" };
}

/**
 * The title block as text for the model, in reading order.
 *
 * SORTED TOP-DOWN THEN LEFT-RIGHT, because pdfjs returns items in the order the
 * content stream draws them — the order the CAD program happened to emit, which
 * carries no meaning. A sheet number arriving after the revision table reads to a
 * model exactly as though it belonged to it.
 */
export function titleBlockText(page: PlanPageText): { text: string; source: TitleBlockRegion["source"] } {
  const region = titleBlockRegion(page);
  const sorted = [...region.items].sort((a, b) => {
    // Within a couple of points counts as the same line.
    if (Math.abs(a.y - b.y) > 2) return a.y - b.y;
    return a.x - b.x;
  });
  const lines: string[] = [];
  let currentY: number | null = null;
  let line: string[] = [];
  for (const item of sorted) {
    if (currentY === null || Math.abs(item.y - currentY) > 2) {
      if (line.length > 0) lines.push(line.join(" "));
      line = [];
      currentY = item.y;
    }
    line.push(item.str.trim());
  }
  if (line.length > 0) lines.push(line.join(" "));
  return { text: lines.join("\n"), source: region.source };
}

/**
 * Whether this page has a text layer worth reading at all.
 *
 * A SCANNED SHEET IS THE CASE THIS EXISTS FOR, and the answer is recorded as a
 * FACT rather than raised as a failure. A photocopied set has no vector text, so
 * there is nothing to extract and no prompt will invent a correct sheet number —
 * but "no text layer" is PERMANENT, and a stage returning `{ok: false}` for it
 * would fail three times with backoff, burn three allowance claims, and leave a
 * row whose Retry button can never succeed. A wholly scanned 300-page set would
 * produce 900 claims and a 300-row retry list. So this is written to the row and
 * the page is simply never sent to a model.
 *
 * The threshold is deliberately low: a title block carries at least a sheet
 * number, a title and a date, so three items is the floor below which there is
 * demonstrably nothing to read. Not a judgement about quality — just the
 * difference between "some text" and "none".
 */
export const MIN_TITLE_BLOCK_ITEMS = 3;

export function hasTextLayer(page: PlanPageText): boolean {
  return page.items.length >= MIN_TITLE_BLOCK_ITEMS;
}
