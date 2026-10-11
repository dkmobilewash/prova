import { describe, expect, it } from "vitest";
import { greeting, hourIn, jobStage, nextAction, type ActionRights } from "./home-logic";

const ALL: ActionRights = { billing: true, field: true, jobs: true, estimating: true };
const NONE: ActionRights = { billing: false, field: false, jobs: false, estimating: false };

const base = {
  jobId: "j1",
  status: "IN_PROGRESS" as const,
  estimateStage: null,
  invoiceCount: 0,
  overdueInvoice: null,
  overdueRfi: null,
  scheduledToday: 0,
  rights: ALL,
};

describe("jobStage", () => {
  it.each([
    [{ status: "ESTIMATE", estimateStage: "NEEDS_PRICING", invoiceCount: 0 }, "Estimate"],
    [{ status: "ESTIMATE", estimateStage: "OUT_FOR_SIGNATURE", invoiceCount: 0 }, "Estimate"],
    [{ status: "ESTIMATE", estimateStage: "SIGNED", invoiceCount: 0 }, "Contract"],
    [{ status: "CONTRACTED", estimateStage: null, invoiceCount: 0 }, "Contract"],
    [{ status: "IN_PROGRESS", estimateStage: null, invoiceCount: 0 }, "Crew"],
    [{ status: "IN_PROGRESS", estimateStage: null, invoiceCount: 2 }, "Billing"],
    [{ status: "COMPLETE", estimateStage: null, invoiceCount: 5 }, "Closeout"],
  ] as const)("%o -> %s", (input, stage) => {
    expect(jobStage(input)).toBe(stage);
  });
});

describe("nextAction", () => {
  it("puts a late invoice first, as the primary button", () => {
    const action = nextAction({
      ...base,
      overdueInvoice: { number: 4, daysOverdue: 3 },
      overdueRfi: { number: 12 },
      scheduledToday: 5,
    });
    expect(action).toEqual({ label: "Chase invoice #4", href: "/jobs/j1/billing", primary: true });
  });

  it("never offers a billing action to someone without billing", () => {
    const action = nextAction({ ...base, overdueInvoice: { number: 4, daysOverdue: 1 }, rights: { ...NONE, field: true } });
    expect(action.href).not.toContain("billing");
  });

  it("then a late RFI, then today's hours", () => {
    expect(nextAction({ ...base, overdueRfi: { number: 12 }, scheduledToday: 2 }).label).toBe("Chase RFI 12");
    expect(nextAction({ ...base, scheduledToday: 2 })).toMatchObject({ label: "Log today's hours", href: "/jobs/j1/crew" });
  });

  it("follows the estimate's own stage", () => {
    const est = { ...base, status: "ESTIMATE" as const };
    expect(nextAction({ ...est, estimateStage: "NEEDS_PRICING" }).href).toBe("/jobs/j1/estimate");
    expect(nextAction({ ...est, estimateStage: "READY_TO_SEND" }).label).toBe("Send the proposal");
    expect(nextAction({ ...est, estimateStage: "SIGNED" }).label).toBe("Put a crew on it");
  });

  it("falls back to opening the job for a viewer with no rights", () => {
    expect(nextAction({ ...base, rights: NONE, overdueInvoice: { number: 1, daysOverdue: 9 } })).toEqual({
      label: "Open job",
      href: "/jobs/j1",
      primary: false,
    });
  });
});

describe("greeting", () => {
  it("reads the viewer's clock", () => {
    expect(greeting(6)).toBe("Good morning");
    expect(greeting(13)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
    // 15:00 UTC is 08:00 in Los Angeles in October.
    expect(hourIn("America/Los_Angeles", new Date("2026-10-10T15:00:00Z"))).toBe(8);
  });
});
