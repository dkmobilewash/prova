import { describe, expect, it } from "vitest";
import { labelFile, labelRows, type LabelCandidate, type LabelVerdict } from "./labelRows";
import { FEATURE_NAMES } from "./wallFeatures";

/**
 * A label attached to the wrong candidate trains the model to do the opposite
 * of what the reviewer said, and nothing about the file would look wrong. So
 * the mapping is tested rather than eyeballed.
 */
const FPU = 100; // 100 ft per unit: a 0.1-unit run is 10 ft

const candidate = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thicknessFeet = 0.5,
): LabelCandidate => ({
  x1,
  y1,
  x2,
  y2,
  lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU,
  thicknessFeet,
  features: new Array(FEATURE_NAMES.length).fill(0),
});

const run = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  verdict: LabelVerdict["verdict"],
  thicknessFeet = 0.5,
): LabelVerdict => ({
  x1,
  y1,
  x2,
  y2,
  lengthFeet: Math.hypot(x2 - x1, y2 - y1) * FPU,
  thicknessFeet,
  verdict,
});

describe("carrying a verdict from a run back to its pairings", () => {
  it("LABELS EVERY PAIRING UNDER AN ACCEPTED RUN AS A WALL", () => {
    // One 30 ft run made of three 10 ft pairings, which is what a wall with
    // two openings in it looks like by the time it reaches the reviewer.
    const parts = [candidate(0, 0, 0.1, 0), candidate(0.1, 0, 0.2, 0), candidate(0.2, 0, 0.3, 0)];
    const rows = labelRows(parts, [run(0, 0, 0.3, 0, "wall")], FPU, true);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.label === 1)).toBe(true);
    expect(rows.every((r) => r.from === "accepted-run")).toBe(true);
  });

  it("labels pairings under a rejected run as not a wall", () => {
    const rows = labelRows([candidate(0, 0, 0.3, 0)], [run(0, 0, 0.3, 0, "not-wall")], FPU, true);
    expect(rows[0].label).toBe(0);
    expect(rows[0].from).toBe("rejected-run");
  });

  it("A PAIRING NO RUN COVERS IS A NEGATIVE, BUT ONLY ON A FINISHED SHEET", () => {
    // This is the commonest negative there is — the hatch and grid pairings
    // that never became runs — and it is only meaningful once the reviewer has
    // been through the sheet. On a half-done one it means nothing, so the row
    // is left out rather than guessed.
    const orphan = [candidate(0.5, 0.5, 0.6, 0.5)];
    expect(labelRows(orphan, [run(0, 0, 0.3, 0, "wall")], FPU, true)).toHaveLength(1);
    expect(labelRows(orphan, [run(0, 0, 0.3, 0, "wall")], FPU, true)[0].from).toBe("no-run");
    expect(labelRows(orphan, [run(0, 0, 0.3, 0, "wall")], FPU, false)).toHaveLength(0);
  });

  it("DOES NOT CLAIM A PAIRING THAT MERELY SHARES A LINE", () => {
    // Same infinite line, nowhere near the run. Without the overlap test this
    // would inherit the run's verdict from across the sheet.
    const faraway = [candidate(0.8, 0, 0.9, 0)];
    expect(labelRows(faraway, [run(0, 0, 0.3, 0, "wall")], FPU, false)).toHaveLength(0);
  });

  it("does not claim a pairing running the other way through the same point", () => {
    const crossing = [candidate(0.15, -0.05, 0.15, 0.05)];
    expect(labelRows(crossing, [run(0, 0, 0.3, 0, "wall")], FPU, false)).toHaveLength(0);
  });

  it("DOES NOT CLAIM A PAIRING AT AN ANGLE ACROSS THE RUN", () => {
    // A diagonal that sits on the run's line and overlaps its span, so neither
    // the offset test nor the overlap test refuses it — only the direction
    // test does. Without this case, removing that test changes nothing and
    // the suite says the test is unnecessary.
    const diagonal = [candidate(0.1, -0.02, 0.2, 0.02)];
    expect(labelRows(diagonal, [run(0, 0, 0.3, 0, "wall")], FPU, false)).toHaveLength(0);
  });

  it("A TRACED WALL DOES NOT MARK WHAT IS UNDER IT AS NOT-A-WALL", () => {
    // A reviewer can trace over ground where a candidate was rejected or never
    // offered. If traced runs were treated as judged, "traced" is not "wall"
    // and every pairing beneath one would be labelled a negative — the exact
    // opposite of what the reviewer meant by drawing it.
    //
    // ── THIS TEST PERMITTED THE HARM ITS OWN NAME FORBIDS, UNTIL 2026-10-20 ──
    //
    // It asserted `rows[0].label` was `not.toBe(1)`, which is satisfied by
    // label 0 — a confident negative, the thing the comment above calls "the
    // exact opposite of what the reviewer meant". And it required the row to
    // EXIST, pinning the defect in place: `judged` excludes traced runs, so
    // the candidate fell through to `no-run` and was written as a negative at
    // the one place somebody had gone out of their way to say a wall is.
    //
    // The right behaviour is the one the unsure branch already had: leave the
    // candidate out. Neither a positive (there is no feature vector behind the
    // reviewer's two clicks) nor a negative (there is a wall there).
    //
    // It matters most on the four held-out buildings, where tracing is the
    // whole point — their labels are the test key and must contain the walls
    // the finder missed.
    const beneath = [candidate(0, 0, 0.3, 0)];
    const rows = labelRows(beneath, [run(0, 0, 0.3, 0, "traced")], FPU, true);
    expect(rows, "a traced wall labelled its own ground a negative").toHaveLength(0);
  });

  it("does not claim a pairing on a parallel wall a room away", () => {
    const nextRoom = [candidate(0, 0.2, 0.3, 0.2)];
    expect(labelRows(nextRoom, [run(0, 0, 0.3, 0, "wall")], FPU, false)).toHaveLength(0);
  });

  it("AN ACCEPTED RUN WINS OVER A REJECTED ONE COVERING THE SAME PAIRING", () => {
    // Two runs over one pairing happens where a duplicate was offered and the
    // reviewer kept one. The pairing is part of the wall they kept.
    const both = [run(0, 0, 0.3, 0, "not-wall"), run(0, 0, 0.3, 0, "wall")];
    expect(labelRows([candidate(0, 0, 0.3, 0)], both, FPU, true)[0].label).toBe(1);
    expect(labelRows([candidate(0, 0, 0.3, 0)], [...both].reverse(), FPU, true)[0].label).toBe(1);
  });

  it("keeps traced walls apart rather than inventing rows for them", () => {
    // Nothing proposed a traced wall, so no feature vector exists for it.
    // Writing one would mean inventing the numbers the model trains on.
    const file = labelFile({
      set: "Camp Bow Wow",
      sheet: "A101",
      page: 8,
      reviewedBy: "tester",
      secondsSpent: 61.4,
      feetPerUnit: FPU,
      reviewComplete: true,
      candidates: [candidate(0, 0, 0.3, 0)],
      verdicts: [run(0, 0, 0.3, 0, "wall"), run(0.5, 0.5, 0.6, 0.5, "traced")],
      unreviewed: 2,
    });
    expect(file.rows).toHaveLength(1);
    expect(file.traced).toHaveLength(1);
    // `unsure` is its own count: it is REVIEWED and excluded, where
    // `unreviewed` is nobody looked. They were one number once, and a
    // reviewer's 48 unsure runs reached a file as 483 confident negatives.
    expect(file.counts).toEqual({ accepted: 1, rejected: 0, traced: 1, unsure: 0, unreviewed: 2 });
    expect(file.secondsSpent).toBe(61);
    expect(file.featureNames).toEqual([...FEATURE_NAMES]);
  });
});


