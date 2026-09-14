import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * `requireCompanyContext` is the one function every authenticated page in
 * this app awaits before it renders anything. Hanging a write off it is
 * therefore the cheapest possible way to learn who is still logging in —
 * and the cheapest possible way to take the entire app down, since a
 * rejection here is a 500 on every route at once.
 *
 * So the assertion that matters most in this file is the third one: a
 * stamp that FAILS must leave the page working. The other two are the
 * cost control (one write per person per interval, not one per request)
 * and the proof that the write happens at all — because a swallowed
 * failure and a stamp that was never wired up look identical from the
 * outside, which is the exact shape CLAUDE.md warns about under "written,
 * documented, and never called".
 *
 * Kept out of auth.test.ts on purpose: that file's mocks are set up around
 * the email-verification gate, and vitest gives each file its own module
 * registry, so two sets of `vi.mock` for `@prova/db` cannot interfere.
 */

let db = new FakeDb();

let clerkUser: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: {
    emailAddress: string;
    verification: { status: string } | null;
  } | null;
} | null = null;

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: async () => clerkUser,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT: ${to}`);
  },
}));

vi.mock("@prova/db", () => ({
  Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} },
  get prisma() {
    return db.client();
  },
}));

const { requireCompanyContext } = await import("./auth");

const MINUTE = 60 * 1000;

function signInAs(email: string) {
  clerkUser = {
    id: `clerk_${email.split("@")[0]}`,
    firstName: "Sam",
    lastName: "Reyes",
    primaryEmailAddress: { emailAddress: email, verification: { status: "verified" } },
  };
}

/** A design partner who already has an account, last seen `agoMs` ago. */
function returningPartner(agoMs: number | null) {
  const email = "partner@example.com";
  db.seed("user", {
    id: "user_partner",
    clerkId: "clerk_partner",
    email,
    name: "Sam Reyes",
    role: "OWNER",
    companyId: "co_partner",
    lastSeenAt: agoMs === null ? null : new Date(Date.now() - agoMs),
  });
  signInAs(email);
}

const stampedAt = () => db.rows("user")[0]?.lastSeenAt as Date | null | undefined;

beforeEach(() => {
  db = new FakeDb().defaults("user", { lastSeenAt: null });
  clerkUser = null;
  vi.restoreAllMocks();
});

describe("requireCompanyContext records that this person was here", () => {
  it("stamps lastSeenAt when the stored value is stale", async () => {
    returningPartner(60 * MINUTE);
    const before = Date.now();

    const context = await requireCompanyContext();

    expect(context.id).toBe("user_partner");
    expect(db.writes).toEqual(["user.update"]);
    const stamped = stampedAt() as Date;
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("stamps a person who has never been seen", async () => {
    // Every row in production is in this state the moment the migration
    // lands — the column is nullable with no backfill.
    returningPartner(null);

    await requireCompanyContext();

    expect(stampedAt()).toBeInstanceOf(Date);
  });

  it("writes nothing at all on a page load inside the interval", async () => {
    // The read path of a normal page must stay a read. If this fails, the
    // app has gained a write on every authenticated request.
    returningPartner(2 * MINUTE);

    await requireCompanyContext();

    expect(db.writes).toEqual([]);
  });

  it("still returns the context when the stamp write fails", async () => {
    // THE ONE THAT MATTERS. Telemetry is not allowed to decide whether the
    // app opens. Before this was wrapped, a failed write here rejected
    // inside the function every page awaits — so an unreachable Neon
    // compute would have turned "we cannot record a timestamp" into "the
    // whole product is down".
    vi.spyOn(console, "warn").mockImplementation(() => {});
    returningPartner(null);
    db.failNext = "user.update";

    const context = await requireCompanyContext();

    expect(context.id).toBe("user_partner");
    expect(context.email).toBe("partner@example.com");
    // The write was attempted and refused — this is not a test that passed
    // because nothing was tried.
    expect(db.writes).toEqual(["user.update"]);
    expect(stampedAt()).toBeNull();
  });

  it("records a brand-new account's first visit too", async () => {
    // First sign-in creates the User and the Company. Without a stamp on
    // this path, somebody who signs up, looks once and never returns reads
    // as "never seen" forever, which is the one row this instrument is
    // supposed to make impossible to miss.
    signInAs("newpartner@example.com");

    await requireCompanyContext();

    expect(db.writes).toEqual(["user.create", "user.update"]);
    expect(stampedAt()).toBeInstanceOf(Date);
  });
});
