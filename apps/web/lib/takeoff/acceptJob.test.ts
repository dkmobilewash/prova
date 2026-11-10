import { describe, expect, it } from "vitest";
import { jobPrintedTagGroups, printedTagPreview, type ReviewItem } from "./reviewQueue";

type TypeItem = Extract<ReviewItem, { kind: "type" }>;
const run = { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.1 };
const group = (key: string, pageNumber: number, suggested: TypeItem["suggested"], feet = 100): TypeItem => ({
  kind: "type",
  key,
  pageNumber,
  sheet: `A10${pageNumber}`,
  inches: 6,
  runs: [run],
  feet,
  suggested,
  ceiling: null,
});
const tag = (code: string) => ({ code, from: `printed tag: ${code}`, drawn: true as const, match: `tag:${code}` });

describe("accept all printed-tag suggestions on this job", () => {
  const items: ReviewItem[] = [
    group("a", 1, tag("C6"), 120),
    group("b", 2, tag("C6"), 80),
    group("c", 2, tag("C8"), 40),
    group("d", 3, { ...tag("C6"), variant: "C6 (C6*, see legend)" }), // marked tag: 78% on training, stays
    group("e", 3, { code: "C6", from: "carried tag: C6", drawn: true }), // carried: no match, stays
    group("f", 3, { code: "B", from: "unless noted", drawn: true, match: "note:B" }), // note, stays
    group("g", 3, { code: "C4", from: "only type that thick: 4\"" }), // thickness guess, stays
    group("h", 3, null), // named by nothing, stays
    { kind: "scale", key: "s", pageNumber: 3, sheet: "A103" },
  ];
  const groups = jobPrintedTagGroups(items, (g) => (g.pageNumber === 2 ? 12 : 10), "plan");

  it("takes printed tags on every sheet and nothing else", () => {
    expect(groups.map((g) => g.key)).toEqual(["a", "b", "c"]);
  });
  it("gives each group the height Enter would, and its own sheet", () => {
    expect(groups.map((g) => [g.group.pageNumber, g.group.code, g.group.heightFt])).toEqual([
      [1, "C6", 10],
      [2, "C6", 12],
      [2, "C8", 12],
    ]);
  });
  it("previews per type its groups, feet and sheets, each sheet with the runs to light", () => {
    const preview = printedTagPreview(groups);
    expect(preview.map((t) => [t.code, t.groups, t.feet, t.sheets.map((s) => [s.sheet, s.feet, s.runs.length])])).toEqual([
      ["C6", 2, 200, [["A101", 120, 1], ["A102", 80, 1]]],
      ["C8", 1, 40, [["A102", 40, 1]]],
    ]);
  });
});
