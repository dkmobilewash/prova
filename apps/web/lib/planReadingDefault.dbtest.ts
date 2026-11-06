import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * AI plan reading is ON for a new company and unchanged for an existing one
 * (Diego, 2026-11-06), against a real Postgres: a first sign-in creates the
 * company with PLAN_TEXT_READ opted in, so `aiGate` passes; a company that
 * predates it (no AI settings row) still refuses, and saving its AI settings
 * does not opt it in, because the default is in code at creation, not a column.
 */
let clerkUser: unknown = null;
vi.mock("@clerk/nextjs/server", () => ({
  currentUser: async () => clerkUser,
  auth: async () => ({ userId: null }),
  clerkClient: async () => ({ users: { getUser: async () => null } }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT: ${to}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { requireCompanyContext } = await import("./auth");
const { aiGate } = await import("./ai/settings");

const made: string[] = [];
afterAll(async () => {
  for (const companyId of made) {
    await prisma.companyAiSettings.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

describe("AI plan reading by default", () => {
  it("a brand-new company starts with it on, and the gate passes", async () => {
    const tag = `prd${Date.now()}`;
    clerkUser = { id: `clerk_${tag}`, firstName: "Pat", lastName: "New", primaryEmailAddress: { emailAddress: `${tag}@example.test`, verification: { status: "verified" } } };
    const context = await requireCompanyContext();
    made.push(context.company.id);
    const row = await prisma.companyAiSettings.findUniqueOrThrow({ where: { companyId: context.company.id } });
    expect(row.optedInFeatures).toEqual(["PLAN_TEXT_READ"]);
    // Everything else as a company with no row: AI on, nothing switched off.
    expect(row.aiEnabled).toBe(true);
    expect(row.disabledFeatures).toEqual([]);
    expect((await aiGate(context.company.id, "PLAN_TEXT_READ")).ok).toBe(true);
  });

  it("an existing company is unchanged: no row means off, and a row created later is not opted in", async () => {
    const company = await prisma.company.create({ data: { name: "PLAN-READING-DEFAULT existing" } });
    made.push(company.id);
    expect((await aiGate(company.id, "PLAN_TEXT_READ")).ok).toBe(false);
    // What saving the Assistant page does for a company with no row yet.
    await prisma.companyAiSettings.create({ data: { companyId: company.id, disabledFeatures: [] } });
    expect((await prisma.companyAiSettings.findUniqueOrThrow({ where: { companyId: company.id } })).optedInFeatures).toEqual([]);
    expect((await aiGate(company.id, "PLAN_TEXT_READ")).ok).toBe(false);
  });
});
