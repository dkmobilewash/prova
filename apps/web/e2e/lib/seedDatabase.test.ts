import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The E2E seed gives MAIN an established company, and nobody else one.
 *
 * Six signed-in specs opened `/dashboard` as MAIN and looked for the
 * Topbar, the Help button, the Ask launcher or the nav rail. MAIN's company
 * was seeded with `businessScopeAskedAt` null, MAIN is its OWNER, and
 * lib/onboarding-gate.ts sends exactly that combination to `/welcome`,
 * which has none of those things. So the specs failed on a screen they
 * never meant to test. The E2E suite needs real Clerk keys and does not
 * run on every push. This file does, so the seed shape is pinned here
 * rather than rediscovered the next time a spec goes red for no reason.
 *
 * Both directions are asserted: MAIN is past the gate, AND the seed
 * creates no other company, so the personas that are supposed to be brand
 * new (EMPTY, JOB_CREATE, JOURNEY, BAD_INPUTS) still get their company from
 * the app's own first-sign-in path, gate and all.
 *
 * Prisma is faked: this is about what the seed ASKS for, and the unit
 * suite never talks to Postgres.
 */

type Call = { args: Record<string, unknown> };
const calls = {
  timeEntryCreateMany: [] as { args: Record<string, unknown> }[],
  userUpsert: [] as Call[],
  companyUpdateMany: [] as Call[],
  companyCreate: [] as Call[],
};

vi.mock("@prova/db", () => ({
  prisma: {
    user: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        calls.userUpsert.push({ args });
        // THE COMPANY ID FOLLOWS THE PERSONA, which it did not when every
        // upsert returned `company-main`. That was invisible while MAIN was
        // the only seeded company; the moment OPERATOR was added, its repair
        // was asserted against MAIN's id and the two were indistinguishable.
        // A fixture that returns one value for every caller cannot tell two
        // callers apart, which is the whole question here.
        const clerkId = (args as { where?: { clerkId?: string } }).where?.clerkId ?? "";
        const companyId = clerkId === "clerk-operator" ? "company-operator" : "company-main";
        return { id: `user-${calls.userUpsert.length}`, companyId };
      }),
      // The payroll seed looks the FIELD user up to hang its hours on.
      findFirst: vi.fn(async () => ({ id: "user-field" })),
    },
    company: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        calls.companyUpdateMany.push({ args });
        return { count: 0 };
      }),
      create: vi.fn(async (args: Record<string, unknown>) => {
        calls.companyCreate.push({ args });
        return { id: "unexpected" };
      }),
    },
    job: { findFirst: vi.fn(async () => ({ id: "job-1" })) },
    contact: { create: vi.fn() },
    // The certified-payroll week the seed now writes. This file is about
    // the ONBOARDING-GATE shape of the seeded users, so the payroll models
    // are stubbed rather than asserted — but they have to EXIST, or the
    // seed throws on `undefined.findFirst` and every test above fails for a
    // reason that has nothing to do with what it is testing.
    timeEntry: {
      findFirst: vi.fn(async () => null),
      createMany: vi.fn(async (args: Record<string, unknown>) => {
        calls.timeEntryCreateMany.push({ args });
        return { count: 2 };
      }),
    },
    unionLocal: { create: vi.fn(async () => ({ id: "local-1" })) },
    craftClassification: { create: vi.fn(async () => ({ id: "craft-1" })) },
    fringeRateSchedule: { create: vi.fn(async () => ({ id: "fringe-1" })) },
  },
}));

const { seedDatabase, ESTABLISHED_ACCOUNT_ASKED_AT } = await import("./seedDatabase");
const { shouldGateToOnboarding } = await import("@/lib/onboarding-gate");
const { PERSONAS } = await import("./personas");

const clerkIds = Object.fromEntries(
  Object.entries(PERSONAS).map(([key, persona]) => [key, { id: `clerk-${key}`, email: persona.email }]),
) as Parameters<typeof seedDatabase>[0];

type UpsertArgs = {
  where: { clerkId: string };
  create: {
    role: string;
    company?: { create: { businessScopeAskedAt?: Date | null; isProvaOperator?: boolean } };
    companyId?: string;
  };
};

beforeEach(async () => {
  calls.userUpsert.length = 0;
  calls.companyUpdateMany.length = 0;
  calls.companyCreate.length = 0;
  calls.timeEntryCreateMany.length = 0;
  await seedDatabase(clerkIds);
});

