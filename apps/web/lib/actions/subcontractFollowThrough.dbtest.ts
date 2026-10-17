import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * PHASE 3 AGAINST A REAL DATABASE: the rider becomes a real contract version
 * (counter, file, link), and a confirmed deadline reaches the alerts engine.
 * Only the blob store is faked — `put` records the PDF bytes it was handed.
 */

const context = { company: { id: "", name: "ZZ Drywall" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const OUR_STORE = "teststore1";
process.env.BLOB_STORE_ID = OUR_STORE;
const written: { pathname: string; bytes: Buffer }[] = [];
let failNextPut = false;
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer) => {
    if (failNextPut) {
      failNextPut = false;
      throw new Error("store down");
    }
    written.push({ pathname, bytes: body });
    return { url: `https://${OUR_STORE}.public.blob.vercel-storage.com/${pathname.replace(/\.pdf$/, "")}-r4nd0m${written.length}.pdf` };
  },
  del: async () => {},
}));

const actions = await import("./subcontractFollowThrough");
const { loadAlerts } = await import("@/lib/alerts-query");
const { documentUrlProblem } = await import("@/lib/document-uploads");
const { extractPdfPages } = await import("@/lib/subcontract-review/pageText");

describe("subcontract review, phase 3, against a real database", () => {
  const ctx = { companyId: "", jobId: "", otherCompanyId: "", otherObligationId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "ZZ Drywall" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const user = await prisma.user.create({ data: { companyId: company.id, clerkId: "clerk_followthrough", email: "ft@test.example", role: "OWNER" } });
    context.id = user.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Example Builders" } });
    const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "ZZ Office" } });
    ctx.jobId = job.id;
    // Version 1 exists already, so the rider must be issued 2 — by the counter.
    await prisma.$transaction(async (tx) => {
      await tx.contractDocumentVersionCounter.upsert({ where: { jobId: job.id }, create: { jobId: job.id, lastNumber: 1 }, update: {} });
      await tx.contractDocument.create({ data: { jobId: job.id, versionNumber: 1, fileUrl: "https://x/contract.pdf", fileName: "contract.pdf" } });
    });
    await prisma.jobProposalClause.create({ data: { companyId: company.id, jobId: job.id, kind: "EXCLUSION", text: "Fire caulking is excluded." } });

    const other = await prisma.company.create({ data: { name: "Someone Else" } });
    ctx.otherCompanyId = other.id;
    const otherContact = await prisma.contact.create({ data: { companyId: other.id, name: "GC" } });
    const otherJob = await prisma.job.create({ data: { companyId: other.id, contactId: otherContact.id, name: "Theirs" } });
    ctx.otherObligationId = (await prisma.subcontractObligation.create({ data: { jobId: otherJob.id, kind: "NOTICE_WINDOW", label: "Theirs", windowHours: 24 } })).id;
  });

  afterAll(async () => {
    for (const companyId of [ctx.companyId, ctx.otherCompanyId]) {
      const jobs = await prisma.job.findMany({ where: { companyId }, select: { id: true } });
      const jobIds = jobs.map((j) => j.id);
      await prisma.subcontractRider.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.contractDocument.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.jobProposalClause.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { companyId } });
      await prisma.contact.deleteMany({ where: { companyId } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    }
    await prisma.$disconnect();
  });

  it("drafts a rider from the job's clauses, saves an edit, and files it as the next version via the counter", async () => {
    const created = await actions.createSubcontractRider(ctx.jobId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const draft = await prisma.subcontractRider.findUniqueOrThrow({ where: { id: created.value.riderId } });
    expect(draft.body).toContain("- Fire caulking is excluded.");

    const form = new FormData();
    form.set("title", "Rider to Subcontract — ZZ Office");
    form.set("body", `${draft.body}\n\n## Added by hand\n- Hoisting by others.`);
    expect(await actions.saveSubcontractRider(draft.id, form)).toEqual({ ok: true });

    const attached = await actions.attachSubcontractRider(draft.id);
    expect(attached).toEqual({ ok: true, value: { versionNumber: 2 } });

    const rider = await prisma.subcontractRider.findUniqueOrThrow({ where: { id: draft.id }, include: { attachedContractDocument: true } });
    expect(rider.status).toBe("ATTACHED");
    expect(rider.attachedContractDocument?.versionNumber).toBe(2);
    const counter = await prisma.contractDocumentVersionCounter.findUniqueOrThrow({ where: { jobId: ctx.jobId } });
    expect(counter.lastNumber).toBe(2);
    // The file is where a contract-document must be — the DocuSign path re-checks exactly this.
    expect(documentUrlProblem(rider.attachedContractDocument!.fileUrl, "contract-document", ctx.jobId, process.env)).toBeNull();
    // And it is the SAVED text, as a real PDF.
    const text = (await extractPdfPages(written.at(-1)!.bytes)).flat().join(" ");
    expect(text).toContain("Hoisting by others.");
  });

  it("freezes an attached rider, and refuses a second attach", async () => {
    const rider = await prisma.subcontractRider.findFirstOrThrow({ where: { jobId: ctx.jobId, status: "ATTACHED" } });
    const form = new FormData();
    form.set("title", "x");
    form.set("body", "y");
    expect((await actions.saveSubcontractRider(rider.id, form)).ok).toBe(false);
    expect((await actions.attachSubcontractRider(rider.id)).ok).toBe(false);
    expect((await actions.deleteSubcontractRider(rider.id)).ok).toBe(false);
  });

  it("files nothing when the PDF cannot be stored — no version, no counter bump, rider still a draft", async () => {
    const created = await actions.createSubcontractRider(ctx.jobId);
    if (!created.ok) throw new Error(created.error);
    failNextPut = true;
    expect((await actions.attachSubcontractRider(created.value.riderId)).ok).toBe(false);
    expect((await prisma.contractDocumentVersionCounter.findUniqueOrThrow({ where: { jobId: ctx.jobId } })).lastNumber).toBe(2);
    expect((await prisma.subcontractRider.findUniqueOrThrow({ where: { id: created.value.riderId } })).status).toBe("DRAFT");
    expect(await actions.deleteSubcontractRider(created.value.riderId)).toEqual({ ok: true });
  });

  it("puts a confirmed notice window on the job's alerts as STANDING, and a dated one as OVERDUE once past", async () => {
    const notice = new FormData();
    notice.set("kind", "NOTICE_WINDOW");
    notice.set("label", "48-hour delay notice");
    notice.set("windowHours", "48");
    notice.set("recipient", "the Project Manager");
    notice.set("form", "in writing");
    expect(await actions.confirmSubcontractObligation(ctx.jobId, notice)).toEqual({ ok: true });

    const dated = new FormData();
    dated.set("kind", "DATED");
    dated.set("label", "Certificates before mobilization");
    dated.set("dueOn", "2026-10-10");
    expect(await actions.confirmSubcontractObligation(ctx.jobId, dated)).toEqual({ ok: true });

    const { visible } = await loadAlerts(ctx.companyId, context.id, "2026-10-17");
    const ours = visible.filter((a) => a.kind === "SUBCONTRACT_OBLIGATION");
    expect(ours.map((a) => a.severity).sort()).toEqual(["OVERDUE", "STANDING"]);
    expect(ours.find((a) => a.severity === "STANDING")!.title).toBe("48-hour delay notice applies on ZZ Office");
    // Never another company's.
    expect(ours.some((a) => a.title.includes("Theirs"))).toBe(false);
  });

  it("refuses a nonsense date or window, and another company's row", async () => {
    const bad = new FormData();
    bad.set("kind", "DATED");
    bad.set("label", "x");
    bad.set("dueOn", "2026-02-31");
    expect((await actions.confirmSubcontractObligation(ctx.jobId, bad)).ok).toBe(false);
    const noWindow = new FormData();
    noWindow.set("kind", "NOTICE_WINDOW");
    noWindow.set("label", "notice");
    expect((await actions.confirmSubcontractObligation(ctx.jobId, noWindow)).ok).toBe(false);
    expect((await actions.removeSubcontractObligation(ctx.otherObligationId)).ok).toBe(false);
  });

  it("stores a confirmed insurance ask cleanly", async () => {
    const form = new FormData();
    form.set("coverage", "GENERAL_LIABILITY");
    form.set("limitPerOccurrence", "$1,000,000");
    form.set("limitAggregate", "2,000,000");
    form.set("completedOpsYears", "10");
    form.append("endorsements", "ADDITIONAL_INSURED");
    form.append("endorsements", "WAIVER_OF_SUBROGATION");
    form.append("endorsements", "NOT_A_REAL_ONE");
    expect(await actions.confirmSubcontractInsurance(ctx.jobId, form)).toEqual({ ok: true });
    const row = await prisma.subcontractInsuranceRequirement.findFirstOrThrow({ where: { jobId: ctx.jobId } });
    expect(row.limitPerOccurrence?.toNumber()).toBe(1000000);
    expect(row.limitAggregate?.toNumber()).toBe(2000000);
    expect(row.endorsements).toEqual(["ADDITIONAL_INSURED", "WAIVER_OF_SUBROGATION"]);
    expect(row.completedOpsYears).toBe(10);
  });
});
