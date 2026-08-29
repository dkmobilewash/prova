import { describe, expect, it } from "vitest";
import {
  type DeliveryData,
  closingDelivery,
  daysBetween,
  daysLate,
  isLate,
  orderState,
  stateLabel,
} from "@/components/materialOrderLabels";

function delivery(overrides: Partial<DeliveryData> & { deliveredOn: string }): DeliveryData {
  return {
    id: `d-${overrides.deliveredOn}`,
    completesOrder: false,
    notes: null,
    ...overrides,
  };
}

describe("orderState", () => {
  it("is AWAITING when nothing has shown up", () => {
    expect(orderState([])).toBe("AWAITING");
  });

  it("is PARTIAL when something arrived but nothing closed the order", () => {
    expect(orderState([delivery({ deliveredOn: "2026-08-12" })])).toBe("PARTIAL");
  });

  it("is COMPLETE once a delivery closes the order out", () => {
    expect(
      orderState([
        delivery({ deliveredOn: "2026-08-12" }),
        delivery({ deliveredOn: "2026-08-15", completesOrder: true }),
      ]),
    ).toBe("COMPLETE");
  });

  // The closing delivery is not necessarily the last one in the array —
  // a mis-dated delivery recorded afterwards would sort later. State must
  // come from the flag, never from array position.
  it("is COMPLETE even when the closing delivery is not last in the list", () => {
    expect(
      orderState([
        delivery({ deliveredOn: "2026-08-15", completesOrder: true }),
        delivery({ deliveredOn: "2026-08-18" }),
      ]),
    ).toBe("COMPLETE");
  });

  it("labels every state", () => {
    expect(stateLabel(orderState([]))).toBe("Nothing here yet");
    expect(stateLabel(orderState([delivery({ deliveredOn: "2026-08-12" })]))).toBe("Partly delivered");
    expect(
      stateLabel(orderState([delivery({ deliveredOn: "2026-08-12", completesOrder: true })])),
    ).toBe("Delivered");
  });
});

describe("closingDelivery", () => {
  it("returns null when the order is still open", () => {
    expect(closingDelivery([delivery({ deliveredOn: "2026-08-12" })])).toBeNull();
  });

  it("returns the delivery that closed the order", () => {
    const closing = delivery({ deliveredOn: "2026-08-15", completesOrder: true });
    expect(closingDelivery([delivery({ deliveredOn: "2026-08-12" }), closing])).toBe(closing);
  });
});

describe("isLate", () => {
  const TODAY = "2026-08-28";

  // The documented rule: nobody committed to a date, so there is nothing
  // to be late against. Inventing one would manufacture lateness no vendor
  // ever agreed to.
  it("is never late when no date was promised, however old the order", () => {
    expect(isLate([], null, TODAY)).toBe(false);
    expect(isLate([delivery({ deliveredOn: "2026-01-01" })], null, TODAY)).toBe(false);
  });

  it("is late when the promised date has passed and the order is still open", () => {
    expect(isLate([], "2026-08-20", TODAY)).toBe(true);
    expect(isLate([delivery({ deliveredOn: "2026-08-22" })], "2026-08-20", TODAY)).toBe(true);
  });

  it("is not late once the order is complete, even long past the promised date", () => {
    expect(
      isLate([delivery({ deliveredOn: "2026-08-25", completesOrder: true })], "2026-08-20", TODAY),
    ).toBe(false);
  });

  // Boundary: promised *for* today is not yet late. An off-by-one here
  // would flag every order red on the morning it was due.
  it("is not late on the promised date itself", () => {
    expect(isLate([], TODAY, TODAY)).toBe(false);
  });

  it("is late the day after the promised date", () => {
    expect(isLate([], "2026-08-27", TODAY)).toBe(true);
  });
});

describe("daysLate", () => {
  const TODAY = "2026-08-28";

  // Null rather than 0, so the row can never render "Late by 0 days".
  it("is null when the order is not late", () => {
    expect(daysLate([], null, TODAY)).toBeNull();
    expect(daysLate([], TODAY, TODAY)).toBeNull();
    expect(
      daysLate([delivery({ deliveredOn: "2026-08-25", completesOrder: true })], "2026-08-20", TODAY),
    ).toBeNull();
  });

  it("counts whole days past the promised date", () => {
    expect(daysLate([], "2026-08-20", TODAY)).toBe(8);
    expect(daysLate([], "2026-08-27", TODAY)).toBe(1);
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-08-10", "2026-08-20")).toBe(10);
    expect(daysBetween("2026-08-10", "2026-08-11")).toBe(1);
    expect(daysBetween("2026-08-10", "2026-08-10")).toBe(0);
  });

  it("crosses month and year boundaries", () => {
    expect(daysBetween("2026-08-30", "2026-09-02")).toBe(3);
    expect(daysBetween("2025-12-30", "2026-01-02")).toBe(3);
  });

  // Parsed at UTC midnight on both ends, so a clock change in the user's
  // timezone cannot make a span come out 23 or 25 hours and round wrong.
  // 2026-03-08 is the US DST switch.
  it("is unaffected by a daylight-saving change", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1);
  });

  it("goes negative when the dates are the wrong way round", () => {
    expect(daysBetween("2026-08-20", "2026-08-10")).toBe(-10);
  });
});
