import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The openings setting moves the BOARD QUANTITY on an estimate line, against a
 * real Postgres.
 *
 * ── WHY THIS FILE EXISTS, AND IT IS NOT BELT-AND-BRACES ──
 *
 * The setting shipped with unit tests on the resolver and a census on the
 * wiring, and a click-through could not test the thing that matters: the step
 * was "change the setting, re-save a wall run, watch the drywall area drop",
 * and there was NO WALL RUN ANYWHERE to try it on. Twenty jobs on the live
 * account, fourteen with an empty wall schedule and six with none at all. So
 * the single claim the whole feature rests on — that answering this question
 * changes what a sub charges — had never been executed by anything.
 *
 * The alternative was creating a test wall run on the production database. This
 * repo's own rule, learned on the payroll export: when a check needs real rows
 * to say anything, GROW THE FIXTURE rather than reaching for production. A
 * fixture gets checked on every CI run; a row somebody typed into production
 * gets checked once and then lives there.
 *
 * ── WHY IT NEEDS A DATABASE ──
 *
 * `boardedArea`'s arithmetic is pure and already tested in
 * `openingDeduction.test.ts`. The claim HERE is that the company's stored
 * answer reaches it: `loadWallSchedule` reads the `Company` row, resolves a
 * threshold, hands it to `scheduleLines`, and `syncWallScheduleLines` writes
 * the quantity onto a `JobLineItem`. Every link in that is a row. A fake client
 * would only prove the fake behaves as I expect — and in fact the fakes in the
 * ordinary suite had to be TAUGHT about `company.findUnique` when this landed,
 * which is precisely the kind of agreement-with-myself this file avoids.
 *
 * NOT RUN LOCALLY by the session that wrote it: there is no Postgres and no
 * Docker on this machine, so it was written against the schema and is executed
 * by CI's `dbtest` job (postgres:16). Said plainly, because "I wrote a test"
 * and "a test ran" are different claims.
 *
 * Named `.dbtest.ts` so the ordinary suite does not collect it. Runs against a
 * SCRATCH database — `vitest.db.setup.mts` refuses anything that is not
 * localhost or a unix socket.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { syncWallScheduleLines } = await import("@/lib/estimating/wall-schedule");

let companyId = "";
let jobId = "";
let componentId = "";

/** A 20ft x 10ft wall, boarded both sides, with one 3'-0" x 7'-0" door. */
const WALL_LENGTH_FT = 20;
const WALL_HEIGHT_FT = 10;
const SIDES = 2;
const DOOR_SQFT = 3 * 7; // 21 — deliberately UNDER the 32 sq ft default
const GROSS_SQFT = WALL_LENGTH_FT * WALL_HEIGHT_FT * SIDES; // 400

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Opening Deduction Test Co" } });
  companyId = company.id;
  context.company.id = companyId;

  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Opening Deduction Job", status: "ESTIMATE" },
  });
  jobId = job.id;

  const wallType = await prisma.wallType.create({
    data: { companyId, code: "A1", name: "Partition, board both sides", defaultHeightFt: "10", sides: SIDES },
  });
  const component = await prisma.wallTypeComponent.create({
    data: {
      wallTypeId: wallType.id,
      description: '5/8" Type X board',
      // BOARDED_SQFT is the basis that reads `boardedArea`, which is the whole
      // subject of this file. A LINEAR_FT component would be unmoved by the
      // setting and the test would pass without proving anything.
      basis: "BOARDED_SQFT",
      unit: "SF",
    },
  });
  componentId = component.id;

  await prisma.wallRun.create({
    data: {
      companyId,
      jobId,
      wallTypeId: wallType.id,
      label: "Corridor 101",
      lengthFt: String(WALL_LENGTH_FT),
      heightFt: String(WALL_HEIGHT_FT),
      // The door. Typed openings are what `boardedArea` deducts, above the
      // threshold the company's answer sets.
      openings: [{ widthFt: 3, heightFt: 7 }],
    },
  });
});

