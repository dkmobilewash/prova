import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every document upload must land at an UNGUESSABLE blob URL.
 *
 * `@vercel/blob@2.8.0` defaults `addRandomSuffix` to false — its own
 * `dist/index.d.ts:459` says so — so `put("compliance/<companyId>/COI.pdf", …)`
 * with `access: "public"` produces a permanently public URL that anyone who
 * knows the company id can derive from a guessed filename. Certified payroll,
 * lien waivers, COIs and W-9s were all reachable that way, and the path itself
 * leaked the companyId to every GC and insurer the link was sent to.
 *
 * This suite drives the four REAL upload actions with `@vercel/blob` faked,
 * and asserts on the options each one actually hands to `put` — the VALUE of
 * `addRandomSuffix`, not merely that a key of that name exists. A guard that
 * walks an options object for a key it never reads is the shape of bug this
 * repo has already shipped once (see the companyId where-clause scar), so
 * each assertion below names the value it demands.
 *
 * The fake `put` also implements the two documented defaults that bite:
 * no random suffix, and a THROW when the pathname already exists. That is
 * what made `uploadContractDocument` — a function whose whole purpose is
 * versioning — unable to store version 2 of a same-named amendment.
 */

type PutOptions = {
  access?: string;
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
  contentType?: string;
};

const putCalls: { pathname: string; options: PutOptions }[] = [];
const storedPaths = new Set<string>();
let suffixSeed = 0;

/** Mirrors @vercel/blob@2.8.0 `put`: addRandomSuffix defaults false, and an
 * existing pathname throws unless allowOverwrite is set. */
function fakePut(pathname: string, _body: unknown, options: PutOptions = {}) {
  putCalls.push({ pathname, options });
  suffixSeed += 1;
  const finalPathname = options.addRandomSuffix
    ? pathname.replace(/(\.[^./]+)?$/, (ext) => `-r4nd0m${suffixSeed}${ext}`)
    : pathname;
  if (storedPaths.has(finalPathname) && !options.allowOverwrite) {
    throw new Error(
      "Vercel Blob: This blob already exists, use `allowOverwrite: true` to overwrite it",
    );
  }
  storedPaths.add(finalPathname);
  return Promise.resolve({
    url: `https://store123.public.blob.vercel-storage.com/${finalPathname}`,
    pathname: finalPathname,
    contentType: options.contentType ?? "application/octet-stream",
    contentDisposition: `inline; filename="${finalPathname}"`,
    downloadUrl: `https://store123.public.blob.vercel-storage.com/${finalPathname}?download=1`,
  });
}

const COMPANY_ID = "cmp_alpha";
const JOB_ID = "job_alpha";

const created: Record<string, Record<string, unknown>[]> = {};

function record(model: string) {
  return async ({ data }: { data: Record<string, unknown> }) => {
    (created[model] ??= []).push(data);
    return { id: `${model}_${(created[model] as unknown[]).length}`, ...data };
  };
}

const prisma = {
  job: { findUnique: async () => ({ id: JOB_ID, companyId: COMPANY_ID, status: "ESTIMATE" }) },
  user: { findUnique: async () => ({ id: "usr_1", companyId: COMPANY_ID }) },
  craftClassification: { findFirst: async () => null },
  complianceDocument: { create: record("complianceDocument") },
  dispatchSlip: { create: record("dispatchSlip") },
  prevailingWageDetermination: { create: record("prevailingWageDetermination") },
  contractDocument: {
    create: record("contractDocument"),
    findFirst: async () => {
      const rows = created.contractDocument ?? [];
      if (rows.length === 0) return null;
      return rows.reduce((a, b) => (Number(a.versionNumber) > Number(b.versionNumber) ? a : b));
    },
  },
};

vi.mock("@vercel/blob", () => ({
  put: (pathname: string, body: unknown, options: PutOptions) => fakePut(pathname, body, options),
}));
vi.mock("@prova/db", () => ({ prisma }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({ id: "usr_1", role: "OWNER", company: { id: COMPANY_ID } }),
}));
vi.mock("@prova/integrations", () => ({
  extractComplianceDocument: async () => ({
    type: "CERTIFICATE_OF_INSURANCE",
    partyName: "Acme Insurance",
    amount: null,
    periodStart: null,
    periodEnd: null,
    effectiveDate: null,
    expiresAt: null,
    notes: null,
  }),
  revokeToken: async () => {},
  refreshTokens: async () => {},
  getCompanyInfo: async () => ({}),
  generateWipNarrative: async () => "",
}));

