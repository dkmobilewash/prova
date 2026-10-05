import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * RESCALING A MULTI-SCALE SHEET WOULD MULTIPLY A DETAIL'S QUANTITIES, and this
 * is the guard that it cannot — against a real Postgres.
 *
 * `rescaleTakeoffMeasurements` repoints every unposted measurement to the
 * NEWEST calibration and leaves the traced geometry untouched. That is right
 * for a RE-CALIBRATION — the estimator set the scale, disliked the line, set it
 * again — and silently wrong for a SECOND ZONE: a head-of-wall detail traced at
 * 1-1/2" and then repointed onto a 1/8" plan calibration reads twelve times too
 * big, on figures headed for a bid. Nothing said so, and the "reads at an older
 * scale" banner was the thing inviting the press.
 *
 * WHY THIS NEEDS A DATABASE and `takeoff-zones.test.ts` beside it does not.
 * That file owns the DECISION — what counts as two scales, what stays silent,
 * what the sentence says. This owns the CONSEQUENCE, which is a claim about
 * rows: whether an `updateMany` ran, and whether a measurement's
 * `calibrationId` moved. A fake prisma would only prove the fake behaves as I
 * expect, and `lib/fake-prisma.ts` cannot express this one anyway — it matches
 * `where` by strict per-key equality, and the action filters on
 * `calibrationId: { not: … }` plus a nested relation.
 *
 * Named `.dbtest.ts` so the ordinary suite does not collect it, and run against
 * a SCRATCH database — `vitest.db.setup.mts` refuses anything that is not
 * localhost or a unix socket.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { rescaleTakeoffMeasurements } = await import("./takeoff");

/** An ARCH D sheet, 36in at 72pt — the width every scale below is read against. */
const SHEET_PT = 36 * 72;

let companyId = "";
let jobId = "";

/**
 * A page carrying the calibrations described, each with one unposted
 * measurement traced against it.
 *
 * `declaredFeet` over a half-page-width line sets the scale: 144ft across half
 * of 36 paper inches is 8 ft/in, which is 1/8" = 1'-0". 12ft is 0.667 ft/in,
 * which is 1-1/2" = 1'-0" — the detail scale this whole file is about.
 */
async function pageWith(declaredFeetNewestFirst: number[]) {
  const plan = await prisma.takeoffPlan.create({
    data: { companyId, jobId, fileUrl: "https://example.test/zones.pdf" },
  });
  const page = await prisma.takeoffPlanPage.create({
    data: { planId: plan.id, pageNumber: 1, pageWidthPt: SHEET_PT },
  });
  // Created OLDEST FIRST so `orderBy: createdAt desc` makes the first element
  // of the argument the newest — the one the action would move everything to.
  //
  // `createdAt` IS SET EXPLICITLY, and the first version of this file did not
  // do that: two `create` calls land inside the same millisecond, `createdAt`
  // ties, and `orderBy: { createdAt: "desc" }` then picks either row. The
  // control failed with the rescale having SUCCEEDED onto the other
  // calibration — a flaw in the fixture that reads exactly like a product
  // bug. `takeoff-currency-query.dbtest.ts` pins its plan dates for the same
  // reason. A person cannot click twice in a millisecond, so this is not a
  // hazard in the app; it is one in any test that writes rows in a loop.
  const ids: string[] = [];
  let minute = 0;
  for (const feet of [...declaredFeetNewestFirst].reverse()) {
    const calibration = await prisma.takeoffScaleCalibration.create({
      data: {
        pageId: page.id,
        x1: 0.1,
        y1: 0.5,
        x2: 0.6,
        y2: 0.5,
        declaredDistanceFeet: String(feet),
        createdAt: new Date(Date.UTC(2026, 9, 5, 12, minute)),
      },
    });
    minute += 10;
    await prisma.takeoffMeasurement.create({
      data: {
        pageId: page.id,
        calibrationId: calibration.id,
        kind: "LINEAR",
        xs: [0.2, 0.4],
        ys: [0.6, 0.6],
        label: `traced at ${feet}`,
      },
    });
    ids.unshift(calibration.id);
  }
  return { pageId: page.id, calibrationIds: ids };
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Rescale Zones Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Rescale Zones Job", status: "ESTIMATE" },
  });
  jobId = job.id;
});

afterAll(async () => {
  // Dependency order: `Company` does not cascade to `Contact`, and
  // `TakeoffPlan` DOES cascade to pages, calibrations and measurements.
  await prisma.takeoffPlan.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe("rescale refuses a sheet that carries two real scales", () => {
  it("REFUSES, and nothing moves", async () => {
    // 1/8" plan and a 1-1/2" detail — a factor of twelve apart.
    const { pageId, calibrationIds } = await pageWith([12, 144]);
    const form = new FormData();
    form.set("pageId", pageId);

    const result = await rescaleTakeoffMeasurements(jobId, form);
    expect(result.ok, "a multi-scale sheet was rescaled").toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("more than one scale");
    // A REFUSAL THAT STILL WROTE WOULD READ AS A REFUSAL. The rows are the
    // claim, so the rows are what this reads back.
    for (const calibrationId of calibrationIds) {
      const still = await prisma.takeoffMeasurement.count({ where: { pageId, calibrationId } });
      expect(still, `the measurement on ${calibrationId} moved`).toBe(1);
    }
  });

  it("names what to do instead rather than only saying no", async () => {
    const { pageId } = await pageWith([12, 144]);
    const form = new FormData();
    form.set("pageId", pageId);
    const result = await rescaleTakeoffMeasurements(jobId, form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Production redacts a THROWN message to a digest, so this has to be a
    // returned refusal — and it has to tell the estimator their figures are
    // already right, or they will go looking for a way to force it.
    expect(result.error).toContain("already reads at the scale it was traced against");
  });
});

describe("a genuine re-calibration still rescales, which is the control", () => {
  it("MOVES the older measurement onto the newest calibration", async () => {
    // Two calibrations 4% apart: the same scale, drawn twice, because nobody
    // clicks the same two pixels. Without this case the test above would pass
    // on an action that refuses everything.
    const { pageId, calibrationIds } = await pageWith([144, 150]);
    const form = new FormData();
    form.set("pageId", pageId);

    const result = await rescaleTakeoffMeasurements(jobId, form);
    expect(result.ok, "a re-calibration was refused").toBe(true);

    const newest = calibrationIds[0];
    const onNewest = await prisma.takeoffMeasurement.count({ where: { pageId, calibrationId: newest } });
    expect(onNewest, "both measurements should now read at the newest scale").toBe(2);
    const onOlder = await prisma.takeoffMeasurement.count({
      where: { pageId, calibrationId: { not: newest } },
    });
    expect(onOlder).toBe(0);
  });

  it("still refuses when there is nothing to move, in its own words", async () => {
    const { pageId } = await pageWith([144]);
    const form = new FormData();
    form.set("pageId", pageId);
    const result = await rescaleTakeoffMeasurements(jobId, form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The pre-existing refusal, unchanged by this work — asserted so the new
    // branch cannot swallow it.
    expect(result.error).toContain("already reads at the current scale");
  });
});
