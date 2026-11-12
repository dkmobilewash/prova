import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { guessColumns, planPriceList, priceListTable, readRow } from "@/lib/estimating/priceList";
import { priceNeeds } from "@/lib/estimating/catalogPrices";

// "Order materials" on Baker: the supplier's list imported (as priceList.dbtest.ts does it),
// the job contracted, then one press makes the draft PO in whole packs at the list's prices.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/viewerToday", async (actual) => ({ ...(await actual<typeof import("@/lib/viewerToday")>()), viewerAsOf: async () => new Date("2026-11-11T00:00:00Z") }));
const { importPriceList } = await import("./priceList");
const { orderMaterials } = await import("./purchaseOrders");

const text = readFileSync(new URL("../../e2e/fixtures/supplier-price-list.csv", import.meta.url), "utf8");
let companyId = "";
let jobId = "";
let vendorId = "";

// Baker's three legend types, the parts exactly as #1091 writes them (priceList.dbtest.ts).
const BAKER: Record<string, [string, string, number][]> = {
  S6B: [["6in metal stud at 16in o.c. (your standard; not on the drawing)", "EA", 96], ["6in track, top and bottom", "LF", 252], ["5/8in type X gypsum board, 4x8 sheets", "SHT", 83], ["drywall screws, Type S, per 1,000", "M", 2.52], ["joint tape, 500 ft rolls", "RL", 2], ["joint compound", "LB", 353]],
  C8B: [["5/8in gypsum board, 4x8 sheets", "SHT", 33], ["cavity insulation", "SF", 1008], ["drywall screws, Type S, per 1,000", "M", 1.01], ["joint tape, 500 ft rolls", "RL", 1], ["joint compound", "LB", 142]],
  S6A: [["6in metal stud, 25 ga at 24in o.c.", "EA", 33], ["6in track, bottom, 25 ga", "LF", 63], ["6in deflection track, top, 25 ga (the wall runs to the deck)", "LF", 63], ["5/8in type X gypsum board, 2 layers per side, 4x8 sheets", "SHT", 116], ["drywall screws, Type S, per 1,000", "M", 3.53], ["joint tape, 500 ft rolls", "RL", 2], ["joint compound", "LB", 247]],
};

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Order Materials Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `om_${Date.now()}`, email: `om_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Baker EOC", status: "ESTIMATE" } })).id;
  await prisma.companyBidDefaults.create({ data: { companyId, materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "0", profitPercent: "0" } });
  for (const [code, parts] of Object.entries(BAKER)) {
    const type = await prisma.wallType.create({ data: { companyId, code, name: code, sides: 2, studSpacingIn: "16" } });
    for (const [i, [description, unit, quantity]] of parts.entries()) {
      const c = await prisma.wallTypeComponent.create({ data: { wallTypeId: type.id, description, unit, basis: "BOARDED_SQFT", factor: "1", sortOrder: i } });
      await prisma.jobLineItem.create({ data: { jobId, description: `${code} — ${description}`, unit, quantity: String(quantity), wallTypeComponentId: c.id, costCategory: "MATERIAL" } });
    }
  }
  // The list, imported while the job is an estimate, with the picks priceList.dbtest.ts makes.
  const table = priceListTable(text);
  const map = guessColumns(table.header)!;
  const plan = planPriceList(table.rows.map((r) => readRow(r, map, 500)), (await priceNeeds(prisma, companyId)).map(({ group, label, unit }) => ({ group, label, unit })));
  const line = (re: RegExp) => table.rows.find((r) => re.test(r.cells.join(" ")))!.line;
  const byKey = { "stud|metal|6|25": line(/NBS-1063/), screws: line(/NBS-4114/) };
  const byGroup = Object.fromEntries(plan.needsPick.map((n) => [n.group, /stud/.test(n.label) ? line(/NBS-1061/) : /track/.test(n.label) ? line(/NBS-1161/) : line(/NBS-6019/)]));
  const imported = await importPriceList({ vendorName: "Northgate Building Supply", quotedOn: "2026-11-09", text, map, picks: { byKey, byGroup } });
  if (!imported.ok) throw new Error(imported.error);
  vendorId = (await prisma.vendor.findFirstOrThrow({ where: { companyId, name: "Northgate Building Supply" } })).id;
});

const poLine = async (re: RegExp) => {
  const rows = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { jobId } }, include: { lineItem: { select: { description: true } } } });
  const row = rows.find((r) => re.test(r.lineItem.description));
  return row ? { quantity: Number(row.quantity), unit: row.unit, unitPrice: Number(row.unitPrice), description: row.description } : null;
};

describe("Order materials on Baker", () => {
  it("an estimate is refused: buying out starts at the contract", async () => {
    expect(await orderMaterials(jobId, vendorId)).toEqual({ ok: false, error: "Contract this job before ordering its materials." });
  });

  it("one press: one draft PO, every material in whole packs at the supplier's price", async () => {
    await prisma.job.update({ where: { id: jobId }, data: { status: "CONTRACTED" } });
    const result = await orderMaterials(jobId, vendorId);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    if (!result.ok) return;
    expect(result.value.orders).toHaveLength(1);
    expect(result.value.orders[0]).toMatchObject({ number: 1, phase: null, lines: 18 });
    expect(result.value.skipped).toEqual([]);
    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId }, select: { status: true, vendorId: true } });
    expect(po).toEqual({ status: "DRAFT", vendorId });
    // Compound: 353 lb in 61.7 lb pails is 5.72 → 6 pails at the pail's price.
    expect(await poLine(/^S6B — joint compound/)).toMatchObject({ quantity: 6, unit: "PAIL", unitPrice: 21.4 });
    expect(await poLine(/^S6A — joint compound/)).toMatchObject({ quantity: 5, unit: "PAIL" }); // 247 / 61.7 = 4.003 → 5
    // Screws: 3.53 thousand in boxes of 5,000 → 1 box.
    expect(await poLine(/^S6A — drywall screws/)).toMatchObject({ quantity: 1, unit: "BX", unitPrice: 42.5 });
    // Type X board at $510 per MSF, bought as the list's 4x12 sheets: 116 4x8s = 77.3 → 78 sheets at $24.48.
    expect(await poLine(/^S6A — 5\/8in type X/)).toMatchObject({ quantity: 78, unit: "SHT", unitPrice: 24.48 });
    // Insulation: 1,008 sf in 75.8 sf bags → 14 bags. Track: 252 lf in 10 ft pieces → 26.
    expect(await poLine(/^C8B — cavity insulation/)).toMatchObject({ quantity: 14, unit: "BAG", unitPrice: 62.9 });
    expect(await poLine(/^S6B — 6in track/)).toMatchObject({ quantity: 26, unit: "EA", unitPrice: 6.4 });
    expect((await poLine(/^S6B — joint compound/))!.description).toBe("All Purpose Joint Compound 4.5 gal / 61.7 lb");
  });

  it("a second press while that draft is open is refused, so nothing is ordered twice", async () => {
    expect(await orderMaterials(jobId, vendorId)).toEqual({ ok: false, error: "PO 1 from Northgate Building Supply is still a draft on this job. Finish or remove it on Buyout before ordering again." });
  });

  it("with phase codes on the lines: one draft per phase, numbered on from the job's counter", async () => {
    await prisma.purchaseOrder.deleteMany({ where: { jobId } });
    const framing = await prisma.phaseCode.create({ data: { companyId, code: "0921", name: "Framing" } });
    await prisma.jobLineItem.updateMany({ where: { jobId, description: { contains: "stud" } }, data: { phaseCodeId: framing.id } });
    const result = await orderMaterials(jobId, vendorId);
    expect(result.ok && result.value.orders.map((o) => [o.number, o.phase])).toEqual([
      [2, null],
      [3, "0921 Framing"],
    ]);
    expect((await poLine(/^S6A — 6in metal stud/))!.description).toMatch(/^0921 Framing: /);
  });

  it("another company's supplier is not a choice", async () => {
    const other = (await prisma.company.create({ data: { name: "Other Supply Co" } })).id;
    const theirs = await prisma.vendor.create({ data: { companyId: other, name: "Their Supply" } });
    expect(await orderMaterials(jobId, theirs.id)).toEqual({ ok: false, error: "Pick a supplier." });
  });
});
