import { describe, expect, it } from "vitest";
import {
  assembleMoneyRailStages,
  type MoneyRailInput,
  type MoneyRailStage,
} from "./moneyRail";

const input = (over: Partial<MoneyRailInput> = {}): MoneyRailInput => ({
  outstandingBidValue: 0,
  outstandingBidsUnpriced: 0,
  activeJobCount: 0,
  activeContractValue: 0,
  openRfiCount: 0,
  submittalsWithGcCount: 0,
  complianceAtRiskCount: 0,
  complianceExpiredCount: 0,
  unbilledContractValue: 0,
  retainageHeld: 0,
  ...over,
});

const stage = (stages: MoneyRailStage[], key: MoneyRailStage["key"]) => {
  const found = stages.find((s) => s.key === key);
  if (!found) throw new Error(`no stage ${key}`);
  return found;
};

describe("stage shape", () => {
  it("returns exactly the five stages, in pipeline order", () => {
    // The order IS the concept — bid it, build it, prove it, stay legal,
    // get paid. A rail that reorders itself per render is not a pipeline.
    expect(assembleMoneyRailStages(input()).map((s) => s.key)).toEqual([
      "bidding",
      "building",
      "proving",
      "staying-legal",
      "getting-paid",
    ]);
  });

  it("types money stages as money and count stages as counts", () => {
    const stages = assembleMoneyRailStages(input());
    expect(stage(stages, "bidding").figure.kind).toBe("money");
    expect(stage(stages, "building").figure.kind).toBe("money");
    expect(stage(stages, "proving").figure.kind).toBe("count");
    expect(stage(stages, "staying-legal").figure.kind).toBe("count");
    expect(stage(stages, "getting-paid").figure.kind).toBe("money");
  });
});

describe("bidding", () => {
  it("carries the outstanding bid value through untouched", () => {
    const stages = assembleMoneyRailStages(input({ outstandingBidValue: 184_500 }));
    expect(stage(stages, "bidding").figure).toEqual({ kind: "money", amount: 184_500 });
  });

  it("says the figure is a floor when live bids have no amount recorded", () => {
    // Same honesty rule as GcRecord.valueWonUnpriced: a partial sum shown
    // as a total is the same defect as printing $0.00 for unpriced hours.
    const flagged = assembleMoneyRailStages(
      input({ outstandingBidValue: 50_000, outstandingBidsUnpriced: 2 }),
    );
    expect(stage(flagged, "bidding").detail).toContain("floor");
    expect(stage(flagged, "bidding").detail).toContain("2 live bids have");

    const clean = assembleMoneyRailStages(input({ outstandingBidValue: 50_000 }));
    expect(stage(clean, "bidding").detail).not.toContain("floor");
  });
});

describe("building", () => {
  it("shows contract value as the figure and the job count in the detail", () => {
    const stages = assembleMoneyRailStages(
      input({ activeJobCount: 3, activeContractValue: 1_250_000 }),
    );
    expect(stage(stages, "building").figure).toEqual({ kind: "money", amount: 1_250_000 });
    expect(stage(stages, "building").detail).toBe("3 jobs under contract or in progress");
  });

  it("pluralizes a single job correctly", () => {
    const stages = assembleMoneyRailStages(input({ activeJobCount: 1 }));
    expect(stage(stages, "building").detail).toBe("1 job under contract or in progress");
  });
});

describe("proving", () => {
  it("sums open RFIs and with-the-GC submittals into one count", () => {
    const stages = assembleMoneyRailStages(
      input({ openRfiCount: 4, submittalsWithGcCount: 3 }),
    );
    const figure = stage(stages, "proving").figure;
    expect(figure).toEqual({ kind: "count", n: 7, noun: "items waiting on the GC" });
    // The detail keeps the two populations distinct — an unanswered RFI
    // and an unreturned submittal are different phone calls.
    expect(stage(stages, "proving").detail).toBe(
      "4 RFIs unanswered, 3 submittals with the GC",
    );
  });

  it("uses the singular noun when exactly one item is waiting", () => {
    const stages = assembleMoneyRailStages(input({ openRfiCount: 1 }));
    expect(stage(stages, "proving").figure).toEqual({
      kind: "count",
      n: 1,
      noun: "item waiting on the GC",
    });
    expect(stage(stages, "proving").detail).toBe("1 RFI unanswered, 0 submittals with the GC");
  });
});

describe("staying legal", () => {
  it("splits the detail into already-expired and inside-the-window", () => {
    const stages = assembleMoneyRailStages(
      input({ complianceAtRiskCount: 5, complianceExpiredCount: 2 }),
    );
    expect(stage(stages, "staying-legal").figure).toEqual({
      kind: "count",
      n: 5,
      noun: "documents expired or due soon",
    });
    expect(stage(stages, "staying-legal").detail).toBe(
      "2 already expired, 3 inside the renewal window",
    );
  });

  it("says everything is current at zero rather than printing 0 of 0", () => {
    const stages = assembleMoneyRailStages(input());
    expect(stage(stages, "staying-legal").detail).toBe(
      "Certificates, licences, policies and bonds are current",
    );
  });
});

describe("getting paid", () => {
  it("adds unbilled contract value and retainage held", () => {
    const stages = assembleMoneyRailStages(
      input({ unbilledContractValue: 300_000, retainageHeld: 42_500 }),
    );
    expect(stage(stages, "getting-paid").figure).toEqual({
      kind: "money",
      amount: 342_500,
    });
  });

  it("can go negative only through retainage, never through unbilled value", () => {
    // unbilledContractValue is floored per job by the loader; retainage
    // held is signed on purpose (withheld − released, see
    // lib/retainage-query.ts). The assembly must not clamp it — an
    // over-released retainage figure is a real state worth seeing.
    const stages = assembleMoneyRailStages(
      input({ unbilledContractValue: 0, retainageHeld: -500 }),
    );
    expect(stage(stages, "getting-paid").figure).toEqual({ kind: "money", amount: -500 });
  });
});
