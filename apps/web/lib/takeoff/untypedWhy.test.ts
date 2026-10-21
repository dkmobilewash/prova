import { describe, expect, it } from "vitest";
import type { TagSymbol } from "./tagSymbols";
import { untypedSentence, untypedWhy } from "./untypedWhy";
import type { WallCandidate } from "./wallVectors";

const W = 1000; // points; FPU 100: 0.01 page-width = 1 ft = 10 pt
const run = (x1: number, y1: number, x2: number, y2: number): WallCandidate => ({ x1, y1, x2, y2, thicknessFeet: 0.4, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * 100 });
const symbol = (text: string, x: number, y: number): TagSymbol =>
  ({ text, parts: [text], x, y, radius: 10, corners: 4, shape: "square", split: false, leader: null, rejected: null }) as TagSymbol;

describe("why a wall stayed untyped", () => {
  const legend = new Set(["A", "B"]);
  const farAway = run(0.1, 0.9, 0.5, 0.9); // nothing within 20 ft
  const tooFar = run(0.1, 0.1, 0.5, 0.1); // tag A 6 ft off
  const noMargin = run(0.1, 0.3, 0.5, 0.3); // tag B 2 ft off, but a twin run 3 ft the other side
  const twin = run(0.1, 0.35, 0.5, 0.35);
  const wrongCode = run(0.1, 0.6, 0.5, 0.6); // nearest symbol says K03
  const symbols = [symbol("A", 300, 160), symbol("B", 300, 320), symbol("K03", 300, 610), symbol("A", 900, 500)];

  it("names the reason per run, with feet by reason, and lists tags with no run under them", () => {
    const got = untypedWhy({ walls: [farAway, tooFar, noMargin, twin, wrongCode], symbols, vocabulary: legend, byRun: new Map(), feetPerUnit: 100, widthPt: W });
    const by = new Map(got.runs.map((r) => [r.run, r.reason]));
    expect(by.get(farAway)).toBe("no tag nearby");
    expect(by.get(tooFar)).toBe("tag too far");
    expect(by.get(noMargin)).toBe("no clear margin");
    expect(by.get(wrongCode)).toBe("code not in legend");
    expect(Math.round(got.feet["tag too far"])).toBe(40);
    // Two tags have no run within reach: the `A` 6 ft off `tooFar` and the
    // `A` at x=900, 40 ft from anything — the finder's gaps, both.
    expect(got.orphanTags.map((t) => t.code)).toEqual(["A", "A"]);
    expect(untypedSentence(got)).toContain("2 tags with no run under them");
  });

  it("says nothing about a run that has a type", () => {
    const got = untypedWhy({ walls: [tooFar], symbols, vocabulary: legend, byRun: new Map([[tooFar, "A"]]), feetPerUnit: 100, widthPt: W });
    expect(got.runs).toEqual([]);
    expect(untypedSentence(got)).toContain("nothing untyped");
  });
});
