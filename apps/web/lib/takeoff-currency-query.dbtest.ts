import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `loadTakeoffCurrency` against a real Postgres.
 *
 * `takeoff-currency.test.ts` covers the DECIDING — which dates supersede which
 * — with hand-written inputs. This file covers the part that is entirely a
 * query, and where the whole feature can be wrong while every unit test passes:
 *
 *   THREE SOURCES AND NOTHING JOINS THEM. A plan carries its issue date as
 *   TEXT and a date; `DrawingRevision` is the job's own paper trail; a
 *   `BidAddendum` belongs to a BID INVITATION and has no `jobId` at all. The
 *   bid side is reached only through `BidInvitation.wonJobId` — the link #491
 *   added — because names rarely match and one GC sends three invitations per
 *   building. Get that reach wrong in either direction and the banner warns
 *   about another project's addenda, or stays silent about this one's.
 *
 * What is asserted here, each of which is a wrong join away from being false:
 *
 *   - a plan with no issue date is UNKNOWABLE, and says so rather than
 *     defaulting to current;
 *   - a drawing revision issued AFTER the sheet supersedes it, and one issued
 *     the SAME DAY does not (a sheet and its own transmittal routinely share a
 *     date, and crying wolf on every plan is how a banner gets ignored);
 *   - an addendum reaches this job ONLY through `wonJobId`, only when it is
 *     flagged as changing priced scope, and only when it is dated;
 *   - an undated addendum is REPORTED rather than dropped — it cannot be shown
 *     to supersede anything, and cannot be shown not to;
 *   - `measurementsAtRisk` counts the measurements on the superseded sheets,
 *     across pages;
 *   - another company's job, plans, revisions and bids are unreachable.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadTakeoffCurrency } = await import("./takeoff-currency-query");

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let companyId = "";
let otherCompanyId = "";
/** The job under test: one dated plan carrying two measurements. */
let jobId = "";
/** Same company, its own plan with NO issue date. */
let undatedJobId = "";
/** Another company's job, with its own plan, revision and won bid. */
let otherJobId = "";

/** A plan with `pages` sheets, each carrying `perSheet` traced measurements.
 * A measurement needs a calibration to point at, which is the schema's own
 * guard: you cannot measure a sheet nobody has calibrated. */
async function planWithMeasurements(input: {
  company: string;
  job: string;
  fileName: string;
  revisionLabel?: string | null;
  issuedOn?: string | null;
  sheets: number;
  perSheet: number;
}) {
  const plan = await prisma.takeoffPlan.create({
    data: {
      companyId: input.company,
      jobId: input.job,
      fileUrl: `https://e2estore.public.blob.vercel-storage.com/plan-takeoff/${input.job}/${input.fileName}`,
      fileName: input.fileName,
      revisionLabel: input.revisionLabel ?? null,
      sheetIssuedOn: input.issuedOn ? day(input.issuedOn) : null,
    },
  });
  for (let sheet = 1; sheet <= input.sheets; sheet += 1) {
    const page = await prisma.takeoffPlanPage.create({
      data: { planId: plan.id, pageNumber: sheet, label: `A-10${sheet}`, pageWidthPt: 200 },
    });
    const calibration = await prisma.takeoffScaleCalibration.create({
      data: { pageId: page.id, x1: 0.2, y1: 0.5, x2: 0.7, y2: 0.5, declaredDistanceFeet: "50" },
    });
    for (let n = 0; n < input.perSheet; n += 1) {
      await prisma.takeoffMeasurement.create({
        data: {
          pageId: page.id,
          calibrationId: calibration.id,
          kind: "LINEAR",
          xs: [0.2, 0.6],
          ys: [0.6, 0.6],
          label: `run ${sheet}-${n}`,
        },
      });
    }
  }
  return plan;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Takeoff Currency Test Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });

  const other = await prisma.company.create({ data: { name: "Takeoff Currency Other Co" } });
  otherCompanyId = other.id;
  const otherContact = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "Their GC" } });

  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Currency job", status: "ESTIMATE" },
  });
  jobId = job.id;
  // Two sheets, two measurements each — so `measurementsAtRisk` has to add up
  // across pages rather than count the plan.
  await planWithMeasurements({
    company: companyId,
    job: jobId,
    fileName: "A-101.pdf",
    revisionLabel: "Rev 1",
    issuedOn: "2026-06-10",
    sheets: 2,
    perSheet: 2,
  });

  const undated = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Undated job", status: "ESTIMATE" },
  });
  undatedJobId = undated.id;
  await planWithMeasurements({
    company: companyId,
    job: undatedJobId,
    fileName: "sketch.pdf",
    sheets: 1,
    perSheet: 3,
  });

  // ANOTHER COMPANY, with everything the query reads: a plan, a later
  // revision, and a won bid carrying a priced-scope addendum.
  const otherJob = await prisma.job.create({
    data: { companyId: otherCompanyId, contactId: otherContact.id, name: "Their job", status: "ESTIMATE" },
  });
  otherJobId = otherJob.id;
  await planWithMeasurements({
    company: otherCompanyId,
    job: otherJobId,
    fileName: "theirs.pdf",
    revisionLabel: "Rev 9",
    issuedOn: "2026-06-10",
    sheets: 1,
    perSheet: 1,
  });
  const theirSet = await prisma.drawingSet.create({
    data: { companyId: otherCompanyId, jobId: otherJobId, name: "Their architectural" },
  });
  await prisma.drawingRevision.create({
    data: { setId: theirSet.id, label: "Rev 10", issuedOn: day("2026-08-01") },
  });
  const theirBid = await prisma.bidInvitation.create({
    data: {
      companyId: otherCompanyId,
      contactId: otherContact.id,
      projectName: "Their bid",
      status: "WON",
      wonJobId: otherJobId,
    },
  });
  await prisma.bidAddendum.create({
    data: {
      companyId: otherCompanyId,
      bidInvitationId: theirBid.id,
      reference: "Their Addendum 1",
      issuedOn: day("2026-09-01"),
      affectsPricedScope: true,
    },
  });
});

