import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { hasNoScopeAnswers, businessScopeLine } from "@/lib/businessScope";

/**
 * `saveBusinessScope` / `skipBusinessScopeQuestions` / `clearBusinessScope`
 * against a real database.
 *
 * Same reasoning as companyProfile.dbtest.ts, alongside it: the unit suite
 * (businessScope.test.ts, navItems.test.ts) proves the pure rules — what
 * the answers mean, what they hide. It cannot prove these four columns
 * exist on the real table, that Prisma accepts an enum value plus two
 * plain booleans in one update, or that a row reads back the way the nav
 * filter expects. That is what this file is for.
 *
 * NOT RUN BY THIS SESSION — CLAUDE.md: "You cannot run the dbtest suite
 * locally; do not claim it passes." Written to the same shape as the
 * dbtest beside it and left for CI / the next session with a scratch
 * Postgres to execute.
 */

const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { saveBusinessScope, skipBusinessScopeQuestions, clearBusinessScope } = await import("./company");

let companyId = "";

function submission(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    contractingRelationship: "UNDER_GENERAL_CONTRACTORS",
    doesPublicWork: "true",
    filesMonthlyPayApps: "true",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

describe("the business-scope actions, against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Business Scope Test's Company" } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `bscope_o_${Date.now()}`,
        email: `bscope_o_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    companyId = company.id;
    context.company.id = company.id;
    context.id = owner.id;
  });

  beforeEach(() => {
    context.role = "OWNER";
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("starts with all four columns null — a brand-new company answers nothing by default", async () => {
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(before.contractingRelationship).toBeNull();
    expect(before.doesPublicWork).toBeNull();
    expect(before.filesMonthlyPayApps).toBeNull();
    expect(before.businessScopeAskedAt).toBeNull();
    expect(hasNoScopeAnswers(before)).toBe(true);
  });

  it("writes all three answers and stamps businessScopeAskedAt", async () => {
    const result = await saveBusinessScope(submission());
    expect(result).toEqual({ ok: true });

    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(after.contractingRelationship).toBe("UNDER_GENERAL_CONTRACTORS");
    expect(after.doesPublicWork).toBe(true);
    expect(after.filesMonthlyPayApps).toBe(true);
    expect(after.businessScopeAskedAt).not.toBeNull();
    expect(businessScopeLine(after)).toBe(
      "Set up for: subcontractor under GCs, public works, monthly pay applications.",
    );
  });

  it("refuses a MEMBER without touching the stored row", async () => {
    context.role = "MEMBER";
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const result = await saveBusinessScope(
      submission({ contractingRelationship: "DIRECT_FOR_OWNERS", doesPublicWork: "false" }),
    );
    expect(result.ok).toBe(false);

    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(after.contractingRelationship).toBe(before.contractingRelationship);
    expect(after.doesPublicWork).toBe(before.doesPublicWork);
    context.role = "OWNER";
  });

  it("refuses a missing answer without touching the stored row", async () => {
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const fd = submission();
    fd.delete("doesPublicWork");
    const result = await saveBusinessScope(fd);
    expect(result.ok).toBe(false);

    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(after).toMatchObject({
      contractingRelationship: before.contractingRelationship,
      doesPublicWork: before.doesPublicWork,
      filesMonthlyPayApps: before.filesMonthlyPayApps,
    });
  });

  it("clearBusinessScope nulls the three answers but keeps businessScopeAskedAt set", async () => {
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(before.businessScopeAskedAt).not.toBeNull(); // from the earlier save in this file

    const result = await clearBusinessScope();
    expect(result).toEqual({ ok: true });

    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(after.contractingRelationship).toBeNull();
    expect(after.doesPublicWork).toBeNull();
    expect(after.filesMonthlyPayApps).toBeNull();
    expect(hasNoScopeAnswers(after)).toBe(true);
    expect(after.businessScopeAskedAt).not.toBeNull();
    expect(after.businessScopeAskedAt).toEqual(before.businessScopeAskedAt);
  });

  it("skipBusinessScopeQuestions stamps businessScopeAskedAt without touching the answers", async () => {
    // Reset to the never-asked state this test needs, on a second row so it
    // cannot be read as depending on execution order against the tests above.
    const company = await prisma.company.create({ data: { name: "Business Scope Skip Test's Company" } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `bscope_skip_${Date.now()}`,
        email: `bscope_skip_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    context.company.id = company.id;
    context.id = owner.id;

    const before = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(before.businessScopeAskedAt).toBeNull();

    const result = await skipBusinessScopeQuestions();
    expect(result).toEqual({ ok: true });

    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after.businessScopeAskedAt).not.toBeNull();
    expect(after.contractingRelationship).toBeNull();
    expect(after.doesPublicWork).toBeNull();
    expect(after.filesMonthlyPayApps).toBeNull();
    expect(hasNoScopeAnswers(after)).toBe(true);

    await prisma.user.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
    context.company.id = companyId;
    context.id = "";
  });
});
