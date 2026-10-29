import { describe, expect, it } from "vitest";
import { isScannedSheet } from "./scannedSheet";

describe("what counts as a scanned sheet", () => {
  it("no text, no paths, an image: a scan", () => {
    expect(isScannedSheet({ hasTextLayer: false, pathOperators: 0, imageOperators: 1 })).toBe(true);
  });
  it("a text layer is a drawing, whatever else is on the page", () => {
    expect(isScannedSheet({ hasTextLayer: true, pathOperators: 0, imageOperators: 1 })).toBe(false);
  });
  it("no text but drawn paths: a drawing with its text outlined, not a scan", () => {
    expect(isScannedSheet({ hasTextLayer: false, pathOperators: 4_000, imageOperators: 0 })).toBe(false);
  });
  it("no text and nothing at all drawn is not a scan either — a blank page", () => {
    expect(isScannedSheet({ hasTextLayer: false, pathOperators: 0, imageOperators: 0 })).toBe(false);
  });
  it("a row from before the counts existed is judged by its text layer, as the viewer always did", () => {
    expect(isScannedSheet({ hasTextLayer: false, pathOperators: null, imageOperators: null })).toBe(true);
  });
});
