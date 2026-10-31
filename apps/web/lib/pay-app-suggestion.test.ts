import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculatePayAppLineItem, calculatePayAppSummary } from "./pay-application";
import { suggestFromInstalled, suggestThisPeriod } from "./pay-app-suggestion";

const line = (over = {}) => ({
  scheduledValue: 60000,
  previousBilled: 20000,
  materialsStoredToDate: 0,
  budgeted: 200,
  logged: [{ day: "2026-09-30", amount: 80 }, { day: "2026-10-20", amount: 40 }],
  ...over,
});

describe("what is suggested", () => {
  it("takes hours over budget, less what is already billed, and says where it came from", () => {
    expect(suggestThisPeriod(line(), "2026-10-31")).toEqual({
      amount: 16000,
      text: "Suggested $16,000.00 from hours: 120 of 200 budgeted hours through 2026-10-31, 60.0%.",
    });
  });

  it("counts only hours through the period-to date", () => {
    expect(suggestThisPeriod(line({ previousBilled: 0 }), "2026-09-30")?.amount).toBe(24000);
    expect(suggestThisPeriod(line({ previousBilled: 0 }), "2026-10-20")?.amount).toBe(36000);
  });

  it("allows for material stored on the line, as the percent box does", () => {
    expect(suggestThisPeriod(line({ materialsStoredToDate: 5000 }), "2026-10-31")?.amount).toBe(11000);
  });

  it("never suggests past the line's value when hours overrun the budget", () => {
    const over = suggestThisPeriod(line({ logged: [{ day: "2026-10-01", amount: 300 }] }), "2026-10-31");
    expect(over?.amount).toBe(40000);
    expect(over?.text).toContain("over budget, so held at 100%");
  });

  it("suggests no amount, and says why, when the line is already billed that far", () => {
    const behind = suggestThisPeriod(line({ previousBilled: 50000 }), "2026-10-31");
    expect(behind?.amount).toBeNull();
    expect(behind?.text).toContain("Nothing suggested from hours");
    expect(behind?.text).not.toMatch(/\$-|-\$/);
  });

  it.each([
    ["no budget", line({ budgeted: null })],
    ["a zero budget", line({ budgeted: 0 })],
    ["no hours", line({ logged: [] })],
    ["no contract value", line({ scheduledValue: 0 })],
  ])("stays silent on %s", (_, input) => {
    expect(suggestThisPeriod(input, "2026-10-31")).toBeNull();
  });

  it("stays silent before a period is known, and on hours all after it", () => {
    expect(suggestThisPeriod(line(), "")).toBeNull();
    expect(suggestThisPeriod(line(), "2026-09-01")).toBeNull();
  });

  it("adds hours without float dust", () => {
    const dust = suggestThisPeriod(line({ logged: [{ day: "2026-10-01", amount: 0.1 }, { day: "2026-10-01", amount: 0.2 }] }), "2026-10-31");
    expect(dust?.text).toContain("0.3 of 200");
  });
});

describe("the G702 is not touched", () => {
  const source = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

  it("is out of reach of the billing math and the action that saves it", () => {
    for (const path of ["lib/pay-application.ts", "lib/pay-application-query.ts", "lib/actions/billing.ts"]) {
      expect(source(path), path).not.toMatch(/pay-app-suggestion|suggestThisPeriod/);
    }
  });

  it("leaves the certificate at figures worked out by hand", () => {
    const line = (scheduledValue: number, previousBilled: number, thisPeriodBilled: number, materialsStoredValue: number) =>
      calculatePayAppLineItem({ lineItemId: "l", description: "d", scheduledValue, previousBilled, thisPeriodBilled, previousMaterialsStored: 0, materialsStoredValue });
    const rows = [line(60000, 20000, 15000, 0), line(15000, 3000, 3000, 1000), line(25000, 0, 5000, 0), line(5000, 0, 0, 0)];
    expect(
      calculatePayAppSummary({ lineItems: rows, previousRetainageWithheld: 2300, thisPeriodRetainageWithheld: 2400 }),
    ).toMatchObject({
      contractSumToDate: 105000,
      totalCompletedAndStoredToDate: 47000,
      retainageToDate: 4700,
      totalEarnedLessRetainage: 42300,
      previousCertificatesForPayment: 20700,
      currentPaymentDue: 21600,
    });
  });
});

describe("the suggestion from installed quantities", () => {
  const billed = { scheduledValue: 15000, previousBilled: 3000, materialsStoredToDate: 0 };
  const progress = { quantity: 10000, unit: "SF", logged: [{ day: "2026-09-30", amount: 2000 }, { day: "2026-10-20", amount: 2000 }, { day: "2026-11-05", amount: 1000 }] };

  it("takes installed over the line's quantity, less what is billed, through the period", () => {
    expect(suggestFromInstalled(billed, progress, "2026-10-31")).toEqual({
      amount: 3000,
      text: "Suggested $3,000.00 from installed qty: 4,000 of 10,000 SF through 2026-10-31, 40.0%.",
    });
  });

  it("holds at 100% when more is recorded than the line carries", () => {
    const over = suggestFromInstalled(billed, { ...progress, logged: [{ day: "2026-10-01", amount: 12000 }] }, "2026-10-31");
    expect(over?.amount).toBe(12000);
    expect(over?.text).toContain("over the line's quantity, so held at 100%");
  });

  it("says nothing is suggested when the line is billed past it", () => {
    expect(suggestFromInstalled({ ...billed, previousBilled: 9000 }, progress, "2026-10-31")).toMatchObject({ amount: null });
  });

  it("stays silent with no unit line, nothing installed by then, or no date", () => {
    expect(suggestFromInstalled(billed, undefined, "2026-10-31")).toBeNull();
    expect(suggestFromInstalled(billed, progress, "2026-09-01")).toBeNull();
    expect(suggestFromInstalled(billed, progress, "")).toBeNull();
  });
});
