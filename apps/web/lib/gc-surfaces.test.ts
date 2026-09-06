import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The actions behind the three GC-facing surfaces, driven for real with the
 * database and blob store faked.
 *
 * Every assertion here is about something that was live: a signature that
 * could be overwritten by a second click, two legal documents both called
 * "Version 2", a deleted contract PDF that stayed downloadable, and two
 * bearer links that could never be taken back. The fake prisma below records
 * the arguments each action actually passes, so these tests fail when the
 * BEHAVIOUR changes rather than when a name does.
 *
 * The cross-tenant cases are the ones worth reading twice. A token or an id
 * that belongs to another company must be refused, and — the part a shallow
 * test misses — the side effect must not have happened either. Deleting
 * someone else's contract document has to leave their FILE alone, not merely
 * return an error afterwards.
 */

const OUR_COMPANY = "cmp_ours";
const THEIR_COMPANY = "cmp_theirs";
const OUR_JOB = "job_ours";
const THEIR_JOB = "job_theirs";

// ---------------------------------------------------------------- fake blob

const deletedUrls: string[] = [];
let putSeed = 0;

vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, _body: unknown, options: { contentType?: string }) => {
    putSeed += 1;
    return {
      url: `https://store.public.blob.vercel-storage.com/${pathname}-r${putSeed}`,
      pathname: `${pathname}-r${putSeed}`,
      contentType: options.contentType ?? "application/octet-stream",
      contentDisposition: "inline",
      downloadUrl: "https://store.public.blob.vercel-storage.com/x?download=1",
    };
  },
  del: async (url: string) => {
    deletedUrls.push(url);
  },
}));

// -------------------------------------------------------------- fake prisma

type Row = Record<string, string | number | Date | null | undefined | object>;

const db = {
  jobs: [] as Row[],
  contacts: [] as Row[],
  signatureRequests: [] as Row[],
  contractDocuments: [] as Row[],
  lineItems: [] as Row[],
  /** The counter table the version fix introduced. */
  contractDocumentCounters: new Map<string, number>(),
};

let role = "OWNER";

function jobOf(jobId: string) {
  return db.jobs.find((j) => j.id === jobId);
}

const prisma = {
  job: {
    findUnique: async ({ where }: { where: { id: string } }) => jobOf(where.id) ?? null,
  },
  contact: {
    findUnique: async ({ where }: { where: { id?: string; portalToken?: string } }) =>
      db.contacts.find((c) =>
        where.id !== undefined ? c.id === where.id : c.portalToken === where.portalToken,
      ) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = db.contacts.find((c) => c.id === where.id);
      Object.assign(row as Row, data);
      return row;
    },
  },
  signatureRequest: {
    findUnique: async ({ where }: { where: { id?: string; token?: string } }) => {
      const row = db.signatureRequests.find((s) =>
        where.id !== undefined ? s.id === where.id : s.token === where.token,
      );
      if (!row) return null;
      const job = jobOf(row.jobId as string);
      return { ...row, job: { ...job, company: { name: "Ours Drywall" }, contact: { name: "Pat GC" } } };
    },
    findFirst: async () => null,
    create: async ({ data }: { data: Row }) => {
      const row = { id: `sig_${db.signatureRequests.length + 1}`, createdAt: new Date(), ...data };
      db.signatureRequests.push(row);
      return row;
    },
    // The whole point of the double-submit fix: the WHERE decides, not the
    // caller. This fake honours it exactly as Postgres would.
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const matches = db.signatureRequests.filter((s) =>
        Object.entries(where).every(([key, value]) => s[key] === value),
      );
      for (const row of matches) Object.assign(row, data);
      return { count: matches.length };
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const matches = db.signatureRequests.filter((s) =>
        Object.entries(where).every(([key, value]) => s[key] === value),
      );
      db.signatureRequests = db.signatureRequests.filter((s) => !matches.includes(s));
      return { count: matches.length };
    },
  },
  jobLineItem: {
    findMany: async ({ where }: { where: { jobId: string } }) =>
      db.lineItems.filter((l) => l.jobId === where.jobId),
  },
  contractDocument: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = db.contractDocuments.find((d) => d.id === where.id);
      return row ? { ...row, job: jobOf(row.jobId as string) } : null;
    },
    findFirst: async ({ where }: { where: { jobId: string } }) => {
      const rows = db.contractDocuments.filter((d) => d.jobId === where.jobId);
      if (rows.length === 0) return null;
      return rows.reduce((a, b) => (Number(a.versionNumber) > Number(b.versionNumber) ? a : b));
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `doc_${db.contractDocuments.length + 1}`, ...data };
      db.contractDocuments.push(row);
      return row;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      db.contractDocuments = db.contractDocuments.filter((d) => d.id !== where.id);
      return { id: where.id };
    },
  },
  contractDocumentCounter: {
    upsert: async ({ where, create }: { where: { jobId: string }; create: { lastNumber: number } }) => {
      const current = db.contractDocumentCounters.get(where.jobId);
      const next = current === undefined ? create.lastNumber : current + 1;
      db.contractDocumentCounters.set(where.jobId, next);
      return { lastNumber: next };
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
};

vi.mock("@prova/db", () => ({ prisma, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({ id: "usr_1", role, company: { id: OUR_COMPANY } }),
}));
vi.mock("@prova/integrations", () => ({
  revokeToken: async () => {},
  refreshTokens: async () => {},
  getCompanyInfo: async () => ({}),
  generateWipNarrative: async () => "",
}));

const {
  deleteContractDocument,
  revokePortalAccess,
  revokeSignatureRequest,
  signRequest,
  uploadContractDocument,
} = await import("./actions/billing");

function pdf(name: string) {
  return new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });
}

