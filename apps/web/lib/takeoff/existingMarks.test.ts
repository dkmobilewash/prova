import { describe, expect, it } from "vitest";
import { entryKind, existingMarks, type PageTextItem } from "./existingMarks";
import type { StrokeSegment } from "./wallVectors";

// A 36 x 24 in sheet. Text y is the baseline, y down, as pdf.js reports it.
const W = 2592;
const item = (str: string, xIn: number, yIn: number, h = 9.6): PageTextItem => ({ str, x: xIn * 72, y: yIn * 72, width: str.length * 5.5, height: h });
const seg = (x1: number, y1: number, x2: number, y2: number, extra: Partial<StrokeSegment> = {}): StrokeSegment => ({ x1: x1 * 72, y1: y1 * 72, x2: x2 * 72, y2: y2 * 72, width: 0.5, ...extra });

// Legend rows at x = 3 in: a grey dashed swatch (6 pieces of 0.08 in) beside
// EXISTING, two long black lines beside NEW, a hatch beside NIC.
const legendText = [item("EXISTING WALL TO REMAIN", 3, 2.0), item("NEW WALL", 3, 2.4), item("AREA NOT IN CONTRACT", 3, 2.8)];
const dashed = Array.from({ length: 6 }, (_, k) => seg(2.1 + k * 0.14, 1.93, 2.18 + k * 0.14, 1.93, { gray: 0.6 }));
const solid = [seg(2.1, 2.3, 2.9, 2.3), seg(2.1, 2.36, 2.9, 2.36)];
const hatch = Array.from({ length: 5 }, (_, k) => seg(2.1 + k * 0.15, 2.8, 2.2 + k * 0.15, 2.7));
// A plan line running PAST a label is not a swatch.
const planLabel = [item("(E) DEMISING", 15, 12)];
const planLine = [seg(12, 11.9, 16, 11.9), seg(12, 11.95, 16, 11.95)];
// Keynote rows with a symbol beside them: a sentence fragment, and a toilet partition.
// Three grey ticks of a room outline beside a plan label: confined and alone, but no sample's width.
const ticks = [seg(4.55, 11.35, 4.6, 11.35, { gray: 0.75 }), seg(4.64, 11.35, 4.69, 11.35, { gray: 0.75 }), seg(4.73, 11.35, 4.78, 11.35, { gray: 0.75 })];
// Murray's NEW WALL sample: a narrow vertical hatch, 0.35 in wide and only 0.05 in tall, nothing to the right of its words.
const narrowHatch = Array.from({ length: 8 }, (_, k) => seg(2.5 + k * 0.05, 5.0, 2.52 + k * 0.05, 4.96));
// A NIC label standing in a hatch field that goes on PAST the words: a legend row for the same words would end in margin.
const fieldRight = Array.from({ length: 6 }, (_, k) => seg(14.2 + k * 0.05, 15.95, 14.22 + k * 0.05, 15.92, { gray: 0.7 }));
const fieldLeft = Array.from({ length: 12 }, (_, k) => seg(11.3 + k * 0.08, 15.95, 11.34 + k * 0.08, 15.9, { gray: 0.7 }));
const keynoteMarks = [seg(2.2, 3.55, 2.8, 3.55), seg(2.2, 3.5, 2.8, 3.5), seg(2.2, 3.95, 2.8, 3.95), seg(2.2, 3.9, 2.8, 3.9)];
// A NIC label inside a hatched area: tiny pieces all round it, including to its left.
const hatchField = Array.from({ length: 40 }, (_, k) => seg(4.5 + (k % 10) * 0.2, 14.0 + Math.floor(k / 10) * 0.1, 4.55 + (k % 10) * 0.2, 13.95 + Math.floor(k / 10) * 0.1, { gray: 0.7 }));
const notes = [item("PATCH ALL HOLES IN EXISTING SURFACES AND WHERE EQUIPMENT IS REMOVED", 28, 3), item("EX = EXISTING TO REMAIN", 27, 20), item("EX 104", 8, 9), item("N.I.C.", 5, 11.4, 12), item("JAIL (NO WORK)", 24, 8.6), item("OFFICE", 9, 9), item("NIC, TYP ALL", 6.3, 14.1), item("EXISTING DOOR AND FRAME TO REMAIN", 3, 3.2), item("FOR THE NEW BUILDING.", 3, 3.6), item("EXISTING MIRROR TOILET PARTITION", 3, 4.0), item("EXISTING MASONRY OPENING DIMENSIONS MAY", 6, 15.6), item("NEW WALL", 3, 5.0), item("AREA NOT IN CONTRACT", 12.5, 16.0)];

