import { describe, expect, it } from "vitest";
import { BID_DUE_WINDOW_DAYS, jobNeeds, type JobNeedsInput } from "./job-needs";
import { estimateStage } from "@/lib/estimate-stage";

/**
 * ── WHAT THIS LIST IS FOR, AND WHAT IT MUST NEVER DO ──
 *
 * It is the one place a sub can look at a job and see what is waiting on THEM.
 * Two failure modes make it worthless, and they pull in opposite directions:
 *
 *   - saying nothing when something is wrong, which is the obvious one;
 *   - saying something when nothing is wrong, which is the one that actually
 *     kills a list like this. A row that asks for nothing teaches people to
 *     stop reading the rows that do, and then the red ones go unread too.
 *
 * So the quiet cases are tested as carefully as the loud ones.
 */

const DAY = 24 * 60 * 60 * 1000;
const today = new Date("2026-10-14T00:00:00.000Z");

const base = (over: Partial<JobNeedsInput> = {}): JobNeedsInput => ({
  stage: estimateStage(4, []),
  wallsWaiting: null,
  takeoff: null,
  price: { kind: "CURRENT" },
  bidDueDate: null,
  isBidding: true,
  today,
  ...over,
});

const keys = (input: JobNeedsInput) => jobNeeds(input, "job_1").map((item) => item.key.replace("-job_1", ""));

