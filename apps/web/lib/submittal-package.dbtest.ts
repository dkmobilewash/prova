import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/** The list of what went in reaches the revision, a bad list is refused
 * before anything is written, and a revision sent with no package stays
 * exactly as it always was. */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { sendSubmittalRevision } = await import("./actions/submittals");

let jobId = "";
let submittalId = "";

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

describe("sending a submittal revision with a package list", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Submittal Pkg Co" } });
    context.company.id = company.id;
    const user = await prisma.user.create({
      data: { companyId: company.id, clerkId: `sp_${Date.now()}`, email: `sp_${Date.now()}@example.test`, role: "OWNER" },
    });
    context.id = user.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Pkg Job", status: "CONTRACTED" } });
    jobId = job.id;
    const submittal = await prisma.submittal.create({ data: { companyId: company.id, jobId, number: 1, title: "Board" } });
    submittalId = submittal.id;
  });

  afterAll(async () => {
    await prisma.submittalRevision.deleteMany({ where: { submittalId } });
    await prisma.submittal.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("refuses a list it cannot read, and writes nothing", async () => {
    const result = await sendSubmittalRevision(submittalId, form({ sentOn: "2026-10-01", packageContents: "{nope" }));
    expect(result).toMatchObject({ ok: false });
    expect(await prisma.submittalRevision.count({ where: { submittalId } })).toBe(0);
  });

  it("keeps the names and page counts on the revision", async () => {
    const contents = { files: [{ name: "board.pdf", pages: 3 }], totalPages: 4 };
    expect(await sendSubmittalRevision(submittalId, form({ sentOn: "2026-10-01", packageContents: JSON.stringify(contents) }))).toEqual({ ok: true });
    const revision = await prisma.submittalRevision.findFirstOrThrow({ where: { submittalId } });
    expect(revision.packageContents).toEqual(contents);
  });

  it("leaves the column null when no package was built", async () => {
    await prisma.submittalRevision.updateMany({ where: { submittalId }, data: { returnedOn: new Date("2026-10-05T00:00:00Z"), outcome: "REVISE_AND_RESUBMIT" } });
    expect(await sendSubmittalRevision(submittalId, form({ sentOn: "2026-10-06" }))).toEqual({ ok: true });
    const second = await prisma.submittalRevision.findFirstOrThrow({ where: { submittalId, revisionNumber: 2 } });
    expect(second.packageContents).toBeNull();
  });
});
