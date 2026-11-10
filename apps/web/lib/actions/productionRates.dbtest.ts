import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { syncWallScheduleLines } from "@/lib/estimating/wall-schedule";
import { laborPlanFor } from "@/lib/estimating/laborLines";

// Labor on the estimate from confirmed walls × the company's rates × its crew rate — and none until the rates are set.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveProductionRates } = await import("./productionRates");

let companyId = "";
let jobId = "";
const runIds: Record<string, string> = {};
const BAKER: Record<string, { sides: 1 | 2; parts: [string, string, string, number][]; run: [number, number] }> = {
  S6B: { sides: 2, run: [120, 10], parts: [["6in metal stud at 16in o.c.", "EA", "STUDS", 1], ["6in track, top and bottom", "LF", "LINEAR_FT", 2], ["5/8in type X gypsum board, 4x8 sheets", "SHT", "BOARDED_SQFT", 0.03125], ["joint compound", "LB", "BOARDED_SQFT", 0.14]] },
  C8B: { sides: 1, run: [80, 12], parts: [["5/8in gypsum board, 4x8 sheets", "SHT", "BOARDED_SQFT", 0.03125], ["cavity insulation", "SF", "FACE_SQFT", 1], ["joint compound", "LB", "BOARDED_SQFT", 0.14]] },
  S6A: { sides: 2, run: [60, 14], parts: [["6in metal stud, 25 ga at 24in o.c.", "EA", "STUDS", 1], ["6in track, bottom, 25 ga", "LF", "LINEAR_FT", 1], ["5/8in type X gypsum board, 2 layers per side, 4x8 sheets", "SHT", "BOARDED_SQFT", 0.0625], ["joint compound", "LB", "BOARDED_SQFT", 0.14]] },
};
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const RATES = { framingLfPerHr: "20", boardRegular: "60", boardTypeX: "50", boardSpecial: "40", finishLevel3: "55", finishLevel4: "45", finishLevel5: "30", defaultFinishLevel: "4", ceilingSfPerHr: "40", over10Multiplier: "1.15", over14Multiplier: "1.3", crewRatePerHr: "62" };
const labor = () => prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false, costCategory: "LABOR" }, orderBy: { description: "asc" } });
const sync = () => prisma.$transaction((tx) => syncWallScheduleLines(tx, companyId, jobId));

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Labor Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `lab_${Date.now()}`, email: `lab_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Baker EOC", status: "ESTIMATE" } })).id;
  await prisma.companyBidDefaults.create({ data: { companyId, materialMarkupPercent: "10", laborMarkupPercent: "20", overheadPercent: "0", profitPercent: "0" } });
  for (const [code, t] of Object.entries(BAKER)) {
    const type = await prisma.wallType.create({ data: { companyId, code, name: code, sides: t.sides, studSpacingIn: "16", components: { create: t.parts.map(([description, unit, basis, factor], i) => ({ description, unit, basis: basis as never, factor: String(factor), sortOrder: i })) } } });
    runIds[code] = (await prisma.wallRun.create({ data: { companyId, jobId, wallTypeId: type.id, label: `${code} walls`, lengthFt: String(t.run[0]), heightFt: String(t.run[1]) } })).id;
  }
});

describe("labor from the company's production rates", () => {
  it("with no rates set: the materials are written, no labor line is, and the estimate is told which rates are missing", async () => {
    await sync();
    expect(await labor()).toEqual([]);
    const { plan } = await prisma.$transaction((tx) => laborPlanFor(tx, companyId, jobId));
    expect(plan.missing).toEqual(expect.arrayContaining(["framing (lin ft per hour)", "hanging type X board (sq ft per hour)", "the over-10 ft multiplier"]));
  });

  it("saving the rates writes Baker's labor on the open estimate, matching the hand calculation", async () => {
    expect(await saveProductionRates(form(RATES))).toEqual({ ok: true, value: { jobs: 1 } });
    const lines = await labor();
    const h = (re: RegExp) => Number(lines.find((l) => re.test(l.description))?.laborHours);
    expect(lines).toHaveLength(8);
    expect(h(/S6B — framing/)).toBe(6);
    expect(h(/S6B — hang type X/)).toBe(48);
    expect(h(/S6B — tape and finish, Level 4$/)).toBe(53.33);
    expect(h(/C8B — hang regular board, over 10 ft/)).toBe(18.4);
    expect(h(/C8B — tape and finish, Level 4, over 10 ft/)).toBe(24.53);
    expect(h(/S6A — framing, studs and track, over 10 ft/)).toBe(3.45);
    expect(h(/S6A — hang type X board, 2 layers, over 10 ft/)).toBe(77.28);
    expect(h(/S6A — tape and finish, Level 4, over 10 ft/)).toBe(42.93);
    expect(lines.every((l) => l.unit === "HR" && l.budgetedUnitCost?.toString() === "62" && Number(l.quantity) === Number(l.laborHours))).toBe(true);
    expect(Number(lines[0].unitPrice)).toBeCloseTo(74.4, 2); // $62 + 20% labor markup
    const cost = lines.reduce((n, l) => n + Number(l.quantity) * Number(l.budgetedUnitCost), 0);
    expect(Math.round(cost * 100) / 100).toBe(16983.04);
    const { plan } = await prisma.$transaction((tx) => laborPlanFor(tx, companyId, jobId));
    expect(plan.missing).toEqual([]);
  });

  it("raising S6B from 10 ft to 12 ft moves its labor into the over-10 band, in place", async () => {
    const before = (await labor()).map((l) => l.id);
    await prisma.wallRun.update({ where: { id: runIds.S6B }, data: { heightFt: "12" } });
    await sync();
    const lines = await labor();
    const h = (re: RegExp) => Number(lines.find((l) => re.test(l.description))?.laborHours);
    expect(h(/S6B — framing, studs and track, over 10 ft/)).toBe(6.9);
    expect(h(/S6B — hang type X board, over 10 ft/)).toBe(66.24);
    expect(h(/S6B — tape and finish, Level 4, over 10 ft/)).toBe(73.6);
    expect(lines.some((l) => /^Labor — S6B — framing, studs and track$/.test(l.description))).toBe(false);
    expect(lines.filter((l) => !l.description.includes("S6B")).every((l) => before.includes(l.id))).toBe(true); // the others updated in place
  });

  it("a labor line a person deleted is not put back", async () => {
    const victim = (await labor()).find((l) => /C8B — hang/.test(l.description))!;
    await prisma.jobLineItem.update({ where: { id: victim.id }, data: { isDeleted: true } });
    await sync();
    expect((await labor()).some((l) => /C8B — hang/.test(l.description))).toBe(false);
  });

  it("clearing a rate removes that work's labor, and the estimate asks for it again", async () => {
    expect((await saveProductionRates(form({ ...RATES, framingLfPerHr: "" }))).ok).toBe(true);
    expect((await labor()).some((l) => /framing/.test(l.description))).toBe(false);
    const { plan } = await prisma.$transaction((tx) => laborPlanFor(tx, companyId, jobId));
    expect(plan.missing).toEqual(["framing (lin ft per hour)"]);
    // Put back, the framing lines come back — they were removed by the rate, not by a person.
    expect((await saveProductionRates(form(RATES))).ok).toBe(true);
    expect((await labor()).filter((l) => /framing/.test(l.description))).toHaveLength(2);
  });

  it("refuses a zero rate and a multiplier under 1", async () => {
    expect(await saveProductionRates(form({ ...RATES, boardTypeX: "0" }))).toMatchObject({ ok: false });
    expect(await saveProductionRates(form({ ...RATES, over10Multiplier: "0.9" }))).toMatchObject({ ok: false });
  });
});
