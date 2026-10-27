import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { loadJobGuideFacts, loadOpenJobGuideFacts } from "./facts";
import { buildJobGuide } from "./buildJobGuide";
import { getJobGuide, getOpenJobGuides } from "./index";

/**
 * The guide's facts, read from a real Postgres at several stages of a bid, and
 * scoped to one company.
 *
 * `.dbtest.ts`, so the ordinary suite does not collect it: run it against a
 * SCRATCH database as `vitest.db.config.mts` documents. Nothing is mocked —
 * `facts.ts` only reads Prisma, so there is nothing to fake, and the point is
 * that the schema's real shapes (a wall run's JSON openings, a calibration
 * hanging off a page row, an invitation reached two ways) produce the numbers
 * the guide builds its sentences from.
 *
 * One job per stage of a bid, in one company, plus a second company's job that
 * must stay invisible to the first.
 */

const tag = `guide_${Date.now()}`;
const NOW = new Date("2026-10-26T15:00:00.000Z");
let companyId = "";
let otherCompanyId = "";
let contactId = "";
let otherContactId = "";
const jobs: Record<string, string> = {};
let otherJobId = "";

async function newJob(key: string, name: string, extra: { companyId?: string; contactId?: string; status?: "ESTIMATE" | "CONTRACTED" } = {}) {
  const job = await prisma.job.create({
    data: {
      companyId: extra.companyId ?? companyId,
      contactId: extra.contactId ?? contactId,
      name: `${name} ${tag}`,
      status: extra.status ?? "ESTIMATE",
    },
  });
  jobs[key] = job.id;
  return job;
}

