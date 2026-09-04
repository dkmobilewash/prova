import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Stage history written by the opportunity actions, against a real Postgres.
 *
 * lib/sales-stage-history.test.ts proves the reading half with hand-built
 * inputs. Three things it cannot touch:
 *
 *  - THAT A MOVE IS ONLY RECORDED WHEN THE STAGE ACTUALLY MOVES. Writing a
 *    row on every save would reset every deal's time-in-stage to zero the
 *    moment somebody corrected its MRR — silently, and to a plausible
 *    number. This is the assertion the whole feature rests on.
 *  - THAT THE TRANSACTION ROLLS BACK. A refused move must leave the
 *    opportunity's own fields untouched too, not just skip the history row.
 *  - THAT DELETING AN OPPORTUNITY TAKES ITS HISTORY. onDelete: Cascade is
 *    a schema claim; this executes it.
 */

const context = {
  company: { id: "", isProvaOperator: true },
  id: "",
  role: "OWNER" as string,
};

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  createSalesLead,
  createSalesOpportunity,
  deleteSalesOpportunity,
  updateSalesOpportunity,
} = await import("./actions/sales");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

let companyId = "";
let userId = "";
let leadId = "";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("stage history written by the opportunity actions", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: "Prova (stage history)", isProvaOperator: true },
    });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `stage-owner-${Date.now()}`,
        email: `stage-owner-${Date.now()}@example.test`,
        name: "Stage Owner",
        role: "OWNER",
      },
    });
    userId = user.id;

    context.company = { id: companyId, isProvaOperator: true };
    context.id = userId;

    await createSalesLead(form({ companyName: "Stage History Drywall" }));
    const lead = await prisma.salesLead.findFirstOrThrow({ where: { companyId } });
    leadId = lead.id;
  });

  afterAll(async () => {
    await prisma.salesStageChange.deleteMany({ where: { companyId } });
    await prisma.salesActivity.deleteMany({ where: { companyId } });
    await prisma.salesOpportunity.deleteMany({ where: { companyId } });
    await prisma.salesLead.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  beforeEach(() => {
    context.company = { id: companyId, isProvaOperator: true };
    context.id = userId;
    context.role = "OWNER";
  });

  async function newOpportunity(stage: string, reachedOn: string) {
    const before = await prisma.salesOpportunity.findMany({ select: { id: true } });
    const result = await createSalesOpportunity(
      leadId,
      form({ stage, stageEffectiveOn: reachedOn }),
    );
    expect(result).toEqual({ ok: true });
    return prisma.salesOpportunity.findFirstOrThrow({
      where: { leadId, id: { notIn: before.map((r) => r.id) } },
    });
  }

  const changesFor = (opportunityId: string) =>
    prisma.salesStageChange.findMany({
      where: { opportunityId },
      orderBy: [{ effectiveOn: "asc" }, { recordedAt: "asc" }],
    });

  it("opens the history with one record, with no fromStage and the date entered", async () => {
    const opportunity = await newOpportunity("NEW", "2026-08-01");
    const changes = await changesFor(opportunity.id);

    expect(changes).toHaveLength(1);
    expect(changes[0].fromStage).toBeNull();
    expect(changes[0].toStage).toBe("NEW");
    // Entered, not stamped: the date given, at UTC midnight.
    expect(changes[0].effectiveOn.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(changes[0].recordedByUserId).toBe(userId);
  });

  it("records NOTHING when the stage does not change", async () => {
    const opportunity = await newOpportunity("TRIAL", "2026-08-01");

    const result = await updateSalesOpportunity(
      opportunity.id,
      form({ stage: "TRIAL", estimatedMrr: "450", stageEffectiveOn: "2026-09-01" }),
    );
    expect(result).toEqual({ ok: true });

    const changes = await changesFor(opportunity.id);
    expect(changes).toHaveLength(1);
    // Still the opening date. A second row here would reset the deal's
    // time-in-stage to zero for an edit that was not a move.
    expect(iso(changes[0].effectiveOn)).toBe("2026-08-01");

    const saved = await prisma.salesOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(saved.estimatedMrr?.toString()).toBe("450");
  });

  it("records the move, with the stage it came from, when the stage changes", async () => {
    const opportunity = await newOpportunity("NEW", "2026-08-01");

    expect(
      await updateSalesOpportunity(
        opportunity.id,
        form({ stage: "DEMO_SCHEDULED", stageEffectiveOn: "2026-08-14", stageNote: "booked for the 14th" }),
      ),
    ).toEqual({ ok: true });

    const changes = await changesFor(opportunity.id);
    expect(changes).toHaveLength(2);
    expect(changes[1].fromStage).toBe("NEW");
    expect(changes[1].toStage).toBe("DEMO_SCHEDULED");
    expect(iso(changes[1].effectiveOn)).toBe("2026-08-14");
    expect(changes[1].note).toBe("booked for the 14th");
  });

  it("refuses a move dated before the previous one AND rolls back the whole save", async () => {
    const opportunity = await newOpportunity("NEW", "2026-08-20");

    const result = await updateSalesOpportunity(
      opportunity.id,
      form({ stage: "TRIAL", estimatedMrr: "999", stageEffectiveOn: "2026-08-01" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("2026-08-20");

    const changes = await changesFor(opportunity.id);
    expect(changes).toHaveLength(1);

    // The transaction is the point: the stage and the MRR must BOTH be
    // untouched. Skipping only the history row would leave the deal in
    // TRIAL with a history saying NEW.
    const saved = await prisma.salesOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(saved.stage).toBe("NEW");
    expect(saved.estimatedMrr).toBeNull();
  });

  it("allows a move dated the same day as the previous one", async () => {
    const opportunity = await newOpportunity("NEW", "2026-08-20");
    expect(
      await updateSalesOpportunity(
        opportunity.id,
        form({ stage: "CONTACTED", stageEffectiveOn: "2026-08-20" }),
      ),
    ).toEqual({ ok: true });
    expect(await changesFor(opportunity.id)).toHaveLength(2);
  });

  it("refuses a stage change with no date rather than stamping one", async () => {
    const opportunity = await newOpportunity("NEW", "2026-08-01");

    const result = await updateSalesOpportunity(opportunity.id, form({ stage: "WON" }));
    expect(result).toEqual({ ok: false, error: "The date it moved is required" });

    const saved = await prisma.salesOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(saved.stage).toBe("NEW");
    expect(await changesFor(opportunity.id)).toHaveLength(1);
  });

  it("takes the history with the opportunity when it is deleted", async () => {
    const opportunity = await newOpportunity("NEW", "2026-08-01");
    await updateSalesOpportunity(
      opportunity.id,
      form({ stage: "LOST", stageEffectiveOn: "2026-08-05" }),
    );
    expect(await changesFor(opportunity.id)).toHaveLength(2);

    expect(await deleteSalesOpportunity(opportunity.id)).toEqual({ ok: true });
    expect(await changesFor(opportunity.id)).toHaveLength(0);
  });

  it("is closed to a member of the operator company, like every other write here", async () => {
    const opportunity = await newOpportunity("NEW", "2026-08-01");
    context.role = "MEMBER";

    const result = await updateSalesOpportunity(
      opportunity.id,
      form({ stage: "WON", stageEffectiveOn: "2026-08-30" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Only the account owner can use the sales CRM",
    });
    expect(await changesFor(opportunity.id)).toHaveLength(1);
  });
});