describe("what one job needs from a person", () => {
  it("IS QUIET ON A HEALTHY JOB — only where the estimate has got to", () => {
    // A priced estimate with current markup, no takeoff problems and nothing
    // waiting. The one row is `estimateStage`'s own instruction.
    expect(keys(base())).toEqual(["stage"]);
  });

  it("SAYS NOTHING AT ALL while the client has it", () => {
    // `estimateStage`'s OUT_FOR_SIGNATURE detail is "Nothing to do here until
    // they sign". A row that asks for nothing is worse than no row.
    const out = base({ stage: estimateStage(4, ["PENDING"]) });
    expect(out.stage.key).toBe("OUT_FOR_SIGNATURE");
    expect(keys(out)).toEqual([]);
  });

  it("still speaks up about the MONEY while the client has it", () => {
    // The omission above is about the stage row only. An unapplied markup on a
    // proposal somebody is signing is the worst possible moment to go quiet.
    const out = base({
      stage: estimateStage(4, ["PENDING"]),
      price: { kind: "NEVER_APPLIED", addedTotal: 12_000 },
    });
    expect(keys(out)).toEqual(["markup-missing"]);
  });

  describe("the bid deadline leads, because it is the only item with a date", () => {
    it("appears inside the window, with the days left", () => {
      const items = jobNeeds(base({ bidDueDate: new Date(today.getTime() + 3 * DAY) }), "job_1");
      expect(items[0].key).toBe("bid-due-job_1");
      expect(items[0].when).toBe("3 days left");
      expect(items[0].tone).toBe("amber");
      expect(items[0].whenTone).toBeUndefined();
    });

    it("turns red and says how late it is once the date has passed", () => {
      const items = jobNeeds(base({ bidDueDate: new Date(today.getTime() - 2 * DAY) }), "job_1");
      expect(items[0].tone).toBe("red");
      expect(items[0].whenTone).toBe("danger");
      expect(items[0].when).toContain("2");
    });

    it("says due today rather than '0 days left'", () => {
      const items = jobNeeds(base({ bidDueDate: today }), "job_1");
      expect(items[0].when).toBe("due today");
    });

    it("stays out until the window opens", () => {
      const far = new Date(today.getTime() + (BID_DUE_WINDOW_DAYS + 1) * DAY);
      expect(keys(base({ bidDueDate: far }))).toEqual(["stage"]);
    });

    it("IS GONE ONCE THE JOB IS NO LONGER BEING BID", () => {
      // A won job's bid date is history. Without this the row would sit red on
      // every job the company ever won, forever — the exact noise that stops
      // people reading the list.
      const won = base({ bidDueDate: new Date(today.getTime() - 40 * DAY), isBidding: false });
      expect(keys(won)).toEqual(["stage"]);
    });
  });

  it("asks for a RE-MEASURE when the paper moved under the quantities", () => {
    const items = jobNeeds(
      base({ takeoff: { supersededCount: 2, measurementsAtRisk: 17, unknowableCount: 0 } }),
      "job_1",
    );
    expect(items[0].key).toBe("takeoff-superseded-job_1");
    expect(items[0].tone).toBe("red");
    expect(items[0].text).toContain("17");
    expect(items[0].when).toBe("2 plans");
  });

  it("does NOT nag about a plan with no issue date", () => {
    // `takeoffCurrency` calls that UNKNOWABLE, and it is the honest common
    // case: most drawings carry no issue date. There is nothing for a person to
    // DO about it, so it belongs on the takeoff tab's banner and not here.
    expect(keys(base({ takeoff: { supersededCount: 0, measurementsAtRisk: 0, unknowableCount: 3 } }))).toEqual([
      "stage",
    ]);
  });

  it("tells the two markup problems apart, because the fix differs", () => {
    expect(keys(base({ price: { kind: "NEVER_APPLIED", addedTotal: 9_000 } }))).toEqual([
      "markup-missing",
      "stage",
    ]);
    expect(keys(base({ price: { kind: "STALE", appliedTotal: 100, lineTotal: 120 } }))).toEqual([
      "markup-stale",
      "stage",
    ]);
    // NO_RECAP means the rates would add nothing, so the line prices ARE the
    // bid. Nothing to apply, nothing to say.
    expect(keys(base({ price: { kind: "NO_RECAP" } }))).toEqual(["stage"]);
  });

  describe("walls the detection found and nobody has accepted", () => {
    it("asks a person to look at them", () => {
      const items = jobNeeds(base({ wallsWaiting: { groups: 6, sheets: 2 } }), "job_1");
      const walls = items.find((item) => item.key === "walls-waiting-job_1")!;
      expect(walls.text).toContain("6 wall groups");
      expect(walls.text).toContain("2 sheets");
      expect(walls.tone).toBe("amber");
    });

    it("reads properly for one group on one sheet", () => {
      const items = jobNeeds(base({ wallsWaiting: { groups: 1, sheets: 1 } }), "job_1");
      const walls = items.find((item) => item.key === "walls-waiting-job_1")!;
      expect(walls.text).toContain("1 wall group found on a sheet");
    });

    it("IS SILENT ON A JOB WHOSE WALLS HAVE BEEN WORKED THROUGH", () => {
      // Zero and null are different facts and both are quiet: zero means
      // somebody has dealt with them, null means there is no plan set.
      expect(keys(base({ wallsWaiting: { groups: 0, sheets: 0 } }))).toEqual(["stage"]);
      expect(keys(base({ wallsWaiting: null }))).toEqual(["stage"]);
    });
  });

  it("ORDERS BY WHAT GOES WRONG IF IT IS MISSED", () => {
    // The whole judgement of this module, pinned. A deadline cannot wait a day;
    // wrong quantities make the markup moot, so they precede it; accepting
    // walls is work rather than a defect; the stage is the broadest and last.
    const everything = base({
      bidDueDate: new Date(today.getTime() + 1 * DAY),
      takeoff: { supersededCount: 1, measurementsAtRisk: 4, unknowableCount: 0 },
      price: { kind: "NEVER_APPLIED", addedTotal: 1_000 },
      wallsWaiting: { groups: 3, sheets: 1 },
      stage: estimateStage(0, []),
    });
    expect(keys(everything)).toEqual([
      "bid-due",
      "takeoff-superseded",
      "markup-missing",
      "walls-waiting",
      "stage",
    ]);
  });

  it("every row carries somewhere to go, keyed to this job", () => {
    // A need with no way out is a complaint. `NeedsBlock` renders the action as
    // the only control on the row, so a missing one is a dead end on screen.
    const items = jobNeeds(
      base({
        bidDueDate: today,
        takeoff: { supersededCount: 1, measurementsAtRisk: 1, unknowableCount: 0 },
        price: { kind: "STALE", appliedTotal: 1, lineTotal: 2 },
        wallsWaiting: { groups: 1, sheets: 1 },
      }),
      "job_42",
    );
    expect(items.length).toBeGreaterThan(3);
    for (const item of items) {
      expect(item.action, item.key).toBeDefined();
      expect(item.action!.href, item.key).toContain("/jobs/job_42/");
      expect(item.key, "keys must be unique per job for React").toContain("job_42");
    }
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it("uses `estimateStage`'s OWN words, so the job and the jobs list cannot disagree", () => {
    // A paraphrase here would drift from the list the moment either is edited.
    const stage = estimateStage(0, []);
    const items = jobNeeds(base({ stage }), "job_1");
    expect(items.at(-1)!.text).toBe(stage.detail);
  });
});
