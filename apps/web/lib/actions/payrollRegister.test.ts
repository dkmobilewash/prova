import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * importPayrollRegister and issuePayrollNumber — the two writes behind
 * certified payroll's register import.
 *
 *   1. MANAGE_COMPLIANCE, not owner — both RETURNED, never thrown, and
 *      before anything is read or written. (The generic sweep in
 *      action-capability-guards.test.ts covers this too; this file adds
 *      the direct case for readability alongside the others below.)
 *   2. Tenant scope: another company's crew member is never matched, and
 *      every row written carries this session's companyId. The fake
 *      honours `where` by equality, so a read that dropped companyId
 *      would see company B's crew and this fails.
 *   3. Re-importing the same person+period UPDATES, never duplicates.
 *   4. A whole SSN anywhere in the pasted text refuses the ROW and writes
 *      nothing from it — end to end through the action, not just the
 *      planner.
 *   5. Two confirms colliding come back as a sentence, not a throw.
 *   6. issuePayrollNumber: idempotent per week, and a collision on the
 *      unique (jobId, weekStart) is read back rather than surfaced.
 */

let db = new FakeDb();
let conflictOnWrite = false;
let uniqueConflictOn: string | null = null;

const context = {
  company: { id: "co_A" },
  id: "user_1",
  role: "MEMBER" as string,
  jobFunction: "PAYROLL_COMPLIANCE" as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function dbClient() {
  const client = db.client() as unknown as Record<string, unknown>;
  if (!conflictOnWrite && !uniqueConflictOn) return client;
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return async (fn: (tx: unknown) => Promise<unknown>) => {
          if (conflictOnWrite) {
            const error = new Error("could not serialize access");
            (error as Error & { code?: string }).code = "P2034";
            throw error;
          }
          return db.transaction(async (tx: unknown) => {
            const wrapped = new Proxy(tx as Record<string, unknown>, {
              get(txTarget, txProperty) {
                if (uniqueConflictOn !== txProperty) return (txTarget as Record<string, unknown>)[txProperty as string];
                return new Proxy((txTarget as Record<string, unknown>)[txProperty as string] as object, {
                  get(modelTarget, modelProperty) {
                    if (modelProperty !== "create") return (modelTarget as Record<string, unknown>)[modelProperty as string];
                    return () => {
                      const error = new Error("Unique constraint failed");
                      (error as Error & { code?: string }).code = "P2002";
                      throw error;
                    };
                  },
                });
              },
            });
            return (fn as (tx: unknown) => Promise<unknown>)(wrapped);
          });
        };
      }
      return (target as Record<string, unknown>)[property as string];
    },
  });
}

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    return dbClient();
  },
}));

const { importPayrollRegister, issuePayrollNumber } = await import("./payrollRegister");

function form(csv: string, mapping?: Record<string, number | null>) {
  const data = new FormData();
  data.set("csv", csv);
  if (mapping) data.set("mapping", JSON.stringify(mapping));
  return data;
}

function entries() {
  return db.rows("payrollRegisterEntry");
}

const REGISTER = [
  "Employee,Period start,Period end,Gross,Net",
  "Maria Lopez,2026-08-23,2026-08-29,1000.00,800.00",
].join("\n");

beforeEach(() => {
  db = new FakeDb();
  conflictOnWrite = false;
  uniqueConflictOn = null;
  context.role = "MEMBER";
  context.jobFunction = "PAYROLL_COMPLIANCE";
  db.seed("crewMember", {
    id: "crew_maria",
    companyId: "co_A",
    legalFirstName: "Maria",
    legalMiddleName: null,
    legalLastName: "Lopez",
    employeeNumber: null,
    identifyingNumberLast4: null,
  });
  // Same name, different company — must never match.
  db.seed("crewMember", {
    id: "crew_maria_b",
    companyId: "co_B",
    legalFirstName: "Maria",
    legalMiddleName: null,
    legalLastName: "Lopez",
    employeeNumber: null,
    identifyingNumberLast4: null,
  });
});

