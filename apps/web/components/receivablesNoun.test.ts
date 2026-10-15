import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OverdueInvoice } from "@/lib/today-dashboard";

/**
 * Home's receivables say the company's own word for a bill.
 *
 * The Money card on the same page says "Pay app" (billingNoun), and the
 * receivables rows under it said "Invoice 3" for the same record — one bill,
 * two names, one screen. The provider now takes filesMonthlyPayApps and the
 * rows and drawer read the noun from it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const { ReceivablesProvider, ReceivablesList } = await import("@/components/ReceivablesPanel");

const row: OverdueInvoice = {
  id: "inv_1",
  jobId: "job_1",
  jobName: "Maple Street Medical",
  gcName: "Harbor Builders",
  number: 3,
  amount: 100_000,
  paid: 85_000,
  retainageWithheld: 10_000,
  outstanding: 5_000,
  dueOn: "2026-08-01",
  dueIsDerived: false,
  daysOverdue: 12,
};

function render(filesMonthlyPayApps: boolean | null, rows: OverdueInvoice[] = [row]) {
  return renderToStaticMarkup(
    // .test.ts has no JSX; see empty-state-links.test.ts for why children is a prop.
    // eslint-disable-next-line react/no-children-prop
    createElement(ReceivablesProvider, {
      rows,
      invoicesRaised: rows.length ? 1 : 0,
      filesMonthlyPayApps,
      children: createElement(ReceivablesList),
    }),
  );
}

describe("the receivables rows name a bill the way Home does", () => {
  it("says Pay app for a company that files monthly pay apps (and when unanswered)", () => {
    for (const answer of [true, null]) {
      const html = render(answer);
      expect(html).toContain("Pay app 3");
      expect(html).not.toContain("Invoice 3");
    }
  });

  it("says Invoice for a company that invoices", () => {
    const html = render(false);
    expect(html).toContain("Invoice 3");
    expect(html).not.toContain("Pay app 3");
  });

  it("uses the same word in the empty state", () => {
    expect(render(true, [])).toContain("No pay apps raised yet");
    expect(render(false, [])).toContain("No invoices raised yet");
  });
});
