import { describe, expect, it } from "vitest";
import {
  DRAFT_FORMAT,
  draftFrom,
  draftKey,
  fingerprint,
  hasUnsavedWork,
  keepReview,
  restoreDraft,
  restoreOffer,
} from "./reviewDraft";
import type { Candidate, ReviewState } from "./answerKeyReview";

/**
 * ── WHAT WAS LOST, AND WHAT MUST NOT BE RESTORED WRONGLY ──
 *
 * A tab reset mid-sheet took Central Bank A101 with it: 37 decisions and 49
 * TRACES. The traces are the expensive half — each one is a wall the finder
 * missed, found by eye and drawn by hand.
 *
 * So these cases are in two halves. The first is that the work comes back.
 * The second, and the one with teeth, is that it comes back ONLY onto the
 * candidates it was about: verdicts are keyed by positional ids, so applying
 * a draft to a different candidate list attaches one wall's decision to
 * another's, silently, with every count still looking right.
 */
const candidate = (id: string, y: number): Candidate => ({
  id,
  x1: 0.1,
  y1: y,
  x2: 0.4,
  y2: y,
  lengthFeet: 30,
  thicknessIn: 6,
  from: "pair",
  note: "detected",
});

// A traced wall is a Candidate like any other, and `from` stays "single":
// that field is about how the GEOMETRY was arrived at, and a hand-drawn line
// is one line rather than a pair of faces.
const traced = (id: string, y: number): Candidate => ({ ...candidate(id, y), from: "single" });

function fresh(ids: string[]): ReviewState {
  const candidates = ids.map((id, at) => candidate(id, 0.2 + at * 0.05));
  const verdicts: Record<string, "unreviewed"> = {};
  for (const one of candidates) verdicts[one.id] = "unreviewed";
  return { candidates, verdicts, duplicates: [], traced: [] };
}

function reviewed(): ReviewState {
  const state = fresh(["w0", "w1", "w2"]);
  return {
    ...state,
    verdicts: { w0: "wall", w1: "not-a-wall", w2: "unsure" },
    traced: [traced("t0", 0.8), traced("t1", 0.85)],
  };
}

const DRAFT = { set: "CENTRAL-BANK.pdf", page: 25, finderVersion: "abc123abc123" };

describe("keeping an in-progress review", () => {
  it("keeps the decisions and the traces", () => {
    const draft = draftFrom({ state: reviewed(), ...DRAFT });
    expect(draft).not.toBeNull();
    expect(draft?.counts).toEqual({ decided: 3, traced: 2 });
    expect(draft?.traced).toHaveLength(2);
    expect(draft?.verdicts.w1).toBe("not-a-wall");
  });

  it("keeps NOTHING for an untouched sheet", () => {
    // Otherwise every sheet anybody opens leaves a draft that later offers to
    // restore nothing.
    expect(draftFrom({ state: fresh(["w0", "w1"]), ...DRAFT })).toBeNull();
  });

  it("keeps a sheet with ONE trace and no decisions", () => {
    // A trace is the expensive thing — a wall found by eye and drawn by hand
    // — so one of them is worth keeping on its own.
    const state = { ...fresh(["w0"]), traced: [traced("t0", 0.8)] };
    const draft = draftFrom({ state, ...DRAFT });
    expect(draft?.counts).toEqual({ decided: 0, traced: 1 });
  });

  it("is keyed per sheet AND per finder build", () => {
    const a = draftKey("S.pdf", 25, "abc123");
    expect(a).not.toBe(draftKey("S.pdf", 26, "abc123"));
    expect(a).not.toBe(draftKey("T.pdf", 25, "abc123"));
    expect(a, "a new finder must not reuse an old draft's slot").not.toBe(
      draftKey("S.pdf", 25, "def456"),
    );
  });
});

describe("putting it back", () => {
  it("restores every decision and every trace", () => {
    const draft = draftFrom({ state: reviewed(), ...DRAFT });
    const got = restoreDraft(draft!, fresh(["w0", "w1", "w2"]));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.state.verdicts).toEqual({ w0: "wall", w1: "not-a-wall", w2: "unsure" });
    expect(got.state.traced).toHaveLength(2);
  });

  it("OVERRIDES the duplicate pre-marking, because a reviewer outranks a rule", () => {
    // `startReview` pre-rejects the weaker twin. If the reviewer accepted it,
    // the restore must not hand the rule's answer back.
    const withPremark: ReviewState = {
      ...fresh(["w0", "w1"]),
      verdicts: { w0: "unreviewed", w1: "not-a-wall" },
    };
    const draft = draftFrom({
      state: { ...withPremark, verdicts: { w0: "unreviewed", w1: "wall" } },
      ...DRAFT,
    });
    const got = restoreDraft(draft!, withPremark);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.state.verdicts.w1).toBe("wall");
  });

  it("REFUSES when the finder now reads the sheet differently", () => {
    // ── THE CASE THIS FILE EXISTS FOR ──
    //
    // Ids are positional. A draft about three candidates applied to four
    // attaches w1's verdict to a different wall, silently.
    const draft = draftFrom({ state: reviewed(), ...DRAFT });
    const got = restoreDraft(draft!, fresh(["w0", "w1", "w2", "w3"]));
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.why).toContain("wrong walls");
  });

  it("refuses when the COUNT matches but the geometry moved", () => {
    // The harder half: a finder change that produces the same number of
    // candidates in different places. A count check alone would pass this.
    const draft = draftFrom({ state: reviewed(), ...DRAFT });
    const moved = fresh(["w0", "w1", "w2"]);
    moved.candidates[1] = { ...moved.candidates[1], y1: 0.9, y2: 0.9 };
    const got = restoreDraft(draft!, moved);
    expect(got.ok, "a moved wall was treated as the same wall").toBe(false);
  });

  it("refuses a draft from another version of this screen", () => {
    const draft = draftFrom({ state: reviewed(), ...DRAFT });
    const old = { ...draft!, format: "takeoff-review-draft-v0" as typeof DRAFT_FORMAT };
    const got = restoreDraft(old, fresh(["w0", "w1", "w2"]));
    expect(got.ok).toBe(false);
  });

  it("tolerates a float that re-reads at the last bit", () => {
    // The fingerprint rounds to a ten-thousandth of the page width — about an
    // eighth of an inch on a 288 ft sheet. A rounding difference far below
    // anything real must not throw an afternoon away.
    const draft = draftFrom({ state: reviewed(), ...DRAFT });
    const jittered = fresh(["w0", "w1", "w2"]);
    jittered.candidates[0] = { ...jittered.candidates[0], x1: 0.1 + 1e-9 };
    expect(restoreDraft(draft!, jittered).ok).toBe(true);
  });
});

