import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { guessColumns, planPriceList, priceListTable, readRow } from "@/lib/estimating/priceList";
import { priceNeeds, priceSource } from "@/lib/estimating/catalogPrices";
import { unpricedMaterials } from "@/lib/estimating/materialKey";

// A supplier's price list prices Baker's estimate with no costs typed: N unpriced materials to 0.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { importPriceList } = await import("./priceList");

const text = readFileSync(new URL("../../e2e/fixtures/supplier-price-list.csv", import.meta.url), "utf8");
let companyId = "";
let jobId = "";

// Baker's three legend types, the parts exactly as #1091 writes them.
const BAKER: Record<string, [string, string, number][]> = {
  S6B: [["6in metal stud at 16in o.c. (your standard; not on the drawing)", "EA", 96], ["6in track, top and bottom", "LF", 252], ["5/8in type X gypsum board, 4x8 sheets", "SHT", 83], ["drywall screws, Type S, per 1,000", "M", 2.52], ["joint tape, 500 ft rolls", "RL", 2], ["joint compound", "LB", 353]],
  C8B: [["5/8in gypsum board, 4x8 sheets", "SHT", 33], ["cavity insulation", "SF", 1008], ["drywall screws, Type S, per 1,000", "M", 1.01], ["joint tape, 500 ft rolls", "RL", 1], ["joint compound", "LB", 142]],
  S6A: [["6in metal stud, 25 ga at 24in o.c.", "EA", 33], ["6in track, bottom, 25 ga", "LF", 63], ["6in deflection track, top, 25 ga (the wall runs to the deck)", "LF", 63], ["5/8in type X gypsum board, 2 layers per side, 4x8 sheets", "SHT", 116], ["drywall screws, Type S, per 1,000", "M", 3.53], ["joint tape, 500 ft rolls", "RL", 2], ["joint compound", "LB", 247]],
};
const unpriced = async () =>
  unpricedMaterials((await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false, unitPrice: null, wallTypeComponentId: { not: null } } })).map((l) => ({ id: l.id, description: l.description, unit: l.unit, quantity: Number(l.quantity) })));

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Price List Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `pl_${Date.now()}`, email: `pl_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Baker EOC", status: "ESTIMATE" } })).id;
  await prisma.companyBidDefaults.create({ data: { companyId, materialMarkupPercent: "10", laborMarkupPercent: "10", overheadPercent: "0", profitPercent: "0" } });
  for (const [code, parts] of Object.entries(BAKER)) {
    const type = await prisma.wallType.create({ data: { companyId, code, name: code, sides: 2, studSpacingIn: "16" } });
    for (const [i, [description, unit, quantity]] of parts.entries()) {
      const c = await prisma.wallTypeComponent.create({ data: { wallTypeId: type.id, description, unit, basis: "BOARDED_SQFT", factor: "1", sortOrder: i } });
      await prisma.jobLineItem.create({ data: { jobId, description: `${code} — ${description}`, unit, quantity: String(quantity), wallTypeComponentId: c.id } });
    }
  }
});

describe("a supplier price list prices Baker's estimate", () => {
  it("starts with every material unpriced and the company's book empty", async () => {
    expect((await unpriced()).length).toBe(11);
    expect(await prisma.lineItemCatalogEntry.count({ where: { companyId } })).toBe(0);
  });

  it("imports with one pick per material the list or the drawing leaves open, and the list empties", async () => {
    const table = priceListTable(text);
    const map = guessColumns(table.header)!;
    const plan = planPriceList(table.rows.map((r) => readRow(r, map, 500)), (await priceNeeds(prisma, companyId)).map(({ group, label, unit }) => ({ group, label, unit })));
    const line = (re: RegExp) => table.rows.find((r) => re.test(r.cells.join(" ")))!.line;
    const byKey = { "stud|metal|6|25": line(/NBS-1063/), screws: line(/NBS-4114/) }; // 14 ft studs for 14 ft walls; the 1-1/4in screws
    const byGroup = Object.fromEntries(
      plan.needsPick.map((n) => [n.group, /stud/.test(n.label) ? line(/NBS-1061/) : /track/.test(n.label) ? line(/NBS-1161/) : line(/NBS-6019/)]),
    );
    expect(plan.needsPick.map((n) => n.label).sort()).toEqual(["6in metal stud", "6in track, top and bottom", "cavity insulation"]);
    const result = await importPriceList({ vendorName: "Northgate Building Supply", quotedOn: "2026-11-09", text, map, picks: { byKey, byGroup } });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.quotes).toBe(23); // every row with a price, kept as the supplier wrote it
    expect(result.value.noMarkup).toBe(0);
    expect(await unpriced()).toEqual([]);
  });

  it("each price is the converted list price through the markup, and nothing came from anywhere else", async () => {
    const lines = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, include: { sourceCatalogEntry: true } });
    const cost = (re: RegExp) => lines.find((l) => re.test(l.description))!.budgetedUnitCost?.toString();
    expect(cost(/^S6A — .*type X/)).toBe("16.32"); // $510 per MSF
    expect(cost(/^S6A — .*metal stud/)).toBe("9.6"); // the 14 ft stud picked
    expect(cost(/^S6B — .*metal stud/)).toBe("6.85"); // the 10 ft 25 ga picked for the gauge the drawing left out
    expect(cost(/^S6B — .*track, top and bottom/)).toBe("0.64");
    expect(cost(/^S6A — .*deflection/)).toBe("1.39");
    expect(cost(/^C8B — .*insulation/)).toBe("0.83");
    expect(cost(/^C8B — .*screws/)).toBe("8.5");
    expect(cost(/^S6B — joint tape/)).toBe("6.95");
    expect(cost(/^S6B — joint compound/)).toBe("0.35");
    expect(Number(lines.find((l) => /^S6A — .*type X/.test(l.description))!.unitPrice)).toBeCloseTo(17.95, 2); // +10% material markup
    expect(lines.every((l) => l.priceBasis === "COMPANY_CATALOG" && l.sourceCatalogEntryId !== null)).toBe(true);
  });

  it("says where each price came from, and stops saying it once somebody types another cost", async () => {
    const entry = await prisma.lineItemCatalogEntry.findFirstOrThrow({
      where: { companyId, description: { startsWith: "5/8in type X" } },
      include: { priceQuotes: { include: { vendor: true } } },
    });
    const today = new Date("2026-11-10T00:00:00Z");
    expect(priceSource(entry, entry.priceQuotes, 500, today)).toMatchObject({ vendor: "Northgate Building Supply", stale: false });
    expect(priceSource(entry, entry.priceQuotes, 500, new Date("2027-03-01T00:00:00Z"))?.stale).toBe(true);
    expect(priceSource({ ...entry, defaultBudgetedUnitCost: { toString: () => "17.00" } }, entry.priceQuotes, 500, today)).toBeNull();
    // EVERY line names its source — including the materials a person picked a row for. (The walk found two that did not:
    // a picked row that had already priced its own material got a second, quote-less entry.)
    const lines = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, include: { sourceCatalogEntry: { include: { priceQuotes: { include: { vendor: true } } } } } });
    const unsourced = lines.filter((l) => priceSource(l.sourceCatalogEntry!, l.sourceCatalogEntry!.priceQuotes, 500, today) === null).map((l) => l.description);
    expect(unsourced).toEqual([]);
  });

  it("an unmatched row priced nothing: it is a quote for reference, linked to no catalog entry", async () => {
    const lightweight = await prisma.vendorPriceQuote.findFirstOrThrow({ where: { companyId, description: { startsWith: "Lightweight" } } });
    expect(lightweight.catalogEntryId).toBeNull();
    expect(lightweight.source).toBe("PRICE_LIST");
    expect(lightweight.notes).toMatch(/weight is not stated/);
    expect(await prisma.lineItemCatalogEntry.count({ where: { companyId, description: { contains: "Delivery" } } })).toBe(0);
  });

  it("refuses a pick that is not one of the offered rows, and a non-owner", async () => {
    const map = guessColumns(priceListTable(text).header)!;
    expect(await importPriceList({ vendorName: "X", quotedOn: "2026-11-09", text, map, picks: { byKey: { screws: 1 }, byGroup: {} } })).toMatchObject({ ok: false });
    context.role = "MEMBER";
    expect(await importPriceList({ vendorName: "X", quotedOn: "2026-11-09", text, map, picks: { byKey: {}, byGroup: {} } })).toMatchObject({ ok: false, error: expect.stringMatching(/owner/) });
    context.role = "OWNER";
  });
});
