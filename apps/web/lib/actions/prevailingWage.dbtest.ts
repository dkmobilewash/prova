import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Prevailing wage rule sets against a real Postgres.
 *
 * The one that could not be checked any other way is the non-overlap
 * constraint: it is raw SQL in the migration, Prisma Client does not know
 * it exists, and a violation arrives as an untyped P2010. ARCHITECTURE.md
 * warns that whatever action touches such a table has to catch and
 * translate it — so this executes that path rather than trusting the
 * comment.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Never exercised by these cases (none attach a file), but the module
// imports it at load.
vi.mock("@vercel/blob", () => ({ put: async () => ({ url: "https://blob.test/x" }) }));

const {
  createPrevailingWageRuleSet,
  deletePrevailingWageRuleSet,
  setDeterminationRuleSet,
  updatePrevailingWageRuleSet,
} = await import("./prevailingWage");

const { uploadPrevailingWageDetermination } = await import("./labor");

let jobId = "";
let determinationId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const base = (over: Record<string, string> = {}) =>
  form({
    name: "California public works",
    jurisdiction: "California",
    authority: "STATE",
    filingFrequency: "WEEKLY",
    effectiveFrom: "2026-01-01",
    ...over,
  });

const sets = async () =>
  prisma.prevailingWageRuleSet.findMany({
    where: { companyId: context.company.id },
    orderBy: { effectiveFrom: "asc" },
  });

