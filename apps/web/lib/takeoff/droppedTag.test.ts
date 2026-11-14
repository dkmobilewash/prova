import { describe, expect, it } from "vitest";
import type { FoundOnSheet } from "./findWallsOnSheet";
import { planTextTagByRun, propagatedTag } from "./planTextTags";
import { groupsForStage } from "./stageGroups";
import { verdictFor, wallGroups } from "./wallGroups";
import { contestedRuns, tagByRun, type WallTypeTag } from "./wallTags";
import type { MatchableWallType } from "./wallTypeMatch";
import type { WallCandidate } from "./wallVectors";

// A tag too close to call between two runs names neither, but still says a run within its reach may
// be its type: a carried type does not cross onto that run, and thickness alone does not settle it.
const FPU = 288;
const FOOT = 1 / FPU;
const wall = (x1: number, y1: number, x2: number, y2: number, inches = 4.75) => ({ x1, y1, x2, y2, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU, thicknessFeet: inches / 12 }) as WallCandidate;
// `tagged` carries A1 (its tag clearly beside it); `carriedOnto` continues it on the same line;
// `parallel` runs 3 ft from `carriedOnto`, and B2 sits halfway between the two: too close to call.
const tagged = wall(0.2, 0.5, 0.3, 0.5);
const carriedOnto = wall(0.3, 0.5, 0.4, 0.5);
const parallel = wall(0.3, 0.5 + 3 * FOOT, 0.4, 0.5 + 3 * FOOT);
const a1: WallTypeTag = { name: "A1", x: 0.25, y: 0.5 + 0.5 * FOOT };
const b2: WallTypeTag = { name: "B2", x: 0.35, y: 0.5 + 1.5 * FOOT };

describe("a tag dropped as too close to call", () => {
  it("is reported by tagByRun, and the untagged runs within its reach are contested with its code", () => {
    const dropped: WallTypeTag[] = [];
    const byRun = tagByRun([tagged, carriedOnto, parallel], [a1, b2], FPU, [], false, dropped);
    expect([...byRun]).toEqual([[tagged, "A1"]]);
    expect(dropped).toEqual([b2]);
    expect(contestedRuns([tagged, carriedOnto, parallel], byRun, dropped, FPU)).toEqual(new Map([[carriedOnto, ["B2"]], [parallel, ["B2"]]]));
  });

  it("stops a carried type of another code: the wall between two tags that disagree is a question", () => {
    const read = (tags: WallTypeTag[]) => planTextTagByRun({ segments: [], text: [], widthPt: 2592, walls: [tagged, carriedOnto, parallel], feetPerUnit: FPU, legendCodes: ["A1", "B2"], textTags: tags, wallTypes: [] });
    // With no rival tag, A1 is carried along the wall as before.
    expect(read([a1]).byRun.get(carriedOnto)).toBe(propagatedTag("A1"));
    const got = read([a1, b2]);
    expect(got.byRun.get(tagged)).toBe("A1");
    expect(got.byRun.has(carriedOnto)).toBe(false);
    expect(got.contested.get(carriedOnto)).toEqual(["B2"]);
  });

  it("keeps thickness from settling a run as a type the tag does not name; the person is asked with both", () => {
    const type = (id: string, thicknessIn: number): MatchableWallType => ({ id, code: id, name: id, hasParts: true, thicknessIn });
    const thin = type("A1", 4.75), other = type("B2", 6.5);
    const cluster = [{ inches: 4.75, runs: [carriedOnto, parallel], feet: carriedOnto.lengthFeet + parallel.lengthFeet }];
    // Without the dropped tag both runs are "the only type that thick".
    const before = wallGroups(cluster, new Map(), [thin, other]);
    expect(before.map((g) => verdictFor(g).state)).toEqual(["ONLY_ONE_THAT_THICK"]);
    const after = wallGroups(cluster, new Map(), [thin, other], null, new Set(), new Map([[carriedOnto, ["B2"]]]));
    const asked = after.find((g) => g.runs.includes(carriedOnto))!;
    expect(asked.runs).toEqual([carriedOnto]);
    expect(verdictFor(asked)).toMatchObject({ state: "ASK" });
    expect(asked.candidates.map((t) => t.code)).toEqual(["A1", "B2"]);
    expect(verdictFor(after.find((g) => g.runs.includes(parallel))!).state).toBe("ONLY_ONE_THAT_THICK");
    // A dropped tag of the same code as the thickness's type is no disagreement.
    expect(wallGroups(cluster, new Map(), [thin, other], null, new Set(), new Map([[carriedOnto, ["A1"]]])).map((g) => verdictFor(g).state)).toEqual(["ONLY_ONE_THAT_THICK"]);
  });

  it("reaches the WALLS stage's groups: the run beside the dropped tag is asked, the tagged run stays named", () => {
    const W = 2592;
    const text = (t: WallTypeTag) => ({ str: t.name, x: t.x * W, y: t.y * W, width: 0, height: 0 });
    const types: MatchableWallType[] = [{ id: "A1", code: "A1", name: "A1", hasParts: true, thicknessIn: 4.75 }, { id: "B2", code: "B2", name: "B2", hasParts: true, thicknessIn: 6.5 }];
    const { groups } = groupsForStage({ found: { walls: [tagged, carriedOnto, parallel], inUnits: [] } as unknown as FoundOnSheet, segmentsPt: [], textItems: [text(a1), text(b2)], widthPt: W, feetPerUnit: FPU, wallTypes: types, legendCodes: null });
    const of = (run: WallCandidate) => verdictFor(groups.find((g) => g.runs.includes(run))!).state;
    expect([of(tagged), of(carriedOnto), of(parallel)]).toEqual(["NAMED", "ASK", "ASK"]);
  });

  it("leaves a U.N.O. note's group as it was", () => {
    const thin: MatchableWallType = { id: "A1", code: "A1", name: "A1", hasParts: true, thicknessIn: 4.75 };
    const other: MatchableWallType = { id: "B2", code: "B2", name: "B2", hasParts: true, thicknessIn: 6.5 };
    const cluster = [{ inches: 4.75, runs: [carriedOnto], feet: carriedOnto.lengthFeet }];
    const groups = wallGroups(cluster, new Map(), [thin, other], { type: thin, note: "ALL PARTITIONS TYPE A1 U.N.O." }, new Set(), new Map([[carriedOnto, ["B2"]]]));
    expect(groups.map((g) => g.source.kind)).toEqual(["GENERAL_NOTE"]);
  });
});
