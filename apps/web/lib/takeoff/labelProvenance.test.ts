import { describe, expect, it } from "vitest";
import { UNKNOWN_FINDER, finderVersion, sameFinder } from "./finderVersion";
import { collectSheet, collectSheets } from "./labelCollect";
import { labelFile, type LabelCandidate, type LabelVerdict } from "./labelRows";

/**
 * ── WHICH FINDER DREW THE CANDIDATES, AND WHY ROWS ARE REBUILT ──
 *
 * A label file holds verdicts about walls, which never go stale, and rows of
 * features about the candidates one build of the finder drew, which go stale
 * the moment it changes. On 2026-10-20 Camp Bow Wow A120's saved
 * `21.7 ft / 3.8 in` had become `22.6 ft / 7.7 in` after the view picking and
 * the splitting changed, and nothing in the file said so — the mismatch read
 * as a matching bug rather than as two different finders.
 */
const CANDIDATE = (at: number, y: number, len: number): LabelCandidate => ({
  x1: 0.1,
  y1: y,
  x2: 0.1 + len / 100,
  y2: y,
  lengthFeet: len,
  thicknessFeet: 0.5,
  features: [at, len, 0, 0],
});

const VERDICT = (y: number, len: number, verdict: LabelVerdict["verdict"]): LabelVerdict => ({
  x1: 0.1,
  y1: y,
  x2: 0.1 + len / 100,
  y2: y,
  lengthFeet: len,
  thicknessFeet: 0.5,
  verdict,
});

