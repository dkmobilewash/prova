import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { markupNeeded } from "@/lib/trade-presets";
import { loadJobStepFacts } from "@/lib/job-steps-query";

/**
 * The trade preset and the starter markup against a real database: what one
 * tap writes for a NEW company, that an EXISTING company is refused and left
 * exactly as it was, that a second tap writes nothing twice, and that the
 * markup rule the estimate banner and the stepper read follows the figures.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { applyTradePreset, saveStarterMarkup } = await import("./tradePresets");

const made: string[] = [];
async function newCompany(data: { businessScopeAskedAt?: Date } = {}) {
  const company = await prisma.company.create({ data: { name: `Trade Preset ${made.length}`, ...data } });
  const owner = await prisma.user.create({
    data: { companyId: company.id, clerkId: `tp_${company.id}`, email: `tp_${company.id}@example.test`, role: "OWNER" },
  });
  made.push(company.id);
  context.company.id = company.id;
  context.id = owner.id;
  return company.id;
}

function markup(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

afterAll(async () => {
  for (const companyId of made) {
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId } } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.estimateTemplate.deleteMany({ where: { companyId } });
    await prisma.wallType.deleteMany({ where: { companyId } });
    await prisma.companyTradeScope.deleteMany({ where: { companyId } });
    await prisma.companyBidDefaults.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
});

beforeEach(() => {
  context.role = "OWNER";
});

describe("applyTradePreset", () => {
  it("fireproofing: scopes, FP1/FP2, the switches Diego set, a starter template — and no markup", async () => {
    const companyId = await newCompany();
    expect(await applyTradePreset("FIREPROOFING")).toEqual({ ok: true });
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.tradePresetAskedAt).not.toBeNull();
    expect([company.wholeSetTakeoffOn, company.roomFinderOn, company.doorsWindowsOn, company.symbolCountOff]).toEqual([false, true, false, false]);
    expect([company.scannedPlansOn, company.planCompareOn]).toEqual([false, true]); // plan comparison stays ON (#1087)
    expect(await prisma.companyTradeScope.findMany({ where: { companyId }, select: { tradeScope: true, isPrimary: true } })).toEqual([
      { tradeScope: "FIREPROOFING", isPrimary: true },
    ]);
    const types = await prisma.wallType.findMany({ where: { companyId }, include: { components: true }, orderBy: { sortOrder: "asc" } });
    expect(types.map((t) => t.code)).toEqual(["FP1", "FP2"]);
    expect(types[0]!.components.map((c) => c.basis)).toEqual(["AREA_SQFT", "AREA_SQFT"]);
    const template = await prisma.estimateTemplate.findFirstOrThrow({ where: { companyId }, include: { items: true } });
    expect(template.tradeScope).toBe("FIREPROOFING");
    expect(template.items.length).toBe(7);
    expect(template.items.every((i) => i.defaultQuantity === null && i.catalogEntryId === null)).toBe(true);
    expect(await prisma.companyBidDefaults.findUnique({ where: { companyId } })).toBeNull();
  });

  it("plaster and EIFS: both scopes, lath-plaster primary, one-faced assemblies", async () => {
    const companyId = await newCompany();
    expect((await applyTradePreset("PLASTER_EIFS")).ok).toBe(true);
    const scopes = await prisma.companyTradeScope.findMany({ where: { companyId }, orderBy: { tradeScope: "asc" } });
    // Ordered by the enum's own order, in which LATH_PLASTER comes first.
    expect(scopes.map((s) => [s.tradeScope, s.isPrimary])).toEqual([["LATH_PLASTER", true], ["EIFS", false]]);
    const types = await prisma.wallType.findMany({ where: { companyId } });
    expect(types.map((t) => [t.code, t.sides]).sort()).toEqual([["EIFS1", 1], ["PL1", 1]]);
  });

  it("Other: the asked stamp and today's defaults, nothing added", async () => {
    const companyId = await newCompany();
    expect((await applyTradePreset("OTHER")).ok).toBe(true);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).tradePresetAskedAt).not.toBeNull();
    expect(await prisma.wallType.count({ where: { companyId } })).toBe(0);
    expect(await prisma.estimateTemplate.count({ where: { companyId } })).toBe(0);
    expect(await prisma.companyTradeScope.count({ where: { companyId } })).toBe(0);
  });

  it("a second tap writes nothing twice, whatever trade it names", async () => {
    const companyId = await newCompany();
    await applyTradePreset("ACOUSTICAL_CEILINGS");
    expect(await applyTradePreset("FRAMING_DRYWALL")).toEqual({ ok: true });
    expect((await prisma.wallType.findMany({ where: { companyId } })).map((t) => t.code).sort()).toEqual(["ACT1", "ACT2", "GYPC1"]);
    expect(await prisma.estimateTemplate.count({ where: { companyId } })).toBe(1);
  });

  it("AN EXISTING COMPANY IS REFUSED AND LEFT EXACTLY AS IT WAS", async () => {
    const companyId = await newCompany({ businessScopeAskedAt: new Date("2026-09-21") });
    const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const result = await applyTradePreset("FIREPROOFING");
    expect(result.ok).toBe(false);
    const after = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect({ ...after, updatedAt: null }).toEqual({ ...before, updatedAt: null });
    expect(await prisma.wallType.count({ where: { companyId } })).toBe(0);
    expect(markupNeeded(after, null)).toBe(false);
  });

  it("refuses a non-owner and an unknown trade", async () => {
    await newCompany();
    context.role = "MEMBER";
    expect((await applyTradePreset("FIREPROOFING")).ok).toBe(false);
    context.role = "OWNER";
    expect((await applyTradePreset("ROOFING")).ok).toBe(false);
  });
});

describe("the starter markup and what reads it", () => {
  it("is owed after the trade tap, holds the Estimate step open, and clears when all four are saved", async () => {
    const companyId = await newCompany();
    await applyTradePreset("FRAMING_DRYWALL");
    const contact = await prisma.contact.create({ data: { companyId, name: "Markup Step GC" } });
    const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Markup Step Job", status: "ESTIMATE" } });
    await prisma.jobLineItem.create({ data: { jobId: job.id, description: "Hang drywall", quantity: "100", unitPrice: "2" } });
    expect((await loadJobStepFacts(companyId, job.id)).markupNeeded).toBe(true);

    const partial = await saveStarterMarkup(markup({ materialMarkupPercent: "10", laborMarkupPercent: "12", overheadPercent: "8" }));
    expect(partial.ok).toBe(false);
    expect(await prisma.companyBidDefaults.findUnique({ where: { companyId } })).toBeNull();

    expect((await saveStarterMarkup(markup({ materialMarkupPercent: "10", laborMarkupPercent: "12", overheadPercent: "0", profitPercent: "7.5" }))).ok).toBe(true);
    const saved = await prisma.companyBidDefaults.findUniqueOrThrow({ where: { companyId } });
    expect([saved.materialMarkupPercent, saved.laborMarkupPercent, saved.overheadPercent, saved.profitPercent].map(String)).toEqual(["10", "12", "0", "7.5"]);
    expect((await loadJobStepFacts(companyId, job.id)).markupNeeded).toBe(false);
  });
});
