import { describe, expect, it } from "vitest";
import {
  bidStanding,
  bidStandings,
  daysUntil,
  standingLines,
  type StandingBid,
} from "./bid-standing";

const TODAY = "2026-10-09";

const bid = (over: Partial<StandingBid> & { id: string }): StandingBid => ({
  projectName: "Riverside Clinic",
  contactName: "Acme GC",
  status: "INVITED",
  dueDate: null,
  ...over,
});

/** `days` from today, as `YYYY-MM-DD`. */
const day = (offset: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);

describe("daysUntil", () => {
  it("counts forward and back", () => {
    expect(daysUntil(TODAY, day(3))).toBe(3);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil(TODAY, day(-5))).toBe(-5);
  });

  it("is null for a date nobody set", () => {
    expect(daysUntil(TODAY, null)).toBeNull();
    expect(daysUntil(TODAY, "whenever")).toBeNull();
  });
});

describe("bidStanding", () => {
  it("A SUBMITTED BID PAST ITS DATE IS FINE, which is the whole point", () => {
    // `/pipeline` has counted these as overdue since it was built — no status
    // in the test — so a desk with ten bids out for award read "10 past the
    // date they asked for" in red with nothing wrong. That is the warning
    // nobody reads, and the genuinely missed bid was hiding in it.
    expect(bidStanding(bid({ id: "a", status: "SUBMITTED", dueDate: day(-1) }), TODAY).standing).toBe("FINE");
    expect(bidStanding(bid({ id: "b", status: "SUBMITTED", dueDate: day(-20) }), TODAY).standing).toBe("FINE");
  });

  it("CALLS AN UNSENT BID PAST ITS DATE MISSED", () => {
    expect(bidStanding(bid({ id: "a", status: "INVITED", dueDate: day(-1) }), TODAY).standing).toBe("MISSED");
  });

  it("warns BEFORE the deadline, which is the only time it can be acted on", () => {
    expect(bidStanding(bid({ id: "a", dueDate: day(0) }), TODAY).standing).toBe("DUE_SOON");
    expect(bidStanding(bid({ id: "b", dueDate: day(3) }), TODAY).standing).toBe("DUE_SOON");
  });

  it("stays quiet about a bid that is not close yet", () => {
    expect(bidStanding(bid({ id: "a", dueDate: day(4) }), TODAY).standing).toBe("FINE");
    expect(bidStanding(bid({ id: "b", dueDate: day(60) }), TODAY).standing).toBe("FINE");
  });

  it("calls a long-unanswered submitted bid COLD", () => {
    expect(bidStanding(bid({ id: "a", status: "SUBMITTED", dueDate: day(-42) }), TODAY).standing).toBe("COLD");
    expect(bidStanding(bid({ id: "b", status: "SUBMITTED", dueDate: day(-90) }), TODAY).standing).toBe("COLD");
  });

  it("does not call a bid cold while a GC is still plausibly deciding", () => {
    // Four to eight weeks is normal on a public job. Anything tighter chases
    // bids that are proceeding normally — this file's own failure mode,
    // reintroduced one threshold along.
    expect(bidStanding(bid({ id: "a", status: "SUBMITTED", dueDate: day(-41) }), TODAY).standing).toBe("FINE");
  });

  it("AN UNDATED BID IS NOT A LATE ONE", () => {
    // Inventing a deadline is worse than silence in both directions: "fine"
    // hides a bid due tomorrow, "missed" cries wolf on one entered just now.
    expect(bidStanding(bid({ id: "a", status: "INVITED", dueDate: null }), TODAY).standing).toBe("FINE");
    expect(bidStanding(bid({ id: "b", status: "SUBMITTED", dueDate: null }), TODAY).standing).toBe("FINE");
  });
});