describe("seedDatabase: MAIN is an established account", () => {
  it("creates MAIN's company already asked, so its OWNER is not gated to /welcome", () => {
    const main = calls.userUpsert.map((c) => c.args as unknown as UpsertArgs).find((a) => a.where.clerkId === "clerk-main");
    expect(main, "MAIN is seeded").toBeDefined();
    expect(main!.create.role).toBe("OWNER");

    const askedAt = main!.create.company?.create.businessScopeAskedAt ?? null;
    expect(askedAt).toEqual(ESTABLISHED_ACCOUNT_ASKED_AT);
    // The rule itself, not a copy of it: the seeded shape through the gate.
    expect(shouldGateToOnboarding({ role: main!.create.role, businessScopeAskedAt: askedAt })).toBe(false);
    // And the control: the same owner WITHOUT it is exactly who the gate stops.
    expect(shouldGateToOnboarding({ role: "OWNER", businessScopeAskedAt: null })).toBe(true);
  });

  it("repairs a MAIN seeded before this fix, touching only a null", () => {
    const main = calls.companyUpdateMany.find(
      (c) => (c.args as { where: { id: string } }).where.id === "company-main",
    );
    expect(main!.args).toEqual({
      where: { id: "company-main", businessScopeAskedAt: null },
      data: { businessScopeAskedAt: ESTABLISHED_ACCOUNT_ASKED_AT },
    });
  });

  it("repairs an OPERATOR whose flag is still false, and only a false", () => {
    // The same shape as MAIN's repair and for the same reason: `upsert`'s
    // `update: {}` never touches the company, so a scratch database seeded by
    // an older branch keeps an operator that is not one — and every case in
    // `sales-operator.spec.ts` then fails on the refusal page with nothing
    // saying why. Narrowed on `isProvaOperator: false` so it can never flip a
    // customer company into the operator.
    const operator = calls.companyUpdateMany.find(
      (c) => (c.args as { where: { id: string } }).where.id === "company-operator",
    );
    expect(operator!.args).toEqual({
      where: { id: "company-operator", isProvaOperator: false },
      data: { isProvaOperator: true, businessScopeAskedAt: ESTABLISHED_ACCOUNT_ASKED_AT },
    });
  });

  it("repairs EXACTLY those two companies and no others", () => {
    // The count assertion kept as its own case rather than folded into either
    // repair above: a third `updateMany` appearing is the thing worth failing
    // on, and reading it off one of the two would hide it.
    expect(calls.companyUpdateMany.map((c) => (c.args as { where: { id: string } }).where.id).sort()).toEqual([
      "company-main",
      "company-operator",
    ]);
  });

  it("seeds FIELD inside MAIN's company as a MEMBER, which the gate never stops", () => {
    const field = calls.userUpsert.map((c) => c.args as unknown as UpsertArgs).find((a) => a.where.clerkId === "clerk-field");
    expect(field!.create.role).toBe("MEMBER");
    expect(field!.create.companyId).toBe("company-main");
    expect(shouldGateToOnboarding({ role: "MEMBER", businessScopeAskedAt: null })).toBe(false);
  });

  it("seeds OPERATOR as the one company that is Prova's own operator", () => {
    const operator = calls.userUpsert
      .map((c) => c.args as unknown as UpsertArgs)
      .find((a) => a.where.clerkId === "clerk-operator");
    // BOTH HALVES OF THE GATE, because `/sales` needs both and a MEMBER of an
    // operator company still gets the refusal.
    expect(operator!.create.role).toBe("OWNER");
    expect(operator!.create.company?.create?.isProvaOperator).toBe(true);
    // Established, or its OWNER lands on /welcome and never reaches /sales.
    expect(operator!.create.company?.create?.businessScopeAskedAt).toEqual(ESTABLISHED_ACCOUNT_ASKED_AT);
  });

  it("seeds no persona beyond those three, so the rest still meet the gate", () => {
    // THE INVARIANT THIS CASE HAS ALWAYS HELD, with one more name in it.
    // Every persona absent from this list gets a company auto-created by
    // `requireCompanyContext` on first sign-in — brand new, not established,
    // not an operator — which is what the empty-state and onboarding specs
    // depend on. OPERATOR is the deliberate third, and it is deliberate
    // precisely because nothing in the product can set `isProvaOperator`, so
    // a browser could not otherwise render `/sales` at all.
    const seeded = calls.userUpsert.map((c) => (c.args as unknown as UpsertArgs).where.clerkId).sort();
    expect(seeded).toEqual(["clerk-field", "clerk-main", "clerk-operator"]);
    // Still zero: both companies are created NESTED inside their owner's
    // upsert, never by a bare `company.create`.
    expect(calls.companyCreate).toHaveLength(0);
  });
});
