import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * loadBidPipeline against a real Postgres.
 *
 * The unit tests cover the deciding with hand-written inputs. These cover
 * the conversion nothing else executes: bidAmount arrives as a Prisma
 * Decimal and dueDate as a Date, and both have to come out as the number
 * and the UTC-midnight ISO day the pure module expects.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadBidPipeline } = await import("./bid-pipeline-query");

let companyId = "";
let gcId = "";
let quietId = "";

const TODAY = "2026-09-03";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Pipeline Test Co" } });
  companyId = company.id;

  const gc = await prisma.contact.create({ data: { companyId, name: "Busy GC" } });
  gcId = gc.id;
  const quiet = await prisma.contact.create({ data: { companyId, name: "Never Invites Us" } });
  quietId = quiet.id;

  await prisma.bidInvitation.createMany({
    data: [
      // won, priced
      { companyId, contactId: gcId, projectName: "Tower A", status: "WON", bidAmount: "120000.50" },
      // won, NOT priced -- the one that makes the total a floor
      { companyId, contactId: gcId, projectName: "Tower B", status: "WON" },
      { companyId, contactId: gcId, projectName: "Tower C", status: "LOST", bidAmount: "90000" },
      // declined must not read as a loss
      { companyId, contactId: gcId, projectName: "Tower D", status: "DECLINED" },
      // live and past its date
      {
        companyId,
        contactId: gcId,
        projectName: "Tower E",
        status: "SUBMITTED",
        dueDate: new Date("2026-08-01T00:00:00.000Z"),
      },
      // live with no date given
      { companyId, contactId: gcId, projectName: "Tower F", status: "INVITED" },
    ],
  });
});

afterAll(async () => {
  await prisma.bidInvitation.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe("loadBidPipeline against a real database", () => {
  it("turns a Decimal bidAmount into a number, cents intact", async () => {
    const { rows } = await loadBidPipeline(companyId, TODAY);
    const gc = rows.find((r) => r.contactId === gcId);

    // 120000.50 and one won bid with no amount at all.
    expect(gc?.record.valueWon).toBe(120000.5);
    expect(gc?.record.valueWonUnpriced).toBe(1);
  });

  it("does not count the declined invitation as a loss", async () => {
    const { rows } = await loadBidPipeline(companyId, TODAY);
    const gc = rows.find((r) => r.contactId === gcId);

    expect(gc?.record.won).toBe(2);
    expect(gc?.record.lost).toBe(1);
    expect(gc?.record.declined).toBe(1);
    expect(gc?.record.winRate).toBeCloseTo(2 / 3);
  });

  it("converts a Date dueDate to a UTC-midnight ISO day and flags it overdue", async () => {
    const { live } = await loadBidPipeline(companyId, TODAY);
    const towerE = live.find((b) => b.projectName === "Tower E");

    expect(towerE?.dueDate).toBe("2026-08-01");
    expect(towerE?.overdue).toBe(true);
  });

  it("never invents a deadline for a bid the GC gave none for", async () => {
    const { live } = await loadBidPipeline(companyId, TODAY);
    const towerF = live.find((b) => b.projectName === "Tower F");

    expect(towerF?.dueDate).toBeNull();
    expect(towerF?.overdue).toBe(false);
  });

  it("lists only live bids as outstanding, and sorts a dateless one last", async () => {
    const { live } = await loadBidPipeline(companyId, TODAY);

    expect(live.map((b) => b.projectName)).toEqual(["Tower E", "Tower F"]);
  });

  it("leaves out a contact who has never been invited to bid", async () => {
    const { rows } = await loadBidPipeline(companyId, TODAY);

    expect(rows.some((r) => r.contactId === quietId)).toBe(false);
  });

  it("is scoped to the company", async () => {
    const other = await prisma.company.create({ data: { name: "Someone Else" } });
    const { rows } = await loadBidPipeline(other.id, TODAY);
    await prisma.company.delete({ where: { id: other.id } });

    expect(rows).toEqual([]);
  });
});
