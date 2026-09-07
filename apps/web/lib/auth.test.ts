import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "@/lib/fake-prisma";

/**
 * The email-verification gate has to cover ALL THREE adoption paths in
 * requireCompanyContext, and it covered two (#136 §5).
 *
 * Main adoption (a returning person arriving with a new clerkId) checks
 * `emailIsVerified`. Race recovery checks it. The INVITE path did not
 * check anything: `prisma.invite.findUnique({ where: { email } })` and
 * straight into `user.create` as a MEMBER of the inviting company. So an
 * invitation addressed to victim@example.com was consumable by whoever
 * signed up naming that address — no mailbox access needed — and the
 * result was a real MEMBER account inside someone else's company.
 *
 * CLAUDE.md calls this gate "the security of it — without it, signing up
 * as someone else's address inherits their company". Whether the hole was
 * reachable in practice depends on Clerk refusing to mint a session
 * before verification, which is a DASHBOARD SETTING and not code — and
 * this repo has two Clerk instances whose settings can differ. The code
 * must not depend on it.
 *
 * BOTH DIRECTIONS ARE TESTED, deliberately. A gate that admits nobody
 * passes the attack test perfectly, and would silently break every real
 * invitation — a failure mode that looks like "the invite email didn't
 * work" and gets blamed on the mail provider for a week.
 */

let db = new FakeDb();

/** The Clerk user this sign-in presents. Set per test. */
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

/** A sign-in by someone whose Clerk account has (or has not) proved it
 * owns the address. Nothing else about the person differs between the two
 * tests — which is the point. */
function signInAs(email: string, verified: boolean) {
  clerkUser = {
    id: `clerk_${email.split("@")[0]}`,
    firstName: "Sam",
    lastName: "Reyes",
    primaryEmailAddress: {
      emailAddress: email,
      verification: verified ? { status: "verified" } : { status: "unverified" },
    },
  };
}

/** The invitation the victim's company sent to their new estimator. */
function pendingInviteFor(email: string) {
  db.seed("invite", { id: "invite_1", email, companyId: "co_victim" });
}

function users() {
  return db.rows("user");
}

function invites() {
  return db.rows("invite");
}

beforeEach(() => {
  db = new FakeDb();
  clerkUser = null;
});

describe("requireCompanyContext — the invite adoption path", () => {
  it("refuses to consume an invite when Clerk has not verified the address", async () => {
    pendingInviteFor("victim@example.com");
    signInAs("victim@example.com", false);

    await expect(requireCompanyContext()).rejects.toThrow(/verif/i);

    // Nobody joined the victim's company, and the invitation is still
    // there for the person it was actually addressed to.
    expect(users().filter((row) => row.companyId === "co_victim")).toEqual([]);
    expect(invites()).toHaveLength(1);
  });

  it("lets the genuinely invited person in once Clerk has verified the address", async () => {
    pendingInviteFor("estimator@example.com");
    signInAs("estimator@example.com", true);

    const context = await requireCompanyContext();

    expect(context).toMatchObject({
      email: "estimator@example.com",
      role: "MEMBER",
      companyId: "co_victim",
      clerkId: "clerk_estimator",
    });
    // The invitation is single-use: consumed in the same transaction.
    expect(invites()).toEqual([]);
  });
});
