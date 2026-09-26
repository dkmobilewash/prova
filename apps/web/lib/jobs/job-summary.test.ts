/**
 * The job header's "Crew" figure agrees with the hours logged under it.
 *
 * Found on a preview: "Crew 0 people" on a job where a crew member had 35.3
 * hours this month. The figure counted JobAssignment rows, a user-only table
 * nobody has to fill in before logging time — and crew members, who have no
 * login, cannot be in it at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let jobRow: Record<string, unknown> | null = null;
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => "2026-09-26" }));
vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: { job: { findUnique: async () => jobRow } },
}));

const { crewHeadcount, loadJobSummary } = await import("./job-summary");

function job(overrides: Record<string, unknown>) {
  return {
    id: "job1",
    companyId: "co1",
    name: "Northgate Clinic TI",
    status: "IN_PROGRESS",
    startDate: null,
    endDate: null,
    substantialCompletionDate: null,
    contact: { name: "GC" },
    lineItems: [],
    invoices: [],
    retainageReleases: [],
    assignments: [],
    timeEntries: [],
    // The two later lifecycle stages. Present and empty rather than
    // absent: the loader selects them, so a fixture without them is a
    // fixture of a shape Prisma never returns.
    closeoutSubmissions: [],
    warrantyPeriod: null,
    ...overrides,
  };
}

describe("crewHeadcount", () => {
  it("counts a crew member who logged hours, with nobody assigned", () => {
    expect(crewHeadcount({ assignedUserIds: [], timeEntryWorkers: [{ employeeUserId: null, crewMemberId: "luis" }] })).toBe(1);
  });

  it("counts someone assigned who has not logged anything yet", () => {
    expect(crewHeadcount({ assignedUserIds: ["u1"], timeEntryWorkers: [] })).toBe(1);
  });

  it("counts each person once, whether assigned, logged, or both", () => {
    expect(
      crewHeadcount({
        assignedUserIds: ["u1", "u2"],
        timeEntryWorkers: [
          { employeeUserId: "u1", crewMemberId: null },
          { employeeUserId: "u1", crewMemberId: null },
          { employeeUserId: null, crewMemberId: "luis" },
          { employeeUserId: null, crewMemberId: "luis" },
        ],
      }),
    ).toBe(3);
  });

  it("never merges a user and a crew member who happen to share an id", () => {
    expect(
      crewHeadcount({ assignedUserIds: ["x"], timeEntryWorkers: [{ employeeUserId: null, crewMemberId: "x" }] }),
    ).toBe(2);
  });
});

describe("loadJobSummary", () => {
  beforeEach(() => {
    jobRow = null;
  });

  it("reports the crew member with logged hours on a job with no assignments (was 0)", async () => {
    jobRow = job({ timeEntries: [{ employeeUserId: null, crewMemberId: "luis" }] });
    expect((await loadJobSummary("co1", "job1"))?.crewSize).toBe(1);
  });

  it("still counts assignments", async () => {
    jobRow = job({ assignments: [{ userId: "u1" }, { userId: "u2" }] });
    expect((await loadJobSummary("co1", "job1"))?.crewSize).toBe(2);
  });
});
