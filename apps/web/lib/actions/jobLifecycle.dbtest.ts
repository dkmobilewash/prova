import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The three things a subcontractor cannot get past step one without, against
 * a real Postgres.
 *
 * lib/job-lifecycle-actions.test.ts drives the same actions with a faked
 * `@prova/db` and runs in a second, which is where the refusals are pinned.
 * Four things it cannot touch, and all four are the ones that would hurt:
 *
 *  - THAT THE NEW COLUMN ROUND-TRIPS. `executedSignedDate` is written as a
 *    UTC-midnight Date and has to come back as the same calendar day.
 *  - THAT `executedSignedDate: { not: null }` IS A REAL QUERY. The whole
 *    second route to a billable job hangs off that where-clause finding an
 *    executed document and NOT finding an ordinary upload. A fake matcher
 *    can be made to agree with itself; Postgres cannot.
 *  - THAT COMPANY SCOPING IS ENFORCED BY THE QUERY, not by a mock that was
 *    written to return null. This repo has a scar for exactly that shape.
 *  - THAT THE STATUS COLUMN ACCEPTS THE VALUES. IN_PROGRESS and COMPLETE
 *    have never once been written to this database by application code.
 *
 * Creates and deletes its own company; never point this at a real database
 * (see vitest.db.config.ts).
 */

const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

const redirects: string[] = [];

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
// No blob token in the dbtest job, and this suite is about the row, not the
// upload — lib/blob-uploads.test.ts already owns the pathname behaviour.
vi.mock("@/lib/blob", () => ({
  putDocument: async (pathname: string) => ({ url: `https://blob.test/${pathname}-r4nd0m` }),
}));

const { createJob, markJobContracted, recordExecutedSubcontract, setJobStatus } = await import(
  "./jobs"
);

const stamp = Date.now();
let companyId = "";
let otherCompanyId = "";
let userId = "";
let turnerId = "";
let outsiderContactId = "";
let outsiderJobId = "";

function pdf() {
  return new File([new Uint8Array([37, 80, 68, 70])], "subcontract.pdf", {
    type: "application/pdf",
  });
}

function executedForm(signedDate = "2026-07-04") {
  const fd = new FormData();
  fd.set("file", pdf());
  fd.set("executedSignedDate", signedDate);
  return fd;
}

/** A fresh ESTIMATE job with one line item, ready to be contracted. */
async function newJob(name: string) {
  const job = await prisma.job.create({
    data: { companyId, contactId: turnerId, name, status: "ESTIMATE" },
  });
  await prisma.jobLineItem.create({
    data: { jobId: job.id, description: "Level 3 drywall", quantity: "1", unitPrice: "1000" },
  });
  return job;
}

