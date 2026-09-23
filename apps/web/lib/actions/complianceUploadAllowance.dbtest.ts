import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * THE COMPLIANCE UPLOAD AND THE ASK BOX SPEND ONE LEDGER — against a real
 * Postgres, through the real `AskAllowancePeriod` row.
 *
 * `lib/actions/complianceUploadAllowance.test.ts` proves the ORDER with the
 * ledger mocked: counted, claimed, and only then sent to the model. That
 * test cannot prove the thing a customer actually buys, because a mock will
 * happily agree that two different rows are the same row.
 *
 * So the claim here is the one worth paying for: **a document uploaded on
 * `/compliance` reduces what the assistant has left on `/settings/assistant`
 * and in the Ask box, because there is exactly one row and both surfaces
 * increment it.** A second ledger for documents would satisfy every
 * assertion in the unit file and would be the whole leak back again, in a
 * tidier shape.
 *
 * Everything below reads the figures through the SAME functions the app
 * reads them through — `allowanceSummary` is what the settings page calls,
 * `claimAskAllowance` is what `streamAnswer` calls — rather than through a
 * hand-written SELECT that could agree with the writer and disagree with
 * the app.
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

/** The extractor is a real Claude call in production and must never be one
 * here. What matters is whether it is REACHED at all — a refusal that still
 * calls it has spent the money it refused. */
