import { describe, expect, it } from "vitest";
import {
  boardedArea,
  sheetsRequired,
  studsRequired,
  takeoffCeiling,
  takeoffWall,
  trackRequired,
  wallFaceArea,
} from "./takeoff";

describe("wall area", () => {
  it("is length by height for one face", () => {
    expect(wallFaceArea({ lengthFt: 20, heightFt: 9 })).toBe(180);
  });

  it("doubles for a wall boarded both sides", () => {
    expect(boardedArea({ lengthFt: 20, heightFt: 9, sides: 2 })).toBe(360);
    expect(boardedArea({ lengthFt: 20, heightFt: 9, sides: 1 })).toBe(180);
  });

  it("DEDUCTS AN OPENING FROM EVERY BOARDED SIDE, not just one", () => {
    // A door hole goes through the wall, not through one face of it.
    // Deducting once on a two-sided wall halves the deduction and overbids.
    const wall = {
      lengthFt: 20,
      heightFt: 9,
      sides: 2 as const,
      openings: [{ widthFt: 6, heightFt: 7 }], // 42 sq ft, over the threshold
    };
    expect(boardedArea(wall)).toBe((180 - 42) * 2);
  });

  it("ignores openings under the threshold, because they still cost labour", () => {
    // A small opening is cut and finished around; deducting it underbids the
    // work. 32 sq ft is the common line, roughly a single door.
    const wall = {
      lengthFt: 20,
      heightFt: 9,
      sides: 1 as const,
      openings: [{ widthFt: 3, heightFt: 4 }], // 12 sq ft
    };
    expect(boardedArea(wall)).toBe(180);
  });

  it("lets the threshold be overridden, because shops differ", () => {
    const wall = {
      lengthFt: 20,
      heightFt: 9,
      sides: 1 as const,
      openings: [{ widthFt: 3, heightFt: 4 }],
    };
    expect(boardedArea(wall, { openingDeductionThresholdSqFt: 0 })).toBe(168);
  });

  it("floors at zero rather than returning negative area", () => {
    // A wall that is mostly opening computes negative. Zero means nothing to
    // board; a negative would flow into sheets and subtract material.
    const wall = {
      lengthFt: 8,
      heightFt: 8,
      sides: 1 as const,
      openings: [{ widthFt: 8, heightFt: 8 }],
    };
    expect(boardedArea(wall)).toBe(0);
  });
});

describe("sheets", () => {
  it("rounds up, because half a sheet cannot be bought", () => {
    // 100 sq ft + 10% = 110, over 32 = 3.44 → 4.
    expect(sheetsRequired(100)).toBe(4);
  });

  it("APPLIES WASTE BEFORE ROUNDING, not after", () => {
    // Applying it after compounds the rounding. On a small wall that is the
    // difference between one extra sheet and three.
    // 40 sq ft: (40 * 1.1) / 32 = 1.375 → 2.
    // Rounding first would give ceil(40/32)=2, then 2*1.1=2.2 → 3.
    expect(sheetsRequired(40)).toBe(2);
  });

  it("takes a different sheet size, for 4x12 on a commercial ceiling", () => {
    expect(sheetsRequired(480, { wastePercent: 0, sheetAreaSqFt: 48 })).toBe(10);
  });

  it("returns nothing for no area", () => {
    expect(sheetsRequired(0)).toBe(0);
    expect(sheetsRequired(-50)).toBe(0);
  });
});

describe("studs", () => {
  it("INCLUDES THE STUD THAT CLOSES THE FAR END", () => {
    // The one every hand takeoff forgets, and the one this file got wrong
    // first. A 10 ft wall at 16" o.c. has studs at 0,16,32,48,64,80,96,112
    // inches AND one at 120 closing it — nine, not eight. Using floor drops
    // the last one on every run that is not an exact multiple of the
    // spacing, which underbids invisibly per wall and materially across a
    // floor plate.
    expect(studsRequired(10)).toBe(9);
  });

  it("is unchanged where the run divides evenly, which is why floor looked right", () => {
    // 16 ft at 16" o.c. is 13 either way. Every round-number wall agrees,
    // so the bug hides behind exactly the examples someone checks by hand.
    expect(studsRequired(16)).toBe(13);
  });

  it("honours a different spacing", () => {
    expect(studsRequired(10, { spacingFt: 2 })).toBe(6);
  });

  it("returns nothing for a wall with no length", () => {
    expect(studsRequired(0)).toBe(0);
  });
});

describe("track", () => {
  it("is top and bottom", () => {
    expect(trackRequired(20)).toBe(40);
  });

  it("carries no waste factor, because the offcut is usable", () => {
    // Unlike board. A waste percentage here would invent a loss the shop
    // does not take.
    expect(trackRequired(100)).toBe(200);
  });
});

describe("a whole wall", () => {
  it("returns quantities in the shape a line item already uses", () => {
    const lines = takeoffWall({
      lengthFt: 20,
      heightFt: 9,
      sides: 2,
      openings: [{ widthFt: 6, heightFt: 7 }],
    });
    expect(lines.map((l) => [l.label, l.quantity, l.unit])).toEqual([
      ["Drywall area", 276, "sq ft"],
      ["Drywall sheets", 10, "sheets"],
      ["Studs", 16, "ea"],
      ["Track", 40, "lin ft"],
    ]);
  });
});

describe("a ceiling", () => {
  it("is area and sheets only", () => {
    const lines = takeoffCeiling({ lengthFt: 30, widthFt: 20 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ label: "Ceiling area", quantity: 600, unit: "sq ft" });
  });

  it("does not invent grid, hangers or wire", () => {
    // An acoustical grid takeoff depends on the tile module and the layout.
    // A number produced without the reflected ceiling plan is a guess wearing
    // a quantity's clothes.
    const labels = takeoffCeiling({ lengthFt: 30, widthFt: 20 }).map((l) => l.label);
    expect(labels.join(" ")).not.toMatch(/grid|hanger|wire/i);
  });
});
