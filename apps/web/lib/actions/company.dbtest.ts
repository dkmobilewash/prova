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

const { createContact, deleteContact } = await import("./company");

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
    await prisma.contactInteraction.deleteMany({ where: { companyId } });
    await prisma.contactPerson.deleteMany({ where: { companyId } });
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

  /**
   * #218: joins two non-zero counts with "and", no comma before it — the
   * shape deleteSalesLead's refusal already had and deleteContact's didn't.
   */
  it("joins exactly two non-zero counts with a bare 'and'", async () => {
    const contact = await prisma.contact.create({
      data: { companyId, name: "Two Counts Co" },
    });
    await prisma.bidInvitation.createMany({
      data: [{ companyId, contactId: contact.id, projectName: "Job A" }],
    });
    await prisma.contactPerson.createMany({
      data: [{ companyId, contactId: contact.id, name: "Pat PM" }],
    });

    const result = await deleteContact(contact.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe(
      "Two Counts Co has 1 bid invitation and 1 person on file, so its record stays. Only a contact with no history can be deleted.",
    );
  });

  /**
   * #218: three or more non-zero counts get an Oxford comma before the
   * final "and" — "a, b, and c", not "a, b, c" (the old shape) and not
   * "a, b and c" (missing the comma before the last item).
   */
  it("joins three non-zero counts with a comma-separated list ending in ', and'", async () => {
    const contact = await prisma.contact.create({
      data: { companyId, name: "Three Counts Inc" },
    });
    await prisma.bidInvitation.createMany({
      data: [{ companyId, contactId: contact.id, projectName: "Job A" }],
    });
    await prisma.contactInteraction.createMany({
      data: [
        { companyId, contactId: contact.id, type: "CALL", occurredOn: new Date("2026-09-01T00:00:00.000Z"), summary: "Intro call" },
        { companyId, contactId: contact.id, type: "EMAIL", occurredOn: new Date("2026-09-02T00:00:00.000Z"), summary: "Sent scope" },
        { companyId, contactId: contact.id, type: "NOTE", occurredOn: new Date("2026-09-03T00:00:00.000Z"), summary: "Left a note" },
        { companyId, contactId: contact.id, type: "SITE_VISIT", occurredOn: new Date("2026-09-04T00:00:00.000Z"), summary: "Walked the site" },
      ],
    });
    await prisma.contactPerson.createMany({
      data: [{ companyId, contactId: contact.id, name: "Pat PM" }],
    });

    const result = await deleteContact(contact.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe(
      "Three Counts Inc has 1 bid invitation, 4 logged interactions, and 1 person on file, so its record stays. Only a contact with no history can be deleted.",
    );
  });
});

/**
 * #218: the "Add a contact" create form used to only collect name/status/
 * type/email/phone/address — retainage %, payment terms and standard forms
 * used were edit-only, reachable only by saving, reopening, filling them
 * in, and saving again. createContact now accepts and stores the same
 * three "standing terms" fields ContactStandingTermsFields renders on both
 * the create and edit forms. msaExpirationDate / prequalificationExpiresAt
 * deliberately stay edit-only (see the comment beside them in
 * ContactEditForm.tsx) and are NOT asserted here as settable from create.
 */
describe("createContact accepts standing-terms fields, against a real database", () => {
  let termsCompanyId = "";

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Create Contact Terms Test Co" } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `cc_o_${Date.now()}`,
        email: `cc_o_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    termsCompanyId = company.id;
    context.company.id = company.id;
    context.id = owner.id;
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { companyId: termsCompanyId } });
    await prisma.user.deleteMany({ where: { companyId: termsCompanyId } });
    await prisma.company.delete({ where: { id: termsCompanyId } });
  });

  it("saves retainage %, payment terms days and standard forms used from the create form in one step", async () => {
    const formData = new FormData();
    formData.set("name", "Cornerstone GC");
    formData.set("defaultRetainagePercent", "10");
    formData.set("paymentTermsDays", "45");
    formData.set("standardFormsUsed", "AIA A401");

    const result = await createContact(formData);
    expect(result).toEqual({ ok: true });

    const contact = await prisma.contact.findFirstOrThrow({ where: { companyId: termsCompanyId, name: "Cornerstone GC" } });
    expect(contact.defaultRetainagePercent?.toString()).toBe("10");
    expect(contact.paymentTermsDays).toBe(45);
    expect(contact.standardFormsUsed).toBe("AIA A401");
    // The two edit-only fields stay null from create — nothing on the create
    // form can set them.
    expect(contact.msaExpirationDate).toBeNull();
    expect(contact.prequalificationExpiresAt).toBeNull();
  });

  it("leaves the standing-terms fields null when the create form omits them, same as before #218", async () => {
    const formData = new FormData();
    formData.set("name", "Bare Minimum LLC");

    const result = await createContact(formData);
    expect(result).toEqual({ ok: true });

    const contact = await prisma.contact.findFirstOrThrow({ where: { companyId: termsCompanyId, name: "Bare Minimum LLC" } });
    expect(contact.defaultRetainagePercent).toBeNull();
    expect(contact.paymentTermsDays).toBeNull();
    expect(contact.standardFormsUsed).toBeNull();
  });

  it("refuses a non-numeric payment terms value, same validation as updateContact", async () => {
    const formData = new FormData();
    formData.set("name", "Bad Terms Inc");
    formData.set("paymentTermsDays", "net-30");

    const result = await createContact(formData);
    expect(result).toEqual({ ok: false, error: '"paymentTermsDays" must be a number' });

    const contact = await prisma.contact.findFirst({ where: { companyId: termsCompanyId, name: "Bad Terms Inc" } });
    expect(contact).toBeNull();
  });
});
