import { describe, expect, it } from "vitest";
import { clusterByThickness, type WallCandidate } from "./wallVectors";
import { wallGroups } from "./wallGroups";
import type { MatchableWallType } from "./wallTypeMatch";
import {
  evidenceOf,
  groupsFromProposals,
  storedRunsOf,
  storedRunsOrNull,
  proposalRowsFor,
  type ProposalRow,
} from "./wallProposal";

/**
 * ── THE ROUND TRIP IS THE WHOLE TEST, AND IT FOUND TWO REAL ERRORS ──
 *
 * A stored proposal is only worth having if reading it back gives the estimator
 * the SAME groups the detection found. Anything less is a cache that disagrees
 * with the drawing, which is worse than no cache at all — the panel would offer
 * a different answer depending on whether somebody had visited the sheet
 * before, and nothing on screen would say so.
 *
 * So this detects, stores, reads back, and compares against `wallGroups`' own
 * output. Both defects it caught were invisible to inspection:
 *
 *   1. `cluster.inches` is the mean of the WHOLE cluster, and a cluster splits
 *      into one group per tag plus a remainder — so re-deriving the thickness
 *      from a single group's runs returns a different number. Bounded by
 *      `CLUSTER_INCHES`, which is twice `THICKNESS_SLACK_IN`, so it silently
 *      changes which wall types a group is matched against.
 *   2. A GENERAL_NOTE group's candidates put the note's type FIRST, then the
 *      others at that thickness — the picker the fresh detection showed.
 *      Reading it back with the note's type anywhere else changes which
 *      option the sheet's note is seen to name.
 */

const TYPES: MatchableWallType[] = [
  { id: "t-a1", code: "A1", name: "A1 partition", thicknessIn: 4.875, hasParts: false },
  { id: "t-a2", code: "A2", name: "A2 partition", thicknessIn: 4.875, hasParts: false },
  { id: "t-ext", code: "EXT-1", name: "Exterior", thicknessIn: 8.875, hasParts: false },
];

/** A run on a page whose width is 1 unit, so feet come straight from length. */
const run = (x1: number, x2: number, thicknessFeet: number): WallCandidate => ({
  x1,
  y1: 0.5,
  x2,
  y2: 0.5,
  thicknessFeet,
  lengthFeet: Math.abs(x2 - x1) * 100,
});

/** The pipeline's own grouping, so the comparison is against the real thing. */
const detect = (runs: WallCandidate[], tags: Map<WallCandidate, string>, note = null as null | { type: MatchableWallType; note: string }) =>
  wallGroups(clusterByThickness(runs), tags, TYPES, note);

/** Store a group the way the writer will, then read it back the way the page will. */
const roundTrip = (groups: ReturnType<typeof detect>, feetPerUnit: number) => {
  const rows: ProposalRow[] = groups.map((group) => ({
    thicknessInches: group.inches,
    ...evidenceOf(group),
    runs: storedRunsOf(group) as unknown,
  }));
  return groupsFromProposals(rows, TYPES, feetPerUnit);
};

