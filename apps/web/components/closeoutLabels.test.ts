import { describe, expect, it } from "vitest";
import {
  type CloseoutItemData,
  type ServiceRequestData,
  type WarrantyPeriodData,
  addMonths,
  daysOfWarrantyLeft,
  daysToResolve,
  isCloseoutComplete,
  isOpen,
  outstandingRequired,
  responsibilityLabel,
  warrantyExpiry,
  warrantyState,
  warrantyStateLabel,
  wasInWarranty,
} from "@/components/closeoutLabels";

function item(o: Partial<CloseoutItemData> & { name: string }): CloseoutItemData {
  return {
    id: `i-${o.name}`,
    isRequired: true,
    completedOn: null,
    note: null,
    documentUrl: null,
    documentName: null,
    ...o,
  };
}

function request(o: Partial<ServiceRequestData> & { reportedOn: string }): ServiceRequestData {
  return {
    id: `r-${o.reportedOn}`,
    description: "crack",
    reportedBy: null,
    responsibility: "UNDETERMINED",
    resolvedOn: null,
    resolutionNote: null,
    ...o,
  };
}

const period = (o: Partial<WarrantyPeriodData> = {}): WarrantyPeriodData => ({
  startsOn: "2026-03-01",
  months: 12,
  note: null,
  ...o,
});

describe("closeout completeness", () => {
  // The dangerous default. An empty checklist asserts nothing, so it must
  // not report "complete" — that's the state someone would quote while
  // chasing final payment.
  it("is NOT complete when there is no checklist at all", () => {
    expect(isCloseoutComplete([])).toBe(false);
  });

  it("is not complete while a required item is outstanding", () => {
    expect(
      isCloseoutComplete([
        item({ name: "Final lien waiver", completedOn: "2026-08-01" }),
        item({ name: "As-builts" }),
      ]),
    ).toBe(false);
  });

  it("is complete when every required item has a date", () => {
    expect(
      isCloseoutComplete([
        item({ name: "Final lien waiver", completedOn: "2026-08-01" }),
        item({ name: "As-builts", completedOn: "2026-08-03" }),
      ]),
    ).toBe(true);
  });

  // Optional items are tracked but must not hold closeout open.
  it("ignores incomplete OPTIONAL items", () => {
    expect(
      isCloseoutComplete([
        item({ name: "Final lien waiver", completedOn: "2026-08-01" }),
        item({ name: "Nice-to-have", isRequired: false }),
      ]),
    ).toBe(true);
  });

  it("is not complete when only optional items exist", () => {
    expect(isCloseoutComplete([item({ name: "Nice-to-have", isRequired: false })])).toBe(false);
  });

  it("lists only outstanding required items", () => {
    const out = outstandingRequired([
      item({ name: "A", completedOn: "2026-08-01" }),
      item({ name: "B" }),
      item({ name: "C", isRequired: false }),
    ]);
    expect(out.map((i) => i.name)).toEqual(["B"]);
  });
});

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(addMonths("2026-03-01", 12)).toBe("2027-03-01");
    expect(addMonths("2026-01-15", 6)).toBe("2026-07-15");
  });

  // JavaScript's Date rolls a month overflow FORWARD: 31 Aug + 6 months
  // would land on 3 March. That silently extends a warranty past what the
  // contract says.
  it("clamps to the end of the target month instead of rolling forward", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("handles a leap-year February", () => {
    expect(addMonths("2027-08-31", 6)).toBe("2028-02-29");
  });

  it("crosses a year boundary", () => {
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("warrantyState", () => {
  it("is NONE when no warranty was recorded", () => {
    expect(warrantyState(null, "2026-08-29")).toBe("NONE");
  });

  it("is ACTIVE inside the period", () => {
    expect(warrantyState(period(), "2026-08-29")).toBe("ACTIVE");
  });

  // Boundary: the expiry day itself is still covered. An off-by-one here
  // hands back a callback the contract actually covers.
  it("is ACTIVE on the expiry date itself", () => {
    expect(warrantyState(period(), warrantyExpiry(period()))).toBe("ACTIVE");
  });

  it("is EXPIRED the day after", () => {
    expect(warrantyState(period(), "2027-03-02")).toBe("EXPIRED");
  });

  it("labels every state", () => {
    expect(warrantyStateLabel("NONE")).toBe("No warranty recorded");
    expect(warrantyStateLabel("ACTIVE")).toBe("In warranty");
    expect(warrantyStateLabel("EXPIRED")).toBe("Warranty expired");
  });
});

describe("daysOfWarrantyLeft", () => {
  it("is null with no warranty or an expired one", () => {
    expect(daysOfWarrantyLeft(null, "2026-08-29")).toBeNull();
    expect(daysOfWarrantyLeft(period(), "2027-06-01")).toBeNull();
  });

  it("counts days remaining", () => {
    expect(daysOfWarrantyLeft(period(), "2027-02-27")).toBe(2);
  });

  it("is 0 on the expiry date, not null", () => {
    expect(daysOfWarrantyLeft(period(), "2027-03-01")).toBe(0);
  });
});

describe("wasInWarranty", () => {
  it("is false when no warranty was recorded", () => {
    expect(wasInWarranty(request({ reportedOn: "2026-09-01" }), null)).toBe(false);
  });

  it("is true for a call reported inside the period", () => {
    expect(wasInWarranty(request({ reportedOn: "2026-09-01" }), period())).toBe(true);
  });

  it("is false for a call reported after expiry", () => {
    expect(wasInWarranty(request({ reportedOn: "2027-04-01" }), period())).toBe(false);
  });

  it("is false for a call reported before the warranty started", () => {
    expect(wasInWarranty(request({ reportedOn: "2026-02-01" }), period())).toBe(false);
  });

  // Judged by the REPORTED date. A call raised in warranty stays in
  // warranty however long the fix takes — otherwise a slow repair would
  // quietly move the cost onto us.
  it("judges by the reported date, not the resolved date", () => {
    const late = request({ reportedOn: "2027-02-28", resolvedOn: "2027-09-01" });
    expect(wasInWarranty(late, period())).toBe(true);
  });

  it("includes both boundary days", () => {
    expect(wasInWarranty(request({ reportedOn: "2026-03-01" }), period())).toBe(true);
    expect(wasInWarranty(request({ reportedOn: "2027-03-01" }), period())).toBe(true);
  });
});

describe("service request helpers", () => {
  it("is open until resolved", () => {
    expect(isOpen(request({ reportedOn: "2026-09-01" }))).toBe(true);
    expect(isOpen(request({ reportedOn: "2026-09-01", resolvedOn: "2026-09-05" }))).toBe(false);
  });

  it("counts days to resolve, or days open so far", () => {
    expect(daysToResolve(request({ reportedOn: "2026-09-01", resolvedOn: "2026-09-05" }), "2026-09-20")).toBe(4);
    expect(daysToResolve(request({ reportedOn: "2026-09-01" }), "2026-09-20")).toBe(19);
  });

  it("is null rather than negative when the dates are the wrong way round", () => {
    expect(daysToResolve(request({ reportedOn: "2026-09-10", resolvedOn: "2026-09-01" }), "2026-09-20")).toBeNull();
  });

  it("labels responsibility in plain language", () => {
    expect(responsibilityLabel("UNDETERMINED")).toBe("Not decided yet");
    expect(responsibilityLabel("OURS")).toBe("Ours to put right");
    expect(responsibilityLabel("NOT_OURS")).toBe("Not ours");
  });
});