let extractorCalls = 0;
vi.mock("@prova/integrations", () => ({
  ASK_DEFAULT_MODEL: "test-model",
  extractComplianceDocument: async () => {
    extractorCalls += 1;
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

/** The blob store, serving back a document the browser already uploaded.
 * A dbtest cannot reach real Vercel Blob, and the bytes are the point: the
 * page count comes out of them. */
let served: Buffer = Buffer.alloc(0);
let servedType = "application/pdf";
vi.stubGlobal(
  "fetch",
  async () =>
    new Response(Buffer.from(served), { status: 200, headers: { "content-type": servedType } }),
);

const { uploadComplianceDocument } = await import("./compliance");
const { allowanceSummary, claimAskAllowance, periodStartFor, ASK_MONTHLY_ALLOWANCE } =
  await import("@/lib/ask/allowance");

const stamp = Date.now();
let companyId = "";
let uploadSeq = 0;

/** A real PDF with a countable page tree — the same shape the Ask side is
 * measured with, so "a document costs its pages" means the same thing on
 * both surfaces. */
function pdfOf(pages: number): Buffer {
  return Buffer.from(
    ["%PDF-1.4", `2 0 obj << /Type /Pages /Count ${pages} >> endobj`]
      .concat(Array.from({ length: pages }, () => "<< /Type /Page /MediaBox [0 0 612 792] >>"))
      .join("\n"),
    "latin1",
  );
}

function form() {
  uploadSeq += 1;
  const fd = new FormData();
  fd.set(
    "fileUrl",
    `https://${OUR_STORE}.public.blob.vercel-storage.com/compliance/${companyId}/COI-r4nd0m${uploadSeq}.pdf`,
  );
  fd.set("fileName", "COI.pdf");
  return fd;
}

/** This month's row, read straight rather than through the app, ONLY to
 * count how many of them exist. Everything else goes through the app's own
 * readers. */
async function ledgerRows() {
  return prisma.askAllowancePeriod.findMany({ where: { companyId } });
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Doc Allowance Co ${stamp}` } });
  companyId = company.id;
  context.companyId = company.id;
  context.company.id = company.id;
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `doc_allowance_${stamp}`,
      email: `doc-allowance-${stamp}@test.example`,
      role: "OWNER",
    },
  });
  context.id = user.id;
});

afterAll(async () => {
  await prisma.askAllowancePeriod.deleteMany({ where: { companyId } });
  await prisma.complianceDocument.deleteMany({ where: { companyId } });
  await prisma.askUsage.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

beforeEach(async () => {
  extractorCalls = 0;
  servedType = "application/pdf";
  context.role = "OWNER";
  context.jobFunction = null;
  await prisma.complianceDocument.deleteMany({ where: { companyId } });
  await prisma.askAllowancePeriod.deleteMany({ where: { companyId } });
});

describe("a document charges its real page count to the company's month", () => {
  it("writes one row, incremented by the pages the file actually has", async () => {
    served = pdfOf(23);

    const result = await uploadComplianceDocument(form());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the upload to succeed");
    expect(result.value).toEqual({ note: "23 pages", pagesLeft: 277 });

    const rows = await ledgerRows();
    // ONE row. A document ledger of its own would pass every other
    // assertion in this file and be the leak in a tidier shape.
    expect(rows).toHaveLength(1);
    expect(rows[0].periodStart).toEqual(periodStartFor(new Date()));
    expect(rows[0].pagesUsed).toBe(23);
    // A document is one request to the model, so it costs a question too —
    // which is what keeps the two surfaces comparable on the settings page.
    expect(rows[0].questionsUsed).toBe(1);
    expect(rows[0].failedPages).toBe(0);

    expect(await prisma.complianceDocument.count({ where: { companyId } })).toBe(1);
  });

  it("ONE LEDGER: the pages it took are the pages the Ask box has lost", async () => {
    served = pdfOf(40);
    expect((await uploadComplianceDocument(form())).ok).toBe(true);

    // 1. What the OWNER sees on /settings/assistant. This is the function
    //    that page calls, not a re-derivation of it.
    const summary = await allowanceSummary(companyId);
    expect(summary.readable).toBe(true);
    expect(summary.pagesUsed).toBe(40);
    expect(summary.pagesLeft).toBe(ASK_MONTHLY_ALLOWANCE.pages - 40);
    expect(summary.questionsUsed).toBe(1);

    // 2. What the ASK BOX gets when it next claims. `streamAnswer` calls
    //    exactly this, and it reports 260 pages left rather than 300 —
    //    which is only possible if the upload and the question are counting
    //    against the same row.
    const asked = await claimAskAllowance(companyId, { questions: 1, pages: 0 });
    expect(asked.ok).toBe(true);
    if (!asked.ok) throw new Error("expected the question to be claimed");
    expect(asked.left.pages).toBe(ASK_MONTHLY_ALLOWANCE.pages - 40);
    expect(asked.left.questions).toBe(ASK_MONTHLY_ALLOWANCE.questions - 2);

    // 3. And still one row afterwards.
    expect(await ledgerRows()).toHaveLength(1);
  });
});

describe("a refusal takes nothing", () => {
  it("leaves the ledger and the document list exactly as they were", async () => {
    // A month with 2 pages left, spent through the Ask box's own claim so
    // the starting state is one the app could really produce.
    const filled = await claimAskAllowance(companyId, {
      questions: 1,
      pages: ASK_MONTHLY_ALLOWANCE.pages - 2,
    });
    expect(filled.ok).toBe(true);
    const before = (await ledgerRows())[0];

    served = pdfOf(5);
    const result = await uploadComplianceDocument(form());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // The person is told what ran out, that nothing was charged and when it
    // comes back — not a digest, and not a dead button.
    expect(result.error).toContain("5 document pages");
    expect(result.error).toContain("Nothing extra has been charged");

    const after = (await ledgerRows())[0];
    expect(after.pagesUsed).toBe(before.pagesUsed);
    expect(after.questionsUsed).toBe(before.questionsUsed);
    expect(after.failedPages).toBe(0);
    expect(extractorCalls, "nothing may reach the model after a refused claim").toBe(0);
    expect(await prisma.complianceDocument.count({ where: { companyId } })).toBe(0);
  });

  it("refuses one absurd document without touching the month", async () => {
    served = pdfOf(101);

    const result = await uploadComplianceDocument(form());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("at most 100");
    // No ledger row at all: a document over the single-upload ceiling is
    // refused before anything is claimed, so an untouched month stays
    // untouched.
    expect(await ledgerRows()).toEqual([]);
    expect(extractorCalls).toBe(0);
    expect(await prisma.complianceDocument.count({ where: { companyId } })).toBe(0);
  });

  /**
   * The fail-closed rule, against a real missing table rather than a mocked
   * rejection — the same method `lib/ask/allowance.dbtest.ts` uses on the
   * Ask side, for the same reason: a hand-made P2021 only proves the catch
   * block runs. `askAllowance` in lib/ask/usage.ts would have let this
   * through and shouted; a ceiling somebody has PAID for must not.
   */
  it("REFUSES the upload when the ledger is genuinely unreadable, and recovers", async () => {
    served = pdfOf(3);
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AskAllowancePeriod" RENAME TO "AskAllowancePeriod_hidden"',
    );
    try {
      const refused = await uploadComplianceDocument(form());
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error("expected a refusal");
      expect(refused.error).toMatch(/couldn't check your company's monthly AI allowance/);
      expect(extractorCalls, "an unreadable cap must not spend").toBe(0);
      expect(await prisma.complianceDocument.count({ where: { companyId } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AskAllowancePeriod_hidden" RENAME TO "AskAllowancePeriod"',
      );
    }
    // The control: a suite that refused everything would satisfy the case
    // above perfectly.
    expect((await uploadComplianceDocument(form())).ok).toBe(true);
    expect(extractorCalls).toBe(1);
  });

  it("charges nothing to a member whose job function this is not", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    served = pdfOf(6);

    const result = await uploadComplianceDocument(form());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toContain("part of your job function");
    expect(await ledgerRows()).toEqual([]);
    expect(extractorCalls).toBe(0);
  });
});
