import { describe, expect, it } from "vitest";
import { wholeSheetFallback } from "./offeredCandidates";

describe("measuring the whole sheet when its drawings were found but none understood", () => {
  it("fires when drawings were found, none measured, and none set aside for a named reason — OCR noise read as captions", () => {
    expect(wholeSheetFallback([{ name: "ÄLÖÖR PLÄN" }, { name: "SCALE1/8 = 1-0" }], [])).not.toBeNull();
  });
  it("stays out when something was measured", () => {
    expect(wholeSheetFallback([{ name: "ÄLÖÖR PLÄN" }], [{}])).toBeNull();
  });
  it("stays out on a sheet of elevations, sections, details, notes or schedules — Baker A201 keeps its zero", () => {
    expect(wholeSheetFallback([{ name: "EXTERIOR ELEVATION" }, { name: "BUILDING SECTION" }], [])).toBeNull();
    expect(wholeSheetFallback([{ name: "WALL TYPES", textBlock: true }, { name: "GENERAL NOTES", textBlock: true }], [])).toBeNull();
    expect(wholeSheetFallback([{ name: "UNREADABLE" }, { name: "DOOR SCHEDULE", textBlock: true }], [])).toBeNull();
  });
  it("stays out when no drawing was found at all — the one-drawing branch already measures the sheet", () => {
    expect(wholeSheetFallback([], [])).toBeNull();
  });
});
