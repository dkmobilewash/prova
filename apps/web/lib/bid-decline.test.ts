import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  summariseDeclines,
  declineLabel,
  declineFieldsFor,
  DECLINE_REASONS,
  type DeclineReason,
  type DeclinedBid,
} from "./bid-decline";

/**
 * WHAT THIS IS FOR, AND WHY THE UNRECORDED COUNT IS THE LOAD-BEARING PART.
 *
 * `BidInvitationStatus.DECLINED` was a bare status — no reason, no date — so
 * the app could say eight bids were declined and never say why. Eight for
 * CAPACITY means hire; eight for CONTRACT_TERMS means one GC's paper is costing
 * the relationship. Same count, different businesses.
 *
 * A reason is asked for and never required, because a mandatory dropdown gets
 * the first option picked to get past the screen — data that looks complete and
 * is fiction, which is worse than blank. So the unrecorded ones are counted
 * separately and said out loud, the way `conceptual-estimate.ts` always returns
 * its sample size.
 */

const bid = (over: Partial<DeclinedBid> = {}): DeclinedBid => ({
  id: "bid_1",
  declineReason: "CAPACITY",
  estimatedValue: null,
  ...over,
});

describe("summarising why bids were declined", () => {
  it("groups by reason and counts", () => {
    const summary = summariseDeclines([
      bid({ id: "a", declineReason: "CAPACITY" }),
      bid({ id: "b", declineReason: "CAPACITY" }),
      bid({ id: "c", declineReason: "SCHEDULE" }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.groups.map((g) => [g.reason, g.count])).toEqual([
      ["CAPACITY", 2],
      ["SCHEDULE", 1],
    ]);
  });

  it("ORDERS BY COUNT, not by value — the question is what keeps happening", () => {
    // One large job turned down for bonding is an event. Five small ones turned
    // down for capacity is a business problem, and ordering by value prints the
    // event first.
    const summary = summariseDeclines([
      bid({ id: "big", declineReason: "BONDING", estimatedValue: 4_000_000 }),
      bid({ id: "a", declineReason: "CAPACITY", estimatedValue: 50_000 }),
      bid({ id: "b", declineReason: "CAPACITY", estimatedValue: 50_000 }),
    ]);
    expect(summary.groups[0].reason).toBe("CAPACITY");
  });

  it("COUNTS THE UNRECORDED SEPARATELY, never folded into OTHER", () => {
    // "Nobody wrote it down" and "the estimator chose Something else" are
    // different facts. Merging them would make the data look more complete
    // than it is.
    const summary = summariseDeclines([
      bid({ id: "a", declineReason: null }),
      bid({ id: "b", declineReason: "OTHER" }),
    ]);
    expect(summary.unrecorded).toBe(1);
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].reason).toBe("OTHER");
    expect(summary.groups[0].count).toBe(1);
  });

  it("keeps the unrecorded in the TOTAL, because they were still declined", () => {
    const summary = summariseDeclines([bid({ declineReason: null }), bid({ declineReason: null })]);
    expect(summary.total).toBe(2);
    expect(summary.unrecorded).toBe(2);
    expect(summary.groups).toEqual([]);
  });

  it("SAYS HOW MANY CARRIED A VALUE — a sum over three of eight is not eight", () => {
    const summary = summariseDeclines([
      bid({ id: "a", declineReason: "CAPACITY", estimatedValue: 100_000 }),
      bid({ id: "b", declineReason: "CAPACITY", estimatedValue: null }),
      bid({ id: "c", declineReason: "CAPACITY", estimatedValue: 50_000 }),
    ]);
    expect(summary.groups[0].count).toBe(3);
    expect(summary.groups[0].value).toBe(150_000);
    expect(summary.groups[0].valuedCount).toBe(2);
  });

  it("ignores a value that is not a number rather than making the sum NaN", () => {
    const summary = summariseDeclines([
      bid({ declineReason: "CAPACITY", estimatedValue: Number.NaN }),
      bid({ id: "b", declineReason: "CAPACITY", estimatedValue: 10_000 }),
    ]);
    expect(summary.groups[0].value).toBe(10_000);
    expect(summary.groups[0].valuedCount).toBe(1);
  });

  it("returns nothing to say for no declines", () => {
    const summary = summariseDeclines([]);
    expect(summary.total).toBe(0);
    expect(summary.groups).toEqual([]);
    expect(summary.headline).toBeNull();
  });
});

describe("the sentence beside the list", () => {
  it("names the commonest reason and how often", () => {
    const summary = summariseDeclines([
      bid({ id: "a", declineReason: "CAPACITY" }),
      bid({ id: "b", declineReason: "CAPACITY" }),
      bid({ id: "c", declineReason: "SCHEDULE" }),
    ]);
    expect(summary.headline).toBe("3 bids declined, most often for no capacity (2 of 3).");
  });

  it("says ALL when there is only one reason", () => {
    expect(summariseDeclines([bid()]).headline).toBe("1 bid declined, all for no capacity.");
  });

  it("ALWAYS MENTIONS THE UNRECORDED when there are any", () => {
    // A summary that silently rests on half the data is the shape this module
    // exists to avoid.
    const summary = summariseDeclines([
      bid({ id: "a", declineReason: "CAPACITY" }),
      bid({ id: "b", declineReason: null }),
    ]);
    expect(summary.headline).toContain("1 had no reason recorded");
  });

  it("says so plainly when NOTHING was recorded", () => {
    expect(summariseDeclines([bid({ declineReason: null })]).headline).toBe(
      "1 bid declined, with no reason recorded on any of them.",
    );
  });

  it("CARRIES NO VERDICT — no target, no advice, no judgement", () => {
    // The house rule. A sub declining most invitations may be correctly busy,
    // and an app that nags about it would be wrong most of the time while
    // sounding authoritative.
    const summary = summariseDeclines(
      Array.from({ length: 20 }, (_, i) => bid({ id: `b${i}`, declineReason: "CAPACITY" })),
    );
    expect(summary.headline).not.toMatch(/should|too many|consider|recommend|high|low|target/i);
  });
});

