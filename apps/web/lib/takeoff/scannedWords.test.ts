import { describe, expect, it } from "vitest";
import { ocrWordsSentence, runsInOcrWords, scanOnlyAsides, textLikeWord } from "./scannedWords";
import type { WallCandidate } from "./wallVectors";

const run = (x1: number, y1: number, x2: number, y2: number): WallCandidate =>
  ({ x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * 288, thicknessFeet: 0.5 }) as WallCandidate;

describe("runsInOcrWords", () => {
  const W = 2592;
  // A room tag "318": 0.25 in wide, 0.1 in tall, baseline-y, in points.
  const tag = { str: "318", x: 0.30 * W, y: 0.4028 * W, width: 18, height: 7.2, confidence: 88 };
  it("a run no longer than the glyphs are tall, in the middle of a text-like OCR word, is the word", () => {
    const upright = run(0.302, 0.4003, 0.302, 0.4027); // the "1", as tall as the glyph
    const wallUnder = run(0.10, 0.4015, 0.60, 0.4015); // runs through the tag, far longer than a glyph
    const shortButBeside = run(0.33, 0.4003, 0.33, 0.4027);
    const found = runsInOcrWords([upright, wallUnder, shortButBeside], [tag], W);
    expect(found.get(upright)).toBe("318");
    expect(found.has(wallUnder)).toBe(false);
    expect(found.has(shortButBeside)).toBe(false);
  });
  it("a word with low confidence, or a vector text item with none, sets nothing aside", () => {
    const upright = run(0.302, 0.4003, 0.302, 0.4027);
    expect(runsInOcrWords([upright], [{ ...tag, confidence: 30 }], W).size).toBe(0);
    const { confidence: _c, ...vector } = tag;
    expect(runsInOcrWords([upright], [vector], W).size).toBe(0);
  });
  it("a Tesseract line box that read a band of drawing as glyphs is not a word", () => {
    // The shapes measured on the training scans: six inches wide, bars for walls.
    expect(textLikeWord({ str: "| | | |", x: 0, y: 0, width: 510, height: 7, confidence: 85 })).toBe(false);
    expect(textLikeWord({ str: "HALLWAY | HE", x: 0, y: 0, width: 253, height: 23, confidence: 54 })).toBe(false);
    // A real tag and a real dimension pass.
    expect(textLikeWord({ str: "318", x: 0, y: 0, width: 18, height: 7, confidence: 88 })).toBe(true);
    expect(textLikeWord({ str: `12'-6"`, x: 0, y: 0, width: 30, height: 7, confidence: 80 })).toBe(true);
    // A box wider per character than a glyph can be is a band, whatever it says.
    expect(textLikeWord({ str: "A1", x: 0, y: 0, width: 200, height: 7, confidence: 90 })).toBe(false);
  });
  it("says which words", () => {
    expect(ocrWordsSentence(["318", "318", "12'-0\""])).toBe('lettering the scan\'s OCR read as words ("318", "12\'-0"") — a tag or a dimension, not a wall');
  });
});

describe("scanOnlyAsides", () => {
  it("sets aside the title-block strip and the shorter of one wall read twice, and keeps the wall across the room", () => {
    const wall = run(0.2, 0.3, 0.5, 0.3);
    const twin = run(0.22, 0.3005, 0.4, 0.3005);
    const other = run(0.2, 0.34, 0.5, 0.34); // 11.5 ft away: another wall
    const title = run(0.91, 0.2, 0.97, 0.2);
    const out = scanOnlyAsides([wall, twin, other, title], 288);
    expect(out.kept).toEqual([wall, other]);
    expect(out.twins).toEqual([twin]);
    expect(out.titleStrip).toEqual([title]);
  });
});
