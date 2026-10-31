import { describe, expect, it } from "vitest";
import { feetPerInchOf, gridAxes, scaleVotes, suggestedCalibration, suggestionForm, suggestScale, suggestScaleFromDoors, wantsSuggestion } from "./suggestedScale";
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
    expect(s?.because).toBe("7 doors");
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
  const s = { scaleName: '1/8" = 1\'-0"', feetPerInch: 8, because: "14 doors" };
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

/** A grid bubble: a flattened circle with its label's text item inside it. */
function bubble(x: number, y: number, label: string) {
  const r = 12;
  const segments: StrokeSegment[] = [];
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * 2 * Math.PI;
    const b = ((i + 1) / 24) * 2 * Math.PI;
    segments.push({ x1: x + r * Math.cos(a), y1: y + r * Math.sin(a), x2: x + r * Math.cos(b), y2: y + r * Math.sin(b), curved: true });
  }
  return { segments, text: { str: label, x: x - 3, y: y + 4, width: 6, height: 8 } };
}
/** A row of bubbles with these spans, in feet, on a sheet at this scale. */
function grid(spansFeet: readonly number[], feetPerInch: number) {
  let x = 100;
  const heads = [bubble(x, 100, "1")];
  spansFeet.forEach((feet, i) => {
    x += (feet / feetPerInch) * 72;
    heads.push(bubble(x, 100, String(i + 2)));
  });
  return { segments: heads.flatMap((h) => h.segments), text: heads.map((h) => h.text) };
}

describe("the grid on another sheet", () => {
  const known = grid([24, 30, 24, 30], 4);
  const reference = { feetPerInch: 4, axes: gridAxes(known.segments, known.text) };
  it("reads the labelled lines", () => {
    expect(reference.axes.some((a) => a.along === "row" && Object.keys(a.lines).length === 5)).toBe(true);
  });
  it("gives this sheet's scale from the same lines at another size", () => {
    const here = grid([24, 30, 24, 30], 8);
    expect(suggestScale({ segmentsPt: here.segments, text: here.text, gridReferences: [reference] })).toEqual({
      scaleName: '1/8" = 1\'-0"',
      feetPerInch: 8,
      because: "the grid on another sheet",
    });
  });
  it("refuses when only part of the grid keeps the ratio, though the middle of them does", () => {
    const known6 = grid([24, 30, 24, 30, 24, 30], 4);
    const here = grid([24, 30, 24, 10, 40, 30], 8);
    expect(suggestScale({ segmentsPt: here.segments, text: here.text, gridReferences: [{ feetPerInch: 4, axes: gridAxes(known6.segments, known6.text) }] })).toBeNull();
  });
  it("does not compare a row of bubbles with a column of them", () => {
    const here = grid([24, 30, 24, 30], 8);
    const asColumn = reference.axes.map((a) => ({ ...a, along: "column" as const }));
    expect(scaleVotes({ segmentsPt: here.segments, text: here.text, gridReferences: [{ feetPerInch: 4, axes: asColumn }] }).grid).toBeUndefined();
  });
  it("drops a label that appears twice in a row: that is two buildings", () => {
    const heads = [bubble(100, 100, "1"), bubble(200, 100, "2"), bubble(300, 100, "3"), bubble(400, 100, "4"), bubble(500, 100, "1")];
    const axes = gridAxes(heads.flatMap((h) => h.segments), heads.map((h) => h.text));
    expect(Object.keys(axes.find((a) => a.along === "row")!.lines).sort()).toEqual(["2", "3", "4"]);
  });
  it("refuses when the same labels are a different building", () => {
    const other = grid([40, 12, 33, 19], 8);
    expect(suggestScale({ segmentsPt: other.segments, text: other.text, gridReferences: [reference] })).toBeNull();
  });
});

describe("door tags and the schedule", () => {
  const rows = [{ mark: "101", size: "3'-0\" x 7'-0\"" }, { mark: "102", size: "2'-8\" x 7'-0\"" }, { mark: "103", size: "3'-0\" x 7'-0\"" }, { mark: "104", size: "2'-6\" x 7'-0\"" }];
  const leaves = [36, 32, 36, 30];
  const sheet = (feetPerInch: number, marks: readonly string[]) => ({
    segmentsPt: plan(leaves, feetPerInch),
    text: marks.map((str, i) => ({ str, x: 100 + i * 200, y: 100 + (i % 3) * 200, width: 8, height: 6 })),
    doorRows: rows,
  });
  it("reads a scale from fewer doors than the swing rule needs, when each matches its own row", () => {
    const votes = scaleVotes(sheet(8, ["101", "102", "103", "104"]));
    expect(votes.tags?.feetPerInch).toBe(8);
    expect(votes.doors).toBeUndefined();
  });
  it("refuses when the marks' widths do not match the swings", () => {
    expect(scaleVotes(sheet(8, ["102", "101", "104", "103"])).tags).toBeUndefined();
  });
  it("needs three marks, not two", () => {
    const two = { segmentsPt: plan([36, 32], 8), text: [{ str: "101", x: 100, y: 100, width: 8, height: 6 }, { str: "102", x: 300, y: 300, width: 8, height: 6 }], doorRows: rows };
    expect(scaleVotes(two).tags).toBeUndefined();
  });
  it("needs a schedule", () => {
    expect(scaleVotes({ ...sheet(8, ["101", "102", "103", "104"]), doorRows: [] }).tags).toBeUndefined();
  });
});

describe("the same series", () => {
  const sameSet = [{ sheetNumber: "A101", feetPerInch: 8 }, { sheetNumber: "A102", feetPerInch: 8 }];
  it("needs the sheet's own doors to agree: a series alone is 88 right and 16 wrong", () => {
    expect(scaleVotes({ segmentsPt: [], sheetNumber: "A103", sameSet }).series).toBeUndefined();
    expect(scaleVotes({ segmentsPt: plan([36, 36], 8), sheetNumber: "A103", sameSet }).series?.feetPerInch).toBe(8);
  });
  it("does not cross series, or lean on one sheet", () => {
    expect(scaleVotes({ segmentsPt: plan([36, 36], 8), sheetNumber: "A203", sameSet }).series).toBeUndefined();
    expect(scaleVotes({ segmentsPt: plan([36, 36], 8), sheetNumber: "A103", sameSet: sameSet.slice(0, 1) }).series).toBeUndefined();
  });
  it("refuses a split series", () => {
    const split = [...sameSet, { sheetNumber: "A104", feetPerInch: 4 }];
    expect(scaleVotes({ segmentsPt: plan([36, 36], 8), sheetNumber: "A103", sameSet: split }).series).toBeUndefined();
  });
});

describe("when the sources disagree", () => {
  it("offers nothing, though each alone would have", () => {
    const here = grid([24, 30, 24, 30], 8);
    const wrongReference = { feetPerInch: 8, axes: gridAxes(here.segments, here.text) };
    const doors = plan([36, 36, 36, 36, 36, 36], 4);
    const evidence = { segmentsPt: [...here.segments, ...doors], text: here.text, gridReferences: [wrongReference] };
    const votes = scaleVotes(evidence);
    expect(votes.doors?.feetPerInch).toBe(4);
    expect(votes.grid?.feetPerInch).toBe(8);
    expect(suggestScale(evidence)).toBeNull();
  });
});

describe("a printed scale's feet per inch", () => {
  it("knows the standard scales and nothing else", () => {
    expect(feetPerInchOf('1/4" = 1\'-0"')).toBe(4);
    expect(feetPerInchOf("AS NOTED")).toBeNull();
    expect(feetPerInchOf(null)).toBeNull();
  });
});
