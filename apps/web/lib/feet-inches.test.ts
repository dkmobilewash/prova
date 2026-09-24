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
