import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * #218: deleteSalesLead's refusal already joined with "and" (unlike
 * deleteContact's comma-only join, fixed in the same PR) — but it only
 * ever had two possible non-zero counts (opportunities, activities) to
 * join, so it never actually proved the three-or-more, Oxford-comma case.
 * These two tests pin the shape it DOES have; the 3+ shape is proved once,
 * generically, by shared.test.ts's joinWithConjunction tests, and again on
 * deleteContact's own dbtest (which has four countable relations).
 */

const context = { company: { id: "", isProvaOperator: true }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { deleteSalesLead } = await import("./sales");

let companyId = "";

describe("deleteSalesLead's refusal message, against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: "Delete Sales Lead Test Co", isProvaOperator: true },
    });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `del_sl_o_${Date.now()}`,
        email: `del_sl_o_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    companyId = company.id;
    context.company.id = company.id;
    context.id = owner.id;
  });

  afterAll(async () => {
    await prisma.salesActivity.deleteMany({ where: { companyId } });
    await prisma.salesStageChange.deleteMany({ where: { companyId } });
    await prisma.salesOpportunity.deleteMany({ where: { companyId } });
    await prisma.salesLead.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("names only the non-zero count when a lead has activities but no opportunities", async () => {
    const lead = await prisma.salesLead.create({
      data: { companyId, companyName: "Acme Roofing" },
    });
    await prisma.salesActivity.createMany({
      data: [
        { companyId, leadId: lead.id, type: "CALL", occurredOn: new Date("2026-09-01T00:00:00.000Z"), summary: "Intro call" },
        { companyId, leadId: lead.id, type: "EMAIL", occurredOn: new Date("2026-09-02T00:00:00.000Z"), summary: "Sent pricing" },
      ],
    });

    const result = await deleteSalesLead(lead.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe(
      "Acme Roofing has 2 logged activities on file, so its record stays. Only a lead with no history can be deleted.",
    );
  });

  /**
   * #218: joins two non-zero counts with a bare "and" — no comma before it.
   * The exact wording the issue quoted as already correct.
   */
  it("joins exactly two non-zero counts with a bare 'and'", async () => {
    const lead = await prisma.salesLead.create({
      data: { companyId, companyName: "Beacon Builders" },
    });
    await prisma.salesOpportunity.createMany({
      data: [
        { companyId, leadId: lead.id },
        { companyId, leadId: lead.id },
      ],
    });
    await prisma.salesActivity.createMany({
      data: [
        { companyId, leadId: lead.id, type: "CALL", occurredOn: new Date("2026-09-01T00:00:00.000Z"), summary: "Intro call" },
        { companyId, leadId: lead.id, type: "DEMO", occurredOn: new Date("2026-09-05T00:00:00.000Z"), summary: "Ran the demo" },
      ],
    });

    const result = await deleteSalesLead(lead.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe(
      "Beacon Builders has 2 opportunities and 2 logged activities on file, so its record stays. Only a lead with no history can be deleted.",
    );
  });

  it("still deletes a lead with no history at all", async () => {
    const lead = await prisma.salesLead.create({
      data: { companyId, companyName: "Clean Slate Pipeline" },
    });

    const result = await deleteSalesLead(lead.id);

    expect(result).toEqual({ ok: true });
    const stillThere = await prisma.salesLead.findUnique({ where: { id: lead.id } });
    expect(stillThere).toBeNull();
  });
});