describe("job guide facts against a real database", () => {
  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: `Guide Co ${tag}` } })).id;
    otherCompanyId = (await prisma.company.create({ data: { name: `Guide Other ${tag}` } })).id;
    contactId = (await prisma.contact.create({ data: { companyId, name: `Marlow GC ${tag}` } })).id;
    otherContactId = (await prisma.contact.create({ data: { companyId: otherCompanyId, name: `Their GC ${tag}` } })).id;

    // ── 1. just created, nothing else ──
    await newJob("fresh", "Fresh");

    // ── 2. drawings read, two floor-plan sheets, one scaled ──
    const drawings = await newJob("drawings", "Drawings");
    const plan = await prisma.takeoffPlan.create({
      data: { companyId, jobId: drawings.id, fileUrl: `https://example.test/${tag}.pdf`, fileName: "A.pdf" },
    });
    const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId, stage: "PAGE_INVENTORY", pageCount: 8 } });
    for (const pageNumber of [1, 2, 3, 4]) {
      await prisma.planSheetText.create({
        data: { planId: plan.id, pageNumber, hasTextLayer: true, widthPt: 3024, heightPt: 2160 },
      });
    }
    // Page 1 a cover (never needs a scale), pages 2 and 3 floor plans, page 4 a detail.
    // An older proposal calling page 3 a detail must lose to the newer one calling it a plan.
    const rerun = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId, stage: "TITLE_BLOCK", pageCount: 8 } });
    const proposal = (pageNumber: number, proposedPageType: string, createdAt: Date, ingestJobId = ingest.id) =>
      prisma.planSheetProposal.create({
        data: {
          ingestJobId,
          planId: plan.id,
          pageNumber,
          proposedPageType,
          proposedReason: "test",
          proposedConfidence: "HIGH",
          model: "test",
          promptVersion: "test",
          createdAt,
        },
      });
    await proposal(1, "COVER", new Date("2026-10-20"));
    await proposal(2, "PLAN", new Date("2026-10-20"));
    await proposal(3, "DETAIL", new Date("2026-10-20"));
    await proposal(3, "PLAN", new Date("2026-10-21"), rerun.id);
    await proposal(4, "DETAIL", new Date("2026-10-20"));
    const page2 = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 2 } });
    await prisma.takeoffScaleCalibration.create({
      data: { pageId: page2.id, x1: 0, y1: 0, x2: 100, y2: 0, declaredDistanceFeet: 20 },
    });

    // ── 3. measured, added to the estimate, partly priced, with a recap and an invitation ──
    const priced = await newJob("priced", "Priced");
    await prisma.takeoffPlan.create({ data: { companyId, jobId: priced.id, fileUrl: `https://example.test/${tag}-b.pdf` } });
    const catalog = await prisma.lineItemCatalogEntry.create({
      data: { companyId, description: `Board ${tag}`, unit: "SF", defaultUnitPrice: 2.5, defaultBudgetedUnitCost: 1.5 },
    });
    const w1 = await prisma.wallType.create({ data: { companyId, code: `W1${tag}`, name: "partition" } });
    const w2 = await prisma.wallType.create({ data: { companyId, code: `W2${tag}`, name: "rated wall" } });
    const w3 = await prisma.wallType.create({ data: { companyId, code: `W3${tag}`, name: "empty type" } });
    const c1 = await prisma.wallTypeComponent.create({
      data: { wallTypeId: w1.id, description: "Board", unit: "SF", basis: "BOARDED_SQFT", catalogEntryId: catalog.id },
    });
    const c2 = await prisma.wallTypeComponent.create({
      data: { wallTypeId: w2.id, description: "Board", unit: "SF", basis: "BOARDED_SQFT" },
    });
    await prisma.wallRun.createMany({
      data: [
        { companyId, jobId: priced.id, wallTypeId: w1.id, label: "R1", lengthFt: 100.25, openings: [{ widthFt: 3, heightFt: 7 }, { widthFt: 3, heightFt: 7 }] },
        { companyId, jobId: priced.id, wallTypeId: w1.id, label: "R2", lengthFt: 50, openings: [] },
        { companyId, jobId: priced.id, wallTypeId: w2.id, label: "R3", lengthFt: 200, openings: [{ widthFt: 4, heightFt: 7 }] },
        { companyId, jobId: priced.id, wallTypeId: w3.id, label: "R4", lengthFt: 10 },
      ],
    });
    await prisma.jobLineItem.createMany({
      data: [
        // w1: priced from the catalog
        { jobId: priced.id, description: "W1 board", quantity: 1000, unit: "SF", unitPrice: 2.5, budgetedUnitCost: 1.5, wallTypeComponentId: c1.id },
        // w2: no price
        { jobId: priced.id, description: "W2 board", quantity: 2000, unit: "SF", wallTypeComponentId: c2.id },
        // hand line, priced
        { jobId: priced.id, description: "Hand line", quantity: 2, unitPrice: 100, budgetedUnitCost: 80 },
        // cost-only indirect: no price on purpose, must not count as unpriced
        { jobId: priced.id, description: "Supervision", quantity: 1, budgetedUnitCost: 500, indirectKind: "SUPERVISION" },
        // deleted: invisible
        { jobId: priced.id, description: "Gone", quantity: 99, unitPrice: 999, isDeleted: true },
      ],
    });
    await prisma.jobBidRecap.create({ data: { companyId, jobId: priced.id, overheadPercent: 10 } });
    // Same work reached two ways: the project's invitations and the wonJobId link.
    const project = await prisma.bidProject.create({
      data: { companyId, name: `Priced project ${tag}`, bidDueDate: new Date("2026-10-30T00:00:00Z"), estimateJobId: priced.id },
    });
    await prisma.bidInvitation.create({
      data: {
        companyId,
        contactId,
        projectName: `Priced project ${tag}`,
        bidProjectId: project.id,
        dueDate: new Date("2026-10-29T00:00:00Z"),
        dueMinute: 840,
      },
    });
    await prisma.bidInvitation.create({
      data: {
        companyId,
        contactId,
        projectName: `Priced project, second GC ${tag}`,
        bidProjectId: project.id,
        status: "SUBMITTED",
        wonJobId: priced.id,
      },
    });

    // ── 4. sent ──
    const sent = await newJob("sent", "Sent");
    await prisma.jobLineItem.create({ data: { jobId: sent.id, description: "All of it", quantity: 1, unitPrice: 5000, budgetedUnitCost: 4000 } });
    await prisma.bidInvitation.create({
      data: { companyId, contactId, projectName: `Sent ${tag}`, status: "SUBMITTED", wonJobId: sent.id, dueDate: new Date("2026-10-27T00:00:00Z") },
    });

    // ── 5. closed: declined, so not on the home list ──
    const declined = await newJob("declined", "Declined");
    await prisma.bidInvitation.create({
      data: { companyId, contactId, projectName: `Declined ${tag}`, status: "DECLINED", wonJobId: declined.id },
    });

    // ── 6. past the estimate stage ──
    await newJob("contracted", "Contracted", { status: "CONTRACTED" });

    // ── 7. measured by hand: "Add as plain measurements — priced by hand" ──
    // The contractor walk (2026-10-27): measurements with no wall type and no
    // wall run, nothing on the estimate. A calibration of 50 ft across half the
    // page width is 100 ft per page width.
    const hand = await newJob("hand", "Hand");
    const handPlan = await prisma.takeoffPlan.create({ data: { companyId, jobId: hand.id, fileUrl: `https://example.test/${tag}-h.pdf` } });
    const handPage = await prisma.takeoffPlanPage.create({ data: { planId: handPlan.id, pageNumber: 1 } });
    const handScale = await prisma.takeoffScaleCalibration.create({
      data: { pageId: handPage.id, x1: 0, y1: 0, x2: 0.5, y2: 0, declaredDistanceFeet: 50 },
    });
    const handW = await prisma.wallType.create({ data: { companyId, code: `WH${tag}`, name: "hand job's type" } });
    const handRun = await prisma.wallRun.create({ data: { companyId, jobId: hand.id, wallTypeId: handW.id, label: "R1", lengthFt: 30 } });
    await prisma.takeoffMeasurement.createMany({
      data: [
        // 0.2 of the page width = 20 ft, and 0.1 + 0.05 down then across = 15 ft: 35 ft by hand
        { pageId: handPage.id, calibrationId: handScale.id, kind: "LINEAR", xs: [0.1, 0.3], ys: [0.1, 0.1] },
        { pageId: handPage.id, calibrationId: handScale.id, kind: "LINEAR", xs: [0.1, 0.1, 0.15], ys: [0.2, 0.3, 0.3] },
        // an area: counted, no feet
        { pageId: handPage.id, calibrationId: handScale.id, kind: "AREA", xs: [0.5, 0.6, 0.6], ys: [0.5, 0.5, 0.6] },
        // part of a wall run: counted through the run, NOT here
        { pageId: handPage.id, calibrationId: handScale.id, kind: "LINEAR", xs: [0.1, 0.4], ys: [0.8, 0.8], wallRunId: handRun.id },
      ],
    });

    // ── another company's, with a lot in it ──
    const other = await newJob("other", "Other", { companyId: otherCompanyId, contactId: otherContactId });
    otherJobId = other.id;
    await prisma.jobLineItem.create({ data: { jobId: other.id, description: "Theirs", quantity: 1, unitPrice: 123_456 } });
  });

  afterAll(async () => {
    const jobIds = [...Object.values(jobs)];
    await prisma.planSheetProposal.deleteMany({ where: { plan: { jobId: { in: jobIds } } } });
    await prisma.planIngestJob.deleteMany({ where: { plan: { jobId: { in: jobIds } } } });
    await prisma.takeoffPlan.deleteMany({ where: { jobId: { in: jobIds } } }); // pages, texts and calibrations cascade
    await prisma.wallRun.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.wallTypeComponent.deleteMany({ where: { wallType: { companyId } } });
    await prisma.wallType.deleteMany({ where: { companyId } });
    await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId } });
    await prisma.jobBidRecap.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.bidInvitation.deleteMany({ where: { companyId } });
    await prisma.bidProject.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.contact.deleteMany({ where: { id: { in: [contactId, otherContactId] } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await prisma.$disconnect();
  });

  it("a fresh job has nothing and says so", async () => {
    const facts = (await loadJobGuideFacts(companyId, jobs.fresh!))!;
    expect(facts).toMatchObject({
      name: `Fresh ${tag}`,
      gcName: `Marlow GC ${tag}`,
      hasTakeoffPlan: false,
      planCount: 0,
      sheetCount: 0,
      wallRunCount: 0,
      lineCount: 0,
      bidTotal: 0,
      recap: null,
      invitations: [],
      project: null,
    });
    expect(buildJobGuide(facts, NOW).ask?.id).toBe("no-drawings");
  });

  it("drawings: counts sheets, and only floor plans without a calibration need a scale", async () => {
    const facts = (await loadJobGuideFacts(companyId, jobs.drawings!))!;
    expect(facts.hasTakeoffPlan).toBe(true);
    expect(facts.planCount).toBe(1);
    expect(facts.sheetsRead).toBe(4);
    expect(facts.sheetCount).toBe(8); // the ingest run's pageCount, more than the four read
    // Page 2 is a plan WITH a calibration; page 3 is a plan (its newer proposal wins) with none.
    // Page 1 is a cover and page 4 a detail: neither needs a scale.
    expect(facts.sheetsMissingScale).toBe(1);
    expect(buildJobGuide(facts, NOW).ask?.id).toBe("no-scale");
  });

  it("measured and priced: footage, openings, price state, recap and both kinds of invitation", async () => {
    const facts = (await loadJobGuideFacts(companyId, jobs.priced!))!;
    expect(facts.wallRunCount).toBe(4);
    expect(facts.measuredFootageFt).toBeCloseTo(360.25, 2);
    expect(facts.openingsCount).toBe(3);
    expect(facts.wallLineCount).toBe(2);
    const byCode = Object.fromEntries(facts.wallTypes.map((type) => [type.code.slice(0, 2), type]));
    expect(byCode.W1).toMatchObject({ lengthFt: 150.25, runCount: 2, openingsCount: 2, componentCount: 1, lineCount: 1, unpricedLineCount: 0 });
    expect(byCode.W2).toMatchObject({ lengthFt: 200, runCount: 1, openingsCount: 1, componentCount: 1, lineCount: 1, unpricedLineCount: 1 });
    expect(byCode.W3).toMatchObject({ lengthFt: 10, componentCount: 0, lineCount: 0 });

    // Live lines only: the deleted one is not counted.
    expect(facts.lineCount).toBe(4);
    expect(facts.linesWithoutPrice).toBe(1); // W2 board; the cost-only supervision line is exempt
    expect(facts.linesWithoutCost).toBe(1); // W2 board has no budgeted cost
    expect(facts.bidTotal).toBeCloseTo(1000 * 2.5 + 2 * 100, 2);

    expect(facts.recap).toEqual({ appliedAt: null, addedTotal: expect.any(Number), landsAt: expect.any(Number) });
    expect(facts.recap!.addedTotal).toBeGreaterThan(0);
    // What Apply writes: 10% overhead on $2,160 of cost is $2,376, spread over
    // the two lines with both a price and a cost (W1 board and the hand line)
    // and rounded to cent unit prices — within a dollar of it, never the
    // $216 `addedTotal`.
    expect(facts.recap!.landsAt).toBeCloseTo(2_379, 0);
    expect(facts.handMeasurements).toEqual({ count: 0, lengthFt: 0 });

    expect(facts.project).toEqual({ id: expect.any(String), name: `Priced project ${tag}`, bidDueDate: "2026-10-30" });
    expect(facts.invitations.map((invitation) => invitation.status).sort()).toEqual(["INVITED", "SUBMITTED"]);
    expect(facts.invitations.find((invitation) => invitation.status === "INVITED")).toMatchObject({ dueDate: "2026-10-29", dueMinute: 840 });
    expect(new Set(facts.invitations.map((invitation) => invitation.id)).size).toBe(2); // the wonJobId one is not doubled
  });

  it("measured by hand: plain measurements count, a wall run's own do not", async () => {
    const facts = (await loadJobGuideFacts(companyId, jobs.hand!))!;
    expect(facts.handMeasurements.count).toBe(3);
    expect(facts.handMeasurements.lengthFt).toBeCloseTo(35, 2);
    expect(facts.measuredFootageFt).toBe(30); // the run's own length, unchanged
  });

  it("a job whose bid has gone out has no ask", async () => {
    const guide = (await getJobGuide(companyId, jobs.sent!, NOW))!;
    expect(guide.ask).toBeNull();
    expect(guide.steps.every((step) => step.status === "done")).toBe(true);
    // Priced has one SUBMITTED invitation as well, so it counts as sent too.
    expect((await getJobGuide(companyId, jobs.priced!, NOW))!.ask).toBeNull();
  });

  describe("company scoping", () => {
    it("returns null for another company's job, and for a job that does not exist", async () => {
      expect(await loadJobGuideFacts(companyId, otherJobId)).toBeNull();
      expect(await loadJobGuideFacts(otherCompanyId, jobs.priced!)).toBeNull();
      expect(await loadJobGuideFacts(companyId, "no_such_job")).toBeNull();
      expect(await getJobGuide(companyId, otherJobId, NOW)).toBeNull();
      expect(await loadJobGuideFacts(otherCompanyId, otherJobId)).not.toBeNull();
    });

    it("another company's rows never leak into the open list", async () => {
      const ids = (await loadOpenJobGuideFacts(companyId)).map((facts) => facts.jobId);
      expect(ids).not.toContain(otherJobId);
      expect((await loadOpenJobGuideFacts(otherCompanyId)).map((facts) => facts.jobId)).toEqual([otherJobId]);
    });

    it("a wall type or run from another company is not read as this job's", async () => {
      // A run on this job that points at the other company's wall type must be ignored, not named.
      const foreign = await prisma.wallType.create({ data: { companyId: otherCompanyId, code: `FX${tag}`, name: "foreign" } });
      await prisma.wallRun.create({ data: { companyId, jobId: jobs.fresh!, wallTypeId: foreign.id, label: "X", lengthFt: 77 } });
      try {
        const facts = (await loadJobGuideFacts(companyId, jobs.fresh!))!;
        expect(facts.wallTypes).toEqual([]);
        expect(facts.measuredFootageFt).toBe(0);
      } finally {
        await prisma.wallRun.deleteMany({ where: { wallTypeId: foreign.id } });
        await prisma.wallType.delete({ where: { id: foreign.id } });
      }
    });
  });

  describe("the open list", () => {
    it("holds open estimate jobs only: not declined, not contracted", async () => {
      const ids = (await loadOpenJobGuideFacts(companyId)).map((facts) => facts.jobId).sort();
      expect(ids).toEqual([jobs.fresh!, jobs.drawings!, jobs.priced!, jobs.sent!, jobs.hand!].sort());
    });

    it("agrees with the single-job loader, job for job", async () => {
      for (const facts of await loadOpenJobGuideFacts(companyId)) {
        expect(facts).toEqual(await loadJobGuideFacts(companyId, facts.jobId));
      }
    });

    it("is serialisable: JSON round-trips to the same facts", async () => {
      for (const facts of await loadOpenJobGuideFacts(companyId)) {
        expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
      }
    });

    it("orders by urgency: asks first, working last", async () => {
      const guides = await getOpenJobGuides(companyId, NOW);
      expect(guides.map((guide) => guide.jobId).slice(-2)).toEqual(expect.arrayContaining([jobs.sent!]));
      const asked = guides.filter((guide) => guide.ask !== null);
      expect(guides.slice(0, asked.length)).toEqual(asked);
      expect(guides.at(-1)!.ask).toBeNull();
    });

    it("loads in a fixed number of queries however many jobs there are", async () => {
      // Count the findMany calls on every table the loader reads. Twenty more jobs must not add one.
      const tables = [
        "job",
        "jobLineItem",
        "wallRun",
        "takeoffPlan",
        "planSheetText",
        "planSheetProposal",
        "takeoffPlanPage",
        "planIngestJob",
        "wallType",
        "bidAddendum",
        "outboundMessage",
      ] as const;
      const spies = tables.map((table) => {
        const delegate = prisma[table] as { findMany: (...args: unknown[]) => unknown };
        const original = delegate.findMany.bind(delegate);
        return vi.spyOn(delegate, "findMany").mockImplementation((...args: unknown[]) => original(...args));
      });
      const calls = async () => {
        for (const spy of spies) spy.mockClear();
        await loadOpenJobGuideFacts(companyId);
        return spies.map((spy) => spy.mock.calls.length);
      };
      const before = await calls();
      expect(before.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5); // the spies see the loader at all
      expect(Math.max(...before)).toBe(1); // one query per table, not one per job
      const extra = await prisma.$transaction(
        Array.from({ length: 20 }, (_, index) => prisma.job.create({ data: { companyId, contactId, name: `Bulk ${index} ${tag}` } })),
      );
      for (const job of extra) jobs[`bulk${job.id}`] = job.id;
      expect(await calls()).toEqual(before);
    });
  });
});

