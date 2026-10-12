import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Importing a partition schedule into the wall-type library, against a real
 * Postgres.
 *
 * ── WHY THESE TWO CASES NEEDED A DATABASE ──
 *
 * Both were found by mutation and NEITHER could be caught without one, which is
 * the whole argument for this file existing beside the unit tests:
 *
 *   - replacing the proposal's where-clause with `{ id: proposalId }` — a
 *     CROSS-TENANT read — left every test in the repo green. There is nothing
 *     to assert about scoping except that another company's row is not found,
 *     and "not found" needs rows;
 *   - letting a code already in the library through, instead of refusing it,
 *     also left everything green. What stops it is a unique constraint and a
 *     filter, and a constraint is not a value a unit test can inspect.
 *
 * Named `.dbtest.ts` so the ordinary suite does not collect it — CI's unit run
 * has no database. Run against a SCRATCH one:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.mts
 *
 * Only the auth boundary and revalidatePath are faked. The action, Prisma, the
 * transaction and the schema are real.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const { addWallTypesFromSchedule } = await import("./wallTypes");

let companyId = "";
let jobId = "";
let proposalId = "";
let otherCompanyProposalId = "";

/** A partition schedule as the reader stores one: the `rows` Json column. */
const SCHEDULE_ROWS = [
  { mark: "ZZA1", description: '3-5/8" STUD, 5/8" GWB EA SIDE', size: '4 7/8"', quantity: null, notes: "TO 10'-6\" AFF" },
  { mark: "ZZB1", description: '6" STUD', size: '7 1/4"', quantity: null, notes: null },
  { mark: "ZZC1", description: "SEE DETAIL 3/A-501", size: null, quantity: null, notes: null },
];

async function companyWithSchedule(name: string, rows: unknown) {
  const company = await prisma.company.create({ data: { name } });
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
  const job = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: `${name} Job` },
  });
  const plan = await prisma.takeoffPlan.create({
    data: { companyId: company.id, jobId: job.id, fileName: "zz-test-plans.pdf", fileUrl: `https://example.test/${company.id}.pdf` },
  });
  const ingest = await prisma.planIngestJob.create({
    data: { planId: plan.id, companyId: company.id, stage: "SCHEDULE_ROWS", pageCount: 1 },
  });
  const proposal = await prisma.planScheduleProposal.create({
    data: {
      ingestJobId: ingest.id,
      planId: plan.id,
      pageNumber: 1,
      kind: "PARTITION",
      title: "PARTITION TYPES",
      rows: rows as never,
      reason: "Column 1 is the mark, column 3 the thickness.",
      confidence: "HIGH",
      model: "zz-test",
      promptVersion: "schedule-rows.1",
      gridRowCount: 5,
      readRowCount: 3,
    },
  });
  return { companyId: company.id, jobId: job.id, proposalId: proposal.id };
}

describe("a partition schedule becomes wall types, against a real database", () => {
  beforeAll(async () => {
    const mine = await companyWithSchedule("ZZ Partition Import Co", SCHEDULE_ROWS);
    companyId = mine.companyId;
    jobId = mine.jobId;
    proposalId = mine.proposalId;
    context.company.id = companyId;

    // ── DIFFERENT MARKS, AND THAT IS THE WHOLE TEST ──
    //
    // The first version of this gave the other tenant the SAME schedule, and
    // the cross-tenant mutation stayed green: with identical marks the import
    // is refused as "you already have these", so the refusal looked like
    // scoping and was not. A leak has to be visible as rows that could only
    // have come from somebody else's drawing.
    const theirs = await companyWithSchedule("ZZ Other Partition Co", [
      { mark: "ZZTHEIRS1", description: "THEIR WALL", size: '9"', quantity: null, notes: null },
    ]);
    otherCompanyProposalId = theirs.proposalId;
  });

  afterAll(async () => {
    for (const name of ["ZZ Partition Import Co", "ZZ Other Partition Co"]) {
      const company = await prisma.company.findFirst({ where: { name } });
      if (!company) continue;
      await prisma.wallType.deleteMany({ where: { companyId: company.id } });
      await prisma.takeoffPlan.deleteMany({ where: { job: { companyId: company.id } } });
      await prisma.job.deleteMany({ where: { companyId: company.id } });
      await prisma.contact.deleteMany({ where: { companyId: company.id } });
      await prisma.company.delete({ where: { id: company.id } });
    }
  });

  it("writes the types the schedule could be read as, with their thickness", () => {
    return addWallTypesFromSchedule(jobId, proposalId).then(async (result) => {
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
      if (!result.ok) return;
      expect(result.value.added).toEqual(["ZZA1", "ZZB1"]);
      // The row with no readable thickness is REPORTED, not silently dropped.
      // A schedule of three read as two is a wall type quietly missing, and
      // nothing else on the screen would say so.
      expect(result.value.unread).toBe(1);

      const stored = await prisma.wallType.findMany({ where: { companyId }, orderBy: { code: "asc" } });
      expect(stored.map((type) => type.code)).toEqual(["ZZA1", "ZZB1"]);
      expect(Number(stored[0].thicknessIn)).toBeCloseTo(4.88, 2);
      expect(Number(stored[0].defaultHeightFt)).toBeCloseTo(10.5, 2);
      // No height on the sheet means no height stored — never a guessed ten
      // feet, which would quietly become square footage on a bid.
      expect(stored[1].defaultHeightFt).toBeNull();
    });
  });

  it("REFUSES A SECOND IMPORT rather than overwriting what is there", async () => {
    // A tag means different things on different jobs: A1 here is 4⅞in and A1
    // on the next job may be 6in. Updating in place would silently re-price
    // every other job using that type.
    const again = await addWallTypesFromSchedule(jobId, proposalId);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toContain("ZZA1");

    const stored = await prisma.wallType.findMany({ where: { companyId } });
    expect(stored, "a second import duplicated the library").toHaveLength(2);
  });

  it("CANNOT READ ANOTHER COMPANY'S SCHEDULE", async () => {
    // The hole a mutation opened by replacing the where-clause with the bare
    // id. It reads as "not found" rather than as a refusal, which is right —
    // a tenant should not learn that somebody else's proposal exists.
    const result = await addWallTypesFromSchedule(jobId, otherCompanyProposalId);
    expect(result.ok).toBe(false);

    // THE ASSERTION THAT ACTUALLY CATCHES IT. `ok: false` alone does not: when
    // both tenants held the same schedule, the import was refused as a
    // duplicate and the test passed while reading another company's rows. What
    // a leak looks like is a wall type here whose mark exists only there.
    const mine = await prisma.wallType.findMany({ where: { companyId }, select: { code: true } });
    expect(
      mine.map((type) => type.code),
      "a wall type from another company's drawing landed in this library",
    ).not.toContain("ZZTHEIRS1");
  });

  it("refuses a schedule whose rows give no thickness at all", async () => {
    const barren = await companyWithSchedule("ZZ Barren Schedule Co", [
      { mark: "X1", description: "SEE DETAIL", size: null, quantity: null, notes: null },
    ]);
    context.company.id = barren.companyId;
    const result = await addWallTypesFromSchedule(barren.jobId, barren.proposalId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("thickness");
    context.company.id = companyId;

    await prisma.takeoffPlan.deleteMany({ where: { job: { companyId: barren.companyId } } });
    await prisma.job.deleteMany({ where: { companyId: barren.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: barren.companyId } });
    await prisma.company.delete({ where: { id: barren.companyId } });
  });
});
