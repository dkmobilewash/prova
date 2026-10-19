import { describe, expect, it } from "vitest";
import { startReview } from "./answerKeyReview";
import { labelFile } from "./labelRows";
import { crossingPoint, splitCandidate } from "./splitCandidate";
import type { Candidate } from "./answerKeyReview";
import type { LabelCandidate, LabelVerdict } from "./labelRows";

/**
 * ── A SPLIT HALF MUST KEEP ITS FEATURE VECTORS AND ITS VERDICT ──
 *
 * The whole point of splitting rather than marking a long wall "not sure" is
 * that both halves become TRAINING DATA: 129 ft of real wall as positives and
 * 31 ft of yard as negatives, each with the vectors the finder computed.
 *
 * Nothing recomputes those vectors — the pairings underneath carry them and
 * `labelRows` assigns each to whichever run covers half of it, so the halves
 * collect them geometrically. That is an elegant design and it is also the
 * reason this test has to exist: the mechanism is invisible, so a change to
 * `belongsTo`'s band or to the split's geometry could silently orphan every
 * pairing and the only symptom would be a smaller file.
 *
 * The case is Camp Bow Wow A101's north wall and the outdoor play yards.
 */
const FEET_PER_UNIT = 288;
const ft = (n: number) => n / FEET_PER_UNIT;

const run = (id: string, x1: number, x2: number, y = 0): Candidate => ({
  id,
  x1: ft(x1),
  y1: ft(y),
  x2: ft(x2),
  y2: ft(y),
  lengthFeet: Math.abs(x2 - x1),
  thicknessIn: 7.5,
  from: "pair",
  note: "",
});

/**
 * Pairings along the wall, every 10 ft, each with its own vector.
 *
 * Offset a few inches off the centreline, ALTERNATING sides, because that is
 * where real pairings sit — a pairing is a pair of faces and its centre lands
 * wherever the two lines average out, never exactly on the run. The first
 * version put them at y = 0 exactly, and a mutation that collapsed
 * `belongsTo`'s band to zero still passed: at zero offset, "further than the
 * band" is false and everything matched anyway. A fixture more perfect than
 * reality tests a case that cannot happen.
 */
const pairings: LabelCandidate[] = Array.from({ length: 16 }, (_, i) => ({
  x1: ft(i * 10),
  y1: ft(i % 2 === 0 ? 0.15 : -0.12),
  x2: ft(i * 10 + 9),
  y2: ft(i % 2 === 0 ? 0.15 : -0.12),
  lengthFeet: 9,
  thicknessFeet: 7.5 / 12,
  // A vector that identifies which pairing it is, so a mix-up is visible.
  features: [i, 0.5, 0.25],
}));

const asVerdict = (c: Candidate, verdict: LabelVerdict["verdict"]): LabelVerdict => ({
  x1: c.x1,
  y1: c.y1,
  x2: c.x2,
  y2: c.y2,
  lengthFeet: c.lengthFeet,
  thicknessFeet: (c.thicknessIn ?? 0) / 12,
  verdict,
});

/** The sheet: a 160 ft wall with the building's east wall crossing at 129. */
function split() {
  let state = startReview(
    [run("north", 0, 160), { ...run("east", 129, 129), y1: ft(-40), y2: ft(40) }],
    FEET_PER_UNIT,
  );
  state = { ...state, verdicts: { ...state.verdicts, east: "wall" } };
  const at = crossingPoint(state, "north");
  expect(at, "no crossing, so this proves nothing").not.toBeNull();
  const out = splitCandidate(state, "north", at!, FEET_PER_UNIT);
  expect(out.halves, "the split refused, so this proves nothing").not.toBeNull();
  return out;
}

