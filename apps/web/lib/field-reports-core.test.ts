import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * The validation and ownership half of field-reports-core, which is the
 * half shared by the web action and the mobile API and therefore the half
 * where a divergence is a bug on both surfaces at once.
 *
 * The duplicate-date message is pinned verbatim: it is the one sentence a
 * foreman has to be able to read, and it was the most user-facing throw in
 * the module before the actions learned to return failures instead (see
 * lib/field-reports-core.ts).
 */

let db = new FakeDb();
let p2002OnCreate = false;

vi.mock("@prova/db", () => ({
  get prisma() {
    const client = db.client() as Record<string, unknown>;
    if (!p2002OnCreate) return client;
    // For the duplicate-date test only: the job lookup still resolves, but
    // the report create throws the P2002 that the real Postgres throws on a
    // second report for the same job + date. The FakeDb does not enforce
    // @@unique, so this is simulated rather than read off it.
    return new Proxy(client, {
      get(target, prop) {
        if (prop === "dailyFieldReport") {
          return {
            create: () => ({
              then: (_ok: unknown, reject: (e: unknown) => void) => reject({ code: "P2002" }),
            }),
          };
        }
        return Reflect.get(target, prop);
      },
    });
  },
}));

const { createFieldReport, fieldReportFields, reportDateFromString } =
  await import("./field-reports-core");

function seedJob(id: string, companyId: string) {
  db.seed("job", { id, companyId });
}

beforeEach(() => {
  db = new FakeDb();
  p2002OnCreate = false;
});

describe("reportDateFromString", () => {
  it("rejects a missing date", () => {
    expect(() => reportDateFromString(undefined)).toThrow("Date is required");
    expect(() => reportDateFromString("")).toThrow("Date is required");
  });

  it("rejects a date that is not a date", () => {
    expect(() => reportDateFromString("not-a-date")).toThrow("Date is not valid");
  });

  it("coerces a valid date to UTC midnight", () => {
    expect(reportDateFromString("2026-09-14").toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });
});

describe("fieldReportFields", () => {
  it("requires work performed", () => {
    expect(() => fieldReportFields({})).toThrow("Work performed is required");
    expect(() => fieldReportFields({ workPerformed: "   " })).toThrow("Work performed is required");
  });

  it("coerces empty optional fields to null and keeps the rest", () => {
    expect(
      fieldReportFields({ workPerformed: "Framed the east wall", crewPresent: "  ", weather: "Sunny", delays: "" }),
    ).toEqual({
      workPerformed: "Framed the east wall",
      crewPresent: null,
      weather: "Sunny",
      delays: null,
    });
  });
});

describe("createFieldReport", () => {
  it("refuses a job that is not in the caller's company", async () => {
    seedJob("job_1", "co_other");

    const result = await createFieldReport({ id: "co_me" }, "user_1", {
      jobId: "job_1",
      reportDate: "2026-09-14",
      workPerformed: "Framed",
    });

    expect(result).toEqual({ ok: false, error: "Job not found" });
  });

  it("writes a report for a job in the company", async () => {
    seedJob("job_1", "co_me");

    const result = await createFieldReport({ id: "co_me" }, "user_1", {
      jobId: "job_1",
      reportDate: "2026-09-14",
      workPerformed: "Framed",
      crewPresent: "Sam, Reyes",
    });

    expect(result).toEqual({ ok: true });

    const rows = db.rows("dailyFieldReport");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId: "job_1",
      companyId: "co_me",
      filedByUserId: "user_1",
      workPerformed: "Framed",
      crewPresent: "Sam, Reyes",
    });
    expect((rows[0].reportDate as Date).toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("maps a duplicate date to the exact existing sentence", async () => {
    seedJob("job_1", "co_me");
    p2002OnCreate = true;

    const result = await createFieldReport({ id: "co_me" }, "user_1", {
      jobId: "job_1",
      reportDate: "2026-09-14",
      workPerformed: "Framed",
    });

    expect(result).toEqual({
      ok: false,
      error: "A report already exists for that date — edit it instead of adding a second one",
    });
  });
});
