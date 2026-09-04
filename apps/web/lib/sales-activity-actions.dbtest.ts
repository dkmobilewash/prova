import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The sales CRM's actions against a real Postgres.
 *
 * `.dbtest.ts` — run against a SCRATCH database:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * lib/sales-activity.test.ts proves the deciding half with hand-built
 * inputs. Three things it cannot touch, and all three are the kind that
 * only fail in production:
 *
 *  - THE GATE. assertSalesAccess is two checks — isProvaOperator and
 *    role === "OWNER" — and until this file existed neither had ever been
 *    executed against a company where they were false. There is one user
 *    on the real account, so the browser can only ever exercise the
 *    passing branch.
 *  - THE FK. SalesActivity.leadId is RESTRICT, so deleteSalesLead's guard
 *    is the only thing between a person and a raw constraint error. A
 *    guard that counts the wrong relation typechecks perfectly.
 *  - TENANT SCOPING. Every action looks up by id and then compares
 *    companyId. That comparison is invisible to a unit test.
 */

const context = {
  company: { id: "", isProvaOperator: true },
  id: "",
  role: "OWNER" as string,
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  createSalesActivity,
  createSalesLead,
  createSalesOpportunity,
  deleteSalesActivity,
  deleteSalesLead,
  updateSalesActivity,
} = await import("./actions/sales");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

/** The operator company, its owner, and a plain member of the same. */
let operatorCompanyId = "";
let ownerUserId = "";
let memberUserId = "";
/** A second, ordinary tenant — not the Prova operator. */
let otherCompanyId = "";
let otherOwnerUserId = "";

function asOwner() {
  context.company = { id: operatorCompanyId, isProvaOperator: true };
  context.id = ownerUserId;
  context.role = "OWNER";
}