describe("a stored proposal reads back as the same group", () => {
  it("TAGGED AND UNTAGGED TOGETHER, which is the case that splits a cluster", () => {
    // Two runs of the same thickness, one tagged A1 and one not, so the cluster
    // becomes two groups that MUST both keep the cluster's own average.
    const tagged = run(0.1, 0.4, 0.40625);
    const untagged = run(0.1, 0.3, 0.42);
    const groups = detect([tagged, untagged], new Map([[tagged, "A1"]]));
    expect(groups).toHaveLength(2);

    const back = roundTrip(groups, 100);
    expect(back).not.toBeNull();
    expect(back).toHaveLength(groups.length);

    for (const [index, group] of groups.entries()) {
      const read = back![index];
      expect(read.source, `group ${index} source`).toEqual(group.source);
      // THE THICKNESS LABEL, to full precision. This is the assertion that
      // failed before `thicknessInches` was stored, and it failed on BOTH
      // groups — each had been re-derived from its own single run.
      expect(read.inches, `group ${index} inches`).toBeCloseTo(group.inches, 10);
      expect(read.feet, `group ${index} feet`).toBeCloseTo(group.feet, 10);
      expect(
        read.candidates.map((type) => type.id),
        `group ${index} candidates`,
      ).toEqual(group.candidates.map((type) => type.id));
      expect(read.runs).toHaveLength(group.runs.length);
    }
  });

  it("A GENERAL NOTE READS BACK AS THE SAME OFFER, the note's type first", () => {
    // Untagged runs at the note's own thickness: `wallGroups` covers them with
    // the note and offers A1 FIRST. A1 and A2 are BOTH 4.875in here on
    // purpose — the read-back must keep A1 in front, since `evidenceOf` reads
    // the note's type off `candidates[0]`.
    const one = run(0.1, 0.4, 0.40625);
    const groups = detect([one], new Map(), { type: TYPES[0], note: "ALL PARTITIONS TYPE A1 U.N.O." });
    expect(groups[0].source.kind).toBe("GENERAL_NOTE");
    expect(groups[0].candidates.map((t) => t.code)).toEqual(["A1", "A2"]);

    const back = roundTrip(groups, 100);
    expect(back![0].source).toEqual(groups[0].source);
    expect(back![0].candidates.map((type) => type.code)).toEqual(["A1", "A2"]);
  });

  it("the footage follows the CALIBRATION, not the stored number", () => {
    // The point of not storing feet: read the same geometry at twice the scale
    // and every length doubles. A stored figure could not do this, and on the
    // day it disagreed with the geometry it would be the one somebody bid.
    const groups = detect([run(0.1, 0.4, 0.40625)], new Map());
    const at100 = roundTrip(groups, 100)!;
    const at200 = roundTrip(groups, 200)!;
    expect(at200[0].feet).toBeCloseTo(at100[0].feet * 2, 10);
  });

  it("a type renamed in the library re-points the group; a type deleted leaves the footage", () => {
    // What deriving the match buys. Neither case needs a migration, a sweep or
    // a staleness flag.
    const tagged = run(0.1, 0.4, 0.40625);
    const groups = detect([tagged], new Map([[tagged, "A1"]]));
    const rows: ProposalRow[] = groups.map((group) => ({
      thicknessInches: group.inches,
      ...evidenceOf(group),
      runs: storedRunsOf(group) as unknown,
    }));

    const renamed = groupsFromProposals(rows, [{ ...TYPES[0], name: "A1 — one-hour rated" }], 100);
    expect(renamed![0].candidates[0].name).toBe("A1 — one-hour rated");

    const gone = groupsFromProposals(rows, [TYPES[2]], 100);
    expect(gone![0].candidates).toEqual([]);
    // AND THE MEASUREMENT SURVIVES IT. A group nothing can price is still a
    // group somebody traced.
    expect(gone![0].feet).toBeCloseTo(groups[0].feet, 10);
  });

  it("openings survive, and an empty list does not become a measurement nobody took", () => {
    const withOpening: WallCandidate = { ...run(0.1, 0.5, 0.40625), openings: [{ widthFt: 3 }] };
    const plain = run(0.6, 0.9, 0.40625);
    const stored = storedRunsOf({
      inches: 4.875,
      runs: [withOpening, plain],
      feet: 70,
      source: { kind: "REMAINDER" },
      candidates: [],
    });
    expect(stored[0].openings).toEqual([{ widthFt: 3 }]);
    // ABSENT rather than `[]`: an empty array invites a reader to believe
    // somebody measured the openings and found none.
    expect("openings" in stored[1]).toBe(false);

    // AND AN EXPLICITLY EMPTY LIST IS ALSO DROPPED, which is the case a
    // mutation caught this test missing: the run above carries no `openings`
    // key at all, so it passed with the `.length > 0` guard removed.
    // `mergeWalls` hands back `openings: []` for a run it joined nothing
    // across, so this is the shape that actually arrives.
    const emptied = storedRunsOf({
      inches: 4.875,
      runs: [{ ...run(0.1, 0.5, 0.40625), openings: [] }],
      feet: 40,
      source: { kind: "REMAINDER" },
      candidates: [],
    });
    expect("openings" in emptied[0]).toBe(false);
  });
});

