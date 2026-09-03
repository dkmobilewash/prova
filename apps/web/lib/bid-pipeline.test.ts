import { describe, expect, it } from "vitest";
import {
  isOverdue,
  rankGcs,
  summariseGc,
  valueIsPartial,
  winRateLabel,
  type PipelineBid,
} from "./bid-pipeline";

const bid = (over: Partial<PipelineBid> = {}): PipelineBid => ({
  status: "INVITED",
  bidAmount: null,
  dueDate: null,
  ...over,
});

const TODAY = "2026-09-03";

describe("win rate", () => {
  it("is null, not zero, when nothing has been decided", () => {
    // The one that matters. Three live invitations is a GC we have not
    // lost with -- printing 0% would read as "they never pick us" and is
    // how somebody talks themselves out of a customer who is still deciding.
    const record = summariseGc([bid(), bid(), bid({ status: "SUBMITTED" })], TODAY);

    expect(record.winRate).toBeNull();
    expect(winRateLabel(record)).toBe("no decided bids yet");
  });

  it("counts only decided bids, so a live one cannot dilute it", () => {
    const decidedOnly = summariseGc([bid({ status: "WON" }), bid({ status: "LOST" })], TODAY);
    const plusLive = summariseGc(
      [bid({ status: "WON" }), bid({ status: "LOST" }), bid({ status: "SUBMITTED" })],
      TODAY,
    );

    expect(decidedOnly.winRate).toBe(0.5);
    expect(plusLive.winRate).toBe(0.5);
  });

  it("does NOT count a declined invitation as a loss", () => {
    // Declining is a decision we made -- usually because the job was wrong
    // for us. Folding it into the win rate would punish good judgement and
    // make "bid on everything" look like the way to improve the number.
    const record = summariseGc(
      [bid({ status: "WON" }), bid({ status: "DECLINED" }), bid({ status: "DECLINED" })],
      TODAY,
    );

    expect(record.winRate).toBe(1);
    expect(record.declined).toBe(2);
    expect(record.bid).toBe(1);
  });
});

describe("value won", () => {
  it("flags a partial sum rather than presenting a floor as a total", () => {
    const record = summariseGc(
      [
        bid({ status: "WON", bidAmount: 120_000 }),
        bid({ status: "WON", bidAmount: null }),
      ],
      TODAY,
    );

    expect(record.valueWon).toBe(120_000);
    expect(record.valueWonUnpriced).toBe(1);
    expect(valueIsPartial(record)).toBe(true);
  });

  it("is not partial when every won bid carries an amount", () => {
    const record = summariseGc(
      [bid({ status: "WON", bidAmount: 1 }), bid({ status: "WON", bidAmount: 2 })],
      TODAY,
    );

    expect(record.valueWon).toBe(3);
    expect(valueIsPartial(record)).toBe(false);
  });

  it("ignores the amount on a bid we did not win", () => {
    const record = summariseGc(
      [bid({ status: "LOST", bidAmount: 999_999 }), bid({ status: "WON", bidAmount: 10 })],
      TODAY,
    );

    expect(record.valueWon).toBe(10);
  });
});

describe("overdue", () => {
  it("is only ever about a bid still waiting on somebody", () => {
    const settled = bid({ status: "WON", dueDate: "2020-01-01" });
    expect(isOverdue(settled, TODAY)).toBe(false);
  });

  it("does not invent a deadline the GC never gave", () => {
    expect(isOverdue(bid({ dueDate: null }), TODAY)).toBe(false);
  });

  it("treats the due date itself as still in time", () => {
    expect(isOverdue(bid({ dueDate: TODAY }), TODAY)).toBe(false);
    expect(isOverdue(bid({ dueDate: "2026-09-02" }), TODAY)).toBe(true);
  });
});

describe("ranking", () => {
  it("puts what we owe a response to above a better win rate", () => {
    const overdue = { record: summariseGc([bid({ dueDate: "2026-01-01" })], TODAY) };
    const perfect = {
      record: summariseGc([bid({ status: "WON" }), bid({ status: "WON" })], TODAY),
    };

    expect(rankGcs([perfect, overdue])[0]).toBe(overdue);
  });

  it("does not mutate the array it was given", () => {
    const rows = [
      { record: summariseGc([bid({ status: "WON" })], TODAY) },
      { record: summariseGc([bid({ dueDate: "2026-01-01" })], TODAY) },
    ];
    const before = [...rows];

    rankGcs(rows);

    expect(rows).toEqual(before);
  });
});
