import { describe, expect, it } from "vitest";
import {
  type AssignmentData,
  contradictions,
  currentAssignment,
  daysOutWithin,
  deploymentToday,
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

  it("counts a single same-day job as a day out, not as nothing", () => {
    // `daysOutWithin`'s docstring has always said a lift that leaves and
    // returns the same day was out for a day's work. `utilisation` inlined a
    // second, half-open rule that said zero, and this is the assertion that
    // makes the two agree. Issue #151.
    const u = utilisation(
      [stay({ sentOutOn: "2026-01-10", returnedOn: "2026-01-10" })],
      WINDOW_START,
      WINDOW_END,
      LONG_KNOWN,
    );
    expect(u.daysOut).toBe(1);
  });

  it("reports a lift doing ten separate one-day jobs as worked, not idle", () => {
    // The rendered sentence this exists for: it used to read "out 0 of the
    // last 90 days (0%)" for a machine that went out ten times.
    const singleDays = [
      "2026-01-02",
      "2026-01-04",
      "2026-01-06",
      "2026-01-08",
      "2026-01-10",
      "2026-01-12",
      "2026-01-14",
      "2026-01-16",
      "2026-01-18",
      "2026-01-20",
    ].map((day) => stay({ sentOutOn: day, returnedOn: day }));

    const u = utilisation(singleDays, WINDOW_START, WINDOW_END, LONG_KNOWN);
    expect(u.daysOut).toBe(10);
    expect(u.daysTracked).toBe(30);
    expect(u.percent).toBe(33);
  });

  it("does not double-count a same-day trip that lands inside a longer stay", () => {
    // Contradictory records still must not read over 100%.
    const u = utilisation(
      [
        stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-11" }),
        stay({ sentOutOn: "2026-01-05", returnedOn: "2026-01-05" }),
      ],
      WINDOW_START,
      WINDOW_END,
      LONG_KNOWN,
    );
    expect(u.daysOut).toBe(10);
  });
});

