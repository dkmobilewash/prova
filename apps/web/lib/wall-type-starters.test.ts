import { describe, expect, it } from "vitest";

import { missingStarterTypes, STARTER_TYPES, starterNameWithoutLayerCount } from "@/lib/wall-type-starters";

/**
 * WHICH STARTERS A LIBRARY IS MISSING — the one rule the /wall-types button's
 * count and `addStarterWallTypes` both use (issue #818).
 */

// Written out, so the list and the test have to agree.
const ALL = ["W1", "W2", "W3", "EW1", "FIN5", "ACT1", "ACT2", "GYPC1", "FLR1", "PT1", "SLB1", "FTG1"];

describe("missingStarterTypes", () => {
  it("is every starter, in order, on an empty library", () => {
    expect(STARTER_TYPES.map((type) => type.code)).toEqual(ALL);
    expect(missingStarterTypes([]).map((type) => type.code)).toEqual(ALL);
  });

  it("drops the ones a company has, ignoring case and stray space, and ignores its other types", () => {
    expect(missingStarterTypes(["W1", " w3 ", "A1", "act1"]).map((type) => type.code)).toEqual([
      "W2",
      "EW1",
      "FIN5",
      "ACT2",
      "GYPC1",
      "FLR1",
      "PT1",
      "SLB1",
      "FTG1",
    ]);
  });

  it("is empty once every starter is there", () => {
    expect(missingStarterTypes([...ALL, "A1"])).toEqual([]);
  });

  it("on Bid, offers only the framing/drywall and ceiling starters — never flooring, paint or concrete", () => {
    const BID = ["W1", "W2", "W3", "EW1", "FIN5", "ACT1", "ACT2", "GYPC1"];
    expect(missingStarterTypes([], "bid").map((type) => type.code)).toEqual(BID);
    expect(missingStarterTypes(["w1", "ACT2"], "bid").map((type) => type.code)).toEqual(["W2", "W3", "EW1", "FIN5", "ACT1", "GYPC1"]);
    // A Bid library is complete without the other trades'.
    expect(missingStarterTypes(BID, "bid")).toEqual([]);
  });
});

describe("starter names say no layer count", () => {
  it("no starter names a layer count — the 'Board layers each side' answer is the count", () => {
    for (const type of STARTER_TYPES) expect(type.name, type.code).not.toMatch(/\b(one|two|single|double) layers?\b/i);
  });

  it("an old starter's name loses its 'one layer' and lands on today's starter name; any other name is left alone", () => {
    const names = new Set(STARTER_TYPES.map((type) => type.name));
    for (const old of [
      "3⅝″ 20ga steel studs at 16″ o.c., one layer ⅝″ Type X each side",
      "3⅝″ 20ga steel studs at 16″ o.c., one layer ⅝″ Type X each side, R-13 batt",
      "2x4 wood studs at 16″ o.c., one layer ½″ board each side",
    ]) {
      expect(names.has(starterNameWithoutLayerCount(old)), old).toBe(true);
    }
    expect(starterNameWithoutLayerCount("Ours — one layer ⅝″ Type X each side")).toBe("Ours — one layer ⅝″ Type X each side");
  });
});