describe("the rows one detection run writes", () => {
  const at = { pageId: "page_1", calibrationId: "cal_1" };

  it("KEEPS WHICH EVIDENCE NAMED EACH GROUP, rather than flattening them", () => {
    // Mutation-caught: writing every group as a REMAINDER left the whole suite
    // green while the panel lost every tag the drawing printed. That is the
    // difference between "A1, 120 ft, priceable" and "some 4-7/8in walls".
    const tagged = run(0.1, 0.4, 0.40625);
    const untagged = run(0.6, 0.9, 0.40625);
    const groups = detect([tagged, untagged], new Map([[tagged, "A1"]]));
    const rows = proposalRowsFor(groups, at);

    expect(rows.map((row) => row.source).sort()).toEqual(["REMAINDER", "TAG"]);
    const tag = rows.find((row) => row.source === "TAG")!;
    expect(tag.sourceLabel).toBe("A1");
    expect(tag.namedCode).toBe("A1");
    const rest = rows.find((row) => row.source === "REMAINDER")!;
    expect(rest.sourceLabel).toBeNull();
    expect(rest.namedCode).toBeNull();
  });

  it("writes the STORED run shape, not the detector's own", () => {
    // Mutation-caught: handing the raw `WallCandidate`s to the column wrote
    // `lengthFeet` into the database — a derived number sitting beside the
    // geometry that determines it, which is the one column this model refuses.
    const rows = proposalRowsFor(detect([run(0.1, 0.4, 0.40625)], new Map()), at);
    expect(rows[0].runs[0]).not.toHaveProperty("lengthFeet");
    expect(Object.keys(rows[0].runs[0]).sort()).toEqual([
      "thicknessFeet",
      "x1",
      "x2",
      "y1",
      "y2",
    ]);
  });

  it("WRITES NOTHING FOR A SHEET WITH NO WALLS", () => {
    // Mutation-caught: removing the empty check wrote rows for a detection that
    // found nothing. A row recording "none" is indistinguishable from never
    // having looked, and a schedule or a site plan legitimately has no walls.
    expect(proposalRowsFor([], at)).toEqual([]);
  });

  it("stamps every row with the page and calibration it was found under", () => {
    const rows = proposalRowsFor(detect([run(0.1, 0.4, 0.40625)], new Map()), at);
    expect(rows.every((row) => row.pageId === "page_1")).toBe(true);
    expect(rows.every((row) => row.calibrationId === "cal_1")).toBe(true);
  });
});