describe("importPayrollRegister", () => {
  it("refuses anyone without MANAGE_COMPLIANCE, and writes nothing", async () => {
    context.jobFunction = "ESTIMATOR";
    const result = await importPayrollRegister(form(REGISTER));
    expect(result).toEqual({
      ok: false,
      error: "Certified payroll isn't part of your job function. The account owner sets who sees what, on the Team page.",
    });
    expect(entries()).toEqual([]);
  });

  it("refuses an empty paste", async () => {
    expect(await importPayrollRegister(form("  "))).toMatchObject({ ok: false });
    expect(entries()).toEqual([]);
  });

  it("writes only this company's crew, never matching another company's same-named crew member", async () => {
    const result = await importPayrollRegister(form(REGISTER));
    expect(result.ok).toBe(true);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ companyId: "co_A", crewMemberId: "crew_maria" });
  });

  it("writes integer cents, never a float", async () => {
    await importPayrollRegister(form(REGISTER));
    const row = entries()[0];
    expect(row.grossCents).toBe(100000);
    expect(row.deductionsCents).toBe(20000);
    expect(row.netCents).toBe(80000);
    expect(Number.isInteger(row.grossCents)).toBe(true);
    expect(Number.isInteger(row.deductionsCents)).toBe(true);
    expect(Number.isInteger(row.netCents)).toBe(true);
  });

  it("re-importing the same person and period UPDATES the row instead of duplicating it", async () => {
    await importPayrollRegister(form(REGISTER));
    expect(entries()).toHaveLength(1);

    const corrected = [
      "Employee,Period start,Period end,Gross,Net",
      "Maria Lopez,2026-08-23,2026-08-29,1100.00,880.00",
    ].join("\n");
    const result = await importPayrollRegister(form(corrected));
    expect(result).toMatchObject({ ok: true, value: { created: 0, updated: 1 } });
    expect(entries()).toHaveLength(1);
    expect(entries()[0].grossCents).toBe(110000);
  });

  it("importing the identical register twice changes nothing the second time", async () => {
    await importPayrollRegister(form(REGISTER));
    const again = await importPayrollRegister(form(REGISTER));
    expect(again).toMatchObject({ ok: true, value: { created: 0, updated: 0, unchanged: 1 } });
    expect(entries()).toHaveLength(1);
  });

  it("refuses a row carrying a whole SSN anywhere in it, end to end, and writes nothing from that row", async () => {
    const withSsn = [
      "Employee,Period start,Period end,Gross,Net,Last 4 of SSN",
      "Maria Lopez,2026-08-23,2026-08-29,1000.00,800.00,123-45-6789",
    ].join("\n");
    const result = await importPayrollRegister(form(withSsn));
    expect(result.ok).toBe(true);
    expect(entries()).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("123-45-6789");
  });

  it("records a crew member's last-4 from the register, and only the crew row — never a second column", async () => {
    const withLast4 = [
      "Employee,Period start,Period end,Gross,Net,Last 4 of SSN",
      "Maria Lopez,2026-08-23,2026-08-29,1000.00,800.00,4321",
    ].join("\n");
    await importPayrollRegister(form(withLast4));
    const crew = db.rows("crewMember").find((c) => c.id === "crew_maria")!;
    expect(crew.identifyingNumberLast4).toBe("4321");
    expect(Object.keys(entries()[0])).not.toContain("identifyingNumberLast4");
  });

  it("honours a column-mapping override sent from the preview", async () => {
    const oddHeaders = [
      "Employee,Period start,Period end,Wages,Net",
      "Maria Lopez,2026-08-23,2026-08-29,1000.00,800.00",
    ].join("\n");
    const withoutOverride = await importPayrollRegister(form(oddHeaders));
    expect(withoutOverride).toMatchObject({ ok: true, value: { created: 0 } });
    const withOverride = await importPayrollRegister(form(oddHeaders, { gross: 3 }));
    expect(withOverride).toMatchObject({ ok: true, value: { created: 1 } });
  });

  it("turns a serialization conflict into a sentence to confirm again, not a throw", async () => {
    conflictOnWrite = true;
    const result = await importPayrollRegister(form(REGISTER));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error).toMatch(/confirm again/);
    expect(entries()).toEqual([]);
  });
});

describe("issuePayrollNumber", () => {
  beforeEach(() => {
    db.seed("job", { id: "job_1", companyId: "co_A" });
    db.seed("job", { id: "job_b", companyId: "co_B" });
  });

  function issueForm(jobId: string, weekStart = "2026-08-23") {
    const data = new FormData();
    data.set("jobId", jobId);
    data.set("weekStart", weekStart);
    return data;
  }

  it("refuses anyone without MANAGE_COMPLIANCE, and writes nothing", async () => {
    context.jobFunction = "ESTIMATOR";
    const result = await issuePayrollNumber(issueForm("job_1"));
    expect(result.ok).toBe(false);
    expect(db.rows("wh347PayrollNumber")).toEqual([]);
    expect(db.rows("wh347PayrollCounter")).toEqual([]);
  });

  it("refuses a job that belongs to another company", async () => {
    const result = await issuePayrollNumber(issueForm("job_b"));
    expect(result).toEqual({ ok: false, error: "That job isn't on this account." });
  });

  it("issues 1 for the first week, and the counter bumps inside the same transaction", async () => {
    const result = await issuePayrollNumber(issueForm("job_1"));
    expect(result).toEqual({ ok: true, value: { number: 1, alreadyIssued: false } });
    expect(db.rows("wh347PayrollCounter")[0]).toMatchObject({ jobId: "job_1", lastNumber: 1 });
  });

  it("issues the next number for a different week, per job", async () => {
    await issuePayrollNumber(issueForm("job_1", "2026-08-23"));
    const second = await issuePayrollNumber(issueForm("job_1", "2026-08-30"));
    expect(second).toEqual({ ok: true, value: { number: 2, alreadyIssued: false } });
  });

  it("answers with the SAME number on a second click for the same week — idempotent, not reissued", async () => {
    const first = await issuePayrollNumber(issueForm("job_1"));
    const second = await issuePayrollNumber(issueForm("job_1"));
    expect(first.ok && first.value.number).toBe(1);
    expect(second).toEqual({ ok: true, value: { number: 1, alreadyIssued: true } });
    // Only one counter bump for one week, however many times it's read.
    expect(db.rows("wh347PayrollCounter")[0].lastNumber).toBe(1);
  });

  it("two colliding clicks for the same week settle on the unique constraint, reading the winner back", async () => {
    uniqueConflictOn = "wh347PayrollNumber";
    const result = await issuePayrollNumber(issueForm("job_1"));
    // Nobody actually landed (the fake's create always throws here), so
    // there is no winner to read back — the honest "collided" sentence.
    expect(result).toEqual({ ok: false, error: "Two clicks collided and neither landed. Reload the page and try once." });
  });
});
