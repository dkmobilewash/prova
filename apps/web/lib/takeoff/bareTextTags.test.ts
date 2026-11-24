import { afterEach, describe, expect, it, vi } from "vitest";
import { bareTextTags } from "./bareTextTags";
import type { TagSymbol } from "./tagSymbols";
import type { WallCandidate } from "./wallVectors";
import { wallTypeTags } from "./wallTags";

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

// prereg-unit-label-guard.md: Mid-City prints "UNIT TYPE" over "B1" in every apartment.
describe("an apartment's unit type is not a wall tag (TAKEOFF_UNIT_LABEL_GUARD)", () => {
  afterEach(() => vi.unstubAllEnvs());
  // B1 is 8 pt tall, so the reach is 40 pt. "UNIT TYPE" 18 pt above it is a label; 60 pt off is not.
  const label = { ...text("UNIT TYPE", 270, 472), width: 60 };
  const far = { ...text("UNIT TYPE", 270, 430), width: 60 };
  const read = (items: ReturnType<typeof text>[]) => ({
    bare: bareTextTags({ text: items, vocabulary: new Set(["B1"]), symbols: [], walls: [wall], feetPerUnit: FPU, widthPt: W }).map((g) => g.text),
    loose: wallTypeTags(items, W).map((g) => g.name),
  });

  it("drops B1 under a UNIT TYPE label from both plain-text readers when on", () => {
    vi.stubEnv("TAKEOFF_UNIT_LABEL_GUARD", "1");
    expect(read([label, text("B1", 290, 490)])).toEqual({ bare: [], loose: [] });
  });

  it("keeps B1 when the label is beyond 5 text heights", () => {
    vi.stubEnv("TAKEOFF_UNIT_LABEL_GUARD", "1");
    expect(read([far, text("B1", 290, 490)])).toEqual({ bare: ["B1"], loose: ["B1"] });
  });

  it("changes nothing with the flag unset", () => {
    expect(read([label, text("B1", 290, 490)])).toEqual({ bare: ["B1"], loose: ["B1"] });
  });
});

