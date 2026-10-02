// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe as group, expect, it } from "vitest";
import { CostPanel } from "./AiCostPanel";
import { spendOver, tokensOver, type PricedRow } from "@/lib/ask/cost";
import { rateFor, WEB_SEARCH_PER_1K } from "@prova/integrations";
import type { CostReport } from "@/lib/ask/cost-query";

/**
 * THE DOLLAR FIGURE ON SCREEN MUST RECONCILE WITH THE TOKENS PRINTED BESIDE IT.
 *
 * ── WHY THIS IS A TEST AND NOT A CLICK-LIST STEP ──
 *
 * #590's click-list said: "the total should now be explicable from those numbers
 * at the rates in `pricing.ts` — DO THAT MULTIPLICATION." That instruction is
 * correct and it is the wrong shape, for the reason this repo has written down
 * twice already: a re-derivation nobody runs is a claim with an expiry date.
 * The counter roll-call carried two shell commands to re-derive a count and the
 * prose still rotted in a day; it lives in `counterCensus.test.ts` now and fails
 * the build instead. Same move here.
 *
 * ── WHAT IT IS ACTUALLY GUARDING, WHICH IS NOT THE ARITHMETIC ──
 *
 * `cost.test.ts` already proves `costOf` multiplies correctly. This proves
 * something no arithmetic test can: that the number the panel PRINTS and the
 * tokens the panel PRINTS are about the same rows. The defect this closes is the
 * one the click-through actually hit — `$0.43` beside "1,285 tokens in, 267 out",
 * where the arithmetic was perfect and the screen was unreadable, and the
 * tester's honest conclusion was that a rate had been entered per-1,000 instead
 * of per-million. A screen that makes a right answer indistinguishable from a
 * 1,000x error is broken even though no number on it is wrong.
 *
 * So the assertion is deliberately end-to-end over the RENDERED TEXT: parse the
 * dollars out of the DOM, parse the tokens out of the DOM, and require that the
 * second explains the first at the recorded rates. A future change that prints a
 * total over all rows beside tokens over priced rows — the exact mismatch
 * `tokensOver` was written to avoid — fails here, and nowhere else.
 *
 * ── AND IT RE-DERIVES THE EXPECTED FIGURE FROM `RATES`, NOT FROM A LITERAL ──
 *
 * A hardcoded `$6.75` would have to be edited the next time a price moves, and
 * somebody editing an expectation to match an output is how a guard stops being
 * one. The expectation comes from `rateFor`, so a rate change moves both sides
 * together and this test keeps asking the same question.
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

/** A report shaped exactly as `loadCostReport` builds one, from real rows. */
function reportOver(rows: PricedRow[], over: Partial<CostReport> = {}): CostReport {
  return {
    from: new Date("2026-09-02T00:00:00Z"),
    byFeature: [{ feature: "ask", label: "The assistant", calls: rows.length, spend: spendOver(rows) }],
    total: spendOver(rows),
    totalTokens: tokensOver(rows),
    units: [],
    straddled: false,
    missing: [],
    ...over,
  };
}

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

function render(report: CostReport): string {
  const root = createRoot(host);
  act(() => {
    root.render(createElement(CostPanel, { report }));
  });
  return host.textContent ?? "";
}

