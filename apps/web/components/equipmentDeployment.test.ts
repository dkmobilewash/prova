import { describe, expect, it } from "vitest";
import {
  type AssignmentData,
  contradictions,
  currentAssignment,
  daysOutWithin,
  findOverlap,
  newestFirst,
  rangesOverlap,
  stayLength,
  utilisation,
} from "@/components/equipmentDeployment";

let seq = 0;
function stay(partial: Partial<AssignmentData> = {}): AssignmentData {
  seq += 1;
  return {
    id: `a${seq}`,
    equipmentId: "e1",
    equipmentName: "Genie S-45 boom lift",
    jobId: "j1",
    jobName: "Maple St Tower",
    sentOutOn: "2026-03-01",
    returnedOn: null,
    notes: null,
    ...partial,
  };
}

describe("currentAssignment", () => {
  it("is the newest stay nobody has closed", () => {
    const old = stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-20" });
    const now = stay({ sentOutOn: "2026-03-01", returnedOn: null });
    expect(currentAssignment([old, now])?.id).toBe(now.id);
  });

  it("is null when everything has come back — that's the yard, not missing data", () => {
    expect(currentAssignment([stay({ returnedOn: "2026-03-10" })])).toBeNull();
  });

  it("is null with no history at all", () => {
    expect(currentAssignment([])).toBeNull();
  });

  it("ignores a newer CLOSED stay in favour of an older open one", () => {
    // Weird but real: someone backdated a short trip that already came back.
    // The piece is still out on the older open stay.
    const openOlder = stay({ sentOutOn: "2026-01-01", returnedOn: null });
    const closedNewer = stay({ sentOutOn: "2026-02-01", returnedOn: "2026-02-02" });
    expect(currentAssignment([openOlder, closedNewer])?.id).toBe(openOlder.id);
  });
});

describe("rangesOverlap", () => {
  it("catches a straightforward overlap", () => {
    expect(rangesOverlap("2026-01-01", "2026-01-10", "2026-01-05", "2026-01-15")).toBe(true);
  });

  it("does not call two separate stays an overlap", () => {
    expect(rangesOverlap("2026-01-01", "2026-01-10", "2026-01-20", "2026-01-25")).toBe(false);
  });

  it("allows a return and a dispatch on the SAME day", () => {
    // Back to the yard in the morning, out again after lunch. Ordinary.
    // Flagging it would make the app argue with a dispatcher who did
    // nothing wrong.
    expect(rangesOverlap("2026-01-01", "2026-01-10", "2026-01-10", "2026-01-20")).toBe(false);
  });

  it("treats an open stay as running forward forever", () => {
    expect(rangesOverlap("2026-01-01", null, "2026-06-01", "2026-06-10")).toBe(true);
  });

  it("catches two open stays as a contradiction", () => {
    expect(rangesOverlap("2026-01-01", null, "2026-02-01", null)).toBe(true);
  });
});

