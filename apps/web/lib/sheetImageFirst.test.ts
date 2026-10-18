import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A PREPARED SHEET MUST NOT MAKE THE BROWSER DOWNLOAD THE WHOLE PDF.
 *
 * Measured on production, 2026-10-05, against a real 113-sheet set: opening
 * ONE sheet pulled **46,337,022 bytes in a single request lasting 138
 * seconds**. That is the entire drawing set, to draw one page.
 *
 * **Range requests cannot fix it, and that was measured rather than assumed.**
 * Vercel Blob honours a range — `Range: bytes=0-1023` returns `206` with
 * exactly 1024 bytes. But `Accept-Ranges` and `Content-Range` are not
 * CORS-safelisted response headers, and the store sends no
 * `Access-Control-Expose-Headers`, so cross-origin JavaScript cannot read
 * them. The headers visible to JS are exactly `cache-control`,
 * `content-length`, `content-type`, `last-modified`. pdf.js reads
 * `Accept-Ranges` to decide (`validateRangeRequestCapabilities`), sees
 * nothing, and streams the whole file — so `disableAutoFetch` is a no-op.
 *
 * The working fix is to render the PNG that "Prepare for the phone" already
 * produces. One artefact, both surfaces.
 *
 * **The mutation that matters is deleting the early return**, which leaves a
 * viewer that looks identical, renders identically, and quietly costs 46MB a
 * sheet. Nothing else here can see that: no test in this repo measures a
 * network request, and the page renders correctly either way.
 */

const VIEWER = join(__dirname, "..", "components", "SheetPinViewer.tsx");

function source(): string {
  return readFileSync(VIEWER, "utf8");
}

/** Comments stripped — the file explains this trap at length in its own
 * header, so a raw-text census would find the words and call it done. */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("a prepared sheet renders from its picture, not from the PDF", () => {
  it("returns before pdf.js is even imported when the sheet has an image", () => {
    const text = code();
    const guard = text.indexOf("if (page.imageUrl)");
    const load = text.indexOf('import("pdfjs-dist');

    // The size/scope half: if either marker stops existing this census is
    // reasoning about a file that no longer does the thing.
    expect(guard, "the viewer no longer checks for a prepared image").toBeGreaterThan(-1);
    expect(load, "the viewer no longer loads pdf.js at all — this census is stale").toBeGreaterThan(-1);

    expect(
      guard,
      "the prepared-image check does not come before the pdf.js import. A prepared sheet will " +
        "download the entire PDF — 46MB and 138 seconds on a real 113-sheet set — to draw a page " +
        "whose picture was already made.",
    ).toBeLessThan(load);
  });

  it("renders an <img> for the prepared sheet and keeps the canvas for an unprepared one", () => {
    const text = code();
    // `<img\s` and not `<img` — the first draft of this matched `<imgX` too,
    // because `<img` is a prefix of it, and the mutation that renamed the tag
    // sailed through. A tag name needs its boundary asserted.
    expect(text, "no image element — a prepared sheet has nothing to draw into").toMatch(
      /<img\s[\s\S]{0,240}src=\{page\.imageUrl\}/,
    );
    expect(
      text,
      "the canvas is gone — an unprepared revision would have no way to show a sheet at all",
    ).toMatch(/<canvas ref=\{canvasRef\}/);
  });

  it("does not reach for disableAutoFetch, which is a no-op here", () => {
    // Recorded as a guard because it is the fix everyone proposes next, it
    // reads as obviously correct, and it does nothing: pdf.js has already
    // concluded ranges are unsupported before that option is consulted.
    expect(
      code(),
      "disableAutoFetch was added. It cannot help — the store does not expose Accept-Ranges " +
        "cross-origin, so pdf.js never enters range mode for this option to affect.",
    ).not.toMatch(/disableAutoFetch/);
  });
});