describe("deploymentToday", () => {
  const TODAY = "2026-03-01";

  it("is out when the stay has already started and nobody closed it", () => {
    const open = stay({ sentOutOn: "2026-02-20", returnedOn: null });
    expect(deploymentToday([open], TODAY)).toEqual({ kind: "out", stay: open });
  });

  it("calls a stay dated AHEAD a plan, so the piece is still in the yard", () => {
    // The bug: /equipment printed "On Maple St Tower" and dropped the lift
    // out of "N in the yard" while the line below it said "due out Mar 10".
    const planned = stay({ sentOutOn: "2026-03-10", returnedOn: null });
    expect(deploymentToday([planned], TODAY).kind).toBe("planned");
  });

  it("is out on the very day it leaves, not planned", () => {
    // The boundary the whole distinction turns on.
    expect(deploymentToday([stay({ sentOutOn: TODAY, returnedOn: null })], TODAY).kind).toBe("out");
  });

  it("is the yard when everything has come back", () => {
    expect(deploymentToday([stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-10" })], TODAY)).toEqual({
      kind: "yard",
    });
  });

  it("is the yard with no history at all", () => {
    expect(deploymentToday([], TODAY)).toEqual({ kind: "yard" });
  });

  it("does not let a future dispatch hide the job the machine is ACTUALLY on", () => {
    // Two open stays are a contradiction `contradictions()` reports. Until
    // somebody fixes it, the row must name the one the lift has left for.
    const outNow = stay({ id: "now", sentOutOn: "2026-02-20", returnedOn: null });
    const later = stay({ id: "later", sentOutOn: "2026-03-20", returnedOn: null });
    const where = deploymentToday([later, outNow], TODAY);
    expect(where.kind).toBe("out");
    expect(where.kind === "out" && where.stay.id).toBe("now");
  });

  it("names the SOONEST upcoming stay when several are planned", () => {
    const soon = stay({ id: "soon", sentOutOn: "2026-03-05", returnedOn: null });
    const later = stay({ id: "later", sentOutOn: "2026-04-05", returnedOn: null });
    const where = deploymentToday([later, soon], TODAY);
    expect(where.kind === "planned" && where.stay.id).toBe("soon");
  });

  it("counts a fully planned future stay — both dates ahead — as planned", () => {
    // currentAssignment cannot see this one at all: it is closed.
    const trip = stay({ sentOutOn: "2026-03-10", returnedOn: "2026-03-14" });
    expect(currentAssignment([trip])).toBeNull();
    expect(deploymentToday([trip], TODAY).kind).toBe("planned");
  });
});

describe("daysOutWithin", () => {
  it("counts the day it left and not the day it came back", () => {
    const days = daysOutWithin(
      stay({ sentOutOn: "2026-01-01", returnedOn: "2026-01-08" }),
      "2026-01-01",
      "2026-01-31",
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-01-01");
    expect(days[6]).toBe("2026-01-07");
    expect(days).not.toContain("2026-01-08");
  });

  it("counts a same-day trip as a day's work, not nothing", () => {
    expect(
      daysOutWithin(stay({ sentOutOn: "2026-01-05", returnedOn: "2026-01-05" }), "2026-01-01", "2026-01-31"),
    ).toEqual(["2026-01-05"]);
  });

  it("is empty for a stay entirely outside the window", () => {
    expect(
      daysOutWithin(stay({ sentOutOn: "2025-01-01", returnedOn: "2025-01-08" }), "2026-01-01", "2026-01-31"),
    ).toEqual([]);
  });

  it("does not smuggle a same-day trip in from OUTSIDE the window", () => {
    // The same-day rule has to respect the window like every other day does,
    // or a trip last year adds a day to this quarter's utilisation.
    expect(
      daysOutWithin(stay({ sentOutOn: "2025-06-05", returnedOn: "2025-06-05" }), "2026-01-01", "2026-01-31"),
    ).toEqual([]);
    // windowEnd is the first day NOT measured, same as everywhere else.
    expect(
      daysOutWithin(stay({ sentOutOn: "2026-01-31", returnedOn: "2026-01-31" }), "2026-01-01", "2026-01-31"),
    ).toEqual([]);
  });

  it("clips a stay to the window at both ends", () => {
    expect(
      daysOutWithin(stay({ sentOutOn: "2025-12-20", returnedOn: "2026-03-01" }), "2026-01-01", "2026-01-31"),
    ).toHaveLength(30);
  });

  it("runs an open stay to the end of the window", () => {
    expect(
      daysOutWithin(stay({ sentOutOn: "2026-01-16", returnedOn: null }), "2026-01-01", "2026-01-31"),
    ).toHaveLength(15);
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
  it("puts the newer stay first", () => {
    // The one assertion this describe block did not have. Every fixture in
    // it used two SAME-DAY stays, so the comparison could have been reversed
    // — the one thing the function is named for — and the suite stayed
    // green. Issue #150.
    const older = stay({ id: "older", sentOutOn: "2026-01-01" });
    const newer = stay({ id: "newer", sentOutOn: "2026-06-01" });
    expect(newestFirst([older, newer]).map((x) => x.id)).toEqual(["newer", "older"]);
    expect(newestFirst([newer, older]).map((x) => x.id)).toEqual(["newer", "older"]);
  });

  it("orders three distinct days newest to oldest", () => {
    const a = stay({ id: "jan", sentOutOn: "2026-01-15" });
    const b = stay({ id: "mar", sentOutOn: "2026-03-15" });
    const c = stay({ id: "feb", sentOutOn: "2026-02-15" });
    expect(newestFirst([a, b, c]).map((x) => x.id)).toEqual(["mar", "feb", "jan"]);
  });

  it("does not mutate the array it was handed", () => {
    const input = [stay({ id: "one", sentOutOn: "2026-01-01" }), stay({ id: "two", sentOutOn: "2026-06-01" })];
    newestFirst(input);
    expect(input.map((x) => x.id)).toEqual(["one", "two"]);
  });

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
