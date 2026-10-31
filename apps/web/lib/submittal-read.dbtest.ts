import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The whole path with the model mocked: a section reached through the job, drafts
 * written with the model, prompt version and pages recorded, nothing numbered
 * until accepted, re-reads that do not repeat a decision, and the register row a
 * person gets. A real PDF fetch and model call are out of scope here.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/document-uploads", async (original) => ({
  ...(await original<typeof import("@/lib/document-uploads")>()),
  documentUrlProblem: () => null,
}));
vi.mock("@/lib/specs/read-stored-section", () => ({
  readStoredSpecSection: async () => ({ ok: true, buffer: Buffer.from("%PDF-1.4"), mediaType: "application/pdf" }),
}));
vi.mock("@/lib/ai/settings", () => ({
  aiGate: async () => ({ ok: true, model: "test-model", settings: { specPagesPerMonth: 1000 } }),
}));
vi.mock("@/lib/ask/usage", async (original) => ({
  ...(await original<typeof import("@/lib/ask/usage")>()),
  recordAskUsage: async () => undefined,
}));
vi.mock("@/lib/ask/specSpend", () => ({
  claimSpecPages: vi.fn(async () => ({ ok: true, claim: {}, charge: { pages: 12 }, note: "12 pages.", pagesLeft: 988 })),
  markSpecFailure: vi.fn(async () => undefined),
}));
const extract = vi.fn();
vi.mock("@prova/integrations", async (original) => ({
  ...(await original<typeof import("@prova/integrations")>()),
  extractSubmittalRequirements: (...args: unknown[]) => extract(...args),
}));

const { readSubmittalRequirements } = await import("./actions/submittalRead");
const { acceptSubmittalProposals, dismissSubmittalProposal } = await import("./actions/submittals");
const { markSpecFailure } = await import("@/lib/ask/specSpend");

let companyId = "", jobId = "", otherJobId = "", sectionId = "", bidId = "";

const row = (ordinal: number, kind: string, requirement: string) => ({
  ordinal, kind, requirement, confidence: "HIGH", quote: `${requirement}.`, sourcePageLabel: "p 2",
});
const accept = (ids: string[], merge = false) => {
  const fd = new FormData();
  for (const id of ids) fd.append("proposalId", id);
  if (merge) fd.set("merge", "on");
  return acceptSubmittalProposals(jobId, fd);
};
const drafts = () => prisma.submittalProposal.findMany({ where: { jobId, status: "PROPOSED" }, orderBy: { createdAt: "asc" } });

