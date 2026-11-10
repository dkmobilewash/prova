import { describe, expect, it } from "vitest";
import { sameOnOtherFloors, sameWindowsOnOtherFloors, type ReviewItem } from "./reviewQueue";

type TypeItem = Extract<ReviewItem, { kind: "type" }>;
const run = { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1 };
const group = (key: string, pageNumber: number, match: string | undefined, inches = 6, extra: Partial<TypeItem> = {}): TypeItem => ({
  kind: "type",
  key,
  pageNumber,
  sheet: `A10${pageNumber}`,
  inches,
  runs: [run],
  feet: 100,
  suggested: match === undefined ? null : { code: match.split(":")[1]!, from: "printed tag", drawn: true, match },
  ceiling: null,
  ...extra,
});
const floors = new Set([1, 2, 3]);
const height = () => 10;

describe("confirm once per set: the same drawn group on the other floors", () => {
  it("offers the same printed tag, same thickness band, on the same sheet and the other floor plans", () => {
    const confirmed = group("a", 1, "tag:C6");
    const items = [
      confirmed,
      group("b", 2, "tag:C6", 6.25), // same tag, within ½"
      group("c", 3, "tag:C6"),
      group("d", 1, "tag:C6"), // same sheet: its twin too (measured with same-sheet twins)
      group("e", 2, "tag:C8"), // a different tag: NEVER changed
      group("f", 3, "tag:C6", 8), // same tag, a different thickness
      group("g", 2, undefined), // named by nothing
      group("h", 2, "note:C6"), // the note's C6 is not the printed tag C6
      group("i", 9, "tag:C6"), // an elevation or detail sheet, not a floor plan
    ];
    const out = sameOnOtherFloors(items, confirmed, "C6", 12, height, floors, "plan");
    expect(out.map((g) => g.key)).toEqual(["b", "c", "d"]);
    // The person's choice goes on every one, at the confirmed height (same level: same item).
    expect(out.every((g) => g.group.code === "C6" && g.group.heightFt === 12 && g.group.planId === "plan")).toBe(true);
  });

  it("applies the type the person chose, even where it differs from the tag's suggestion", () => {
    const confirmed = group("a", 1, "tag:C6");
    expect(sameOnOtherFloors([confirmed, group("b", 2, "tag:C6")], confirmed, "C6A", null, height, floors, "plan").map((g) => g.group.code)).toEqual(["C6A"]);
  });

  it("a group on another level keeps that level's own height, not the confirmed one", () => {
    const confirmed = group("a", 1, "tag:C6", 6, { level: { label: "level 1", height: null, codes: [] } });
    const other = group("b", 2, "tag:C6", 6, { level: { label: "level 2", height: null, codes: [] } });
    expect(sameOnOtherFloors([confirmed, other], confirmed, "C6", 12, () => 14, floors, "plan")[0]!.group.heightFt).toBe(14);
  });

  it("offers nothing for a group with no drawn identity (carried, sibling, thickness guess, none)", () => {
    const confirmed = group("a", 1, undefined);
    expect(sameOnOtherFloors([confirmed, group("b", 2, undefined)], confirmed, "C6", 10, height, floors, "plan")).toEqual([]);
  });
});

describe("confirm once per set: windows", () => {
  const win = (key: string, pageNumber: number, tags: string[]): Extract<ReviewItem, { kind: "windows" }> => ({ kind: "windows", key, pageNumber, sheet: `A10${pageNumber}`, runs: tags.map(() => run), tags, at: null });
  it("offers another floor only when every window on it carries a tag just confirmed", () => {
    const confirmed = win("w1", 1, ["A", "B", "C"]);
    const items = [confirmed, win("w2", 2, ["A", "b"]), win("w3", 3, ["A", "D"]), win("w9", 9, ["A"])];
    // C was dropped on the first floor, so it is not among the kept tags.
    const out = sameWindowsOnOtherFloors(items, confirmed, new Set(["A", "B"]), floors);
    expect(out.map((w) => w.key)).toEqual(["w2"]);
  });
});
