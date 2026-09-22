import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * `adoptCompanyContext`'s concurrent-first-sign-in recovery, found broken
 * in commit `98329c8` alongside #25 and #26 but never assigned its own
 * issue — "in neither issue", per that commit's own message — and never
 * fixed on `main` until this branch.
 *
 * Same defect shape as #25/#26: `error instanceof
 * Prisma.PrismaClientKnownRequestError` is FALSE at runtime under Next's
 * bundling (see `isUniqueConstraintError` in lib/actions/shared.ts for the
 * measurement), so the whole re-read-what-the-winner-created recovery below
 * was unreachable. Two tabs racing a first sign-in — or two people
 * consuming the same invite at once — got a raw Prisma error and a 500
 * instead of the row the winner had just created.
 *
 * `auth.test.ts` mocks `Prisma.PrismaClientKnownRequestError` as a REAL
 * class, which is exactly the trap CLAUDE.md documents: under Vitest,
 * where Node resolves `@prisma/client` once, `instanceof` against that
 * mock class is TRUE and the broken code behaves perfectly. This file
 * mocks `Prisma` as `{}` instead — no class at all — so a test written
 * against the ORIGINAL `instanceof` guard cannot pass by accident, the
 * same way jobs.assignCrewMember.test.ts pins #26.
 *
 * THE RACE ITSELF HAS TO BE SIMULATED AT THE RIGHT MOMENT. The winner's row
 * must NOT exist yet when `adoptCompanyContext` makes its FIRST read (the
 * `existing` check by clerkId, and — for the email case — the `sameEmail`
 * check before the insert is even attempted), or that early read returns it
 * directly and the function never reaches the insert, the catch block, or
 * the guard under test at all — a needle already on the page, same shape as
 * the vacuous #61 watcher CLAUDE.md documents. So the winner's row is
 * seeded by the mocked `user.create` itself, at the instant it throws,
 * exactly when a concurrent winner's insert would actually have landed.
 */

let db = new FakeDb();

/** Set to make the next `user.create` throw an error with this `.code` AND
 * seed `raceWinnerRow` at that moment — simulating a concurrent request
 * that won the race between this function's own reads and its insert. */
let failUserCreateWithCode: string | null = null;
let raceWinnerRow: Record<string, unknown> | null = null;

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    const client = db.client() as unknown as Record<string, Record<string, unknown>>;
    if (!failUserCreateWithCode) return client as never;
    const code = failUserCreateWithCode;
    return new Proxy(client, {
      get(target, property) {
        const model = target[property as string];
        if (property !== "user") return model;
        return {
          ...model,
          create: () => {
            if (raceWinnerRow) db.seed("user", raceWinnerRow as { id: string });
            const error = new Error(`simulated database error: ${code}`);
            (error as Error & { code?: string }).code = code;
            throw error;
          },
        };
      },
    }) as never;
  },
}));

vi.mock("@/lib/last-seen-stamp", () => ({
  recordLastSeen: async () => {},
}));

const { adoptCompanyContext } = await import("./auth");

function identity(over: Partial<Parameters<typeof adoptCompanyContext>[0]> = {}) {
  return {
    id: "clerk_sam",
    email: "sam@example.com",
    emailVerified: true,
    firstName: "Sam",
    lastName: "Reyes",
    ...over,
  };
}

beforeEach(() => {
  db = new FakeDb();
  failUserCreateWithCode = null;
  raceWinnerRow = null;
});

describe("adoptCompanyContext — concurrent first sign-in", () => {
  it("re-reads the winner's row by clerkId instead of throwing a raw P2002", async () => {
    failUserCreateWithCode = "P2002";
    // Lands under the SAME clerkId this call is using — two tabs, same
    // person, same sign-in landing twice.
    raceWinnerRow = {
      id: "user_1",
      clerkId: "clerk_sam",
      email: "sam@example.com",
      name: "Sam Reyes",
      role: "OWNER",
      companyId: "co_1",
    };

    const result = await adoptCompanyContext(identity());

    expect(result).toMatchObject({ id: "user_1", clerkId: "clerk_sam" });
  });

  it("re-reads by email when the collision is on the email column instead", async () => {
    // A DIFFERENT clerkId wins the race — the case the fix's own comment
    // calls out: an email collision is not the clerkId race, and the old
    // clerkId-only re-read threw P2025 on exactly this shape.
    failUserCreateWithCode = "P2002";
    raceWinnerRow = {
      id: "user_2",
      clerkId: "clerk_other_tab",
      email: "sam@example.com",
      name: "Sam Reyes",
      role: "OWNER",
      companyId: "co_2",
    };

    const result = await adoptCompanyContext(identity());

    expect(result).toMatchObject({ id: "user_2" });
    // Relinked to the new clerkId, the way requireCompanyContext's
    // sameEmail branch above this catch also does.
    expect(result).toMatchObject({ clerkId: "clerk_sam" });
  });

  it("a failure that is NOT a unique-constraint collision still escapes", async () => {
    failUserCreateWithCode = "P2025";
    raceWinnerRow = null;

    await expect(adoptCompanyContext(identity())).rejects.toThrow(
      "simulated database error: P2025",
    );
  });
});