afterAll(async () => {
  // Children first — the counter rows and RESTRICT parents this repo has a scar
  // about are per-JOB, so the job goes last.
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.wallRun.deleteMany({ where: { jobId } });
  await prisma.wallTypeComponent.deleteMany({ where: { wallType: { companyId } } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

/** Re-sync the schedule and read back the board line's quantity. */
async function quantityAfterSync(): Promise<number> {
  await prisma.$transaction(async (tx) => {
    await syncWallScheduleLines(tx, companyId, jobId);
  });
  const line = await prisma.jobLineItem.findFirst({
    where: { jobId, wallTypeComponentId: componentId, isDeleted: false },
    select: { quantity: true },
  });
  // Null would make every assertion below compare undefined to undefined and
  // pass vacuously, so it is an explicit failure instead.
  expect(line, "the sync wrote a board line").not.toBeNull();
  return Number(line?.quantity);
}

async function setAnswer(answer: "NONE" | "LARGE_ONLY" | "ALL" | null, sqFt: number | null = null) {
  await prisma.company.update({
    where: { id: companyId },
    data: { openingDeduction: answer, openingDeductionSqFt: sqFt },
  });
}

describe("the company's openings answer reaches the estimate line", () => {
  it("UNANSWERED bills the wall gross, which is what every existing company gets", async () => {
    // The safety of the whole change. A company that has never seen the
    // question must be quantified exactly as before it existed: 32 sq ft
    // threshold, so a 21 sq ft door is not deducted.
    await setAnswer(null);
    expect(await quantityAfterSync(), "20 x 10 x 2 sides, door not deducted").toBe(GROSS_SQFT);
  });

  it("ALL takes the door off BOTH sides", async () => {
    await setAnswer("ALL");
    // 21 sq ft per face, two faces. The per-side half matters: a hole goes
    // through the wall, and deducting it once is a real bug this pins.
    expect(await quantityAfterSync()).toBe(GROSS_SQFT - DOOR_SQFT * SIDES);
  });

  it("NONE and LARGE_ONLY both leave a door alone, for different reasons", async () => {
    // NONE deducts nothing ever. LARGE_ONLY deducts over 32 sq ft and this door
    // is 21, so they agree HERE and must not be assumed identical — the
    // storefront case below is what separates them.
    await setAnswer("NONE");
    expect(await quantityAfterSync()).toBe(GROSS_SQFT);
    await setAnswer("LARGE_ONLY");
    expect(await quantityAfterSync()).toBe(GROSS_SQFT);
  });

  it("LARGE_ONLY deducts a storefront where NONE does not", async () => {
    // 10ft x 8ft is 80 sq ft, over the threshold. Without this case the two
    // answers would be indistinguishable in this file and one of them could be
    // a dead option with every test green.
    const storefront = { widthFt: 10, heightFt: 8 };
    const storefrontSqFt = storefront.widthFt * storefront.heightFt;
    await prisma.wallRun.updateMany({ where: { jobId }, data: { openings: [storefront] } });

    await setAnswer("LARGE_ONLY");
    expect(await quantityAfterSync()).toBe(GROSS_SQFT - storefrontSqFt * SIDES);
    await setAnswer("NONE");
    expect(await quantityAfterSync()).toBe(GROSS_SQFT);

    // Put the door back, so the order these run in cannot change what they mean.
    await prisma.wallRun.updateMany({ where: { jobId }, data: { openings: [{ widthFt: 3, heightFt: 7 }] } });
  });

  it("THE SHOP'S OWN THRESHOLD reaches the quantity, as a Decimal from Postgres", async () => {
    // ── "32 OR 50 SQUARE FEET", and 50 has to actually work ──
    //
    // This is the case the pure test cannot prove: the figure is a
    // DECIMAL(6,2) column, so it arrives as a Prisma Decimal object, and the
    // resolver compares it with `> 0`. A Decimal passed straight through is
    // not a number — `Number()` at the boundary is the whole reason this case
    // exists, and a fake client returning a plain number would have hidden it.
    const storefront = { widthFt: 6, heightFt: 7 }; // 42 sq ft
    const storefrontSqFt = storefront.widthFt * storefront.heightFt;
    await prisma.wallRun.updateMany({ where: { jobId }, data: { openings: [storefront] } });

    // 42 is OVER our 32 default, so the default would deduct it...
    await setAnswer("LARGE_ONLY", null);
    expect(await quantityAfterSync()).toBe(GROSS_SQFT - storefrontSqFt * SIDES);

    // ...and UNDER a shop's 50, so that same opening must survive. Chosen so
    // the two thresholds give different answers on one opening — a size that
    // both agreed on would pass whether the number reached the quantity or not.
    await setAnswer("LARGE_ONLY", 50);
    expect(await quantityAfterSync(), "42 sq ft is not 'big' to a shop on 50").toBe(GROSS_SQFT);

    await prisma.wallRun.updateMany({ where: { jobId }, data: { openings: [{ widthFt: 3, heightFt: 7 }] } });
  });

  it("a figure left on a company does NOT move an unanswered one", async () => {
    // The safety case for the new column. A shop that typed 50, then cleared
    // its answer, must be quantified exactly as a company that never saw any of
    // this — the threshold belongs to the LARGE_ONLY answer alone.
    await setAnswer(null, 50);
    expect(await quantityAfterSync()).toBe(GROSS_SQFT);
  });

  it("changing the answer RE-QUANTIFIES an existing line rather than adding one", async () => {
    // The click-list step this replaces was "re-save the run and watch the
    // number change". If a second line appeared instead, a bid would double-
    // count the board and every quantity assertion above would still pass.
    await setAnswer("ALL");
    await quantityAfterSync();
    await setAnswer(null);
    const quantity = await quantityAfterSync();

    const lines = await prisma.jobLineItem.findMany({
      where: { jobId, wallTypeComponentId: componentId, isDeleted: false },
    });
    expect(lines, "one board line, updated in place").toHaveLength(1);
    expect(quantity, "and back to gross").toBe(GROSS_SQFT);
  });
});