describe("the finder version a label file records", () => {
  it("takes the one the environment names", () => {
    expect(finderVersion({ TAKEOFF_FINDER_VERSION: "abc123def456" })).toBe("abc123def456");
  });

  it("says unknown rather than inventing one", () => {
    expect(finderVersion({})).toBe(UNKNOWN_FINDER);
    expect(finderVersion({ TAKEOFF_FINDER_VERSION: "   " })).toBe(UNKNOWN_FINDER);
  });

  it("falls back to the deployed commit, shortened", () => {
    expect(finderVersion({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123" })).toBe("0123456789ab");
  });

  it("is written into the file", () => {
    const file = labelFile({
      set: "E_Street_421-Set.pdf",
      sheet: "A2.1",
      page: 28,
      reviewedBy: "Diego",
      secondsSpent: 100,
      finderVersion: "deadbeef1234",
      feetPerUnit: 144,
      reviewComplete: true,
      candidates: [],
      verdicts: [],
      unreviewed: 0,
    });
    expect(file.finderVersion).toBe("deadbeef1234");
  });

  describe("comparing two recorded versions", () => {
    it("matches a build with itself", () => {
      expect(sameFinder("abc123def456", "abc123def456")).toBe(true);
    });

    it("refuses two unknowns", () => {
      // Two files that both failed to record a version are NOT thereby from
      // the same finder, and treating them as equal turns a missing value
      // into a false assurance.
      expect(sameFinder(UNKNOWN_FINDER, UNKNOWN_FINDER)).toBe(false);
    });

    it("refuses a dirty tree, even against itself", () => {
      // Two dirty trees at one commit are two different finders unless
      // somebody checked, and nothing here can check.
      expect(sameFinder("abc123-dirty", "abc123-dirty")).toBe(false);
      expect(sameFinder("abc123-dirty", "abc123")).toBe(false);
    });
  });
});

describe("reading a saved sheet back into training rows", () => {
  // Two walls the reviewer split: the one at y=0.2 accepted, y=0.4 rejected.
  const saved = {
    set: "E_Street_421-Set.pdf",
    sheet: "A2.1",
    feetPerUnit: 144,
    reviewComplete: true,
    verdicts: [VERDICT(0.2, 20, "wall"), VERDICT(0.4, 12, "not-wall")],
    rows: [
      { features: [0, 20, 0, 0], label: 1, lengthFt: 20 },
      { features: [1, 12, 0, 0], label: 0, lengthFt: 12 },
    ],
    finderVersion: "old111111111",
  };

  it("labels today's candidates by GEOMETRY, not by position", () => {
    // ── THE WHOLE POINT ──
    //
    // Today's finder returns the SAME two walls in the opposite order, with a
    // third candidate between them. Index matching would label the accepted
    // wall with the rejection, which is the model being taught the opposite
    // of what the reviewer said, with every count still looking right.
    const today = [CANDIDATE(0, 0.4, 12), CANDIDATE(1, 0.3, 7), CANDIDATE(2, 0.2, 20)];
    const got = collectSheet(saved, today, "new222222222");
    expect(got.sheet.rows).toHaveLength(3);
    expect(got.sheet.rows[0].label, "the rejected wall, now first").toBe(0);
    expect(got.sheet.rows[2].label, "the accepted wall, now last").toBe(1);
    // And the features are TODAY's, not the ones the file stored.
    expect(got.sheet.rows[0].features[0]).toBe(0);
    expect(got.sheet.rows[2].features[0]).toBe(2);
  });

  it("reports the row count moving, rather than hiding it", () => {
    const today = [CANDIDATE(0, 0.4, 12), CANDIDATE(1, 0.3, 7), CANDIDATE(2, 0.2, 20)];
    const got = collectSheet(saved, today, "new222222222");
    expect(got.storedRows).toBe(2);
    expect(got.rebuiltRows).toBe(3);
  });

  it("says when the finder has changed", () => {
    const today = [CANDIDATE(0, 0.2, 20)];
    expect(collectSheet(saved, today, "new222222222").sameFinder).toBe(false);
    expect(collectSheet(saved, today, "old111111111").sameFinder).toBe(true);
    expect(collectSheet(saved, today, "old111111111").savedFinder).toBe("old111111111");
  });

  it("treats a file with no recorded version as a different finder", () => {
    // ── THE CURRENT FINDER IS A REAL BUILD HERE, AND THAT IS THE TEST ──
    //
    // Every label file written before this field existed has no version, and
    // they are read by a finder that DOES know its own. Asserting this with
    // `unknown` on both sides passes whether the missing value becomes
    // `unknown` or quietly becomes "whatever is running now" — the two agree
    // by accident, and the second silently declares every old file current.
    // Found by mutation; the first version of this test could not fail.
    const noVersion: Omit<typeof saved, "finderVersion"> & { finderVersion?: string } = {
      ...saved,
      finderVersion: undefined,
    };
    const got = collectSheet(noVersion, [CANDIDATE(0, 0.2, 20)], "real333333333");
    expect(got.savedFinder).toBe(UNKNOWN_FINDER);
    expect(got.sameFinder).toBe(false);
  });

  it("counts the stale ones across a run", () => {
    const today = [CANDIDATE(0, 0.2, 20)];
    const got = collectSheets(
      [
        { saved, candidates: today },
        { saved: { ...saved, finderVersion: "new222222222" }, candidates: today },
      ],
      "new222222222",
    );
    expect(got.training.counts.sheets).toBe(2);
    expect(got.staleFinders).toBe(1);
  });

  it("gives back only what trainingRows allowed, never a bare list", () => {
    // ── THE BYPASS THIS CLOSES ──
    //
    // `collectSheets` used to return `sheets`, which a caller could train on
    // without the held-out refusal ever running — a one-line path from four
    // answer-key sets into a training file. The census caught it the first
    // time the suite ran; this keeps it caught if somebody adds the
    // convenience back.
    const today = [CANDIDATE(0, 0.2, 20)];
    const got = collectSheets(
      [
        { saved, candidates: today },
        { saved: { ...saved, set: "Central Bank of the Midwest.pdf" }, candidates: today },
      ],
      "old111111111",
    );
    expect(got).not.toHaveProperty("sheets");
    expect(got.training.refused.map((r) => r.set)).toEqual(["Central Bank of the Midwest.pdf"]);
    expect(got.training.counts.sheetsRefused).toBe(1);
    // Collected and reported, because a held-out set IS labelled.
    expect(got.collected).toHaveLength(2);
    expect(got.collected[1].heldOut).not.toBeNull();
  });

  it("does not filter held-out sets — that is trainingRows' job", () => {
    // Doing it in two places is how one of them quietly stops matching the
    // other. `trainingRows` refuses and REPORTS what it refused.
    const got = collectSheet(
      { ...saved, set: "Central Bank of the Midwest.pdf" },
      [CANDIDATE(0, 0.2, 20)],
      "old111111111",
    );
    expect(got.sheet.set).toBe("Central Bank of the Midwest.pdf");
    expect(got.sheet.rows.length).toBeGreaterThan(0);
  });
});
