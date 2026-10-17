import { describe, expect, it } from "vitest";

import { THICKNESS_INCHES, matchGroupToItem, matchGroups, type MatchableItem } from "./proposalMatch";

const items: MatchableItem[] = [
  { id: "i_w1", name: "6in partition", thicknessIn: 6, assemblyCode: "W1" },
  { id: "i_w2", name: "Shaft wall", thicknessIn: 8, assemblyCode: "W2" },
  { id: "i_none", name: "Ceiling", thicknessIn: null, assemblyCode: null },
];

describe("matchGroupToItem", () => {
  it("prefers the drawing's own tag over any measurement", () => {
    // The architect wrote W2 beside the wall. Nothing a thickness says beats
    // that — and here the thickness would say something else.
    const hit = matchGroupToItem({ namedCode: "W2", thicknessInches: 6 }, items);
    expect(hit).toEqual({ itemId: "i_w2", by: "assembly-code" });
  });

  it("matches a tag to an item's own name when no assembly code does", () => {
    const hit = matchGroupToItem({ namedCode: "Shaft wall", thicknessInches: 99 }, items);
    expect(hit).toEqual({ itemId: "i_w2", by: "item-name" });
  });

  it("is case- and space-insensitive about a tag", () => {
    // `W1` on one sheet and `w 1` on another is the same wall type.
    expect(matchGroupToItem({ namedCode: " w1 ", thicknessInches: 99 }, items)?.itemId).toBe("i_w1");
    expect(matchGroupToItem({ namedCode: "SHAFT  WALL", thicknessInches: 99 }, items)?.itemId).toBe("i_w2");
  });

  it("falls back to thickness, which is the only rule most real sheets can use", () => {
    // None of the five real plan sets in this repo tags every run.
    const hit = matchGroupToItem({ namedCode: null, thicknessInches: 6 }, items);
    expect(hit).toEqual({ itemId: "i_w1", by: "thickness" });
  });

  it("allows an eighth of an inch and no more", () => {
    expect(matchGroupToItem({ namedCode: null, thicknessInches: 6 + THICKNESS_INCHES }, items)?.itemId).toBe(
      "i_w1",
    );
    // 3⅝" and 4" are different walls. A half-inch band — which the COVERAGE
    // test next door uses, for a different question — would merge them.
    expect(matchGroupToItem({ namedCode: null, thicknessInches: 6.3 }, items)).toBeNull();
  });

  it("REFUSES A TIE rather than picking whichever came first", () => {
    // THE RULE WORTH THE MOST. An estimator sorting one pile is a minute's
    // work; finding the wrong one of two 3⅝" walls silently priced against
    // the other is a bid.
    const twins: MatchableItem[] = [
      { id: "a", name: "Level 1 partition", thicknessIn: 3.625, assemblyCode: "W1" },
      { id: "b", name: "Level 2 partition", thicknessIn: 3.625, assemblyCode: "W1" },
    ];
    expect(matchGroupToItem({ namedCode: null, thicknessInches: 3.625 }, twins)).toBeNull();
    // …and the TAG cannot break it either, because both carry the same code.
    expect(matchGroupToItem({ namedCode: "W1", thicknessInches: 3.625 }, twins)).toBeNull();
  });

  it("ignores an item with no thickness when matching by thickness", () => {
    // A ceiling has no thickness to compare, and must not absorb walls.
    expect(matchGroupToItem({ namedCode: null, thicknessInches: 0 }, items)).toBeNull();
  });

  it("is null when there is nothing to match against", () => {
    expect(matchGroupToItem({ namedCode: "W1", thicknessInches: 6 }, [])).toBeNull();
  });

  it("does not let an unmatched TAG stop a thickness match", () => {
    // The sheet printed `P3`, which is on nobody's library — but the wall is
    // plainly 6 inches. Falling through is what makes detection useful on a
    // set whose tags do not match this company's codes.
    const hit = matchGroupToItem({ namedCode: "P3", thicknessInches: 6 }, items);
    expect(hit).toEqual({ itemId: "i_w1", by: "thickness" });
  });
});

describe("matchGroups", () => {
  it("places what it can and counts what it cannot", () => {
    const { matched, unmatched } = matchGroups(
      [
        { namedCode: "W1", thicknessInches: 6 },
        { namedCode: null, thicknessInches: 8 },
        { namedCode: null, thicknessInches: 42 },
      ],
      items,
    );
    expect([...matched.entries()]).toEqual([
      [0, "i_w1"],
      [1, "i_w2"],
    ]);
    expect(unmatched).toBe(1);
  });
});
