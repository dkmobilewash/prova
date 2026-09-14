import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a line item may still CLAIM about its price after a person has
 * typed over it.
 *
 * `priceBasis` is the strongest sentence the estimating draft says out
 * loud — green "Your catalog price", blue "From your past bids — verify",
 * amber "AI guess, no company data — check the price" (`PriceBasisBadge`,
 * jobs/[id]/page.tsx) — and draft-lines.ts derives it from the branch that
 * actually chose the number so the badge cannot contradict the figure
 * beside it.
 *
 * Nothing carried that invariant past the draft. The badge exists to send
 * the estimator to the price and correct it; doing exactly that left both
 * fields untouched, because `updateLineItem` writes the person's number
 * and never touches `aiDrafted` or `priceBasis`. So the amber badge asking
 * them to check the price stayed on the number they had just typed
 * themselves, and a catalog line whose price they overrode kept the green
 * "Your catalog price" over a figure the catalog never held.
 *
 * The rule: a price the estimator typed is the estimator's, whatever
 * drafted it. Changing the price retires the machine's claim about it —
 * the row keeps no basis and stops being an AI-drafted row. Changing only
 * the wording or the quantity does not: the price is still the machine's
 * and still wants checking.
 */

type Row = Record<string, unknown>;

const db = {
  jobs: [] as Row[],
  lineItems: [] as Row[],
  catalog: [] as Row[],
};

const updates: Row[] = [];
const creates: Row[] = [];

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, want]) => row[key] === want);

const prisma = {
  job: {
    findUnique: async ({ where }: { where: Row }) => db.jobs.find((j) => j.id === where.id) ?? null,
    findFirst: async ({ where }: { where: Row }) => db.jobs.find((j) => matches(j, where)) ?? null,
  },
  lineItemCatalogEntry: {
    findFirst: async ({ where }: { where: Row }) => db.catalog.find((e) => matches(e, where)) ?? null,
  },
  jobLineItem: {
    findUnique: async ({ where }: { where: Row }) =>
      db.lineItems.find((i) => i.id === where.id) ?? null,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      updates.push({ id: where.id, ...data });
      const row = db.lineItems.find((i) => i.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `li_${db.lineItems.length + 1}`, ...data };
      creates.push(row);
      db.lineItems.push(row);
      return row;
    },
  },
};

const context = { id: "usr_1", role: "OWNER", jobFunction: null, company: { id: "cmp_alpha" } };

