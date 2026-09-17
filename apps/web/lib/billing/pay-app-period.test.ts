import { describe, expect, it } from "vitest";
import {
  PERIOD_NOT_RECORDED,
  parsePayAppPeriodTo,
  payAppHeaderDates,
  previousMonthEnd,
} from "./pay-app-period";
import { payApplicationInvoiceData } from "./pay-app-invoice-data";

/**
 * The G702 PERIOD TO date.
 *
 * A pay application states the period it covers at the top, and that is
 * the field a GC's accounting department keys on. This document printed
 * `Invoice.issuedAt` instead — `@default(now())`, the moment somebody
 * clicked Submit — so an application covering August, prepared on
 * 4 September, headlined 4 September. A controller called that a rejected
 * pay application and a 30-day delay on a job worth $400K-$2.4M.
 *
 * Two things are asserted here and they are the two that were wrong:
 * the entered date is what gets STORED and PRINTED, and an application
 * that has no period says so rather than falling back to the timestamp.
 * Both are mutation-tested — the fallback was reintroduced by hand and
 * these tests went red.
 */

// Deliberately far apart and on opposite sides of a month boundary: if any
// code path ever swapped one for the other, no assertion below could pass
// by coincidence.
const PERIOD_END = new Date("2026-08-31T00:00:00.000Z");
const SUBMITTED_AT = new Date("2026-09-04T19:30:00.000Z");

describe("parsePayAppPeriodTo", () => {
  it("stores the entered day at UTC midnight, exactly as typed", () => {
    const result = parsePayAppPeriodTo("2026-08-31");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("refuses a blank period rather than stamping one", () => {
    // The whole point of the column is that this date is entered. An
    // action that quietly defaulted it would be stamping a date on a
    // document a GC keys on, which is the defect, not the fix.
    const result = parsePayAppPeriodTo("   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/period ending date/i);
  });

  it("refuses a shape that would parse in the running timezone", () => {
    // `new Date("8/31/2026")` and `new Date("2026-08-31 00:00")` parse as
    // LOCAL midnight, which west of UTC stores the previous day. Refused
    // rather than silently shifted.
    for (const raw of ["8/31/2026", "2026-08-31 00:00", "Aug 31 2026", "2026-8-31"]) {
      expect(parsePayAppPeriodTo(raw).ok).toBe(false);
    }
  });

  it("refuses a well-formed but impossible day instead of rolling it forward", () => {
    // JS turns 2026-02-31 into 3 March without complaint.
    expect(parsePayAppPeriodTo("2026-02-31").ok).toBe(false);
  });
});

describe("payAppHeaderDates", () => {
  it("prints the entered period, not the submission timestamp", () => {
    const dates = payAppHeaderDates({ issuedAt: SUBMITTED_AT, periodTo: PERIOD_END }, "America/Los_Angeles");

    expect(dates.periodTo).toBe("Aug 31, 2026");
    expect(dates.periodRecorded).toBe(true);
    // The submission moment renders on the reader's calendar, separately
    // and under its own label. The two must never be the same string.
    expect(dates.applicationDate).toBe("Sep 4, 2026");
    expect(dates.periodTo).not.toBe(dates.applicationDate);
  });

  it("renders the period in UTC, so a calendar day is not a day early west of it", () => {
    const losAngeles = payAppHeaderDates({ issuedAt: SUBMITTED_AT, periodTo: PERIOD_END }, "America/Los_Angeles");
    const tokyo = payAppHeaderDates({ issuedAt: SUBMITTED_AT, periodTo: PERIOD_END }, "Asia/Tokyo");
    expect(losAngeles.periodTo).toBe("Aug 31, 2026");
    expect(tokyo.periodTo).toBe("Aug 31, 2026");
  });

  it("says not recorded on an application submitted before the column existed", () => {
    const dates = payAppHeaderDates({ issuedAt: SUBMITTED_AT, periodTo: null }, "America/Los_Angeles");

    expect(dates.periodTo).toBe(PERIOD_NOT_RECORDED);
    expect(dates.periodRecorded).toBe(false);
    // The failure this forbids, spelled out: `periodTo ?? issuedAt` would
    // print "Sep 4, 2026" here, a confident wrong PERIOD TO on a document
    // a GC keys off. Nothing about the issuedAt date may appear in the
    // period field.
    expect(dates.periodTo).not.toBe(dates.applicationDate);
    expect(dates.periodTo).not.toMatch(/2026/);
  });

  it("does not leave the period blank — a missing date has to read as missing", () => {
    const dates = payAppHeaderDates({ issuedAt: SUBMITTED_AT, periodTo: null }, "UTC");
    expect(dates.periodTo.trim().length).toBeGreaterThan(0);
  });
});

describe("previousMonthEnd", () => {
  it("defaults to the end of the month just finished", () => {
    expect(previousMonthEnd("2026-09-04")).toBe("2026-08-31");
    expect(previousMonthEnd("2026-09-30")).toBe("2026-08-31");
    expect(previousMonthEnd("2026-03-02")).toBe("2026-02-28");
  });

  it("crosses the year boundary rather than landing in month zero", () => {
    expect(previousMonthEnd("2026-01-05")).toBe("2025-12-31");
  });

  it("handles a leap February", () => {
    expect(previousMonthEnd("2028-03-01")).toBe("2028-02-29");
  });
});

describe("payApplicationInvoiceData", () => {
  const input = {
    jobId: "job_1",
    number: 3,
    description: "Application for payment #3",
    amount: "140000.00",
    dueAt: new Date("2026-10-04T00:00:00.000Z"),
    periodTo: PERIOD_END,
    retainageWithheld: "14000.00",
    rows: [{ lineItemId: "line_1", thisPeriodBilled: 140000, materialsStoredValue: 0 }],
  };

  it("writes the entered period onto the invoice", () => {
    const data = payApplicationInvoiceData(input);
    expect(data.periodTo).toBe(PERIOD_END);
  });

  it("never writes issuedAt, so the stored period cannot be the submit click", () => {
    // `issuedAt` is @default(now()). The insert must not set it and must
    // not carry any value that could end up in `periodTo`.
    const data = payApplicationInvoiceData(input);
    expect(Object.keys(data)).not.toContain("issuedAt");
    expect(data.periodTo).not.toBe(data.dueAt);
  });

  it("still carries the rest of the application unchanged", () => {
    const data = payApplicationInvoiceData(input);
    expect(data.number).toBe(3);
    expect(data.amount).toBe("140000.00");
    expect(data.retainageWithheld).toBe("14000.00");
    expect(data.lineItems).toEqual({
      create: [{ lineItemId: "line_1", thisPeriodBilled: "140000.00", materialsStoredValue: "0.00" }],
    });
  });
});
