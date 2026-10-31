import { describe, expect, it } from "vitest";
import { percentLabel, summariseBidLog, summariseBidLogPeriod, type BidLogBid } from "./bid-pipeline";

/**
 * The bid log's figures over fixed rows, every expected number worked out in
 * this file by hand rather than read back off the function.
 */

const TODAY = "2026-10-25";
const bid = (over: Partial<BidLogBid> = {}): BidLogBid => ({
  status: "SUBMITTED",
  bidAmount: null,
  dueDate: null,
  contractValue: null,
  ...over,
});

describe("what counts as a bid", () => {
  it("counts SUBMITTED, WON and LOST, and never INVITED or DECLINED", () => {
    const record = summariseBidLogPeriod(
      [
        bid({ status: "INVITED", bidAmount: 999_999 }),
        bid({ status: "DECLINED", bidAmount: 999_999 }),
        bid({ status: "SUBMITTED", bidAmount: 100_000 }),
        bid({ status: "WON", bidAmount: 200_000 }),
        bid({ status: "LOST", bidAmount: 300_000 }),
      ],
      TODAY,
    );
    expect(record.bids).toBe(3);
    // (100,000 + 200,000 + 300,000) / 3 — the invited and declined amounts are not bids.
    expect(record.averageBid).toBe(200_000);
  });
});

describe("average bid", () => {
  it("averages priced bids only, and counts the unpriced beside it", () => {
    const record = summariseBidLogPeriod(
      [bid({ bidAmount: 50_000 }), bid({ bidAmount: 70_000 }), bid({ bidAmount: null })],
      TODAY,
    );
    expect(record.averageBid).toBe(60_000); // not 40,000, which is averaging in a zero
    expect(record.unpricedBids).toBe(1);
  });

  it("is null, not zero, when no bid is priced", () => {
    expect(summariseBidLogPeriod([bid()], TODAY).averageBid).toBeNull();
  });
});

describe("win rate", () => {
  it("is won over won + lost; a submitted bid still waiting is not a loss", () => {
    const record = summariseBidLogPeriod(
      [bid({ status: "WON" }), bid({ status: "LOST" }), bid({ status: "LOST" }), bid({ status: "SUBMITTED" })],
      TODAY,
    );
    expect(record.winRate).toBeCloseTo(1 / 3);
    expect(percentLabel(record.winRate)).toBe("33%");
  });

  it("is null when nothing is decided, and says so as a dash rather than 0%", () => {
    const record = summariseBidLogPeriod([bid(), bid()], TODAY);
    expect(record.winRate).toBeNull();
    expect(percentLabel(record.winRate)).toBe("—");
  });
});

describe("average contract", () => {
  it("averages the linked jobs' contract values over won bids, and only won bids", () => {
    const record = summariseBidLogPeriod(
      [
        bid({ status: "WON", bidAmount: 100_000, contractValue: 110_000 }),
        bid({ status: "WON", bidAmount: 80_000, contractValue: 90_000 }),
        // a LOST bid's job (linked as "same work as") is not a contract
        bid({ status: "LOST", bidAmount: 500_000, contractValue: 500_000 }),
      ],
      TODAY,
    );
    expect(record.won).toBe(2);
    expect(record.averageContract).toBe(100_000); // (110,000 + 90,000) / 2
    expect(record.wonWithoutContract).toBe(0);
  });

  it("leaves out a win with no linked job, or a job with no priced lines, and counts it", () => {
    const record = summariseBidLogPeriod(
      [
        bid({ status: "WON", contractValue: 120_000 }),
        bid({ status: "WON", contractValue: null }),
        bid({ status: "WON", contractValue: 0 }),
      ],
      TODAY,
    );
    expect(record.averageContract).toBe(120_000); // not 40,000
    expect(record.wonWithoutContract).toBe(2);
  });

  it("is null when no win has a contract value", () => {
    expect(summariseBidLogPeriod([bid({ status: "WON" })], TODAY).averageContract).toBeNull();
  });
});

describe("periods, by due date", () => {
  const rows: BidLogBid[] = [
    bid({ status: "WON", bidAmount: 10_000, dueDate: "2026-10-03", contractValue: 12_000 }), // this month
    bid({ status: "LOST", bidAmount: 20_000, dueDate: "2026-10-20" }), // this month
    bid({ status: "LOST", bidAmount: 30_000, dueDate: "2026-01-15" }), // this year, 10 months back
    bid({ status: "WON", bidAmount: 40_000, dueDate: "2025-11-30", contractValue: 44_000 }), // 11 months back: last 12, not this year
    bid({ status: "LOST", bidAmount: 50_000, dueDate: "2025-10-31" }), // 12 months back: outside last 12
    bid({ status: "SUBMITTED", bidAmount: 60_000, dueDate: "2026-12-10" }), // due later this year
    bid({ status: "WON", bidAmount: 70_000, dueDate: null }), // no due date: all-time only
    bid({ status: "INVITED", dueDate: null }), // not a bid, so not an undated bid either
    bid({ status: "DECLINED", dueDate: "2026-10-10", bidAmount: 1 }), // not a bid in any period
  ];
  const log = summariseBidLog(rows, TODAY);

  it("all time counts every bid, dated or not", () => {
    expect(log.allTime.bids).toBe(7);
    expect(log.allTime.won).toBe(3);
    expect(log.allTime.lost).toBe(3);
    expect(log.allTime.winRate).toBe(0.5);
    expect(log.noDueDate).toBe(1);
  });

  it("this year is the calendar year of today, including a bid due later this year", () => {
    expect(log.thisYear.bids).toBe(4); // Oct 3, Oct 20, Jan 15, Dec 10
    expect(log.thisYear.won).toBe(1);
    expect(log.thisYear.lost).toBe(2);
    expect(log.thisYear.averageBid).toBe(30_000); // (10+20+30+60)k / 4
  });

  it("the last 12 months are November 2025 through October 2026", () => {
    expect(log.byMonth.map((m) => m.month)).toEqual([
      "2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05",
      "2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11",
    ]);
    // Oct 3, Oct 20, Jan 15, Nov 30 — not Oct 31 2025, and not Dec 10 2026.
    expect(log.last12Months.bids).toBe(4);
    expect(log.last12Months.winRate).toBe(0.5);
    expect(log.last12Months.averageContract).toBe(28_000); // (12,000 + 44,000) / 2
    expect(log.bidsPerMonth).toBeCloseTo(4 / 12);
  });

  it("puts each bid in its own month, and keeps an empty month as an empty month", () => {
    const october = log.byMonth.find((m) => m.month === "2026-10")!.record;
    expect(october).toMatchObject({ bids: 2, won: 1, lost: 1, winRate: 0.5, averageBid: 15_000, averageContract: 12_000 });
    const june = log.byMonth.find((m) => m.month === "2026-06")!.record;
    expect(june).toMatchObject({ bids: 0, winRate: null, averageBid: null, averageContract: null });
  });

  it("rolls the twelve months back across a year boundary from January", () => {
    const january = summariseBidLog([], "2026-01-05");
    expect(january.byMonth[0].month).toBe("2026-01");
    expect(january.byMonth[1].month).toBe("2025-12");
    expect(january.byMonth[11].month).toBe("2025-02");
  });
});