describe("the job lifecycle against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Lifecycle Test Co ${stamp}` } });
    companyId = company.id;
    const user = await prisma.user.create({
      data: {
        companyId,
        clerkId: `lifecycle_o_${stamp}`,
        email: `lifecycle_o_${stamp}@example.test`,
        name: "Lifecycle Owner",
        role: "OWNER",
      },
    });
    userId = user.id;

    const turner = await prisma.contact.create({
      data: { companyId, name: "Turner Construction", email: `pm_${stamp}@turner.test` },
    });
    turnerId = turner.id;

    const other = await prisma.company.create({ data: { name: `Someone Else ${stamp}` } });
    otherCompanyId = other.id;
    const outsiderContact = await prisma.contact.create({
      data: { companyId: otherCompanyId, name: "Their GC" },
    });
    outsiderContactId = outsiderContact.id;
    const outsiderJob = await prisma.job.create({
      data: {
        companyId: otherCompanyId,
        contactId: outsiderContactId,
        name: "Their job",
        status: "CONTRACTED",
      },
    });
    outsiderJobId = outsiderJob.id;

    context.company.id = companyId;
    context.id = userId;
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      const jobs = await prisma.job.findMany({ where: { companyId: id }, select: { id: true } });
      const jobIds = jobs.map((j) => j.id);
      await prisma.contractDocument.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.signatureRequest.deleteMany({ where: { jobId: { in: jobIds } } });
      await prisma.job.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.deleteMany({ where: { id } });
    }
  });

  beforeEach(() => {
    context.company.id = companyId;
    context.id = userId;
    context.role = "OWNER";
    context.jobFunction = null;
    redirects.length = 0;
  });

  /* ------------------------------------------------------ FIX 2: one GC, one row */

  it("createJob attaches the job to an EXISTING contact instead of minting a duplicate", async () => {
    const before = await prisma.contact.count({ where: { companyId } });

    const fd = new FormData();
    fd.set("jobName", `Picker job ${stamp}`);
    fd.set("contactId", turnerId);
    await expect(createJob(fd)).rejects.toThrow(/NEXT_REDIRECT/);

    expect(await prisma.contact.count({ where: { companyId } })).toBe(before);
    const job = await prisma.job.findFirstOrThrow({ where: { name: `Picker job ${stamp}` } });
    expect(job.contactId).toBe(turnerId);
  });

  it("three jobs for one GC leave ONE contact — the whole bug, executed", async () => {
    const before = await prisma.contact.count({ where: { companyId } });

    for (const n of [1, 2, 3]) {
      const fd = new FormData();
      fd.set("jobName", `Repeat job ${n} ${stamp}`);
      fd.set("contactId", turnerId);
      await expect(createJob(fd)).rejects.toThrow(/NEXT_REDIRECT/);
    }

    expect(await prisma.contact.count({ where: { companyId } })).toBe(before);
    expect(await prisma.job.count({ where: { contactId: turnerId } })).toBeGreaterThanOrEqual(3);
  });

  it("createJob still creates a contact for a genuinely new GC", async () => {
    const fd = new FormData();
    fd.set("jobName", `New GC job ${stamp}`);
    fd.set("contactName", `Swinerton ${stamp}`);
    fd.set("contactEmail", `pm_${stamp}@swinerton.test`);
    await expect(createJob(fd)).rejects.toThrow(/NEXT_REDIRECT/);

    const contact = await prisma.contact.findFirstOrThrow({
      where: { companyId, name: `Swinerton ${stamp}` },
    });
    expect(contact.email).toBe(`pm_${stamp}@swinerton.test`);
  });

  it("createJob REFUSES another tenant's contact, and writes nothing", async () => {
    const jobsBefore = await prisma.job.count({ where: { companyId } });

    const fd = new FormData();
    fd.set("jobName", `Cross tenant ${stamp}`);
    fd.set("contactId", outsiderContactId);
    const result = await createJob(fd);

    expect(result.ok).toBe(false);
    expect(await prisma.job.count({ where: { companyId } })).toBe(jobsBefore);
    expect(redirects).toHaveLength(0);
  });

  /* --------------------------------------- FIX 1: the executed-subcontract route */

  it("the entered signing date round-trips as the same UTC calendar day", async () => {
    const job = await newJob(`Round trip ${stamp}`);

    expect(await recordExecutedSubcontract(job.id, executedForm("2026-07-04"))).toEqual({
      ok: true,
    });

    const doc = await prisma.contractDocument.findFirstOrThrow({ where: { jobId: job.id } });
    expect(doc.executedSignedDate?.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(doc.uploadedByUserId, "who asserted it").toBe(userId);
    expect(doc.createdAt.getTime(), "recordedAt is stamped, not the signing date").toBeGreaterThan(
      doc.executedSignedDate!.getTime(),
    );
  });

  it("an ORDINARY upload is invisible to the executed-document query", async () => {
    const job = await newJob(`Plain upload ${stamp}`);
    await prisma.contractDocument.create({
      data: {
        jobId: job.id,
        versionNumber: 1,
        fileUrl: "https://blob.test/plain.pdf",
        fileName: "plain.pdf",
      },
    });

    const found = await prisma.contractDocument.findFirst({
      where: { jobId: job.id, executedSignedDate: { not: null } },
    });
    expect(found, "a plain upload must not count as executed").toBeNull();

    const result = await markJobContracted(job.id);
    expect(result.ok).toBe(false);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ESTIMATE");
  });

  it("recording an executed subcontract makes the job contractable — and only then", async () => {
    const job = await newJob(`Executed route ${stamp}`);

    const refusedFirst = await markJobContracted(job.id);
    expect(refusedFirst.ok, "no evidence yet").toBe(false);

    expect(await recordExecutedSubcontract(job.id, executedForm())).toEqual({ ok: true });
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status,
      "recording evidence must not contract the job by itself",
    ).toBe("ESTIMATE");

    expect(await markJobContracted(job.id)).toEqual({ ok: true });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "CONTRACTED",
    );
  });

  it("the e-sign route is unchanged", async () => {
    const job = await newJob(`Esign route ${stamp}`);
    await prisma.signatureRequest.create({
      data: { jobId: job.id, token: `tok_${stamp}_${job.id}`, status: "SIGNED" },
    });

    expect(await markJobContracted(job.id)).toEqual({ ok: true });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "CONTRACTED",
    );
    expect(
      await prisma.contractDocument.count({ where: { jobId: job.id } }),
      "the e-sign route must not invent a document",
    ).toBe(0);
  });

  it("recordExecutedSubcontract refuses another tenant's job", async () => {
    const result = await recordExecutedSubcontract(outsiderJobId, executedForm());
    expect(result.ok).toBe(false);
    expect(await prisma.contractDocument.count({ where: { jobId: outsiderJobId } })).toBe(0);
  });

  it("a later executed amendment is a new version, and the ORIGINAL is what the gate reads", async () => {
    const job = await newJob(`Amendment ${stamp}`);
    await recordExecutedSubcontract(job.id, executedForm("2026-07-04"));
    await recordExecutedSubcontract(job.id, executedForm("2026-08-15"));

    const docs = await prisma.contractDocument.findMany({
      where: { jobId: job.id },
      orderBy: { versionNumber: "asc" },
    });
    expect(docs.map((d) => d.versionNumber)).toEqual([1, 2]);

    const gateReads = await prisma.contractDocument.findFirst({
      where: { jobId: job.id, executedSignedDate: { not: null } },
      orderBy: { versionNumber: "asc" },
    });
    expect(gateReads?.executedSignedDate?.toISOString()).toBe("2026-07-04T00:00:00.000Z");
  });

  /* ------------------------------------------- FIX 3: statuses nothing could set */

  it("writes IN_PROGRESS and COMPLETE to a column no application code had ever set", async () => {
    const job = await newJob(`Lifecycle ${stamp}`);
    await recordExecutedSubcontract(job.id, executedForm());
    await markJobContracted(job.id);

    expect(await setJobStatus(job.id, "IN_PROGRESS")).toEqual({ ok: true });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "IN_PROGRESS",
    );

    expect(await setJobStatus(job.id, "COMPLETE")).toEqual({ ok: true });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETE");

    // And the dashboard's "In progress" group can now actually find one.
    await setJobStatus(job.id, "IN_PROGRESS");
    const inProgress = await prisma.job.findMany({ where: { companyId, status: "IN_PROGRESS" } });
    expect(inProgress.map((j) => j.id)).toContain(job.id);
  });

  it("refuses the estimate → contracted shortcut, leaving the row untouched", async () => {
    const job = await newJob(`Shortcut ${stamp}`);

    const result = await setJobStatus(job.id, "CONTRACTED");

    expect(result.ok).toBe(false);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ESTIMATE");
  });

  it("refuses a move back to estimate, leaving the row untouched", async () => {
    const job = await newJob(`No reverse ${stamp}`);
    await recordExecutedSubcontract(job.id, executedForm());
    await markJobContracted(job.id);

    const result = await setJobStatus(job.id, "ESTIMATE");

    expect(result.ok).toBe(false);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "CONTRACTED",
    );
  });

  it("refuses another tenant's job without touching it", async () => {
    const result = await setJobStatus(outsiderJobId, "IN_PROGRESS");

    expect(result.ok).toBe(false);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: outsiderJobId } })).status).toBe(
      "CONTRACTED",
    );
  });

  it("refuses a member whose job function does not manage jobs", async () => {
    const job = await newJob(`Capability ${stamp}`);
    await recordExecutedSubcontract(job.id, executedForm());
    await markJobContracted(job.id);

    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING";
    const result = await setJobStatus(job.id, "IN_PROGRESS");

    expect(result.ok).toBe(false);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "CONTRACTED",
    );
  });
});
