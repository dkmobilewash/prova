// The two fringe-schedule guardrails, unit-tested where they can be run
// locally (the dbtest suite covers the same ground against real Postgres,
// but only CI can run it — #171 — and a guard that was never watched
// failing is this repo's signature defect).
//
// 1. deleteFringeRateSchedule's usage check (#199): a schedule whose
//    effective window contains any of the company's own hours for that
//    craft cannot be deleted, because certified payroll and fringe
//    remittance recompute their rates from it LIVE — there is no stored FK
//    to count, so the window membership IS the usage signal.
// 2. loadRemittance's schedule query carries `companyId` directly rather
//    than relying on the craft join being transitively scoped — wage,
//    pension, H&W and training rates are the numbers on the cheque.

import { beforeEach, describe, expect, it, vi } from "vitest";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const { state, prismaStub, principal } = vi.hoisted(() => {
  const store = {
    schedule: null as null | {
      id: string;
      companyId: string;
      craftClassificationId: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    },
    timeEntryCount: 0,
    /** Every `where` the stub was handed, so a test can assert the QUERY
     * SHAPE — the defect in both halves of this file is a missing filter,
     * which no return-value assertion can see. */
    countWhere: null as unknown,
    scheduleFindManyWhere: null as unknown,
    deleted: [] as string[],
  };
  const stub = {
    fringeRateSchedule: {
      findFirst: async ({ where }: { where: { id: string; companyId: string } }) =>
        store.schedule && store.schedule.id === where.id && store.schedule.companyId === where.companyId
          ? store.schedule
          : null,
      findMany: async ({ where }: { where: unknown }) => {
        store.scheduleFindManyWhere = where;
        return [];
      },
      delete: async ({ where }: { where: { id: string } }) => {
        store.deleted.push(where.id);
        return store.schedule;
      },
    },
    timeEntry: {
      count: async ({ where }: { where: unknown }) => {
        store.countWhere = where;
        return store.timeEntryCount;
      },
      findMany: async () => [],
    },
    complianceDocument: { findMany: async () => [] },
  };
  return {
    state: store,
    prismaStub: stub,
    principal: {
      id: "user-owner",
      name: "Rosa Delgado" as string | null,
      email: "rosa@ridgeline.test",
      role: "OWNER" as string,
      jobFunction: null as string | null,
      company: { id: "company-1" },
    },
  };
});

vi.mock("@prova/db", () => ({ prisma: prismaStub, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => principal }));

import { deleteFringeRateSchedule } from "./unionCompliance";
import { loadRemittance } from "../union-compliance-query";

const SCHEDULE = {
  id: "sched-1",
  companyId: "company-1",
  craftClassificationId: "craft-1",
  effectiveFrom: utc("2026-01-01"),
  effectiveTo: utc("2026-06-30") as Date | null,
};

beforeEach(() => {
  state.schedule = { ...SCHEDULE };
  state.timeEntryCount = 0;
  state.countWhere = null;
  state.scheduleFindManyWhere = null;
  state.deleted = [];
  principal.role = "OWNER";
  principal.company.id = "company-1";
});

describe("deleteFringeRateSchedule's usage check (#199)", () => {
  it("refuses while any of the company's hours fall inside the window, and deletes nothing", async () => {
    // The defect this guards: the delete used to be unconditional, so an
    // owner could remove the schedule that priced already-filed weeks and
    // every later recomputation of them silently changed.
    state.timeEntryCount = 3;
    const result = await deleteFringeRateSchedule("sched-1");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain("3 time entries");
      expect(result.error).toContain("End the schedule instead");
    }
    expect(state.deleted).toEqual([]);
  });

  it("deletes when the window priced no hours — the data-entry-mistake case stays available", async () => {
    state.timeEntryCount = 0;
    expect(await deleteFringeRateSchedule("sched-1")).toEqual({ ok: true });
    expect(state.deleted).toEqual(["sched-1"]);
  });

  it("counts ONLY this company's hours, this craft, inside the window", async () => {
    // Asserted on the query shape because the failure mode is a missing
    // filter: an unscoped count would refuse company A's delete because
    // company B worked those dates.
    state.timeEntryCount = 1;
    await deleteFringeRateSchedule("sched-1");
    expect(state.countWhere).toEqual({
      craftClassificationId: "craft-1",
      job: { companyId: "company-1" },
      date: { gte: SCHEDULE.effectiveFrom, lte: SCHEDULE.effectiveTo },
    });
  });

  it("treats an open-ended schedule as pricing everything from effectiveFrom on", async () => {
    // The defect: reusing the bounded-window where would put `lte: null`
    // in the query, which Prisma treats as a filter — hours after
    // effectiveFrom would stop counting and the delete would sail through.
    state.schedule = { ...SCHEDULE, effectiveTo: null };
    state.timeEntryCount = 1;
    const result = await deleteFringeRateSchedule("sched-1");
    expect(result).toMatchObject({ ok: false });
    expect(state.countWhere).toEqual({
      craftClassificationId: "craft-1",
      job: { companyId: "company-1" },
      date: { gte: SCHEDULE.effectiveFrom },
    });
  });

  it("still refuses non-owners before counting anything", async () => {
    principal.role = "MEMBER";
    const result = await deleteFringeRateSchedule("sched-1");
    expect(result).toMatchObject({ ok: false });
    expect(state.countWhere).toBeNull();
    expect(state.deleted).toEqual([]);
  });
});

describe("loadRemittance's schedule query is company-scoped directly", () => {
  it("passes companyId in the where, not only the craft join", async () => {
    // The defect: `where: { craftClassificationId: { in: craftIds } }`
    // alone — transitively scoped through the craft ids coming from this
    // company's entries, which holds exactly until a craft tag is ever
    // wrong. Rates are the numbers on the cheque; the direct filter makes
    // the scoping unconditional. (#200 added the column.)
    await loadRemittance("company-1", "2026-08");
    expect(state.scheduleFindManyWhere).toMatchObject({ companyId: "company-1" });
  });
});
