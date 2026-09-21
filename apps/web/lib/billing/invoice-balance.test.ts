import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoiceBalanceState } from "./invoice-balance";

/**
 * The credit that announced itself as PAID IN FULL, in green, on two pages
 * — one of them the GC portal.
 */
describe("invoiceBalanceState", () => {
  it("does not call a credit paid in full", () => {
    // The reproduction: the −$5,000.00 invoice a release-without-its-
    // positive produced. balance is −5000, which `balance <= 0` read as
    // settled.
    const state = invoiceBalanceState(-5000, 0);
    expect(state.settled).toBe(false);
    expect(state.label).not.toMatch(/paid in full/i);
    expect(state.label).toContain("$5,000.00");
    expect(state.label).toMatch(/credit/i);
  });

  it("still says paid in full for the ordinary settled invoice", () => {
    const state = invoiceBalanceState(12000, 12000);
    expect(state).toEqual({ label: "Paid in full", settled: true, outstanding: 0 });
  });

  it("names the outstanding balance on a part-paid invoice", () => {
    const state = invoiceBalanceState(12000, 4500);
    expect(state.settled).toBe(false);
    expect(state.label).toBe("Balance $7,500.00");
  });

  it("separates an overpayment from a settled invoice", () => {
    // Both were "Paid in full" before. A GC paying $12,500 against a
    // $12,000 invoice is not the same event as paying it exactly, and the
    // difference is somebody's to act on.
    const state = invoiceBalanceState(12000, 12500);
    expect(state.settled).toBe(false);
    expect(state.label).toBe("Overpaid by $500.00");
  });

  it("tolerates half a cent, because these are Decimal columns through JS numbers", () => {
    expect(invoiceBalanceState(1000.35, 1000.3500000001).settled).toBe(true);
    expect(invoiceBalanceState(-0.001, 0).settled).toBe(true);
  });

  it("offers no 'log a payment' on a credit", () => {
    // `outstanding` is what the billing tab gates that form on. A GC does
    // not pay a credit, and offering the form against one invites a payment
    // row that makes the correction look settled.
    expect(invoiceBalanceState(-5000, 0).outstanding).toBeLessThan(0);
    expect(invoiceBalanceState(12000, 4500).outstanding).toBe(7500);
  });

  it("reads the credit off the AMOUNT, not the balance", () => {
    // A credit the GC has somehow had a payment recorded against still has
    // to read as a credit: balance would be −$5,500 here, which is the
    // "overpaid" branch, and that would be the wrong sentence about the
    // wrong document.
    expect(invoiceBalanceState(-5000, 500).label).toMatch(/credit/i);
  });
});

/**
 * Static guards on the two call sites. Neither page is rendered here, so
 * what these catch is the realistic regression: somebody restoring the
 * `balance <= 0` ternary, which is what both files carried.
 */
/** Comments stripped before scanning, the same rule
 * `ownerRefusalCensus.test.ts` follows after #185 — where a comment quoting
 * the pattern it explained disarmed a census. This file met the mirror
 * image on its first run: the line each page now carries recording what it
 * used to say ("`balance <= 0 ? \"Paid in full\"` until 2026-09-21") is the
 * exact string being searched for, so the check failed on the note about
 * the fix. A scan that reads comments is answering a question about prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const read = (path: string) => stripComments(readFileSync(join(process.cwd(), path), "utf8"));

describe("the pages that render an invoice's money line", () => {
  for (const path of [
    "app/(app)/jobs/[id]/(tabs)/billing/page.tsx",
    "app/portal/[token]/jobs/[jobId]/page.tsx",
  ]) {
    it(`${path} decides through invoiceBalanceState`, () => {
      const source = read(path);
      // The CALL, not the import: an import left behind while the ternary
      // came back would satisfy a bare name check and prove nothing.
      expect(source).toContain("invoiceBalanceState(Number(invoice.amount), paid)");
      // Green is spent on `settled` and on nothing else.
      expect(source).toContain("state.settled ?");
      // The exact expression that was wrong on both, so restoring it fails
      // here rather than on a GC's screen.
      expect(source).not.toContain('balance <= 0 ? "Paid in full"');
      expect(source).not.toMatch(/\bconst balance\b/);
    });
  }
});