group("the total reconciles with the tokens printed beside it", () => {
  // The shape of the row that produced the click-through defect: most of the
  // charge in cache writes, which the usage block above the panel never shows.
  const rows = [
    row({ inputTokens: 1_000, outputTokens: 200, cacheWriteTokens: 66_000 }),
    row({ inputTokens: 285, outputTokens: 67, cacheReadTokens: 500 }),
  ];

  it("prints every token kind that carries a charge", () => {
    const text = render(reportOver(rows));
    // 1,285 in / 267 out would have been the whole story on the broken screen.
    expect(text).toContain("1,285 in");
    expect(text).toContain("267 out");
    // THE FIX: the kind doing 97% of the charging is now on screen.
    expect(text).toContain("66,000 cache written");
    expect(text).toContain("500 cache read");
  });

  it("THE RECONCILIATION: the dollars on screen equal the tokens on screen, at the recorded rates", () => {
    const text = render(reportOver(rows));

    // Parse what the SCREEN says, not what the report holds — the point is that
    // the rendered figures agree with each other.
    const dollars = /\$([0-9]+\.[0-9]+)/.exec(text);
    expect(dollars, `no dollar figure rendered at all; panel text was: ${text.slice(0, 400)}`).not.toBeNull();
    const shown = Number(dollars![1]);

    const rate = rateFor("claude-opus-5", "2026-10-02");
    expect(rate, "claude-opus-5 has no rate on 2026-10-02, so this test cannot check anything").not.toBeNull();

    const tokens = tokensOver(rows);
    const expected =
      (tokens.inputTokens * rate!.inputPerMTok!) / 1_000_000 +
      (tokens.outputTokens * rate!.outputPerMTok!) / 1_000_000 +
      (tokens.cacheReadTokens * rate!.cacheReadPerMTok!) / 1_000_000 +
      (tokens.cacheWriteTokens * rate!.cacheWritePerMTok!) / 1_000_000 +
      (tokens.webSearches * (WEB_SEARCH_PER_1K ?? 0)) / 1_000;

    // Two decimals, because that is the precision the screen prints at this
    // magnitude. The assertion is "a person doing this multiplication by hand
    // gets the number in front of them", which is exactly what failed before.
    expect(shown).toBeCloseTo(Number(expected.toFixed(2)), 6);
  });

  it("a REPORT whose tokens do not explain its total fails this test", () => {
    // The mutation, as a case rather than an edit: a total built over all rows
    // beside tokens built over a subset is the mismatch `tokensOver` exists to
    // prevent, and it must not pass. If this ever goes green the reconciliation
    // above has stopped being load-bearing.
    const text = render(
      reportOver(rows, {
        total: spendOver([...rows, row({ inputTokens: 5_000_000 })]),
      }),
    );
    const shown = Number(/\$([0-9]+\.[0-9]+)/.exec(text)![1]);
    const fromTokens = tokensOver(rows);
    const rate = rateFor("claude-opus-5", "2026-10-02")!;
    const explained =
      (fromTokens.inputTokens * rate.inputPerMTok!) / 1_000_000 +
      (fromTokens.outputTokens * rate.outputPerMTok!) / 1_000_000 +
      (fromTokens.cacheReadTokens * rate.cacheReadPerMTok!) / 1_000_000 +
      (fromTokens.cacheWriteTokens * rate.cacheWritePerMTok!) / 1_000_000;
    expect(shown).not.toBeCloseTo(Number(explained.toFixed(2)), 6);
  });
});

group("what the panel must never render", () => {
  it("no $0.00 — and the check needs a BOUNDARY, which the click-list's did not have", () => {
    // The failure the whole discriminated-result design exists to prevent. A
    // sub-cent figure must switch to four decimals rather than round to zero.
    //
    // THE FIRST VERSION OF THIS TEST WAS WRONG, AND SO WAS #590's CLICK-LIST.
    // Both said "search for the literal string `$0.00`". `$0.0000` CONTAINS
    // `$0.00`, so a correct sub-cent figure fails a substring check — and the
    // browser tester who reported "a search for $0.00 found nothing" was
    // reading a $0.43 total, where the question never arose. Had any figure on
    // that screen been sub-cent, the instruction I wrote would have produced a
    // false FAIL on the one formatting branch that exists to prevent the defect.
    //
    // So the assertion needs a negative lookahead: a zero figure is `$0.00` with
    // nothing after it, and `$0.0000…` is the formatter working.
    const subCent = render(reportOver([row({ inputTokens: 1 })]));
    expect(subCent).not.toMatch(/\$0\.00(?![0-9])/);
    expect(subCent).toMatch(/\$0\.0000[0-9]*/);

    // And the real defect still has to be caught, so prove the matcher can fail:
    // a figure of exactly zero is what "this call was free" looks like.
    expect("$0.00 across 2 priced calls").toMatch(/\$0\.00(?![0-9])/);
  });

  it("says a total is a FLOOR when the window predates recorded searches", () => {
    const text = render(reportOver([row({ createdAt: new Date("2026-09-01T00:00:00Z"), inputTokens: 1_000 })]));
    expect(text).toContain("This is a FLOOR");
  });

  it("declares the straddle, so an under-estimate is not read as a measurement", () => {
    const text = render(reportOver([row({ inputTokens: 1_000 })], { straddled: true }));
    expect(text).toContain("UNDER-estimate");
  });

  it("does NOT declare a straddle it does not have", () => {
    // A warning that always fires trains people to ignore it, which is how a
    // real one gets missed.
    const text = render(reportOver([row({ inputTokens: 1_000 })], { straddled: false }));
    expect(text).not.toContain("UNDER-estimate");
  });

  it("names a feature in words, never its raw ledger key", () => {
    // Bug one of #590, pinned at the render layer as well as at the lookup:
    // `ask · 2 calls · $0.43` is what shipped.
    const text = render(reportOver([row({ inputTokens: 1_000 })]));
    expect(text).toContain("The assistant");
    expect(text).not.toMatch(/(^|\s)ask\s·/);
  });
});
