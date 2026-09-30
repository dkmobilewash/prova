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

/** The invite arm fails inside `$transaction`, not in `user.create` — the
 * transaction runs `invite.delete` FIRST, and that is the statement a
 * concurrent winner has already made impossible. Simulated separately for
 * that reason: a test that failed `user.create` would be exercising a
 * different statement than the one that actually breaks. */
let failTransactionWithCode: string | null = null;
let raceWinnerRow: Record<string, unknown> | null = null;

vi.mock("@prova/db", () => ({
  Prisma: {},
  get prisma() {
    const client = db.client() as unknown as Record<string, Record<string, unknown>>;
    if (!failUserCreateWithCode && !failTransactionWithCode) return client as never;
    return new Proxy(client, {
      get(target, property) {
        const model = target[property as string];

        if (property === "$transaction" && failTransactionWithCode) {
          const code = failTransactionWithCode;
          return () => {
            if (raceWinnerRow) db.seed("user", raceWinnerRow as { id: string });
            const error = new Error(`simulated database error: ${code}`);
            (error as Error & { code?: string }).code = code;
            throw error;
          };
        }

        if (property !== "user" || !failUserCreateWithCode) return model;
        const code = failUserCreateWithCode;
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
  failTransactionWithCode = null;
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

/**
 * THE ARM THIS CATCH DESCRIBED IN WORDS AND COULD NOT REACH.
 *
 * The invite path runs `prisma.$transaction([invite.delete(...),
 * user.create(...)])`, and the DELETE goes first. `Invite.email` is unique,
 * so an invite belongs to exactly one address — which makes a concurrent
 * consumption the same person in two tabs, not two people. The loser's
 * delete hits a row the winner has already consumed: that is **P2025**, not
 * P2002, so `isUniqueConstraintError` returned false and a recoverable
 * double-click left as a 500.
 *
 * The sentence "or someone else consuming the same invite first" has been
 * sitting three lines above a guard that could not see it — a comment
 * describing a case the code does not handle, which is this repo's most
 * repeated shape.
 */
describe("adoptCompanyContext — two tabs consuming one invite", () => {
  it("re-reads the winner's row instead of 500ing on the vanished invite", async () => {
    db.seed("invite", { id: "inv_1", email: "sam@example.com", companyId: "co_invited" });
    failTransactionWithCode = "P2025";
    // The winner landed between this call's own reads and its transaction —
    // seeded at the instant the transaction throws, which is exactly when a
    // concurrent winner's insert would have committed. Seeding it earlier
    // would be answered by the very first `existing` read and this test
    // would never reach the catch at all.
    raceWinnerRow = {
      id: "user_1",
      clerkId: "clerk_sam",
      email: "sam@example.com",
      name: "Sam Reyes",
      role: "MEMBER",
      companyId: "co_invited",
    };

    const result = await adoptCompanyContext(identity());

    expect(result).toMatchObject({ id: "user_1", companyId: "co_invited" });
  });

  it("still escapes when the invite vanished and no winner row exists", async () => {
    // The control, and the reason widening the guard to P2025 is safe: the
    // recovery is EVIDENCE-BASED. It returns only if a re-read finds a row,
    // and rethrows the original error untouched otherwise. A genuine P2025
    // with nothing behind it must not be swallowed into a silent retry.
    db.seed("invite", { id: "inv_1", email: "sam@example.com", companyId: "co_invited" });
    failTransactionWithCode = "P2025";
    raceWinnerRow = null;

    await expect(adoptCompanyContext(identity())).rejects.toThrow(
      "simulated database error: P2025",
    );
  });
});
