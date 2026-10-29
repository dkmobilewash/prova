import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * "Wall types from the drawings" from the Takeoff features list, on a scratch
 * database: turning it on turns company AI on and opts the feature in, in one
 * save, without touching the other AI settings; turning it off takes only
 * the opt-in away; a non-owner is refused with a sentence.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { setWallTypesFromDrawings } = await import("./takeoffFeatures");

let companyId = "";
const form = (on: boolean) => {
  const f = new FormData();
  if (on) f.set("wallTypesFromDrawings", "on");
  return f;
};

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Features Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({
    data: { companyId, clerkId: `feat_${Date.now()}`, email: `feat_${Date.now()}@example.test`, role: "OWNER" },
  });
  context.id = owner.id;
  // AI off, one feature disabled, a model override: what must survive.
  await prisma.companyAiSettings.create({ data: { companyId, aiEnabled: false, disabledFeatures: ["SPEC_READ"], optedInFeatures: [], modelOverride: null } });
});

afterAll(async () => {
  await prisma.companyAiSettings.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("wall types from the drawings, from the features list", () => {
  it("turning it on turns AI on and opts the feature in, and leaves the rest alone", async () => {
    expect(await setWallTypesFromDrawings(form(true))).toEqual({ ok: true });
    const row = await prisma.companyAiSettings.findUniqueOrThrow({ where: { companyId } });
    expect(row.aiEnabled).toBe(true);
    expect(row.optedInFeatures).toEqual(["PLAN_TEXT_READ"]);
    expect(row.disabledFeatures).toEqual(["SPEC_READ"]);
  });

  it("turning it off takes the opt-in away and leaves AI on — AI is the Ask box too", async () => {
    expect(await setWallTypesFromDrawings(form(false))).toEqual({ ok: true });
    const row = await prisma.companyAiSettings.findUniqueOrThrow({ where: { companyId } });
    expect(row.aiEnabled).toBe(true);
    expect(row.optedInFeatures).toEqual([]);
  });

  it("a member who is not the owner is refused with a sentence, and nothing changes", async () => {
    context.role = "MEMBER";
    try {
      const result = await setWallTypesFromDrawings(form(true));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/owner/);
      const row = await prisma.companyAiSettings.findUniqueOrThrow({ where: { companyId } });
      expect(row.optedInFeatures).toEqual([]);
    } finally {
      context.role = "OWNER";
    }
  });
});
