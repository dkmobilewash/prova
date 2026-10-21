import { describe, expect, it } from "vitest";
import { bareTextTags } from "./bareTextTags";
import type { TagSymbol } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";

const W = 1000; // points
const FPU = 100; // feet per page-width unit: 0.01 = 1 ft = 10 pt
const wall: WallCandidate = { x1: 0.1, y1: 0.5, x2: 0.5, y2: 0.5, thicknessFeet: 0.5, lengthFeet: 40 };
const text = (str: string, x: number, y: number) => ({ str, x, y, width: 20, height: 8 });

describe("bare text as a tag", () => {
  it("accepts a legend code sitting beside a wall and nothing else", () => {
    const got = bareTextTags({
      text: [text("P08", 290, 490), text("P08", 290, 100), text("ROOM", 290, 490), text("P05", 290, 490)],
      vocabulary: new Set(["P08", "P07"]),
      symbols: [],
      walls: [wall],
      feetPerUnit: FPU,
      widthPt: W,
    });
    expect(got.map((g) => [g.text, Math.round(g.nearestFeet * 10) / 10])).toEqual([["P08", 1.4]]);
  });

  it("leaves text that a found symbol already holds to the symbol path", () => {
    const symbol = { x: 300, y: 486, radius: 12, text: "P08" } as TagSymbol;
    const got = bareTextTags({
      text: [text("P08", 290, 490)],
      vocabulary: new Set(["P08"]),
      symbols: [symbol],
      walls: [wall],
      feetPerUnit: FPU,
      widthPt: W,
    });
    expect(got).toEqual([]);
  });
});
