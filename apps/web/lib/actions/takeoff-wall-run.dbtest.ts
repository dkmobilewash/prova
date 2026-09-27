import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * A measured run posted against a wall type arrives PRICED — issue #515,
 * against a real Postgres.
 *
 * WHY THIS NEEDS A DATABASE and the pure test beside it does not. #515's whole
 * complaint is about what a posted line CARRIES: a wall run created on the Wall
 * types page produces lines with a unit price, a budgeted cost, a craft, a
 * catalog link, a production rate and a cost category, while a plan takeoff
 * produced description, unit and quantity. That is a claim about rows, and
 * `syncWallScheduleLines` is the thing that writes them — so a fake database
 * would only prove that the fake behaves as I expect. `lib/fake-prisma.ts`
 * cannot express it anyway: it matches a `where` by strict per-key equality, so
 * the `{ id: { in: ids } }` and nested-relation filters `postTakeoffMeasurements`
 * opens with never match.
 *
 * `lib/estimating/measured-wall-run.test.ts` owns the DECISIONS — which type,
 * whose height, what is refused and in what words. This owns the consequence.
 *
 * NOT RUN LOCALLY by the session that wrote it: there is no Postgres and no
 * Docker in an agent container, so this was written against the schema and is
 * executed by CI's `dbtest` job (postgres:16). Said plainly because "I wrote a
 * test" and "a test ran" are different claims, and this file's whole subject is
 * the difference between a line that looks complete and one that is.
 *
 * Named `.dbtest.ts` so the ordinary suite does not collect it. Run against a
 * SCRATCH database — `vitest.db.setup.mts` refuses anything that is not
 * localhost or a unix socket, which is the guard that exists because a
 * `--shadow-database-url` pointed at a real one once dropped it.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { postTakeoffMeasurements } = await import("./takeoff");

let companyId = "";
let jobId = "";
let wallTypeId = "";
let measurementId = "";
let bareMeasurementId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Takeoff Wall Run Test Co" } });
  companyId = company.id;
  context.company.id = companyId;

  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Takeoff Wall Run Job", status: "ESTIMATE" },
  });
  jobId = job.id;

  // The price a posted line has to inherit. Without a catalog entry the
  // component prices at null, which would make this test pass for the wrong
  // reason — so the entry carries all three figures the assertion reads.
  const entry = await prisma.lineItemCatalogEntry.create({
    data: {
      companyId,
      description: '5/8" Type X board',
      unit: "SF",
      defaultUnitPrice: "2.85",
      defaultBudgetedUnitCost: "1.90",
      costCategory: "MATERIAL",
    },
  });

  const wallType = await prisma.wallType.create({
    data: { companyId, code: "A1", name: '3-5/8" 20ga, 5/8" Type X both sides', defaultHeightFt: "9", sides: 2 },
  });
  wallTypeId = wallType.id;
  await prisma.wallTypeComponent.create({
    data: {
      wallTypeId,
      description: '5/8" Type X board',
      basis: "BOARDED_SQFT",
      catalogEntryId: entry.id,
      costCategory: "MATERIAL",
    },
  });

  const plan = await prisma.takeoffPlan.create({
    data: { companyId, jobId, fileUrl: "https://example.test/sheet.pdf" },
  });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } });
  // 1 page unit = 1 foot, so a 20-unit trace is 20 feet and the arithmetic below
  // can be read by hand.
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "1" },
  });
  const measurement = await prisma.takeoffMeasurement.create({
    data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0, 20], ys: [0, 0], label: "Corridor" },
  });
  measurementId = measurement.id;
  const bare = await prisma.takeoffMeasurement.create({
    data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0, 10], ys: [0, 0], label: "Lobby" },
  });
  bareMeasurementId = bare.id;
});

afterAll(async () => {
  // Children first: JobLineItem and WallRun are RESTRICT children of Job.
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.wallRun.deleteMany({ where: { jobId } });
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { jobId } } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.wallTypeComponent.deleteMany({ where: { wallTypeId } });
  await prisma.wallRun.deleteMany({ where: { wallTypeId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

function form(fields: Record<string, string>, measurements: string[]): FormData {
  const data = new FormData();
  data.set("recipe", "wall");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  for (const id of measurements) data.append("measurementId", id);
  return data;
}

describe("posting a measured run against a wall type", () => {
  it("creates a real WallRun and the lines arrive priced, coded and traceable", async () => {
    const result = await postTakeoffMeasurements(
      jobId,
      form({ wallTypeId, label: "Level 3 corridor" }, [measurementId]),
    );
    expect(result.ok, result.ok === false ? result.error : "").toBe(true);

    // A real wall run, not recipe output — which is what makes the takeoff
    // inherit `refreshWallSchedule` instead of stranding a second set of lines
    // when somebody recalibrates the sheet.
    const runs = await prisma.wallRun.findMany({ where: { jobId } });
    expect(runs).toHaveLength(1);
    expect(runs[0].wallTypeId).toBe(wallTypeId);
    expect(runs[0].label).toBe("Level 3 corridor");
    expect(Number(runs[0].lengthFt), "20 page units at 1 unit per foot").toBe(20);
    expect(Number(runs[0].heightFt), "the wall type's default, not typed").toBe(9);

    // THE POINT OF #515. Before this, a posted takeoff line carried description,
    // unit and quantity. Every other field here was null and somebody typed it.
    const lines = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } });
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.wallTypeComponentId, "not linked to the component it came from").not.toBeNull();
    expect(Number(line.unitPrice), "arrived unpriced — this is the whole issue").toBe(2.85);
    expect(Number(line.budgetedUnitCost), "no cost, so the recap marks up nothing").toBe(1.9);
    expect(line.costCategory, "uncoded lines are marked up at nothing (#513)").toBe("MATERIAL");
    // 20ft × 9ft × 2 sides = 360 SF.
    expect(Number(line.quantity)).toBe(360);

    const posted = await prisma.takeoffMeasurement.findUnique({ where: { id: measurementId } });
    expect(posted?.postedAt, "not marked posted, so it can be added twice").not.toBeNull();
  });

  it("CONTROL: without a wall type the old path still posts bare quantities", async () => {
    // The typed-height path stays, because a company with no wall types defined
    // still has to be able to post what it measured. If this ever starts
    // creating wall runs, #515's fix has become a change nobody asked for.
    const before = await prisma.wallRun.count({ where: { jobId } });
    const result = await postTakeoffMeasurements(jobId, form({ heightFt: "9" }, [bareMeasurementId]));
    expect(result.ok, result.ok === false ? result.error : "").toBe(true);

    expect(await prisma.wallRun.count({ where: { jobId } })).toBe(before);
    const bare = await prisma.jobLineItem.findMany({
      where: { jobId, isDeleted: false, wallTypeComponentId: null },
    });
    expect(bare.length, "the recipe path should still produce lines").toBeGreaterThan(0);
    // And they carry no price — which is exactly what #515 says is wrong with
    // this path, kept as a control so the difference is visible in one file.
    expect(bare.every((row) => row.unitPrice === null)).toBe(true);
  });
});