describe("a split half carries its own training data", () => {
  it("KEEPS EVERY PAIRING, SPLIT BETWEEN THE TWO HALVES", () => {
    const { state, halves } = split();
    const byId = new Map(state.candidates.map((c) => [c.id, c]));
    const west = byId.get(halves![0])!;
    const east = byId.get(halves![1])!;

    const file = labelFile({
      set: "split", sheet: "A101", page: 8, reviewedBy: "test",
      secondsSpent: 1, feetPerUnit: FEET_PER_UNIT, reviewComplete: true,
      candidates: pairings,
      verdicts: [asVerdict(west, "wall"), asVerdict(east, "not-wall")],
      unreviewed: 0,
    });

    // Not one pairing lost. 16 of them, every one on one half or the other.
    expect(file.rows, "pairings were orphaned by the split").toHaveLength(pairings.length);
    expect(file.rows.every((r) => r.features.length === 3)).toBe(true);

    // And every vector is intact and distinct — not a default, not a copy.
    const seen = new Set(file.rows.map((r) => r.features[0]));
    expect(seen.size, "vectors were duplicated or defaulted").toBe(pairings.length);
  });

  it("GIVES EACH HALF ITS OWN VERDICT, and the right pairings get it", () => {
    const { state, halves } = split();
    const byId = new Map(state.candidates.map((c) => [c.id, c]));
    const file = labelFile({
      set: "split", sheet: "A101", page: 8, reviewedBy: "test",
      secondsSpent: 1, feetPerUnit: FEET_PER_UNIT, reviewComplete: true,
      candidates: pairings,
      verdicts: [
        asVerdict(byId.get(halves![0])!, "wall"),
        asVerdict(byId.get(halves![1])!, "not-wall"),
      ],
      unreviewed: 0,
    });

    // Both labels present: the west half is positive, the east negative.
    const positive = file.rows.filter((r) => r.label === 1);
    const negative = file.rows.filter((r) => r.label === 0);
    expect(positive.length, "no pairing came out positive").toBeGreaterThan(0);
    expect(negative.length, "no pairing came out negative").toBeGreaterThan(0);

    // And they are the RIGHT ones: pairing i starts at i*10 ft, so everything
    // under 129 ft belongs to the west half and must be positive.
    for (const row of file.rows) {
      const startsAt = row.features[0] * 10;
      const shouldBeWall = startsAt + 4.5 < 129;
      expect(
        row.label === 1,
        `the pairing at ${startsAt} ft came out ${row.label === 1 ? "positive" : "negative"}`,
      ).toBe(shouldBeWall);
    }
  });

  it("DOES NOT LET ONE HALF CLAIM THE OTHER'S PAIRINGS", () => {
    // The verdicts REVERSED: east accepted, west rejected. Nonsense as a
    // reading of the building, and that is the point — it is the only
    // arrangement where a half claiming the whole parent's extent gives a
    // different answer from a half claiming its own.
    //
    // With correct extents: the three eastern pairings are positive and the
    // thirteen western ones negative. With a half that was never moved, it
    // covers everything, and `labelRows` prefers a "wall" verdict when two
    // match — so every pairing comes out positive. A mutation that left the
    // second half unmoved survived until this case existed.
    const { state, halves } = split();
    const byId = new Map(state.candidates.map((c) => [c.id, c]));
    const file = labelFile({
      set: "split", sheet: "A101", page: 8, reviewedBy: "test",
      secondsSpent: 1, feetPerUnit: FEET_PER_UNIT, reviewComplete: true,
      candidates: pairings,
      verdicts: [
        asVerdict(byId.get(halves![0])!, "not-wall"),
        asVerdict(byId.get(halves![1])!, "wall"),
      ],
      unreviewed: 0,
    });
    const positive = file.rows.filter((r) => r.label === 1);
    expect(
      positive.length,
      "every pairing came out positive — a half is claiming the other's",
    ).toBeLessThan(file.rows.length / 2);
    expect(positive.length, "no pairing came out positive").toBeGreaterThan(0);
    for (const row of file.rows) {
      const startsAt = row.features[0] * 10;
      expect(row.label === 1, `the pairing at ${startsAt} ft`).toBe(startsAt + 4.5 >= 129);
    }
  });

  it("is not just the unsplit answer wearing a different shape", () => {
    // The control: without the split, judging the whole run as one wall makes
    // EVERY pairing positive, including the 31 ft of yard. If the test above
    // ever passes for that reason it is measuring nothing.
    const whole = labelFile({
      set: "split", sheet: "A101", page: 8, reviewedBy: "test",
      secondsSpent: 1, feetPerUnit: FEET_PER_UNIT, reviewComplete: true,
      candidates: pairings,
      verdicts: [asVerdict(run("north", 0, 160), "wall")],
      unreviewed: 0,
    });
    expect(whole.rows.every((r) => r.label === 1)).toBe(true);
    expect(whole.rows.filter((r) => r.label === 0)).toHaveLength(0);
  });
});