afterAll(async () => {
  for (const id of [companyId, otherCompanyId]) {
    // TakeoffPlan cascades to pages, calibrations and measurements — the whole
    // point of it being the only `jobId` in takeoff.prisma.
    await prisma.takeoffPlan.deleteMany({ where: { companyId: id } });
    await prisma.bidAddendum.deleteMany({ where: { companyId: id } });
    await prisma.bidInvitation.deleteMany({ where: { companyId: id } });
    await prisma.drawingRevision.deleteMany({ where: { set: { companyId: id } } });
    await prisma.drawingSet.deleteMany({ where: { companyId: id } });
    await prisma.job.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("loadTakeoffCurrency: nothing issued since", () => {
  it("calls a dated plan with nothing after it CURRENT, and has no headline", async () => {
    const currency = await loadTakeoffCurrency(companyId, jobId);
    expect(currency.plans).toHaveLength(1);
    expect(currency.plans[0].state).toBe("CURRENT");
    expect(currency.supersededCount).toBe(0);
    expect(currency.measurementsAtRisk).toBe(0);
    // No banner at all when there is nothing to say.
    expect(currency.headline).toBeNull();
  });

  it("calls an undated plan UNKNOWABLE rather than current, and says how many measurements it cannot vouch for", async () => {
    const currency = await loadTakeoffCurrency(companyId, undatedJobId);
    expect(currency.plans[0].state).toBe("UNKNOWABLE");
    expect(currency.unknowableCount).toBe(1);
    expect(currency.plans[0].sentence).toMatch(/3 measurements/);
    expect(currency.headline).toMatch(/1 plan here has no issue date/);
  });
});

describe("loadTakeoffCurrency: the job's own drawing revisions", () => {
  it("a revision issued the SAME DAY does not supersede the sheet", async () => {
    const set = await prisma.drawingSet.create({
      data: { companyId, jobId, name: "Architectural" },
    });
    await prisma.drawingRevision.create({
      data: { setId: set.id, label: "Rev 1 transmittal", issuedOn: day("2026-06-10") },
    });

    const currency = await loadTakeoffCurrency(companyId, jobId);
    expect(currency.plans[0].state, "a sheet and its own transmittal share a date").toBe("CURRENT");
    expect(currency.supersededCount).toBe(0);
  });

  it("a revision issued after it supersedes it, and every measurement on it is at risk", async () => {
    const set = await prisma.drawingSet.findFirstOrThrow({ where: { companyId, jobId } });
    await prisma.drawingRevision.create({
      data: {
        setId: set.id,
        label: "Rev 2",
        issuedOn: day("2026-07-01"),
        description: "corridor moved 2 ft at grid C",
      },
    });

    const currency = await loadTakeoffCurrency(companyId, jobId);
    expect(currency.plans[0].state).toBe("SUPERSEDED");
    expect(currency.supersededCount).toBe(1);
    // Two sheets, two measurements each.
    expect(currency.measurementsAtRisk).toBe(4);
    expect(currency.headline).toMatch(/4 measurements on this job came off drawings that have since been superseded/);
    // The set's name and the revision's label are both named, because "Rev 2"
    // alone is not enough to go and find it.
    expect(currency.plans[0].sentence).toContain("Architectural Rev 2");
    expect(currency.plans[0].supersededBy[0].note).toBe("corridor moved 2 ft at grid C");
  });
});

describe("loadTakeoffCurrency: the bid side, reached only through wonJobId", () => {
  it("ignores an addendum on a bid that is not linked to this job", async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { companyId } });
    const unlinked = await prisma.bidInvitation.create({
      data: { companyId, contactId: contact.id, projectName: "Same building, different invitation", status: "SUBMITTED" },
    });
    await prisma.bidAddendum.create({
      data: {
        companyId,
        bidInvitationId: unlinked.id,
        reference: "Unlinked Addendum 7",
        issuedOn: day("2026-08-01"),
        affectsPricedScope: true,
      },
    });

    const currency = await loadTakeoffCurrency(companyId, jobId);
    const named = currency.plans.flatMap((plan) => plan.supersededBy.map((item) => item.label));
    expect(named, "an unlinked invitation must not reach this job").not.toContain("Unlinked Addendum 7");
    expect(currency.undated).not.toContain("Unlinked Addendum 7");
  });

  it("ignores an addendum on the linked bid that did not change priced work", async () => {
    const contact = await prisma.contact.findFirstOrThrow({ where: { companyId } });
    const won = await prisma.bidInvitation.create({
      data: { companyId, contactId: contact.id, projectName: "The winning bid", status: "WON", wonJobId: jobId },
    });
    await prisma.bidAddendum.create({
      data: {
        companyId,
        bidInvitationId: won.id,
        reference: "Addendum 1 (schedule only)",
        issuedOn: day("2026-08-05"),
        affectsPricedScope: false,
      },
    });

    const currency = await loadTakeoffCurrency(companyId, jobId);
    const named = currency.plans.flatMap((plan) => plan.supersededBy.map((item) => item.label));
    expect(named).not.toContain("Addendum 1 (schedule only)");
  });

  it("a dated priced-scope addendum on the linked bid supersedes the sheet", async () => {
    const won = await prisma.bidInvitation.findFirstOrThrow({ where: { companyId, wonJobId: jobId } });
    await prisma.bidAddendum.create({
      data: {
        companyId,
        bidInvitationId: won.id,
        reference: "Addendum 2",
        issuedOn: day("2026-08-10"),
        affectsPricedScope: true,
        impactNote: "soffit detail at grid C",
      },
    });

    const currency = await loadTakeoffCurrency(companyId, jobId);
    const named = currency.plans[0].supersededBy.map((item) => item.label);
    expect(named).toContain("Addendum 2");
    const addendum = currency.plans[0].supersededBy.find((item) => item.label === "Addendum 2");
    expect(addendum?.kind).toBe("ADDENDUM");
    expect(addendum?.note).toBe("soffit detail at grid C");
    // Newest first, so the most recent thing issued leads.
    expect(currency.plans[0].supersededBy[0].issuedOn).toBe("2026-08-10");
  });

  it("reports an undated priced-scope addendum instead of dropping it", async () => {
    const won = await prisma.bidInvitation.findFirstOrThrow({ where: { companyId, wonJobId: jobId } });
    await prisma.bidAddendum.create({
      data: {
        companyId,
        bidInvitationId: won.id,
        reference: "Addendum 3",
        issuedOn: null,
        affectsPricedScope: true,
      },
    });

    const currency = await loadTakeoffCurrency(companyId, jobId);
    // It cannot be placed in time, so it supersedes nothing...
    const named = currency.plans[0].supersededBy.map((item) => item.label);
    expect(named).not.toContain("Addendum 3");
    // ...and it is named anyway, which is the only option that is not a lie.
    expect(currency.undated).toContain("Addendum 3");
  });
});

describe("loadTakeoffCurrency: tenancy", () => {
  it("returns nothing for a job on another company, even with the right job id", async () => {
    const currency = await loadTakeoffCurrency(companyId, otherJobId);
    expect(currency.plans).toEqual([]);
    expect(currency.headline).toBeNull();
    expect(currency.undated).toEqual([]);
  });

  it("does not let another company's revisions or addenda reach this job", async () => {
    const currency = await loadTakeoffCurrency(companyId, jobId);
    const named = currency.plans.flatMap((plan) => plan.supersededBy.map((item) => item.label));
    expect(named).not.toContain("Their architectural Rev 10");
    expect(named).not.toContain("Their Addendum 1");
    expect(currency.undated).not.toContain("Their Addendum 1");
  });

  it("answers for the other company's own job when asked as that company", async () => {
    const currency = await loadTakeoffCurrency(otherCompanyId, otherJobId);
    expect(currency.plans).toHaveLength(1);
    expect(currency.plans[0].state).toBe("SUPERSEDED");
    const named = currency.plans[0].supersededBy.map((item) => item.label);
    expect(named).toContain("Their architectural Rev 10");
    expect(named).toContain("Their Addendum 1");
  });
});
