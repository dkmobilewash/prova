import { describe, expect, it } from "vitest";

import { missingStarterTypes, STARTER_TYPES } from "@/lib/wall-type-starters";

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
});