describe("what the offer says before restoring", () => {
  it("names the decisions and the traces", () => {
    const draft = draftFrom({ state: reviewed(), ...DRAFT });
    expect(restoreOffer(draft!)).toBe("Restore unsaved review (3 decisions, 2 traces)");
  });

  it("says one decision, not 1 decisions", () => {
    const state = { ...fresh(["w0"]), verdicts: { w0: "wall" as const }, traced: [traced("t", 0.8)] };
    const draft = draftFrom({ state, ...DRAFT });
    expect(restoreOffer(draft!)).toBe("Restore unsaved review (1 decision, 1 trace)");
  });
});

describe("warning before leaving", () => {
  it("fires for a decision", () => {
    expect(hasUnsavedWork({ ...fresh(["w0"]), verdicts: { w0: "wall" } })).toBe(true);
  });

  it("fires for a trace with no decisions", () => {
    expect(hasUnsavedWork({ ...fresh(["w0"]), traced: [traced("t", 0.8)] })).toBe(true);
  });

  it("does NOT fire for an untouched sheet", () => {
    // A warning on every sheet anybody opens is one people learn to dismiss.
    expect(hasUnsavedWork(fresh(["w0", "w1"]))).toBe(false);
  });
});

describe("the fingerprint", () => {
  it("is the same for the same candidates", () => {
    expect(fingerprint(fresh(["w0", "w1"]).candidates)).toBe(
      fingerprint(fresh(["w0", "w1"]).candidates),
    );
  });

  it("changes when a candidate moves", () => {
    const a = fresh(["w0", "w1"]);
    const b = fresh(["w0", "w1"]);
    b.candidates[0] = { ...b.candidates[0], y1: 0.7 };
    expect(fingerprint(a.candidates)).not.toBe(fingerprint(b.candidates));
  });

  it("changes when the ORDER changes, because ids are positional", () => {
    const a = fresh(["w0", "w1"]);
    const b = { ...a, candidates: [...a.candidates].reverse() };
    expect(fingerprint(a.candidates)).not.toBe(fingerprint(b.candidates));
  });

  it("leads with the count, so a mismatch can say how many", () => {
    expect(fingerprint(fresh(["w0", "w1", "w2"]).candidates).startsWith("3:")).toBe(true);
  });
});

describe("a re-detect must not wipe the sheet", () => {
  /**
   * ── THE DEFECT THE RELOAD TEST FOUND ──
   *
   * `onCandidates` assigned `startReview` straight in, so anything that made
   * the viewer re-run detection — a redraw, a reflow, the re-render after a
   * restore — threw away every decision and put the duplicate pre-marking
   * back. No reload was needed and nothing said a word.
   *
   * Measured rather than theorised: a reload test restored 11 decisions and
   * then read 5 off the panel. The restore had worked, and a re-detect landed
   * on top of it.
   */
  it("keeps the verdicts when the same candidates come back", () => {
    const got = keepReview(reviewed(), fresh(["w0", "w1", "w2"]));
    expect(got.verdicts).toEqual({ w0: "wall", w1: "not-a-wall", w2: "unsure" });
  });

  it("keeps the traces, which no re-detect can reproduce", () => {
    expect(keepReview(reviewed(), fresh(["w0", "w1", "w2"])).traced).toHaveLength(2);
  });

  it("takes the FRESH review when the sheet really was re-read", () => {
    // A different candidate list is a different set of walls, and keeping
    // verdicts across it would attach them to the wrong ones.
    const got = keepReview(reviewed(), fresh(["w0", "w1", "w2", "w3"]));
    expect(Object.values(got.verdicts).every((v) => v === "unreviewed")).toBe(true);
  });

  it("takes the fresh review when there was nothing before", () => {
    const first = fresh(["w0"]);
    expect(keepReview(null, first)).toBe(first);
  });

  it("lets the fresh pre-marking stand where the reviewer had not decided", () => {
    // The duplicate rule's answer is better than nothing; only the reviewer's
    // own decisions outrank it.
    const untouched: ReviewState = {
      ...fresh(["w0", "w1"]),
      verdicts: { w0: "unreviewed", w1: "unreviewed" },
    };
    const premarked: ReviewState = {
      ...fresh(["w0", "w1"]),
      verdicts: { w0: "unreviewed", w1: "not-a-wall" },
    };
    expect(keepReview(untouched, premarked).verdicts.w1).toBe("not-a-wall");
  });
});
