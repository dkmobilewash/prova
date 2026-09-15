import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/fake-prisma";

/**
 * The validation and ownership half of field-reports-core, which is the
 * half shared by the web action and the mobile API and therefore the half
 * where a divergence is a bug on both surfaces at once.
 *
 * The duplicate-date message is pinned verbatim: it is the one sentence a
 * foreman has to be able to read, and it was the most user-facing throw in
 * the module before the actions learned to return failures instead (see
 * lib/field-reports-core.ts).
 *
 * PR 2 adds the offline half: idempotent create (same clientOperationId
 * replays), the concurrent-replay race on the new
 * (companyId, clientOperationId) unique, and last-write-wins update.
 */

let db = new FakeDb();
// When set, dailyFieldReport.create first commits `raceWinner` (the
// concurrent winner's row) and then throws the P2002 the loser sees, with
// this meta.target. The FakeDb does not enforce @@unique, so a unique
// violation is simulated rather than read off it.
let p2002Target: string[] | null = null;
let raceWinner: Row | null = null;

vi.mock("@prova/db", () => ({
  get prisma() {
    const client = db.client() as Record<string, unknown>;
    if (!p2002Target) return client;
    // Preserve the real model's findUnique (the create path re-reads after a
    // P2002) while overriding create to throw the unique violation.
    const reportModel = client.dailyFieldReport as Record<string, unknown>;
    return new Proxy(client, {
      get(target, prop) {
        if (prop === "dailyFieldReport") {
          return {
            ...reportModel,
            create: () => ({
              then: (_ok: unknown, reject: (e: unknown) => void) => {
                if (raceWinner) db.seed("dailyFieldReport", raceWinner);
                reject({ code: "P2002", meta: { target: p2002Target } });
              },
            }),
          };
        }
        return Reflect.get(target, prop);
      },
    });
  },
}));

const {
  createFieldReport,
  updateFieldReport,
  listFieldReportsForJob,
  fieldReportFields,
  reportDateFromString,
} = await import("./field-reports-core");

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

function seedJob(id: string, companyId: string) {
  db.seed("job", { id, companyId });
}

function seedReport(row: Row) {
  db.seed("dailyFieldReport", {
    crewPresent: null,
    workPerformed: "Original",
    weather: null,
    delays: null,
    filedByUserId: null,
    clientId: null,
    clientOperationId: null,
    clientUpdatedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...row,
  });
}

