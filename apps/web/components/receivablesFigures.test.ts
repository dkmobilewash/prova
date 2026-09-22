import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReceivablesFigures } from "@/components/ReceivablesPanel";
import type { OverdueInvoice } from "@/lib/today-dashboard";

/**
 * THE THREE FIGURES ON THE RECEIVABLES PANEL HAVE TO ADD UP.
 *
 * They did not. `outstanding` comes from `arBalanceFor`, which is NET of
 * retainage — retainage is not due until substantial completion, so it is
 * not something the GC is late on — while `Invoiced` and `Paid` are gross.
 * On an invoice of $100,000 with $85,000 paid and $10,000 retainage that
 * printed as $100,000 / $85,000 / $5,000, with the $5,000 bolded and
 * nothing anywhere on the panel naming the missing $10,000.
 *
 * /cash-flow captions the identical figure correctly (`retainageExcluded`
 * on the AR aging summary, with its own written rationale), so this was
 * two surfaces disagreeing about the same subtraction — the exact failure
 * the due-date rule has already produced twice on these two screens.
 *
 * A bookkeeper tying this out concludes the app is broken. She is not
 * wrong to: three numbers that do not reconcile, and no fourth number to
 * reconcile them with.
 *
 * WHAT THIS FILE ASSERTS is the reconciliation itself, read back out of
 * the rendered markup rather than recomputed from the fixture. Asserting
 * that some retainage string appears would pass on a panel that printed
 * the right words next to the wrong number.
 */

/** Every dollar figure in the markup, in the order it is printed. */
function dollars(html: string): number[] {
  return [...html.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, "")));
}

const invoice = (over: Partial<OverdueInvoice> = {}): OverdueInvoice => ({
  id: "inv_1",
  jobId: "job_1",
  jobName: "Maple Street Medical",
  gcName: "Harbor Builders",
  number: 3,
  amount: 100_000,
  paid: 85_000,
  retainageWithheld: 10_000,
  // What arBalanceFor returns for the three figures above: gross less
  // retainage less paid. Written as a literal on purpose — importing the
  // function to compute it would make this test agree with the code by
  // construction instead of checking the page.
  outstanding: 5_000,
  dueOn: "2026-08-01",
  dueIsDerived: false,
  daysOverdue: 12,
  ...over,
});

const render = (row: OverdueInvoice) =>
  renderToStaticMarkup(createElement(ReceivablesFigures, { row }));

describe("the receivables panel's figures", () => {
  it("reconciles: invoiced less retainage less paid is what it calls outstanding", () => {
    const html = render(invoice());
    const figures = dollars(html);
    // Sanity that anything rendered at all — an empty match list would make
    // every assertion below vacuously true.
    expect(figures.length).toBeGreaterThanOrEqual(4);

    const [invoiced, paid, retainage, outstanding] = figures;
    expect(invoiced).toBe(100_000);
    expect(paid).toBe(85_000);
    expect(retainage).toBe(10_000);
    expect(outstanding).toBe(5_000);
    expect(invoiced - retainage - paid).toBe(outstanding);
    // And the retainage figure has to be labelled, not merely present.
    expect(html).toContain("Retainage withheld");
  });

  it("explains a balance that is entirely retainage rather than showing a bare zero", () => {
    // The settled-net invoice: the GC has paid everything he owes today,
    // and $10,000 is held back until substantial completion. This row
    // reaches the panel from /cash-flow's own link, so the panel has to be
    // able to say why nothing is outstanding on a $100,000 invoice.
    const html = render(invoice({ paid: 90_000, outstanding: 0 }));
    const [invoiced, paid, retainage, outstanding] = dollars(html);
    expect(invoiced - retainage - paid).toBe(outstanding);
    expect(outstanding).toBe(0);
    expect(html).toContain("substantial completion");
  });

  it("prints no retainage line for an invoice that has no retainage clause", () => {
    // Null is "these contract terms have no retainage clause", which is not
    // the same as a clause that withheld nothing — and a $0.00 line on an
    // invoice with no clause is a fourth number to wonder about.
    const html = render(invoice({ paid: 40_000, retainageWithheld: null, outstanding: 60_000 }));
    expect(html).not.toContain("Retainage withheld");
    const [invoiced, paid, outstanding] = dollars(html);
    expect(invoiced - paid).toBe(outstanding);
  });

  it("prints the line when a clause withheld nothing this period", () => {
    // Zero WITH a clause is a real fact: the rate applies and this invoice
    // took none. Silence there reads as "no retainage on this job".
    const html = render(invoice({ paid: 40_000, retainageWithheld: 0, outstanding: 60_000 }));
    expect(html).toContain("Retainage withheld");
    const [invoiced, paid, retainage, outstanding] = dollars(html);
    expect(retainage).toBe(0);
    expect(invoiced - retainage - paid).toBe(outstanding);
  });
});
