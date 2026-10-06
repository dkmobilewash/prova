import { describe, expect, it } from "vitest";

import { formatFeetInches, parseFeetInches } from "./feet-inches";

const feet = (raw: string): number | string => {
  const result = parseFeetInches(raw, { label: "Distance" });
  return result.ok ? result.n : result.error;
};

describe("reading a dimension the way a drawing prints it", () => {
  it("reads the forms an estimator actually types", () => {
    expect(feet("24'-6\"")).toBeCloseTo(24.5, 6);
    expect(feet("24' 6\"")).toBeCloseTo(24.5, 6);
    expect(feet("24'6\"")).toBeCloseTo(24.5, 6);
    expect(feet("24-6")).toBeCloseTo(24.5, 6);
  });

  it("reads feet alone and inches alone", () => {
    expect(feet("24'")).toBeCloseTo(24, 6);
    expect(feet('6"')).toBeCloseTo(0.5, 6);
  });

  it("reads a fractional inch", () => {
    expect(feet("24'-6 1/2\"")).toBeCloseTo(24 + 6.5 / 12, 6);
    expect(feet('1/2"')).toBeCloseTo(0.5 / 12, 6);
  });

  it("accepts the curly marks autocorrect produces", () => {
    expect(feet("24′-6″")).toBeCloseTo(24.5, 6);
  });

  it("hands a plain decimal straight to the app's own parser", () => {
    expect(feet("24.5")).toBeCloseTo(24.5, 6);
    expect(feet("24")).toBeCloseTo(24, 6);
    // The thousands comma is the proof of delegation: this module never
    // learned about it, `parseNumericInput` did, and that is the point.
    expect(feet("2,800")).toBeCloseTo(2800, 6);
  });

  it("refuses inches that should have been written as feet", () => {
    expect(feet("24'-18\"")).toMatch(/more than a foot/);
  });

  it("refuses a blank", () => {
    expect(feet("   ")).toMatch(/needs a measurement/);
  });

  it("refuses something that is not a measurement at all", () => {
    expect(typeof feet("about a room wide")).toBe("string");
  });

  it("applies the caller's bounds whichever way the figure was written", () => {
    const low = parseFeetInches("2\"", { label: "Distance", min: 1 });
    expect(low.ok).toBe(false);
    const ok = parseFeetInches("24'-6\"", { label: "Distance", min: 1 });
    expect(ok.ok).toBe(true);
  });
});

describe("reading a figure back", () => {
  it("prints decimal feet the way the drawing does", () => {
    expect(formatFeetInches(24.5)).toBe("24'-6\"");
    expect(formatFeetInches(24)).toBe("24'-0\"");
    expect(formatFeetInches(0.5)).toBe("0'-6\"");
  });

  it("rounds to the nearest inch rather than printing a float", () => {
    // A correct entry must not read as wrong: 24'-5.997" would.
    expect(formatFeetInches(24.49975)).toBe("24'-6\"");
  });

  it("round-trips what it parsed", () => {
    for (const written of ["24'-6\"", "8'-0\"", "0'-3\""]) {
      const parsed = parseFeetInches(written);
      expect(parsed.ok).toBe(true);
      expect(formatFeetInches((parsed as { n: number }).n)).toBe(written);
    }
  });
});

/**
 * THE SPACED HYPHEN, which is how a drawing prints a dimension and therefore how
 * somebody copying one types it.
 *
 * `.replace(/^-/, "")` ran BEFORE `.trim()` for months, so the hyphen in
 * `24' - 6"` survived and was read as a MINUS SIGN: the figure came back "can't
 * be negative". `24'-6"` worked, and so did any dimension whose inches were
 * ZERO — zero is not negative — which is exactly why it stayed hidden. The
 * field's own placeholder is `24'-6"` without spaces.
 *
 * Found 2026-10-06 by pointing the automatic-scale reader at a real CAD export:
 * 3 of its 32 printed dimensions parsed, and all three ended `- 0"`.
 */
describe("a dimension typed the way a drawing prints it", () => {
  it("reads a SPACED hyphen, which the placeholder's own form does not have", () => {
    expect(parseFeetInches(`24' - 6"`, { label: "x" })).toMatchObject({ ok: true, n: 24.5 });
    expect(parseFeetInches(`1' - 2"`, { label: "x" })).toMatchObject({ ok: true, n: 1 + 2 / 12 });
    expect(parseFeetInches(`16' - 4 1/2"`, { label: "x" })).toMatchObject({ ok: true });
  });

  it("reads the unspaced form it always did", () => {
    expect(parseFeetInches(`24'-6"`, { label: "x" })).toMatchObject({ ok: true, n: 24.5 });
  });

  it("still reads the ZERO-inch case that masked the bug", () => {
    expect(parseFeetInches(`11' - 0"`, { label: "x" })).toMatchObject({ ok: true, n: 11 });
  });

  it("reads fractions of an inch to the sixteenth", () => {
    expect(parseFeetInches(`15' - 3 7/16"`, { label: "x" })).toMatchObject({ ok: true });
    const r = parseFeetInches(`15' - 3 7/16"`, { label: "x" });
    expect(r.ok && r.n).toBeCloseTo(15 + (3 + 7 / 16) / 12, 5);
  });

  it("STILL REFUSES A NEGATIVE FEET-AND-INCHES FIGURE, which the fix must not admit", () => {
    // The hyphen being stripped is about a SEPARATOR, not about signs: a minus
    // in front of the FEET must still be refused, or the fix has traded one
    // defect for another.
    expect(parseFeetInches(`-24' - 6"`, { label: "x" }).ok).toBe(false);
    expect(parseFeetInches(`-24'-6"`, { label: "x" }).ok).toBe(false);
  });

  it("leaves a BARE negative decimal to the caller's `min`, as it always has", () => {
    // Measured rather than assumed, and the first version of the test above got
    // it wrong: `-6` with no `min` parses to -6, because the plain-decimal path
    // has no opinion about sign. That is pre-existing and unchanged by the
    // hyphen fix — callers that need a floor pass one, as the calibration does
    // (`min: 0.01`) and as the dimension reader does (`min: 0.5`).
    expect(parseFeetInches("-6", { label: "x" })).toMatchObject({ ok: true, n: -6 });
    expect(parseFeetInches("-6", { label: "x", min: 0.5 }).ok).toBe(false);
  });
});
