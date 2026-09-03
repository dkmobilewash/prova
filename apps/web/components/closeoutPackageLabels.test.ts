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
  it("ignores blockers that are not about the checklist", () => {
    expect(closeoutChip([openPunch], "NOT_READY", 3).label).toBe("Checklist done");
    expect(closeoutChip([openPunch], "ACCEPTED", 3).label).toBe("Closeout complete");
  });
});
