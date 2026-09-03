import { describe, expect, it } from "vitest";
import {
  commitmentLabel,
  commitmentsByLineItem,
  isOverdue,
  jobCommitmentSummary,
  type CommitmentOrder,
} from "./open-commitments";

const TODAY = new Date("2026-09-01T00:00:00.000Z");

const order = (over: Partial<CommitmentOrder> = {}): CommitmentOrder => ({
  orderId: "o1",
  lineItemId: "line-a",
  number: 1,
  vendorName: "Ace Building Supply",
  description: "5/8 Type X, 120 sheets",
  promisedFor: new Date("2026-09-10T00:00:00.000Z"),
  completed: false,
  ...over,
});

describe("overdue", () => {
  it("is late once the promised day has passed", () => {
    expect(isOverdue(order({ promisedFor: new Date("2026-08-28T00:00:00.000Z") }), TODAY)).toBe(true);
  });

  it("is not late on the promised day itself", () => {
    // Dates here are stored at UTC midnight, so "due today" is not yet late.
    // Off by one in this direction tells a foreman material is late on the
    // morning it is due to arrive.
    expect(isOverdue(order({ promisedFor: TODAY }), TODAY)).toBe(false);
  });

  it("is never late without a promised date", () => {
    // Guessing one manufactures a late delivery out of missing data.
    expect(isOverdue(order({ promisedFor: null }), TODAY)).toBe(false);
  });

  it("is never late once the order is complete", () => {
    expect(
      isOverdue(order({ completed: true, promisedFor: new Date("2026-01-01T00:00:00.000Z") }), TODAY),
    ).toBe(false);
  });
});

describe("grouping by scope line", () => {
  it("counts open orders and names their vendors once each", () => {
    const result = commitmentsByLineItem(
      [
        order({ orderId: "o1", vendorName: "Ace" }),
        order({ orderId: "o2", vendorName: "Ace" }),
        order({ orderId: "o3", vendorName: "Coastal Gypsum" }),
      ],
      TODAY,
    );
    const line = result.get("line-a")!;
    expect(line.openCount).toBe(3);
    expect(line.vendors).toEqual(["Ace", "Coastal Gypsum"]);
  });

  it("drops completed orders", () => {
    const result = commitmentsByLineItem(
      [order({ orderId: "o1", completed: true }), order({ orderId: "o2" })],
      TODAY,
    );
    expect(result.get("line-a")!.openCount).toBe(1);
  });

  it("A PARTIAL DELIVERY DOES NOT CLOSE AN ORDER", () => {
    // `completed` is only true when a delivery was marked as completing the
    // order. A load arriving short is the exact case this feature exists to
    // surface, and treating the first truck as the end of it hides that.
    const shortDelivery = order({ completed: false });
    expect(commitmentsByLineItem([shortDelivery], TODAY).get("line-a")!.openCount).toBe(1);
  });

  it("keeps the SOONEST outstanding promise, not the latest", () => {
    const result = commitmentsByLineItem(
      [
        order({ orderId: "o1", promisedFor: new Date("2026-09-20T00:00:00.000Z") }),
        order({ orderId: "o2", promisedFor: new Date("2026-09-04T00:00:00.000Z") }),
      ],
      TODAY,
    );
    expect(result.get("line-a")!.nextPromisedFor?.toISOString().slice(0, 10)).toBe("2026-09-04");
  });

  it("does not attribute an order nobody attributed", () => {
    // A costing row claiming an unattributed order would be inventing the
    // attribution the person declined to make.
    const result = commitmentsByLineItem([order({ lineItemId: null })], TODAY);
    expect(result.size).toBe(0);
  });

  it("separates lines rather than pooling them", () => {
    const result = commitmentsByLineItem(
      [order({ orderId: "o1", lineItemId: "line-a" }), order({ orderId: "o2", lineItemId: "line-b" })],
      TODAY,
    );
    expect(result.get("line-a")!.openCount).toBe(1);
    expect(result.get("line-b")!.openCount).toBe(1);
  });
});

describe("the job total", () => {
  it("counts unattributed orders separately, because no row can show them", () => {
    const summary = jobCommitmentSummary(
      [
        order({ orderId: "o1", lineItemId: "line-a" }),
        order({ orderId: "o2", lineItemId: null }),
        order({ orderId: "o3", lineItemId: null, completed: true }),
      ],
      TODAY,
    );
    expect(summary.openCount).toBe(2);
    expect(summary.unattributedCount).toBe(1);
  });

  it("counts overdue across the whole job", () => {
    const summary = jobCommitmentSummary(
      [
        order({ orderId: "o1", promisedFor: new Date("2026-08-01T00:00:00.000Z") }),
        order({ orderId: "o2", promisedFor: new Date("2026-12-01T00:00:00.000Z") }),
      ],
      TODAY,
    );
    expect(summary.overdueCount).toBe(1);
  });
});

describe("the row label", () => {
  it("says nothing when there is nothing to say", () => {
    // "0 orders" on every line of a job that buys no material is noise.
    expect(commitmentLabel(undefined)).toBeNull();
    expect(
      commitmentLabel({ openCount: 0, overdueCount: 0, nextPromisedFor: null, vendors: [] }),
    ).toBeNull();
  });

  it("leads with overdue when anything is late", () => {
    expect(
      commitmentLabel({
        openCount: 3,
        overdueCount: 1,
        nextPromisedFor: new Date("2026-09-04T00:00:00.000Z"),
        vendors: ["Ace"],
      }),
    ).toBe("3 orders open · 1 overdue");
  });

  it("singularises", () => {
    expect(
      commitmentLabel({
        openCount: 1,
        overdueCount: 0,
        nextPromisedFor: new Date("2026-09-04T00:00:00.000Z"),
        vendors: ["Ace"],
      }),
    ).toBe("1 order open · due 2026-09-04");
  });

  it("admits when nothing was promised rather than implying a date", () => {
    expect(
      commitmentLabel({ openCount: 2, overdueCount: 0, nextPromisedFor: null, vendors: ["Ace"] }),
    ).toBe("2 orders open · no promised date");
  });
});
