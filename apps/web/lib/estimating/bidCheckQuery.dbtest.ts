import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { syncWallScheduleLines } from "@/lib/estimating/wall-schedule";
import { bidCheckSummary } from "./bidCheck";
import { loadBidChecks } from "./bidCheckQuery";

// The bid check read off real rows: Baker's three types on the wall schedule, from a fresh
// estimate with every check open down to all seven clear, each closed by fixing what it named.
let companyId = "";
let jobId = "";
let lostRunId = "";
const BAKER: Record<string, { sides: 1 | 2; parts: [string, string, string, number][]; run: [number, number] }> = {
  S6B: { sides: 2, run: [120, 10], parts: [["6in metal stud at 16in o.c.", "EA", "STUDS", 1], ["6in track, top and bottom", "LF", "LINEAR_FT", 2], ["5/8in type X gypsum board, 4x8 sheets", "SHT", "BOARDED_SQFT", 0.03125]] },
  C8B: { sides: 1, run: [80, 12], parts: [["5/8in gypsum board, 4x8 sheets", "SHT", "BOARDED_SQFT", 0.03125]] },
  S6A: { sides: 2, run: [60, 14], parts: [["6in metal stud, 25 ga at 24in o.c.", "EA", "STUDS", 1], ["5/8in type X gypsum board, 2 layers per side, 4x8 sheets", "SHT", "BOARDED_SQFT", 0.0625]] },
};
const RATES = { framingLfPerHr: 20, boardSfPerHr: { regular: 60, typeX: 50, special: 40 }, finishSfPerHr: { level3: 55, level4: 45, level5: 30 }, defaultFinishLevel: 4, ceilingSfPerHr: 40, over10Multiplier: 1.15, over14Multiplier: 1.3, crewRatePerHr: 62 };
const sync = () => prisma.$transaction((tx) => syncWallScheduleLines(tx, companyId, jobId));
const byKey = async () => Object.fromEntries((await loadBidChecks(companyId, jobId)).map((c) => [c.key, c]));

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Bid Check Co" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Baker EOC", status: "ESTIMATE" } })).id;
  await prisma.companyBidDefaults.create({ data: { companyId, materialMarkupPercent: "10", laborMarkupPercent: "20", overheadPercent: "0", profitPercent: "0" } });
  for (const [code, t] of Object.entries(BAKER)) {
    const type = await prisma.wallType.create({ data: { companyId, code, name: code, sides: t.sides, studSpacingIn: "16", components: { create: t.parts.map(([description, unit, basis, factor], i) => ({ description, unit, basis: basis as never, factor: String(factor), sortOrder: i })) } } });
    await prisma.wallRun.create({ data: { companyId, jobId, wallTypeId: type.id, label: `${code} walls`, lengthFt: String(t.run[0]), heightFt: String(t.run[1]) } });
  }
  // A run of a type with no height of its own, typed with no height either.
  const bare = await prisma.wallType.create({ data: { companyId, code: "X1", name: "X1", sides: 2, studSpacingIn: "16", components: { create: [{ description: "5/8in gypsum board, 4x8 sheets", unit: "SHT", basis: "BOARDED_SQFT", factor: "0.03125", sortOrder: 0 }] } } });
  lostRunId = (await prisma.wallRun.create({ data: { companyId, jobId, wallTypeId: bare.id, label: "Corridor", lengthFt: "40" } })).id;
  await sync();
});

describe("the bid check on Baker's estimate", () => {
  it("a fresh automatic estimate: heights, prices, rates and quantities open, each saying why", async () => {
    const c = await byKey();
    expect(c.heights.open).toBe(true);
    expect(c.heights.lines).toEqual(["Corridor (X1): no height on the run or its type"]);
    expect(c.heights.fix?.href).toBe(`/jobs/${jobId}/estimate#wall-schedule`);
    expect(c.prices.open).toBe(true);
    expect(c.prices.lines[0]).toMatch(/^\d+ lines with no price or cost:$/);
    expect(c.rates.open).toBe(true);
    expect(c.rates.lines[0]).toContain("framing (lin ft per hour)");
    expect(c.quantities.open).toBe(true);
    expect(c.quantities.lines[0]).toBe("260 LF of wall, and no floor area on the job to check it against.");
    // Nothing on the takeoff, no spec read, no renovation sheet: those three have nothing to find.
    expect([c.review.open, c.spec.open, c.existing.open]).toEqual([false, false, false]);
    expect(bidCheckSummary(Object.values(c))).toBe("4 checks open");
  });

  it("closes each check by fixing what it named", async () => {
    await prisma.wallRun.update({ where: { id: lostRunId }, data: { heightFt: "9" } });
    await prisma.companyBidDefaults.update({ where: { companyId }, data: { productionRates: RATES } });
    await prisma.job.update({ where: { id: jobId }, data: { grossAreaSqFt: "1500" } });
    await sync();
    await prisma.jobLineItem.updateMany({ where: { jobId, isDeleted: false, budgetedUnitCost: null, unitPrice: null }, data: { budgetedUnitCost: "1.00" } });
    const c = await byKey();
    // 300 LF over 1,500 SF = 0.20. Faces: 1,200 + 960 + 840 + 360 = 3,360 SF; board 2,400 + 960 + 3,360 + 720 = 7,440 SF, as whole sheets.
    expect(c.quantities.lines[0]).toBe("0.20 LF of wall per SF of floor (300 LF over 1,500 SF). Within the usual 0.05–0.4.");
    expect(c.quantities.lines[1]).toMatch(/^2\.2\d SF of board per SF of wall face \([\d,]+ SF of board over 3,360 SF of wall\)\. Within the usual 0\.9–4\.5\.$/);
    expect(Object.values(c).filter((x) => x.open).map((x) => x.key)).toEqual([]);
    expect(bidCheckSummary(Object.values(c))).toBe("All 7 checks clear");
  });

  it("a floor area that is one floor of several reads as too much wall, with the ratio and the reason", async () => {
    await prisma.job.update({ where: { id: jobId }, data: { grossAreaSqFt: "500" } });
    const c = await byKey();
    expect(c.quantities.open).toBe(true);
    expect(c.quantities.lines[0]).toMatch(/^0\.60 LF of wall per SF of floor \(300 LF over 500 SF\)\. .*one floor of several\.$/);
  });
});
