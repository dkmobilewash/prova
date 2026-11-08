import { describe, expect, it } from "vitest";
import { bareTextTags } from "./bareTextTags";
import { suggestType } from "./reviewQueue";
import { splitVariant, variantLabel, variantNotes } from "./variantMark";
import type { WallGroup } from "./wallGroups";

// "C6*" printed with its note below it, as the plans of a hotel set print it (invented text, same shape).
const at = (str: string, x: number, y: number, width = 20, height = 6) => ({ str, x, y, width, height });
const sheet = [at("C6*", 300, 400, 14), at("TYP AT TUB/SHOWER", 300, 408, 60), at("LOCATIONS", 300, 415, 34), at("C6", 900, 400, 10), at("CORRIDOR", 300, 300, 40)];

describe("a printed variant mark: C6* (Diego, 2026-11-08)", () => {
  it("splits into the code and the mark, and leaves a plain code alone", () => {
    expect(splitVariant("C6*")).toEqual({ code: "C6", mark: "*" });
    expect(splitVariant(" D6** ")).toEqual({ code: "D6", mark: "**" });
    expect(splitVariant("C6")).toEqual({ code: "C6", mark: "" });
  });

  it("reads the words printed with a marked tag, TYP dropped, and nothing for a plain one", () => {
    expect(variantNotes(sheet)).toEqual({ "C6*": "at tub/shower locations" });
  });

  it("labels the type with the mark and what it means, or 'see legend' alone without words", () => {
    expect(variantLabel("C6", "C6*", { "C6*": "at tub/shower locations" })).toBe("C6 (C6* at tub/shower locations, see legend)");
    expect(variantLabel("C6", "C6*")).toBe("C6 (C6*, see legend)");
    expect(variantLabel("C6", "C6")).toBeNull();
  });

  it("a bare tag keeps its mark: C6* beside a wall is a C6* tag, not dropped and not C6", () => {
    const walls = [{ x1: 0.1, y1: 0.4, x2: 0.2, y2: 0.4 }] as unknown as Parameters<typeof bareTextTags>[0]["walls"];
    const got = bareTextTags({ text: [at("C6*", 145, 402, 10, 6)], vocabulary: new Set(["C6"]), symbols: [], walls, feetPerUnit: 100, widthPt: 1000 });
    expect(got.map((t) => t.text)).toEqual(["C6*"]);
  });

  it("the suggestion types the group as C6 and shows the variant, so the estimator can price it", () => {
    const type = { id: "c6", code: "C6", name: "C6", hasParts: true, thicknessIn: null };
    const group: WallGroup = { inches: 4.875, runs: [], feet: 0, source: { kind: "TAG", tag: "C6*" }, candidates: [type] } as unknown as WallGroup;
    expect(suggestType(group, "A102", [], { "C6*": "at tub/shower locations" })).toEqual({
      code: "C6",
      from: "printed tag: C6* on A102",
      drawn: true,
      variant: "C6 (C6* at tub/shower locations, see legend)",
    });
  });
});
