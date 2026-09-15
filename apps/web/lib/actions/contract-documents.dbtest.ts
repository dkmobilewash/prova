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

const context = {
  company: { id: "" },
  id: "user_1",
  role: "OWNER" as string,
  // recordExecutedSubcontract asserts MANAGE_JOBS, and capabilities are
  // derived from jobFunction rather than role — an OWNER holds everything
  // regardless, which is why null is the honest value here.
  jobFunction: null as string | null,
};

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
// The OTHER writer of ContractDocument — issue #280. Imported here rather
// than tested only in jobLifecycle.dbtest.ts because what these two do to
// each other is a property of the COUNTER, and this is the counter's file.
const { recordExecutedSubcontract } = await import("./jobs");

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

/* --------------------------------------------------------------- issue #280 */

/**
 * ONE TABLE, TWO WRITERS. `uploadContractDocument` issued from the counter
 * and `recordExecutedSubcontract` used `MAX(versionNumber) + 1`, so the
 * counter only ever heard from one of them and silently fell behind the
 * rows the other wrote.
 *
 * The consequence is not a stale number, it is a PERMANENT OUTAGE on that
 * job: the next counter-issued number already exists, violates
 * @@unique([jobId, versionNumber]), and — because the bump and the insert
 * are one transaction — the failure rolls the bump back, so every retry
 * fails identically for ever.
 *
 * Each case below asserts the ROW STATE, not just that the action returned
 * ok. An action can answer `{ ok: true }` and a counter can still be wrong,
 * and a test reading only the result cannot see it.
 */
