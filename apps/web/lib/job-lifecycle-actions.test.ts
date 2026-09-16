import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three actions a subcontractor cannot get past step one without,
 * driven for real with `@prova/db` and `@/lib/blob` faked.
 *
 * Same harness shape as lib/blob-uploads.test.ts, and for the same reason:
 * these are guards, and a guard is only worth anything if the code path is
 * actually executed with the input that should be refused. Every assertion
 * below names the value it demands rather than counting calls, so
 * reintroducing a defect makes a specific test go red.
 *
 * The database-backed versions (real Postgres, real tenant scoping) live in
 * lib/actions/jobLifecycle.dbtest.ts and run in CI's `dbtest` job.
 */

const COMPANY_ID = "cmp_alpha";
const OTHER_COMPANY_ID = "cmp_beta";
const JOB_ID = "job_alpha";
const USER_ID = "usr_1";

type Row = Record<string, unknown>;

const db = {
  jobs: [] as Row[],
  contacts: [] as Row[],
  contractDocuments: [] as Row[],
  // recordExecutedSubcontract issues its versionNumber from this counter
  // now rather than from MAX(versionNumber) + 1 — issue #280. Modelled
  // here because a fake missing the table the action reads does not fail
  // as "unsupported", it fails as a crash inside the action.
  contractDocumentVersionCounters: [] as Row[],
  signatureRequests: [] as Row[],
  lineItems: [] as Row[],
};

const jobUpdates: Row[] = [];
const redirects: string[] = [];

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (want !== null && typeof want === "object" && "not" in (want as Row)) {
      return row[key] !== (want as Row).not;
    }
    return row[key] === want;
  });
}

const prisma = {
  job: {
    findUnique: async ({ where }: { where: Row }) =>
      db.jobs.find((j) => j.id === where.id) ?? null,
    create: async ({ data }: { data: Row }) => {
      const job = { id: `job_${db.jobs.length + 1}`, status: "ESTIMATE", ...data };
      db.jobs.push(job);
      return job;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      jobUpdates.push({ id: where.id, ...data });
      const job = db.jobs.find((j) => j.id === where.id)!;
      Object.assign(job, data);
      return job;
    },
  },
  contact: {
    findFirst: async ({ where }: { where: Row }) =>
      db.contacts.find((c) => matches(c, where)) ?? null,
    create: async ({ data }: { data: Row }) => {
      const contact = { id: `con_${db.contacts.length + 1}`, ...data };
      db.contacts.push(contact);
      return contact;
    },
  },
  contractDocument: {
    findFirst: async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
      const found = db.contractDocuments.filter((d) => matches(d, where));
      if (found.length === 0) return null;
      const desc = orderBy?.versionNumber === "desc";
      return found.sort((a, b) =>
        desc
          ? Number(b.versionNumber) - Number(a.versionNumber)
          : Number(a.versionNumber) - Number(b.versionNumber),
      )[0];
    },
    create: async ({ data }: { data: Row }) => {
      const doc = { id: `doc_${db.contractDocuments.length + 1}`, ...data };
      db.contractDocuments.push(doc);
      return doc;
    },
  },
  contractDocumentVersionCounter: {
    // Only ever increments, exactly like the real row: the point of the
    // counter is that a number it has issued is never issued again, so a
    // fake that recomputed from the surviving documents would quietly
    // restore the behaviour #280 removed.
    upsert: async ({ where, create }: { where: Row; create: Row }) => {
      const existing = db.contractDocumentVersionCounters.find((c) => c.jobId === where.jobId);
      if (existing) {
        existing.lastNumber = Number(existing.lastNumber) + 1;
        return existing;
      }
      const row = { jobId: where.jobId, lastNumber: Number(create.lastNumber) };
      db.contractDocumentVersionCounters.push(row);
      return row;
    },
  },
  signatureRequest: {
    findFirst: async ({ where }: { where: Row }) =>
      db.signatureRequests.find((s) => matches(s, where)) ?? null,
  },
  jobLineItem: {
    count: async ({ where }: { where: Row }) => db.lineItems.filter((i) => matches(i, where)).length,
  },
  // createJob's body now runs inside one transaction (lib/estimating/
  // create-job.ts); the fake hands the callback the same tables.
  $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(prisma),
};

const context = { id: USER_ID, role: "OWNER", jobFunction: null as string | null, company: { id: COMPANY_ID } };

