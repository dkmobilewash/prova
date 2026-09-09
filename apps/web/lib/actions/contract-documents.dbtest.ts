import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Issue #106, against a real Postgres:
 *
 *   - finding 5: ContractDocument.versionNumber comes from a counter row,
 *     same shape as InvoiceCounter — not MAX(versionNumber) + 1;
 *   - finding 3: deleting a ContractDocument row also deletes the blob
 *     behind it, and a storage-side failure doesn't block the row delete.
 *
 * `@vercel/blob`'s `put` and `del` are mocked — a real dbtest cannot hit
 * real Vercel Blob storage, and does not need to: everything worth
 * proving here is what the ROW-level logic does with what the SDK
 * returns, not the SDK itself.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it — CI has no
 * database. Run it against a SCRATCH one, same invocation as
 * billing.dbtest.ts documents.
 */

const context = { company: { id: "" }, id: "user_1", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const deletedUrls: string[] = [];
let nextPutUrl = "https://blob.test/contracts/x";
let failNextDelete = false;

vi.mock("@vercel/blob", () => ({
  put: async () => ({ url: nextPutUrl, pathname: "contracts/x" }),
  del: async (url: string) => {
    deletedUrls.push(url);
    if (failNextDelete) {
      failNextDelete = false;
      throw new Error("simulated blob store failure");
    }
  },
}));

const { uploadContractDocument, deleteContractDocument } = await import("./billing");

function fileForm(fileName: string) {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], fileName, { type: "application/pdf" }));
  return fd;
}

describe("ContractDocument versions come from a counter, against a real database", () => {
  const ctx = { companyId: "", jobId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Contract Doc Counter Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const user = await prisma.user.create({
      data: { companyId: company.id, clerkId: "clerk_doc_counter", email: "doc-counter@test.example", role: "OWNER" },
    });
    context.id = user.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Doc Counter GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Doc Counter Job", status: "CONTRACTED" },
    });
    ctx.jobId = job.id;
  });

  afterAll(async () => {
    await prisma.contractDocument.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.user.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
    await prisma.$disconnect();
  });

  it("issues version 1, then 2, and records the counter alongside", async () => {
    await uploadContractDocument(ctx.jobId, fileForm("subcontract.pdf"));
    await uploadContractDocument(ctx.jobId, fileForm("subcontract.pdf"));

    const versions = (
      await prisma.contractDocument.findMany({ where: { jobId: ctx.jobId }, orderBy: { versionNumber: "asc" } })
    ).map((d) => d.versionNumber);
    expect(versions).toEqual([1, 2]);

    const counter = await prisma.contractDocumentVersionCounter.findUnique({ where: { jobId: ctx.jobId } });
    expect(counter?.lastNumber).toBe(2);
  });

  it("does NOT reissue a version number after the row it belonged to is removed — the exact bug this replaced", async () => {
    // Delete version 2, then re-upload: under the old
    // `MAX(versionNumber) + 1`, the new upload would ALSO be "Version 2",
    // so two different legal documents would share a version label. The
    // counter must issue 3 instead.
    const v2 = await prisma.contractDocument.findFirstOrThrow({ where: { jobId: ctx.jobId, versionNumber: 2 } });
    await prisma.contractDocument.delete({ where: { id: v2.id } });

    await uploadContractDocument(ctx.jobId, fileForm("subcontract-amendment.pdf"));

    const versions = (
      await prisma.contractDocument.findMany({ where: { jobId: ctx.jobId }, orderBy: { versionNumber: "asc" } })
    ).map((d) => d.versionNumber);
    expect(versions).toEqual([1, 3]);
  });

  it("cannot issue the same version number twice when two uploads race", async () => {
    await Promise.all([
      uploadContractDocument(ctx.jobId, fileForm("a.pdf")),
      uploadContractDocument(ctx.jobId, fileForm("b.pdf")),
      uploadContractDocument(ctx.jobId, fileForm("c.pdf")),
    ]);

    const versions = (
      await prisma.contractDocument.findMany({ where: { jobId: ctx.jobId }, orderBy: { versionNumber: "asc" } })
    ).map((d) => d.versionNumber);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual([1, 3, 4, 5, 6]);
  });
});

describe("deleteContractDocument also deletes the blob — issue #106 finding 3", () => {
  const ctx = { companyId: "", jobId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Contract Doc Delete Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const user = await prisma.user.create({
      data: { companyId: company.id, clerkId: "clerk_doc_delete", email: "doc-delete@test.example", role: "OWNER" },
    });
    context.id = user.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Doc Delete GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Doc Delete Job", status: "CONTRACTED" },
    });
    ctx.jobId = job.id;
  });

  afterAll(async () => {
    await prisma.contractDocument.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.user.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
  });

  it("deletes the row and calls del() with the document's own fileUrl", async () => {
    nextPutUrl = "https://blob.test/contracts/subcontract-DELETE-ME.pdf";
    await uploadContractDocument(ctx.jobId, fileForm("subcontract.pdf"));
    const doc = await prisma.contractDocument.findFirstOrThrow({ where: { jobId: ctx.jobId } });
    expect(doc.fileUrl).toBe(nextPutUrl);

    deletedUrls.length = 0;
    await deleteContractDocument(doc.id);

    expect(await prisma.contractDocument.findUnique({ where: { id: doc.id } })).toBeNull();
    // This is the whole defect: before the fix, `del` was never imported
    // from `@vercel/blob` anywhere in the repo, so the row went and the
    // file stayed public forever at this exact URL.
    expect(deletedUrls).toEqual([nextPutUrl]);
  });

  it("still deletes the row even when the blob delete fails", async () => {
    // A storage-API blip must not leave a document a person is actively
    // trying to remove (often BECAUSE it should no longer be public)
    // stuck in the database. Best-effort by design — see
    // lib/blob.ts's `deleteDocument` comment.
    nextPutUrl = "https://blob.test/contracts/subcontract-FAILS-TO-DELETE.pdf";
    await uploadContractDocument(ctx.jobId, fileForm("subcontract.pdf"));
    const doc = await prisma.contractDocument.findFirstOrThrow({
      where: { jobId: ctx.jobId, fileUrl: nextPutUrl },
    });

    failNextDelete = true;
    await expect(deleteContractDocument(doc.id)).resolves.toBeUndefined();

    expect(await prisma.contractDocument.findUnique({ where: { id: doc.id } })).toBeNull();
  });
});