describe("both writers of ContractDocument share one counter — issue #280", () => {
  const ctx = { companyId: "", jobId: "" };

  async function newJob(name: string) {
    const contact = await prisma.contact.create({ data: { companyId: ctx.companyId, name: `${name} GC` } });
    const job = await prisma.job.create({
      data: { companyId: ctx.companyId, contactId: contact.id, name, status: "CONTRACTED" },
    });
    currentJobId = job.id;
    return job.id;
  }

  /** What the browser posts once it has uploaded the GC's signed copy. */
  function executedForm(jobId: string, signedDate = "2026-07-04") {
    uploadSeq += 1;
    const fd = new FormData();
    fd.set("fileUrl", storedUrl(jobId, "executed-subcontract.pdf"));
    fd.set("fileName", "executed-subcontract.pdf");
    fd.set("executedSignedDate", signedDate);
    return fd;
  }

  const versionsOf = async (jobId: string) =>
    (
      await prisma.contractDocument.findMany({
        where: { jobId },
        orderBy: { versionNumber: "asc" },
        select: { versionNumber: true },
      })
    ).map((d) => d.versionNumber);

  const counterOf = (jobId: string) =>
    prisma.contractDocumentVersionCounter.findUnique({ where: { jobId } });

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Two Writers Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: "clerk_two_writers",
        email: "two-writers@test.example",
        role: "OWNER",
      },
    });
    context.id = user.id;
  });

  afterAll(async () => {
    const jobs = await prisma.job.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    await prisma.contractDocument.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.user.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
  });

  it("a fresh job: the GC's signed copy is recorded first, and an amendment still uploads after it", async () => {
    // THE ONE-CLICK CASE, and the likeliest real sequence — "the GC already
    // sent the executed subcontract" is often the first thing recorded on a
    // job. Under the bug this left version 1 with NO counter row, so the
    // upsert below created the counter at 1 and collided with it instantly.
    const jobId = await newJob("Fresh Job");

    expect(await recordExecutedSubcontract(jobId, executedForm(jobId))).toEqual({ ok: true });
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 1 });

    const amendment = await uploadContractDocument(jobId, fileForm("amendment.pdf", jobId));
    expect(amendment).toEqual({ ok: true });

    expect(await versionsOf(jobId)).toEqual([1, 2]);
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 2 });
  });

  it("a job with existing uploads: recording the signed copy advances the counter with the row", async () => {
    const jobId = await newJob("Existing Docs Job");

    await uploadContractDocument(jobId, fileForm("original.pdf", jobId));
    await uploadContractDocument(jobId, fileForm("amendment-1.pdf", jobId));
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 2 });

    // Under the bug this wrote version 3 and left the counter at 2.
    expect(await recordExecutedSubcontract(jobId, executedForm(jobId))).toEqual({ ok: true });
    expect(await versionsOf(jobId)).toEqual([1, 2, 3]);
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 3 });

    // ...and this is the upload that used to fail, and go on failing.
    expect(await uploadContractDocument(jobId, fileForm("amendment-2.pdf", jobId))).toEqual({ ok: true });
    expect(await versionsOf(jobId)).toEqual([1, 2, 3, 4]);
  });

  it("alternating writers keep issuing distinct, ascending versions", async () => {
    const jobId = await newJob("Alternating Job");

    await recordExecutedSubcontract(jobId, executedForm(jobId));
    await uploadContractDocument(jobId, fileForm("a.pdf", jobId));
    await recordExecutedSubcontract(jobId, executedForm(jobId, "2026-07-11"));
    await uploadContractDocument(jobId, fileForm("b.pdf", jobId));

    const versions = await versionsOf(jobId);
    expect(versions).toEqual([1, 2, 3, 4]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 4 });
  });

  it("the two writers racing cannot issue the same number", async () => {
    // The cross-writer version of the race the single-writer case above
    // already covers. Before the fix these two took their numbers from
    // different sources entirely, so "racing" was not even required.
    const jobId = await newJob("Racing Job");

    await Promise.all([
      recordExecutedSubcontract(jobId, executedForm(jobId)),
      uploadContractDocument(jobId, fileForm("x.pdf", jobId)),
      recordExecutedSubcontract(jobId, executedForm(jobId, "2026-07-18")),
      uploadContractDocument(jobId, fileForm("y.pdf", jobId)),
    ]);

    const versions = await versionsOf(jobId);
    expect(versions).toEqual([1, 2, 3, 4]);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("a failed insert does not burn a version number — the bump and the insert are one transaction", async () => {
    // WHY THIS EXISTS: a mutation moving the counter bump OUTSIDE the
    // transaction survived every other case in this file. It has to,
    // because the upsert is atomic by itself, so concurrent callers still
    // get distinct numbers and nothing collides. The difference only shows
    // when the INSERT fails: inside the transaction the bump rolls back,
    // outside it the number is burned and the job's versions gain a hole.
    //
    // CLAUDE.md states the invariant directly — "the bump and the insert
    // have to be one transaction, or this is the old bug wearing a counter"
    // — so it is pinned here rather than left to the next reader to
    // rediscover. The insert is failed by naming a user who does not
    // exist, which trips ContractDocument_uploadedByUserId_fkey; any
    // insert failure would do, this one is just cheap to arrange.
    const jobId = await newJob("Burned Number Job");
    await uploadContractDocument(jobId, fileForm("original.pdf", jobId));
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 1 });

    const realUserId = context.id;
    context.id = "user_that_does_not_exist";
    try {
      await expect(recordExecutedSubcontract(jobId, executedForm(jobId))).rejects.toThrow();
    } finally {
      context.id = realUserId;
    }

    // Still 1. The failed attempt took no number with it.
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 1 });
    expect(await versionsOf(jobId)).toEqual([1]);

    // And the next real write is 2, not 3 — no hole.
    expect(await recordExecutedSubcontract(jobId, executedForm(jobId))).toEqual({ ok: true });
    expect(await versionsOf(jobId)).toEqual([1, 2]);
  });

  it("deleting a version does not let the executed-subcontract path reissue it either", async () => {
    // The counter's whole purpose, now holding for BOTH writers rather than
    // just the one that happened to use it.
    const jobId = await newJob("No Reissue Job");

    await uploadContractDocument(jobId, fileForm("original.pdf", jobId));
    await uploadContractDocument(jobId, fileForm("amendment.pdf", jobId));
    const v2 = await prisma.contractDocument.findFirstOrThrow({ where: { jobId, versionNumber: 2 } });
    await prisma.contractDocument.delete({ where: { id: v2.id } });

    await recordExecutedSubcontract(jobId, executedForm(jobId));

    // 3, not a second "Version 2" — the retired label is never handed to a
    // different legal document.
    expect(await versionsOf(jobId)).toEqual([1, 3]);
    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 3 });
  });
});

/**
 * THE MIGRATION, exercised as the file that will actually run — issue #280.
 *
 * The code fix stops new jobs entering the broken state; it does nothing
 * for the jobs already in it, which are the ones a person is complaining
 * about. So the repair is a migration, and a migration nobody tests is a
 * claim.
 *
 * The SQL is READ FROM DISK rather than restated here, because a copy of
 * it in a test proves the copy works. `migrate deploy` has already applied
 * it to this database; re-running it against fixtures created afterwards
 * is exactly what it is designed to survive, since it is idempotent.
 */
