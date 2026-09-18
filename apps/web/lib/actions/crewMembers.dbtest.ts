import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Archiving a crew member, against a real Postgres. The CrewMember identity
 * trigger locks the legal name and the last four; this proves `archivedAt`
 * is not among what it locks, that the refusals come back as sentences, and
 * that the person's logged hours are untouched.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { archiveCrewMember } = await import("./crewMembers");

let crewMemberId = "";
let jobId = "";

describe("archiveCrewMember", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Archive Crew Co" } });
    context.company.id = company.id;
    const owner = await prisma.user.create({
      data: { companyId: company.id, clerkId: `arch_${Date.now()}`, email: `arch_${Date.now()}@example.test`, role: "OWNER" },
    });
    context.id = owner.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Job" } })).id;
    const member = await prisma.crewMember.create({
      data: { companyId: company.id, legalFirstName: "Hanna", legalLastName: "Hanger" },
    });
    crewMemberId = member.id;
    await prisma.timeEntry.create({
      data: { jobId, crewMemberId, date: new Date("2026-09-10T00:00:00Z"), hours: "8" },
    });
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await prisma.crewMember.deleteMany({ where: { companyId: context.company.id } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("refuses anyone but the owner, before writing anything", async () => {
    context.role = "MEMBER";
    expect(await archiveCrewMember(crewMemberId)).toMatchObject({ ok: false, error: expect.stringMatching(/owner/) });
    context.role = "OWNER";
    expect((await prisma.crewMember.findUniqueOrThrow({ where: { id: crewMemberId } })).archivedAt).toBeNull();
  });

  it("archives, keeps their hours, and says so if asked twice", async () => {
    expect(await archiveCrewMember(crewMemberId)).toEqual({ ok: true });
    expect((await prisma.crewMember.findUniqueOrThrow({ where: { id: crewMemberId } })).archivedAt).not.toBeNull();
    expect(await prisma.timeEntry.count({ where: { crewMemberId } })).toBe(1);
    expect(await archiveCrewMember(crewMemberId)).toMatchObject({ ok: false, error: expect.stringMatching(/already archived/) });
  });

  it("refuses a crew member from another company", async () => {
    const other = await prisma.company.create({ data: { name: "Other Co" } });
    const theirs = await prisma.crewMember.create({ data: { companyId: other.id, legalFirstName: "Not", legalLastName: "Yours" } });
    expect(await archiveCrewMember(theirs.id)).toMatchObject({ ok: false });
    await prisma.crewMember.delete({ where: { id: theirs.id } });
    await prisma.company.delete({ where: { id: other.id } });
  });
});
