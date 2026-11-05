import { describe, expect, it } from "vitest";
import { familyOf, withVariantTypes, type MatchableWallType } from "./wallTypeMatch";
import { groupsFromProposals } from "./wallProposal";

// The plan's printed tag is the code, the legend gives the family: Hutto's C6
// is C plus stud size 6, Joplin's A3 is A plus suffix 3.
const type = (code: string, thicknessIn: number | null = null): MatchableWallType => ({ id: `t-${code}`, code, name: `Type ${code}`, hasParts: true, thicknessIn });

describe("a tag as a legend family plus a suffix", () => {
  it("reads C6 as C and A3 as A, the longest family, and never a code the legend spells", () => {
    expect(familyOf("C6", ["A", "C", "D"])).toBe("C");
    expect(familyOf("A3", ["A", "B"])).toBe("A");
    expect(familyOf("S6A", ["S", "S6"])).toBe("S");
    expect(familyOf("H4", ["H4", "H"])).toBeNull();
    expect(familyOf("c-6", ["C"])).toBe("C");
  });

  it("needs a family that ends in a letter, and a suffix that is a size", () => {
    expect(familyOf("12", ["1", "2"])).toBeNull();
    expect(familyOf("CA", ["C"])).toBeNull();
    expect(familyOf("C123", ["C"])).toBeNull();
    expect(familyOf("D6", ["A", "C"])).toBeNull();
  });

  it("adds one variant per such tag, priced as the family and named as the tag", () => {
    const types = withVariantTypes([type("C", 5), type("D")], ["C6", "c6", "D4", "Q1", "C"]);
    expect(types.map((t) => [t.code, t.id, t.family ?? null, t.thicknessIn])).toEqual([
      ["C", "t-C", null, 5],
      ["D", "t-D", null, null],
      ["C6", "t-C", "C", 5],
      ["D4", "t-D", "D", null],
    ]);
  });

  it("names a stored C6 group by C's variant when it is read back", () => {
    const runs = [{ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1, thicknessFeet: 0.5 }];
    const groups = groupsFromProposals([{ thicknessInches: 6, source: "TAG", sourceLabel: "C6", namedCode: "C6", itemId: null, runs }], [type("C", 6)], 100);
    expect(groups?.[0]?.candidates.map((c) => [c.code, c.id])).toEqual([["C6", "t-C"]]);
  });
});
