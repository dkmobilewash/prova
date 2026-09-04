import { describe, expect, it } from "vitest";

import {
  buildSalesPipeline,
  longestOpen,
  winRateLabel,
  type OpportunityStage,
  type PipelineOpportunity,
} from "./sales-pipeline";

const TODAY = "2026-09-04";

let seq = 0;
function deal(
  stage: OpportunityStage,
  estimatedMrr: number | null = null,
  expectedCloseDate: string | null = null,
  daysInStage: number | null = null,
  companyName = `Company ${(seq += 1)}`,
): PipelineOpportunity {
  return {
    id: `opp-${seq}`,
    leadId: `lead-${seq}`,
    companyName,
    stage,
    estimatedMrr,
    expectedCloseDate,
    daysInStage,
  };
}

describe("an empty pipeline", () => {
  const pipeline = buildSalesPipeline([], TODAY);

  it("has a column for every open stage, all empty, rather than no columns", () => {
    expect(pipeline.columns.map((c) => c.stage)).toEqual([
      "NEW",
      "CONTACTED",
      "DEMO_SCHEDULED",
      "TRIAL",
    ]);
    expect(pipeline.columns.every((c) => c.count === 0)).toBe(true);
  });

  it("has no win rate at all, rather than a 0% track record of losing", () => {
    expect(pipeline.winRate).toBeNull();
    expect(winRateLabel(pipeline.winRate)).toBeNull();
  });

  it("reports null, not zero, for the longest time in an empty stage", () => {
    expect(pipeline.columns.every((c) => c.longestDaysInStage === null)).toBe(true);
  });
});

describe("unpriced deals", () => {
  it("counts them without letting them read as zero-value", () => {
    // The failure this pins: a column showing "$0 across 3 deals", which
    // says the deals are worth nothing rather than that nobody priced them.
    const pipeline = buildSalesPipeline(
      [deal("TRIAL", 500), deal("TRIAL", null), deal("TRIAL", null)],
      TODAY,
    );
    const trial = pipeline.columns.find((c) => c.stage === "TRIAL")!;
    expect(trial.count).toBe(3);
    expect(trial.mrr).toBe(500);
    expect(trial.unpriced).toBe(2);
  });

  it("carries the unpriced count into the open total too", () => {
    const pipeline = buildSalesPipeline(
      [deal("NEW", null), deal("TRIAL", 900), deal("WON", null)],
      TODAY,
    );
    expect(pipeline.open.count).toBe(2);
    expect(pipeline.open.mrr).toBe(900);
    expect(pipeline.open.unpriced).toBe(1);
  });
});

describe("win rate", () => {
  it("is null while nothing has been decided, however many deals are live", () => {
    const pipeline = buildSalesPipeline(
      [deal("NEW"), deal("CONTACTED"), deal("DEMO_SCHEDULED"), deal("TRIAL")],
      TODAY,
    );
    expect(pipeline.winRate).toBeNull();
  });

  it("counts only WON and LOST — open deals are not losses in waiting", () => {
    const pipeline = buildSalesPipeline(
      [deal("WON"), deal("LOST"), deal("NEW"), deal("TRIAL"), deal("CONTACTED")],
      TODAY,
    );
    expect(pipeline.winRate).toBe(0.5);
    expect(winRateLabel(pipeline.winRate)).toBe("50%");
  });

  it("is 0 — a real answer — when everything decided was lost", () => {
    // 0 and null must not collapse: one is a track record, the other is
    // the absence of one.
    const allLost = buildSalesPipeline([deal("LOST"), deal("LOST")], TODAY);
    expect(allLost.winRate).toBe(0);
    expect(winRateLabel(allLost.winRate)).toBe("0%");
    expect(buildSalesPipeline([], TODAY).winRate).toBeNull();
  });

  it("is 1 when everything decided was won", () => {
    expect(buildSalesPipeline([deal("WON"), deal("WON")], TODAY).winRate).toBe(1);
  });
});

describe("close-date buckets", () => {
  it("splits open deals by their ENTERED close date, and keeps the undated apart", () => {
    const pipeline = buildSalesPipeline(
      [
        deal("TRIAL", 100, "2026-08-20"), // past — overdue
        deal("NEW", 200, "2026-09-10"), // within 30 days
        deal("NEW", 400, "2026-12-01"), // beyond the horizon
        deal("CONTACTED", 800, null), // nobody said
      ],
      TODAY,
    );

    expect(pipeline.overdueToClose).toEqual({ count: 1, mrr: 100, unpriced: 0 });
    expect(pipeline.closingSoon).toEqual({ count: 1, mrr: 200, unpriced: 0 });
    // The undated deal is in neither bucket and is counted on its own.
    expect(pipeline.openWithoutCloseDate).toBe(1);
    expect(pipeline.open.count).toBe(4);
  });

  it("counts a deal closing TODAY as closing soon, not as overdue", () => {
    const pipeline = buildSalesPipeline([deal("TRIAL", 100, TODAY)], TODAY);
    expect(pipeline.closingSoon.count).toBe(1);
    expect(pipeline.overdueToClose.count).toBe(0);
  });

  it("counts the last day of the horizon in, and the day after out", () => {
    const inside = buildSalesPipeline([deal("TRIAL", 1, "2026-10-04")], TODAY);
    const outside = buildSalesPipeline([deal("TRIAL", 1, "2026-10-05")], TODAY);
    expect(inside.closingSoon.count).toBe(1);
    expect(outside.closingSoon.count).toBe(0);
  });

  it("ignores close dates on deals that are already won or lost", () => {
    // A won deal's close date is history, not a forecast. Counting it
    // would show revenue as still to land after it already had.
    const pipeline = buildSalesPipeline(
      [deal("WON", 500, "2026-08-01"), deal("LOST", 700, "2026-09-05")],
      TODAY,
    );
    expect(pipeline.overdueToClose.count).toBe(0);
    expect(pipeline.closingSoon.count).toBe(0);
    expect(pipeline.openWithoutCloseDate).toBe(0);
  });
});

