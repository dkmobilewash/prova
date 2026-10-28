import { describe, expect, it } from "vitest";
import { CAPTION_MIN_CONFIDENCE, captionTrusted, captionWordsAreReal, trustedScanViews } from "./scannedCaptions";

describe("which captions a scan can be trusted on", () => {
  it("real caption words pass; gibberish, even with one real word, does not", () => {
    for (const ok of ["FLOOR PLAN", "FIRST FLOOR PLAN", "EXTERIOR ELEVATIONS", "ENLARGED PLAN - UNIT A", "LEVEL 2", "PENTHOUSE FLOOR (P2)", "WALL TYPES", "KEY NOTES"]) {
      expect(captionWordsAreReal(ok), ok).toBe(true);
    }
    for (const bad of ["ÄLÖÖR PLÄN", "LRATING LEGEND", "FLOOR PLQN", "EQUIPMEMT PLAN", "", "###"]) {
      expect(captionWordsAreReal(bad), bad).toBe(false);
    }
  });
  it("needs the OCR line behind the caption to be confident, and no line means no trust", () => {
    const sure = [{ str: "FLOOR PLAN", confidence: 92 }];
    const unsure = [{ str: "FLOOR PLAN", confidence: CAPTION_MIN_CONFIDENCE - 1 }];
    expect(captionTrusted("FLOOR PLAN", sure)).toBe(true);
    expect(captionTrusted("FLOOR PLAN", unsure)).toBe(false);
    expect(captionTrusted("FLOOR PLAN", [])).toBe(false);
    expect(captionTrusted("FLOOR PLAN", [{ str: "FLOOR PLAN" }])).toBe(false);
    // Confident noise is still noise.
    expect(captionTrusted("LRATING LEGEND", [{ str: "LRATING LEGEND", confidence: 95 }])).toBe(false);
  });
  it("keeps the trusted views and drops the rest", () => {
    const items = [
      { str: "1 FLOOR PLAN", confidence: 90 },
      { str: "EXTERIOR ELEVATIONS", confidence: 88 },
      { str: "EQUIPMEMT PLAN", confidence: 85 },
    ];
    const views = [{ name: "FLOOR PLAN" }, { name: "EXTERIOR ELEVATIONS" }, { name: "EQUIPMEMT PLAN" }, { name: "KEY NOTES" }];
    expect(trustedScanViews(views, items).map((v) => v.name)).toEqual(["FLOOR PLAN", "EXTERIOR ELEVATIONS"]);
  });
});
