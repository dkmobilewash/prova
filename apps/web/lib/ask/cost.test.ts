import { describe as group, expect, it } from "vitest";
import {
  costAtAllowance,
  costOf,
  costPerUnit,
  spendOver,
  WEB_SEARCHES_RECORDED_FROM,
  type PricedRow,
  type RateLookup,
} from "./cost";
import { WEB_SEARCH_PER_1K } from "@prova/integrations";

/**
 * The read-time arithmetic of step 2, and the shapes it must refuse to produce.
 *
 * ── THREE OF THESE TESTS CHANGED SHAPE WHEN THE RATES ARRIVED, AND THE REASON
 * IS WORTH MORE THAN THE DIFF ──
 *
 * This suite was written while three of the five rates were `UNSET`, and it
 * reached the "a rate this row needs is missing" branch through the REAL table:
 * a row with cached tokens was unpriceable because nobody had recorded a cache
 * rate. Filling all five in on 2026-10-02 made that branch unreachable from
 * `RATES`, so the three tests that depended on the gap went red — not because
 * the behaviour regressed, but because the fixture they leaned on stopped
 * existing.
 *
 * The branch still matters. It is what a tenth model routed in next month hits
 * before anybody prices it, which is exactly the moment nobody is looking. So
 * it is reached two ways now, both of which survive a complete rate table:
 * an injected `lookup` returning a partial rate, and a model id that is not in
 * the table at all. Deleting the tests because the real table stopped
 * triggering them would have been the `#185` shape — a guard disarmed by the
 * code getting better.
 */

const row = (over: Partial<PricedRow> = {}): PricedRow => ({
  model: "claude-opus-5",
  createdAt: new Date("2026-10-02T12:00:00Z"),
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
  ...over,
});

/**
 * A model priced for tokens it bills for and NOT for the cached ones — the
 * shape of a rate somebody half-filled. Not a hypothetical: it is the state
 * `claude-opus-5` and `claude-haiku-4-5` were both in until 2026-10-02.
 */
const partialRate: RateLookup = () => ({
  from: "2026-01-01",
  inputPerMTok: 5,
  outputPerMTok: 25,
  cacheReadPerMTok: null,
  cacheWritePerMTok: null,
  source: "a fixture standing in for a rate nobody has finished recording",
});

group("what a recorded pass cost", () => {
  it("prices input and output from the rates that are recorded", () => {
    // Opus 5 at $5/$25 per MTok — DECISIONS.md:102. One million in, one
    // hundred thousand out: $5.00 + $2.50.
    const cost = costOf(row({ inputTokens: 1_000_000, outputTokens: 100_000 }));
    expect(cost.known).toBe(true);
    if (cost.known) expect(cost.usd).toBeCloseTo(7.5, 6);
  });

  it("prices Haiku at a fifth of Opus, which is the whole reason for the split", () => {
    const opus = costOf(row({ model: "claude-opus-5", inputTokens: 1_000_000 }));
    const haiku = costOf(row({ model: "claude-haiku-4-5", inputTokens: 1_000_000 }));
    expect(opus.known && haiku.known).toBe(true);
    if (opus.known && haiku.known) expect(opus.usd / haiku.usd).toBeCloseTo(5, 6);
  });

  it("reports UNKNOWN rather than zero when a rate it needs is missing", () => {
    // The failure that matters. A zero here reads as "this call was free",
    // which is indistinguishable from a cheap call and stops anybody asking.
    //
    // THIS USED TO NEED NO INJECTED LOOKUP. While three rates were unset the
    // real table reached this branch on its own; filling them in on 2026-10-02
    // made it unreachable through `RATES`. The branch still matters — it is
    // what a tenth model routed in next month hits — so the lookup is injected
    // rather than the test deleted.
    const cost = costOf(row({ cacheReadTokens: 500_000 }), partialRate);
    expect(cost.known).toBe(false);
    if (!cost.known) expect(cost.missing.join(" ")).toContain("cache read");
  });

  it("prices cache reads and writes now that those rates are recorded", () => {
    // Opus 5: cache read $0.50/MTok, 5-minute cache write $6.25/MTok. The 5m
    // rate is the right one because `ask.ts` requests `{ type: "ephemeral" }`
    // with no TTL; the 1-hour rate is $10, a 60% difference.
    const cost = costOf(row({ cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }));
    expect(cost.known).toBe(true);
    if (cost.known) expect(cost.usd).toBeCloseTo(6.75, 6);
  });

  it("does NOT need a rate for a token kind the row never used", () => {
    // Otherwise every row in the app reads unknown until all five rates are
    // filled, and the per-unit figures step 2 exists for stay unavailable for
    // no reason. A row with no cached tokens is fully priced by input/output.
    const cost = costOf(row({ inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 0 }));
    expect(cost.known).toBe(true);
  });

  it("reports UNKNOWN for a model with no rate at all, naming it and the day", () => {
    // What a newly-routed model looks like before anybody prices it.
    const cost = costOf(row({ model: "claude-something-new", inputTokens: 1_000 }));
    expect(cost.known).toBe(false);
    if (!cost.known) {
      expect(cost.missing[0]).toContain("claude-something-new");
      expect(cost.missing[0]).toContain("2026-10-02");
    }
  });

  it("refuses to price a row older than every recorded rate", () => {
    // Guessing backwards past the earliest price would invent a figure for a
    // period nobody priced.
    const cost = costOf(row({ createdAt: new Date("2025-06-01T00:00:00Z"), inputTokens: 1_000 }));
    expect(cost.known).toBe(false);
  });

  it("charges per search on top of tokens, and refuses the row if that rate goes away", () => {
    // Lead search is MOSTLY search charge, so "tokens only" presented as a cost
    // would be the same defect as a zero. Written both ways deliberately: the
    // rate is $10/1k as of 2026-10-02, and this assertion is what catches it
    // being removed or reverted to UNSET rather than silently dropping the
    // charge from every lead-search row.
    const cost = costOf(row({ inputTokens: 1_000, webSearches: 3 }));
    if (WEB_SEARCH_PER_1K === null) {
      expect(cost.known).toBe(false);
      if (!cost.known) expect(cost.missing).toContain("web search rate");
    } else {
      // 3 searches at $10/1k = $0.03, plus $0.005 of input.
      expect(cost.known).toBe(true);
      if (cost.known) expect(cost.usd).toBeCloseTo(0.005 + (3 * WEB_SEARCH_PER_1K) / 1_000, 9);
    }
  });
});