vi.mock("@prova/db", () => ({ prisma, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("@prova/integrations", () => ({ draftEstimateLineItems: async () => [] }));

/**
 * THE FILE NO LONGER PASSES THROUGH THE ACTION (#27), so there is no
 * `@/lib/blob` mock here any more: `recordExecutedSubcontract` receives a
 * URL the browser already uploaded to. What it does with that URL is the
 * thing worth testing, and it needs to know which store is ours —
 * `isOurBlobStoreUrl` reads that out of the credentials, so the test
 * supplies one.
 */
const OUR_STORE = "teststore1";
process.env.BLOB_STORE_ID = OUR_STORE;
const storedUrl = (store: string, pathname: string) =>
  `https://${store}.public.blob.vercel-storage.com/${pathname}`;

const { createJob, markJobContracted, recordExecutedSubcontract, setJobStatus } = await import(
  "./actions/jobs"
);

function executedForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  // What the browser sends after `upload()` has finished: the URL the
  // store returned, suffix and all, plus the name to show on the row.
  fd.set("fileUrl", storedUrl(OUR_STORE, `contracts/${JOB_ID}/subcontract-r4nd0m1.pdf`));
  fd.set("fileName", "subcontract.pdf");
  fd.set("executedSignedDate", "2026-07-04");
  for (const [key, value] of Object.entries(overrides)) {
    if (value === "") fd.delete(key);
    else fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  db.jobs = [{ id: JOB_ID, companyId: COMPANY_ID, status: "ESTIMATE", name: "Building C" }];
  db.contacts = [
    { id: "con_turner", companyId: COMPANY_ID, name: "Turner", email: "pm@turner.com" },
    { id: "con_outsider", companyId: OTHER_COMPANY_ID, name: "Someone else's GC", email: null },
  ];
  db.contractDocuments = [];
  // Cleared WITH the documents, not separately: a counter left standing
  // while its rows are wiped is a state the real database cannot be in
  // (the counter is a RESTRICT child of the job), and it would make each
  // test's version numbers depend on how many ran before it.
  db.contractDocumentVersionCounters = [];
  db.signatureRequests = [];
  db.lineItems = [{ id: "li_1", jobId: JOB_ID, isDeleted: false }];
  jobUpdates.length = 0;
  redirects.length = 0;
  context.role = "OWNER";
  context.jobFunction = null;
});

/* ------------------------------------------------------- FIX 2: the GC picker */

describe("createJob no longer mints a duplicate GC on every job", () => {
  it("reuses the contact that was picked instead of creating a new one", async () => {
    const fd = new FormData();
    fd.set("jobName", "Building C — level 3");
    fd.set("contactId", "con_turner");

    await expect(createJob(fd)).rejects.toThrow(/NEXT_REDIRECT/);

    expect(db.contacts.filter((c) => c.companyId === COMPANY_ID)).toHaveLength(1);
    const job = db.jobs.at(-1)!;
    expect(job.contactId, "the job must hang off the GC that was picked").toBe("con_turner");
  });

  it("still creates a contact when this genuinely is a new GC", async () => {
    const fd = new FormData();
    fd.set("jobName", "New GC job");
    fd.set("contactName", "Swinerton");
    fd.set("contactEmail", "pm@swinerton.com");

    await expect(createJob(fd)).rejects.toThrow(/NEXT_REDIRECT/);

    const created = db.contacts.at(-1)!;
    expect(created.name).toBe("Swinerton");
    expect(created.email).toBe("pm@swinerton.com");
    expect(created.companyId).toBe(COMPANY_ID);
    expect(db.jobs.at(-1)!.contactId).toBe(created.id);
  });

  it("refuses a contact belonging to another company, and creates nothing", async () => {
    const fd = new FormData();
    fd.set("jobName", "Cross-tenant attempt");
    fd.set("contactId", "con_outsider");

    const result = await createJob(fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("isn't on your account");
    expect(db.jobs).toHaveLength(1);
    expect(redirects).toHaveLength(0);
  });

  it("refuses with a readable sentence rather than throwing, when nothing identifies the GC", async () => {
    const fd = new FormData();
    fd.set("jobName", "No GC at all");

    const result = await createJob(fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("Pick the GC");
    expect(db.contacts.filter((c) => c.companyId === COMPANY_ID)).toHaveLength(1);
  });

  it("refuses a job with no name", async () => {
    const fd = new FormData();
    fd.set("contactId", "con_turner");
    const result = await createJob(fd);
    expect(result.ok).toBe(false);
  });
});

/* ----------------------------------------- FIX 1: the executed-subcontract route */

describe("recording a subcontract the GC executed off-platform", () => {
  it("stores the file, the ENTERED signing date, who recorded it and when", async () => {
    const result = await recordExecutedSubcontract(JOB_ID, executedForm());

    expect(result).toEqual({ ok: true });
    const doc = db.contractDocuments.at(-1)!;
    expect((doc.executedSignedDate as Date).toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(doc.uploadedByUserId, "who asserted it").toBe(USER_ID);
    expect(doc.fileUrl, "must store the URL the blob store returned").toBe(
      storedUrl(OUR_STORE, `contracts/${JOB_ID}/subcontract-r4nd0m1.pdf`),
    );
    expect(doc.fileName, "the name the person picked, not the suffixed one").toBe(
      "subcontract.pdf",
    );
    expect(doc.versionNumber).toBe(1);
    expect(doc.jobId).toBe(JOB_ID);
  });

  it("REQUIRES the file — a bare assertion is not evidence", async () => {
    const result = await recordExecutedSubcontract(JOB_ID, executedForm({ fileUrl: "" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("Attach the executed subcontract");
    expect(db.contractDocuments).toHaveLength(0);
  });

  it("REQUIRES the signing date, and writes nothing without it", async () => {
    const result = await recordExecutedSubcontract(
      JOB_ID,
      executedForm({ executedSignedDate: "" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("date the GC signed");
    expect(db.contractDocuments).toHaveLength(0);
  });

  it("refuses a future signing date", async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const result = await recordExecutedSubcontract(
      JOB_ID,
      executedForm({ executedSignedDate: tomorrow }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("future");
    expect(db.contractDocuments).toHaveLength(0);
  });

  // THE TWO CASES THAT REPLACED THE OLD FILE-TYPE CHECK, and they are not
  // the same claim wearing different clothes. The type and the size are
  // now bound into the signed upload token and enforced by the store on
  // the transfer (see lib/document-uploads.ts), which is the only place
  // they could ever be enforced — the action never sees the bytes. What
  // the action must prove for itself is WHOSE FILE THIS IS, because it is
  // an endpoint anyone with a session can post a URL to, and the URL it
  // records is the one `deleteDocument` later hands to `del()`.
  it("refuses a well-formed URL from somebody else's blob store", async () => {
    const fd = executedForm({
      fileUrl: storedUrl("attackerstore", `contracts/${JOB_ID}/subcontract-r4nd0m1.pdf`),
    });

    const result = await recordExecutedSubcontract(JOB_ID, fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("did not come from this app's storage");
    expect(db.contractDocuments).toHaveLength(0);
  });

  it("refuses a URL in OUR store that belongs to a different job", async () => {
    const fd = executedForm({
      fileUrl: storedUrl(OUR_STORE, "contracts/job_somebody_else/subcontract-r4nd0m1.pdf"),
    });

    const result = await recordExecutedSubcontract(JOB_ID, fd);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("was not uploaded to this job");
    expect(db.contractDocuments).toHaveLength(0);
  });

  it("refuses a job belonging to another company", async () => {
    db.jobs.push({ id: "job_other", companyId: OTHER_COMPANY_ID, status: "ESTIMATE" });

    const result = await recordExecutedSubcontract("job_other", executedForm());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe("Job not found.");
    expect(db.contractDocuments).toHaveLength(0);
  });

  it("refuses someone whose job function does not manage jobs", async () => {
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING";

    const result = await recordExecutedSubcontract(JOB_ID, executedForm());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("job function");
    expect(db.contractDocuments).toHaveLength(0);
  });

  it("does NOT contract the job itself — that stays markJobContracted's single decision", async () => {
    await recordExecutedSubcontract(JOB_ID, executedForm());
    expect(jobUpdates, "recording evidence must not move job.status").toHaveLength(0);
    expect(db.jobs[0].status).toBe("ESTIMATE");
  });

  it("numbers a later executed amendment as a new version, overwriting nothing", async () => {
    await recordExecutedSubcontract(JOB_ID, executedForm());
    await recordExecutedSubcontract(JOB_ID, executedForm({ executedSignedDate: "2026-08-01" }));

    expect(db.contractDocuments.map((d) => d.versionNumber)).toEqual([1, 2]);
  });
});

describe("markJobContracted accepts either route, and neither is enough on its own when absent", () => {
  it("still refuses a job with no evidence at all", async () => {
    const result = await markJobContracted(JOB_ID);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error, "must name both routes").toContain("executed subcontract");
    expect(result.error).toContain("signing link");
    expect(jobUpdates).toHaveLength(0);
  });

  it("an ordinary contract upload with no signing date is still not enough", async () => {
    db.contractDocuments.push({
      id: "doc_plain",
      jobId: JOB_ID,
      versionNumber: 1,
      executedSignedDate: null,
    });

    const result = await markJobContracted(JOB_ID);

    expect(result.ok).toBe(false);
    expect(jobUpdates).toHaveLength(0);
  });

  it("contracts on a SIGNED signature request — the original route, unchanged", async () => {
    db.signatureRequests.push({ id: "sig_1", jobId: JOB_ID, status: "SIGNED" });

    expect(await markJobContracted(JOB_ID)).toEqual({ ok: true });
    expect(jobUpdates).toEqual([{ id: JOB_ID, status: "CONTRACTED" }]);
  });

  it("contracts on a recorded executed subcontract — the new route", async () => {
    await recordExecutedSubcontract(JOB_ID, executedForm());

    expect(await markJobContracted(JOB_ID)).toEqual({ ok: true });
    expect(jobUpdates).toEqual([{ id: JOB_ID, status: "CONTRACTED" }]);
  });

  it("still refuses a job with no line items, whichever route was used", async () => {
    db.lineItems = [];
    await recordExecutedSubcontract(JOB_ID, executedForm());

    const result = await markJobContracted(JOB_ID);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("line item");
    expect(jobUpdates).toHaveLength(0);
  });
});

/* ------------------------------------------------- FIX 3: the rest of the life */

describe("setJobStatus makes IN_PROGRESS and COMPLETE reachable at last", () => {
  const start = async (status: string) => {
    db.jobs[0].status = status;
  };

  it("moves a contracted job to in progress", async () => {
    await start("CONTRACTED");
    expect(await setJobStatus(JOB_ID, "IN_PROGRESS")).toEqual({ ok: true });
    expect(jobUpdates).toEqual([{ id: JOB_ID, status: "IN_PROGRESS" }]);
  });

  it("moves an in-progress job to complete", async () => {
    await start("IN_PROGRESS");
    expect(await setJobStatus(JOB_ID, "COMPLETE")).toEqual({ ok: true });
    expect(db.jobs[0].status).toBe("COMPLETE");
  });

  it("reopens a complete job", async () => {
    await start("COMPLETE");
    expect(await setJobStatus(JOB_ID, "IN_PROGRESS")).toEqual({ ok: true });
  });

  it("REFUSES the estimate → contracted shortcut, which would bypass the evidence gate", async () => {
    await start("ESTIMATE");

    const result = await setJobStatus(JOB_ID, "CONTRACTED");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("still an estimate");
    expect(jobUpdates, "no status write may happen").toHaveLength(0);
  });

  it("REFUSES going back to estimate, which would unlock contracted scope", async () => {
    await start("IN_PROGRESS");

    const result = await setJobStatus(JOB_ID, "ESTIMATE");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("change order");
    expect(jobUpdates).toHaveLength(0);
  });

  it("refuses a skipped step legibly rather than silently doing nothing", async () => {
    await start("CONTRACTED");

    const result = await setJobStatus(JOB_ID, "COMPLETE");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("Allowed from here: in progress.");
    expect(jobUpdates).toHaveLength(0);
  });

  it("refuses a status that is not a status", async () => {
    await start("CONTRACTED");

    const result = await setJobStatus(JOB_ID, "DONE");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe("That isn't a job status.");
    expect(jobUpdates).toHaveLength(0);
  });

  it("refuses a job belonging to another company", async () => {
    db.jobs.push({ id: "job_other", companyId: OTHER_COMPANY_ID, status: "CONTRACTED" });

    const result = await setJobStatus("job_other", "IN_PROGRESS");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe("Job not found.");
    expect(jobUpdates).toHaveLength(0);
  });

  it("refuses someone whose job function does not manage jobs", async () => {
    await start("CONTRACTED");
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING";

    const result = await setJobStatus(JOB_ID, "IN_PROGRESS");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("job function");
    expect(jobUpdates).toHaveLength(0);
  });
});
