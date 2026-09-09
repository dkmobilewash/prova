import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * #76: deleteContact's refusal message used to name every count, including
 * the zero ones — "0 job(s) and 3 bid invitation(s)". Proves the fixed
 * message lists only what's actually on file, correctly pluralised.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { deleteContact } = await import("./company");

let companyId = "";

describe("deleteContact's refusal message, against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Delete Contact Test Co" } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `del_o_${Date.now()}`,
        email: `del_o_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    companyId = company.id;
    context.company.id = company.id;
    context.id = owner.id;
  });

  afterAll(async () => {
    await prisma.bidInvitation.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("names only the non-zero count when a contact has bid invitations but no jobs", async () => {
    const contact = await prisma.contact.create({
      data: { companyId, name: "Acme GC" },
    });
    await prisma.bidInvitation.createMany({
      data: [
        { companyId, contactId: contact.id, projectName: "Job A" },
        { companyId, contactId: contact.id, projectName: "Job B" },
        { companyId, contactId: contact.id, projectName: "Job C" },
      ],
    });

    const result = await deleteContact(contact.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe(
      "Acme GC has 3 bid invitations on file, so its record stays. Only a contact with no history can be deleted.",
    );
    expect(result.error).not.toContain("0 job");
    expect(result.error).not.toContain("(s)");
  });

  it("still deletes a contact with no history at all", async () => {
    const contact = await prisma.contact.create({
      data: { companyId, name: "Clean Slate LLC" },
    });

    const result = await deleteContact(contact.id);

    expect(result).toEqual({ ok: true });
    const stillThere = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(stillThere).toBeNull();
  });
});
