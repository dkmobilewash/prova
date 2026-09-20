import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";
import { JOB_FUNCTIONS, type JobFunctionValue } from "@/lib/permissions";

/**
 * The tenant-isolation half of the job page's rebuild into routes.
 *
 * Every one of the eight `/jobs/[id]/*` routes now runs its OWN
 * `requireJob`/`requireJobGivenContext` call rather than sharing one
 * `prisma.job.findUnique` at the top of a single file — the whole point
 * of the split. That means the one check standing between "this job is
 * mine" and "this job belongs to a company I am not in" is now load-
 * bearing on all eight doors instead of one, and a bug in it is a
 * cross-tenant data leak, not a cosmetic miss. Tested here rather than
 * trusted from the old page's own history: the old page never had this
 * check run eight times over eight different fetches.
 *
 * `jobCapabilities` is tested too, even though it is a thin pass-through
 * over `can()` (already exhaustively tested in permissions.test.ts) —
 * because it is the ONE place every tab's money/field/billing visibility
 * is now derived from (`page-money-guards.test.ts` pins every tab to
 * importing it), so a mistake in the four-line mapping here would be
 * silently wrong on all eight routes at once.
 */

let db = new FakeDb();

const OWNER_COMPANY = { id: "co_owner", role: "OWNER", jobFunction: null as string | null };

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@prova/db", () => ({
  get prisma() {
    return db.client();
  },
}));

let currentUser: { id: string; role: string; jobFunction: string | null; companyId: string } = {
  id: "user_1",
  role: "MEMBER",
  jobFunction: null,
  companyId: "co_mine",
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({
    company: { id: currentUser.companyId, name: "Mine LLC" },
    id: currentUser.id,
    role: currentUser.role,
    jobFunction: currentUser.jobFunction,
  }),
}));

const { requireJob, requireJobGivenContext, jobCapabilities } = await import("./job-access");

beforeEach(() => {
  db = new FakeDb();
  currentUser = { id: "user_1", role: "MEMBER", jobFunction: null, companyId: "co_mine" };
});

describe("requireJob", () => {
  it("returns the job, company and principal when the job is this company's", async () => {
    db.seed("job", { id: "job_1", companyId: "co_mine", name: "West Wing", status: "IN_PROGRESS" });
    const result = await requireJob("job_1");
    expect(result.job).toEqual({ id: "job_1", companyId: "co_mine", name: "West Wing", status: "IN_PROGRESS" });
    expect(result.company.id).toBe("co_mine");
    expect(result.principal).toEqual({ role: "MEMBER", jobFunction: null });
  });

  it("is notFound, never the row, for a job that does not exist", async () => {
    await expect(requireJob("job_ghost")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is notFound, never the row, for a job belonging to a DIFFERENT company — the tenant-isolation case", async () => {
    db.seed("job", { id: "job_theirs", companyId: "co_other", name: "Their Job", status: "ESTIMATE" });
    await expect(requireJob("job_theirs")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("requireJobGivenContext", () => {
  // A minimal stand-in for `requireCompanyContext`'s real return shape
  // (the full Company row plus the signed-in user) — only the fields
  // `requireJobGivenContext` actually reads matter for this test, so the
  // rest are asserted away rather than typed out in full.
  const context = {
    company: { id: "co_mine", name: "Mine LLC" },
    id: "user_1",
    role: "MEMBER",
    jobFunction: null as string | null,
  } as Parameters<typeof requireJobGivenContext>[1];

  it("returns the job when it belongs to the given context's company", async () => {
    db.seed("job", { id: "job_1", companyId: "co_mine", name: "West Wing", status: "IN_PROGRESS" });
    const result = await requireJobGivenContext("job_1", context);
    expect(result.job.id).toBe("job_1");
    expect(result.company.id).toBe("co_mine");
  });

  it("is notFound for a job belonging to a different company, same as requireJob", async () => {
    db.seed("job", { id: "job_theirs", companyId: "co_other", name: "Their Job", status: "ESTIMATE" });
    await expect(requireJobGivenContext("job_theirs", context)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("jobCapabilities", () => {
  it("gives an owner every flag, whatever their job function says", () => {
    expect(jobCapabilities(OWNER_COMPANY)).toEqual({
      showsJobMoney: true,
      showsBilling: true,
      showsField: true,
      showsJobManagement: true,
    });
  });

  it("gives a member with no job function set every flag — nobody loses anything by this feature existing", () => {
    expect(jobCapabilities({ role: "MEMBER", jobFunction: null })).toEqual({
      showsJobMoney: true,
      showsBilling: true,
      showsField: true,
      showsJobManagement: true,
    });
  });

  it("withholds job money and billing from a FIELD member, and keeps field/jobs visible", () => {
    expect(jobCapabilities({ role: "MEMBER", jobFunction: "FIELD" })).toEqual({
      showsJobMoney: false,
      showsBilling: false,
      showsField: true,
      showsJobManagement: true,
    });
  });

  it("gives an ESTIMATOR job cost but not billing or field", () => {
    expect(jobCapabilities({ role: "MEMBER", jobFunction: "ESTIMATOR" })).toEqual({
      showsJobMoney: true,
      showsBilling: false,
      showsField: false,
      showsJobManagement: true,
    });
  });

  it("gives ACCOUNTING billing and job cost but not field", () => {
    expect(jobCapabilities({ role: "MEMBER", jobFunction: "ACCOUNTING" })).toEqual({
      showsJobMoney: true,
      showsBilling: true,
      showsField: false,
      showsJobManagement: false,
    });
  });

  it("agrees with can() for every job function — no second, drifting copy of the capability map", async () => {
    const { can } = await import("@/lib/permissions");
    for (const fn of JOB_FUNCTIONS as readonly JobFunctionValue[]) {
      const principal = { role: "MEMBER", jobFunction: fn as string | null };
      const flags = jobCapabilities(principal);
      expect(flags.showsJobMoney).toBe(can(principal, "VIEW_JOB_COSTS"));
      expect(flags.showsBilling).toBe(can(principal, "MANAGE_BILLING"));
      expect(flags.showsField).toBe(can(principal, "MANAGE_FIELD"));
      expect(flags.showsJobManagement).toBe(can(principal, "MANAGE_JOBS"));
    }
  });
});
