import { describe, expect, it } from "vitest";
import { alikeGroups, fillOfRuns, type ReviewItem } from "./reviewQueue";
import { storedRunsOf, storedRunsOrNull } from "./wallProposal";
import type { WallGroup } from "./wallGroups";
import type { WallCandidate } from "./wallVectors";

type TypeItem = Extract<ReviewItem, { kind: "type" }>;
const run = (y: number) => ({ x1: 0.1, y1: y, x2: 0.3, y2: y });
// Totem Lake A2.1's untagged groups, as the walk met them (thickness in inches, all drawn plain).
const group = (key: string, inches: number, fill: "hatched" | "plain" | undefined, over: Partial<TypeItem> = {}): TypeItem => ({
  kind: "type", key, pageNumber: 5, sheet: "A2.1", inches, runs: [run(0.1), run(0.2)], feet: 40, suggested: null, ceiling: null, ...(fill === undefined ? {} : { fill }), ...over,
});
const totem = [
  group("g4.73", 4.73, "plain"), group("g5.10", 5.1, "plain"), group("g6.03", 6.03, "plain"), group("g10.06", 10.06, "plain"),
  group("g10.80", 10.8, "plain"), group("g2.45", 2.45, "plain"), group("g12.40", 12.4, "plain"),
];

describe("the untagged groups drawn like the one just typed (Totem Lake A2.1)", () => {
  it("the same fill, thickness within an inch (or 15%): 4-3/4\" brings 5-1/8\", not 6\"", () => {
    expect(alikeGroups(totem, totem[0]!).map((g) => g.key)).toEqual(["g5.10"]);
    expect(alikeGroups(totem, totem[3]!).map((g) => g.key)).toEqual(["g10.80"]);
    expect(alikeGroups(totem, totem[5]!).map((g) => g.key)).toEqual([]);
  });
  it("never a group drawn the other way, on another sheet, or one something on the drawing suggests", () => {
    const open = [group("hatched", 5, "hatched"), group("other", 5, "plain", { pageNumber: 6, sheet: "A2.2" }), group("tagged", 5, "plain", { suggested: { code: "W1", from: "printed tag", drawn: true } as never }), group("unknown", 5, undefined)];
    expect(alikeGroups(open, totem[0]!)).toEqual([]);
  });
  it("offers nothing after a group whose fill is not known, or one the queue suggested a type for", () => {
    expect(alikeGroups(totem, group("old", 4.8, undefined))).toEqual([]);
    expect(alikeGroups(totem, group("guess", 4.8, "plain", { suggested: { code: "W1", from: "the only type that thick" } as never }))).toEqual([]);
  });
});

describe("a group's fill is kept on its stored runs", () => {
  const runs = [{ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1, thicknessFeet: 0.4, lengthFeet: 20 }] as WallCandidate[];
  const of = (hatched: boolean | undefined): WallGroup => ({ inches: 4.75, runs, feet: 20, source: { kind: "REMAINDER" }, candidates: [], ...(hatched === undefined ? {} : { hatched }) });
  it("written and read back", () => {
    expect(fillOfRuns(storedRunsOrNull(storedRunsOf(of(true)))!)).toBe("hatched");
    expect(fillOfRuns(storedRunsOrNull(storedRunsOf(of(false)))!)).toBe("plain");
  });
  it("a row stored before it was kept has no fill, so it is never called alike", () => {
    expect(fillOfRuns(storedRunsOrNull(storedRunsOf(of(undefined)))!)).toBeUndefined();
  });
});