describe("the counter resync migration repairs jobs the old code broke — issue #280", () => {
  const ctx = { companyId: "" };
  let resyncSql = "";

  async function jobWithDocuments(name: string, versions: number[], counterAt: number | null) {
    const contact = await prisma.contact.create({ data: { companyId: ctx.companyId, name: `${name} GC` } });
    const job = await prisma.job.create({
      data: { companyId: ctx.companyId, contactId: contact.id, name, status: "CONTRACTED" },
    });
    for (const versionNumber of versions) {
      await prisma.contractDocument.create({
        data: {
          jobId: job.id,
          versionNumber,
          fileUrl: storedUrl(job.id, `v${versionNumber}.pdf`),
          fileName: `v${versionNumber}.pdf`,
        },
      });
    }
    if (counterAt !== null) {
      await prisma.contractDocumentVersionCounter.create({
        data: { jobId: job.id, lastNumber: counterAt },
      });
    }
    return job.id;
  }

  const counterOf = (jobId: string) =>
    prisma.contractDocumentVersionCounter.findUnique({ where: { jobId } });

  beforeAll(async () => {
    const { readFile } = await import("node:fs/promises");
    resyncSql = await readFile(
      new URL(
        "../../../../packages/db/prisma/schema/migrations/20260915223000_resync_contract_document_version_counter/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    // The file has to be the real one, not an empty read that would make
    // every assertion below pass against nothing.
    expect(resyncSql).toContain("GREATEST");

    const company = await prisma.company.create({ data: { name: "Resync Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    // This block writes ContractDocument rows through the real action, and
    // uploadedByUserId is a foreign key — the previous block's user is gone
    // by now, so this one needs its own.
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: "clerk_resync",
        email: "resync@test.example",
        role: "OWNER",
      },
    });
    context.id = user.id;
  });

  afterAll(async () => {
    const jobs = await prisma.job.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    await prisma.contractDocument.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.user.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
  });

  it("drags a counter that fell BEHIND its rows up to the highest version", async () => {
    // The scenario-A shape: an executed subcontract was recorded as v3 by
    // the old MAX path, leaving the counter at 2. Upload is dead on this
    // job until the counter catches up.
    const jobId = await jobWithDocuments("Behind Job", [1, 2, 3], 2);

    await prisma.$executeRawUnsafe(resyncSql);

    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 3 });
  });

  it("creates the missing row for a job that has documents but no counter at all", async () => {
    // The scenario-B shape, the fresh job: the executed subcontract was
    // recorded first, so nothing ever created the counter row.
    const jobId = await jobWithDocuments("No Counter Job", [1], null);
    expect(await counterOf(jobId)).toBeNull();

    await prisma.$executeRawUnsafe(resyncSql);

    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 1 });
  });

  it("does NOT drag a counter that is legitimately AHEAD back down", async () => {
    // THE CASE `GREATEST` EXISTS FOR, and the one a plain
    // `SET lastNumber = MAX(versionNumber)` would get wrong. Version 3 was
    // uploaded and then deleted: the rows stop at 2 but the counter
    // rightly stays at 3, because reissuing a retired version label to a
    // different legal document is the whole defect the counter prevents.
    const jobId = await jobWithDocuments("Ahead Job", [1, 2], 3);

    await prisma.$executeRawUnsafe(resyncSql);

    expect(await counterOf(jobId)).toMatchObject({ lastNumber: 3 });
  });

  it("invents no counter for a job that has no contract documents", async () => {
    const jobId = await jobWithDocuments("No Documents Job", [], null);

    await prisma.$executeRawUnsafe(resyncSql);

    expect(await counterOf(jobId)).toBeNull();
  });

  it("is idempotent — running it twice more changes nothing", async () => {
    const jobId = await jobWithDocuments("Idempotent Job", [1, 2, 3], 1);

    await prisma.$executeRawUnsafe(resyncSql);
    const once = await counterOf(jobId);
    await prisma.$executeRawUnsafe(resyncSql);
    await prisma.$executeRawUnsafe(resyncSql);

    expect((await counterOf(jobId))?.lastNumber).toBe(once?.lastNumber);
    expect(once?.lastNumber).toBe(3);
  });

  it("leaves a repaired job able to issue the next number without colliding", async () => {
    // The end-to-end point of the whole migration: a job that was dead
    // before it ran can be uploaded to after it.
    const jobId = await jobWithDocuments("Repaired Job", [1, 2, 3], 2);
    currentJobId = jobId;

    await prisma.$executeRawUnsafe(resyncSql);

    expect(await uploadContractDocument(jobId, fileForm("after-repair.pdf", jobId))).toEqual({ ok: true });
    const versions = (
      await prisma.contractDocument.findMany({
        where: { jobId },
        orderBy: { versionNumber: "asc" },
        select: { versionNumber: true },
      })
    ).map((d) => d.versionNumber);
    expect(versions).toEqual([1, 2, 3, 4]);
  });
});