describe("longest time in stage", () => {
  it("reports the longest in each column, not the total or the average", () => {
    const pipeline = buildSalesPipeline(
      [deal("TRIAL", null, null, 4), deal("TRIAL", null, null, 31), deal("NEW", null, null, 2)],
      TODAY,
    );
    expect(pipeline.columns.find((c) => c.stage === "TRIAL")!.longestDaysInStage).toBe(31);
    expect(pipeline.columns.find((c) => c.stage === "NEW")!.longestDaysInStage).toBe(2);
  });

  it("is null when no deal in the column has a recorded history", () => {
    const pipeline = buildSalesPipeline([deal("TRIAL", null, null, null)], TODAY);
    const trial = pipeline.columns.find((c) => c.stage === "TRIAL")!;
    expect(trial.count).toBe(1);
    expect(trial.longestDaysInStage).toBeNull();
  });

  it("ignores unrecorded deals rather than treating them as 0 days", () => {
    // The failure this pins: treating null as 0 would make a column of
    // one 40-day deal and one unrecorded deal still say 40 — fine — but
    // treating null as 0 in a MIN would say 0. Max is the safe direction;
    // this asserts the unrecorded one is excluded, not defaulted.
    const pipeline = buildSalesPipeline(
      [deal("TRIAL", null, null, null), deal("TRIAL", null, null, 40)],
      TODAY,
    );
    expect(pipeline.columns.find((c) => c.stage === "TRIAL")!.longestDaysInStage).toBe(40);
  });
});

describe("longestOpen", () => {
  it("lists open deals by time in stage, longest first", () => {
    const rows = longestOpen(
      [
        deal("NEW", null, null, 3, "Short"),
        deal("TRIAL", null, null, 40, "Longest"),
        deal("CONTACTED", null, null, 12, "Middle"),
      ],
      10,
    );
    expect(rows.map((r) => r.companyName)).toEqual(["Longest", "Middle", "Short"]);
  });

  it("excludes won and lost deals — they are not sitting anywhere", () => {
    const rows = longestOpen(
      [deal("WON", null, null, 99, "Closed"), deal("NEW", null, null, 1, "Live")],
      10,
    );
    expect(rows.map((r) => r.companyName)).toEqual(["Live"]);
  });

  it("excludes deals with no recorded history rather than sorting them as fresh", () => {
    const rows = longestOpen(
      [deal("NEW", null, null, null, "Unrecorded"), deal("NEW", null, null, 5, "Recorded")],
      10,
    );
    expect(rows.map((r) => r.companyName)).toEqual(["Recorded"]);
  });

  it("breaks a tie alphabetically so the order is stable", () => {
    const rows = longestOpen(
      [deal("NEW", null, null, 7, "Zenith"), deal("NEW", null, null, 7, "Apex")],
      10,
    );
    expect(rows.map((r) => r.companyName)).toEqual(["Apex", "Zenith"]);
  });

  it("honours the limit", () => {
    const rows = longestOpen(
      [
        deal("NEW", null, null, 9, "A"),
        deal("NEW", null, null, 8, "B"),
        deal("NEW", null, null, 7, "C"),
      ],
      2,
    );
    expect(rows).toHaveLength(2);
  });

  it("does not mutate the array it was given", () => {
    const deals = [deal("NEW", null, null, 1, "First"), deal("NEW", null, null, 9, "Second")];
    longestOpen(deals, 10);
    expect(deals.map((d) => d.companyName)).toEqual(["First", "Second"]);
  });
});

describe("won and lost columns", () => {
  it("totals them separately from the open pipeline", () => {
    const pipeline = buildSalesPipeline(
      [deal("WON", 1200), deal("WON", null), deal("LOST", 300), deal("TRIAL", 450)],
      TODAY,
    );
    expect(pipeline.won).toEqual({
      stage: "WON",
      count: 2,
      mrr: 1200,
      unpriced: 1,
      longestDaysInStage: null,
    });
    expect(pipeline.lost.count).toBe(1);
    // Won revenue is not open pipeline — it already landed.
    expect(pipeline.open).toEqual({ count: 1, mrr: 450, unpriced: 0 });
  });
});
