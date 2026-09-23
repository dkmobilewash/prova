import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * THE FIVE RECORDING ACTIONS, AGAINST A REAL POSTGRES — issue #27.
 *
 * Each of these used to carry the file itself through a `FormData` and
 * refuse it over 15MB, behind a framework cap of 1MB that meant the guard
 * never ran and a real document never arrived. The browser uploads to the
 * blob store directly now and the action records the URL.
 *
 * WHAT IS WORTH PROVING HERE, and it is not the happy path. A Server
 * Action is an HTTP endpoint with a stable id: anyone with a session can
 * post a URL to it directly, and the URL it records is the one
 * `deleteDocument` later hands to `del()`. One Vercel Blob store serves
 * every tenant. So the questions are:
 *
 *   - does it refuse a URL from somebody ELSE'S blob store, which is the
 *     one an attacker can put any path they like into;
 *   - does it refuse a URL in OUR store that sits under ANOTHER COMPANY's
 *     folder, which is the cross-tenant case that cost site capture a
 *     security fix (#195);
 *   - does it refuse a URL under the right owner but the WRONG KIND of
 *     record, so a dispatch slip cannot be filed as a subcontract;
 *   - and does it still record a legitimate one, so that none of the
 *     above is a suite that passes by refusing everything.
 *
 * Every refusal case below has that last control beside it.
 *
 * `BLOB_STORE_ID` is set because `isOurBlobStoreUrl` reads which store is
 * ours out of the credentials the app already holds — there is no new
 * setting, and with none at all the checks FAIL CLOSED.
 */

const OUR_STORE = "teststore1";
process.env.BLOB_STORE_ID = OUR_STORE;

const context = {
  id: "",
  companyId: "",
  company: { id: "" },
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** The extractor is a real Claude call in production and is not the
 * subject here; what IS the subject is that the bytes reach it at all,
 * so the fake records what it was handed. */
const extractions: { mediaType: string; bytes: number; fileName: string }[] = [];
vi.mock("@prova/integrations", () => ({
  extractComplianceDocument: async ({
    fileBase64,
    mediaType,
    fileName,
  }: {
    fileBase64: string;
    mediaType: string;
    fileName: string;
  }) => {
    extractions.push({ mediaType, bytes: Buffer.from(fileBase64, "base64").byteLength, fileName });
    return {
      type: "CERTIFICATE_OF_INSURANCE",
      partyName: "Acme Insurance",
      amount: null,
      periodStart: null,
      periodEnd: null,
      effectiveDate: null,
      expiresAt: null,
      notes: null,
    };
  },
}));

/**
 * The store's own response to a read-back, faked — a dbtest cannot reach
 * real Vercel Blob. `uploadComplianceDocument` is the one action that
 * fetches the file it recorded, because the extractor needs the bytes, so
 * it is the one that needs this. The fake serves a content type the way
 * the store does, since the action deliberately reads the type from the
 * RESPONSE rather than from the caller.
 */
let served: { status: number; contentType: string; body: Uint8Array } = {
  status: 200,
  contentType: "application/pdf",
  body: new Uint8Array([37, 80, 68, 70]),
};
const fetched: string[] = [];
vi.stubGlobal("fetch", async (url: string) => {
  fetched.push(String(url));
  return new Response(served.status === 200 ? Buffer.from(served.body) : null, {
    status: served.status,
    headers: { "content-type": served.contentType },
  });
});

const { uploadDispatchSlip, uploadPrevailingWageDetermination } = await import("./labor");
const { uploadContractDocument } = await import("./billing");
const { recordExecutedSubcontract } = await import("./jobs");
const { uploadComplianceDocument } = await import("./compliance");

const stamp = Date.now();
const ours = { companyId: "", userId: "", jobId: "" };
const theirs = { companyId: "", jobId: "" };

let uploadSeq = 0;

/** A URL of exactly the shape the store issues, for any store, folder and
 * owner — which is what makes every adversarial case below one argument
 * different from the legitimate one. */
function storedUrl(store: string, folder: string, ownerId: string, name = "document.pdf") {
  uploadSeq += 1;
  return `https://${store}.public.blob.vercel-storage.com/${folder}/${ownerId}/${name.replace(/\.pdf$/, "")}-r4nd0m${uploadSeq}.pdf`;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Doc Upload Co ${stamp}` } });
  ours.companyId = company.id;
  context.companyId = company.id;
  context.company.id = company.id;
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `doc_upload_${stamp}`,
      email: `doc-upload-${stamp}@test.example`,
      role: "OWNER",
    },
  });
  ours.userId = user.id;
  context.id = user.id;
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Our GC" } });
  const job = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: "Our Job", status: "CONTRACTED" },
  });
  ours.jobId = job.id;

  const other = await prisma.company.create({ data: { name: `Other Doc Co ${stamp}` } });
  theirs.companyId = other.id;
  const otherContact = await prisma.contact.create({
    data: { companyId: other.id, name: "Their GC" },
  });
  const otherJob = await prisma.job.create({
    data: {
      companyId: other.id,
      contactId: otherContact.id,
      name: "Their Job",
      status: "CONTRACTED",
    },
  });
  theirs.jobId = otherJob.id;
});

afterAll(async () => {
  for (const companyId of [ours.companyId, theirs.companyId]) {
    await prisma.dispatchSlip.deleteMany({ where: { job: { companyId } } });
    await prisma.prevailingWageDetermination.deleteMany({ where: { job: { companyId } } });
    await prisma.contractDocument.deleteMany({ where: { job: { companyId } } });
    await prisma.contractDocumentVersionCounter.deleteMany({ where: { job: { companyId } } });
    await prisma.complianceDocument.deleteMany({ where: { companyId } });
    // `uploadComplianceDocument` claims against the monthly AI allowance
    // now, so this suite creates an `AskAllowancePeriod` row — a RESTRICT
    // child of Company that the company delete below cannot reach. Same
    // shape as #227's InvoiceCounter: a new child breaks a cleanup that
    // never mentioned it, and the failure lands in teardown rather than in
    // the test that caused it.
    await prisma.askAllowancePeriod.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  }
  await prisma.$disconnect();
});

beforeEach(() => {
  context.role = "OWNER";
  context.jobFunction = null;
  served = { status: 200, contentType: "application/pdf", body: new Uint8Array([37, 80, 68, 70]) };
  extractions.length = 0;
  fetched.length = 0;
});

/* --------------------------------------------------------------- dispatch slips */

describe("uploadDispatchSlip records a URL and proves whose file it is", () => {
  function form(fileUrl?: string) {
    const fd = new FormData();
    fd.set("employeeUserId", ours.userId);
    fd.set("dispatchDate", "2026-09-01");
    if (fileUrl !== undefined) {
      fd.set("fileUrl", fileUrl);
      fd.set("fileName", "slip.pdf");
    }
    return fd;
  }

  it("stores the URL the store returned, and the name the person picked", async () => {
    const url = storedUrl(OUR_STORE, "dispatch-slips", ours.jobId, "slip.pdf");
    try {
      expect(await uploadDispatchSlip(ours.jobId, form(url))).toEqual({ ok: true });

      const slip = await prisma.dispatchSlip.findFirstOrThrow({ where: { jobId: ours.jobId } });
      expect(slip.fileUrl).toBe(url);
      // The suffixed pathname is not what a person should read; what they
      // picked is.
      expect(slip.fileName).toBe("slip.pdf");
    } finally {
      await prisma.dispatchSlip.deleteMany({ where: { jobId: ours.jobId } });
    }
  });

  it("still records a dispatch with NO file — some halls dispatch by phone", async () => {
    try {
      expect(await uploadDispatchSlip(ours.jobId, form())).toEqual({ ok: true });
      const slip = await prisma.dispatchSlip.findFirstOrThrow({ where: { jobId: ours.jobId } });
      expect(slip.fileUrl).toBeNull();
    } finally {
      await prisma.dispatchSlip.deleteMany({ where: { jobId: ours.jobId } });
    }
  });

  it("REFUSES a URL from another blob store and writes nothing", async () => {
    const result = await uploadDispatchSlip(
      ours.jobId,
      form(storedUrl("attackerstore", "dispatch-slips", ours.jobId)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("did not come from this app's storage");
    expect(await prisma.dispatchSlip.count({ where: { jobId: ours.jobId } })).toBe(0);
  });

  it("REFUSES a URL under ANOTHER COMPANY's job, the cross-tenant case", async () => {
    const result = await uploadDispatchSlip(
      ours.jobId,
      form(storedUrl(OUR_STORE, "dispatch-slips", theirs.jobId)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("was not uploaded to this job");
    expect(await prisma.dispatchSlip.count({ where: { jobId: ours.jobId } })).toBe(0);
  });

  it("REFUSES a URL in the wrong folder for this kind of record", async () => {
    const result = await uploadDispatchSlip(
      ours.jobId,
      form(storedUrl(OUR_STORE, "contracts", ours.jobId)),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.dispatchSlip.count({ where: { jobId: ours.jobId } })).toBe(0);
  });
});

/* ------------------------------------------------------- wage determinations */

describe("uploadPrevailingWageDetermination records a URL and proves whose file it is", () => {
  function form(fileUrl?: string) {
    const fd = new FormData();
    fd.set("jurisdiction", "California DIR");
    if (fileUrl !== undefined) {
      fd.set("fileUrl", fileUrl);
      fd.set("fileName", "determination.pdf");
    }
    return fd;
  }

  it("stores the URL the store returned", async () => {
    const url = storedUrl(OUR_STORE, "prevailing-wage", ours.jobId, "determination.pdf");
    try {
      expect(await uploadPrevailingWageDetermination(ours.jobId, form(url))).toEqual({ ok: true });
      const row = await prisma.prevailingWageDetermination.findFirstOrThrow({
        where: { jobId: ours.jobId },
      });
      expect(row.fileUrl).toBe(url);
    } finally {
      await prisma.prevailingWageDetermination.deleteMany({ where: { jobId: ours.jobId } });
    }
  });

  it("still accepts a source LINK with no file, which was always the other half", async () => {
    const fd = form();
    fd.set("sourceUrl", "https://sam.gov/wd/CA20260001");
    try {
      expect(await uploadPrevailingWageDetermination(ours.jobId, fd)).toEqual({ ok: true });
      const row = await prisma.prevailingWageDetermination.findFirstOrThrow({
        where: { jobId: ours.jobId },
      });
      expect(row.fileUrl).toBeNull();
    } finally {
      await prisma.prevailingWageDetermination.deleteMany({ where: { jobId: ours.jobId } });
    }
  });

  it("REFUSES a URL from another blob store", async () => {
    const result = await uploadPrevailingWageDetermination(
      ours.jobId,
      form(storedUrl("attackerstore", "prevailing-wage", ours.jobId)),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.prevailingWageDetermination.count({ where: { jobId: ours.jobId } })).toBe(0);
  });

  it("REFUSES a URL under ANOTHER COMPANY's job", async () => {
    const result = await uploadPrevailingWageDetermination(
      ours.jobId,
      form(storedUrl(OUR_STORE, "prevailing-wage", theirs.jobId)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("was not uploaded to this job");
    expect(await prisma.prevailingWageDetermination.count({ where: { jobId: ours.jobId } })).toBe(0);
  });
});

/* ----------------------------------------------------------- contract documents */

describe("uploadContractDocument records a URL, and the counter is untouched", () => {
  function form(fileUrl: string) {
    const fd = new FormData();
    fd.set("fileUrl", fileUrl);
    fd.set("fileName", "subcontract.pdf");
    return fd;
  }

  it("stores the URL and still numbers versions from the counter, in one transaction", async () => {
    try {
      const first = storedUrl(OUR_STORE, "contracts", ours.jobId, "subcontract.pdf");
      const second = storedUrl(OUR_STORE, "contracts", ours.jobId, "subcontract.pdf");
      expect(await uploadContractDocument(ours.jobId, form(first))).toEqual({ ok: true });
      expect(await uploadContractDocument(ours.jobId, form(second))).toEqual({ ok: true });

      const docs = await prisma.contractDocument.findMany({
        where: { jobId: ours.jobId },
        orderBy: { versionNumber: "asc" },
      });
      expect(docs.map((d) => d.versionNumber)).toEqual([1, 2]);
      expect(docs.map((d) => d.fileUrl)).toEqual([first, second]);
      const counter = await prisma.contractDocumentVersionCounter.findUnique({
        where: { jobId: ours.jobId },
      });
      expect(counter?.lastNumber).toBe(2);
    } finally {
      await prisma.contractDocument.deleteMany({ where: { jobId: ours.jobId } });
      await prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: ours.jobId } });
    }
  });

  it("REFUSES a URL under ANOTHER COMPANY's job and bumps no counter", async () => {
    const result = await uploadContractDocument(
      ours.jobId,
      form(storedUrl(OUR_STORE, "contracts", theirs.jobId)),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.contractDocument.count({ where: { jobId: ours.jobId } })).toBe(0);
    // The counter must not have moved either: a refused upload that still
    // burns a version number would leave a gap in a numbered legal record.
    expect(
      await prisma.contractDocumentVersionCounter.findUnique({ where: { jobId: ours.jobId } }),
    ).toBeNull();
  });

  it("REFUSES a missing URL rather than writing a row with no document", async () => {
    const result = await uploadContractDocument(ours.jobId, new FormData());
    expect(result.ok).toBe(false);
    expect(await prisma.contractDocument.count({ where: { jobId: ours.jobId } })).toBe(0);
  });
});

/* ------------------------------------------------------- executed subcontracts */

describe("recordExecutedSubcontract keeps its capability guard and checks the URL", () => {
  function form(fileUrl: string) {
    const fd = new FormData();
    fd.set("fileUrl", fileUrl);
    fd.set("fileName", "executed.pdf");
    fd.set("executedSignedDate", "2026-07-04");
    return fd;
  }

  it("records the evidence for someone who manages jobs", async () => {
    // MEMBER + FIELD rather than OWNER: an owner holds every capability by
    // construction, so it could not tell a working guard from a missing
    // one. FIELD holds MANAGE_JOBS.
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const url = storedUrl(OUR_STORE, "contracts", ours.jobId, "executed.pdf");
    try {
      expect(await recordExecutedSubcontract(ours.jobId, form(url))).toEqual({ ok: true });
      const doc = await prisma.contractDocument.findFirstOrThrow({ where: { jobId: ours.jobId } });
      expect(doc.fileUrl).toBe(url);
      expect(doc.executedSignedDate?.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    } finally {
      await prisma.contractDocument.deleteMany({ where: { jobId: ours.jobId } });
    }
  });

  it("REFUSES a member whose job function does not manage jobs", async () => {
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING";

    const result = await recordExecutedSubcontract(
      ours.jobId,
      form(storedUrl(OUR_STORE, "contracts", ours.jobId)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("job function");
    expect(await prisma.contractDocument.count({ where: { jobId: ours.jobId } })).toBe(0);
  });

  it("REFUSES a URL under ANOTHER COMPANY's job", async () => {
    const result = await recordExecutedSubcontract(
      ours.jobId,
      form(storedUrl(OUR_STORE, "contracts", theirs.jobId)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("was not uploaded to this job");
    expect(await prisma.contractDocument.count({ where: { jobId: ours.jobId } })).toBe(0);
  });
});

/* ------------------------------------------------------- compliance documents */

describe("uploadComplianceDocument reads the file back out of the store", () => {
  function form(fileUrl: string) {
    const fd = new FormData();
    fd.set("fileUrl", fileUrl);
    fd.set("fileName", "COI.pdf");
    return fd;
  }

  it("records the URL and hands the bytes to the extractor", async () => {
    const url = storedUrl(OUR_STORE, "compliance", ours.companyId, "COI.pdf");
    try {
      // The success shape carries what the document cost now. Four bytes of
      // "%PDF" have no readable page tree, so it is charged the flat rate
      // pageCount.ts documents — and says so, which is the promise that
      // file makes and nothing kept until this path rendered it.
      expect(await uploadComplianceDocument(form(url))).toEqual({
        ok: true,
        value: {
          note: "10 pages (this PDF's page count couldn't be read, so it is charged as 10)",
          pagesLeft: 290,
        },
      });

      const row = await prisma.complianceDocument.findFirstOrThrow({
        where: { companyId: ours.companyId },
      });
      expect(row.fileUrl).toBe(url);
      expect(row.fileName).toBe("COI.pdf");
      expect(row.aiExtracted).toBe(true);
      // The bytes really did reach the extractor, and the media type came
      // from the STORE's response rather than from anything the caller
      // said.
      expect(fetched).toEqual([url]);
      expect(extractions).toEqual([{ mediaType: "application/pdf", bytes: 4, fileName: "COI.pdf" }]);
    } finally {
      await prisma.complianceDocument.deleteMany({ where: { companyId: ours.companyId } });
    }
  });

  it("REFUSES a URL under ANOTHER COMPANY's folder — the owner here is the session", async () => {
    // The whole company-scoped argument in one case: there is no id in
    // this request for the action to be talked into using, so a URL under
    // somebody else's compliance folder cannot be recorded, and the file
    // is never even fetched.
    const result = await uploadComplianceDocument(
      form(storedUrl(OUR_STORE, "compliance", theirs.companyId)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("was not uploaded to this company");
    expect(fetched, "a refused URL must not be fetched at all").toEqual([]);
    expect(await prisma.complianceDocument.count({ where: { companyId: ours.companyId } })).toBe(0);
  });

  it("REFUSES a URL from another blob store, and fetches nothing", async () => {
    const result = await uploadComplianceDocument(
      form(storedUrl("attackerstore", "compliance", ours.companyId)),
    );

    expect(result.ok).toBe(false);
    expect(fetched).toEqual([]);
    expect(await prisma.complianceDocument.count({ where: { companyId: ours.companyId } })).toBe(0);
  });

  it("REFUSES a stored file the store serves as something else", async () => {
    // The type is whatever the STORE says, and the extractor only accepts
    // four. A blob serving something else is refused rather than passed
    // on.
    served = { status: 200, contentType: "text/html", body: new Uint8Array([60, 33]) };

    const result = await uploadComplianceDocument(
      form(storedUrl(OUR_STORE, "compliance", ours.companyId)),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("PDF, PNG, JPEG, or WEBP");
    expect(extractions, "nothing may reach the extractor").toEqual([]);
    expect(await prisma.complianceDocument.count({ where: { companyId: ours.companyId } })).toBe(0);
  });

  it("RETURNS a sentence when the store will not give the file back", async () => {
    // Before #27 every refusal in this action was a `throw`, which
    // production redacts to a digest — so this, the one failure mode a
    // person can do something about, would have arrived as a reference
    // number.
    served = { status: 404, contentType: "application/pdf", body: new Uint8Array() };

    const result = await uploadComplianceDocument(
      form(storedUrl(OUR_STORE, "compliance", ours.companyId)),
    );

    expect(result).toEqual({
      ok: false,
      error: "That file could not be read back from storage — try again.",
    });
    expect(await prisma.complianceDocument.count({ where: { companyId: ours.companyId } })).toBe(0);
  });

  it("files a company-level document against a JOB when one is chosen, and refuses another company's job", async () => {
    const url = storedUrl(OUR_STORE, "compliance", ours.companyId);
    try {
      const withJob = form(url);
      withJob.set("jobId", ours.jobId);
      expect((await uploadComplianceDocument(withJob)).ok).toBe(true);
      const row = await prisma.complianceDocument.findFirstOrThrow({
        where: { companyId: ours.companyId },
      });
      expect(row.jobId).toBe(ours.jobId);

      const withTheirJob = form(storedUrl(OUR_STORE, "compliance", ours.companyId));
      withTheirJob.set("jobId", theirs.jobId);
      const refused = await uploadComplianceDocument(withTheirJob);
      expect(refused.ok).toBe(false);
      expect(await prisma.complianceDocument.count({ where: { companyId: ours.companyId } })).toBe(
        1,
      );
    } finally {
      await prisma.complianceDocument.deleteMany({ where: { companyId: ours.companyId } });
    }
  });
});