describe("bidStandings", () => {
  const desk: StandingBid[] = [
    bid({ id: "soon", projectName: "Clinic", dueDate: day(2) }),
    bid({ id: "missed", projectName: "Depot", dueDate: day(-3) }),
    bid({ id: "cold", projectName: "Library", status: "SUBMITTED", dueDate: day(-60) }),
    bid({ id: "waiting", projectName: "School", status: "SUBMITTED", dueDate: day(-5) }),
    bid({ id: "later", projectName: "Arena", dueDate: day(30) }),
  ];

  it("sorts each live bid into what it needs", () => {
    const summary = bidStandings(desk, TODAY);
    expect(summary.dueSoon.map((one) => one.bid.id)).toEqual(["soon"]);
    expect(summary.missed.map((one) => one.bid.id)).toEqual(["missed"]);
    expect(summary.cold.map((one) => one.bid.id)).toEqual(["cold"]);
  });

  it("LEAVES THE NORMAL ONES OUT ENTIRELY", () => {
    // "School" was submitted and its date has passed; "Arena" is a month off.
    // Neither wants anybody today, and a screen that mentions them is a screen
    // somebody stops reading.
    const summary = bidStandings(desk, TODAY);
    const named = [...summary.dueSoon, ...summary.missed, ...summary.cold].map((one) => one.bid.id);
    expect(named).not.toContain("waiting");
    expect(named).not.toContain("later");
  });

  it("puts the soonest deadline first", () => {
    const summary = bidStandings(
      [bid({ id: "a", dueDate: day(3) }), bid({ id: "b", dueDate: day(1) }), bid({ id: "c", dueDate: day(2) })],
      TODAY,
    );
    expect(summary.dueSoon.map((one) => one.bid.id)).toEqual(["b", "c", "a"]);
  });
});

describe("standingLines", () => {
  const lines = (bids: StandingBid[]) => standingLines(bidStandings(bids, TODAY));

  it("says nothing when nothing needs doing", () => {
    expect(lines([bid({ id: "a", status: "SUBMITTED", dueDate: day(-10) }), bid({ id: "b", dueDate: day(20) })])).toEqual(
      [],
    );
  });

  it("KEEPS THE THREE APART, because they want different people", () => {
    // A bid due tomorrow wants an estimator this afternoon; a missed one wants
    // somebody to find out what happened; a cold one wants a call to the GC.
    // "6 bids need attention" is the number nobody reads, one level up from
    // the one this replaces.
    const result = lines([
      bid({ id: "soon", dueDate: day(1) }),
      bid({ id: "missed", dueDate: day(-2) }),
      bid({ id: "cold", status: "SUBMITTED", dueDate: day(-70) }),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("not sent yet");
    expect(result[0]).toContain("due tomorrow");
    expect(result[1]).toContain("never sent");
    expect(result[2]).toContain("Worth a call");
  });

  it("names the projects and the GCs", () => {
    const result = lines([bid({ id: "a", projectName: "Riverside Clinic", contactName: "Acme GC", dueDate: day(1) })]);
    expect(result[0]).toContain("Riverside Clinic");
    expect(result[0]).toContain("Acme GC");
  });

  it("ALLOWS FOR THE BID THAT WENT OUT AND WAS NEVER RECORDED", () => {
    // Not an accusation. A bid past its date with nothing recorded is as
    // likely to be a bookkeeping gap as a missed deadline, and saying only
    // the first would be wrong half the time.
    expect(lines([bid({ id: "a", dueDate: day(-2) })])[0]).toContain("nobody recorded it");
  });

  it("does not print a desk full of names into one line", () => {
    const many = Array.from({ length: 9 }, (_, i) => bid({ id: `b${i}`, projectName: `Job ${i}`, dueDate: day(1) }));
    const line = lines(many)[0];
    expect(line).toContain("and 6 more");
    expect(line.length).toBeLessThan(220);
  });

  it("gets the singular right", () => {
    const result = lines([bid({ id: "a", dueDate: day(1) })]);
    expect(result[0]).toContain("1 bid not sent yet");
  });
});
