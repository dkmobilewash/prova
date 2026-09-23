import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three deletes #351 found unguarded or under-guarded, driven through
 * the real actions against a faked database.
 *
 * `deletePayment` and `deleteRetainageRelease` asserted MANAGE_BILLING and
 * nothing else — any billing member could un-record money with no trace,
 * and a pushed payment then drifted against QuickBooks silently. They are
 * owner-only now, in the same order `deleteContractDocument` settled on:
 * capability first, then owner. And `deleteContractDocument` itself keeps
 * an executed subcontract on a job that has left ESTIMATE (CLAUDE.md's
 * evidence-record rule), while an executed date on an ESTIMATE job stays
 * deletable.
 *
 * These are throw-style actions bound into server-rendered <form action>s,
 * so a refusal has nowhere to render; the pages withhold the control from
 * everyone this refuses. `ownerRefusalCensus` does not judge throw-style
 * actions, which is why the gate is proved by execution here rather than
 * by scan.
 */

const COMPANY_ID = "cmp_alpha";
const JOB_ID = "job_alpha";

type Row = Record<string, unknown>;

const db = {
  jobs: [] as Row[],
  payments: [] as Row[],
  releases: [] as Row[],
  contractDocuments: [] as Row[],
};

const deleted = { payments: [] as string[], releases: [] as string[], documents: [] as string[] };
const blobsDeleted: string[] = [];

const prisma = {
  job: {
    findUnique: async ({ where }: { where: Row }) => db.jobs.find((j) => j.id === where.id) ?? null,
  },
  payment: {
    findUnique: async ({ where }: { where: Row }) => {
      const payment = db.payments.find((p) => p.id === where.id);
      if (!payment) return null;
      const job = db.jobs.find((j) => j.id === JOB_ID)!;
      return { ...payment, invoice: { jobId: JOB_ID, job } };
    },
    delete: async ({ where }: { where: Row }) => {
      deleted.payments.push(where.id as string);
      return {};
    },
  },
  retainageRelease: {
    findUnique: async ({ where }: { where: Row }) =>
      db.releases.find((r) => r.id === where.id) ?? null,
    delete: async ({ where }: { where: Row }) => {
      deleted.releases.push(where.id as string);
      return {};
    },
  },
  contractDocument: {
    findUnique: async ({ where }: { where: Row }) => {
      const doc = db.contractDocuments.find((d) => d.id === where.id);
      if (!doc) return null;
      return { ...doc, job: db.jobs.find((j) => j.id === doc.jobId) };
    },
    delete: async ({ where }: { where: Row }) => {
      deleted.documents.push(where.id as string);
      return {};
    },
  },
};

const context = {
  id: "usr_1",
  role: "OWNER" as string,
  jobFunction: null as string | null,
  company: { id: COMPANY_ID },
};

vi.mock("@prova/db", () => ({ prisma, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("@/lib/blob", () => ({
  deleteDocument: async (url: string) => {
    blobsDeleted.push(url);
  },
}));

const { deletePayment, deleteRetainageRelease, deleteContractDocument } = await import("./billing");

beforeEach(() => {
  db.jobs = [{ id: JOB_ID, companyId: COMPANY_ID, status: "CONTRACTED" }];
  db.payments = [{ id: "pay_1", amount: 1000 }];
  db.releases = [{ id: "rel_1", jobId: JOB_ID, amount: 500 }];
  db.contractDocuments = [];
  deleted.payments = [];
  deleted.releases = [];
  deleted.documents = [];
  blobsDeleted.length = 0;
  context.role = "OWNER";
  // A job function that HOLDS MANAGE_BILLING, so the owner check is the only
  // thing standing between a member and the delete.
  context.jobFunction = "ACCOUNTING";
});

describe("deletePayment (#351)", () => {
  it("lets the owner remove a recorded payment", async () => {
    await deletePayment(JOB_ID, "pay_1");
    expect(deleted.payments).toEqual(["pay_1"]);
  });

  it("refuses a MEMBER who holds MANAGE_BILLING, naming the owner, and deletes nothing", async () => {
    context.role = "MEMBER";
    await expect(deletePayment(JOB_ID, "pay_1")).rejects.toThrow(/account owner/);
    expect(deleted.payments).toEqual([]);
  });

  it("still refuses on capability first — a member without billing is refused for that, not for ownership", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const message = await deletePayment(JOB_ID, "pay_1").then(
      () => "did not throw",
      (error: Error) => error.message,
    );
    expect(message).toMatch(/Invoices and payments/);
    expect(message).not.toMatch(/can remove a recorded payment/);
    expect(deleted.payments).toEqual([]);
  });
});

describe("deleteRetainageRelease (#351)", () => {
  it("lets the owner remove a release", async () => {
    await deleteRetainageRelease(JOB_ID, "rel_1");
    expect(deleted.releases).toEqual(["rel_1"]);
  });

  it("refuses a MEMBER who holds MANAGE_BILLING and deletes nothing", async () => {
    context.role = "MEMBER";
    await expect(deleteRetainageRelease(JOB_ID, "rel_1")).rejects.toThrow(/account owner/);
    expect(deleted.releases).toEqual([]);
  });
});

describe("deleteContractDocument keeps the executed subcontract (#351)", () => {
  it("refuses to delete an executed document on a contracted job, and touches no blob", async () => {
    db.contractDocuments = [
      { id: "doc_exec", jobId: JOB_ID, fileUrl: "blob://exec.pdf", executedSignedDate: new Date("2026-08-01") },
    ];
    await expect(deleteContractDocument("doc_exec")).rejects.toThrow(/executed subcontract/);
    expect(deleted.documents).toEqual([]);
    expect(blobsDeleted).toEqual([]);
  });

  it("still deletes an executed document while the job is at ESTIMATE — a wrong upload stays cheap to undo", async () => {
    db.jobs = [{ id: JOB_ID, companyId: COMPANY_ID, status: "ESTIMATE" }];
    db.contractDocuments = [
      { id: "doc_exec", jobId: JOB_ID, fileUrl: "blob://exec.pdf", executedSignedDate: new Date("2026-08-01") },
    ];
    await deleteContractDocument("doc_exec");
    expect(deleted.documents).toEqual(["doc_exec"]);
    expect(blobsDeleted).toEqual(["blob://exec.pdf"]);
  });

  it("still deletes an ordinary, unexecuted document on a contracted job", async () => {
    db.contractDocuments = [
      { id: "doc_plain", jobId: JOB_ID, fileUrl: "blob://plain.pdf", executedSignedDate: null },
    ];
    await deleteContractDocument("doc_plain");
    expect(deleted.documents).toEqual(["doc_plain"]);
  });
});
