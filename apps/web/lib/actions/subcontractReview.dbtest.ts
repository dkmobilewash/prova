import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import type { SubcontractChunkPage, SubcontractFindingExtraction } from "@prova/integrations";
import { contractPdf, INSURANCE_EXHIBIT_CASE, PLANTED_CASE, PLANTED_V2_CASE } from "@/lib/subcontract-review/subcontractFixtures";

/**
 * AI SUBCONTRACT REVIEW, END TO END AGAINST A REAL DATABASE — everything but
 * the model, which is replaced by a reader that behaves like a careful one with
 * two flaws planted on purpose:
 *
 *   - it reports the WRONG page for every finding (99), so a stored page that
 *     is right can only have come from code locating the quote;
 *   - it adds one FABRICATED quote per chunk, so `findingsDropped` must count
 *     exactly one per chunk and none of them may reach a row.
 *
 * What this proves that the unit tests cannot: the real pdf.js read of a real
 * PDF from a fetched blob, the chunk loop across two sources, the page charge
 * against the ledger (each readable page ONCE despite the overlap), decisions
 * surviving a re-run, the version diff, and both stop paths.
 */

const context = { company: { id: "" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const OUR_STORE = "teststore1";
process.env.BLOB_STORE_ID = OUR_STORE;

let modelCalls = 0;
let failNextCall = false;

/** Clauses the fake reader "recognises", by a phrase it looks for on the page. */
const RECOGNISES: { phrase: string; category: SubcontractFindingExtraction["category"]; subtype: string; severity: "HIGH" | "MEDIUM" | "LOW"; sentenceStart: string }[] = [
  { phrase: "condition precedent", category: "PAYMENT", subtype: "PAY_IF_PAID", severity: "HIGH", sentenceStart: "Receipt of payment by Contractor from Owner" },
  { phrase: "of each progress payment", category: "RETAINAGE", subtype: "RETAINAGE_RATE", severity: "MEDIUM", sentenceStart: "Contractor shall retain" },
  { phrase: "per calendar day", category: "LIQUIDATED_DAMAGES", subtype: "LD_RATE", severity: "HIGH", sentenceStart: "pay liquidated damages of" },
  { phrase: "additional insureds", category: "INSURANCE", subtype: "ADDITIONAL_INSURED", severity: "LOW", sentenceStart: "Contractor and Owner shall be named" },
];

function fakeFindings(pages: readonly SubcontractChunkPage[]): SubcontractFindingExtraction[] {
  const text = pages.map((page) => page.lines.join(" ")).join(" ");
  const terms = {
    ldPerDay: null, ldCap: null, noticeHours: null, noticeDays: null, retainagePercent: null, paymentDays: null,
    warrantyYears: null, warrantyMonths: null, limitPerOccurrence: null, limitAggregate: null, completedOpsYears: null,
    contractSum: null, noticeRecipient: null, noticeForm: null,
  };
  const found: SubcontractFindingExtraction[] = RECOGNISES.filter((r) => text.includes(r.phrase)).map((r, i) => {
    const start = text.indexOf(r.sentenceStart);
    const end = text.indexOf(".", text.indexOf(r.phrase)) + 1;
    return {
      ordinal: i + 1, category: r.category, subtype: r.subtype, severity: r.severity, title: r.subtype,
      quote: text.slice(start, end), claimedPage: 99, sectionRef: null, explanation: "What it means.",
      suggestedPosition: "What to ask for.", questionForGc: null,
      // A figure the clause does state, and one it does not: only the first may survive.
      terms: { ...terms, retainagePercent: r.category === "RETAINAGE" ? (text.includes("ten percent") ? 10 : 5) : null, ldCap: 99999 },
    };
  });
  found.push({
    ordinal: 99, category: "OTHER", subtype: null, severity: "HIGH", title: "Invented",
    quote: "Subcontractor waives all rights to payment for any reason whatsoever.", claimedPage: 1, sectionRef: null,
    explanation: "Invented.", suggestedPosition: "Invented.", questionForGc: null, terms,
  });
  return found;
}

vi.mock("@prova/integrations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@prova/integrations")>();
  return {
    ...original,
    reviewSubcontractChunk: async (params: { pages: readonly SubcontractChunkPage[] }) => {
      modelCalls++;
      if (failNextCall) {
        failNextCall = false;
        throw new Error("the model call died halfway");
      }
      return { readingReason: "fake", findings: fakeFindings(params.pages) };
    },
  };
});

/** URL → PDF bytes the fake fetch serves. */
const served = new Map<string, Buffer>();
vi.stubGlobal("fetch", async (url: string) => {
  const body = served.get(String(url));
  if (!body) return new Response("missing", { status: 404 });
  return new Response(new Uint8Array(body), { status: 200, headers: { "content-type": "application/pdf" } });
});

let seq = 0;
function blobUrl(folder: string, jobId: string, name: string) {
  seq++;
  return `https://${OUR_STORE}.public.blob.vercel-storage.com/${folder}/${jobId}/${name}-r4nd0m${seq}.pdf`;
}