const { uploadComplianceDocument } = await import("./actions/compliance");
const { uploadDispatchSlip, uploadPrevailingWageDetermination } = await import("./actions/labor");
const { uploadContractDocument } = await import("./actions/billing");

function pdf(name: string) {
  return new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });
}

beforeEach(() => {
  putCalls.length = 0;
  storedPaths.clear();
  suffixSeed = 0;
  for (const key of Object.keys(created)) delete created[key];
});

/** The one assertion that matters, applied identically to all four sites. */
function expectUnguessable(call: { pathname: string; options: PutOptions }) {
  expect(call.options.addRandomSuffix, `put("${call.pathname}") must randomise the pathname`).toBe(
    true,
  );
  expect(call.options.access).toBe("public");
}

describe("every uploaded document gets an unguessable blob pathname", () => {
  it("uploadComplianceDocument randomises the pathname and stores the URL it got back", async () => {
    const form = new FormData();
    form.set("file", pdf("COI.pdf"));
    await uploadComplianceDocument(form);

    expect(putCalls).toHaveLength(1);
    expectUnguessable(putCalls[0]);
    // The deterministic prefix still carries the companyId; the suffix is
    // what stops the whole URL being derivable from it.
    expect(putCalls[0].pathname).toBe(`compliance/${COMPANY_ID}/COI.pdf`);

    const row = created.complianceDocument[0];
    expect(row.fileUrl).toBe(
      "https://store123.public.blob.vercel-storage.com/compliance/cmp_alpha/COI-r4nd0m1.pdf",
    );
    // Nothing may rebuild the URL from the requested pathname: the stored
    // URL must be the one `put` returned, suffix and all.
    expect(row.fileUrl).not.toContain("/COI.pdf");
  });

  it("uploadDispatchSlip randomises the pathname", async () => {
    const form = new FormData();
    form.set("employeeUserId", "usr_1");
    form.set("dispatchDate", "2026-09-01");
    form.set("file", pdf("dispatch.pdf"));
    await uploadDispatchSlip(JOB_ID, form);

    expect(putCalls).toHaveLength(1);
    expectUnguessable(putCalls[0]);
    expect(created.dispatchSlip[0].fileUrl).toContain("r4nd0m");
  });

  it("uploadPrevailingWageDetermination randomises the pathname", async () => {
    const form = new FormData();
    form.set("jurisdiction", "California DIR");
    form.set("file", pdf("determination.pdf"));
    const result = await uploadPrevailingWageDetermination(JOB_ID, form);

    expect(result).toEqual({ ok: true });
    expect(putCalls).toHaveLength(1);
    expectUnguessable(putCalls[0]);
    expect(created.prevailingWageDetermination[0].fileUrl).toContain("r4nd0m");
  });

  it("uploadContractDocument randomises the pathname", async () => {
    const form = new FormData();
    form.set("file", pdf("subcontract.pdf"));
    await uploadContractDocument(JOB_ID, form);

    expect(putCalls).toHaveLength(1);
    expectUnguessable(putCalls[0]);
    expect(created.contractDocument[0].fileUrl).toContain("r4nd0m");
  });
});

describe("contract documents can actually be versioned", () => {
  /**
   * The functional half of the same bug. `allowOverwrite` also defaults
   * false, so the second upload of a same-named amendment threw at the blob
   * store before any row was written — version 2 of "subcontract.pdf" was
   * impossible, in a function that computes `versionNumber + 1`.
   */
  it("stores a second upload of the SAME filename as version 2", async () => {
    const first = new FormData();
    first.set("file", pdf("subcontract.pdf"));
    first.set("note", "original");
    await uploadContractDocument(JOB_ID, first);

    const second = new FormData();
    second.set("file", pdf("subcontract.pdf"));
    second.set("note", "amendment 1");
    await uploadContractDocument(JOB_ID, second);

    const rows = created.contractDocument;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.versionNumber)).toEqual([1, 2]);
    // Both versions must remain retrievable — the schema comment promises
    // "all kept, never overwritten", which a shared pathname would break.
    expect(rows[0].fileUrl).not.toBe(rows[1].fileUrl);
  });
});
