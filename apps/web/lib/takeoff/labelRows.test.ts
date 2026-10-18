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
    const beneath = [candidate(0, 0, 0.3, 0)];
    const rows = labelRows(beneath, [run(0, 0, 0.3, 0, "traced")], FPU, true);
    expect(rows).toHaveLength(1);
    expect(rows[0].label, "a traced wall labelled its own ground a negative").not.toBe(1);
    expect(rows[0].from).toBe("no-run");
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
    expect(file.counts).toEqual({ accepted: 1, rejected: 0, traced: 1, unreviewed: 2 });
    expect(file.secondsSpent).toBe(61);
    expect(file.featureNames).toEqual([...FEATURE_NAMES]);
  });
});
