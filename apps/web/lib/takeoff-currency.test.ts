import { describe, expect, it } from "vitest";

import {
  planCurrency,
  takeoffCurrency,
  undatedAddenda,
  type IssuedRevision,
  type MeasuredPlan,
  type PricedScopeAddendum,
} from "./takeoff-currency";

const plan = (over: Partial<MeasuredPlan> & Pick<MeasuredPlan, "id">): MeasuredPlan => ({
  fileName: "A2.1 floor plan.pdf",
  revisionLabel: "Rev 2",
  sheetIssuedOn: "2026-09-10",
  measurementCount: 12,
  ...over,
});

const revision = (over: Partial<IssuedRevision> & Pick<IssuedRevision, "id">): IssuedRevision => ({
  label: "Rev 3",
  setName: "Architectural",
  issuedOn: "2026-09-20",
  description: null,
  ...over,
});

const addendum = (
  over: Partial<PricedScopeAddendum> & Pick<PricedScopeAddendum, "id">,
): PricedScopeAddendum => ({
  reference: "Addendum 3",
  issuedOn: "2026-09-20",
  impactNote: null,
  ...over,
});

describe("a plan measured off superseded paper is named, never re-measured", () => {
  it("THE DEFECT THIS EXISTS FOR: quantities off drawings that have since moved", () => {
    const result = planCurrency(plan({ id: "p" }), [revision({ id: "r" })], []);
    expect(result.state).toBe("SUPERSEDED");
    expect(result.sentence).toContain("12 measurements");
    expect(result.sentence).toContain("Rev 2");
    expect(result.sentence).toContain("Architectural Rev 3");
    expect(result.sentence).toContain("nothing here re-measures anything");
  });

  it("names every later issue, newest first", () => {
    const result = planCurrency(
      plan({ id: "p" }),
      [
        revision({ id: "r1", label: "Rev 3", issuedOn: "2026-09-15" }),
        revision({ id: "r2", label: "Rev 4", issuedOn: "2026-09-22" }),
      ],
      [],
    );
    expect(result.supersededBy.map((item) => item.label)).toEqual([
      "Architectural Rev 4",
      "Architectural Rev 3",
    ]);
  });

  it("counts an addendum that changed priced work as superseding too", () => {
    const result = planCurrency(plan({ id: "p" }), [], [addendum({ id: "a" })]);
    expect(result.state).toBe("SUPERSEDED");
    expect(result.supersededBy[0].kind).toBe("ADDENDUM");
    expect(result.sentence).toContain("Addendum 3");
  });

  it("is CURRENT when nothing has been issued since", () => {
    const result = planCurrency(
      plan({ id: "p", sheetIssuedOn: "2026-09-25" }),
      [revision({ id: "r", issuedOn: "2026-09-20" })],
      [addendum({ id: "a", issuedOn: "2026-09-01" })],
    );
    expect(result.state).toBe("CURRENT");
    expect(result.supersededBy).toEqual([]);
    expect(result.sentence).toContain("Nothing has been issued since");
  });

  it("SAME DAY is not superseded — a sheet and its transmittal share a date", () => {
    // Otherwise this cries wolf on essentially every plan, and a warning
    // that fires always is a warning nobody reads.
    const result = planCurrency(
      plan({ id: "p", sheetIssuedOn: "2026-09-20" }),
      [revision({ id: "r", issuedOn: "2026-09-20" })],
      [],
    );
    expect(result.state).toBe("CURRENT");
  });
});

describe("no issue date is UNKNOWABLE, not current", () => {
  it("refuses to call an undated plan current", () => {
    // Calling it current is the dangerous half of the guess. It is neither —
    // the posture bid-outcome.ts takes toward an unfinished job.
    const result = planCurrency(plan({ id: "p", sheetIssuedOn: null }), [revision({ id: "r" })], []);
    expect(result.state).toBe("UNKNOWABLE");
    expect(result.supersededBy).toEqual([]);
    expect(result.sentence).toContain("No issue date recorded");
    expect(result.sentence).toContain("title block");
  });

  it("says so even when nothing has been issued at all", () => {
    const result = planCurrency(plan({ id: "p", sheetIssuedOn: null }), [], []);
    expect(result.state).toBe("UNKNOWABLE");
  });

  it("falls back to the file name when there is no revision label", () => {
    const result = planCurrency(
      plan({ id: "p", sheetIssuedOn: null, revisionLabel: null }),
      [],
      [],
    );
    expect(result.sentence).toContain("A2.1 floor plan.pdf");
  });
});

describe("an addendum with no issue date cannot supersede anything", () => {
  it("is not counted against a plan", () => {
    const result = planCurrency(plan({ id: "p" }), [], [addendum({ id: "a", issuedOn: null })]);
    expect(result.state).toBe("CURRENT");
  });

  it("is REPORTED separately rather than silently dropped", () => {
    // It cannot be said to supersede a sheet, and cannot be said not to.
    // Dropping it quietly is the one option that would be wrong.
    expect(
      undatedAddenda([
        addendum({ id: "a", reference: "Addendum 4", issuedOn: null }),
        addendum({ id: "b", reference: "Addendum 5" }),
      ]),
    ).toEqual(["Addendum 4"]);
  });
});

describe("the job-level headline", () => {
  it("totals the measurements sitting on superseded paper", () => {
    const result = takeoffCurrency(
      [
        plan({ id: "p1", measurementCount: 12 }),
        plan({ id: "p2", measurementCount: 5 }),
        plan({ id: "p3", measurementCount: 99, sheetIssuedOn: "2026-09-30" }),
      ],
      [revision({ id: "r" })],
      [],
    );
    expect(result.supersededCount).toBe(2);
    // The current plan's 99 must NOT be counted.
    expect(result.measurementsAtRisk).toBe(17);
    expect(result.headline).toContain("17 measurements");
    expect(result.headline).toContain("Nothing has been re-measured");
  });

  it("falls back to the undated case when nothing is superseded", () => {
    const result = takeoffCurrency([plan({ id: "p", sheetIssuedOn: null })], [], []);
    expect(result.supersededCount).toBe(0);
    expect(result.unknowableCount).toBe(1);
    expect(result.headline).toContain("no issue date");
  });

  it("is SILENT when every plan is current and dated", () => {
    const result = takeoffCurrency(
      [plan({ id: "p", sheetIssuedOn: "2026-09-30" })],
      [revision({ id: "r", issuedOn: "2026-09-20" })],
      [],
    );
    expect(result.headline).toBeNull();
  });

  it("is silent on a job with no measured plans at all", () => {
    expect(takeoffCurrency([], [revision({ id: "r" })], []).headline).toBeNull();
  });

  it("prefers the superseded headline over the undated one", () => {
    // A superseded plan is a stronger claim than an undated one, and two
    // banners would compete for the same attention.
    const result = takeoffCurrency(
      [plan({ id: "p1" }), plan({ id: "p2", sheetIssuedOn: null })],
      [revision({ id: "r" })],
      [],
    );
    expect(result.headline).toContain("superseded");
    expect(result.unknowableCount).toBe(1);
  });
});