describe("the column cannot refuse a bad element, so the writer does", () => {
  const good = [{ x1: 0, y1: 0, x2: 0.5, y2: 0, thicknessFeet: 0.40625 }];

  it("accepts what it wrote", () => {
    expect(storedRunsOrNull(good)).toHaveLength(1);
  });

  it("REFUSES rather than salvages, because a short wall reads as a finding", () => {
    // Each of these is a row that would otherwise reach the panel as a wall of
    // thickness `undefined` — `NaN` feet, rendered as a group somebody prices.
    expect(storedRunsOrNull([{ ...good[0], thicknessFeet: undefined }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], x2: "0.5" }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], y1: Number.NaN }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], x1: Number.POSITIVE_INFINITY }])).toBeNull();
    // A thickness of zero is not a wall.
    expect(storedRunsOrNull([{ ...good[0], thicknessFeet: 0 }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], thicknessFeet: -1 }])).toBeNull();
  });

  it("refuses the shapes that are not a list of runs at all", () => {
    expect(storedRunsOrNull(null)).toBeNull();
    expect(storedRunsOrNull("[]")).toBeNull();
    expect(storedRunsOrNull({ runs: good })).toBeNull();
    expect(storedRunsOrNull([null])).toBeNull();
    expect(storedRunsOrNull([42])).toBeNull();
    // AN EMPTY GROUP IS A REFUSAL: it would render as a 0 ft proposal, which
    // reads as a finding rather than as the absence of one.
    expect(storedRunsOrNull([])).toBeNull();
  });

  it("carries the DRAWN openings through the column and back, unchanged", () => {
    // The panel's "2 doors drawn in these walls" reads them off the stored
    // row on a revisit, so a writer or reader that dropped them would make the
    // proposals vanish the second time somebody opened the sheet.
    const proposed = [
      { kind: "door" as const, leaves: 2 as const, widthFt: 6, at: 0.25, evidence: "two swings" },
      { kind: "window" as const, widthFt: 4, at: 0.75, evidence: "glazing" },
    ];
    const stored = storedRunsOf({
      inches: 4.875,
      runs: [{ ...run(0.1, 0.5, 0.40625), proposedOpenings: proposed }, run(0.6, 0.9, 0.40625)],
      feet: 70,
      source: { kind: "REMAINDER" },
      candidates: [],
    });
    expect(stored[0].proposedOpenings).toEqual(proposed);
    expect("proposedOpenings" in stored[1]).toBe(false);
    const back = groupsFromProposals(
      [{ thicknessInches: 4.875, source: "REMAINDER", sourceLabel: null, namedCode: null, runs: JSON.parse(JSON.stringify(stored)) }],
      TYPES,
      288,
    );
    expect(back?.[0].runs[0].proposedOpenings).toEqual(proposed);
    expect(back?.[0].runs[1].proposedOpenings).toBeUndefined();
  });

  it("refuses a malformed drawn opening, as it refuses every other field", () => {
    const ok = { kind: "door", widthFt: 3, at: 0.5, evidence: "a swing" };
    expect(storedRunsOrNull([{ ...good[0], proposedOpenings: [ok] }])).not.toBeNull();
    expect(storedRunsOrNull([{ ...good[0], proposedOpenings: "doors" }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], proposedOpenings: [{ ...ok, kind: "skylight" }] }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], proposedOpenings: [{ ...ok, widthFt: 0 }] }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], proposedOpenings: [{ ...ok, at: 1.5 }] }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], proposedOpenings: [{ ...ok, evidence: 3 }] }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], proposedOpenings: [{ ...ok, leaves: 3 }] }])).toBeNull();
  });

  it("refuses a malformed opening, which is the half a careless parser skips", () => {
    expect(storedRunsOrNull([{ ...good[0], openings: "none" }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], openings: [{ widthFt: "3" }] }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], openings: [{}] }])).toBeNull();
    expect(storedRunsOrNull([{ ...good[0], openings: [{ widthFt: 0 }] }])).toBeNull();
  });

  it("ONE BAD ROW REFUSES THE WHOLE PAGE, not just that group", () => {
    // Three groups of which one is unreadable looks exactly like a page that
    // has two, and the estimator has no way to tell. Falling back to detecting
    // the sheet again is slow and correct.
    const rows: ProposalRow[] = [
      { thicknessInches: 4.875, source: "REMAINDER", sourceLabel: null, namedCode: null, runs: good },
      { thicknessInches: 4.875, source: "REMAINDER", sourceLabel: null, namedCode: null, runs: [{}] },
    ];
    expect(groupsFromProposals(rows, TYPES, 100)).toBeNull();
  });

  it("refuses a named group whose evidence is missing", () => {
    const base = { thicknessInches: 4.875, runs: good } as const;
    // A TAG with no text cannot be rendered; one with no designation cannot be
    // matched. Both are the evidence, so neither is a weaker finding.
    expect(
      groupsFromProposals([{ ...base, source: "TAG", sourceLabel: null, namedCode: "A1" }], TYPES, 100),
    ).toBeNull();
    expect(
      groupsFromProposals([{ ...base, source: "TAG", sourceLabel: "A1", namedCode: null }], TYPES, 100),
    ).toBeNull();
    expect(
      groupsFromProposals(
        [{ ...base, source: "GENERAL_NOTE", sourceLabel: "ALL PARTITIONS A1", namedCode: "" }],
        TYPES,
        100,
      ),
    ).toBeNull();
  });

  it("refuses an impossible thickness, which would label a bucket nobody can read", () => {
    const base = { source: "REMAINDER", sourceLabel: null, namedCode: null, runs: good } as const;
    expect(groupsFromProposals([{ ...base, thicknessInches: 0 }], TYPES, 100)).toBeNull();
    expect(groupsFromProposals([{ ...base, thicknessInches: Number.NaN }], TYPES, 100)).toBeNull();
  });
});