describe("the reasons themselves", () => {
  it("names every one, so no raw enum value can reach a screen", () => {
    const reasons: DeclineReason[] = [
      "CAPACITY", "SCOPE_MISMATCH", "SCHEDULE", "BONDING", "CONTRACT_TERMS",
      "DRAWINGS_INCOMPLETE", "PRICE_RISK", "RELATIONSHIP", "OTHER",
    ];
    for (const reason of reasons) {
      expect(declineLabel(reason), reason).toBeTruthy();
      expect(declineLabel(reason)).not.toBe(reason);
      expect(DECLINE_REASONS[reason].hint.length).toBeGreaterThan(20);
    }
  });

  it("has no reason whose label is shouting enum case", () => {
    for (const [reason, { label }] of Object.entries(DECLINE_REASONS)) {
      expect(label, reason).not.toMatch(/_/);
      expect(label, reason).not.toBe(label.toUpperCase());
    }
  });

  it("covers the nine the schema declares, and no more", () => {
    // The pair is held in step by this count: adding a member to the enum
    // without a label here fails the build on the Record, and adding a label
    // with no enum member fails this.
    expect(Object.keys(DECLINE_REASONS)).toHaveLength(9);
  });
});

describe("what the three columns become", () => {
  const on = new Date("2026-10-08T00:00:00.000Z");

  it("keeps the reason when the status IS declined", () => {
    expect(declineFieldsFor({ status: "DECLINED", reason: "CAPACITY", note: "crew booked", on })).toEqual({
      declineReason: "CAPACITY",
      declineNote: "crew booked",
      declinedOn: on,
    });
  });

  it("CLEARS ALL THREE when the bid is re-opened", () => {
    // A bid re-opened because the GC extended the date must not keep
    // "declined for capacity on the 3rd" hanging off it: read later that is
    // the decision that stands, and it is the decision that was reversed.
    for (const status of ["INVITED", "SUBMITTED", "WON", "LOST"]) {
      expect(declineFieldsFor({ status, reason: "CAPACITY", note: "crew booked", on }), status).toEqual({
        declineReason: null,
        declineNote: null,
        declinedOn: null,
      });
    }
  });

  it("allows a decline with NO reason, which is the whole posture", () => {
    const fields = declineFieldsFor({ status: "DECLINED", reason: null, note: null, on });
    expect(fields.declineReason).toBeNull();
    expect(fields.declinedOn).toEqual(on);
  });

  it("dates it today only when the caller supplies nothing", () => {
    const fields = declineFieldsFor({ status: "DECLINED", reason: "CAPACITY", note: null, on: null });
    expect(fields.declinedOn).toBeInstanceOf(Date);
    expect(fields.declinedOn?.getTime() ?? 0).toBeGreaterThan(Date.now() - 10_000);
  });
});

/**
 * AND THAT THE SCREENS ACTUALLY USE IT.
 *
 * Found the hard way on #693: gating a call site left every render test green,
 * because they exercised the component directly and said nothing about anybody
 * calling it. That is #665's shape. These read the call sites with comments
 * STRIPPED, because this file prints the symbol names in prose and a raw-text
 * search would find call sites that do not exist.
 *
 * A census, and its limit is the usual one: it proves the call is written, not
 * that the page renders. The pages themselves are pre-existing and already
 * reached by the journey.
 */
describe("the screens' own use of it", () => {
  const strip = (raw: string) =>
    raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const read = (rel: string) => strip(readFileSync(resolve(__dirname, rel), "utf8"));
  const bidsPage = read("../app/(app)/bids/page.tsx");
  const contactPage = read("../app/(app)/contacts/[id]/page.tsx");
  const action = read("./actions/estimating.ts");

  it("PARSED SOMETHING — so a broken strip fails loudly rather than passing everything", () => {
    expect(bidsPage.length).toBeGreaterThan(5_000);
    expect(contactPage.length).toBeGreaterThan(5_000);
    expect(action.length).toBeGreaterThan(5_000);
  });

  it("/bids computes the summary AND renders it", () => {
    expect(bidsPage).toMatch(/summariseDeclines\(/);
    expect(bidsPage).toMatch(/declineSummary\.groups\.map/);
    // THE GATE ITSELF, not merely a mention of the field. A mutation that
    // wrapped the section in `{false && ...}` passed the looser version of this
    // test, because the field name survived inside the dead branch. Asserting
    // the condition is what catches it.
    expect(bidsPage).toMatch(/\{declineSummary\.headline !== null && \(/);
    expect(bidsPage).not.toMatch(/\{\s*(false|null|0)\s*&&/);
  });

  it("the bid form offers a reason", () => {
    expect(contactPage).toMatch(/name="declineReason"/);
    expect(contactPage).toMatch(/DECLINE_REASON_OPTIONS\.map/);
  });

  it("the action stores it through the shared rule, not its own copy", () => {
    // THE ASSIGNMENT, not the call. A mutation that computed the fields inline
    // and left `declineFieldsFor(...)` assigned to an unused variable passed
    // the looser version — a census cannot tell "calls it" from "mentions it",
    // so it has to assert the thing whose value is used.
    expect(action).toMatch(/const declineFields = declineFieldsFor\(/);
    expect(action).toMatch(/\.\.\.declineFields/);
    // And no second, disagreeing copy of the rule beside it.
    expect(action).not.toMatch(/declineReason: null, declineNote: null/);
  });
});
