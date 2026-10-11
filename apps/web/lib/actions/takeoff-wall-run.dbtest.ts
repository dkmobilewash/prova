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

const { postTakeoffMeasurements, saveTakeoffMeasurements } = await import("./takeoff");
const { syncWallScheduleLines } = await import("@/lib/estimating/wall-schedule");
const { deleteWallRun } = await import("./wallTypes");

let companyId = "";
let jobId = "";
let wallTypeId = "";
let measurementId = "";
let pageId = "";
let bareMeasurementId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Takeoff Wall Run Test Co" } });
  companyId = company.id;
  context.company.id = companyId;

  // A REAL USER ROW, because `saveTakeoffMeasurements` records who added a
  // measurement and `createdByUserId: ""` is a foreign-key violation. The
  // suite ran for months without one: every earlier case creates measurements
  // directly in this fixture, so no test had ever taken the path that stamps an
  // author. The error it produces is a bare `PrismaClientKnownRequestError`
  // with an empty message, which reads like a broken query rather than a
  // missing row.
  const user = await prisma.user.create({
    data: { clerkId: `user_wallrun_${Date.now()}`, email: `wallrun-${Date.now()}@example.test`, companyId },
  });
  context.id = user.id;

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
  pageId = page.id;
  // COORDINATES ARE NORMALISED 0..1 — fractions of the page, not page units.
  // `verticesProblem` refuses anything outside that box, which is what the
  // first run of this file discovered: `xs: [0, 20]` is twenty page-widths off
  // the sheet, and the refusal said so in those words.
  //
  // So the calibration makes the full page width 100ft, and a trace across
  // 0.2 of it is 20ft — the arithmetic stays readable by hand.
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" },
  });
  const measurement = await prisma.takeoffMeasurement.create({
    data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0, 0.2], ys: [0, 0], label: "Corridor" },
  });
  measurementId = measurement.id;
  const bare = await prisma.takeoffMeasurement.create({
    data: { pageId: page.id, calibrationId: calibration.id, kind: "LINEAR", xs: [0, 0.1], ys: [0, 0], label: "Lobby" },
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
  // THE USER, BEFORE THE COMPANY. `User.companyId` is a RESTRICT child, so
  // leaving it behind makes `company.deleteMany` fail with P2003 on
  // `User_companyId_fkey` — which is the `InvoiceCounter` trap in CLAUDE.md
  // arriving in a fixture: adding a child row is two edits, the row and the
  // teardown.
  //
  // IT PASSED LOCALLY AND FAILED IN CI, and that difference is the thing worth
  // remembering: running ONE dbtest file writes and tears down its own data,
  // while CI runs the whole suite, so a teardown that cannot complete only
  // shows up against everything else. A green single-file run is not evidence
  // that a fixture cleans up after itself.
  await prisma.user.deleteMany({ where: { companyId } });
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
    expect(Number(runs[0].lengthFt), "0.2 of a page whose width is 100ft").toBe(20);
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


  // ── A LINE SOMEBODY DELETED STAYS DELETED ────────────────────────────
  //
  // These four each start from nothing. The suite above deliberately
  // accumulates, and `postTakeoffMeasurements` marks a measurement posted so
  // it cannot be added twice — so without this they post nothing and read an
  // empty list, which looks like a passing assertion about the wrong thing.
  const freshJob = async () => {
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    await prisma.wallRun.deleteMany({ where: { jobId } });
    await prisma.takeoffMeasurement.updateMany({ where: { id: measurementId }, data: { postedAt: null } });
  };

  //
  // Reported from the app: delete a wall-schedule line and it comes back. It
  // came back because `syncWallScheduleLines` read only `isDeleted: false`, so
  // a removed line was invisible to it and it built a fresh one — at catalog
  // prices, losing whatever had been typed on the old one.

  it("DOES NOT PUT BACK A LINE SOMEBODY DELETED", async () => {
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const before = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } });
    expect(before).toHaveLength(1);

    await prisma.jobLineItem.update({ where: { id: before[0].id }, data: { isDeleted: true } });

    // Any re-sync: this is what a recalibration, another posting or
    // `refreshWallSchedule` all end in.
    await prisma.$transaction(async (tx) => {
      await syncWallScheduleLines(tx as never, companyId, jobId);
    });

    const after = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } });
    expect(after, "the deleted line was rebuilt — this is the bug").toHaveLength(0);
  });

  it("keeps the component link on a line a person deleted, which is how it is recognised", async () => {
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const [line] = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } });
    await prisma.jobLineItem.update({ where: { id: line.id }, data: { isDeleted: true } });
    await prisma.$transaction(async (tx) => {
      await syncWallScheduleLines(tx as never, companyId, jobId);
    });
    const kept = await prisma.jobLineItem.findUnique({ where: { id: line.id } });
    expect(kept?.isDeleted).toBe(true);
    expect(kept?.wallTypeComponentId, "the link is what says a PERSON removed it").not.toBeNull();
  });

  it("RELEASES THE LINK when the sync itself retires a line, so the component can come back", async () => {
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const [line] = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } });

    // Take the run away: the component is no longer in the schedule, so the
    // sync retires its line. That is ITS deletion, not a person's.
    await prisma.wallRun.deleteMany({ where: { jobId } });
    await prisma.$transaction(async (tx) => {
      await syncWallScheduleLines(tx as never, companyId, jobId);
    });

    const retired = await prisma.jobLineItem.findUnique({ where: { id: line.id } });
    expect(retired?.isDeleted).toBe(true);
    expect(retired?.wallTypeComponentId, "released, so a re-add is not mistaken for a person's delete").toBeNull();
  });

  it("BUILDS THE LINE AGAIN when the run comes back after the sync retired it", async () => {
    await freshJob();
    // The case the released link exists for. Without it, a component that
    // leaves the schedule and returns would be treated as something somebody
    // deleted, and the line would never come back.
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    await prisma.wallRun.deleteMany({ where: { jobId } });
    await prisma.$transaction(async (tx) => {
      await syncWallScheduleLines(tx as never, companyId, jobId);
    });
    expect(await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } })).toBe(0);

    await prisma.wallRun.create({
      // No `sides` here: that lives on the WALL TYPE, not the run.
      data: { jobId, companyId, wallTypeId, label: "Run A again", lengthFt: "20", heightFt: "9" },
    });
    await prisma.$transaction(async (tx) => {
      await syncWallScheduleLines(tx as never, companyId, jobId);
    });
    expect(
      await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } }),
      "a component that left and returned should bring its line back",
    ).toBe(1);
  });

  it("A PERSON'S DELETION SURVIVES THE RUN LEAVING AND COMING BACK", async () => {
    // Found by mutation. Without the `isDeleted` guard in the retirement loop,
    // a line a PERSON deleted gets its link released the next time its
    // component falls out of the schedule — and the deletion is forgotten the
    // moment a run of that wall type reappears.
    //
    // The person said they do not want this component's line on this job. A
    // new run of the same wall type does not change that; adding the line back
    // by hand does.
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const [line] = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } });
    await prisma.jobLineItem.update({ where: { id: line.id }, data: { isDeleted: true } });

    // The run goes...
    await prisma.wallRun.deleteMany({ where: { jobId } });
    await prisma.$transaction(async (tx) => {
      await syncWallScheduleLines(tx as never, companyId, jobId);
    });
    const afterRemoval = await prisma.jobLineItem.findUnique({ where: { id: line.id } });
    expect(afterRemoval?.wallTypeComponentId, "a person's deletion keeps its link through a retirement pass").not.toBeNull();

    // ...and comes back.
    await prisma.wallRun.create({
      data: { jobId, companyId, wallTypeId, label: "Run B", lengthFt: "20", heightFt: "9" },
    });
    await prisma.$transaction(async (tx) => {
      await syncWallScheduleLines(tx as never, companyId, jobId);
    });
    expect(
      await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } }),
      "the deletion was forgotten when the run came back",
    ).toBe(0);
  });

  // ── DELETING THE RUN LETS ITS MEASUREMENTS GO ────────────────────────
  //
  // `postedAt` on its own was a one-way door. Delete the run a measurement was
  // posted into and its estimate line went with it, while the measurement
  // still read "already on the estimate" and `postMeasuredWallRun` still
  // refused it — a traced wall nobody could price and nothing on the estimate
  // to show for it. Nothing recorded WHICH run it went into, so nothing could
  // clear the flag. `wallRunId` is that record.

  it("RECORDS WHICH RUN a measurement was posted into", async () => {
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const [run] = await prisma.wallRun.findMany({ where: { jobId } });
    const posted = await prisma.takeoffMeasurement.findUnique({ where: { id: measurementId } });
    expect(posted?.postedAt, "still has to be marked posted").not.toBeNull();
    expect(posted?.wallRunId, "and has to say which run").toBe(run.id);
  });

  it("CLEARS postedAt WHEN THAT RUN IS DELETED, so it can be priced again", async () => {
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const [run] = await prisma.wallRun.findMany({ where: { jobId } });

    const result = await deleteWallRun(jobId, run.id);
    expect(result.ok, result.ok === false ? result.error : "").toBe(true);

    const freed = await prisma.takeoffMeasurement.findUnique({ where: { id: measurementId } });
    expect(freed, "the survey outlives the pricing decision — never deleted").not.toBeNull();
    expect(freed?.postedAt, "left posted with no line to show for it").toBeNull();
    expect(freed?.wallRunId).toBeNull();
  });

  it("AND THE RE-POST ACTUALLY WORKS, which is the whole point", async () => {
    // The assertion that matters. Clearing the flag is worth nothing if the
    // action still refuses the measurement, and `postMeasuredWallRun` reads
    // `postedAt` itself rather than being told.
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const [run] = await prisma.wallRun.findMany({ where: { jobId } });
    await deleteWallRun(jobId, run.id);

    const again = await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A again" }, [measurementId]));
    expect(again.ok, again.ok === false ? again.error : "").toBe(true);
    expect(await prisma.wallRun.count({ where: { jobId } }), "a fresh run").toBe(1);
    expect(
      await prisma.jobLineItem.count({ where: { jobId, isDeleted: false } }),
      "and it is back on the estimate",
    ).toBe(1);
  });

  it("DOES NOT DELETE THE MEASUREMENT with the run", async () => {
    // SetNull, not Cascade. Cascade would delete somebody's traced walls
    // because they changed their mind about a wall type.
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const [run] = await prisma.wallRun.findMany({ where: { jobId } });
    await deleteWallRun(jobId, run.id);
    const survivor = await prisma.takeoffMeasurement.findUnique({ where: { id: measurementId } });
    expect(survivor?.xs.length, "the traced geometry is untouched").toBeGreaterThan(0);
  });

  it("leaves a measurement posted into a DIFFERENT run alone", async () => {
    // The `where: { wallRunId: runId }` has to be scoped. Clearing every
    // measurement on the job would un-post work nobody deleted.
    await freshJob();
    await postTakeoffMeasurements(jobId, form({ wallTypeId, label: "Run A" }, [measurementId]));
    const [posted] = await prisma.wallRun.findMany({ where: { jobId } });

    const other = await prisma.wallRun.create({
      data: { jobId, companyId, wallTypeId, label: "Someone else's run", lengthFt: "10", heightFt: "9" },
    });
    await deleteWallRun(jobId, other.id);

    const untouched = await prisma.takeoffMeasurement.findUnique({ where: { id: measurementId } });
    expect(untouched?.postedAt, "deleting another run un-posted this one").not.toBeNull();
    expect(untouched?.wallRunId).toBe(posted.id);
  });

  // ── ACCEPTING A DETECTED GROUP THE DRAWING NAMED ───────────────────────
  //
  // The last link. Before this, accepting a detected group wrote plain
  // measurements and the estimator then selected them, chose a wall type and a
  // height, and posted a run — for every group, on every sheet, having already
  // been shown that the drawing tags the group W1.
  //
  // These go through `saveTakeoffMeasurements` with a `wallTypeId`, which is
  // what the viewer sends on a MATCH. A fake client cannot prove this: the
  // whole value is that the lines arrive PRICED, and the prices come from the
  // catalog through `syncWallScheduleLines`.

  it("ARRIVES PRICED when the drawing named the wall type", async () => {
    await freshJob();
    const body = new FormData();
    body.set("pageId", pageId);
    body.set("label", "W1 wall — 4⅞\u2033");
    body.set("wallTypeId", wallTypeId);
    body.append("shape", JSON.stringify({ xs: [0.1, 0.3], ys: [0.2, 0.2] }));

    const result = await saveTakeoffMeasurements(jobId, body);
    expect(result.ok, result.ok === false ? result.error : "").toBe(true);

    // A real run, not bare quantities.
    const runs = await prisma.wallRun.findMany({ where: { jobId } });
    expect(runs, "no wall run was created, so nothing is priced").toHaveLength(1);
    expect(runs[0].wallTypeId).toBe(wallTypeId);

    // AND THE LINES CARRY A PRICE, which is the entire point of the feature.
    const lines = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } });
    expect(lines.length).toBeGreaterThan(0);
    expect(
      lines.some((line) => line.unitPrice !== null),
      "the lines arrived unpriced — this is the hand-pricing the feature removes",
    ).toBe(true);

    // ── AND THE QUANTITY IS RIGHT, which mutation says nothing else checked ──
    //
    // Doubling the calibration handed to the run left every assertion green:
    // the lines existed, they were priced, and the footage was twice the
    // building. A wrong quantity on a priced line is the whole failure this
    // feature could cause, so it is asserted in feet of real geometry.
    //
    // 0.1 → 0.3 is 0.2 of the page width; the calibration declares the full
    // width as 100 ft, so the run is 20 ft. The wall type defaults to 9 ft and
    // two sides: 20 × 9 × 2 = 360 SF.
    expect(Number(runs[0].lengthFt), "the run's length is not the traced geometry").toBe(20);
    const board = lines.find((line) => line.description.includes("Type X"));
    expect(board, "the board line is not there at all").toBeDefined();
    expect(Number(board?.quantity), "20ft × 9ft × 2 sides").toBe(360);

    // And the measurement is marked posted, with the run recorded — so
    // deleting that run releases it again (#719).
    const measurements = await prisma.takeoffMeasurement.findMany({ where: { pageId } });
    const made = measurements.find((one) => one.label?.startsWith("W1 wall"));
    expect(made?.postedAt).not.toBeNull();
    expect(made?.wallRunId).toBe(runs[0].id);
  });

  it("CONTROL: the SAME call without a wallTypeId writes measurements and NO run", async () => {
    // What distinguishes the feature from the old flow. Without this, "it was
    // priced" could be something the fixture did rather than the new path.
    await freshJob();
    const body = new FormData();
    body.set("pageId", pageId);
    body.set("label", "4⅞\u2033 wall");
    body.append("shape", JSON.stringify({ xs: [0.1, 0.3], ys: [0.2, 0.2] }));

    const result = await saveTakeoffMeasurements(jobId, body);
    expect(result.ok, result.ok === false ? result.error : "").toBe(true);
    expect(await prisma.wallRun.count({ where: { jobId } }), "a run was created with no type asked for").toBe(0);
    const measurements = await prisma.takeoffMeasurement.findMany({ where: { pageId } });
    expect(measurements.some((one) => one.label === "4⅞\u2033 wall"), "the measurement was not written").toBe(true);
  });

  it("KEEPS THE MEASUREMENTS when the wall type is refused, rather than losing the work", async () => {
    // A type that is gone, or belongs to another company. The measurements are
    // on the sheet, in the list and postable by hand — exactly where the old
    // flow left every accepted group — and the refusal says what went wrong.
    // Silently discarding a traced group because a type lookup failed would be
    // the worst of both.
    await freshJob();
    const body = new FormData();
    body.set("pageId", pageId);
    body.set("label", "W9 wall");
    body.set("wallTypeId", "wt_does_not_exist");
    body.append("shape", JSON.stringify({ xs: [0.1, 0.3], ys: [0.2, 0.2] }));

    const result = await saveTakeoffMeasurements(jobId, body);
    expect(result.ok, "a missing wall type must refuse, not throw").toBe(false);

    const measurements = await prisma.takeoffMeasurement.findMany({ where: { pageId } });
    expect(measurements.some((one) => one.label === "W9 wall"), "the traced group was discarded").toBe(true);
    expect(await prisma.wallRun.count({ where: { jobId } })).toBe(0);
    // NOT marked posted, so it can be posted by hand without the dead end #719
    // fixed.
    const made = measurements.find((one) => one.label === "W9 wall");
    expect(made?.postedAt, "left marked posted with nothing on the estimate").toBeNull();
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
