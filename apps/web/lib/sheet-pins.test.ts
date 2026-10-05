import { describe, expect, it } from "vitest";
import { MAX_NOTE_LENGTH, describePin, pinContentProblem, pinPlacementProblem } from "./sheet-pins";

/**
 * The page-width box in one fixture: a D-size sheet, 42" x 30". `y` therefore
 * runs 0..0.714 and NOT 0..1, which is the single fact most likely to be got
 * wrong by anyone touching this. A SQUARE fixture would pass every test below
 * while a y-axis bug sailed through, so there isn't one.
 */
const D_SIZE = { widthPt: 3024, heightPt: 2160 };
const MAX_Y = D_SIZE.heightPt / D_SIZE.widthPt; // 0.714…

describe("where a mark may land", () => {
  it("accepts a point inside the page-width box", () => {
    expect(pinPlacementProblem(0.5, 0.35, D_SIZE)).toBeNull();
  });

  it("REFUSES a y that is inside 0..1 but below the sheet", () => {
    // The whole reason this file exists. 0.9 is a perfectly good fraction and a
    // perfectly good `y` on a tall page — and it is off the bottom of a D-size
    // sheet. Anything that treats y as "0..1 of the height" passes this by
    // accident and puts the pin in the wrong place on every landscape drawing.
    expect(pinPlacementProblem(0.5, 0.9, D_SIZE)).toMatch(/below the bottom/i);
    expect(pinPlacementProblem(0.5, MAX_Y - 0.001, D_SIZE)).toBeNull();
  });

  it("accepts the very bottom edge, which rounding would otherwise refuse", () => {
    expect(pinPlacementProblem(0.5, MAX_Y, D_SIZE)).toBeNull();
  });

  it("refuses points off the left, right and top", () => {
    expect(pinPlacementProblem(-0.01, 0.2, D_SIZE)).toMatch(/off the sheet/i);
    expect(pinPlacementProblem(1.01, 0.2, D_SIZE)).toMatch(/off the sheet/i);
    expect(pinPlacementProblem(0.2, -0.01, D_SIZE)).toMatch(/off the sheet/i);
  });

  it("refuses NaN rather than storing it", () => {
    expect(pinPlacementProblem(Number.NaN, 0.2, D_SIZE)).toMatch(/off the sheet/i);
  });

  it("says so when the page has no size recorded yet", () => {
    expect(pinPlacementProblem(0.5, 0.3, { widthPt: 0, heightPt: 0 })).toMatch(/no size recorded/i);
  });
});

describe("what a pin must carry", () => {
  it("wants a photo for a photo pin and a punch item for a punch pin", () => {
    expect(pinContentProblem("PHOTO", {})).toMatch(/pick the photo/i);
    expect(pinContentProblem("PHOTO", { mediaId: "m1" })).toBeNull();
    expect(pinContentProblem("PUNCH", {})).toMatch(/pick the punch item/i);
    expect(pinContentProblem("PUNCH", { punchItemId: "p1" })).toBeNull();
  });

  it("wants words on a note pin, and not too many", () => {
    expect(pinContentProblem("NOTE", { note: "   " })).toMatch(/needs something written/i);
    expect(pinContentProblem("NOTE", { note: "Hold this wall for the owner" })).toBeNull();
    expect(pinContentProblem("NOTE", { note: "x".repeat(MAX_NOTE_LENGTH + 1) })).toMatch(/keep it under/i);
  });
});

describe("a pin whose target was deleted", () => {
  it("says the target is gone rather than disappearing", () => {
    // SetNull is deliberate: somebody stood there and flagged this. The pin
    // outlives the attachment, and the label has to make that legible instead
    // of reading like a bug.
    expect(describePin({ kind: "PHOTO", mediaId: null })).toBe("Photo (removed)");
    expect(describePin({ kind: "PUNCH", punchItemId: null })).toBe("Punch item (removed)");
  });

  it("uses the punch item's own words when it is still there", () => {
    expect(
      describePin({ kind: "PUNCH", punchItemId: "p1", punchItem: { description: "Patch soffit at grid C" } }),
    ).toBe("Patch soffit at grid C");
  });

  it("falls back to a word rather than an empty label", () => {
    expect(describePin({ kind: "NOTE", note: "   " })).toBe("Note");
  });
});
