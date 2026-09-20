import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * #26: `assignCrewMember`'s duplicate-assignment guard read
 * `!(error instanceof Prisma.PrismaClientKnownRequestError && error.code
 * === "P2002")` — inverted AND built on an `instanceof` that is FALSE at
 * runtime under Next's bundling (see `isUniqueConstraintError` in
 * ./shared for the measurement). Re-assigning a crew member already on the
 * job therefore rethrew a raw Prisma error and 500'd the job page, instead
 * of the no-op the code's own comment said it was.
 *
 * This pins the fix the way `phase-codes.test.ts` pins the sibling defect
 * it shares a root cause with: the FakeDb cannot produce a real
 * unique-index collision on its own (nothing here enforces uniqueness), so
 * the SECOND `jobAssignment.create` is swapped for one that throws the
 * exact shape a real Postgres P2002 arrives as — `.code === "P2002"`, and
 * NOT an instance of any special class, which is the whole point.
 */

let db = new FakeDb();

/** Set to make the next `jobAssignment.create` throw an error with this
 * `.code`, the way a real Postgres constraint violation would arrive.
 * `"P2002"` is the real collision this guard exists for; any other code
 * (e.g. a connection failure) is used to prove the guard still lets a
 * genuine failure escape rather than swallowing everything. */
let failCreateWithCode: string | null = null;

const context = {
  company: { id: "co_1" },
  id: "user_1",
  role: "OWNER" as string,
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    const client = db.client() as unknown as Record<string, Record<string, unknown>>;
    if (!failCreateWithCode) return client as never;
    const code = failCreateWithCode;
    return new Proxy(client, {
      get(target, property) {
        const model = target[property as string];
        if (property !== "jobAssignment") return model;
        return {
          ...model,
          create: () => {
            // The shape isUniqueConstraintError actually checks — `.code`,
            // not `instanceof Prisma.PrismaClientKnownRequestError`, which
            // is FALSE at runtime in this app (see the helper's own note
            // in shared.ts).
            const error = new Error(`simulated database error: ${code}`);
            (error as Error & { code?: string }).code = code;
            throw error;
          },
        };
      },
    }) as never;
  },
}));

const { assignCrewMember } = await import("./jobs");

function seedJob(over: Record<string, unknown> = {}) {
  return db.seed("job", { id: "job_1", companyId: "co_1", name: "5th & Main", ...over });
}

function seedMember(over: Record<string, unknown> = {}) {
  return db.seed("user", { id: "user_2", companyId: "co_1", name: "Alex Rivera", ...over });
}

function form(userId: string) {
  const fd = new FormData();
  fd.set("userId", userId);
  return fd;
}

function assignments() {
  return db.rows("jobAssignment");
}

beforeEach(() => {
  db = new FakeDb();
  failCreateWithCode = null;
});

describe("assignCrewMember", () => {
  it("assigns an unassigned teammate", async () => {
    seedJob();
    seedMember();

    await assignCrewMember("job_1", form("user_2"));

    expect(assignments()).toHaveLength(1);
    expect(assignments()[0]).toMatchObject({ jobId: "job_1", userId: "user_2" });
  });

  it("re-assigning a teammate already on the job is a no-op: no throw, no duplicate row", async () => {
    seedJob();
    seedMember();
    db.seed("jobAssignment", { id: "ja_1", jobId: "job_1", userId: "user_2" });
    failCreateWithCode = "P2002";

    await expect(assignCrewMember("job_1", form("user_2"))).resolves.toBeUndefined();

    // Still exactly the one row seeded above — the create that collided
    // never actually inserted a second row in a real database either;
    // this just confirms the action didn't throw its way past the check
    // that would otherwise have left the page 500'd.
    expect(assignments()).toHaveLength(1);
  });

  it("a failure that is NOT a unique-constraint collision still escapes", async () => {
    seedJob();
    seedMember();
    // P2025 ("record not found"), not P2002 — proves the guard is a
    // narrow unique-constraint check and not a blanket swallow of every
    // error `jobAssignment.create` could throw.
    failCreateWithCode = "P2025";

    await expect(assignCrewMember("job_1", form("user_2"))).rejects.toThrow(
      "simulated database error: P2025",
    );
    expect(assignments()).toHaveLength(0);
  });
});