const { startSubcontractReview, advanceSubcontractReview, decideSubcontractFinding, continueSubcontractReview } =
  await import("./subcontractReview");
const { loadReviewPage } = await import("@/lib/subcontract-review/query");

async function runToEnd(reviewId: string) {
  for (let i = 0; i < 50; i++) {
    const result = await advanceSubcontractReview(reviewId);
    if (!result.ok) throw new Error(result.error);
    if (result.value.done || result.value.stopped) return result.value;
  }
  throw new Error("review never finished");
}

async function addVersion(jobId: string, versionNumber: number, pages: Parameters<typeof contractPdf>[0]) {
  const url = blobUrl("contracts", jobId, `subcontract-v${versionNumber}`);
  served.set(url, await contractPdf(pages));
  return prisma.contractDocument.create({ data: { jobId, versionNumber, fileUrl: url, fileName: `subcontract-v${versionNumber}.pdf` } });
}

describe("subcontract review against a real database", () => {
  const ctx = { companyId: "", jobId: "", v1: "", v2: "", exhibitUrl: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Subcontract Review Co" } });
    ctx.companyId = company.id;
    context.company.id = company.id;
    const user = await prisma.user.create({
      data: { companyId: company.id, clerkId: "clerk_subreview", email: "subreview@test.example", role: "OWNER" },
    });
    context.id = user.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Review GC" } });
    const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Review Job" } });
    ctx.jobId = job.id;
    ctx.v1 = (await addVersion(job.id, 1, PLANTED_CASE.pages)).id;
    ctx.exhibitUrl = blobUrl("subcontract-review", job.id, "insurance");
    // The exhibit has a scanned second page.
    served.set(ctx.exhibitUrl, await contractPdf([...INSURANCE_EXHIBIT_CASE.pages, null]));
  });

  beforeEach(() => {
    modelCalls = 0;
    failNextCall = false;
  });

  afterAll(async () => {
    await prisma.contractDocument.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.subcontractFindingDecision.deleteMany({ where: { jobId: ctx.jobId } });
    await prisma.job.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.askUsage.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.askAllowancePeriod.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.companyAiSettings.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.user.deleteMany({ where: { companyId: ctx.companyId } });
    await prisma.company.delete({ where: { id: ctx.companyId } });
    await prisma.$disconnect();
  });

  it("reads both files, keeps only cited findings on the pages code found, and charges each readable page once", async () => {
    const form = new FormData();
    form.set("exhibits", JSON.stringify([{ fileUrl: ctx.exhibitUrl, fileName: "insurance.pdf", role: "INSURANCE_EXHIBIT" }]));
    const started = await startSubcontractReview(ctx.v1, form);
    expect(started.ok, started.ok ? "" : started.error).toBe(true);
    if (!started.ok) return;
    // 4 agreement pages + 1 readable exhibit page; the scanned page is not read.
    expect(started.value).toEqual({ reviewId: expect.any(String), pagesToRead: 5, unreadPages: 1 });

    const end = await runToEnd(started.value.reviewId);
    expect(end.done).toBe(true);

    const review = await prisma.subcontractReview.findUniqueOrThrow({
      where: { id: started.value.reviewId },
      include: { findings: true, sources: true },
    });
    expect(review.completedAt).not.toBeNull();
    expect(review.findingsDropped).toBe(modelCalls); // the fabricated one, once per chunk
    expect(review.findings.some((f) => f.title === "Invented")).toBe(false);

    const byCategory = Object.fromEntries(review.findings.map((f) => [f.category, f]));
    expect(byCategory.PAYMENT).toMatchObject({ pageStart: 2, pageEnd: 2 });
    expect(byCategory.LIQUIDATED_DAMAGES).toMatchObject({ pageStart: 3, pageEnd: 3 });
    expect(byCategory.INSURANCE).toMatchObject({ pageStart: 1 });
    // A stated figure survives; one the clause never states is nulled.
    expect(byCategory.RETAINAGE!.terms).toMatchObject({ retainagePercent: 10, ldCap: null });

    const exhibit = review.sources.find((s) => s.role === "INSURANCE_EXHIBIT")!;
    expect(exhibit.unreadPages).toEqual([2]);

    const period = await prisma.askAllowancePeriod.findFirstOrThrow({ where: { companyId: ctx.companyId } });
    expect(period.contractPagesUsed).toBe(5);
    expect(review.pagesCharged).toBe(5);
  });

  it("charges a page two chunks share ONCE — a 10-page contract is two chunks overlapping on page 8, and 10 pages", async () => {
    const filler = (n: number) => [`ARTICLE ${n} GENERAL`, `${n}.1 The parties shall cooperate in good faith on all matters under this Article.`];
    const tenPages = [...PLANTED_CASE.pages, ...[5, 6, 7, 8, 9, 10].map(filler)];
    const doc = await addVersion(ctx.jobId, 8, tenPages);
    const before = await prisma.askAllowancePeriod.findFirstOrThrow({ where: { companyId: ctx.companyId } });
    const started = await startSubcontractReview(doc.id, new FormData());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await runToEnd(started.value.reviewId);
    expect(modelCalls).toBe(2);
    const after = await prisma.askAllowancePeriod.findFirstOrThrow({ where: { companyId: ctx.companyId } });
    expect(after.contractPagesUsed - before.contractPagesUsed).toBe(10);
    await prisma.contractDocument.delete({ where: { id: doc.id } });
  });

  it("keeps a person's decision across a re-run of the same version", async () => {
    const page = await loadReviewPage(ctx.jobId, ctx.companyId, ctx.v1);
    const payIfPaid = page!.review!.findings.find((f) => f.category === "PAYMENT")!;
    const form = new FormData();
    form.set("key", payIfPaid.key);
    form.set("decision", "NEGOTIATED");
    form.set("note", "Asked for pay-when-paid with a 60-day outside date.");
    form.set("editedExplanation", payIfPaid.explanation); // unchanged — must not count as an edit
    expect(await decideSubcontractFinding(ctx.jobId, form)).toEqual({ ok: true });

    const again = await startSubcontractReview(ctx.v1, new FormData());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    await runToEnd(again.value.reviewId);

    const after = await loadReviewPage(ctx.jobId, ctx.companyId, ctx.v1);
    expect(after!.review!.id).toBe(again.value.reviewId);
    const carried = after!.review!.findings.find((f) => f.key === payIfPaid.key)!;
    expect(carried.status).toBe("NEGOTIATED");
    expect(carried.note).toContain("60-day");
    expect(carried.edited).toBe(false);
  });

  it("says what a new version changed — retainage CHANGED, LDs REMOVED, pay-if-paid unchanged with its decision", async () => {
    ctx.v2 = (await addVersion(ctx.jobId, 2, PLANTED_V2_CASE.pages)).id;
    const started = await startSubcontractReview(ctx.v2, new FormData());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await runToEnd(started.value.reviewId);

    const page = await loadReviewPage(ctx.jobId, ctx.companyId, ctx.v2);
    expect(page!.previous?.versionNumber).toBe(1);
    const changes = page!.previous!.diff.map((entry) => [
      entry.change,
      ("current" in entry ? entry.current : entry.previous).category,
    ]);
    expect(changes).toEqual(
      expect.arrayContaining([
        ["UNCHANGED", "PAYMENT"],
        ["CHANGED", "RETAINAGE"],
        ["REMOVED", "LIQUIDATED_DAMAGES"],
      ]),
    );
    expect(page!.review!.findings.find((f) => f.category === "PAYMENT")!.status).toBe("NEGOTIATED");
  });

  it("stops with a sentence when the month's pages run out, and charges nothing it did not read", async () => {
    await prisma.companyAiSettings.create({ data: { companyId: ctx.companyId, contractPagesPerMonth: 6 } });
    const started = await startSubcontractReview(ctx.v1, new FormData());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const end = await runToEnd(started.value.reviewId);
    expect(end.stopped).toMatch(/subcontract pages left this month/);
    expect(modelCalls).toBe(0);
    const review = await prisma.subcontractReview.findUniqueOrThrow({ where: { id: started.value.reviewId } });
    expect(review.failedAt).not.toBeNull();
    expect(review.pagesCharged).toBe(0);
    await prisma.companyAiSettings.deleteMany({ where: { companyId: ctx.companyId } });
  });

  it("marks a failed chunk on the ledger, pauses, and carries on when the person presses Continue", async () => {
    const before = await prisma.askAllowancePeriod.findFirstOrThrow({ where: { companyId: ctx.companyId } });
    const started = await startSubcontractReview(ctx.v2, new FormData());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    failNextCall = true;
    const stopped = await runToEnd(started.value.reviewId);
    expect(stopped.stopped).toMatch(/couldn't be read/);
    const after = await prisma.askAllowancePeriod.findFirstOrThrow({ where: { companyId: ctx.companyId } });
    expect(after.failedContractPages - before.failedContractPages).toBeGreaterThan(0);

    expect(await continueSubcontractReview(started.value.reviewId)).toEqual({ ok: true });
    const end = await runToEnd(started.value.reviewId);
    expect(end.done).toBe(true);
  });

  it("refuses a contract URL from outside our store, and an exhibit filed under another job", async () => {
    const foreign = await prisma.contractDocument.create({
      data: { jobId: ctx.jobId, versionNumber: 9, fileUrl: "https://example.com/contract.pdf", fileName: "x.pdf" },
    });
    const refused = await startSubcontractReview(foreign.id, new FormData());
    expect(refused.ok).toBe(false);

    const form = new FormData();
    form.set("exhibits", JSON.stringify([{ fileUrl: blobUrl("subcontract-review", "other_job", "x"), fileName: "x.pdf", role: "SCOPE_EXHIBIT" }]));
    const crossJob = await startSubcontractReview(ctx.v1, form);
    expect(crossJob.ok).toBe(false);
  });
});
