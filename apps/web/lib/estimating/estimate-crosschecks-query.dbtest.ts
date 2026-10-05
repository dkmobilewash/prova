import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `loadCrossCheckInputs` against a real Postgres.
 *
 * `estimate-crosschecks.test.ts` covers the DECIDING with hand-written inputs.
 * This file covers the part that is entirely a query, and where the whole
 * feature can be wrong while every unit test passes — because the two implying
 * quantities live nowhere near the job's own row:
 *
 *   A MEASUREMENT hangs off a calibration, off a page, off a PLAN, and a job
 *   can have several plans. Read the wrong one and the panel reports
 *   measurements from a drawing nobody is working from.
 *
 *   A CARRIED QUOTE hangs off a `BidInvitation`, which has no `jobId` — it is
 *   reached only through `wonJobId`, the link #619 made usable before a bid is
 *   won. Get that reach wrong in either direction and the estimate is told
 *   about another project's subcontract, or stays silent about its own.
 *
 * Each assertion below is one wrong join away from being false.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadCrossCheckInputs } = await import("./estimate-crosschecks-query");

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let companyId = "";
let otherCompanyId = "";
/** The job under test. */
let jobId = "";
/** Another company's job, with its own plan and its own carried quote. */
let otherJobId = "";

/** A plan with one calibrated sheet carrying the measurements described. */
async function planWith(input: {
  company: string;
  job: string;
  fileName: string;
  createdAt?: Date;
  measurements: { label: string | null; posted: boolean }[];
}) {
  const plan = await prisma.takeoffPlan.create({
    data: {
      companyId: input.company,
      jobId: input.job,
      fileUrl: `https://e2estore.public.blob.vercel-storage.com/plan-takeoff/${input.job}/${input.fileName}`,
      fileName: input.fileName,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
  const page = await prisma.takeoffPlanPage.create({
    data: { planId: plan.id, pageNumber: 1, label: "A-101", pageWidthPt: 200 },
  });
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: page.id, x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.5, declaredDistanceFeet: "50" },
  });
  for (const m of input.measurements) {
    await prisma.takeoffMeasurement.create({
      data: {
        pageId: page.id,
        calibrationId: calibration.id,
        kind: "LINEAR",
        xs: [0.2, 0.6],
        ys: [0.6, 0.6],
        label: m.label,
        postedAt: m.posted ? day("2026-10-01") : null,
      },
    });
  }
  return plan;
}

/**
 * One bid, and as many quotes on it as the case needs.
 *
 * ONE BID PER JOB IS THE SCHEMA, NOT A SIMPLIFICATION, and the database said
 * so rather than any comment: `BidInvitation.wonJobId` is UNIQUE, so the first
 * version of this fixture — three bids all linked to the same job — failed with
 * `Unique constraint failed on the fields: (wonJobId)`. It is a fact worth
 * knowing about the feature and not only the fixture: a job reaches at most one
 * bid, so every carried quote the panel can report comes from that single bid,
 * one per PACKAGE rather than one per bid.
 */
async function bidWithQuotes(input: {
  company: string;
  contactId: string;
  job: string | null;
  projectName: string;
  quotes: {
    vendorName: string;
    packageLabel: string;
    amount: string | null;
    carried: boolean;
    declined?: boolean;
  }[];
}) {
  const bid = await prisma.bidInvitation.create({
    data: {
      companyId: input.company,
      contactId: input.contactId,
      projectName: input.projectName,
      status: "INVITED",
      wonJobId: input.job,
    },
  });
  for (const quote of input.quotes) {
    await prisma.bidQuote.create({
      data: {
        companyId: input.company,
        bidInvitationId: bid.id,
        vendorName: quote.vendorName,
        packageLabel: quote.packageLabel,
        amount: quote.amount,
        quotedOn: quote.amount === null ? null : day("2026-09-20"),
        carriedAt: quote.carried ? day("2026-10-01") : null,
        declinedAt: quote.declined ? day("2026-09-21") : null,
      },
    });
  }
  return bid;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Cross Check Test Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Cross check job", status: "ESTIMATE" },
  });
  jobId = job.id;

  // THE OLDER PLAN, with a measurement nobody posted. It must NOT be read:
  // its drawing has been superseded by the one below.
  await planWith({
    company: companyId,
    job: jobId,
    fileName: "old.pdf",
    createdAt: day("2026-09-01"),
    measurements: [{ label: "superseded run", posted: false }],
  });
  // The newest plan: one posted, one unposted, one unnamed and unposted.
  await planWith({
    company: companyId,
    job: jobId,
    fileName: "current.pdf",
    createdAt: day("2026-10-01"),
    measurements: [
      { label: "Level 2 partitions", posted: false },
      { label: "already on the estimate", posted: true },
      { label: null, posted: false },
    ],
  });

  // THE JOB'S ONE BID, carrying three quotes in three different states.
  await bidWithQuotes({
    company: companyId,
    contactId: contact.id,
    job: jobId,
    projectName: "Cross check bid",
    quotes: [
      // Carried, priced — the one that should come back.
      { vendorName: "Alpha Drywall", packageLabel: "Metal stud framing", amount: "61500.00", carried: true },
      // NOT carried: a price somebody looked at and did not choose.
      { vendorName: "Beta", packageLabel: "EIFS", amount: "40000.00", carried: false },
      // Carried with NO AMOUNT, which `carriedLinePlan` refuses — reporting it
      // as missing would tell somebody to do what the app declines to do.
      { vendorName: "Gamma", packageLabel: "Ceilings", amount: null, carried: true },
    ],
  });
  // A SECOND BID, carried and priced, linked to NO job. `wonJobId` being
  // unique is what makes this the only way to test the unlinked case.
  await bidWithQuotes({
    company: companyId,
    contactId: contact.id,
    job: null,
    projectName: "Unlinked bid",
    quotes: [{ vendorName: "Unlinked", packageLabel: "Firestopping", amount: "9000.00", carried: true }],
  });

  // ── Another company, everything the same shape ──
  const other = await prisma.company.create({ data: { name: "Other Cross Check Co" } });
  otherCompanyId = other.id;
  const otherContact = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "Their GC" } });
  const otherJob = await prisma.job.create({
    data: { companyId: otherCompanyId, contactId: otherContact.id, name: "Their job", status: "ESTIMATE" },
  });
  otherJobId = otherJob.id;
  await planWith({
    company: otherCompanyId,
    job: otherJobId,
    fileName: "theirs.pdf",
    measurements: [{ label: "their run", posted: false }],
  });
  await bidWithQuotes({
    company: otherCompanyId,
    contactId: otherContact.id,
    job: otherJobId,
    projectName: "Their bid",
    quotes: [{ vendorName: "Their Sub", packageLabel: "Their package", amount: "15000.00", carried: true }],
  });
});

