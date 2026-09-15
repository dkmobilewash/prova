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
 * `@vercel/blob`'s `del` is mocked — a real dbtest cannot hit real Vercel
 * Blob storage, and does not need to: everything worth proving here is
 * what the ROW-level logic does, not the SDK itself.
 *
 * `put` USED TO BE MOCKED HERE TOO and no longer needs to be: since #27
 * the file never passes through `uploadContractDocument` at all. A Server
 * Action body is capped at 1MB by Next, multipart parts included, so the
 * upload this action used to perform could not carry a real subcontract.
 * The browser uploads to the store directly and the action is given the
 * URL — which it re-checks against our own store and this job's own
 * folder, so these forms now carry a URL of exactly the shape the store
 * issues. `isOurBlobStoreUrl` reads which store is ours out of the
 * credentials, hence `BLOB_STORE_ID` below.
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

const OUR_STORE = "teststore1";
process.env.BLOB_STORE_ID = OUR_STORE;

const deletedUrls: string[] = [];
let failNextDelete = false;

vi.mock("@vercel/blob", () => ({
  del: async (url: string) => {
    deletedUrls.push(url);
    if (failNextDelete) {
      failNextDelete = false;
      throw new Error("simulated blob store failure");
    }
  },
}));

const { uploadContractDocument, deleteContractDocument } = await import("./billing");

/** What the browser sends once `upload()` has finished: the URL the store
 * returned, with the random suffix the token asked for, and the name of
 * the file the person actually picked. */
function storedUrl(jobId: string, fileName: string) {
  return `https://${OUR_STORE}.public.blob.vercel-storage.com/contracts/${jobId}/${fileName.replace(/\.pdf$/, "")}-r4nd0m${uploadSeq}.pdf`;
}

let uploadSeq = 0;

function fileForm(fileName: string, jobId?: string) {
  uploadSeq += 1;
  const fd = new FormData();
  fd.set("fileUrl", storedUrl(jobId ?? currentJobId, fileName));
  fd.set("fileName", fileName);
  return fd;
}

/** The job the next `fileForm()` builds a URL for. Set by each block's
 * own setup, because the URL has to name the job the upload is for —
 * which is the point of the check the action now runs. */
let currentJobId = "";

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
    currentJobId = job.id;
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

describe("ContractDocumentVersionCounter is a cleanup-script hazard, same shape as #227's InvoiceCounter", () => {
  const ctx = { companyId: "", jobId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Doc Counter Cleanup Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const user = await prisma.user.create({
      data: { companyId: company.id, clerkId: "clerk_doc_cleanup", email: "doc-cleanup@test.example", role: "OWNER" },
    });
    context.id = user.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Cleanup GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Cleanup Job", status: "CONTRACTED" },
    });
    ctx.jobId = job.id;
    currentJobId = job.id;
    await uploadContractDocument(ctx.jobId, fileForm("cleanup-test.pdf"));
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.user.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.deleteMany({ where: { id: ctx.companyId } });
    await prisma.$disconnect();
  });

  it("is keyed on jobId and outlives its ContractDocument rows, so deleting the documents alone does NOT free the job", async () => {
    await prisma.contractDocument.deleteMany({ where: { jobId: ctx.jobId } });

    const counter = await prisma.contractDocumentVersionCounter.findUnique({ where: { jobId: ctx.jobId } });
    expect(counter).not.toBeNull();

    // RESTRICT on Job: the counter alone is enough to block the job delete,
    // exactly the failure #227 found for InvoiceCounter — a cleanup script
    // that deletes only the child evidence rows and not this counter dies
    // partway through `job.delete()` on real data.
    //
    // NAMED rather than merely thrown. This was `rejects.toThrow()`, which
    // passes if ANY child blocks the job — the Contact does, and a relation
    // added tomorrow would too — so it could stay green while saying nothing
    // about this counter, which is the only thing it is here to prove.
    // Same assertion as billing.dbtest.ts's InvoiceCounter case.
    const blocked = await prisma.job
      .delete({ where: { id: ctx.jobId } })
      .then(() => null)
      .catch((error: unknown) => error as { meta?: { constraint?: string } });
    expect(blocked).not.toBeNull();
    expect(blocked?.meta?.constraint).toBe("ContractDocumentVersionCounter_jobId_fkey");
  });

  it("deleting the counter too is what actually frees the job — the fix in scratch-scope.mjs / clean-scratch-data.mjs / seed-demo.mjs", async () => {
    await prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: ctx.jobId } });
    await expect(prisma.job.delete({ where: { id: ctx.jobId } })).resolves.toBeTruthy();
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
    currentJobId = job.id;
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
    const form = fileForm("subcontract-DELETE-ME.pdf");
    const uploadedUrl = String(form.get("fileUrl"));
    await uploadContractDocument(ctx.jobId, form);
    const doc = await prisma.contractDocument.findFirstOrThrow({ where: { jobId: ctx.jobId } });
    // The URL the BROWSER got back from the store is the one stored —
    // nothing rebuilds it from a requested path, which would drop the
    // random suffix and name a blob that does not exist.
    expect(doc.fileUrl).toBe(uploadedUrl);

    deletedUrls.length = 0;
    await deleteContractDocument(doc.id);

    expect(await prisma.contractDocument.findUnique({ where: { id: doc.id } })).toBeNull();
    // This is the whole defect: before the fix, `del` was never imported
    // from `@vercel/blob` anywhere in the repo, so the row went and the
    // file stayed public forever at this exact URL.
    expect(deletedUrls).toEqual([uploadedUrl]);
  });

  it("still deletes the row even when the blob delete fails", async () => {
    // A storage-API blip must not leave a document a person is actively
    // trying to remove (often BECAUSE it should no longer be public)
    // stuck in the database. Best-effort by design — see
    // lib/blob.ts's `deleteDocument` comment.
    const form = fileForm("subcontract-FAILS-TO-DELETE.pdf");
    await uploadContractDocument(ctx.jobId, form);
    const doc = await prisma.contractDocument.findFirstOrThrow({
      where: { jobId: ctx.jobId, fileUrl: String(form.get("fileUrl")) },
    });

    failNextDelete = true;
    await expect(deleteContractDocument(doc.id)).resolves.toBeUndefined();

    expect(await prisma.contractDocument.findUnique({ where: { id: doc.id } })).toBeNull();
  });
});
