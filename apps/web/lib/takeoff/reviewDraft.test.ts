import { describe, expect, it } from "vitest";
import {
  DRAFT_FORMAT,
  draftFrom,
  draftKey,
  fingerprint,
  hasUnsavedWork,
  keepReview,
  mergeOffered,
  restoreDraft,
  reviewSignature,
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
  return { candidates, verdicts, duplicates: [], traced: [], splits: [] };
}

function reviewed(): ReviewState {
  const state = fresh(["w0", "w1", "w2"]);
  return {
    ...state,
    verdicts: { w0: "wall", w1: "not-a-wall", w2: "unsure" },
    traced: [traced("t0", 0.8), traced("t1", 0.85)],
    splits: [],
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
    // ── ONE MORE CANDIDATE IS A RE-READ AS FAR AS THIS FUNCTION GOES ──
    //
    // It passed `["w0", "w1", "w2", "w3"]` against a reviewed `w0..w2` and
    // asserted every verdict was dropped, on the stated grounds that "a
    // different candidate list is a different set of walls". That was exactly
    // right while ids were POSITIONAL, where `w0` in a three-list and `w0` in
    // a four-list could be different walls.
    //
    // Ids are geometric now — `candidatesFromSheet` builds them from the
    // coordinates, the same thing a saved file matches on — so an id appearing
    // in both lists IS the same wall, and a longer list containing all of the
    // old ones is the same sheet with more on offer. The hatch override
    // produces exactly that, deliberately.
    //
    // So a real re-read is a list that does not contain what the reviewer
    // judged, which is what this now passes.
    const got = keepReview(reviewed(), fresh(["w0", "w1", "w2", "w3"]));
    expect(Object.values(got.verdicts).every((v) => v === "unreviewed")).toBe(true);
    expect(got.traced, "a re-read sheet keeps no traces either").toHaveLength(0);
  });

  it("keeps the work on a sheet with a SPLIT and a CARRIED decision — NG Green Bay A3.1", () => {
    // ── THE REPRODUCTION OF WHAT CHROME HIT ──
    //
    // NG Green Bay A3.1 restored as "109 saved decisions and 32 traces, 1
    // split re-applied, 1 kept but not shown", panel reading 121 of 181. One
    // press of "Also judge the hatched ones" and it read 25 of 185 reviewed,
    // 0 walls, 0 traces, 0 ft. Nothing had been saved, so the file survived.
    //
    // The containment test is why. A restored sheet legitimately holds
    // candidates THE FINDER DOES NOT PROPOSE, and `SplitRecord`'s own comment
    // says so: "a split replaces one candidate with two halves that the
    // finder never proposed". A carried decision is the same shape — it is
    // kept precisely BECAUSE this build no longer offers its candidate.
    //
    // So `existing ⊆ fresh` is false on any sheet that was split or carried,
    // and the all-or-nothing fallback threw the review away. My smoke covered
    // a clean sheet, where it holds.
    const split = { ...candidate("w-half-a", 0.30), lengthFeet: 9 };
    const other = { ...candidate("w-half-b", 0.32), lengthFeet: 9 };
    const carried = { ...candidate("w-carried", 0.9), lengthFeet: 14 };
    const existing: ReviewState = {
      candidates: [candidate("w0", 0.2), candidate("w1", 0.25), split, other, carried],
      verdicts: {
        w0: "wall",
        w1: "not-a-wall",
        "w-half-a": "wall",
        "w-half-b": "unsure",
        "w-carried": "wall",
      },
      duplicates: [],
      traced: [traced("t0", 0.8), traced("t1", 0.85)],
      splits: [],
    };
    // What the finder proposes once the hatched lines are offered too: the two
    // ordinary candidates, plus hatch singles. The split halves and the
    // carried decision are NOT here, and never will be.
    const offered = fresh(["w0", "w1", "s-hatch-1", "s-hatch-2", "s-hatch-3"]);

    const got = mergeOffered(existing, offered);

    expect(got.verdicts.w0, "the reviewer's own decisions must survive").toBe("wall");
    expect(got.verdicts.w1).toBe("not-a-wall");
    expect(got.traced, "and the 32 traces, which were the expensive part").toHaveLength(2);
    // The split halves and the carried decision must still be ON the sheet.
    // Dropping them loses work that cannot be recovered from the finder.
    expect(got.verdicts["w-half-a"], "a split half's verdict").toBe("wall");
    expect(got.verdicts["w-half-b"]).toBe("unsure");
    expect(got.verdicts["w-carried"], "a carried decision's verdict").toBe("wall");
    expect(got.candidates.map((c) => c.id)).toEqual(
      expect.arrayContaining(["w-half-a", "w-half-b", "w-carried"]),
    );
    // And the hatched lines really did arrive, unjudged.
    expect(got.verdicts["s-hatch-1"]).toBe("unreviewed");
    expect(got.candidates).toHaveLength(8);
  });

  it("keeps the work when the override is pressed again and the list shrinks", () => {
    // The toggle goes both ways, and this direction is the one that bit: the
    // list got shorter, the old rule fell through to `fresh`, and the sheet
    // lost every verdict. In the smoke test it surfaced three steps later as
    // "no accepted run over 6 ft to halve", which looks like a different bug.
    // Pressing it again offers FEWER, and `mergeOffered` is additive — so the
    // hatched candidates stay on the sheet with whatever verdicts they were
    // given. That is the right answer: a verdict a reviewer actually recorded
    // must not vanish because they collapsed a view. The counts the panel
    // shows come from the candidates it has, and nothing is lost.
    const before = reviewed();
    const got = mergeOffered(before, fresh(["w0", "w1"]));

    expect(got.verdicts.w0).toBe("wall");
    expect(got.verdicts.w1).toBe("not-a-wall");
    expect(got.traced, "and the traces survive the way back too").toHaveLength(2);
  });

  it("keeps the work when the list only GREW, as the hatch override makes it", () => {
    // The override offers the hatch-classed lines as well, mid-sheet. Every
    // candidate the reviewer already judged is still there, so dropping their
    // verdicts would cost them the morning for pressing a button — which is
    // what happened before `keepReview` could tell growth from a re-read, and
    // the smoke test is what caught it.
    const before = reviewed();
    const got = mergeOffered(before, fresh(["w0", "w1", "w2", "s-hatch-1", "s-hatch-2"]));

    expect(got.verdicts.w0).toBe("wall");
    expect(got.verdicts.w1).toBe("not-a-wall");
    expect(got.verdicts.w2).toBe("unsure");
    expect(got.verdicts["s-hatch-1"], "the new ones arrive unjudged").toBe("unreviewed");
    expect(got.candidates).toHaveLength(5);
    expect(got.traced, "and the traces are still there").toHaveLength(2);
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

describe("a save disarms the leave-page warning", () => {
  /**
   * ── THE TAB THAT WOULD NOT MOVE ──
   *
   * After "Labels saved…" on Murray A101, the tab could not navigate:
   * navigation failed twice, setting `location` from a script did nothing,
   * F5 did not reload, and no dialog was visible. An automation browser
   * dismisses a `beforeunload` prompt, and a dismissed prompt CANCELS the
   * navigation — so the tab was trapped by a warning about work that had
   * already been written to disk.
   *
   * The cause is that the warning asked only whether the review had any work
   * in it. A save does not empty the review; the reviewer goes on looking at
   * the sheet they just saved.
   */
  it("warns while the work is unsaved", () => {
    expect(hasUnsavedWork(reviewed())).toBe(true);
  });

  it("STOPS warning once that exact review is saved", () => {
    const state = reviewed();
    expect(hasUnsavedWork(state, reviewSignature(state))).toBe(false);
  });

  it("warns again after one more decision", () => {
    const state = reviewed();
    const saved = reviewSignature(state);
    const changed: ReviewState = { ...state, verdicts: { ...state.verdicts, w2: "wall" } };
    expect(hasUnsavedWork(changed, saved), "a change after the save went unwarned").toBe(true);
  });

  it("warns again after one more TRACE", () => {
    // The expensive kind of change, and the one a signature over verdicts
    // alone would miss.
    const state = reviewed();
    const saved = reviewSignature(state);
    const changed: ReviewState = { ...state, traced: [...state.traced, traced("t2", 0.9)] };
    expect(hasUnsavedWork(changed, saved)).toBe(true);
  });

  it("warns again after a trace is REMOVED", () => {
    const state = reviewed();
    const saved = reviewSignature(state);
    const changed: ReviewState = { ...state, traced: state.traced.slice(1) };
    expect(hasUnsavedWork(changed, saved)).toBe(true);
  });

  it("does not warn on an untouched sheet, saved or not", () => {
    const empty = fresh(["w0", "w1"]);
    expect(hasUnsavedWork(empty)).toBe(false);
    expect(hasUnsavedWork(empty, reviewSignature(empty))).toBe(false);
  });

  it("still warns when a DIFFERENT review was the one saved", () => {
    // Per sheet: saving one sheet must not disarm the warning on another.
    const other = { ...fresh(["w0"]), verdicts: { w0: "wall" as const } };
    expect(hasUnsavedWork(reviewed(), reviewSignature(other))).toBe(true);
  });
});

describe("the signature a save is remembered by", () => {
  it("ignores a re-detect that changes nothing", () => {
    // The candidates are not in the signature: the same walls re-offered
    // leave the same decisions, and counting that as a change would re-arm
    // the warning on every redraw.
    const state = reviewed();
    const after = keepReview(state, fresh(["w0", "w1", "w2"]));
    expect(reviewSignature(after)).toBe(reviewSignature(state));
  });

  it("does not depend on the ORDER verdicts were made in", () => {
    const a: ReviewState = { ...fresh(["w0", "w1"]), verdicts: { w0: "wall", w1: "unsure" } };
    const b: ReviewState = { ...fresh(["w0", "w1"]), verdicts: { w1: "unsure", w0: "wall" } };
    expect(reviewSignature(a)).toBe(reviewSignature(b));
  });

  it("is empty for nothing at all", () => {
    expect(reviewSignature(fresh(["w0"]))).toBe("|");
    expect(reviewSignature(null)).toBe("");
  });
});