describe("the sales CRM's actions against real rows", () => {
  beforeAll(async () => {
    const operator = await prisma.company.create({
      data: { name: "Prova (operator)", isProvaOperator: true },
    });
    operatorCompanyId = operator.id;

    const owner = await prisma.user.create({
      data: {
        companyId: operator.id,
        clerkId: `sales-owner-${Date.now()}`,
        email: `sales-owner-${Date.now()}@example.test`,
        name: "Sales Owner",
        role: "OWNER",
      },
    });
    ownerUserId = owner.id;

    const member = await prisma.user.create({
      data: {
        companyId: operator.id,
        clerkId: `sales-member-${Date.now()}`,
        email: `sales-member-${Date.now()}@example.test`,
        name: "Sales Member",
        role: "MEMBER",
      },
    });
    memberUserId = member.id;

    const other = await prisma.company.create({
      data: { name: "Ordinary Tenant", isProvaOperator: false },
    });
    otherCompanyId = other.id;

    const otherOwner = await prisma.user.create({
      data: {
        companyId: other.id,
        clerkId: `other-owner-${Date.now()}`,
        email: `other-owner-${Date.now()}@example.test`,
        name: "Other Owner",
        role: "OWNER",
      },
    });
    otherOwnerUserId = otherOwner.id;
  });

  afterAll(async () => {
    await prisma.salesActivity.deleteMany({
      where: { companyId: { in: [operatorCompanyId, otherCompanyId] } },
    });
    await prisma.salesOpportunity.deleteMany({
      where: { companyId: { in: [operatorCompanyId, otherCompanyId] } },
    });
    await prisma.salesLead.deleteMany({
      where: { companyId: { in: [operatorCompanyId, otherCompanyId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerUserId, memberUserId, otherOwnerUserId] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [operatorCompanyId, otherCompanyId] } },
    });
  });

  beforeEach(() => {
    asOwner();
  });

  async function makeLead(companyName: string) {
    const before = await prisma.salesLead.findMany({ select: { id: true } });
    const result = await createSalesLead(form({ companyName }));
    expect(result).toEqual({ ok: true });
    const after = await prisma.salesLead.findFirst({
      where: { companyName, id: { notIn: before.map((row) => row.id) } },
    });
    if (!after) throw new Error("lead was not created");
    return after;
  }

  describe("the gate", () => {
    it("tells an ordinary tenant's owner the thing is not found, not that it is forbidden", async () => {
      context.company = { id: otherCompanyId, isProvaOperator: false };
      context.id = otherOwnerUserId;
      context.role = "OWNER";

      const result = await createSalesLead(form({ companyName: "Should Not Exist" }));
      expect(result).toEqual({ ok: false, error: "Not found" });
      expect(await prisma.salesLead.count({ where: { companyId: otherCompanyId } })).toBe(0);
    });

    it("refuses a MEMBER at the operator company, and says why", async () => {
      context.company = { id: operatorCompanyId, isProvaOperator: true };
      context.id = memberUserId;
      context.role = "MEMBER";

      const result = await createSalesLead(form({ companyName: "Member Attempt" }));
      expect(result).toEqual({
        ok: false,
        error: "Only the account owner can use the sales CRM",
      });
      expect(
        await prisma.salesLead.count({ where: { companyName: "Member Attempt" } }),
      ).toBe(0);
    });

    it("refuses a MEMBER on the write paths too, not only on create", async () => {
      const lead = await makeLead("Gate Check Drywall");
      context.role = "MEMBER";
      context.id = memberUserId;

      const result = await createSalesActivity(
        lead.id,
        form({ type: "CALL", occurredOn: "2026-09-01", summary: "should not land" }),
      );
      expect(result).toEqual({
        ok: false,
        error: "Only the account owner can use the sales CRM",
      });
      expect(await prisma.salesActivity.count({ where: { leadId: lead.id } })).toBe(0);
    });
  });

  describe("deleteSalesLead's guard against the RESTRICT foreign key", () => {
    it("refuses a lead that has activities and no opportunities, naming the activities", async () => {
      const lead = await makeLead("Logged But No Deals");
      expect(
        await createSalesActivity(
          lead.id,
          form({ type: "CALL", occurredOn: "2026-09-01", summary: "intro call" }),
        ),
      ).toEqual({ ok: true });

      const result = await deleteSalesLead(lead.id);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toContain("1 logged activity");
      // Never "0 opportunities and 1 logged activity".
      expect(result.error).not.toContain("0 ");
      expect(await prisma.salesLead.count({ where: { id: lead.id } })).toBe(1);
    });

    it("names both when both exist, and pluralises each", async () => {
      const lead = await makeLead("Both Kinds Of History");
      await createSalesOpportunity(lead.id, form({ stage: "NEW", stageEffectiveOn: "2026-08-01" }));
      await createSalesOpportunity(lead.id, form({ stage: "TRIAL", stageEffectiveOn: "2026-08-10" }));
      await createSalesActivity(
        lead.id,
        form({ type: "DEMO", occurredOn: "2026-09-01", summary: "demo" }),
      );

      const result = await deleteSalesLead(lead.id);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error).toContain("2 opportunities");
      expect(result.error).toContain("1 logged activity");
    });

    it("deletes a lead with no history at all", async () => {
      const lead = await makeLead("Nothing On File");
      expect(await deleteSalesLead(lead.id)).toEqual({ ok: true });
      expect(await prisma.salesLead.count({ where: { id: lead.id } })).toBe(0);
    });
  });

  describe("what an activity may point at", () => {
    it("refuses an opportunity belonging to a different lead", async () => {
      const mine = await makeLead("My Lead");
      const theirs = await makeLead("Someone Else's Lead");
      await createSalesOpportunity(theirs.id, form({ stage: "NEW", stageEffectiveOn: "2026-08-01" }));
      const foreign = await prisma.salesOpportunity.findFirstOrThrow({
        where: { leadId: theirs.id },
      });

      const result = await createSalesActivity(
        mine.id,
        form({
          type: "CALL",
          occurredOn: "2026-09-01",
          summary: "misattributed",
          opportunityId: foreign.id,
        }),
      );
      expect(result).toEqual({
        ok: false,
        error: "That opportunity is not one of this lead's",
      });
      expect(await prisma.salesActivity.count({ where: { leadId: mine.id } })).toBe(0);
    });

    it("refuses a follow-up dated before the activity it follows up on", async () => {
      const lead = await makeLead("Backwards Dates");
      // Both dates in the past: this test is about the ORDER of the two,
      // and a future occurredOn would be refused by a different guard.
      const result = await createSalesActivity(
        lead.id,
        form({
          type: "CALL",
          occurredOn: "2026-08-10",
          summary: "called",
          followUpOn: "2026-08-01",
        }),
      );
      expect(result).toEqual({
        ok: false,
        error: "The follow-up date is before the activity it follows up on",
      });
    });

    it("refuses an activity dated in the future, and stores nothing", async () => {
      // Computed from the clock, not hardcoded: a fixed date stops being
      // in the future the moment it arrives.
      const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      const lead = await makeLead("Future Dated");

      const result = await createSalesActivity(
        lead.id,
        form({ type: "NOTE", occurredOn: inFiveDays, summary: "next week's thought" }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toContain("in the future");
      expect(await prisma.salesActivity.count({ where: { leadId: lead.id } })).toBe(0);
    });

    it("refuses an EDIT that moves an activity into the future", async () => {
      const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      const lead = await makeLead("Edited Into The Future");
      await createSalesActivity(
        lead.id,
        form({ type: "CALL", occurredOn: "2026-08-10", summary: "called" }),
      );
      const activity = await prisma.salesActivity.findFirstOrThrow({ where: { leadId: lead.id } });

      const result = await updateSalesActivity(
        activity.id,
        form({ type: "CALL", occurredOn: inFiveDays, summary: "called" }),
      );
      expect(result.ok).toBe(false);

      const unchanged = await prisma.salesActivity.findFirstOrThrow({ where: { id: activity.id } });
      expect(unchanged.occurredOn.toISOString().slice(0, 10)).toBe("2026-08-10");
    });

    it("accepts an activity dated today", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const lead = await makeLead("Dated Today");
      expect(
        await createSalesActivity(
          lead.id,
          form({ type: "CALL", occurredOn: today, summary: "spoke this morning" }),
        ),
      ).toEqual({ ok: true });
    });

    it("stores the date entered, at UTC midnight, and records who logged it", async () => {
      const lead = await makeLead("Dates And Author");
      await createSalesActivity(
        lead.id,
        form({ type: "EMAIL", occurredOn: "2026-08-25", summary: "sent pricing" }),
      );
      const activity = await prisma.salesActivity.findFirstOrThrow({
        where: { leadId: lead.id },
      });
      expect(activity.occurredOn.toISOString()).toBe("2026-08-25T00:00:00.000Z");
      expect(activity.loggedByUserId).toBe(ownerUserId);
      expect(activity.followUpOn).toBeNull();
    });
  });

  describe("tenant scoping", () => {
    it("will not let another company's owner touch an activity by id", async () => {
      const lead = await makeLead("Scoping Test");
      await createSalesActivity(
        lead.id,
        form({ type: "CALL", occurredOn: "2026-09-01", summary: "ours" }),
      );
      const activity = await prisma.salesActivity.findFirstOrThrow({
        where: { leadId: lead.id },
      });

      // The other company is not the operator, so it is stopped at the
      // gate. Make it one for this assertion, so what is being tested is
      // the companyId comparison itself rather than the gate a second time.
      context.company = { id: otherCompanyId, isProvaOperator: true };
      context.id = otherOwnerUserId;
      context.role = "OWNER";

      expect(
        await updateSalesActivity(
          activity.id,
          form({ type: "NOTE", occurredOn: "2026-09-02", summary: "hijacked" }),
        ),
      ).toEqual({ ok: false, error: "Activity not found" });
      expect(await deleteSalesActivity(activity.id)).toEqual({
        ok: false,
        error: "Activity not found",
      });

      const unchanged = await prisma.salesActivity.findFirstOrThrow({
        where: { id: activity.id },
      });
      expect(unchanged.summary).toBe("ours");
      expect(unchanged.type).toBe("CALL");
    });

    it("will not let another company's owner delete a lead by id", async () => {
      const lead = await makeLead("Not Yours To Delete");
      context.company = { id: otherCompanyId, isProvaOperator: true };
      context.id = otherOwnerUserId;
      context.role = "OWNER";

      expect(await deleteSalesLead(lead.id)).toEqual({ ok: false, error: "Lead not found" });
      expect(await prisma.salesLead.count({ where: { id: lead.id } })).toBe(1);
    });
  });
});
