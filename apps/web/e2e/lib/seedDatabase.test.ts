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
  signalDeleteMany: [] as Call[],
  signalCreateMany: [] as Call[],
};

vi.mock("@prova/db", () => ({
  prisma: {
    user: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        calls.userUpsert.push({ args });
        // The company id is derived from the persona so the SALES assertions
        // below can tell MAIN's repair from SALES's. A single literal made both
        // updateMany calls look identical.
        const clerkId = String((args.where as { clerkId: string }).clerkId);
        return {
          id: `user-${calls.userUpsert.length}`,
          companyId: clerkId === "clerk-sales" ? "company-sales" : "company-main",
        };
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
    // The sales fixture. `findFirst` answers "already there", so the leads are
    // reused and the opportunity branch is not taken — the signal REPLACEMENT
    // still runs, which is the half that has to happen on every run.
    salesLead: {
      findFirst: vi.fn(async () => ({ id: "lead-1" })),
      create: vi.fn(async () => ({ id: "lead-created" })),
    },
    salesLeadSignal: {
      deleteMany: vi.fn(async (args: Record<string, unknown>) => {
        calls.signalDeleteMany.push({ args });
        return { count: 0 };
      }),
      createMany: vi.fn(async (args: Record<string, unknown>) => {
        calls.signalCreateMany.push({ args });
        return { count: 0 };
      }),
    },
    salesOpportunity: {
      count: vi.fn(async () => 3),
      create: vi.fn(async () => ({ id: "opportunity-1" })),
    },
    salesStageChange: { create: vi.fn() },
  },
}));

const { seedDatabase, ESTABLISHED_ACCOUNT_ASKED_AT } = await import("./seedDatabase");
const { shouldGateToOnboarding } = await import("@/lib/onboarding-gate");
const { PERSONAS } = await import("./personas");
const { RESEARCHED_LEAD_SIGNALS, SALES_OWNER_NAME } = await import("./salesFixture");

const clerkIds = Object.fromEntries(
  Object.entries(PERSONAS).map(([key, persona]) => [key, { id: `clerk-${key}`, email: persona.email }]),
) as Parameters<typeof seedDatabase>[0];

type UpsertArgs = {
  where: { clerkId: string };
  create: {
    role: string;
    name?: string;
    company?: { create: { businessScopeAskedAt?: Date | null; isProvaOperator?: boolean } };
    companyId?: string;
  };
};

type SeededSignal = { state: string; reviewedAt: Date | null; reviewedByUserId: string | null };

beforeEach(async () => {
  for (const list of Object.values(calls)) list.length = 0;
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
    // Located by what it asks for, not by its index: a second repair (SALES's,
    // asserted below) was added after this test and an index would have made
    // this one about whichever call happened to be first.
    const repairs = calls.companyUpdateMany.map((c) => c.args);
    expect(repairs).toContainEqual({
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
    // SALES joined this list 2026-10-05 and it is NOT a loosening: that
    // persona's company cannot be created by the app's own first-sign-in path
    // the way EMPTY's and JOURNEY's are, because no screen in this product sets
    // `Company.isProvaOperator`. The brand-new personas are still absent, which
    // is what this assertion is for.
    expect(seeded).toEqual(["clerk-field", "clerk-main", "clerk-sales"]);
    expect(calls.companyCreate).toHaveLength(0);
  });
});

/**
 * THE SEED IS THE ONLY THING THAT CAN PUT A BROWSER ON `/sales`.
 *
 * Both of that page's checks are written out at the top of
 * `app/(app)/sales/page.tsx`: `Company.isProvaOperator`, then role OWNER. There
 * is no UI anywhere in this product that sets the flag, so if this seed stops
 * setting it the two sales specs do not fail with an error boundary — they get
 * the page's own healthy "Not part of your access" refusal and fail on a
 * missing heading, saying nothing about the cause. The E2E suite needs a Clerk
 * development instance and does not run on every push; this does.
 */
describe("seedDatabase: SALES is Prova's own operating company", () => {
  const salesUpsert = () =>
    calls.userUpsert
      .map((c) => c.args as unknown as UpsertArgs)
      .find((a) => a.where.clerkId === "clerk-sales");

  it("creates its company with isProvaOperator set, and as its OWNER", () => {
    const sales = salesUpsert();
    expect(sales, "SALES is seeded").toBeDefined();
    // Both halves. `isProvaOperator` without OWNER renders "Owner only", which
    // is a different healthy page and a different wrong answer.
    expect(sales!.create.role).toBe("OWNER");
    expect(sales!.create.company?.create.isProvaOperator).toBe(true);
  });

  it("is the ONLY company this seed flags, so no other spec's rail grows an Internal group", () => {
    // `specs/journey.spec.ts` step 10 opens every destination the rail offers.
    // Flagging MAIN would quietly enlist that step into testing the sales
    // screens, and a crash there would be reported as a broken nav walk.
    const flagged = calls.userUpsert
      .map((c) => c.args as unknown as UpsertArgs)
      .filter((a) => a.create.company?.create.isProvaOperator === true)
      .map((a) => a.where.clerkId);
    expect(flagged).toEqual(["clerk-sales"]);
  });

  it("repairs a SALES company seeded before the flag existed", () => {
    expect(calls.companyUpdateMany.map((c) => c.args)).toContainEqual({
      where: { id: "company-sales", isProvaOperator: false },
      data: { isProvaOperator: true },
    });
  });

  it("names the owner, because the confirm's only proof is rendered from that name", () => {
    // `SalesSignalRow` renders "· checked by <User.name>" from the reviewer
    // relation, and that sentence is what specs/sales-crm.spec.ts uses to prove
    // the review landed. A nameless user renders the email instead and the
    // assertion would be about the wrong string.
    expect(salesUpsert()!.create.name).toBe(SALES_OWNER_NAME);
  });

  it("REPLACES the researched lead's signals every run rather than reusing them", () => {
    // The spec confirms the proposed signal and nothing in this product can
    // un-confirm one. A find-or-create would hand a second run against a
    // surviving scratch database a signal that is already CONFIRMED, and the
    // spec would fail looking for a Confirm button that is not there.
    expect(calls.signalDeleteMany).toHaveLength(1);
    expect(calls.signalCreateMany).toHaveLength(1);

    const created = (calls.signalCreateMany[0].args as { data: SeededSignal[] }).data;
    expect(created).toHaveLength(RESEARCHED_LEAD_SIGNALS.length);

    // Exactly one PROPOSED row — two Confirm buttons on one page and the
    // spec's locator dies in strict mode rather than failing about the product.
    expect(created.filter((signal) => signal.state === "PROPOSED")).toHaveLength(1);

    // And not one reviewer anywhere. "checked by E2E SALES" is the one thing on
    // that page that cannot be true before the review; seeded, it would make
    // the spec's proof unfalsifiable — CLAUDE.md's needle-already-on-the-page.
    expect(created.every((signal) => signal.reviewedByUserId === null)).toBe(true);
    expect(created.every((signal) => signal.reviewedAt === null)).toBe(true);
  });
});
