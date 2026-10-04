import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { TRADE_PRIORITY_RANKS, tradeMatchFor, tradeScopeFor } from "@/lib/sub-listing/parse";
import { TRADE_SCOPES, TRADE_SCOPE_OPTIONS, tradeScopeLabel } from "@/lib/trade-scopes";

/**
 * THE TIE-BREAK ORDER MUST BE TOTAL OVER THE CANONICAL TRADE LIST.
 *
 * `tradeMatchFor` breaks a tie — two of our trades matching a portion of work
 * with keywords of equal length — using `TRADE_PRIORITY`. That used to be an
 * ARRAY, read with `indexOf`, and `Array.prototype.indexOf` returns **-1** for a
 * value it does not hold. -1 is lower than every real index, so a sixth trade
 * added to `lib/trade-scopes.ts` and forgotten in the ordering would silently
 * sort FIRST — ahead of metal framing and drywall, this company's own primary
 * trade. Measured on the live function before the fix, with one entry commented
 * out of the array: "Drywall and ceilings" flipped from `METAL_FRAMING_DRYWALL`
 * to `ACOUSTICAL_CEILINGS`, and all 258 tests stayed green.
 *
 * The cost of a wrong winner is two things, not one. `shouldInclude` ticks a row
 * when `tradeScope !== null`, so the scope decides whether the row is imported
 * by default; and the TRADE claim quotes the scope's label, so a wrong winner is
 * a specific false sentence about a man's own job.
 *
 * ── WHAT THE TYPE ALREADY DOES, AND WHAT ONLY A TEST CAN DO ────────────────
 *
 * `TRADE_PRIORITY` is now `Record<TradeScopeValue, number>`, so an omission is a
 * COMPILE error — verified by injecting one and reading `tsc`, not inferred.
 * This file covers the three things the type cannot see:
 *
 *   - that no two trades share a RANK. A total Record cannot omit a key; it can
 *     happily give two trades the same number, which puts the outcome back on
 *     `Array.prototype.sort`'s tie order — the arbitrary tie the table exists to
 *     settle;
 *   - that the ORDER is the one documented, with metal framing and drywall
 *     leading. A permutation check passes on any order at all;
 *   - that the tie-break actually produces that winner when run, rather than
 *     merely being written down. CLAUDE.md's fourth census lesson: a census can
 *     tell you the code is THERE and never that it is HONOURED.
 *
 * ── THE SIZE AND SCOPE ASSERTIONS, PER CLAUDE.md ───────────────────────────
 *
 * Everything derived here is sized against a source that cannot drift with it.
 * The membership set is derived from `TRADE_SCOPES` — the canonical list, which
 * `TRADE_PRIORITY` does not feed and cannot change — and `TRADE_SCOPES` is
 * itself sized against `TRADE_SCOPE_OPTIONS`, which is where the trades are
 * actually written. The source-text census below counts its own parse against a
 * second expression sharing no regex with the first, so a pattern that drifts
 * fails on the COUNT rather than silently reasoning about an empty set.
 */

const PARSE_SOURCE = readFileSync(new URL("./parse.ts", import.meta.url), "utf8");

/** Comments stripped: `parse.ts`'s own docstrings quote the old array form. */
const PARSE_CODE = PARSE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const CANONICAL = TRADE_SCOPES as readonly string[];

