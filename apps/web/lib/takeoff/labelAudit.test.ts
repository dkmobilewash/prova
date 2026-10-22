import { describe, expect, it } from "vitest";
import { auditSheet, overlapFeet, type AuditInput, type AuditRun } from "./labelAudit";

/**
 * The audit's value is the flags, so the cases are mostly about what it must
 * NOT flag: a check that fires on every sheet is one nobody reads, and a
 * reviewer told their corners are duplicates will stop believing it by the
 * third sheet.
 */
const FPU = 100; // a 100 ft-wide sheet
const run = (
  y: number,
  x1: number,
  x2: number,
  verdict: string,
): AuditRun => ({
  x1: x1 / FPU,
  y1: y / FPU,
  x2: x2 / FPU,
  y2: y / FPU,
  lengthFeet: Math.abs(x2 - x1),
  verdict,
});
const vertical = (x: number, y1: number, y2: number, verdict: string): AuditRun => ({
  x1: x / FPU,
  y1: y1 / FPU,
  x2: x / FPU,
  y2: y2 / FPU,
  lengthFeet: Math.abs(y2 - y1),
  verdict,
});

const sheet = (verdicts: AuditRun[], extra: Partial<AuditInput> = {}): AuditInput => ({
  set: "S.pdf",
  sheet: "A1",
  feetPerUnit: FPU,
  reviewComplete: true,
  finderVersion: "abc123abc123",
  counts: { unreviewed: 0 },
  verdicts,
  ...extra,
});

const audit = (verdicts: AuditRun[], extra: Partial<AuditInput> = {}) =>
  auditSheet(sheet(verdicts, extra), "abc123abc123");

describe("double-counted footage", () => {
  it("flags two accepted runs along one wall", () => {
    const got = audit([run(10, 0, 30, "wall"), run(10.5, 5, 25, "wall")]);
    expect(got.overlaps).toHaveLength(1);
    expect(got.overlaps[0].kind).toBe("accept-accept");
    expect(got.overlaps[0].feet).toBeCloseTo(20);
    expect(got.flags.join(" ")).toContain("counted twice");
  });

  it("DOES NOT flag two walls meeting at a corner", () => {
    // The commonest shape on any plan. Flagging it makes the audit useless.
    const got = audit([run(10, 0, 30, "wall"), vertical(30, 10, 40, "wall")]);
    expect(got.overlaps).toEqual([]);
    expect(got.flags).toEqual([]);
  });

  it("does not flag a wall crossing at a shallow angle", () => {
    // ── BOTH ENDS IN THE BAND, NOT THE MIDPOINT ──
    //
    // A long run whose MIDPOINT sits exactly on the wall and whose ends are
    // 3 ft off it — a midpoint test calls that a duplicate. It also has to be
    // parallel enough to get past the direction test, or it is rejected for
    // the wrong reason and the band is never exercised: the first version of
    // this case was, which mutation found by flipping the band to a midpoint
    // test and watching nothing go red.
    const shallow: AuditRun = { x1: 0, y1: 0.07, x2: 0.6, y2: 0.13, lengthFeet: 60, verdict: "wall" };
    const got = audit([run(10, 0, 30, "wall"), shallow]);
    expect(got.overlaps).toEqual([]);
  });

  it("does not flag a SHORT DIAGONAL stub lying along the wall", () => {
    // The case that makes the direction test load-bearing. A 45° stub two
    // feet long sits entirely inside the band — the band cannot reject it —
    // and its projection onto the wall is long enough to clear the
    // one-foot junction threshold. Only the direction test refuses it.
    const stub: AuditRun = { x1: 0.15, y1: 0.09, x2: 0.167, y2: 0.107, lengthFeet: 2.4, verdict: "wall" };
    const got = audit([run(10, 0, 30, "wall"), stub]);
    expect(got.overlaps, "a diagonal stub was called a duplicate").toEqual([]);
  });

  it("does not flag two walls a room apart", () => {
    const got = audit([run(10, 0, 30, "wall"), run(25, 0, 30, "wall")]);
    expect(got.overlaps).toEqual([]);
  });

  it("ignores a foot of overlap, which is a junction and not a duplicate", () => {
    const got = audit([run(10, 0, 30, "wall"), run(10, 29.4, 50, "wall")]);
    expect(got.overlaps).toEqual([]);
  });
});

/**
 * ── TRACED WALLS AGAINST ACCEPTED ONES ──
 *
 * Tracing records a wall the finder MISSED. A trace lying over a run that was
 * already accepted is double-counted KEY footage, which inflates a held-out
 * score in the flattering direction — the one direction nobody checks.
 */