beforeEach(() => {
  db = new FakeDb();
  p2002Target = null;
  raceWinner = null;
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

    const value = expectOk(await createFieldReport({ id: "co_me" }, "user_1", {
      jobId: "job_1",
      reportDate: "2026-09-14",
      workPerformed: "Framed",
      crewPresent: "Sam, Reyes",
    }));

    expect(value.created).toBe(true);
    expect(value.report.workPerformed).toBe("Framed");
    expect(value.report.clientId).toBeNull();
    expect(value.report.clientUpdatedAt).toBeNull();

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

  it("replays a retried create instead of double-filing", async () => {
    seedJob("job_1", "co_me");
    const input = {
      jobId: "job_1",
      reportDate: "2026-09-14",
      workPerformed: "Framed",
      clientId: "dev_1",
      clientOperationId: "op_1",
    };

    const first = expectOk(await createFieldReport({ id: "co_me" }, "user_1", input));
    const second = expectOk(await createFieldReport({ id: "co_me" }, "user_1", input));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.report.id).toBe(first.report.id);
    expect(db.rows("dailyFieldReport")).toHaveLength(1);
  });

  it("re-reads the winner when two devices file the same create-intent", async () => {
    seedJob("job_1", "co_me");
    p2002Target = ["companyId", "clientOperationId"];
    raceWinner = {
      id: "report_winner",
      companyId: "co_me",
      jobId: "job_1",
      reportDate: new Date("2026-09-14T00:00:00.000Z"),
      workPerformed: "Framed by the winner",
      crewPresent: null,
      weather: null,
      delays: null,
      filedByUserId: "user_2",
      clientId: "dev_2",
      clientOperationId: "op_1",
      clientUpdatedAt: null,
      createdAt: new Date("2026-09-14T01:00:00.000Z"),
      updatedAt: new Date("2026-09-14T01:00:00.000Z"),
    };

    const value = expectOk(await createFieldReport({ id: "co_me" }, "user_1", {
      jobId: "job_1",
      reportDate: "2026-09-14",
      workPerformed: "Framed",
      clientId: "dev_1",
      clientOperationId: "op_1",
    }));

    expect(value.created).toBe(false);
    expect(value.report.id).toBe("report_winner");
    expect(value.report.workPerformed).toBe("Framed by the winner");
  });

  it("maps a duplicate date to the exact existing sentence", async () => {
    seedJob("job_1", "co_me");
    p2002Target = ["jobId", "reportDate"];

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

describe("updateFieldReport", () => {
  it("refuses a report that is not in the caller's company", async () => {
    seedReport({
      id: "report_1",
      companyId: "co_other",
      jobId: "job_1",
      reportDate: new Date("2026-09-14T00:00:00.000Z"),
    });

    const result = await updateFieldReport({ id: "co_me" }, "report_1", {
      workPerformed: "Edited",
    });

    expect(result).toEqual({ ok: false, error: "Report not found" });
  });

  it("drops a stale edit and returns the stored row", async () => {
    seedReport({
      id: "report_1",
      companyId: "co_me",
      jobId: "job_1",
      reportDate: new Date("2026-09-14T00:00:00.000Z"),
      workPerformed: "Original",
      clientId: "dev_1",
      clientUpdatedAt: new Date("2026-09-14T10:00:00.000Z"),
    });

    const value = expectOk(await updateFieldReport({ id: "co_me" }, "report_1", {
      workPerformed: "Stale edit",
      clientId: "dev_1",
      clientUpdatedAt: "2026-09-14T09:00:00.000Z",
    }));

    expect(value.applied).toBe(false);
    expect(value.report.workPerformed).toBe("Original");
  });

  it("applies a newer edit", async () => {
    seedReport({
      id: "report_1",
      companyId: "co_me",
      jobId: "job_1",
      reportDate: new Date("2026-09-14T00:00:00.000Z"),
      workPerformed: "Original",
      clientId: "dev_1",
      clientUpdatedAt: new Date("2026-09-14T10:00:00.000Z"),
    });

    const value = expectOk(await updateFieldReport({ id: "co_me" }, "report_1", {
      workPerformed: "Newer edit",
      clientId: "dev_1",
      clientUpdatedAt: "2026-09-14T11:00:00.000Z",
    }));

    expect(value.applied).toBe(true);
    expect(value.report.workPerformed).toBe("Newer edit");
    expect(value.report.clientUpdatedAt).toBe("2026-09-14T11:00:00.000Z");
  });

  it("always applies a web edit that carries no client clock", async () => {
    seedReport({
      id: "report_1",
      companyId: "co_me",
      jobId: "job_1",
      reportDate: new Date("2026-09-14T00:00:00.000Z"),
      workPerformed: "Original",
      clientId: "dev_1",
      clientUpdatedAt: new Date("2026-09-14T10:00:00.000Z"),
    });

    const value = expectOk(await updateFieldReport({ id: "co_me" }, "report_1", {
      workPerformed: "Web edit",
    }));

    expect(value.applied).toBe(true);
    expect(value.report.workPerformed).toBe("Web edit");
  });
});

describe("listFieldReportsForJob", () => {
  it("serializes the new client fields on each row", async () => {
    seedJob("job_1", "co_me");
    seedReport({
      id: "report_1",
      companyId: "co_me",
      jobId: "job_1",
      reportDate: new Date("2026-09-14T00:00:00.000Z"),
      clientId: "dev_1",
      clientUpdatedAt: new Date("2026-09-14T10:00:00.000Z"),
    });

    const value = expectOk(await listFieldReportsForJob({ id: "co_me" }, "job_1"));

    expect(value).toHaveLength(1);
    expect(value[0]).toMatchObject({
      id: "report_1",
      clientId: "dev_1",
      clientUpdatedAt: "2026-09-14T10:00:00.000Z",
    });
  });
});
