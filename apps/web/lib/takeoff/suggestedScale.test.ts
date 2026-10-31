import { describe, expect, it } from "vitest";
import { suggestedCalibration, suggestionForm, suggestScaleFromDoors, wantsSuggestion } from "./suggestedScale";
import type { StrokeSegment } from "./wallVectors";

/** A door as CAD exports it, in points: a leaf and a swing flattened into short pieces. */
function door(atX: number, atY: number, leafInches: number, feetPerInch: number): StrokeSegment[] {
  const r = (leafInches / 12 / feetPerInch) * 72;
  const out: StrokeSegment[] = [{ x1: atX, y1: atY, x2: atX, y2: atY + r }];
  const steps = 16;
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * (Math.PI / 2);
    const b = ((i + 1) / steps) * (Math.PI / 2);
    out.push({ x1: atX + r * Math.sin(a), y1: atY + r * Math.cos(a), x2: atX + r * Math.sin(b), y2: atY + r * Math.cos(b) });
  }
  return out;
}
const plan = (leaves: readonly number[], feetPerInch: number) => leaves.flatMap((inches, i) => door(100 + i * 200, 100 + (i % 3) * 200, inches, feetPerInch));

describe("a scale suggested from the doors", () => {
  it("finds 1/8 from 3'-0\" doors, and says how many", () => {
    const s = suggestScaleFromDoors(plan([36, 36, 36, 36, 36, 36, 30], 8));
    expect(s?.scaleName).toBe('1/8" = 1\'-0"');
    expect(s?.doors).toBe(7);
  });
  it("finds 1/4 from a plan of 30\" doors, which no one mode rule would", () => {
    expect(suggestScaleFromDoors(plan([30, 30, 30, 30, 30, 32], 4))?.feetPerInch).toBe(4);
  });
  it("refuses on too few doors", () => {
    expect(suggestScaleFromDoors(plan([36, 36, 36, 36], 8))).toBeNull();
  });
  it("refuses a sheet with no doors, and an empty one", () => {
    expect(suggestScaleFromDoors([{ x1: 0, y1: 0, x2: 500, y2: 0 }])).toBeNull();
    expect(suggestScaleFromDoors([])).toBeNull();
  });
  it("refuses when the swings land on no door size at any scale", () => {
    expect(suggestScaleFromDoors(plan([33, 33, 33, 33, 33, 33], 7))).toBeNull();
  });
  it("refuses when arcs of other sizes outnumber the doors", () => {
    const doors = plan([36, 36, 36, 36, 36, 36], 8);
    expect(suggestScaleFromDoors(doors)?.feetPerInch).toBe(8);
    const noise = Array.from({ length: 8 }, (_, i) => door(100 + i * 200, 900, 58, 8)).flat();
    expect(suggestScaleFromDoors([...doors, ...noise])).toBeNull();
  });
});

describe("what Confirm saves", () => {
  const s = { scaleName: '1/8" = 1\'-0"', feetPerInch: 8, doors: 14 };
  const sheet = { planId: "plan_1", pageNumber: 3, widthPt: 3024, heightPt: 2160 };
  it("draws a line whose feet are that scale's feet", () => {
    const line = suggestedCalibration(s, sheet);
    const paperInches = ((line.x2 - line.x1) * sheet.widthPt) / 72;
    expect(line.declaredDistanceFeet).toBeCloseTo(paperInches * 8, 6);
  });
  it("is the ordinary calibration form, and the note says where it came from", () => {
    const form = suggestionForm(s, sheet);
    expect(form.get("planId")).toBe("plan_1");
    expect(form.get("pageNumber")).toBe("3");
    expect(JSON.parse(String(form.get("points"))).xs).toHaveLength(2);
    expect(form.get("note")).toContain("suggested from 14 doors and confirmed");
  });
});

describe("when a suggestion is worked out at all", () => {
  const bare = { calibrated: false, readOnly: false, labelling: false, printedPrefill: false, viewScales: 0 };
  it("on a sheet with no scale of any kind", () => expect(wantsSuggestion(bare)).toBe(true));
  it("never over a scale, a printed reading, a sheet of views, labelling, or a phone", () => {
    for (const other of [{ calibrated: true }, { printedPrefill: true }, { viewScales: 2 }, { labelling: true }, { readOnly: true }]) {
      expect(wantsSuggestion({ ...bare, ...other })).toBe(false);
    }
  });
});