vi.mock("@prova/db", () => ({ prisma, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("@/lib/blob", () => ({ putDocument: async () => ({ url: "https://blob.example/x" }) }));
vi.mock("@prova/integrations", () => ({ draftEstimateLineItems: async () => [] }));

const { updateLineItem } = await import("@/lib/actions/jobs");
const { addCatalogLine } = await import("./catalog-line");
const { priceChanged } = await import("./price-claim");

/** A stand-in for the Decimal the row actually holds: a non-primitive that
 * prints its own digits, exactly as `Prisma.Decimal` does. The comparison
 * must survive that, or every edit would look like a price change. */
const decimal = (digits: string) => ({ toString: () => digits });

/** The row's own form as the job page posts it: every field carries the
 * value already on the row (`defaultValue={item.unitPrice?.toString()}`),
 * so a save that changed only the description still sends the price back
 * unchanged. An override of "" deletes the field, which is the person
 * clearing that input. */
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  fd.set("description", "Hang and finish 5/8 Type X");
  fd.set("quantity", "12000");
  fd.set("unit", "SF");
  fd.set("unitPrice", "3.25");
  for (const [key, value] of Object.entries(fields)) {
    if (value === "") fd.delete(key);
    else fd.set(key, value);
  }
  return fd;
};

const drafted = (over: Row = {}): Row => ({
  id: "li_1",
  jobId: "job_1",
  description: "Hang and finish 5/8 Type X",
  quantity: decimal("12000"),
  unit: "SF",
  unitPrice: decimal("3.25"),
  aiDrafted: true,
  priceBasis: "GENERAL_KNOWLEDGE",
  ...over,
});

/** A catalog entry as the row comes back, priced or not. */
const catalogEntry = (over: Row = {}): Row => ({
  id: "cat_1",
  companyId: "cmp_alpha",
  description: "5/8 Type X, hung and finished, level 4",
  unit: "SF",
  defaultUnitPrice: decimal("3.25"),
  defaultBudgetedUnitCost: null,
  defaultLaborHours: null,
  craftClassificationId: null,
  tradeScope: "METAL_FRAMING_DRYWALL",
  ...over,
});

beforeEach(() => {
  db.jobs = [{ id: "job_1", companyId: "cmp_alpha", status: "ESTIMATE", name: "Lincoln High gym" }];
  db.lineItems = [drafted()];
  db.catalog = [catalogEntry()];
  updates.length = 0;
  creates.length = 0;
});

describe("priceChanged — the same price written two ways is not a change", () => {
  it("reads a Decimal and the form's own string as the same number", () => {
    expect(priceChanged(decimal("3.25"), "3.25")).toBe(false);
    expect(priceChanged(decimal("3.25"), "3.250")).toBe(false);
    expect(priceChanged(decimal("3.25"), " 3.25 ")).toBe(false);
    expect(priceChanged(3.25, "3.25")).toBe(false);
  });

  it("is a change when the figure moves, in either direction", () => {
    expect(priceChanged(decimal("3.25"), "4.40")).toBe(true);
    expect(priceChanged(decimal("3.25"), null)).toBe(true);
    expect(priceChanged(null, "3.25")).toBe(true);
  });

  it("is not a change when there was no price and none was given", () => {
    expect(priceChanged(null, null)).toBe(false);
    expect(priceChanged(undefined, null)).toBe(false);
  });
});

describe("updateLineItem — a price the estimator typed is the estimator's", () => {
  it("retires the AI's claim when the drafted price is corrected", async () => {
    await updateLineItem("job_1", "li_1", form({ unitPrice: "4.40" }));

    const row = db.lineItems[0];
    expect(row.unitPrice, "the person's number is what is stored").toBe("4.40");
    expect(
      row.priceBasis,
      'the amber "AI guess — check the price" badge would otherwise sit on the price they just checked',
    ).toBeNull();
    expect(row.aiDrafted, "and the row is no longer a machine's draft").toBe(false);
  });

  it("stops calling an overridden catalog price a catalog price", async () => {
    db.lineItems = [drafted({ aiDrafted: false, priceBasis: "COMPANY_CATALOG" })];

    await updateLineItem("job_1", "li_1", form({ unitPrice: "9.99" }));

    expect(
      db.lineItems[0].priceBasis,
      'green "Your catalog price" over a figure the catalog never held',
    ).toBeNull();
  });

  it("leaves the claim alone when the price is untouched", async () => {
    await updateLineItem("job_1", "li_1", form({ description: "Hang, tape and finish 5/8 Type X" }));

    const row = db.lineItems[0];
    expect(row.description).toBe("Hang, tape and finish 5/8 Type X");
    expect(row.priceBasis, "the price is still the machine's, and still wants checking").toBe(
      "GENERAL_KNOWLEDGE",
    );
    expect(row.aiDrafted).toBe(true);
  });

  it("retires the claim when the price is cleared rather than replaced", async () => {
    // A cost-only budget line: the person empties the price box, which the
    // action already stores as null. A basis for a price that is no longer
    // there is the same false claim in its quietest form.
    await updateLineItem("job_1", "li_1", form({ unitPrice: "" }));

    expect(db.lineItems[0].unitPrice).toBeNull();
    expect(db.lineItems[0].priceBasis).toBeNull();
  });

  it("writes one update, and that update is the only thing it writes", async () => {
    await updateLineItem("job_1", "li_1", form({ unitPrice: "4.40" }));
    // The set this file reasons about is every write the action made, not
    // the one write it was looking for: a second update that put the claim
    // back would pass every assertion above.
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("li_1");
  });
});

/**
 * The other write that sets a basis. `addCatalogLine` is the body behind
 * both "Add from catalog" on the job page and the Ask command
 * `add_catalog_line`, and it stamped COMPANY_CATALOG on every line it made
 * — including one made from an entry that carries no default price, where
 * the card itself reads "No default price on the catalog entry" and the row
 * lands with `unitPrice: null`. Nothing renders that badge today
 * (`PriceBasisBadge` is drawn for `aiDrafted` rows only), so this is a
 * stored contradiction rather than a visible one — which is exactly how
 * long it would survive before somebody renders the field and believes it.
 */
describe("addCatalogLine — a basis is a claim about a price, so an unpriced line makes none", () => {
  it("records the catalog as the basis when the entry actually priced the line", async () => {
    const result = await addCatalogLine("cmp_alpha", {
      jobId: "job_1",
      catalogEntryId: "cat_1",
      quantity: "12000",
    });

    expect(result.ok).toBe(true);
    expect(creates).toHaveLength(1);
    expect(String(creates[0].unitPrice)).toBe("3.25");
    expect(creates[0].priceBasis).toBe("COMPANY_CATALOG");
  });

  it("claims no basis when the entry has no price to lend", async () => {
    db.catalog = [catalogEntry({ defaultUnitPrice: null })];

    const result = await addCatalogLine("cmp_alpha", {
      jobId: "job_1",
      catalogEntryId: "cat_1",
      quantity: "12000",
    });

    expect(result.ok).toBe(true);
    expect(creates).toHaveLength(1);
    expect(creates[0].unitPrice, "the entry priced nothing").toBeNull();
    expect(
      creates[0].priceBasis,
      'the row would otherwise claim "your catalog price" for a price nobody has',
    ).toBeNull();
  });
});
