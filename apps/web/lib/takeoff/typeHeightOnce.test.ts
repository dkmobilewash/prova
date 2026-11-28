import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answeredTypeHeight, heightUndoItems, runsToStructure } from "./typeHeightOnce";

/** type-height-once.md: the pure halves, and the census that BOTH queue height paths run the fill. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the pure rules", () => {
  it("a to-structure note is recognised; an ordinary note is not", () => {
    expect(runsToStructure("ALL WALLS TO DECK ABOVE U.N.O.")).toBe(true);
    expect(runsToStructure('3 5/8" METAL STUDS @ 16" O.C.')).toBe(false);
    expect(runsToStructure(null)).toBe(false);
  });
  it("H3 takes the one agreed height, and nothing on disagreement, none, or a to-structure type", () => {
    expect(answeredTypeHeight([{ heightFt: "10.00" }, { heightFt: null }, { heightFt: 10 }], null)).toBe(10);
    expect(answeredTypeHeight([{ heightFt: 9 }, { heightFt: 10 }], null)).toBeNull();
    expect(answeredTypeHeight([{ heightFt: null }], null)).toBeNull();
    expect(answeredTypeHeight([{ heightFt: 10 }], "ALL WALLS TO DECK ABOVE U.N.O.")).toBeNull();
  });
  it("Undo puts the answered item back and every filled item back to no height with its own sides", () => {
    expect(heightUndoItems("a", { heightFt: "8.00", sides: null, filled: [{ id: "b", sides: 1 }] })).toEqual([
      { id: "a", heightFt: "8.00", sides: null },
      { id: "b", heightFt: null, sides: 1 },
    ]);
  });
});

describe("census: both ways a person answers a type's height run the fill", () => {
  it("setWallGroupHeight and confirmSheetSuggestions' typeGroup each call fillTypeHeight, and the queue's Undo uses heightUndoItems", () => {
    const items = strip(readFileSync(join(process.cwd(), "lib/actions/takeoffItems.ts"), "utf8"));
    const group = strip(readFileSync(join(process.cwd(), "lib/actions/wallGroupType.ts"), "utf8"));
    const queue = strip(readFileSync(join(process.cwd(), "components/TakeoffReviewQueue.tsx"), "utf8"));
    expect(items.match(/fillTypeHeight\(tx,/g)).toHaveLength(1);
    expect(group.match(/fillTypeHeight\(tx,/g)).toHaveLength(1);
    expect(queue).toMatch(/items: heightUndoItems\(itemId, saved\.value\.was\)/);
  });
});