afterAll(async () => {
  // DELETED IN DEPENDENCY ORDER, which `takeoff-currency-query.dbtest.ts`
  // already worked out: `Company` does not cascade to `Contact`, so a bare
  // `company.delete` fails on `Contact_companyId_fkey` — which is what the
  // first version of this file did. `TakeoffPlan` DOES cascade to its pages,
  // calibrations and measurements, which is the whole point of it being the
  // only `jobId` in `takeoff.prisma`.
  for (const id of [companyId, otherCompanyId]) {
    await prisma.takeoffPlan.deleteMany({ where: { companyId: id } });
    await prisma.bidInvitation.deleteMany({ where: { companyId: id } });
    await prisma.job.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("what was traced but not posted", () => {
  it("reads the NEWEST plan only, not every plan the job has had", async () => {
    const { measurements } = await loadCrossCheckInputs(jobId, companyId);
    expect(measurements.map((m) => m.label)).toEqual(["Level 2 partitions", "already on the estimate", null]);
    // The older plan's unposted run is absent: reporting it would be true and
    // useless, about a drawing nobody is working from.
    expect(measurements.some((m) => m.label === "superseded run")).toBe(false);
  });

  it("carries `postedAt` through as the declared event it is", async () => {
    const { measurements } = await loadCrossCheckInputs(jobId, companyId);
    const posted = measurements.find((m) => m.label === "already on the estimate");
    const unposted = measurements.find((m) => m.label === "Level 2 partitions");
    expect(posted?.postedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(unposted?.postedAt).toBeNull();
  });
});

describe("what was carried but may not be priced", () => {
  it("returns the carried, priced, linked quote — and only that one", async () => {
    const { carried } = await loadCrossCheckInputs(jobId, companyId);
    expect(carried).toEqual([
      {
        vendorName: "Alpha Drywall",
        packageLabel: "Metal stud framing",
        amount: 61500,
        expectedDescription: "Metal stud framing — Alpha Drywall",
      },
    ]);
  });

  it("excludes an uncarried quote, an unpriced one, and one linked to no job", async () => {
    const { carried } = await loadCrossCheckInputs(jobId, companyId);
    const names = carried.map((q) => q.vendorName);
    // Beta was never carried; Gamma has no amount so `carriedLinePlan`
    // refuses; Unlinked reaches no job through `wonJobId`.
    expect(names).not.toContain("Beta");
    expect(names).not.toContain("Gamma");
    expect(names).not.toContain("Unlinked");
  });

  it("builds the description from `carriedLinePlan`, so it cannot drift from the writer", async () => {
    const { carried } = await loadCrossCheckInputs(jobId, companyId);
    // The exact string `addCarriedQuoteToEstimate` writes and matches its own
    // duplicate guard against — package, em dash, vendor.
    expect(carried[0].expectedDescription).toBe("Metal stud framing — Alpha Drywall");
  });
});

describe("another company's job is unreachable", () => {
  it("returns nothing for a job id belonging to someone else", async () => {
    // The job id is real and the rows exist — only the company differs, which
    // is the whole guard.
    const { measurements, carried } = await loadCrossCheckInputs(otherJobId, companyId);
    expect(measurements).toEqual([]);
    expect(carried).toEqual([]);
  });

  it("does not leak this company's rows into their job either", async () => {
    const { measurements, carried } = await loadCrossCheckInputs(jobId, otherCompanyId);
    expect(measurements).toEqual([]);
    expect(carried).toEqual([]);
  });

  it("reads their own rows correctly when asked as them", async () => {
    // The control on the control: the two above could pass on a query that
    // always returns nothing.
    const { measurements, carried } = await loadCrossCheckInputs(otherJobId, otherCompanyId);
    expect(measurements.map((m) => m.label)).toEqual(["their run"]);
    expect(carried.map((q) => q.vendorName)).toEqual(["Their Sub"]);
  });
});