group("adding up a set of rows", () => {
  it("keeps what it could not price beside what it could", () => {
    // `absence of a failure is not a pass` applied to arithmetic: a total over
    // four rows that could only price two must not look like a total over four.
    //
    // Two DIFFERENT unknown models, so `missing` has to hold more than one
    // reason — a Set that collapsed them would pass with one.
    const spend = spendOver([
      row({ inputTokens: 1_000_000 }),
      row({ inputTokens: 1_000_000 }),
      row({ model: "claude-also-nope", inputTokens: 1 }),
      row({ model: "claude-nope", inputTokens: 1 }),
    ]);
    expect(spend.priced).toBe(2);
    expect(spend.unpriced).toBe(2);
    expect(spend.usd).toBeCloseTo(10, 6);
    expect(spend.missing.length).toBeGreaterThan(1);
  });

  it("flags a total spanning the day webSearches began being recorded", () => {
    // Rows before it read 0 searches whether or not any ran, so a total
    // crossing that date is a floor. The API said the real number once and
    // nothing wrote it down.
    const spend = spendOver([row({ createdAt: new Date("2026-09-01T00:00:00Z"), inputTokens: 1_000 })]);
    expect(spend.understated).toBe(true);
    expect(WEB_SEARCHES_RECORDED_FROM).toBe("2026-10-02");
  });

  it("does not flag a total made only of rows that record searches", () => {
    const spend = spendOver([row({ inputTokens: 1_000 })]);
    expect(spend.understated).toBe(false);
  });

  it("adds up to nothing, priced, over no rows at all", () => {
    const spend = spendOver([]);
    expect(spend).toMatchObject({ usd: 0, priced: 0, unpriced: 0, understated: false });
  });
});

group("cost per unit of work — the figure step 2 exists for", () => {
  it("divides by the units the allowance is denominated in", () => {
    const spend = spendOver([row({ inputTokens: 1_000_000 })]); // $5.00
    expect(costPerUnit(spend, 2_500)).toBeCloseTo(0.002, 9);
  });

  it("returns null rather than a number when there is nothing to divide by", () => {
    // A month with no plan sheets has no cost per sheet. Inventing one would be
    // the most confidently wrong figure on the page.
    const spend = spendOver([row({ inputTokens: 1_000_000 })]);
    expect(costPerUnit(spend, 0)).toBeNull();
    expect(costPerUnit(spend, -1)).toBeNull();
  });

  it("returns null when nothing in the set could be priced", () => {
    // Not zero. A month of calls nobody can price has no cost per unit, and a
    // $0.0000 per sheet would be read as "this is free at any volume" — which
    // is the exact decision step 2 exists to inform.
    const spend = spendOver([row({ model: "claude-nope", inputTokens: 10 })]);
    expect(spend.priced).toBe(0);
    expect(costPerUnit(spend, 100)).toBeNull();
  });

  it("projects a full allowance at the measured rate, and stays null without one", () => {
    // This is the number the open question wants: 1,500 sheets a month at the
    // measured per-sheet cost.
    expect(costAtAllowance(0.002, 1_500)).toBeCloseTo(3, 9);
    expect(costAtAllowance(null, 1_500)).toBeNull();
  });
});
