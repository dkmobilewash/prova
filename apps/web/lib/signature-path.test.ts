import { describe, expect, it } from "vitest";
import { isValidSignaturePath, SIGNATURE_MAX_LENGTH } from "./signature-path";

/**
 * The stored signature is handed straight to an SVG `d` attribute on the job
 * page, so the accepted shape is the whole of its safety. These pin that
 * shape to exactly what apps/mobile/components/SignaturePad.tsx emits
 * (`strokesToPath`): `M`/`L`, whole pixels, one space, no separators.
 */
describe("isValidSignaturePath", () => {
  it("accepts what the phone draws: strokes, and a tap as a zero-length line", () => {
    expect(isValidSignaturePath("M10 20L30 40L50 60")).toBe(true);
    expect(isValidSignaturePath("M10 20L30 40M100 100L100 100")).toBe(true);
    expect(isValidSignaturePath("M0 0L320 160")).toBe(true);
  });

  it("refuses anything that is not that shape", () => {
    for (const bad of [
      "",
      "L10 10",
      "M10 10 L20 20",
      "M10,10L20,20",
      "M10 10C20 20 30 30 40 40",
      "M1.5 2L3 4",
      "M-1 2",
      'M1 1"/><script>alert(1)</script>',
      "M1 1Z",
    ]) {
      expect(isValidSignaturePath(bad), bad).toBe(false);
    }
    expect(isValidSignaturePath(null)).toBe(false);
    expect(isValidSignaturePath(42)).toBe(false);
  });

  it("refuses a point outside the 320x160 box", () => {
    expect(isValidSignaturePath("M321 10")).toBe(false);
    expect(isValidSignaturePath("M10 161")).toBe(false);
  });

  it("refuses a path longer than a signature needs", () => {
    const long = "M1 1" + "L1 1".repeat(SIGNATURE_MAX_LENGTH / 4);
    expect(long.length).toBeGreaterThan(SIGNATURE_MAX_LENGTH);
    expect(isValidSignaturePath(long)).toBe(false);
  });
});
