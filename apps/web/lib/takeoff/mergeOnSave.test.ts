import { describe, expect, it } from "vitest";
import { labelFile, type LabelCandidate, type LabelVerdict } from "./labelRows";
import { startReview, type Candidate } from "./answerKeyReview";
import { restoreSaved, type SavedSheet } from "./restoreSaved";

/**
 * ── A SAVE MUST NOT DROP A DECISION SOMEBODY MADE ──
 *
 * The reopen matches saved verdicts to the candidates this build proposes, and
 * the label files on this machine span SEVEN finder builds — so on an older
 * sheet some decisions fit nothing. Writing the file without them means one
 * added trace deletes an hour of reviewed work, with no warning and no copy.
 * That exact accident has happened once already through a different door: Camp
 * Bow Wow A101's 143 verdicts became 15, which is why the route carries a
 * shrink guard.
 *
 * So this is the round trip, as a test: label file in, reopen, add work, save,
 * and every original verdict must still be there.
 */
const FPU = 100;

const cand = (id: string, y: number, x1: number, x2: number, thicknessIn: number | null): Candidate => ({
  id,
  x1: x1 / FPU,
  y1: y / FPU,
  x2: x2 / FPU,
  y2: y / FPU,
  lengthFeet: x2 - x1,
  thicknessIn,
  from: "pair",
  note: "",
});

const sv = (y: number, x1: number, x2: number, verdict: string, thicknessFeet = 0.5) => ({
  x1: x1 / FPU,
  y1: y / FPU,
  x2: x2 / FPU,
  y2: y / FPU,
  lengthFeet: x2 - x1,
  thicknessFeet,
  verdict,
});

/** A sheet labelled on an older build: three decisions, one of which still fits. */
const olderFile = (): SavedSheet & { rows: unknown[] } => ({
  set: "S",
  sheet: "A1",
  page: 1,
  feetPerUnit: FPU,
  finderVersion: "aaaaaaaaaaaa1111",
  reviewedBy: "chrome",
  verdicts: [
    sv(10, 0, 40, "wall"),
    sv(60, 0, 40, "not-wall"),
    sv(80, 0, 30, "unsure"),
    sv(95, 0, 12, "traced", 0),
  ],
  rows: [{ features: [1, 2, 3], from: "pair", label: 1, lengthFt: 40 }],
});

/** What this build proposes now: only the first wall survives. */
const nowCandidates = () => [cand("w0", 10, 0, 40, 6), cand("w9", 200, 0, 15, 4)];

describe("reopening a sheet whose candidates have moved", () => {
  it("restores what fits and CARRIES what does not", () => {
    const got = restoreSaved(olderFile(), startReview(nowCandidates()), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.decisions).toBe(1);
    expect(got.carried).toHaveLength(2);
    expect(got.sourceFinderVersion).toBe("aaaaaaaaaaaa1111");
    // The trace is restored rather than carried: it belongs to no candidate.
    expect(got.traces).toBe(1);
  });

  it("is TRACE-ONLY below the floor, and says what is held back", () => {
    // One of three decisions fits — 33%, far under 90%.
    const got = restoreSaved(olderFile(), startReview(nowCandidates()), FPU);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.traceOnly).toBe(true);
    expect(got.message).toContain("2 saved decisions kept but not shown");
    expect(got.message).toContain("TRACING");
    // It must NOT claim the work is lost, because it is not.
    expect(got.message).toContain("nothing already decided is lost");
  });
});

describe("saving after that reopen", () => {
  function saveAfterReopen() {
    const got = restoreSaved(olderFile(), startReview(nowCandidates()), FPU);
    if (!got.ok) throw new Error("the fixture must restore");

    // The reviewer accepts the one candidate that fits and adds a trace.
    const newVerdicts: LabelVerdict[] = [
      {
        x1: 0,
        y1: 10 / FPU,
        x2: 40 / FPU,
        y2: 10 / FPU,
        lengthFeet: 40,
        thicknessFeet: 0.5,
        verdict: "wall",
      },
      {
        x1: 0,
        y1: 150 / FPU,
        x2: 20 / FPU,
        y2: 150 / FPU,
        lengthFeet: 20,
        thicknessFeet: 0,
        verdict: "traced",
      },
    ];
    const candidates: LabelCandidate[] = [];
    return labelFile({
      set: "S",
      sheet: "A1",
      page: 1,
      reviewedBy: "chrome",
      secondsSpent: 60,
      feetPerUnit: FPU,
      reviewComplete: false,
      candidates,
      verdicts: newVerdicts,
      unreviewed: 1,
      carried: got.carried.map((v) => ({
        x1: v.x1,
        y1: v.y1,
        x2: v.x2,
        y2: v.y2,
        lengthFeet: v.lengthFeet,
        thicknessFeet: v.thicknessFeet ?? 0,
        verdict: v.verdict as LabelVerdict["verdict"],
        finderVersion: got.sourceFinderVersion ?? undefined,
      })),
      splits: got.carriedSplits,
      carriedRows: { finderVersion: got.sourceFinderVersion, rows: olderFile().rows },
    });
  }

  it("keeps EVERY original verdict, plus the new work", () => {
    const file = saveAfterReopen();
    // Three decisions and one trace were saved before; one decision and one
    // trace are new. Nothing may be missing.
    const kinds = file.verdicts.map((v) => `${v.verdict}@${v.lengthFeet.toFixed(0)}`);
    expect(kinds).toContain("not-wall@40"); // carried
    expect(kinds).toContain("unsure@30"); // carried
    expect(kinds).toContain("wall@40"); // re-decided on this build
    expect(kinds).toContain("traced@20"); // new
    expect(file.verdicts).toHaveLength(4);
  });

  it("tags each carried verdict with the build it came from", () => {
    const file = saveAfterReopen();
    const carried = file.verdicts.filter(
      (v) => (v as { finderVersion?: string }).finderVersion !== undefined,
    );
    expect(carried).toHaveLength(2);
    for (const v of carried) {
      expect((v as { finderVersion?: string }).finderVersion).toBe("aaaaaaaaaaaa1111");
    }
  });

  it("counts the carried ones, so the file does not argue with itself", () => {
    // ── EVERY CENSUS HERE READS `counts` ──
    const file = saveAfterReopen();
    expect(file.counts.rejected).toBe(1);
    expect(file.counts.accepted).toBe(1);
    expect(file.counts.unsure).toBe(1);
  });

  it("keeps the previous build's rows, under that build", () => {
    // A row is {features, from, label, lengthFt} — no id, no geometry — so it
    // cannot be matched to the verdict it came from. Kept whole rather than
    // guessed at by length.
    const file = saveAfterReopen();
    expect(file.carriedRows?.finderVersion).toBe("aaaaaaaaaaaa1111");
    expect(file.carriedRows?.rows).toHaveLength(1);
  });

  it("writes nothing extra when nothing was carried", () => {
    const file = labelFile({
      set: "S",
      sheet: "A1",
      page: 1,
      reviewedBy: "chrome",
      secondsSpent: 1,
      feetPerUnit: FPU,
      reviewComplete: true,
      candidates: [],
      verdicts: [],
      unreviewed: 0,
    });
    expect(file.verdicts).toHaveLength(0);
    expect(file.carriedRows).toBeNull();
    expect(file.splits).toHaveLength(0);
  });
});
