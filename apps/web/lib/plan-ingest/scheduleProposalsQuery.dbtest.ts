import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `scheduleSheetCountFor` and `loadScheduleProposals` against a real Postgres.
 *
 * WHY A DATABASE. Both functions exist to answer "which is the NEWEST row per
 * page", over a table whose whole design is that a re-run INSERTS rather than
 * overwrites. That is a claim about rows and ordering, and the two ways to get it
 * wrong are both invisible to a unit test: counting every proposal instead of the
 * newest (so a set ingested twice tells somebody a four-sheet read costs eight),
 * and showing two readings of one page side by side as though they were two
 * schedules.
 *
 * `scheduleRowsJson.test.ts` owns the validation of the `Json` column. This owns
 * the queries.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadScheduleProposals, scheduleSheetCountFor } = await import("./scheduleProposalsQuery");

const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 12, minute));

let companyId = "";
let jobId = "";
let planId = "";
let ingestA = "";
let ingestB = "";

/** A title-block proposal for one page, in a given run. */
async function sheetProposal(input: {
  ingestJobId: string;
  pageNumber: number;
  pageType: string | null;
  sheetNumber?: string | null;
  acceptedSheetNumber?: string | null;
  createdAt: Date;
}) {
  await prisma.planSheetProposal.create({
    data: {
      ingestJobId: input.ingestJobId,
      planId,
      pageNumber: input.pageNumber,
      proposedPageType: input.pageType,
      proposedSheetNumber: input.sheetNumber ?? null,
      acceptedSheetNumber: input.acceptedSheetNumber ?? null,
      proposedReason: "test",
      proposedConfidence: "HIGH",
      model: "test-model",
      promptVersion: "plan-title-block.2",
      createdAt: input.createdAt,
    },
  });
}

async function scheduleProposal(input: {
  ingestJobId: string;
  pageNumber: number;
  kind: string;
  rows: unknown;
  createdAt: Date;
  gridRowCount?: number;
  readRowCount?: number;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
}) {
  await prisma.planScheduleProposal.create({
    data: {
      ingestJobId: input.ingestJobId,
      planId,
      pageNumber: input.pageNumber,
      kind: input.kind,
      title: `${input.kind} SCHEDULE`,
      rows: input.rows as never,
      reason: "Column 1 is the mark.",
      confidence: input.confidence ?? "HIGH",
      gridRowCount: input.gridRowCount ?? 10,
      readRowCount: input.readRowCount ?? 2,
      model: "test-model",
      promptVersion: "schedule-rows.1",
      createdAt: input.createdAt,
    },
  });
}

const row = (mark: string) => ({ mark, description: null, size: null, quantity: null, notes: null });

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Schedule Query Test Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Schedule Query Job", status: "ESTIMATE" },
  });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({
    data: { companyId, jobId, fileUrl: "https://example.test/set.pdf" },
  });
  planId = plan.id;

  const runA = await prisma.planIngestJob.create({ data: { companyId, planId, stage: "TITLE_BLOCK", pageCount: 4 } });
  ingestA = runA.id;
  const runB = await prisma.planIngestJob.create({ data: { companyId, planId, stage: "TITLE_BLOCK", pageCount: 4 } });
  ingestB = runB.id;

  // RUN A, the older one: page 2 is a PLAN.
  await sheetProposal({ ingestJobId: ingestA, pageNumber: 1, pageType: "COVER", createdAt: at(0) });
  await sheetProposal({ ingestJobId: ingestA, pageNumber: 2, pageType: "PLAN", createdAt: at(0) });
  await sheetProposal({ ingestJobId: ingestA, pageNumber: 3, pageType: "SCHEDULE", sheetNumber: "A-601", createdAt: at(0) });

  // RUN B, the newer one: page 2 is now a SCHEDULE, and page 3's number was
  // corrected by a person.
  await sheetProposal({ ingestJobId: ingestB, pageNumber: 1, pageType: "COVER", createdAt: at(30) });
  await sheetProposal({ ingestJobId: ingestB, pageNumber: 2, pageType: "SCHEDULE", sheetNumber: "A-602", createdAt: at(30) });
  await sheetProposal({
    ingestJobId: ingestB,
    pageNumber: 3,
    pageType: "SCHEDULE",
    sheetNumber: "A-601",
    acceptedSheetNumber: "A-601a",
    createdAt: at(30),
  });
});