function uploadForm(name: string) {
  const form = new FormData();
  form.set("file", pdf(name));
  return form;
}

function signForm(signerName: string) {
  const form = new FormData();
  form.set("signerName", signerName);
  form.set("agree", "on");
  return form;
}

beforeEach(() => {
  role = "OWNER";
  deletedUrls.length = 0;
  putSeed = 0;
  db.jobs = [
    { id: OUR_JOB, companyId: OUR_COMPANY, status: "ESTIMATE", name: "Tower B", scope: null },
    { id: THEIR_JOB, companyId: THEIR_COMPANY, status: "ESTIMATE", name: "Not ours", scope: null },
  ];
  db.contacts = [
    { id: "con_ours", companyId: OUR_COMPANY, name: "Pat GC", status: "ACTIVE", portalToken: "tok_ours" },
    { id: "con_theirs", companyId: THEIR_COMPANY, name: "Someone else", status: "ACTIVE", portalToken: "tok_theirs" },
  ];
  db.signatureRequests = [];
  db.contractDocuments = [];
  db.contractDocumentCounters = new Map();
  db.lineItems = [
    { id: "li_1", jobId: OUR_JOB, description: "Framing", quantity: "10", unit: "SF", unitPrice: "12.50" },
  ];
});

/* ------------------------------------------------------------------------ */

