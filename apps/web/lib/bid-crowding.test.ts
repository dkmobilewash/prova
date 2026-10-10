import { describe, expect, it } from "vitest";
import { bidCrowds, crowdingLines, type CrowdingBid } from "./bid-crowding";

const TODAY = "2026-10-09";

const day = (offset: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);

const bid = (id: string, dueIn: number | null, over: Partial<CrowdingBid> = {}): CrowdingBid => ({
  id,
  projectName: `Project ${id}`,
  contactName: "Acme GC",
  status: "INVITED",
  dueDate: dueIn === null ? null : day(dueIn),
  ...over,
});

describe("bidCrowds", () => {
  it("FINDS THREE DEADLINES IN THE SAME WEEK", () => {
    const crowds = bidCrowds([bid("a", 3), bid("b", 5), bid("c", 8)], TODAY);
    expect(crowds).toHaveLength(1);
    expect(crowds[0].bids.map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(crowds[0].from).toBe(day(3));
    expect(crowds[0].to).toBe(day(8));
  });

  it("says nothing about an ordinary week", () => {
    // Two bids in a week is a week. Mentioning it would be the warning nobody
    // reads, which `/pipeline`'s overdue badge has just finished being.
    expect(bidCrowds([bid("a", 3), bid("b", 5)], TODAY)).toEqual([]);
  });

  it("leaves bids that are comfortably apart alone", () => {
    expect(bidCrowds([bid("a", 3), bid("b", 20), bid("c", 40)], TODAY)).toEqual([]);
  });

  it("DOES NOT CHAIN A CALENDAR INTO ONE CROWD", () => {
    // Measured against the START of the run, not the previous bid. Chaining
    // off the neighbour would let a bid every six days join one unbroken
    // "crowd" stretching over months — a calendar, not a warning.
    const crowds = bidCrowds([bid("a", 1), bid("b", 7), bid("c", 13), bid("d", 19)], TODAY);
    expect(crowds).toEqual([]);
  });

  it("splits two separate busy weeks", () => {
    const crowds = bidCrowds(
      [bid("a", 1), bid("b", 2), bid("c", 3), bid("x", 30), bid("y", 31), bid("z", 32)],
      TODAY,
    );
    expect(crowds).toHaveLength(2);
    expect(crowds[0].bids.map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(crowds[1].bids.map((one) => one.id)).toEqual(["x", "y", "z"]);
  });

  it("IGNORES BIDS ALREADY SENT, which take no more of this week", () => {
    const crowds = bidCrowds(
      [bid("a", 3), bid("b", 4, { status: "SUBMITTED" }), bid("c", 5, { status: "SUBMITTED" })],
      TODAY,
    );
    expect(crowds).toEqual([]);
  });

  it("IGNORES A WEEK THAT HAS ALREADY HAPPENED", () => {
    // Telling somebody four bids were crowded last Tuesday is a fact about a
    // week they cannot change. Past deadlines are `bid-standing.ts`'s business.
    expect(bidCrowds([bid("a", -1), bid("b", -2), bid("c", -3)], TODAY)).toEqual([]);
  });

  it("counts today as still ahead", () => {
    const crowds = bidCrowds([bid("a", 0), bid("b", 1), bid("c", 2)], TODAY);
    expect(crowds).toHaveLength(1);
  });

  it("ignores a bid with no deadline rather than placing it", () => {
    expect(bidCrowds([bid("a", 1), bid("b", 2), bid("c", null)], TODAY)).toEqual([]);
  });

  it("survives a date nobody can parse", () => {
    const crowds = bidCrowds(
      [bid("a", 1), bid("b", 2), bid("c", null, { dueDate: "sometime next week" })],
      TODAY,
    );
    expect(crowds).toEqual([]);
  });

  it("FINDS A CROWD WHOSE BIDS ARRIVE IN ANY ORDER", () => {
    // Found by mutation: every other fixture here happens to be written in
    // date order, so the sort could be deleted and nothing noticed. Rows come
    // out of the database in whatever order the query gives them.
    const crowds = bidCrowds([bid("c", 5), bid("a", 3), bid("b", 4)], TODAY);
    expect(crowds).toHaveLength(1);
    expect(crowds[0].bids.map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(crowds[0].from).toBe(day(3));
    expect(crowds[0].to).toBe(day(5));
  });

  it("does not invent a crowd out of unordered far-apart bids", () => {
    // The other direction: unsorted input must not accidentally make three
    // distant deadlines look adjacent.
    expect(bidCrowds([bid("c", 40), bid("a", 1), bid("b", 20)], TODAY)).toEqual([]);
  });

  it("puts no bid in two crowds", () => {
    const crowds = bidCrowds([bid("a", 1), bid("b", 2), bid("c", 3), bid("d", 4), bid("e", 5)], TODAY);
    const ids = crowds.flatMap((crowd) => crowd.bids.map((one) => one.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("crowdingLines", () => {
  const lines = (bids: CrowdingBid[]) => crowdingLines(bidCrowds(bids, TODAY));

  it("names the window, the projects and the GCs", () => {
    const line = lines([bid("a", 3), bid("b", 4), bid("c", 5)])[0];
    expect(line).toContain("3 bids");
    expect(line).toContain(day(3));
    expect(line).toContain(day(5));
    expect(line).toContain("Project a");
    expect(line).toContain("Acme GC");
  });

  it("says ALL DUE when they land on one day", () => {
    const line = lines([bid("a", 4), bid("b", 4), bid("c", 4)])[0];
    expect(line).toContain(`all due ${day(4)}`);
    expect(line).not.toContain("between");
  });

  it("NAMES THE ACTION THAT IS CHEAP NOW AND EXPENSIVE LATER", () => {
    // A GC told three weeks out can invite somebody else. A bid nobody answers
    // costs the relationship that a decline does not.
    expect(lines([bid("a", 3), bid("b", 4), bid("c", 5)])[0]).toContain("would rather hear it now");
  });

  it("does not tell somebody WHICH to drop", () => {
    // That depends on the GC, the fee, the backlog and who is free, none of
    // which is in this file.
    const line = lines([bid("a", 3), bid("b", 4), bid("c", 5)])[0];
    expect(line).not.toMatch(/drop|decline Project|should/i);
  });

  it("does not print a whole desk into one line", () => {
    const many = Array.from({ length: 9 }, (_, i) => bid(`b${i}`, 1 + (i % 5)));
    const line = lines(many)[0];
    expect(line).toContain("and 5 more");
    expect(line.length).toBeLessThan(280);
  });

  it("says nothing when nothing is crowded", () => {
    expect(lines([bid("a", 3), bid("b", 30)])).toEqual([]);
  });
});
