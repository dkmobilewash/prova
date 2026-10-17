import { describe, expect, it } from "vitest";

import { matchGroupToItem, matchGroups, type MatchableItem } from "./proposalMatch";
import { inchLabel } from "./wallVectors";

const items: MatchableItem[] = [
  { id: "i_eighths", name: "Eighths partition", thicknessIn: 4.375, assemblyCode: null },
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

  it("MATCHES ON THE NUMBER THE PANEL SHOWS, which is the nearest eighth", () => {
    // ── THIS REPLACED A TOLERANCE, AND THE DIFFERENCE IS VISIBLE TO A PERSON ──
    //
    // It used to be `|item − group| <= 1/8`. The band was not wrong about
    // walls; it was wrong about the SCREEN. The panel rounds to the eighth to
    // draw its label, so a tolerance either side of the raw measurement could
    // match a condition the label disagreed with — the row reading 4-3/8"
    // while a 4-1/4" condition took the group, and nothing on screen to say
    // why.
    //
    // A measurement off real geometry, where the drafter drew 4-3/8":
    expect(matchGroupToItem({ namedCode: null, thicknessInches: 4.33333277 }, items)?.itemId).toBe(
      "i_eighths",
    );
    // And the refusal that the old band allowed: 6-1/8" is drawn, shown and
    // typed as a different wall from 6".
    expect(matchGroupToItem({ namedCode: null, thicknessInches: 6.125 }, items)).toBeNull();
    // 3⅝" and 4" stay different walls, as they were under the band.
    expect(matchGroupToItem({ namedCode: null, thicknessInches: 6.3 }, items)).toBeNull();
  });

  it("CANNOT MATCH A CONDITION THE LABEL DISAGREES WITH — the whole point", () => {
    // The property, rather than three examples of it. Swept across a range of
    // measured thicknesses: every match that happens is one where the group's
    // label and the item's own label are the same string, so an estimator can
    // check the panel's decision by reading it.
    const sized: MatchableItem[] = [
      { id: "a", name: "a", thicknessIn: 3.625, assemblyCode: null },
      { id: "b", name: "b", thicknessIn: 4.375, assemblyCode: null },
      { id: "c", name: "c", thicknessIn: 6, assemblyCode: null },
      { id: "d", name: "d", thicknessIn: 6.125, assemblyCode: null },
    ];
    let matches = 0;
    for (let raw = 3; raw <= 7; raw += 0.01) {
      const hit = matchGroupToItem({ namedCode: null, thicknessInches: raw }, sized);
      if (hit === null) continue;
      matches += 1;
      const item = sized.find((one) => one.id === hit.itemId);
      expect(item, `matched an item that is not in the list: ${hit.itemId}`).toBeDefined();
      expect(
        inchLabel(raw),
        `group measured ${raw.toFixed(3)} shows as ${inchLabel(raw)} and matched ${item?.thicknessIn}`,
      ).toBe(inchLabel(item?.thicknessIn ?? -1));
    }
    // The sweep has to MATCH something, or it asserts nothing — the vacuous
    // case this repo keeps paying for. Four conditions an eighth-band wide
    // across a four-inch sweep at 0.01 steps is about fifty hits.
    expect(matches, "the sweep matched nothing, so it proved nothing").toBeGreaterThan(20);
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
