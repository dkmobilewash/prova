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
  userUpsert: [] as Call[],
  companyUpdateMany: [] as Call[],
  companyCreate: [] as Call[],
};

vi.mock("@prova/db", () => ({
  prisma: {
    user: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        calls.userUpsert.push({ args });
        return { id: `user-${calls.userUpsert.length}`, companyId: "company-main" };
      }),
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
  create: { role: string; company?: { create: { businessScopeAskedAt?: Date | null } }; companyId?: string };
};

beforeEach(async () => {
  calls.userUpsert.length = 0;
  calls.companyUpdateMany.length = 0;
  calls.companyCreate.length = 0;
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
    expect(calls.companyUpdateMany).toHaveLength(1);
    expect(calls.companyUpdateMany[0].args).toEqual({
      where: { id: "company-main", businessScopeAskedAt: null },
      data: { businessScopeAskedAt: ESTABLISHED_ACCOUNT_ASKED_AT },
    });
  });

  it("seeds FIELD inside MAIN's company as a MEMBER, which the gate never stops", () => {
    const field = calls.userUpsert.map((c) => c.args as unknown as UpsertArgs).find((a) => a.where.clerkId === "clerk-field");
    expect(field!.create.role).toBe("MEMBER");
    expect(field!.create.companyId).toBe("company-main");
    expect(shouldGateToOnboarding({ role: "MEMBER", businessScopeAskedAt: null })).toBe(false);
  });

  it("seeds no other persona, so the brand-new ones still meet the gate", () => {
    const seeded = calls.userUpsert.map((c) => (c.args as unknown as UpsertArgs).where.clerkId).sort();
    expect(seeded).toEqual(["clerk-field", "clerk-main"]);
    expect(calls.companyCreate).toHaveLength(0);
  });
});
