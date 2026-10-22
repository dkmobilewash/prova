import { describe, expect, it } from "vitest";
import { labelFile, labelRows, type LabelCandidate, type LabelVerdict } from "./labelRows";
import { collectSheet } from "./labelCollect";
import { trainingRows } from "./trainingRows";
import { heldOutReason } from "./heldOutSets";

/**
 * ── A TRACED WALL IS ANSWER-KEY DATA, NEVER TRAINING DATA ──
 *
 * The four held-out buildings are the test set, so their labels have to
 * include the walls the FINDER MISSED — otherwise the score measures only
 * what the finder already proposes, and a finder that proposes nothing scores
 * perfectly. Tracing is how a reviewer records one: two clicks on the drawing
 * and it is added, already accepted.
 *
 * A traced wall therefore has real geometry and NO feature vector, because
 * there was no candidate to take features from. That is what keeps it out of
 * training automatically — rows are built from candidates, and a traced wall
 * is not one. The danger is the opposite direction, below.
 */
const FEET_PER_UNIT = 100;

const candidate = (at: number, y: number, x1: number, x2: number): LabelCandidate => ({
  x1: x1 / FEET_PER_UNIT,
  y1: y / FEET_PER_UNIT,
  x2: x2 / FEET_PER_UNIT,
  y2: y / FEET_PER_UNIT,
  lengthFeet: x2 - x1,
  thicknessFeet: 0.5,
  features: [at, x2 - x1, 0, 0],
});

const run = (
  y: number,
  x1: number,
  x2: number,
  verdict: LabelVerdict["verdict"],
): LabelVerdict => ({
  x1: x1 / FEET_PER_UNIT,
  y1: y / FEET_PER_UNIT,
  x2: x2 / FEET_PER_UNIT,
  y2: y / FEET_PER_UNIT,
  lengthFeet: x2 - x1,
  thicknessFeet: verdict === "traced" ? 0 : 0.5,
  verdict,
});

describe("tracing a wall the finder missed", () => {
  it("saves real geometry, not a marker", () => {
    const file = labelFile({
      set: "CENTRAL-BANK-OF-THE-MIDWEST-Drawings.pdf",
      sheet: "A2.1",
      page: 24,
      reviewedBy: "AI-Claude-Chrome",
      secondsSpent: 60,
      feetPerUnit: FEET_PER_UNIT,
      reviewComplete: true,
      candidates: [],
      verdicts: [run(10, 0, 24, "traced")],
      unreviewed: 0,
    });
    expect(file.traced).toHaveLength(1);
    const [t] = file.traced;
    expect(t.lengthFeet).toBe(24);
    // Real coordinates, so a scorer can measure where it is — not a count.
    expect(t.x1).toBeCloseTo(0);
    expect(t.x2).toBeCloseTo(0.24);
    expect(t.y1).toBeCloseTo(0.1);
    expect(file.counts.traced).toBe(1);
  });

  it("is NOT an accepted candidate, so it cannot become a training row", () => {
    // No candidate exists under it — that is the whole point of tracing — so
    // there is nothing to carry features, and nothing reaches the rows.
    const rows = labelRows([], [run(10, 0, 24, "traced")], FEET_PER_UNIT, true);
    expect(rows).toHaveLength(0);
  });

  it("does not inflate the accepted count, which is about candidates", () => {
    const file = labelFile({
      set: "SLN-Terminal-Public-Area-Improvements-Plans.pdf",
      sheet: "A1",
      page: 10,
      reviewedBy: "Diego",
      secondsSpent: 30,
      feetPerUnit: FEET_PER_UNIT,
      reviewComplete: true,
      candidates: [],
      verdicts: [run(10, 0, 24, "traced"), run(20, 0, 10, "wall")],
      unreviewed: 0,
    });
    expect(file.counts.accepted).toBe(1);
    expect(file.counts.traced).toBe(1);
  });

  /**
   * ── THE DANGEROUS DIRECTION, AND IT WAS REAL ──
   *
   * `judged` excludes traced runs, and the fall-through branch only asked
   * whether something UNSURE lay along the candidate. So a candidate under a
   * traced wall was written as a CONFIDENT NEGATIVE — the model taught "no
   * wall here" at the one place the reviewer went out of their way to say
   * there is one.
   *
   * It is the same defect as the 483 unsure runs that became negatives, in a
   * branch that was fixed for unsure and not for traced.
   */
  it("a candidate under a traced wall is left out, not labelled negative", () => {
    const rows = labelRows(
      [candidate(0, 10, 2, 22)],
      [run(10, 0, 24, "traced")],
      FEET_PER_UNIT,
      true,
    );
    expect(rows, "a wall was traced here; this is not a negative").toHaveLength(0);
  });

  it("still writes a negative for a candidate nowhere near a traced wall", () => {
    // The exclusion must not swallow ordinary negatives, or a sheet with one
    // traced wall would contribute no negatives at all.
    const rows = labelRows(
      [candidate(0, 90, 2, 22)],
      [run(10, 0, 24, "traced")],
      FEET_PER_UNIT,
      true,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe(0);
  });
});

describe("a held-out building's labels", () => {
  const HELD_OUT = [
    "CENTRAL-BANK-OF-THE-MIDWEST-Drawings.pdf",
    "Gen-BBQ-Sacramento-CA.pdf",
    "SLN-Terminal-Public-Area-Improvements-Plans.pdf",
    "stem-bid-drawings (1).pdf",
  ];

  it("every one of the four is recognised as held out", () => {
    for (const set of HELD_OUT) {
      expect(heldOutReason(set), set).not.toBeNull();
    }
  });

  it("contributes NOTHING to training, and says so", () => {
    const got = trainingRows(
      HELD_OUT.map((set) => ({
        set,
        sheet: "A1",
        rows: [{ features: [1, 2, 3], label: 1 }],
      })),
    );
    expect(got.rows).toHaveLength(0);
    expect(got.counts.sheetsRefused).toBe(4);
    // Reported, not silently dropped: a run that skipped four sets must not
    // look like a run that never had them.
    expect(got.refused.map((r) => r.set).sort()).toEqual([...HELD_OUT].sort());
  });

  it("cannot reach training through the collector either", () => {
    const got = collectSheet(
      {
        set: "Gen-BBQ-Sacramento-CA.pdf",
        sheet: "A2",
        feetPerUnit: FEET_PER_UNIT,
        reviewComplete: true,
        verdicts: [run(10, 0, 24, "wall")],
        rows: [],
        finderVersion: "abc123abc123",
      },
      [candidate(0, 10, 2, 22)],
      "abc123abc123",
    );
    // The collector reports it as held out...
    expect(got.heldOut).not.toBeNull();
    // ...and the rows it built are refused when they reach training.
    const trained = trainingRows([got.sheet]);
    expect(trained.rows).toHaveLength(0);
    expect(trained.counts.sheetsRefused).toBe(1);
  });
});