const marks = () => existingMarks({ textItems: [...legendText, ...planLabel, ...notes], segments: [...dashed, ...solid, ...hatch, ...planLine, ...hatchField, ...keynoteMarks, ...ticks, ...narrowHatch, ...fieldRight, ...fieldLeft], widthPt: W });

describe("existingMarks", () => {
  it("reads the legend's three kinds and samples each swatch", () => {
    const { legend } = marks();
    expect(legend.map((e) => e.kind)).toEqual(["EXISTING", "NEW", "NIC", "NEW"]);
    const [existing, fresh, nic, narrow] = legend;
    expect(narrow.words).toBe("NEW WALL");
    expect(narrow.swatch.strokes).toBe(8);
    expect(existing.swatch).toMatchObject({ strokes: 6, grey: true, dashed: true, hatched: false });
    expect(fresh.swatch).toMatchObject({ strokes: 2, grey: false, dashed: false, hatched: false });
    expect(fresh.swatch.longestPieceIn).toBeCloseTo(0.8, 2);
    expect(nic.swatch).toMatchObject({ strokes: 5, hatched: true });
    expect(existing.x).toBeCloseTo((3 * 72 + (23 * 5.5) / 2) / W, 4);
  });

  it("a plan line running past a label is a tag, never a legend entry", () => {
    const m = marks();
    expect(m.legend.some((e) => e.words === "(E) DEMISING")).toBe(false);
    expect(m.tags.find((t) => t.words === "(E) DEMISING")).toMatchObject({ kind: "EXISTING" });
  });

  it("learns the sheet's own abbreviation and tags by it", () => {
    const m = marks();
    expect(m.tokens).toEqual(["(E)", "EX"]);
    expect(m.tags.find((t) => t.words === "EX 104")?.kind).toBe("EXISTING");
    expect(m.tags.some((t) => t.words.startsWith("EX ="))).toBe(false);
  });

  it("marks NIC and NO WORK labels with their box, and leaves plain labels and sentences alone", () => {
    const m = marks();
    const nic = m.tags.filter((t) => t.kind === "NIC").map((t) => t.words);
    expect(nic).toEqual(["N.I.C.", "JAIL (NO WORK)", "NIC, TYP ALL", "AREA NOT IN CONTRACT"]);
    expect(m.legend.some((e) => e.words === "NIC, TYP ALL")).toBe(false);
    expect(m.legend.some((e) => e.words === "N.I.C.")).toBe(false);
    expect(m.legend.some((e) => e.words === "AREA NOT IN CONTRACT" && e.y > 0.4)).toBe(false);
    expect(m.tags.find((t) => t.words === "AREA NOT IN CONTRACT")?.kind).toBe("NIC");
    expect(m.tags.some((t) => t.words.includes("DOOR AND FRAME"))).toBe(false);
    expect(m.legend.some((e) => e.words.startsWith("FOR THE"))).toBe(false);
    expect(m.legend.some((e) => e.words.includes("TOILET"))).toBe(false);
    expect(m.tags.find((t) => t.words === "N.I.C.")?.heightU).toBeCloseTo(12 / W, 6);
    expect(m.tags.some((t) => t.words === "OFFICE")).toBe(false);
    expect(m.tags.some((t) => t.words.startsWith("PATCH"))).toBe(false);
    expect(m.tags.some((t) => t.words.startsWith("EXISTING MASONRY"))).toBe(false);
    expect(m.legend.some((e) => e.words.startsWith("PATCH"))).toBe(false);
  });

  it("names a kind only for a short label, removal before existing", () => {
    expect(entryKind("REMOVE EXISTING WALL")).toBe("DEMO");
    expect(entryKind("(E) WALL")).toBe("EXISTING");
    expect(entryKind("NOT IN CONTRACT")).toBe("NIC");
    expect(entryKind("N.I.C.")).toBeNull();
    expect(entryKind("NIC, TYP ALL")).toBeNull();
    expect(entryKind("EXISTING WALL FURROUT.")).toBeNull();
    expect(entryKind("EXISTING CONSTRUCTION")).toBe("EXISTING");
    expect(entryKind("NEW PARTITION")).toBe("NEW");
    expect(entryKind("EXISTING DOOR AND FRAME TO REMAIN")).toBeNull();
    expect(entryKind("MATCH FINISHED WALL THICKNESS WHERE NEW WALLS OCCUR IN LINE WITH EXISTING")).toBeNull();
  });

  it("without strokes it still reads the words", () => {
    const m = existingMarks({ textItems: [...legendText, ...notes], widthPt: W });
    expect(m.legend).toEqual([]);
    expect(m.tags.map((t) => t.words)).toContain("EXISTING WALL TO REMAIN");
  });
});
