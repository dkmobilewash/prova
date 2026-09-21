import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordNumberTerm } from "./providers";

/**
 * A pasted phone number must not become an `Int` filter.
 *
 * Four providers (RFI, submittal, change order, invoice) let a digit-only
 * search term match a record NUMBER. Each did it the same way:
 *
 *     const numberMatch = terms.find((term) => /^\d+$/.test(term));
 *     ...(numberMatch ? [{ number: Number(numberMatch) }] : []),
 *
 * Paste a phone number into the box and that term is ten digits —
 * 5551234567 — which is past Postgres `integer` (2147483647), the type
 * Prisma's `Int` maps to and the only range those columns can hold.
 *
 * WHAT IS AND IS NOT ESTABLISHED HERE, because the difference matters and
 * the original report asserted the stronger claim. That the guard is
 * CORRECT is established: a value outside the column's range cannot equal
 * any row, so the filter could only ever return nothing. That it THREW is
 * NOT established — reproducing it needs a live Postgres and none was
 * reachable from this branch (`prisma migrate`-less container, no local
 * server), and Prisma's own range check could not be isolated because the
 * connection failure fires first. So this file tests the range rule, not
 * an exception; the panel-hang fix in `panel.ts` and `lib/actions/search.ts`
 * covers the consequence either way, and does not depend on this cause.
 */

/** Postgres `integer`. Written here as a literal, independently of the
 * constant in providers.ts, so a typo there cannot agree with itself. */
const PG_INT_MAX = 2147483647;

const terms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

describe("recordNumberTerm", () => {
  it("drops a pasted phone number instead of filtering on it", () => {
    expect(recordNumberTerm(terms("5551234567"))).toBeNull();
    expect(recordNumberTerm(terms("15551234567"))).toBeNull();
    expect(recordNumberTerm(terms("call 5551234567 about the RFI"))).toBeNull();
  });

  it("holds the boundary exactly at what the column can store", () => {
    expect(recordNumberTerm([String(PG_INT_MAX)])).toBe(PG_INT_MAX);
    expect(recordNumberTerm([String(PG_INT_MAX + 1)])).toBeNull();
  });

  it("drops a digit string long enough to lose precision as a double", () => {
    // Number("99999999999999999999") is 1e20 — not the number that was
    // typed. Filtering on a value the user never entered is its own bug.
    expect(recordNumberTerm(["99999999999999999999"])).toBeNull();
  });

  it("still finds the record numbers this feature exists for", () => {
    // THE CONTROL. A guard that returned null for everything would satisfy
    // every assertion above and silently remove the feature.
    expect(recordNumberTerm(terms("12"))).toBe(12);
    expect(recordNumberTerm(terms("rfi 42"))).toBe(42);
    expect(recordNumberTerm(terms("submittal 007"))).toBe(7);
    expect(recordNumberTerm(terms("1"))).toBe(1);
  });

  it("returns null when the query asks for no number at all", () => {
    expect(recordNumberTerm(terms("riverside remodel"))).toBeNull();
    expect(recordNumberTerm([])).toBeNull();
    expect(recordNumberTerm(terms("rfi-12"))).toBeNull(); // not a digit-only term
  });

  it("ignores zero, which no counter ever issues", () => {
    expect(recordNumberTerm(["0"])).toBeNull();
    expect(recordNumberTerm(["000"])).toBeNull();
  });
});

describe("every numeric provider filter goes through it", () => {
  it("leaves no inline Number() on a digit term in providers.ts", () => {
    // The size/scope pin for this fix: four call sites were identical, and
    // four identical call sites is exactly how three of them get fixed.
    // Read off the file rather than trusted, so a fifth provider copying
    // its neighbour fails here instead of in production.
    const source = readFileSync(new URL("./providers.ts", import.meta.url), "utf8");

    const inline = [...source.matchAll(/number:\s*Number\(/g)];
    expect(inline.map((m) => m[0]), "a provider is still building an Int filter with a bare Number()").toEqual([]);

    const guarded = [...source.matchAll(/recordNumberTerm\(terms\)/g)].length;
    const filters = [...source.matchAll(/\{\s*number:\s*numberMatch\s*\}/g)].length;
    // Vacuity floor first: if these patterns stop matching, "no inline
    // Number()" above passes on an empty file.
    expect(guarded, "no provider calls recordNumberTerm — has it been renamed?").toBeGreaterThanOrEqual(4);
    expect(filters, "every recordNumberTerm call should feed exactly one number filter").toBe(guarded);
  });
});