describe("signing a contract twice", () => {
  beforeEach(() => {
    db.signatureRequests.push({
      id: "sig_1",
      jobId: OUR_JOB,
      token: "sign_tok",
      status: "PENDING",
      createdAt: new Date(),
    });
  });

  it("records the signature once and refuses the second click without crashing", async () => {
    const first = await signRequest("sign_tok", signForm("Pat GC"));
    expect(first.ok).toBe(true);

    // The exact double-click. It used to THROW here — production redacts a
    // thrown action message to a digest, so the GC saw an unexplained server
    // error on a contract that had, in fact, been signed.
    const second = await signRequest("sign_tok", signForm("Pat GC"));
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toMatch(/already been signed/i);
  });

  it("does not let a CONCURRENT second submit rewrite the evidence", async () => {
    // Deliberately concurrent, not sequential. A sequential second call is
    // caught by the early `status === "SIGNED"` read and never reaches the
    // write at all — which is exactly why an earlier version of this test
    // stayed GREEN with the conditional WHERE removed. Two real clicks a
    // few hundred milliseconds apart are two in-flight requests that both
    // read PENDING, and only the WHERE decides which one wins.
    const [first, second] = await Promise.all([
      signRequest("sign_tok", signForm("Pat GC")),
      signRequest("sign_tok", signForm("Somebody Else")),
    ]);

    // Exactly one of them signed; the other was told the truth rather than
    // being thrown at.
    expect([first.ok, second.ok].sort()).toEqual([false, true]);

    // The snapshot is the record of what was agreed at the instant it was
    // agreed. A second write to it is not a duplicate row, it is a rewrite
    // of the evidence — which the conditional updateMany makes impossible.
    expect(
      db.signatureRequests[0].signerName,
      "the loser of the race must not overwrite the signer on the record",
    ).toBe("Pat GC");
    expect(db.signatureRequests.filter((s) => s.status === "SIGNED")).toHaveLength(1);
  });

  it("refuses a second click in words, rather than throwing at a stranger", async () => {
    await signRequest("sign_tok", signForm("Pat GC"));

    // Production redacts a THROWN Server Action message to a digest. On this
    // page the reader is a GC with no account, looking at a contract that
    // has in fact just been signed. A rejected promise here is the bug.
    const second = await signRequest("sign_tok", signForm("Pat GC")).catch(
      (error: Error) => ({ ok: false as const, error: `THREW: ${error.message}` }),
    );

    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).not.toMatch(/^THREW:/);
  });

  it("freezes the line items as they stood, and never recomputes them", async () => {
    await signRequest("sign_tok", signForm("Pat GC"));
    const snapshot = db.signatureRequests[0].snapshot as {
      total: number;
      lineItems: { description: string; unitPrice: string | null }[];
    };
    expect(snapshot.lineItems).toEqual([
      { description: "Framing", quantity: "10", unit: "SF", unitPrice: "12.50" },
    ]);
    expect(snapshot.total).toBe(125);

    // Re-price the job afterwards. The snapshot must not move.
    db.lineItems[0].unitPrice = "99.00";
    expect(
      (db.signatureRequests[0].snapshot as { total: number }).total,
      "a signed snapshot is a value copy — nothing may recompute it",
    ).toBe(125);
  });
});

