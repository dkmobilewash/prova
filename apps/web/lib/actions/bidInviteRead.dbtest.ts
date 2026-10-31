import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `checkSameJobFromOtherGc` against a real Postgres: the read is scoped to the
 * session's company and to OPEN invitations, the due date comes back from a
 * Date as the right ISO day, and the `Site:` line is read out of real notes.
 * The rules themselves are `bid-invitation.sameJob.test.ts`'s.
 */

const session = { company: { id: "" }, id: "user_1", role: "OWNER", jobFunction: null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => session }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { checkSameJobFromOtherGc } = await import("./bidInviteRead");

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let companyId = "";
let otherCompanyId = "";
let acmeId = "";
let bakerId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Same Job Test Co" } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: "Another Tenant" } })).id;
  session.company.id = companyId;
  acmeId = (await prisma.contact.create({ data: { companyId, name: "Acme Builders" } })).id;
  bakerId = (await prisma.contact.create({ data: { companyId, name: "Baker Construction" } })).id;
  const theirGc = (await prisma.contact.create({ data: { companyId: otherCompanyId, name: "Their GC" } })).id;

  await prisma.bidInvitation.createMany({
    data: [
      {
        companyId,
        contactId: bakerId,
        projectName: "Riverside Medical Office",
        dueDate: day("2026-11-04"),
        notes: "Bid due time: 2 PM\nSite: 4500 Brockton Ave, Riverside CA",
      },
      // Closed: never a match, whatever it says.
      { companyId, contactId: bakerId, projectName: "Riverside Medical Office", status: "LOST", dueDate: day("2026-11-04") },
      // Another tenant's identical invitation: never visible.
      { companyId: otherCompanyId, contactId: theirGc, projectName: "Riverside Medical Office", dueDate: day("2026-11-04") },
    ],
  });
});

afterAll(async () => {
  for (const id of [companyId, otherCompanyId]) {
    await prisma.bidInvitation.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("checkSameJobFromOtherGc", () => {
  it("finds the one open invitation from another GC in this company, with its reasons in words", async () => {
    const result = await checkSameJobFromOtherGc({
      contactId: acmeId,
      projectName: "Riverside Medical Office",
      dueDate: "2026-11-04",
      notes: "Site: 4500 Brockton Avenue, Riverside, CA 92501",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.map((match) => match.sentence)).toEqual([
      "Same name, site address and due date as Riverside Medical Office from Baker Construction",
    ]);
  });

  it("says nothing when the GC logging it is the one already on file", async () => {
    const result = await checkSameJobFromOtherGc({
      contactId: bakerId,
      projectName: "Riverside Medical Office",
      dueDate: "2026-11-04",
      notes: null,
    });
    expect(result).toEqual({ ok: true, value: [] });
  });
});
