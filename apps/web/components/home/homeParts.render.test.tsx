import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyBlock, NeedsBlock, type MoneyFigures, type NeedItem } from "@/components/home/HomeParts";
import { billingNoun } from "@/components/job/jobStages";

// Guidelines review 2026-10-10. happy-dom does no layout, so these hold the
// markup only; the phone layout itself was measured in Chromium.
const item = (n: number): NeedItem => ({
  key: `k${n}`,
  tone: n === 0 ? "red" : "amber",
  text: `Invoice #${n} to Turner`,
  when: "overdue 12 days",
  whenTone: "danger",
  action: { label: "Chase", href: `/jobs/j${n}/billing` },
});

describe("NeedsBlock", () => {
  // Ten items: the block shows eight since the compact pass (2026-10-11),
  // so two go to "and N more".
  const html = renderToStaticMarkup(<NeedsBlock items={Array.from({ length: 10 }, (_, i) => item(i))} />);

  it("keeps the when on a phone — on its own line below sm, beside the text from sm up", () => {
    expect(html).toMatch(/class="block text-\[13px\] sm:hidden[^"]*">overdue 12 days</);
    expect(html).toMatch(/class="hidden whitespace-nowrap text-\[13px\] sm:inline[^"]*">overdue 12 days</);
  });

  it("says in words what the colour dot says", () => {
    expect(html).toContain('<span class="sr-only">Urgent: </span>');
    expect(html).toContain('<span class="sr-only">Needs a look: </span>');
  });

  it("'and N more' goes somewhere", () => {
    expect(html).toMatch(/<a [^>]*href="\/alerts"[^>]*>and 2 more on Alerts/);
  });

  it("row actions are 44px targets", () => {
    expect(html).toMatch(/<a class="inline-flex min-h-11[^"]*" href="\/jobs\/j0\/billing">Chase/);
  });
});

describe("MoneyBlock", () => {
  const figures = (filesMonthlyPayApps: boolean | null, overdueCount: number): MoneyFigures => ({
    month: "October",
    billed: 0,
    collected: 0,
    retainage: 0,
    overdue: 500,
    overdueCount,
    bill: billingNoun(filesMonthlyPayApps),
    outstanding: 1000,
  });

  // Polish round 2026-10-11: the card said "invoice" while Needs, the job
  // cards and the Billing tab all said "Pay app" for the same bill.
  it("counts overdue bills in the company's own word", () => {
    expect(renderToStaticMarkup(<MoneyBlock figures={figures(null, 1)} />)).toContain("Overdue · 1 pay app");
    expect(renderToStaticMarkup(<MoneyBlock figures={figures(true, 3)} />)).toContain("Overdue · 3 pay apps");
    expect(renderToStaticMarkup(<MoneyBlock figures={figures(false, 2)} />)).toContain("Overdue · 2 invoices");
  });
});
