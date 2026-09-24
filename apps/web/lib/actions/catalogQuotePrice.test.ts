import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `priceCatalogEntryFromQuotes`, pinned where a person cannot click it.
 *
 *   1. The figure is RE-DERIVED from the quotes on the server. The form sends
 *      one checkbox and no numbers — this is the control that edits a price
 *      every future bid and every AI draft reads (#105 finding 3).
 *   2. Only the TEMPLATE is written. No JobLineItem, no snapshot, no invoice.
 *   3. Owner-only, and scoped by company in the where.
 *   4. A quote in another unit never prices anything — the MSF-for-SF error.
 */

type Row = Record<string, unknown> & { id: string };
let db: Record<string, Row[]>;
let updates: { where: unknown; data: Record<string, unknown> }[] = [];

const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/viewerToday", () => ({ viewerTimeZone: async () => "America/Denver" }));

const matches = (row: Row, where: Record<string, unknown> = {}): boolean =>
  Object.entries(where).every(([key, value]) => row[key] === value);

vi.mock("@prova/db", () => ({
  prisma: {
    lineItemCatalogEntry: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const entry = db.lineItemCatalogEntry.find((row) => matches(row, where));
        if (!entry) return null;
        return {
          ...entry,
          priceQuotes: db.vendorPriceQuote
            .filter((quote) => quote.catalogEntryId === entry.id)
            .map((quote) => ({ ...quote, vendor: { name: quote.vendorName } })),
        };
      },
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        const row = db.lineItemCatalogEntry.find((r) => r.id === (args.where as { id: string }).id)!;
        Object.assign(row, args.data);
        return row;
      },
    },
    // Present so an accidental write to a job would be visible rather than a
    // TypeError: nothing in this action may touch one.
    jobLineItem: {
      update: async () => {
        throw new Error("priceCatalogEntryFromQuotes must never write a JobLineItem");
      },
      updateMany: async () => {
        throw new Error("priceCatalogEntryFromQuotes must never write a JobLineItem");
      },
    },
  },
}));

const actions = () => import("./estimating");

const form = (values: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const quote = (over: Partial<Row> & { id: string; unitPrice: string }): Row => ({
  catalogEntryId: "cat_1",
  vendorId: `v_${over.id}`,
  vendorName: `Vendor ${over.id}`,
  description: "5/8 Type X",
  unit: "SF",
  quotedOn: new Date("2026-09-12T00:00:00Z"),
  validUntil: null,
  source: "QUOTE",
  notes: null,
  ...over,
});

beforeEach(() => {
  updates = [];
  context.role = "OWNER";
  db = {
    lineItemCatalogEntry: [
      { id: "cat_1", companyId: "co_1", unit: "SF", defaultBudgetedUnitCost: "1.50", defaultUnitPrice: "3.00" },
      { id: "cat_theirs", companyId: "co_2", unit: "SF", defaultBudgetedUnitCost: "1.50", defaultUnitPrice: "3.00" },
    ],
    vendorPriceQuote: [quote({ id: "a", unitPrice: "2.10" }), quote({ id: "b", unitPrice: "1.90" })],
  };
});

describe("pricing a catalog entry from its quotes", () => {
  it("writes the cheapest live quote as the default cost, and nothing else", async () => {
    const { priceCatalogEntryFromQuotes } = await actions();
    expect(await priceCatalogEntryFromQuotes("cat_1", form())).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toEqual({ defaultBudgetedUnitCost: "1.90" });
  });

  it("takes no figure from the request — a posted price is ignored", async () => {
    const { priceCatalogEntryFromQuotes } = await actions();
    // Everything a tampered or stale form could try to send.
    await priceCatalogEntryFromQuotes("cat_1", form({ defaultBudgetedUnitCost: "0.01", unitPrice: "0.01", price: "0.01" }));
    expect(updates[0].data.defaultBudgetedUnitCost).toBe("1.90");
  });

  it("moves the sale price only when the checkbox asks, holding margin", async () => {
    const { priceCatalogEntryFromQuotes } = await actions();
    await priceCatalogEntryFromQuotes("cat_1", form({ alsoUpdatePrice: "on" }));
    expect(updates[0].data).toEqual({ defaultBudgetedUnitCost: "1.90", defaultUnitPrice: "3.80" });
  });

  it("refuses a quote in another unit rather than pricing 1000x wrong", async () => {
    db.vendorPriceQuote = [quote({ id: "msf", unitPrice: "1900.00", unit: "MSF" })];
    const { priceCatalogEntryFromQuotes } = await actions();
    const result = await priceCatalogEntryFromQuotes("cat_1", form());
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("No live quote is priced by SF");
    expect(updates).toHaveLength(0);
  });

  it("refuses an expired quote, and says which problem it is", async () => {
    db.vendorPriceQuote = [quote({ id: "old", unitPrice: "1.90", validUntil: new Date("2020-01-01T00:00:00Z") })];
    const { priceCatalogEntryFromQuotes } = await actions();
    const result = await priceCatalogEntryFromQuotes("cat_1", form());
    expect((result as { error: string }).error).toMatch(/expired/);
    expect(updates).toHaveLength(0);
  });

  it("is owner-only, and a refused press writes nothing", async () => {
    context.role = "MEMBER";
    const { priceCatalogEntryFromQuotes } = await actions();
    const result = await priceCatalogEntryFromQuotes("cat_1", form());
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("cannot price another company's catalog entry", async () => {
    const { priceCatalogEntryFromQuotes } = await actions();
    const result = await priceCatalogEntryFromQuotes("cat_theirs", form());
    expect(result).toEqual({ ok: false, error: "Catalog entry not found — it may have been deleted. Reload the page." });
    expect(updates).toHaveLength(0);
  });
});
