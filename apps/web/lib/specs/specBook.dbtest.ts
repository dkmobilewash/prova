import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import type { SpecTradeRead } from "@prova/integrations";
import { buildSpecBookFixture } from "./fixtures/specBookFixture";

/**
 * A whole spec book through the real actions and rows: the fixture book is found
 * into its four trade sections, a section is read (the model stubbed, the slicing,
 * text, quote check and storage real), a fact whose quote is not in the section is
 * dropped, wall types are checked against the read, a price item lands on the
 * proposal once, and another company's book answers as if it were not there.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let gateOpen = true;
vi.mock("@/lib/ai/settings", () => ({
  aiGate: async () =>
    gateOpen
      ? { ok: true, model: "claude-opus-5", modelSource: "default", settings: { specPagesPerMonth: 1800 } }
      : { ok: false, error: "Plan reading is switched off for this company." },
}));
const charged: number[] = [];
vi.mock("@/lib/ask/specSpend", () => ({
  claimSpecPages: async () => ({ ok: true, claim: { companyId: "", periodStart: new Date() }, charge: { pages: 3 }, note: "", pagesLeft: 1797 }),
  markSpecFailure: async (_c: unknown, pages: number) => {
    failed.push(pages);
  },
  releaseSpecPages: async (_c: unknown, pages: number) => {
    released.push(pages);
  },
}));
const failed: number[] = [];
const released: number[] = [];
let outage = false;
const sectionsSent: { sectionNumber: string; pages: number[] }[] = [];
const READ: SpecTradeRead = {
  products: [{ manufacturer: "USG Corporation", product: null, quote: "USG Corporation; CertainTeed Gypsum; National Gypsum Company." }],
  studs: [],
  boards: [{ kind: "Type X", thickness: "5/8 inch", where: "at all fire-rated assemblies", quote: "Type X: ASTM C1396, 5/8 inch thick, at all fire-rated assemblies." }],
  fireRatings: [{ rating: "1-hour", assembly: "UL Design U419", quote: "Fire-rated partitions: UL Design U419, 1-hour." }],
  ceilings: [],
  finishLevels: [{ level: 4, where: null, quote: "Level 4 finish at all exposed surfaces unless otherwise indicated." }],
  priceDrivers: [
    { label: "Level 5 at the main lobby", why: "A skim coat over the whole surface.", quote: "Level 5 finish at the main lobby and at walls receiving gloss paint." },
    // Not in the section: must be dropped before it is stored.
    { label: "Attic stock", why: "Extra board left on site.", quote: "Provide ten percent attic stock of each board type." },
  ],
  reason: "Read the gypsum board section.",
};
vi.mock("@prova/integrations", async (actual) => ({
  ...(await actual<typeof import("@prova/integrations")>()),
  extractSpecTrade: async (p: { sectionNumber: string; pages: { page: number }[] }) => {
    if (outage) throw (await import("@/lib/ai/providerOutage.testutil")).creditError();
    sectionsSent.push({ sectionNumber: p.sectionNumber, pages: p.pages.map((x) => x.page) });
    return READ;
  },
}));

const dir = mkdtempSync(join(tmpdir(), "spec-book-"));
process.env.TAKEOFF_LOCAL_PLAN_DIR = dir;

const { findSpecBookSections, readSpecTrade, addSpecDriverToProposal, recordSpecBook } = await import("@/lib/actions/specBook");
const { loadSpecBookView } = await import("./specBookQuery");

let companyId = "", otherCompanyId = "", jobId = "", otherJobId = "", bookId = "", planId = "";

describe("a whole spec book on a job", () => {
  beforeAll(async () => {
    writeFileSync(join(dir, "manual.pdf"), await buildSpecBookFixture());
    companyId = (await prisma.company.create({ data: { name: "Book Co" } })).id;
    otherCompanyId = (await prisma.company.create({ data: { name: "Other Book Co" } })).id;
    context.company.id = companyId;
    context.id = (await prisma.user.create({ data: { companyId, clerkId: `sb_${Date.now()}`, email: `sb_${Date.now()}@example.test`, role: "OWNER" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    const other = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Clinic" } })).id;
    otherJobId = (await prisma.job.create({ data: { companyId: otherCompanyId, contactId: other.id, name: "Theirs" } })).id;
    bookId = (await prisma.specBook.create({ data: { jobId, fileUrl: "local:manual.pdf", fileName: "manual.pdf" } })).id;
    // A plan set with a read legend: one rated wall that agrees, one with 1/2" board.
    planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan.pdf" } })).id;
    const ingest = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "WALL_LEGEND", pageCount: 1 } });
    await prisma.planLegendProposal.create({
      data: {
        ingestJobId: ingest.id,
        planId,
        pageNumber: 1,
        textRead: {},
        merged: [
          { code: "A1", name: null, lines: ['3 5/8" 20 GA. MTL. STUDS @ 16" O.C.', '5/8" TYPE X GYP. BD. EACH SIDE', "1 HR"], assembly: {}, from: "text", disagreements: [] },
          { code: "B", name: null, lines: ['3 5/8" 25 GA. MTL. STUDS @ 16" O.C.', '1/2" GYP. BD. EACH SIDE'], assembly: {}, from: "text", disagreements: [] },
        ],
        crops: [],
        reason: "test",
        confidence: "HIGH",
        model: "test",
        promptVersion: "test",
      },
    });
  });

  afterAll(async () => {
    await prisma.jobProposalClause.deleteMany({ where: { companyId } });
    await prisma.takeoffPlan.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await prisma.$disconnect();
  });

  it("refuses a book whose URL is not this job's stored file", async () => {
    expect(await recordSpecBook(jobId, "https://evil.test/manual.pdf", "manual.pdf")).toMatchObject({ ok: false });
  });

  it("finds the four trade sections, skips the others, and does it once", async () => {
    const found = await findSpecBookSections(bookId);
    expect(found).toMatchObject({ ok: true, value: { others: ["08 71 00", "26 05 00"], pages: 14 } });
    expect(found.ok && found.value.trade.map((t) => t.number)).toEqual(["07 81 00", "09 21 16", "09 22 16", "09 51 13"]);
    const rows = await prisma.bidSpecSection.findMany({ where: { specBookId: bookId }, orderBy: { pageFrom: "asc" } });
    expect(rows.map((r) => [r.sectionNumber, r.pageFrom, r.pageTo, r.jobId, r.fileUrl])).toEqual([
      ["07 81 00", 3, 4, jobId, null],
      ["09 21 16", 7, 9, jobId, null],
      ["09 22 16", 10, 11, jobId, null],
      ["09 51 13", 12, 13, jobId, null],
    ]);
    expect(await findSpecBookSections(bookId)).toEqual({ ok: false, error: "This book's sections are already listed below." });
  });

  it("reads a section from its own pages of the book and drops a fact whose quote is not there", async () => {
    const section = await prisma.bidSpecSection.findFirstOrThrow({ where: { specBookId: bookId, sectionNumber: "09 21 16" } });
    expect(await readSpecTrade(section.id)).toEqual({ ok: true, value: { items: 5, dropped: 1 } });
    expect(sectionsSent).toEqual([{ sectionNumber: "09 21 16", pages: [7, 8, 9] }]);
    const reading = await prisma.specTradeReading.findFirstOrThrow({ where: { bidSpecSectionId: section.id } });
    expect((reading.facts as SpecTradeRead).priceDrivers.map((d) => d.label)).toEqual(["Level 5 at the main lobby"]);
    expect(reading.pagesCharged).toBe(3);
    expect((await prisma.bidSpecSection.findUniqueOrThrow({ where: { id: section.id } })).readInFlightAt).toBeNull();
  });

  it("checks each legend wall type against the read", async () => {
    const view = await loadSpecBookView(jobId, companyId);
    expect(view.hasLegend).toBe(true);
    expect(view.wallTypes.map((w) => [w.code, w.applies, w.conflicts.map((c) => c.what)])).toEqual([
      ["A1", ['09 21 16: 5/8" Type X, Level 4, UL Design U419'], []],
      // Unrated: the spec's Type X is for rated walls only, so B's 1/2" board is not checked against it.
      ["B", ["09 21 16: Level 4"], []],
    ]);
  });

  it("puts a price item on the proposal as an inclusion once, and as an alternate", async () => {
    const reading = await prisma.specTradeReading.findFirstOrThrow({ where: { bidSpecSection: { specBookId: bookId } } });
    expect(await addSpecDriverToProposal(reading.id, 0, "INCLUSION")).toEqual({ ok: true });
    expect(await addSpecDriverToProposal(reading.id, 0, "ALTERNATE")).toEqual({ ok: false, error: "That item is already on the proposal." });
    const clauses = await prisma.jobProposalClause.findMany({ where: { jobId } });
    expect(clauses.map((c) => [c.kind, c.text])).toEqual([["INCLUSION", "Level 5 at the main lobby, per specification section 09 21 16."]]);
    expect(await addSpecDriverToProposal(reading.id, 9, "INCLUSION")).toMatchObject({ ok: false });
  });

  it("is refused behind the plan-reading switch, before anything is charged", async () => {
    gateOpen = false;
    const section = await prisma.bidSpecSection.findFirstOrThrow({ where: { specBookId: bookId, sectionNumber: "09 22 16" } });
    expect(await readSpecTrade(section.id)).toMatchObject({ ok: false, error: expect.stringContaining("switched off") });
    expect(charged).toEqual([]);
    gateOpen = true;
  });

  it("gives the pages back when the provider refuses the call (out of credit), and says nothing was charged", async () => {
    outage = true;
    const section = await prisma.bidSpecSection.findFirstOrThrow({ where: { specBookId: bookId, sectionNumber: "09 51 13" } });
    expect(await readSpecTrade(section.id)).toMatchObject({ ok: false, error: expect.stringContaining("nothing was charged") });
    expect(released).toEqual([3]);
    expect(failed).toEqual([]);
    expect(await prisma.specTradeReading.count({ where: { bidSpecSectionId: section.id } })).toBe(0);
    expect((await prisma.bidSpecSection.findUniqueOrThrow({ where: { id: section.id } })).readInFlightAt).toBeNull();
    outage = false;
  });

  it("answers another company's book and section as if they were not there", async () => {
    const theirs = await prisma.specBook.create({ data: { jobId: otherJobId, fileUrl: "local:manual.pdf" } });
    expect(await findSpecBookSections(theirs.id)).toEqual({ ok: false, error: "That spec book is no longer on this job." });
    const section = await prisma.bidSpecSection.create({ data: { jobId: otherJobId, sectionNumber: "09 21 16" } });
    expect(await readSpecTrade(section.id)).toEqual({ ok: false, error: "That spec section is no longer here." });
  });
});
