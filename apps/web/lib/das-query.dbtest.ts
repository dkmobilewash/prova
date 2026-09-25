import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";

/**
 * The SEAM between the DAS fetching and the DAS deciding, against a real
 * Postgres — which is the half nothing else executes.
 *
 * `das-forms.test.ts` proves what `dasProposals` does with the values it is
 * handed. Every one of those is a literal. The defects an adversarial review
 * found on this branch were all about which values arrive: a craft joined by
 * NAME when an id existed for it, notices keyed on the craft rather than the
 * committee, and an untagged-hours pseudo-row going in as though it were a
 * craft. Those live between `loadJobCraftHours` and `dasProposals`, so this
 * walks the two together over rows a database actually returned.
 *
 * The committee's `craftName` is deliberately NOT what the classification is
 * called, because that is the normal case (`das-forms.prisma` says so) and it
 * is what a name match gets wrong.
 */

const { loadJobCraftHours, loadApprenticeshipCommittees } = await import("./das-query");
const { dasProposals } = await import("./das-forms");

let companyId = "";
let jobId = "";
let craftId = "";
let apprenticeCraftId = "";
let otherCraftId = "";
let committeeId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "DAS Query Test Co" } });
  companyId = company.id;

  const stamp = Date.now();
  const worker = await prisma.user.create({
    data: {
      companyId,
      clerkId: `das_${stamp}`,
      email: `das_${stamp}@example.test`,
      name: "Pat Hanger",
      role: "MEMBER",
    },
  });
  const local = await prisma.unionLocal.create({
    data: {
      companyId,
      parentInternational: "United Brotherhood of Carpenters",
      localNumber: "2361",
      jurisdictionName: "Fresno",
    },
  });
  const craft = await prisma.craftClassification.create({
    data: { companyId, unionLocalId: local.id, name: "Drywall Finisher", tier: "JOURNEYMAN" },
  });
  craftId = craft.id;
  // The SAME trade's apprentice tier. `(unionLocalId, name)` is unique, so this
  // is a SEPARATE classification row under the same local — which is why the
  // committee is matched on the local and not on the classification.
  const apprenticeCraft = await prisma.craftClassification.create({
    data: { companyId, unionLocalId: local.id, name: "Drywall Apprentice", tier: "APPRENTICE" },
  });
  apprenticeCraftId = apprenticeCraft.id;
  // A SECOND local holding a classification of the SAME NAME. Unique per local,
  // so this is the only way one company has two crafts called the same thing —
  // and grouping the job's hours by name would merge them into one row.
  const otherLocal = await prisma.unionLocal.create({
    data: {
      companyId,
      parentInternational: "IUPAT",
      localNumber: "294",
      jurisdictionName: "Fresno",
    },
  });
  const otherCraft = await prisma.craftClassification.create({
    data: { companyId, unionLocalId: otherLocal.id, name: "Drywall Finisher", tier: "JOURNEYMAN" },
  });
  otherCraftId = otherCraft.id;

  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Clovis High Gym", publicWorks: true },
  });
  jobId = job.id;

  await prisma.timeEntry.createMany({
    data: [
      // Tagged, journeyman.
      {
        jobId,
        employeeUserId: worker.id,
        date: new Date("2026-09-02T00:00:00.000Z"),
        hours: "8",
        craftClassificationId: craftId,
      },
      // Tagged, apprentice tier of the SAME trade.
      {
        jobId,
        employeeUserId: worker.id,
        date: new Date("2026-09-03T00:00:00.000Z"),
        hours: "4",
        craftClassificationId: apprenticeCraft.id,
      },
      // Another local's craft, with the same NAME as the first one.
      {
        jobId,
        employeeUserId: worker.id,
        date: new Date("2026-09-05T00:00:00.000Z"),
        hours: "6",
        craftClassificationId: otherCraft.id,
      },
      // Tagged by nobody. The pseudo-row.
      { jobId, employeeUserId: worker.id, date: new Date("2026-09-04T00:00:00.000Z"), hours: "2.5" },
    ],
  });

  const committee = await prisma.apprenticeshipCommittee.create({
    data: {
      companyId,
      name: "Central Valley Drywall/Lathing JATC",
      // NOT what the classification is called. This is the point.
      craftName: "Drywall/Lathers",
      craftClassificationId: craftId,
      geographicArea: "Fresno, Madera and Kings counties",
      approvedToTrainUs: true,
      addressLine1: "500 Trade Center Dr",
      city: "Fresno",
      state: "CA",
      postalCode: "93706",
    },
  });
  committeeId = committee.id;
});