describe("prevailing wage rule sets against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Prevailing Wage Test Co" } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `pw_${Date.now()}`,
        email: `pw_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Courthouse" },
    });
    const determination = await prisma.prevailingWageDetermination.create({
      data: { jobId: job.id, jurisdiction: "California" },
    });

    context.company.id = company.id;
    context.id = user.id;
    jobId = job.id;
    determinationId = determination.id;
  });

  afterAll(async () => {
    await prisma.prevailingWageDetermination.deleteMany({ where: { jobId } });
    await prisma.prevailingWageRuleSet.deleteMany({ where: { companyId: context.company.id } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("stores a blank threshold as null, not as zero", async () => {
    // The distinction the whole feature rests on. Null is "nobody looked
    // it up" and the review reports it as unchecked; zero would mean the
    // premium starts at the first hour.
    expect(await createPrevailingWageRuleSet(base())).toEqual({ ok: true });

    const [rs] = await sets();
    expect(rs.dailyOvertimeAfterHours).toBeNull();
    expect(rs.weeklyOvertimeAfterHours).toBeNull();
    expect(rs.filingDueDays).toBeNull();
  });

  it("keeps a recorded zero as zero", async () => {
    const [rs] = await sets();
    expect(
      await updatePrevailingWageRuleSet(
        rs.id,
        base({ seventhDayOvertimeAfterHours: "0", dailyOvertimeAfterHours: "8", effectiveTo: "2026-05-31" }),
      ),
    ).toEqual({ ok: true });

    const [updated] = await sets();
    expect(Number(updated.seventhDayOvertimeAfterHours)).toBe(0);
    expect(Number(updated.dailyOvertimeAfterHours)).toBe(8);
  });

  it("refuses a second rule set overlapping the same jurisdiction, in words", async () => {
    // The database constraint, reached through the action. Prisma does not
    // know the constraint exists, so without the translation in
    // runAction this surfaces as an untyped P2010 and 500s the page.
    const result = await createPrevailingWageRuleSet(
      base({ name: "Overlapping", effectiveFrom: "2026-03-01" }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Another rule set already covers");
    expect(await sets()).toHaveLength(1);
  });

  it("allows the next rule set once the previous one has ended", async () => {
    expect(
      await createPrevailingWageRuleSet(base({ name: "From June", effectiveFrom: "2026-06-01" })),
    ).toEqual({ ok: true });
    expect(await sets()).toHaveLength(2);
  });

  it("allows a different jurisdiction over the same dates", async () => {
    expect(
      await createPrevailingWageRuleSet(
        base({ name: "Nevada", jurisdiction: "Nevada", effectiveFrom: "2026-01-01" }),
      ),
    ).toEqual({ ok: true });
    expect(await sets()).toHaveLength(3);
  });

  it("refuses an end date before the start", async () => {
    const result = await createPrevailingWageRuleSet(
      base({ name: "Backwards", jurisdiction: "Arizona", effectiveTo: "2025-12-01" }),
    );
    expect(result).toEqual({ ok: false, error: "The end date can't be before the start date" });
  });

  it("refuses a threshold that is not a number of hours in a day", async () => {
    const result = await createPrevailingWageRuleSet(
      base({ name: "Silly", jurisdiction: "Utah", dailyOvertimeAfterHours: "30" }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a source link that is not http(s)", async () => {
    // The string goes into an href.
    const result = await createPrevailingWageRuleSet(
      base({ name: "Injected", jurisdiction: "Oregon", sourceUrl: "javascript:alert(1)" }),
    );
    expect(result.ok).toBe(false);
  });

  it("attaches a rule set to a job's determination and clears it again", async () => {
    const [rs] = await sets();
    expect(await setDeterminationRuleSet(determinationId, form({ ruleSetId: rs.id }))).toEqual({
      ok: true,
    });
    expect(
      (await prisma.prevailingWageDetermination.findUniqueOrThrow({ where: { id: determinationId } }))
        .ruleSetId,
    ).toBe(rs.id);

    expect(await setDeterminationRuleSet(determinationId, form({ ruleSetId: "" }))).toEqual({ ok: true });
    expect(
      (await prisma.prevailingWageDetermination.findUniqueOrThrow({ where: { id: determinationId } }))
        .ruleSetId,
    ).toBeNull();
  });

  it("keeps the wage determination when its rule set is deleted", async () => {
    const [rs] = await sets();
    await setDeterminationRuleSet(determinationId, form({ ruleSetId: rs.id }));

    expect(await deletePrevailingWageRuleSet(rs.id)).toEqual({ ok: true });

    // ON DELETE SET NULL, not cascade. The determination is the document
    // the awarding body issued; deleting our own notes about the rules
    // must never take it with them.
    const determination = await prisma.prevailingWageDetermination.findUnique({
      where: { id: determinationId },
    });
    expect(determination).not.toBeNull();
    expect(determination?.ruleSetId).toBeNull();
  });

  it("refuses another company's rule set and determination", async () => {
    const other = await prisma.company.create({ data: { name: "Not Ours" } });
    const foreign = await prisma.prevailingWageRuleSet.create({
      data: {
        companyId: other.id,
        name: "Theirs",
        jurisdiction: "Texas",
        authority: "STATE",
        filingFrequency: "WEEKLY",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    expect(await updatePrevailingWageRuleSet(foreign.id, base())).toEqual({
      ok: false,
      error: "Rule set not found",
    });
    expect(await deletePrevailingWageRuleSet(foreign.id)).toEqual({
      ok: false,
      error: "Rule set not found",
    });
    expect(await setDeterminationRuleSet(determinationId, form({ ruleSetId: foreign.id }))).toEqual({
      ok: false,
      error: "Rule set not found",
    });

    await prisma.prevailingWageRuleSet.delete({ where: { id: foreign.id } });
    await prisma.company.delete({ where: { id: other.id } });
  });

  it("lets a non-owner record rules but not delete them", async () => {
    context.role = "MEMBER";
    try {
      expect(
        await createPrevailingWageRuleSet(base({ name: "Member's", jurisdiction: "Idaho" })),
      ).toEqual({ ok: true });

      const idaho = (await sets()).find((rs) => rs.jurisdiction === "Idaho");
      expect(await deletePrevailingWageRuleSet(idaho!.id)).toEqual({
        ok: false,
        error: "Only the account owner can delete a prevailing wage rule set",
      });
    } finally {
      context.role = "OWNER";
    }
  });

  /**
   * The crash browser testing found: both "Document" and "Or source link"
   * are labelled optional, one of them is required, and the action used to
   * `throw` that rule. Production redacts a thrown Server Action message to
   * a digest, so the whole page fell into the error boundary with a
   * reference number -- three times in a row, reasonably read as data loss.
   *
   * These assert the SHAPE, not just the text: an expected refusal comes
   * back as a value. If anyone reintroduces a throw, `.rejects` is what
   * changes and these fail.
   */
  describe("attaching a wage determination", () => {
    it("refuses an empty file AND link by returning, never by throwing", async () => {
      const before = await prisma.prevailingWageDetermination.count({ where: { jobId } });

      const result = await uploadPrevailingWageDetermination(
        jobId,
        form({ jurisdiction: "Nevada", sourceUrl: "", note: "" }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/attach the determination document/i);
      // and nothing was written on the way to refusing
      expect(await prisma.prevailingWageDetermination.count({ where: { jobId } })).toBe(before);
    });

    it("refuses a missing jurisdiction the same way", async () => {
      const result = await uploadPrevailingWageDetermination(
        jobId,
        form({ jurisdiction: "   ", sourceUrl: "https://sam.gov/zz" }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/jurisdiction/i);
    });

    it("accepts a source link with no file, which is the case that was crashing", async () => {
      const result = await uploadPrevailingWageDetermination(
        jobId,
        form({ jurisdiction: "Nevada", sourceUrl: "https://sam.gov/zztest" }),
      );

      expect(result.ok).toBe(true);
      const row = await prisma.prevailingWageDetermination.findFirst({
        where: { jobId, jurisdiction: "Nevada" },
      });
      expect(row?.sourceUrl).toBe("https://sam.gov/zztest");
      expect(row?.fileUrl).toBeNull();
    });
  });

});