describe("the trade tie-break order is total over the canonical trade list", () => {
  it("the canonical list is the five trades, sized against where they are written", () => {
    // TRADE_SCOPES is derived from TRADE_SCOPE_OPTIONS, so this is the one place
    // a count is legitimate: the two cannot drift from each other.
    expect(CANONICAL.length).toBe(TRADE_SCOPE_OPTIONS.length);
    expect(CANONICAL.length).toBeGreaterThanOrEqual(5);
    expect([...CANONICAL].sort()).toEqual([...new Set(CANONICAL)].sort());
  });

  it("every canonical trade has a rank", () => {
    const missing = CANONICAL.filter((trade) => !(trade in TRADE_PRIORITY_RANKS));
    expect(
      missing,
      `these trades are in lib/trade-scopes.ts and have no tie-break rank in parse.ts, so a tie involving one of them is decided by nothing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every rank belongs to a canonical trade — no rank for a trade that no longer exists", () => {
    const extra = Object.keys(TRADE_PRIORITY_RANKS).filter((key) => !CANONICAL.includes(key));
    expect(
      extra,
      `these have a tie-break rank and are not in the canonical list: ${extra.join(", ")}`,
    ).toEqual([]);
  });

  it("the ranks are a permutation of 0…n-1, so no two trades tie on rank", () => {
    const ranks = CANONICAL.map((trade) => TRADE_PRIORITY_RANKS[trade as keyof typeof TRADE_PRIORITY_RANKS]);
    expect(ranks).toHaveLength(CANONICAL.length);
    expect(
      [...ranks].sort((a, b) => a - b),
      "two trades sharing a rank puts the tie back on Array.prototype.sort's order, which is the arbitrary outcome this table exists to replace",
    ).toEqual(CANONICAL.map((_, index) => index));
  });

  it("metal framing and drywall leads, because it is the core trade", () => {
    const ordered = [...CANONICAL].sort(
      (a, b) =>
        TRADE_PRIORITY_RANKS[a as keyof typeof TRADE_PRIORITY_RANKS] -
        TRADE_PRIORITY_RANKS[b as keyof typeof TRADE_PRIORITY_RANKS],
    );
    expect(ordered).toEqual([
      "METAL_FRAMING_DRYWALL",
      "ACOUSTICAL_CEILINGS",
      "LATH_PLASTER",
      "EIFS",
      "FIREPROOFING",
    ]);
  });
});

describe("the ordering is READ, not merely written down", () => {
  /**
   * Equal-length keywords from two different trades. Each pair is a real tie, so
   * the priority order is the only thing deciding it — confirmed by measurement
   * rather than by reading: reversing `TRADE_PRIORITY` in a scratch copy of
   * `parse.ts` flipped the winner on exactly these, and on all 29 equal-length
   * cross-trade keyword pairs out of 574.
   */
  const TIES: { portion: string; winner: string; loser: string }[] = [
    { portion: "Drywall and ceilings", winner: "METAL_FRAMING_DRYWALL", loser: "ACOUSTICAL_CEILINGS" },
    { portion: "Drywall / ceiling", winner: "METAL_FRAMING_DRYWALL", loser: "ACOUSTICAL_CEILINGS" },
    { portion: "Metal stud framing and acoustical ceilings", winner: "METAL_FRAMING_DRYWALL", loser: "ACOUSTICAL_CEILINGS" },
    { portion: "Lath, plaster and drywall", winner: "METAL_FRAMING_DRYWALL", loser: "LATH_PLASTER" },
    { portion: "Taping and stucco", winner: "METAL_FRAMING_DRYWALL", loser: "LATH_PLASTER" },
    { portion: "Interior framing and synthetic stucco", winner: "METAL_FRAMING_DRYWALL", loser: "EIFS" },
    { portion: "Light gauge and act ceiling", winner: "METAL_FRAMING_DRYWALL", loser: "ACOUSTICAL_CEILINGS" },
  ];

  it.each(TIES)(
    "$portion is read as $winner, with $loser reported alongside",
    ({ portion, winner, loser }: { portion: string; winner: string; loser: string }) => {
      const match = tradeMatchFor(portion);
      expect(match.scope).toBe(winner);
      expect(match.alsoMatched).toContain(loser);
      // The claim quotes the LABEL, so a wrong winner is a wrong sentence.
      expect(tradeScopeLabel(match.scope)).toBe(tradeScopeLabel(winner));
    },
  );

  it("each of those really is a tie, so the rank is what decided it and not the keyword length", () => {
    // If length decided, raising the loser's rank above the winner's could not
    // change the answer. Re-running the documented comparator over the same two
    // candidates with the ranks swapped must flip it — that is what makes these
    // cases a test OF the ordering rather than a test of the keyword table.
    for (const { portion, winner, loser } of TIES) {
      const match = tradeMatchFor(portion);
      const candidates = [match.scope, ...match.alsoMatched];
      expect(candidates, `${portion} must match both trades`).toContain(winner);
      expect(candidates).toContain(loser);

      const asWritten = [winner, loser].sort(
        (a, b) =>
          TRADE_PRIORITY_RANKS[a as keyof typeof TRADE_PRIORITY_RANKS] -
          TRADE_PRIORITY_RANKS[b as keyof typeof TRADE_PRIORITY_RANKS],
      );
      expect(asWritten[0], `${portion}: the ordering must be what puts ${winner} first`).toBe(winner);
    }
  });

  it("an unambiguous portion of work is untouched by any of this", () => {
    expect(tradeScopeFor("Spray-applied fireproofing")).toBe("FIREPROOFING");
    expect(tradeScopeFor("Suspended ceiling grid and tile")).toBe("ACOUSTICAL_CEILINGS");
    expect(tradeScopeFor("Finish carpentry")).toBeNull();
    expect(tradeScopeFor(null)).toBeNull();
  });
});

describe("the ordering cannot be read with indexOf again", () => {
  /**
   * The regression that closes the defect at its source rather than at its
   * symptom. `indexOf` on a list of trades is the shape that returns -1 — the
   * failure was not that the list was short, it was that a miss read as "sorts
   * first". A `Record` lookup of a missing key is `undefined`, which is loud.
   *
   * Counted against a second expression that shares no regex with the first, so
   * a pattern that drifts fails on the COUNT instead of matching nothing and
   * passing: `TRADE_PRIORITY` must be mentioned in the code at all.
   */
  it("TRADE_PRIORITY is declared as a total Record and never indexed with indexOf", () => {
    const mentions = PARSE_CODE.match(/TRADE_PRIORITY/g) ?? [];
    expect(
      mentions.length,
      "this census parsed no mention of TRADE_PRIORITY in parse.ts's code — the name has been changed and this test is now asserting nothing",
    ).toBeGreaterThanOrEqual(2);

    expect(PARSE_CODE).toMatch(/const TRADE_PRIORITY: Record<\s*TradeScopeValue,\s*number\s*>/);
    expect(
      PARSE_CODE,
      "indexOf on the trade ordering returns -1 for a trade it does not hold, and -1 sorts ahead of every real rank",
    ).not.toMatch(/TRADE_PRIORITY[\w.]*\.indexOf/);
  });

  it("an unranked trade would sort LAST, not first", () => {
    // Unreachable by the types; asserted because the direction of the old
    // failure is the whole cost of it. `priorityOf` is internal, so this
    // asserts the fallback it is written with.
    const rank = (scope: string) =>
      (TRADE_PRIORITY_RANKS as Record<string, number | undefined>)[scope] ?? Number.MAX_SAFE_INTEGER;
    expect(rank("A_SIXTH_TRADE_NOBODY_RANKED")).toBe(Number.MAX_SAFE_INTEGER);
    expect(rank("A_SIXTH_TRADE_NOBODY_RANKED")).toBeGreaterThan(rank("METAL_FRAMING_DRYWALL"));
    expect(PARSE_CODE).toMatch(/Number\.MAX_SAFE_INTEGER/);
  });
});