describe("traced walls", () => {
  it("flags a trace drawn over an accepted run", () => {
    const got = audit([run(10, 0, 30, "wall"), run(10, 0, 30, "traced")]);
    expect(got.overlaps).toHaveLength(1);
    expect(got.overlaps[0].kind).toBe("trace-accept");
    expect(got.overlaps[0].feet).toBeCloseTo(30);
  });

  it("A TRACE THAT MEETS AN ACCEPTED RUN END TO END IS NOT AN OVERLAP", () => {
    // The finder found half a wall; the reviewer traced the other half. They
    // touch at a point and share no length. Flagging this would tell somebody
    // their correct work is a double count.
    const got = audit([run(10, 0, 30, "wall"), run(10, 30, 50, "traced")]);
    expect(got.overlaps).toEqual([]);
    expect(got.acceptedFeet + got.tracedFeet).toBeCloseTo(50);
  });

  it("a SHORT trace for the missing end of a partly accepted wall keeps its length", () => {
    // The commonest trace on a held-out sheet: the finder stopped early.
    const got = audit([run(10, 0, 44, "wall"), run(10, 44, 50, "traced")]);
    expect(got.overlaps).toEqual([]);
    expect(got.tracedFeet).toBeCloseTo(6);
    expect(got.acceptedFeet).toBeCloseTo(44);
  });

  it("a trace THROUGH a door opening overlaps the runs either side, and says how much", () => {
    // ── THE TWO WAYS A REVIEWER DRAWS THE SAME WALL ──
    //
    // A door splits a wall into two accepted runs. A reviewer may trace the
    // wall as ONE line straight through the opening — which is a reasonable
    // reading, and it double-counts both halves. The audit's job is to say
    // so with the footage, not to decide which reading is right.
    const got = audit([
      run(10, 0, 20, "wall"),
      run(10, 23, 50, "wall"),
      run(10, 0, 50, "traced"),
    ]);
    expect(got.overlaps).toHaveLength(2);
    expect(got.doubleCountedFeet).toBeCloseTo(47);
  });

  it("a trace that STOPS at the door opening does not overlap either side", () => {
    // The other reading: the reviewer traces only the gap the finder missed.
    // Nothing is double counted and nothing should be flagged.
    const got = audit([
      run(10, 0, 20, "wall"),
      run(10, 23, 50, "wall"),
      run(10, 20, 23, "traced"),
    ]);
    expect(got.overlaps).toEqual([]);
    expect(got.tracedFeet).toBeCloseTo(3);
    expect(got.acceptedFeet + got.tracedFeet).toBeCloseTo(50);
  });

  it("does not flag a trace against a REJECTED run", () => {
    // Tracing over ground the reviewer rejected is the normal way to correct
    // a bad candidate — the rejected run contributes nothing to the key.
    const got = audit([run(10, 0, 30, "not-wall"), run(10, 0, 30, "traced")]);
    expect(got.overlaps).toEqual([]);
  });
});

describe("what the reviewer left behind", () => {
  it("flags undecided candidates", () => {
    const got = audit([run(10, 0, 30, "wall")], { counts: { unreviewed: 7 } });
    expect(got.flags.join(" ")).toContain("7 candidate(s) left undecided");
  });

  it("reports not-sure runs with their footage", () => {
    const got = audit([run(10, 0, 30, "wall"), run(40, 0, 12, "unsure")]);
    expect(got.unsure).toBe(1);
    expect(got.unsureFeet).toBeCloseTo(12);
    expect(got.flags.join(" ")).toContain("not sure");
  });

  it("says nothing when there is nothing to say", () => {
    expect(audit([run(10, 0, 30, "wall")]).flags).toEqual([]);
  });
});

describe("the scale check", () => {
  it("passes an ordinary floor plan", () => {
    // 240 ft of partition on a 100 ft-wide sheet is 2.4x — the top of what
    // the nine sheets labelled so far actually show.
    const walls = Array.from({ length: 8 }, (_, i) => run(10 + i * 5, 0, 30, "wall"));
    const got = audit(walls);
    expect(got.footageRatio).toBeCloseTo(2.4);
    expect(got.flags).toEqual([]);
  });

  it("CATCHES A SCALE OUT BY TEN", () => {
    // Every wall still looks like a wall on screen; only the total gives it
    // away. 30 walls of 50 ft on a 100 ft sheet is 15x.
    const walls = Array.from({ length: 30 }, (_, i) => run(1 + i, 0, 50, "wall"));
    const got = audit(walls);
    expect(got.flags.join(" ")).toContain("CHECK THE SCALE");
  });

  it("does not flag a sheet with nothing accepted", () => {
    // A sheet of furniture is a legitimate zero, not a scale error.
    expect(audit([run(10, 0, 30, "not-wall")]).flags).toEqual([]);
  });
});

describe("the finder version", () => {
  it("flags a dirty build", () => {
    const got = audit([run(10, 0, 30, "wall")], { finderVersion: "abc123-dirty" });
    expect(got.flags.join(" ")).toContain("cannot be got back");
  });

  it("flags a missing version", () => {
    const got = audit([run(10, 0, 30, "wall")], { finderVersion: undefined });
    expect(got.flags.join(" ")).toContain("unrecorded");
  });

  it("flags a version that differs from the build now running", () => {
    const got = auditSheet(sheet([run(10, 0, 30, "wall")]), "different999");
    expect(got.flags.join(" ")).toContain("differs from the build now running");
  });

  it("says nothing when it matches", () => {
    expect(auditSheet(sheet([run(10, 0, 30, "wall")]), "abc123abc123").flags).toEqual([]);
  });

  it("does not compare when the current build is unknown", () => {
    expect(auditSheet(sheet([run(10, 0, 30, "wall")]), null).flags).toEqual([]);
  });
});

describe("overlapFeet on its own", () => {
  it("is zero for perpendicular runs", () => {
    expect(overlapFeet(run(10, 0, 30, "wall"), vertical(15, 0, 30, "wall"), FPU)).toBe(0);
  });

  it("measures the shared span, not the longer run", () => {
    expect(overlapFeet(run(10, 0, 30, "wall"), run(10, 20, 60, "wall"), FPU)).toBeCloseTo(10);
  });

  it("is symmetric enough to flag a pair once from either side", () => {
    const a = run(10, 0, 30, "wall");
    const b = run(10, 10, 20, "wall");
    expect(overlapFeet(a, b, FPU)).toBeCloseTo(10);
    expect(overlapFeet(b, a, FPU)).toBeCloseTo(10);
  });
});