describe("a signing link that is no longer live", () => {
  it("refuses to sign an expired link even if the form was left open", async () => {
    db.signatureRequests.push({
      id: "sig_old",
      jobId: OUR_JOB,
      token: "old_tok",
      status: "PENDING",
      createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    });

    const result = await signRequest("old_tok", signForm("Pat GC"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/expired/i);
    expect(db.signatureRequests[0].status, "nothing may be signed by an expired link").toBe("PENDING");
  });

  it("refuses once the job is already under contract by the other route", async () => {
    db.jobs[0].status = "CONTRACTED";
    db.signatureRequests.push({
      id: "sig_2",
      jobId: OUR_JOB,
      token: "late_tok",
      status: "PENDING",
      createdAt: new Date(),
    });

    const result = await signRequest("late_tok", signForm("Pat GC"));

    expect(result.ok).toBe(false);
    expect(db.signatureRequests[0].status).toBe("PENDING");
  });

  it("refuses a token that does not exist, without saying anything about it", async () => {
    const result = await signRequest("not_a_token", signForm("Pat GC"));
    expect(result.ok).toBe(false);
  });
});

describe("revoking the portal link", () => {
  it("removes the credential rather than flagging it", async () => {
    const result = await revokePortalAccess("con_ours");

    expect(result.ok).toBe(true);
    expect(db.contacts[0].portalToken, "revocation means the token is GONE").toBe(null);
  });

  it("cannot touch another company's contact", async () => {
    const result = await revokePortalAccess("con_theirs");

    expect(result.ok).toBe(false);
    expect(
      db.contacts[1].portalToken,
      "a cross-tenant call must leave the other company's link exactly as it was",
    ).toBe("tok_theirs");
  });

  it("is owner-only", async () => {
    role = "MEMBER";
    await expect(revokePortalAccess("con_ours")).rejects.toThrow(/owner/i);
    expect(db.contacts[0].portalToken).toBe("tok_ours");
  });
});

describe("revoking the signing link", () => {
  beforeEach(() => {
    db.signatureRequests.push(
      { id: "sig_ours", jobId: OUR_JOB, token: "t_ours", status: "PENDING", createdAt: new Date() },
      { id: "sig_theirs", jobId: THEIR_JOB, token: "t_theirs", status: "PENDING", createdAt: new Date() },
    );
  });

  it("withdraws an unsigned request", async () => {
    const result = await revokeSignatureRequest("sig_ours");

    expect(result.ok).toBe(true);
    expect(db.signatureRequests.map((s) => s.id)).toEqual(["sig_theirs"]);
  });

  it("cannot withdraw another company's request", async () => {
    const result = await revokeSignatureRequest("sig_theirs");

    expect(result.ok).toBe(false);
    expect(
      db.signatureRequests.map((s) => s.id),
      "a cross-tenant call must delete nothing at all",
    ).toEqual(["sig_ours", "sig_theirs"]);
  });

  it("refuses to withdraw a SIGNED contract — that is the record", async () => {
    db.signatureRequests[0].status = "SIGNED";

    const result = await revokeSignatureRequest("sig_ours");

    expect(result.ok).toBe(false);
    expect(db.signatureRequests.map((s) => s.id)).toEqual(["sig_ours", "sig_theirs"]);
  });

  it("is owner-only", async () => {
    role = "MEMBER";
    await expect(revokeSignatureRequest("sig_ours")).rejects.toThrow(/owner/i);
    expect(db.signatureRequests).toHaveLength(2);
  });
});

describe("contract document version numbers", () => {
  it("never reissues a number after a version is deleted", async () => {
    await uploadContractDocument(OUR_JOB, uploadForm("subcontract.pdf"));
    await uploadContractDocument(OUR_JOB, uploadForm("amendment.pdf"));
    expect(db.contractDocuments.map((d) => d.versionNumber)).toEqual([1, 2]);

    // Delete v2 and upload a DIFFERENT amendment. Under max+1 this was
    // version 2 again — two different legal documents, both "Version 2".
    await deleteContractDocument("doc_2");
    await uploadContractDocument(OUR_JOB, uploadForm("different-amendment.pdf"));

    expect(db.contractDocuments.map((d) => d.versionNumber)).toEqual([1, 3]);
  });

  it("counts per job, so one job's uploads never shift another's", async () => {
    await uploadContractDocument(OUR_JOB, uploadForm("a.pdf"));
    await uploadContractDocument(OUR_JOB, uploadForm("b.pdf"));

    db.jobs[1].companyId = OUR_COMPANY;
    await uploadContractDocument(THEIR_JOB, uploadForm("c.pdf"));

    const other = db.contractDocuments.find((d) => d.jobId === THEIR_JOB);
    expect(other?.versionNumber, "a second job's original is still version 1").toBe(1);
  });
});

describe("deleting a contract document", () => {
  beforeEach(async () => {
    await uploadContractDocument(OUR_JOB, uploadForm("subcontract.pdf"));
  });

  it("deletes the FILE, not just the row", async () => {
    const url = db.contractDocuments[0].fileUrl as string;

    await deleteContractDocument("doc_1");

    // `del` was imported nowhere in this repo. Every upload is
    // access:"public" and the row was the only thing that went, so the
    // subcontract stayed downloadable by anyone still holding the URL.
    expect(deletedUrls).toEqual([url]);
    expect(db.contractDocuments).toHaveLength(0);
  });

  it("deletes the STORED url, not a rebuilt pathname", async () => {
    // putDocument adds a random suffix, so a URL reconstructed from jobId +
    // filename points at nothing — it would delete nothing and report
    // success, which is worse than the bug it replaced.
    expect(deletedUrls).toHaveLength(0);
    await deleteContractDocument("doc_1");
    expect(deletedUrls[0]).toContain("-r1");
  });

  it("does not touch another company's file", async () => {
    db.contractDocuments.push({
      id: "doc_theirs",
      jobId: THEIR_JOB,
      versionNumber: 1,
      fileUrl: "https://store.public.blob.vercel-storage.com/contracts/theirs.pdf",
      fileName: "theirs.pdf",
    });

    await expect(deleteContractDocument("doc_theirs")).rejects.toThrow(/not found/i);

    expect(deletedUrls, "a cross-tenant delete must not reach the blob store at all").toEqual([]);
    expect(db.contractDocuments.some((d) => d.id === "doc_theirs")).toBe(true);
  });

  it("is owner-only, and a non-owner deletes no file", async () => {
    role = "MEMBER";
    await expect(deleteContractDocument("doc_1")).rejects.toThrow(/owner/i);
    expect(deletedUrls).toEqual([]);
    expect(db.contractDocuments).toHaveLength(1);
  });
});