/**
 * The two new families of facts, from real rows: the wall-height question and
 * the dates and papers of the bid. One job on a two-GC project; a second company
 * with its own addendum on its own project must stay invisible.
 */
describe("questions the drawings don't settle, and the bid's dates and papers", () => {
  const t = `q_${Date.now()}`;
  let co = "";
  let otherCo = "";
  let gcA = "";
  let gcB = "";
  let otherGc = "";
  let jobId = "";
  let otherJob = "";
  let invA = "";
  let invB = "";
  let typeWh = "";
  const addenda: Record<string, string> = {};

  beforeAll(async () => {
    co = (await prisma.company.create({ data: { name: `Q Co ${t}` } })).id;
    otherCo = (await prisma.company.create({ data: { name: `Q Other ${t}` } })).id;
    gcA = (await prisma.contact.create({ data: { companyId: co, name: `Hartwell ${t}` } })).id;
    gcB = (await prisma.contact.create({ data: { companyId: co, name: `Marlow ${t}` } })).id;
    otherGc = (await prisma.contact.create({ data: { companyId: otherCo, name: `Theirs ${t}` } })).id;
    jobId = (await prisma.job.create({ data: { companyId: co, contactId: gcA, name: `Civic Center ${t}`, status: "ESTIMATE" } })).id;
    otherJob = (await prisma.job.create({ data: { companyId: otherCo, contactId: otherGc, name: `Other ${t}`, status: "ESTIMATE" } })).id;

    // ── walls: WH has no default and two runs with no height; WD has a default ──
    const wh = await prisma.wallType.create({ data: { companyId: co, code: `WH${t}`, name: "no height" } });
    const wd = await prisma.wallType.create({ data: { companyId: co, code: `WD${t}`, name: "has default", defaultHeightFt: 9 } });
    typeWh = wh.id;
    for (const type of [wh, wd]) {
      await prisma.wallTypeComponent.create({ data: { wallTypeId: type.id, description: "Board", unit: "SF", basis: "BOARDED_SQFT" } });
    }
    await prisma.wallRun.createMany({
      data: [
        { companyId: co, jobId, wallTypeId: wh.id, label: "A", lengthFt: 100 },
        { companyId: co, jobId, wallTypeId: wh.id, label: "B", lengthFt: 40.5 },
        { companyId: co, jobId, wallTypeId: wh.id, label: "C", lengthFt: 10, heightFt: 12 }, // its own height
        { companyId: co, jobId, wallTypeId: wd.id, label: "D", lengthFt: 300 }, // the default covers it
      ],
    });

    // ── the bid: one project, two GCs, both still being priced ──
    const project = await prisma.bidProject.create({ data: { companyId: co, name: `Civic ${t}`, estimateJobId: jobId } });
    invA = (
      await prisma.bidInvitation.create({
        data: {
          companyId: co,
          contactId: gcA,
          projectName: `Civic A ${t}`,
          bidProjectId: project.id,
          dueDate: new Date("2026-11-05T00:00:00Z"),
          dueMinute: 840,
          walkDate: new Date("2026-10-27T00:00:00Z"),
          walkMinute: 540,
        },
      })
    ).id;
    invB = (
      await prisma.bidInvitation.create({
        data: {
          companyId: co,
          contactId: gcB,
          projectName: `Civic B ${t}`,
          bidProjectId: project.id,
          rfiCutoffDate: new Date("2026-10-28T00:00:00Z"),
        },
      })
    ).id;

    // A1: acknowledged on BOTH forms — A's in the column, B's as a row.
    addenda.a1 = (
      await prisma.bidAddendum.create({
        data: { companyId: co, bidInvitationId: invA, bidProjectId: project.id, reference: "1", issuedOn: new Date("2026-10-13T00:00:00Z"), acknowledgedOn: new Date("2026-10-14T00:00:00Z") },
      })
    ).id;
    await prisma.bidAddendumAcknowledgement.create({ data: { bidAddendumId: addenda.a1, bidInvitationId: invB, acknowledgedOn: new Date("2026-10-15T00:00:00Z") } });
    // A2: on neither form — missing on A's AND on B's.
    addenda.a2 = (
      await prisma.bidAddendum.create({
        data: { companyId: co, bidInvitationId: invA, bidProjectId: project.id, reference: "2", issuedOn: new Date("2026-10-20T00:00:00Z") },
      })
    ).id;
    // A4: acknowledged on A's form only (the column) — missing on B's, which a
    // column-only read would call acknowledged.
    addenda.a4 = (
      await prisma.bidAddendum.create({
        data: { companyId: co, bidInvitationId: invA, bidProjectId: project.id, reference: "4", acknowledgedOn: new Date("2026-10-21T00:00:00Z") },
      })
    ).id;
    // A5: acknowledged on B's form only (a row) — missing on A's.
    addenda.a5 = (
      await prisma.bidAddendum.create({ data: { companyId: co, bidInvitationId: invA, bidProjectId: project.id, reference: "5" } })
    ).id;
    await prisma.bidAddendumAcknowledgement.create({ data: { bidAddendumId: addenda.a5, bidInvitationId: invB, acknowledgedOn: new Date("2026-10-22T00:00:00Z") } });
    // A3: a legacy row with no project, filed under B — only B shows it.
    addenda.a3 = (
      await prisma.bidAddendum.create({ data: { companyId: co, bidInvitationId: invB, bidProjectId: null, reference: "ASI 3" } })
    ).id;

    // Another company's bid and addendum, never acknowledged: invisible here.
    const theirInv = await prisma.bidInvitation.create({
      data: { companyId: otherCo, contactId: otherGc, projectName: `Theirs ${t}`, wonJobId: otherJob, walkDate: new Date("2026-10-27T00:00:00Z") },
    });
    await prisma.bidAddendum.create({ data: { companyId: otherCo, bidInvitationId: theirInv.id, reference: "9" } });
  });

  afterAll(async () => {
    await prisma.bidInvitation.deleteMany({ where: { companyId: { in: [co, otherCo] } } }); // addenda and acks cascade
    await prisma.bidProject.deleteMany({ where: { companyId: { in: [co, otherCo] } } });
    await prisma.wallRun.deleteMany({ where: { jobId: { in: [jobId, otherJob] } } });
    await prisma.wallTypeComponent.deleteMany({ where: { wallType: { companyId: co } } });
    await prisma.wallType.deleteMany({ where: { companyId: co } });
    await prisma.job.deleteMany({ where: { id: { in: [jobId, otherJob] } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: [co, otherCo] } } });
    await prisma.company.deleteMany({ where: { id: { in: [co, otherCo] } } });
  });

  it("the height question: only the type with no default, counting only its runs with no height", async () => {
    const facts = (await loadJobGuideFacts(co, jobId))!;
    const wh = facts.wallTypes.find((type) => type.wallTypeId === typeWh)!;
    expect(wh.heightless).toEqual({ runCount: 2, lengthFt: 140.5, token: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(facts.wallTypes.filter((type) => type.heightless).length).toBe(1);
  });

  it("walk and RFI dates come off each invitation, with each GC's name", async () => {
    const facts = (await loadJobGuideFacts(co, jobId))!;
    const a = facts.invitations.find((invitation) => invitation.id === invA)!;
    const b = facts.invitations.find((invitation) => invitation.id === invB)!;
    expect(a).toMatchObject({ gcName: `Hartwell ${t}`, walkDate: "2026-10-27", walkMinute: 540, rfiCutoffDate: null });
    expect(b).toMatchObject({ gcName: `Marlow ${t}`, walkDate: null, walkMinute: null, rfiCutoffDate: "2026-10-28" });
  });

  it("an addendum is missing per GC form: the column for the filing GC, a row for every other", async () => {
    const facts = (await loadJobGuideFacts(co, jobId))!;
    const missing = facts.unacknowledgedAddenda!.map((row) => `${row.reference}@${row.invitationId === invA ? "A" : "B"}`).sort();
    // A1 is acknowledged on both; A2 on neither; 4 only on A's form, 5 only on B's;
    // ASI 3 is a legacy row only B shows.
    expect(missing).toEqual(["2@A", "2@B", "4@B", "5@A", "ASI 3@B"]);
    expect(facts.unacknowledgedAddenda!.find((row) => row.invitationId === invA)).toEqual({
      addendumId: addenda.a2,
      reference: "2",
      issuedOn: "2026-10-20",
      invitationId: invA,
      gcName: `Hartwell ${t}`,
    });
    // another company's never-acknowledged "9" is not here
    expect(facts.unacknowledgedAddenda!.some((row) => row.reference === "9")).toBe(false);
  });

  it("a GC whose bid went out is no longer asked about its form", async () => {
    await prisma.bidInvitation.update({ where: { id: invB }, data: { status: "DECLINED" } });
    try {
      const facts = (await loadJobGuideFacts(co, jobId))!;
      expect(new Set(facts.unacknowledgedAddenda!.map((row) => row.invitationId))).toEqual(new Set([invA]));
    } finally {
      await prisma.bidInvitation.update({ where: { id: invB }, data: { status: "INVITED" } });
    }
  });

  it("builds into the asks in their order: the walk tomorrow first, then the height", async () => {
    const guide = (await getJobGuide(co, jobId, NOW))!;
    expect(guide.ask!.id).toBe("job-walk");
    expect(guide.ask!.title).toBe("The job walk is tomorrow at 9:00 AM.");
    expect(guide.ask!.actions[0]!.href).toBe(`/bid/bids#${invA}`);
    // three days on, the walk and the RFI cutoff have passed and the height question is next
    const later = (await getJobGuide(co, jobId, new Date("2026-10-29T15:00:00Z")))!;
    expect(later.ask!.id).toBe("wall-height");
    expect(later.ask!.title).toBe(`How tall are the WH${t} walls on Civic Center ${t}?`);
  });

  it("another company's walk is not on this company's home list", async () => {
    const guides = await getOpenJobGuides(co, NOW);
    expect(guides.map((guide) => guide.jobId)).toEqual([jobId]);
    const theirs = await getOpenJobGuides(otherCo, NOW);
    expect(theirs.map((guide) => guide.jobId)).toEqual([otherJob]);
    // their own walk IS theirs
    expect(theirs[0]!.ask!.id).toBe("job-walk");
  });
});

/**
 * THE SEND RECORD — the guide's "sent" read off the email the app sent for the
 * invitation (`sendBidProposal`, `submitBidPackage`), not only off the status.
 * A send the provider never took (only a FAILED event) does not count, and
 * another company's message that names this invitation's id does not either:
 * `relatedId` is a bare string with no foreign key (`messaging.prisma`).
 */
describe("the send record", () => {
  const t = `send_${Date.now()}`;
  let co = "";
  let otherCo = "";
  let jobId = "";
  let invitationId = "";

  beforeAll(async () => {
    co = (await prisma.company.create({ data: { name: `Send Co ${t}` } })).id;
    otherCo = (await prisma.company.create({ data: { name: `Send Other ${t}` } })).id;
    const gc = (await prisma.contact.create({ data: { companyId: co, name: `Turner ${t}`, email: "bids@turner.test" } })).id;
    jobId = (await prisma.job.create({ data: { companyId: co, contactId: gc, name: `Send job ${t}`, status: "ESTIMATE" } })).id;
    await prisma.jobLineItem.create({ data: { jobId, description: "Board", unit: "SF", quantity: 100, unitPrice: 2, budgetedUnitCost: 1 } });
    const project = await prisma.bidProject.create({ data: { companyId: co, name: `Send project ${t}`, estimateJobId: jobId } });
    invitationId = (
      await prisma.bidInvitation.create({
        data: { companyId: co, contactId: gc, projectName: `Send ${t}`, bidProjectId: project.id, dueDate: new Date("2026-10-27T00:00:00Z") },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.outboundMessageEvent.deleteMany({ where: { message: { companyId: { in: [co, otherCo] } } } });
    await prisma.outboundMessage.deleteMany({ where: { companyId: { in: [co, otherCo] } } });
    await prisma.bidInvitation.deleteMany({ where: { companyId: co } });
    await prisma.bidProject.deleteMany({ where: { companyId: co } });
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.contact.deleteMany({ where: { companyId: co } });
    await prisma.company.deleteMany({ where: { id: { in: [co, otherCo] } } });
  });

  const message = (companyId: string, createdAt: string, type: "QUEUED" | "FAILED") =>
    prisma.outboundMessage.create({
      data: {
        companyId,
        channel: "EMAIL",
        toAddress: "bids@turner.test",
        subject: "Proposal",
        body: "Proposal text",
        fromAddress: "office@cyrus.test",
        relatedType: "BID_INVITATION",
        relatedId: invitationId,
        createdAt: new Date(createdAt),
        events: { create: { type, occurredAt: new Date(createdAt) } },
      },
    });

  it("an invitation never emailed has no send day, and a ready bid still asks to be sent", async () => {
    const facts = (await loadJobGuideFacts(co, jobId))!;
    expect(facts.invitations).toEqual([expect.objectContaining({ id: invitationId, status: "INVITED", proposalSentOn: null })]);
    expect(buildJobGuide(facts, NOW).ask).not.toBeNull();
  });

  it("a send that never reached the provider, or another company's message, is not a send", async () => {
    await message(co, "2026-10-24T18:00:00Z", "FAILED");
    await message(otherCo, "2026-10-23T18:00:00Z", "QUEUED");
    const facts = (await loadJobGuideFacts(co, jobId))!;
    expect(facts.invitations[0]!.proposalSentOn).toBeNull();
  });

  it("the first send that reached the provider is the day, and the guide reads done with the status still INVITED", async () => {
    await message(co, "2026-10-26T15:30:00Z", "QUEUED");
    await message(co, "2026-10-27T09:00:00Z", "QUEUED");
    const facts = (await loadJobGuideFacts(co, jobId))!;
    expect(facts.invitations[0]).toMatchObject({ status: "INVITED", proposalSentOn: "2026-10-26" });
    const guide = buildJobGuide(facts, NOW);
    expect(guide.ask).toBeNull();
    expect(guide.steps.every((step) => step.status === "done")).toBe(true);
    expect(guide.steps[4]!.summary).toBe("Sent Oct 26");
    // still on the home list (a sent bid waits on a decision), with no ask
    const home = await getOpenJobGuides(co, NOW);
    expect(home.map((one) => [one.jobId, one.ask])).toEqual([[jobId, null]]);
  });
});