describe("reading a section into draft register rows", () => {
  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: "Submittal Read Co" } })).id;
    context.company.id = companyId;
    context.id = (await prisma.user.create({ data: { companyId, clerkId: `sr_${Date.now()}`, email: `sr_${Date.now()}@example.test`, role: "OWNER" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Won", status: "CONTRACTED" } })).id;
    otherJobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Other", status: "CONTRACTED" } })).id;
    bidId = (await prisma.bidInvitation.create({ data: { companyId, contactId: contact.id, projectName: "Bid", wonJobId: jobId } })).id;
    sectionId = (await prisma.bidSpecSection.create({ data: { bidInvitationId: bidId, sectionNumber: "09 22 16", fileUrl: "https://x.test/s.pdf" } })).id;
  });

  beforeEach(() => {
    extract.mockReset();
  });

  afterAll(async () => {
    await prisma.submittalProposal.deleteMany({ where: { jobId } });
    await prisma.submittalSpecReading.deleteMany({ where: { jobId } });
    await prisma.submittal.deleteMany({ where: { jobId } });
    await prisma.submittalCounter.deleteMany({ where: { jobId } });
    await prisma.bidInvitation.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("refuses a section that is not on this job, before anything is charged", async () => {
    expect(await readSubmittalRequirements(otherJobId, sectionId)).toMatchObject({ ok: false });
    expect(extract).not.toHaveBeenCalled();
  });

  it("writes drafts and records model, prompt version and pages, with no submittal yet", async () => {
    extract.mockResolvedValue({
      readingReason: "Read Part 1.",
      requirements: [row(1, "PRODUCT_DATA", "Product data"), row(2, "SHOP_DRAWINGS", "Shop drawings"), row(3, "SAMPLES", "Samples")],
    });
    expect(await readSubmittalRequirements(jobId, sectionId)).toMatchObject({ ok: true, value: { draftCount: 3 } });
    const reading = await prisma.submittalSpecReading.findFirstOrThrow({ where: { jobId } });
    expect(reading).toMatchObject({ model: "test-model", promptVersion: "submittal-read.1", pagesCharged: 12, startedByUserId: context.id });
    expect((await drafts()).map((d) => [d.sectionNumber, d.kind])).toEqual([
      ["09 22 16", "PRODUCT_DATA"], ["09 22 16", "SHOP_DRAWINGS"], ["09 22 16", "SAMPLES"],
    ]);
    expect(await prisma.submittal.count({ where: { jobId } })).toBe(0);
  });

  it("takes a number only on accept, once, and cites the quote", async () => {
    const [first] = await drafts();
    expect(await accept([first.id])).toEqual({ ok: true });
    const made = await prisma.submittal.findFirstOrThrow({ where: { jobId } });
    expect(made).toMatchObject({ number: 1, title: "Product data: Product data", specSection: "09 22 16" });
    expect(made.description).toContain('"Product data."');
    expect(await accept([first.id])).toMatchObject({ ok: false });
    expect(await prisma.submittal.count({ where: { jobId } })).toBe(1);
  });

  it("dismisses a draft, and a re-read replaces undecided drafts without repeating decisions", async () => {
    const [shop] = (await drafts()).filter((d) => d.kind === "SHOP_DRAWINGS");
    expect(await dismissSubmittalProposal(shop.id)).toEqual({ ok: true });
    expect(await dismissSubmittalProposal(shop.id)).toMatchObject({ ok: false });
    extract.mockResolvedValue({
      readingReason: "Again.",
      requirements: [row(1, "PRODUCT_DATA", "Product data"), row(2, "SHOP_DRAWINGS", "Shop drawings"), row(3, "CERTIFICATES", "Fire test report"), row(4, "SAMPLES", "Board sample")],
    });
    expect(await readSubmittalRequirements(jobId, sectionId)).toMatchObject({ ok: true, value: { draftCount: 2 } });
    expect((await drafts()).map((d) => d.requirement)).toEqual(["Fire test report", "Board sample"]);
    expect(await prisma.submittalProposal.count({ where: { jobId, status: "DISMISSED" } })).toBe(1);
    expect(await prisma.submittalProposal.count({ where: { jobId, status: "ACCEPTED" } })).toBe(1);
  });

  it("merges ticked drafts into one numbered submittal", async () => {
    const both = await drafts();
    expect(await accept(both.map((d) => d.id), true)).toEqual({ ok: true });
    const made = await prisma.submittal.findFirstOrThrow({ where: { jobId, number: 2 } });
    expect(made.title).toBe("Section 09 22 16: Certificates, Samples");
    expect(await prisma.submittalProposal.count({ where: { submittalId: made.id } })).toBe(2);
    expect(await prisma.submittal.count({ where: { jobId } })).toBe(2);
  });

  it("marks the pages, saves nothing and tells the person when the model fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    extract.mockImplementation(async () => {
      throw new Error("the provider failed");
    });
    const before = await prisma.submittalSpecReading.count({ where: { jobId } });
    expect(await readSubmittalRequirements(jobId, sectionId)).toMatchObject({ ok: false });
    expect(markSpecFailure).toHaveBeenCalled();
    expect(await prisma.submittalSpecReading.count({ where: { jobId } })).toBe(before);
    expect((await prisma.bidSpecSection.findUniqueOrThrow({ where: { id: sectionId } })).readInFlightAt).toBeNull();
    logged.mockRestore();
  });
});