afterAll(async () => {
  // TakeoffPlan cascades to its ingest jobs, sheet proposals and schedule
  // proposals — which is why none of them is in `HANDLED_MODELS`.
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe("what reading the schedules will cost", () => {
  it("counts the NEWEST proposal per page, not every proposal row", () => {
    // Six sheet proposals exist over three pages. Counting rows would say 3
    // (A's one schedule + B's two); the answer is 2, because page 2 and page 3
    // are schedules in the live reading and page 1 is not.
    return expect(scheduleSheetCountFor(planId)).resolves.toBe(2);
  });

  it("follows a page whose type CHANGED between runs", async () => {
    // Page 2 was a PLAN in run A and is a SCHEDULE in run B. A count that read
    // the oldest proposal would miss it, and the button would under-state what
    // the read costs.
    const count = await scheduleSheetCountFor(planId);
    expect(count).toBe(2);
  });

  it("is zero for a plan nobody has ingested", async () => {
    const other = await prisma.takeoffPlan.create({
      data: { companyId, jobId, fileUrl: "https://example.test/empty.pdf" },
    });
    await expect(scheduleSheetCountFor(other.id)).resolves.toBe(0);
    await prisma.takeoffPlan.delete({ where: { id: other.id } });
  });
});

describe("the readings themselves", () => {
  it("returns nothing before anything has been read", () => {
    return expect(loadScheduleProposals(planId)).resolves.toEqual([]);
  });

  it("shows ONE reading per page, the newest", async () => {
    // Two readings of page 3, one per run. Showing both would read as two
    // different schedules on one sheet.
    await scheduleProposal({ ingestJobId: ingestA, pageNumber: 3, kind: "DOOR", rows: [row("101")], createdAt: at(1) });
    await scheduleProposal({
      ingestJobId: ingestB,
      pageNumber: 3,
      kind: "DOOR",
      rows: [row("101"), row("102")],
      createdAt: at(31),
    });

    const proposals = await loadScheduleProposals(planId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].rows.map((r) => r.mark)).toEqual(["101", "102"]);
  });

  it("prefers the sheet number a PERSON accepted over the one proposed", async () => {
    // Somebody corrected A-601 to A-601a. They are a better source than the
    // reading, and the number is how they find the drawing on the table.
    const proposals = await loadScheduleProposals(planId);
    expect(proposals[0].sheetNumber).toBe("A-601a");
  });

  it("orders by page number, so the list reads like the set", async () => {
    await scheduleProposal({ ingestJobId: ingestB, pageNumber: 2, kind: "FINISH", rows: [row("A")], createdAt: at(32) });
    const proposals = await loadScheduleProposals(planId);
    expect(proposals.map((p) => p.pageNumber)).toEqual([2, 3]);
  });

  it("carries BOTH counts through, because the difference is the thing worth seeing", async () => {
    const proposals = await loadScheduleProposals(planId);
    const page3 = proposals.find((p) => p.pageNumber === 3);
    expect(page3?.gridRowCount).toBe(10);
    expect(page3?.readRowCount).toBe(2);
  });

  it("DROPS a malformed Json column rather than rendering a row with no mark", async () => {
    // A row written by an older build is not evidence of anything. A mark that
    // arrives undefined renders as a blank line in a table, which reads like
    // data rather than like a reading the app could not use.
    await scheduleProposal({
      ingestJobId: ingestB,
      pageNumber: 4,
      kind: "WINDOW",
      rows: [{ description: "no mark at all" }],
      createdAt: at(33),
    });
    const proposals = await loadScheduleProposals(planId);
    const page4 = proposals.find((p) => p.pageNumber === 4);
    expect(page4).toBeDefined();
    expect(page4?.rows).toEqual([]);
    // The reading is still LISTED — its reason and counts are what tell a
    // person it went wrong. Hiding the row entirely would hide the failure.
    expect(page4?.readRowCount).toBe(2);
  });
});
