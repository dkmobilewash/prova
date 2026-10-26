import { describe, expect, it } from "vitest";
import type { ProposedOpening } from "./openingProposals";
import { appendOpeningPairs, drawnOpenings, initialPicks, openingPairs, openingsSentence, type OpeningPick } from "./openingPicks";

const door = (widthFt: number, leaves: 1 | 2 = 1): ProposedOpening => ({
  kind: "door",
  leaves,
  widthFt,
  at: 0.5,
  evidence: "a swing",
});
const window = (widthFt: number): ProposedOpening => ({ kind: "window", widthFt, at: 0.25, evidence: "glazing" });

const runs = [{ proposedOpenings: [door(3), window(4)] }, {}, { proposedOpenings: [door(6, 2)] }];

describe("openingPicks", () => {
  it("collects every drawn opening across a group's runs, in order", () => {
    expect(drawnOpenings(runs).map((o) => o.kind)).toEqual(["door", "window", "door"]);
  });

  it("starts every row with the measured width and NO height", () => {
    // The height is the one number the drawing does not carry. A default
    // here would be deducted from a bid without anybody choosing it.
    const picks = initialPicks([{ proposedOpenings: [door(2.9958)] }]);
    expect(picks).toEqual([{ kind: "door", leaves: 1, width: "3.00", height: "", keep: true }]);
  });

  it("says what was drawn, by kind, and says nothing when nothing was", () => {
    expect(openingsSentence(runs)).toBe(`2 doors (3'-0", 6'-0" pair) and 1 window (4'-0") drawn in these walls`);
    expect(openingsSentence([{}, { proposedOpenings: [] }])).toBeNull();
  });

  it("sends nothing for a row nobody gave a height, and counts it as waiting", () => {
    const { pairs, waiting, problems } = openingPairs(initialPicks(runs));
    expect(pairs).toEqual([]);
    expect(waiting).toBe(3);
    expect(problems).toEqual([]);
  });

  it("sends the rows that have a height, and leaves out the ones unticked", () => {
    const picks: OpeningPick[] = initialPicks(runs).map((pick, i) =>
      i === 0 ? { ...pick, height: "7" } : i === 1 ? { ...pick, height: "5", keep: false } : { ...pick, height: "7.5" },
    );
    expect(openingPairs(picks)).toEqual({
      pairs: [
        { widthFt: 3, heightFt: 7 },
        { widthFt: 6, heightFt: 7.5 },
      ],
      waiting: 0,
      problems: [],
    });
  });

  it("puts them on the form under the two field names the server's wall-run reader takes", () => {
    const form = new FormData();
    const picks = initialPicks(runs).map((pick, i) => (i === 2 ? { ...pick, height: "7" } : pick));
    expect(appendOpeningPairs(form, picks)).toEqual([]);
    expect(form.getAll("openingWidth")).toEqual(["6"]);
    expect(form.getAll("openingHeight")).toEqual(["7"]);
  });

  it("appends nothing at all when any confirmed row is unreadable", () => {
    const form = new FormData();
    const picks = initialPicks(runs).map((pick, i) => ({ ...pick, height: i === 0 ? "x" : "7" }));
    expect(appendOpeningPairs(form, picks)).toHaveLength(1);
    expect(form.getAll("openingWidth")).toEqual([]);
  });

  it("names a row whose typed numbers cannot be read, rather than dropping it", () => {
    const picks: OpeningPick[] = [
      { kind: "door", leaves: 1, width: "3", height: "seven", keep: true },
      { kind: "window", leaves: 1, width: "", height: "5", keep: true },
      { kind: "door", leaves: 1, width: "3", height: "0", keep: true },
    ];
    const { pairs, problems } = openingPairs(picks);
    expect(pairs).toEqual([]);
    expect(problems).toEqual([
      "Door 1: the height needs a number of feet.",
      "Window 2: the width needs a number of feet.",
      "Door 3: the height needs a number of feet.",
    ]);
  });
});