afterAll(async () => {
  await prisma.das140Notice.deleteMany({ where: { jobId } });
  await prisma.apprenticeshipCommittee.deleteMany({ where: { companyId } });
  await prisma.timeEntry.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.craftClassification.deleteMany({ where: { companyId } });
  await prisma.unionLocal.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

const proposalsNow = async () =>
  dasProposals({
    publicWorks: true,
    contracted: true,
    crafts: await loadJobCraftHours(jobId),
    committees: (await loadApprenticeshipCommittees(companyId)).map((c) => ({
      id: c.id,
      name: c.name,
      craftName: c.craftName,
      craftClassificationId: c.craftClassificationId,
      unionLocalId: c.craftUnionLocalId,
      approvedToTrainUs: c.approvedToTrainUs,
    })),
    notices140: [],
    requests142: [],
    today: "2026-09-20",
  });

describe("what the DAS screens actually hand the rules", () => {
  it("carries the classification id, and a null on the untagged row", async () => {
    const rows = await loadJobCraftHours(jobId);
    const tagged = rows.find((r) => r.craftClassificationId === craftId)!;
    expect(tagged.journeymanHours).toBe(8);
    const untagged = rows.find((r) => r.craftClassificationId === null)!;
    expect(untagged.craftName).toBe("Hours with no craft tag");
    expect(untagged.unclassifiedHours).toBe(2.5);
    expect(untagged.journeymanHours).toBe(0);
  });

  it("keeps two locals' same-named classifications apart, and carries the local", async () => {
    // Grouped by NAME, these two locals' crafts merge into one row and the
    // hours of a trade this company runs under a different agreement are
    // counted towards the first one's notices.
    const rows = await loadJobCraftHours(jobId);
    const sameName = rows.filter((r) => r.craftName === "Drywall Finisher");
    expect(sameName).toHaveLength(2);
    expect(new Set(sameName.map((r) => r.unionLocalId)).size).toBe(2);
    expect(rows.find((r) => r.craftClassificationId === otherCraftId)!.journeymanHours).toBe(6);
  });

  it("carries the apprentice tier as its own row under the same local", async () => {
    const rows = await loadJobCraftHours(jobId);
    const apprentice = rows.find((r) => r.craftClassificationId === apprenticeCraftId)!;
    const journeyman = rows.find((r) => r.craftClassificationId === craftId)!;
    expect(apprentice.apprenticeHours).toBe(4);
    expect(journeyman.apprenticeHours).toBe(0);
    // Same trade, two rows — which is the whole reason the committee is
    // matched on the local rather than on the classification.
    expect(apprentice.unionLocalId).toBe(journeyman.unionLocalId);
  });

  it("proposes the notice for the real trade and NOTHING for the untagged hours", async () => {
    const proposals = await proposalsNow();
    const missing = proposals.filter((p) => p.kind === "DAS140_MISSING");
    // One for the committee's own trade, one for the OTHER local's craft, which
    // no committee is linked to. Not one per classification, and not one for
    // the untagged hours.
    expect(missing).toHaveLength(2);
    const covered = missing.find((p) => p.observed.includes("Central Valley Drywall/Lathing JATC"))!;
    expect(covered.craftName).toContain("Drywall Apprentice");
    expect(missing.some((p) => p.observed.includes("no committee in your directory is linked"))).toBe(
      true,
    );
    // The permanently un-clearable item the review found: an untagged hour
    // cannot owe a notice, because nothing can ever be linked to it.
    expect(missing.some((p) => p.craftName === "Hours with no craft tag")).toBe(false);
    const untagged = proposals.find((p) => p.kind === "HOURS_WITHOUT_CRAFT")!;
    expect(untagged.observed).toContain("2.5");
  });

  it("counts the apprentice tier's hours against the trade the committee covers", async () => {
    // 8 journeyman hours and 4 apprentice hours on the same local. Counted per
    // classification, this trade would be told it has no apprentices on it.
    const proposals = await proposalsNow();
    const dispatch = proposals.filter((p) => p.kind === "DAS142_NO_APPRENTICES");
    expect(dispatch.some((p) => p.craftName.includes("Drywall Apprentice"))).toBe(false);
  });

  it("clears once the notice is recorded, though the two craft names differ", async () => {
    await prisma.das140Notice.create({
      data: {
        jobId,
        committeeId,
        craftName: "Drywall/Lathers",
        election: "APPROVED_TO_TRAIN",
        contractExecutedOn: new Date("2026-09-01T00:00:00.000Z"),
        sentOn: new Date("2026-09-05T00:00:00.000Z"),
      },
    });
    const notices = await prisma.das140Notice.findMany({ where: { jobId } });
    const proposals = dasProposals({
      publicWorks: true,
      contracted: true,
      crafts: await loadJobCraftHours(jobId),
      committees: (await loadApprenticeshipCommittees(companyId)).map((c) => ({
        id: c.id,
        name: c.name,
        craftName: c.craftName,
        craftClassificationId: c.craftClassificationId,
        unionLocalId: c.craftUnionLocalId,
        approvedToTrainUs: c.approvedToTrainUs,
      })),
      notices140: notices.map((n) => ({
        id: n.id,
        committeeId: n.committeeId,
        craftName: n.craftName,
        sentOn: n.sentOn ? n.sentOn.toISOString().slice(0, 10) : null,
      })),
      requests142: [],
      today: "2026-09-20",
    });
    // The committee's own trade is settled; the other local's craft still has
    // nobody linked to it, which is a different fact and stays.
    expect(
      proposals.some(
        (p) => p.kind === "DAS140_MISSING" && p.observed.includes("Central Valley"),
      ),
    ).toBe(false);
    expect(proposals.some((p) => p.kind === "DAS140_UNSENT")).toBe(false);
    // And the untagged hours are still reported, because that is a separate
    // fact from any notice.
    expect(proposals.some((p) => p.kind === "HOURS_WITHOUT_CRAFT")).toBe(true);
  });
});