describe("findOverlap", () => {
  it("finds the stay a new one would contradict", () => {
    const existing = [stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-20" })];
    const clash = findOverlap(existing, { sentOutOn: "2026-01-10", returnedOn: "2026-01-15" });
    expect(clash?.id).toBe(existing[0].id);
  });

  it("catches a BACKDATED entry colliding with a stay that already closed", () => {
    // The case a check for "is there an open one" would miss entirely: the
    // lift has come back, and someone records it as having been somewhere
    // else during the week it was out.
    const closed = [stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-20" })];
    expect(findOverlap(closed, { sentOutOn: "2026-01-05", returnedOn: "2026-01-08" })).not.toBeNull();
  });

  it("is null when the new stay sits in a genuine gap", () => {
    const existing = [
      stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-10" }),
      stay({ sentOutOn: "2026-02-01", returnedOn: "2026-02-10" }),
    ];
    expect(findOverlap(existing, { sentOutOn: "2026-01-15", returnedOn: "2026-01-20" })).toBeNull();
  });

  it("does not let an edited stay collide with itself", () => {
    const existing = [stay({ id: "keep", sentOutOn: "2026-01-01", returnedOn: "2026-01-20" })];
    expect(
      findOverlap(existing, { sentOutOn: "2026-01-01", returnedOn: "2026-01-25", ignoreId: "keep" }),
    ).toBeNull();
  });

  it("catches a new open stay against an existing open one", () => {
    const existing = [stay({ sentOutOn: "2026-01-01", returnedOn: null })];
    expect(findOverlap(existing, { sentOutOn: "2026-03-01", returnedOn: null })).not.toBeNull();
  });
});

describe("utilisation", () => {
  const WINDOW_START = "2026-01-01";
  const WINDOW_END = "2026-01-31"; // 30 days
  const LONG_KNOWN = "2020-01-01";

  it("counts days out against days tracked", () => {
    const u = utilisation(
      [stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-16" })],
      WINDOW_START,
      WINDOW_END,
      LONG_KNOWN,
    );
    expect(u.daysTracked).toBe(30);
    expect(u.daysOut).toBe(15);
    expect(u.percent).toBe(50);
  });

  it("clips a stay that runs past the window", () => {
    const u = utilisation(
      [stay({ sentOutOn: "2025-12-01", returnedOn: "2026-03-01" })],
      WINDOW_START,
      WINDOW_END,
      LONG_KNOWN,
    );
    expect(u.daysOut).toBe(30);
    expect(u.percent).toBe(100);
  });

  it("treats a still-out piece as out through the end of the window", () => {
    const u = utilisation(
      [stay({ sentOutOn: "2026-01-16", returnedOn: null })],
      WINDOW_START,
      WINDOW_END,
      LONG_KNOWN,
    );
    expect(u.daysOut).toBe(15);
  });

  it("never exceeds 100% when two records overlap", () => {
    // Contradictory records are reported elsewhere; they must not make a
    // lift look 180% utilised in the meantime.
    const u = utilisation(
      [
        stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-31" }),
        stay({ id: "dup", sentOutOn: "2026-01-01", returnedOn: "2026-01-31" }),
      ],
      WINDOW_START,
      WINDOW_END,
      LONG_KNOWN,
    );
    expect(u.percent).toBe(100);
    expect(u.daysOut).toBe(30);
  });

  it("measures only from when we started tracking the piece", () => {
    // Added on the 21st: ten days tracked, not thirty. Otherwise a lift
    // bought last week reads as idle for a quarter it wasn't ours for.
    const u = utilisation(
      [stay({ sentOutOn: "2026-01-21", returnedOn: null })],
      WINDOW_START,
      WINDOW_END,
      "2026-01-21",
    );
    expect(u.daysTracked).toBe(10);
    expect(u.percent).toBe(100);
  });

  it("has no percentage when the window is empty", () => {
    // Added today. There is nothing to make a claim from, and a confident
    // 0% would be a claim.
    const u = utilisation([], WINDOW_END, WINDOW_END, LONG_KNOWN);
    expect(u.percent).toBeNull();
  });

  it("is 0% for a piece that never left the yard", () => {
    const u = utilisation([], WINDOW_START, WINDOW_END, LONG_KNOWN);
    expect(u.percent).toBe(0);
    expect(u.daysTracked).toBe(30);
  });
});

describe("daysOutWithin", () => {
  it("counts the day it left and not the day it came back", () => {
    expect(
      daysOutWithin(stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-08" }), "2026-01-01", "2026-01-31"),
    ).toBe(7);
  });

  it("counts a same-day trip as a day's work, not nothing", () => {
    expect(
      daysOutWithin(stay({ sentOutOn: "2026-01-05", returnedOn: "2026-01-05" }), "2026-01-01", "2026-01-31"),
    ).toBe(1);
  });

  it("is zero for a stay entirely outside the window", () => {
    expect(
      daysOutWithin(stay({ sentOutOn: "2025-01-01", returnedOn: "2025-01-08" }), "2026-01-01", "2026-01-31"),
    ).toBe(0);
  });
});

describe("contradictions", () => {
  it("reports two records that put one piece in two places", () => {
    const a = stay({ equipmentId: "e1", sentOutOn: "2026-01-01", returnedOn: null });
    const b = stay({ equipmentId: "e1", sentOutOn: "2026-02-01", returnedOn: null });
    expect(contradictions([a, b])).toHaveLength(1);
  });

  it("does not confuse two different pieces on the same dates", () => {
    const a = stay({ equipmentId: "e1", sentOutOn: "2026-01-01", returnedOn: null });
    const b = stay({ equipmentId: "e2", sentOutOn: "2026-01-01", returnedOn: null });
    expect(contradictions([a, b])).toEqual([]);
  });

  it("is empty for a clean history", () => {
    const a = stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-10" });
    const b = stay({ sentOutOn: "2026-01-15", returnedOn: "2026-01-20" });
    expect(contradictions([a, b])).toEqual([]);
  });
});

describe("newestFirst", () => {
  it("breaks a same-day tie on id so the order is total and stable", () => {
    const a = stay({ id: "sa", sentOutOn: "2026-01-01" });
    const b = stay({ id: "sb", sentOutOn: "2026-01-01" });
    expect(newestFirst([a, b]).map((x) => x.id)).toEqual(["sb", "sa"]);
    expect(newestFirst([b, a]).map((x) => x.id)).toEqual(["sb", "sa"]);
  });
});

describe("stayLength", () => {
  it("counts an open stay up to today", () => {
    expect(stayLength(stay({ sentOutOn: "2026-03-01", returnedOn: null }), "2026-03-08")).toBe("out 7 days");
  });

  it("says so plainly on the day it went out", () => {
    expect(stayLength(stay({ sentOutOn: "2026-03-08", returnedOn: null }), "2026-03-08")).toBe("out since today");
  });

  it("reports a closed stay's length", () => {
    expect(stayLength(stay({ sentOutOn: "2026-03-01", returnedOn: "2026-03-02" }), "2026-03-10")).toBe("1 day");
  });

  it("calls a FUTURE stay a plan, not a deployment", () => {
    // Dispatching ahead is ordinary. Reporting the lift as already out
    // would send somebody across town to a yard it never left.
    expect(stayLength(stay({ sentOutOn: "2026-09-10", returnedOn: null }), "2026-08-31")).toBe(
      "due out Sep 10, 2026",
    );
  });

  it("describes a fully planned future stay at both ends", () => {
    expect(
      stayLength(stay({ sentOutOn: "2026-09-10", returnedOn: "2026-09-20" }), "2026-08-31"),
    ).toContain("due out Sep 10, 2026, back Sep 20, 2026");
  });

  it("calls a there-and-back-the-same-day trip what it is", () => {
    expect(stayLength(stay({ sentOutOn: "2026-03-01", returnedOn: "2026-03-01" }), "2026-03-10")).toBe("same day");
  });
});