describe("a candidate nobody was shown is not a negative", () => {
  /**
   * ── THE THIRD TIME THIS SHAPE HAS COST SOMETHING ──
   *
   * `labelRows` already refuses to write a negative for a candidate under an
   * UNSURE run, and again for one under a TRACED run, each after it had cost
   * real training data. A candidate the viewer SET ASIDE is the same case: it
   * was never shown, so "the reviewer saw it and did not call it a wall" is
   * false — and the sheet is still complete, because the reviewer judged
   * every candidate they were offered.
   *
   * Measured across the nine traced training sheets: 217 of 464 negatives
   * were `no-run`, against 247 real rejections. On Murray A101 the reviewer
   * rejected ONE candidate and the rows carried 100 machine-made negatives.
   */
  it("drops a no-run negative for a candidate marked not offered", () => {
    const orphan = [{ ...candidate(0, 0.5, 0.3, 0.5), offered: false }];
    expect(labelRows(orphan, [run(0, 0, 0.3, 0, "wall")], FPU, true)).toHaveLength(0);
  });

  it("keeps it when the candidate says it WAS offered", () => {
    const orphan = [{ ...candidate(0, 0.5, 0.3, 0.5), offered: true }];
    const rows = labelRows(orphan, [run(0, 0, 0.3, 0, "wall")], FPU, true);
    expect(rows).toHaveLength(1);
    expect(rows[0].from).toBe("no-run");
    expect(rows[0].label).toBe(0);
  });

  it("drops every no-run negative on an OLDER file that withheld some", () => {
    // No per-candidate flag, but the counts say the panel offered one while
    // the finder produced two — so one was withheld and the file cannot say
    // which. Neither is safe.
    const two = [candidate(0, 0.5, 0.3, 0.5), candidate(0, 0.7, 0.3, 0.7)];
    expect(labelRows(two, [run(0, 0, 0.3, 0, "wall")], FPU, true, 1)).toHaveLength(0);
  });

  it("keeps them on an older file that withheld nothing", () => {
    // Offered count equals the candidate count: every one was shown, so a
    // candidate with no verdict really was passed over.
    const two = [candidate(0, 0.5, 0.3, 0.5), candidate(0, 0.7, 0.3, 0.7)];
    expect(labelRows(two, [run(0, 0, 0.3, 0, "wall")], FPU, true, 2)).toHaveLength(2);
  });

  it("still writes the verdicts it DOES have", () => {
    // The fix must not throw away real rejections with the unverified ones.
    const judged = [{ ...candidate(0, 0, 0.3, 0), offered: false }];
    const rows = labelRows(judged, [run(0, 0, 0.3, 0, "not-wall")], FPU, true, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].from).toBe("rejected-run");
  });
});
