import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The replay guard on the phone's punch-list POST, against the error shape
 * it ACTUALLY receives in production.
 *
 * The guard read `error instanceof Prisma.PrismaClientKnownRequestError &&
 * error.code === "P2002"`. Under Next's bundling the thrown error's class
 * and the re-exported `Prisma` namespace are different copies, so that
 * `instanceof` is false at runtime and the guard never fires — the
 * dead-guard shape this repo has already paid for in #25, #26 and
 * `lib/auth.ts`'s first-sign-in recovery. A queued write that lost the
 * race would have 500'd on the one request whose whole purpose is to be
 * safely repeatable.
 *
 * `punch-list-api.dbtest.ts` covers the same race against a real Postgres
 * and CANNOT see this: it calls the route directly, where the two copies
 * of the class are the same one. So the error here is thrown as a plain
 * object carrying `.code`, which is what the guard must match on.
 */

const context = { company: { id: "co_1" }, companyId: "co_1", id: "user_1", role: "OWNER", jobFunction: null };

const winner = {
  id: "item_1",
  jobId: "job_1",
  description: "Corner bead missing",
  area: null,
  status: "OPEN",
  clientOperationId: "op_race",
  createdAt: new Date("2026-09-20T12:00:00.000Z"),
  updatedAt: new Date("2026-09-20T12:00:00.000Z"),
};

/** Nothing exists yet when the request arrives (both racers get past the
 * read); the insert then collides, and the read-back finds the winner. */
let inserted = false;

vi.mock("@/lib/auth", () => ({
  requireApiContext: async () => context,
  requireCompanyContext: async () => context,
}));

/** A DIFFERENT copy of the class from the one the thrown error came from,
 * which is exactly the production situation: the namespace exists, so the
 * old guard compiles and runs — it is simply false forever. Restore that
 * guard and these tests fail the way production failed, with the raw
 * error escaping, rather than on a missing symbol. */
class PrismaClientKnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("@prova/db", () => ({
  Prisma: { PrismaClientKnownRequestError },
  prisma: {
    job: { findUnique: async () => ({ id: "job_1", companyId: "co_1" }) },
    punchListItem: {
      findUnique: async () => (inserted ? winner : null),
      create: async () => {
        // A real Postgres unique violation, as the app receives it: `.code`
        // is "P2002" and it is an instance of nothing in particular.
        inserted = true;
        const error = new Error("Unique constraint failed on the fields: (`companyId`,`clientOperationId`)");
        (error as Error & { code?: string }).code = "P2002";
        throw error;
      },
    },
  },
}));

const { POST } = await import("./route");

function post(body: Record<string, unknown>) {
  const request = new NextRequest("http://test/api/v1/jobs/job_1/punch-list", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(request, { params: Promise.resolve({ id: "job_1" }) });
}

describe("a queued punch item whose insert loses the race", () => {
  it("reads the winner back as a 200 instead of throwing", async () => {
    const response = await post({ description: "Corner bead missing", clientOperationId: "op_race" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "item_1", description: "Corner bead missing" });
  });

  it("still lets a genuine failure escape", async () => {
    inserted = false;
    vi.resetModules();
    vi.doMock("@prova/db", () => ({
      Prisma: { PrismaClientKnownRequestError },
      prisma: {
        job: { findUnique: async () => ({ id: "job_1", companyId: "co_1" }) },
        punchListItem: {
          findUnique: async () => null,
          create: async () => {
            const error = new Error("connection lost");
            (error as Error & { code?: string }).code = "P1001";
            throw error;
          },
        },
      },
    }));
    const fresh = await import("./route");
    const request = new NextRequest("http://test/api/v1/jobs/job_1/punch-list", {
      method: "POST",
      body: JSON.stringify({ description: "Corner bead missing", clientOperationId: "op_race" }),
      headers: { "content-type": "application/json" },
    });
    await expect(fresh.POST(request, { params: Promise.resolve({ id: "job_1" }) })).rejects.toThrow("connection lost");
  });
});
