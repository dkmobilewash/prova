import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/** A job's spec book against real rows: the winning bid's sections reach it
 * uncopied, a job with no bid can hold its own, the database refuses a section
 * with no owner, and another company's rows answer as if they were not there. */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { saveJobSpecSection, deleteJobSpecSection, readSpecSection, attachSpecSectionDocument } = await import("./actions/specRead");
const { loadJobSpecSections } = await import("./job-spec-sections-query");

let companyId = "", otherCompanyId = "", wonJobId = "", plainJobId = "", otherJobId = "", bidSectionId = "";

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

describe("a job's spec book", () => {
  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: "Spec Co" } })).id;
    otherCompanyId = (await prisma.company.create({ data: { name: "Other Spec Co" } })).id;
    context.company.id = companyId;
    context.id = (await prisma.user.create({ data: { companyId, clerkId: `js_${Date.now()}`, email: `js_${Date.now()}@example.test`, role: "OWNER" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    const otherContact = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "GC" } });
    wonJobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Won", status: "CONTRACTED" } })).id;
    plainJobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "No bid", status: "CONTRACTED" } })).id;
    otherJobId = (await prisma.job.create({ data: { companyId: otherCompanyId, contactId: otherContact.id, name: "Theirs" } })).id;
    const bid = await prisma.bidInvitation.create({ data: { companyId, contactId: contact.id, projectName: "Won bid", wonJobId } });
    bidSectionId = (await prisma.bidSpecSection.create({ data: { bidInvitationId: bid.id, sectionNumber: "09 21 16" } })).id;
  });

  afterAll(async () => {
    await prisma.bidSpecSection.deleteMany({ where: { OR: [{ id: bidSectionId }, { jobId: { in: [wonJobId, plainJobId, otherJobId] } }] } });
    await prisma.bidInvitation.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await prisma.$disconnect();
  });

  it("reaches the winning bid's sections without copying them", async () => {
    expect((await loadJobSpecSections(wonJobId, companyId)).map((s) => [s.sectionNumber, s.jobId])).toEqual([["09 21 16", null]]);
    expect(await prisma.bidSpecSection.count({ where: { sectionNumber: "09 21 16" } })).toBe(1);
  });

  it("lets a job with no bid hold its own section, and only that job sees it", async () => {
    expect(await saveJobSpecSection(plainJobId, form({ sectionNumber: "09 22 16", title: "Framing" }))).toEqual({ ok: true });
    expect((await loadJobSpecSections(plainJobId, companyId)).map((s) => s.sectionNumber)).toEqual(["09 22 16"]);
    expect((await loadJobSpecSections(wonJobId, companyId)).map((s) => s.sectionNumber)).toEqual(["09 21 16"]);
  });

  it("is refused by the database when a section has no owner", async () => {
    await expect(prisma.bidSpecSection.create({ data: { sectionNumber: "00 00 00" } })).rejects.toThrow(/BidSpecSection_has_an_owner/);
  });

  it("answers another company's job and section as if they were not there", async () => {
    expect(await saveJobSpecSection(otherJobId, form({ sectionNumber: "1" }))).toEqual({ ok: false, error: "That job is not on your account." });
    const theirs = await prisma.bidSpecSection.create({ data: { jobId: otherJobId, sectionNumber: "2" } });
    expect(await deleteJobSpecSection(theirs.id)).toMatchObject({ ok: false });
    expect(await attachSpecSectionDocument(theirs.id, "https://x.test/a.pdf", "a.pdf")).toMatchObject({ ok: false });
    expect(await loadJobSpecSections(otherJobId, companyId)).toEqual([]);
  });

  it("will not delete a bid's section from the job side, and removes the job's own", async () => {
    expect(await deleteJobSpecSection(bidSectionId)).toMatchObject({ ok: false });
    const own = await prisma.bidSpecSection.findFirstOrThrow({ where: { jobId: plainJobId } });
    expect(await deleteJobSpecSection(own.id)).toEqual({ ok: true });
  });

  it("keeps the cost reader on bids: a job's own section is refused before anything is charged", async () => {
    const own = await prisma.bidSpecSection.create({ data: { jobId: plainJobId, sectionNumber: "3", fileUrl: "https://x.test/a.pdf" } });
    expect(await readSpecSection(own.id)).toMatchObject({ ok: false, error: "That spec section is no longer on this bid." });
  });
});
