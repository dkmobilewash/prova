import { describe, expect, it } from "vitest";
import { closeoutChip, plural } from "@/components/closeoutPackageLabels";
import type { CloseoutBlocker } from "@/lib/closeout-readiness";

const AMBER = "bg-amber-500/15 text-amber-300";
const GREEN = "bg-green-500/15 text-green-300";
const QUIET = "bg-slate-800 text-slate-400";

const noChecklist: CloseoutBlocker = { kind: "NO_CHECKLIST", count: 0 };
const required = (count: number): CloseoutBlocker => ({ kind: "REQUIRED_ITEMS", count });
const openPunch: CloseoutBlocker = { kind: "OPEN_PUNCH_ITEMS", count: 1 };

describe("plural", () => {
  // "1 jobs", "1 items" and "1 days with them" were all on /closeout, all
  // reachable with a single row.
  it("does not say '1 jobs'", () => {
    expect(plural(1, "job", "jobs")).toBe("1 job");
    expect(plural(0, "job", "jobs")).toBe("0 jobs");
    expect(plural(2, "job", "jobs")).toBe("2 jobs");
  });
});

describe("closeoutChip", () => {
  // The bug this function was extracted for. A checklist of nothing but
  // OPTIONAL items produces a NO_CHECKLIST blocker (no required items), and
  // the old card computed its own count from job.items — which was empty —
  // and rendered an amber "0 still outstanding" directly above a panel
  // saying no checklist exists.
  it("never renders a zero as an outstanding count", () => {
    const chip = closeoutChip([noChecklist], "NOT_READY", 4);
    expect(chip.label).not.toContain("0 ");
    expect(chip.label).toBe("Nothing required yet");
    expect(chip.className).toBe(QUIET);
  });

  it("tells an empty checklist apart from one with nothing required on it", () => {
    expect(closeoutChip([noChecklist], "NOT_READY", 0).label).toBe("No checklist yet");
    expect(closeoutChip([noChecklist], "NOT_READY", 1).label).toBe("Nothing required yet");
  });

  it("counts outstanding required documents, pluralised", () => {
    expect(closeoutChip([required(1)], "NOT_READY", 3).label).toBe("1 document still outstanding");
    expect(closeoutChip([required(3)], "NOT_READY", 5).label).toBe("3 documents still outstanding");
    expect(closeoutChip([required(2)], "NOT_READY", 5).className).toBe(AMBER);
  });

  // "Closeout complete" is a claim about the whole closeout, not the
  // checklist — it needs the GC to have taken the package.
  it("only says closeout is complete once the package was accepted", () => {
    expect(closeoutChip([], "ACCEPTED", 3).label).toBe("Closeout complete");
    expect(closeoutChip([], "ACCEPTED", 3).className).toBe(GREEN);
    expect(closeoutChip([], "READY_TO_SUBMIT", 3).label).toBe("Checklist done");
    expect(closeoutChip([openPunch], "READY_TO_SUBMIT", 3).label).toBe("Checklist done");
  });

  // An accepted package on a job nobody ever wrote a checklist for is still
  // not evidence the checklist was done.
  it("does not claim completion when the checklist was never asserted", () => {
    expect(closeoutChip([noChecklist], "ACCEPTED", 0).label).toBe("No checklist yet");
    expect(closeoutChip([required(2)], "ACCEPTED", 4).label).toBe("2 documents still outstanding");
  });

  // The chip reads the blockers the panel underneath it renders. A blocker
  // that is not about the checklist must not change what the chip says
  // about the checklist.
  it("reads the checklist as done while other work is still open", () => {
    // The chip speaks only about the CHECKLIST when a non-checklist blocker
    // is present, at either stage. The second line asserted "Closeout
    // complete" until pre-push verification found it pinning the very
    // overstatement this branch exists to remove: an ACCEPTED package with
    // a punch item open rendered green, above a panel saying what was
    // holding it up. See the describe block below.
    expect(closeoutChip([openPunch], "NOT_READY", 3).label).toBe("Checklist done");
    expect(closeoutChip([openPunch], "ACCEPTED", 3).label).toBe("Checklist done");
  });
});

/**
 * FOUND IN PRE-PUSH VERIFICATION — this describe block FAILS on 20b810c.
 *
 * `closeoutChip` looks only for NO_CHECKLIST and REQUIRED_ITEMS. Every
 * other blocker — OPEN_PUNCH_ITEMS, OPEN_CALLBACKS — leaves
 * `checklistBlocker` undefined, so an ACCEPTED package goes green and says
 * "Closeout complete" with work still open on the job.
 *
 * That is not a hypothetical. `closeoutReadiness` sets the stage from the
 * submission and reports the blockers regardless — its own comment says a
 * callback logged after acceptance must not un-accept the package — so
 * ACCEPTED alongside a non-empty `blockers` array is a NORMAL state, not a
 * corrupt one. And `CloseoutPackagePanel` renders "Holding it up: …"
 * whenever `blockers.length > 0`, at any stage. So one card shows a green
 * "Closeout complete" directly above "Holding it up: 1 punch item still
 * open."
 *
 * Which is the exact shape this function was extracted to end — the
 * docstring above calls the chip a claim "about the whole closeout", and
 * item 1 in its own list of past failures is a green chip above a panel
 * naming an open punch item. The extraction fixed the checklist half of
 * the disagreement and left the other half in place.
 *
 * NOTE: this directly contradicts the last line of "ignores blockers that
 * are not about the checklist" above, which pins the wrong behaviour as
 * intended. One of the two has to go; on issue #112's own terms — screens
 * that state more than the data does — the green chip is the overstatement.
 *
 * The fix is one line: require the whole blocker list to be empty, not
 * just the checklist part of it.
 */
describe("closeoutChip does not overstate an accepted package", () => {
  it("does not say closeout is complete while a punch item is open", () => {
    const chip = closeoutChip([openPunch], "ACCEPTED", 3);
    expect(chip.label).not.toBe("Closeout complete");
    expect(chip.className).not.toBe(GREEN);
  });

  it("does not say closeout is complete while a callback is open", () => {
    const openCallback: CloseoutBlocker = { kind: "OPEN_CALLBACKS", count: 2 };
    const chip = closeoutChip([openCallback], "ACCEPTED", 3);
    expect(chip.label).not.toBe("Closeout complete");
  });

  it("still says closeout is complete when nothing at all is holding it up", () => {
    // The one case that should stay green, so the fix cannot be "delete
    // the green branch".
    expect(closeoutChip([], "ACCEPTED", 3).label).toBe("Closeout complete");
    expect(closeoutChip([], "ACCEPTED", 3).className).toBe(GREEN);
  });
});
