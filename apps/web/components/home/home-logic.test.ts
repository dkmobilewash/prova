import { describe, expect, it } from "vitest";
import { backchargeNeeds, greeting, hourIn, jobStage, nextAction, type ActionRights } from "./home-logic";

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
    expect(action).toEqual({ label: "Chase pay app #4", href: "/jobs/j1/billing", primary: true });
    // A company that said it sends invoices, not pay apps, reads its own word.
    const late = { ...base, overdueInvoice: { number: 4, daysOverdue: 3 }, billNoun: "invoice" };
    expect(nextAction(late).label).toBe("Chase invoice #4");
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

/**
 * Backcharges near their objection deadline on Home's "Needs you today".
 * They were on /alerts and /backcharges and missing from the one list read
 * every morning — and the deadline to object in writing is the cheapest
 * money on a job to lose.
 */
describe("backchargeNeeds", () => {
  const TODAY = "2026-10-12";
  const bc = (over: Partial<Parameters<typeof backchargeNeeds>[0][number]>) => ({
    id: "bc_1",
    number: 4,
    jobName: "Oak Ave",
    status: "RECEIVED",
    respondByDate: "2026-10-20" as string | null,
    ...over,
  });

  it("lists past-due (red) and within-14-days (amber) ones, soonest first, linking to the row", () => {
    const items = backchargeNeeds(
      [
        bc({ id: "soon", number: 2, respondByDate: "2026-10-20" }),
        bc({ id: "late", number: 1, respondByDate: "2026-10-09" }),
        bc({ id: "edge", number: 3, respondByDate: "2026-10-26" }),
      ],
      TODAY,
    );
    expect(items.map((i) => i.key)).toEqual(["bc-late", "bc-soon", "bc-edge"]);
    expect(items[0]).toMatchObject({ tone: "red", when: "overdue 3 days", whenTone: "danger" });
    expect(items[1]).toMatchObject({ tone: "amber", when: "8 days left" });
    expect(items[1].action).toEqual({ label: "Answer", href: "/backcharges#soon" });
    expect(items[1].text).toBe("Object to backcharge 2 — Oak Ave");
  });

  it("leaves out one 15+ days off, an answered one, and one with no deadline", () => {
    expect(
      backchargeNeeds(
        [
          bc({ respondByDate: "2026-10-27" }),
          bc({ status: "DISPUTED", respondByDate: "2026-10-01" }),
          bc({ respondByDate: null }),
        ],
        TODAY,
      ),
    ).toEqual([]);
  });
});
