import { beforeEach, describe, expect, it, vi } from "vitest";

// The REAL precedence function, not a restatement of it. The last block in
// this file composes it with this module's output, so a flip in
// labor-productivity.ts turns a catalog test red rather than only a line one.
// Safe to import statically despite the `@prova/db` mock below: it is pure
// arithmetic and imports nothing.
import { estimatedHours } from "@/lib/labor-productivity";

/**
 * What a catalog entry's TWO labor figures MEAN, pinned at two quantities.
 *
 * Since #514 there are two, and they point in opposite directions:
 * `defaultLaborHours` is flat for the whole line, `productionRate` is units
 * per hour. Both are copied onto the line unchanged by this function — the
 * arithmetic that makes them differ happens later, when the line is read.
 * The last block in this file pins what happens when an entry carries both.
 *
 * `addCatalogLine` copies the entry's hours onto the new line flat while
 * `unitPrice` and `budgetedUnitCost` are per-unit figures the job page
 * multiplies out. Nothing in the app said so: the field was labelled "Default
 * labor hrs", the catalog row rendered a bare "8 hrs" next to "$2.85/unit", and
 * an estimator reading both could not tell that one scales with quantity and
 * the other does not. A wrong labor burden is a wrong bid.
 *
 * The two assertions that matter are the SAME NUMBER at quantity 1 and at
 * quantity 100, asserted explicitly rather than inferred from one case — a
 * single-quantity test cannot tell flat from per-unit at all, which is how this
 * went unnoticed. Each is paired with `unitPrice`, which is genuinely per-unit
 * and also unchanged by the copy, so the contrast is visible in the file: the
 * difference between the two fields is not in this function, it is in what the
 * job page later does with each.
 *
 * This pins the CURRENT behaviour, and as of #514 it is also an endorsement.
 * The paragraph here used to end "it is deliberately not an endorsement —
 * `importCatalogEntries` writes a per-unit productivity factor into the same
 * column, so the two writers disagree", which was true and is no longer: the
 * import asks which convention the file uses and sends a per-unit answer to
 * `productionRate`, so nothing reaching `defaultLaborHours` is per-unit and
 * flat is the only reading it has to carry. If someone decides these hours
 * should scale, this test is still the thing they must change on purpose.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findFirst: vi.fn() },
    lineItemCatalogEntry: { findFirst: vi.fn() },
    jobLineItem: { create: vi.fn() },
  },
}));

vi.mock("@prova/db", () => ({ prisma: fake.prisma }));

const { addCatalogLine } = await import("./catalog-line");

/** The entry an estimator would actually build: priced per SF, 8 hours typed
 *  into the labor field. Prisma hands Decimal columns back as Decimal objects;
 *  a number stands in for one here because this function only ever passes the
 *  value straight through — it never does arithmetic on it, which is precisely
 *  the fact under test. */
const entry = {
  id: "cat-1",
  companyId: "co-1",
  description: '5/8" Type X, hung and finished',
  unit: "SF",
  defaultUnitPrice: 2.85,
  defaultBudgetedUnitCost: 1.9,
  defaultLaborHours: 8,
  // #514's column. Deliberately set ALONGSIDE the flat hours in the shared
  // fixture, because that is the combination with a hazard in it — see the
  // precedence block at the bottom of this file. Tests that want one or the
  // other override it.
  productionRate: 62.5,
  craftClassificationId: "craft-1",
  tradeScope: "METAL_FRAMING_DRYWALL",
};

/** The `data` object `addCatalogLine` asked Prisma to write. */
async function createdLineFor(quantity: string) {
  fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
  fake.prisma.lineItemCatalogEntry.findFirst.mockResolvedValue(entry);
  fake.prisma.jobLineItem.create.mockResolvedValue({ id: "li-1" });

  const result = await addCatalogLine("co-1", {
    jobId: "job-1",
    catalogEntryId: "cat-1",
    quantity,
  });
  expect(result.ok).toBe(true);

  const call = fake.prisma.jobLineItem.create.mock.calls.at(-1) as
    | [{ data: Record<string, unknown> }]
    | undefined;
  if (!call) throw new Error("no line item was created");
  return call[0].data;
}

beforeEach(() => {
  fake.prisma.job.findFirst.mockReset();
  fake.prisma.lineItemCatalogEntry.findFirst.mockReset();
  fake.prisma.jobLineItem.create.mockReset();
});

describe("addCatalogLine — catalog labor hours are FLAT per line", () => {
  it("writes the entry's own hours at quantity 1", async () => {
    const data = await createdLineFor("1");
    expect(data.quantity).toBe("1");
    expect(data.laborHours).toBe(8);
    expect(data.unitPrice).toBe(2.85);
  });

  it("writes the SAME hours at quantity 100 — not 800", async () => {
    const data = await createdLineFor("100");
    expect(data.quantity).toBe("100");
    expect(data.laborHours).toBe(8);
    expect(data.laborHours).not.toBe(800);
    // Unchanged for the same reason and with the opposite meaning: this one is
    // a rate the job page multiplies by 100 later, and the hours are not.
    expect(data.unitPrice).toBe(2.85);
  });

  it("is the same number at both quantities, which is the whole claim", async () => {
    const one = await createdLineFor("1");
    const hundred = await createdLineFor("100");
    expect(hundred.laborHours).toBe(one.laborHours);
  });

  it("leaves hours null when the entry has none, rather than inventing a zero", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findFirst.mockResolvedValue({
      ...entry,
      defaultLaborHours: null,
      craftClassificationId: null,
    });
    fake.prisma.jobLineItem.create.mockResolvedValue({ id: "li-1" });

    await addCatalogLine("co-1", { jobId: "job-1", catalogEntryId: "cat-1", quantity: "600" });
    const call = fake.prisma.jobLineItem.create.mock.calls.at(-1) as [
      { data: Record<string, unknown> },
    ];
    expect(call[0].data.laborHours).toBeNull();
    // A zero would price as "no labor" rather than "labor not estimated", and
    // estimateBurdenedLaborCost treats <= 0 as no number at all.
    expect(call[0].data.laborHours).not.toBe(0);
  });
});

/**
 * The wizard's OTHER quantity box.
 *
 * `/jobs/new/<id>/items` has two: "Add a line" (hand-typed) and "Add from
 * catalog". The first went through `decimalFromForm` and the second comes
 * here — and when the tolerant parser landed, only the first got it. So for
 * a few hours the same screen took `2,800` in one box and refused it in the
 * one underneath, which is the original bug surviving inside its own fix.
 *
 * What made it survivable was a comment: this function said "the same test
 * decimalFromForm applies", which was true when written and stopped being
 * true without anything going red. These are the cases that stop it being
 * a comment.
 */
describe("addCatalogLine — the quantity box takes what a contractor types", () => {
  const refusalFor = async (quantity: string) => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findFirst.mockResolvedValue(entry);
    fake.prisma.jobLineItem.create.mockResolvedValue({ id: "li-1" });
    return addCatalogLine("co-1", { jobId: "job-1", catalogEntryId: "cat-1", quantity });
  };

  it("takes a thousands comma, the same as the box above it", async () => {
    const data = await createdLineFor("2,800");
    expect(data.quantity).toBe("2800");
  });

  it("takes a figure with spaces around it, off a spreadsheet paste", async () => {
    expect((await createdLineFor("  1,250.50 ")).quantity).toBe("1250.5");
  });

  it("refuses a figure it cannot read, with a sentence naming the field", async () => {
    const result = await refusalFor("two thousand");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("Quantity");
    expect(result.ok ? "" : result.error).not.toBe('"quantity" must be a number');
  });

  it("no longer hands a Decimal column the literal text 0x10", async () => {
    // It used to: `Number("0x10")` is 16, so the old gate passed it and the
    // RAW STRING went to Postgres.
    const result = await refusalFor("0x10");
    expect(result.ok).toBe(false);
  });

  it("refuses a negative quantity, which the old check did not", async () => {
    expect((await refusalFor("-5")).ok).toBe(false);
  });
});

/**
 * THE PAIR, AND WHICH ONE WINS — #514.
 *
 * A catalog entry can now carry flat hours AND a production rate, and the two
 * cannot both decide a line's labor. The rule is NOT invented in
 * `catalogLineFields`: it copies both onto the line, and `estimatedHours()`
 * (lib/labor-productivity.ts) takes the flat hours as the override. So the
 * catalog inherits `JobLineItem`'s precedence rather than growing a second one.
 *
 * WHY THIS IS WORTH A TEST RATHER THAN A COMMENT. A rate that loses to flat
 * hours is inert — it divides nothing, changes no figure, and yet reads on a
 * screen exactly like the productivity assumption a bid was built on. That is
 * the "figure that looks measured but isn't" shape this repo refuses
 * everywhere, and the only thing standing between it and an estimator is one
 * `if` in another module. This composes the real `estimatedHours` with this
 * function's real output, so if that precedence ever flips, a test that names
 * the catalog goes red — not just one that names the line.
 *
 * It asserts what the code DOES. Whether an entry should be allowed to hold
 * both is a product question, answered on purpose: it is allowed, and every
 * screen showing the pair says which wins. Changing that is a decision, and
 * this test is what it has to be made against.
 */
describe("addCatalogLine — flat hours and a production rate together", () => {
  it("copies the rate through unchanged, at both quantities", async () => {
    // Per-unit, and still NOT multiplied here — the division happens when the
    // line is read. Same shape as unitPrice: the copy is flat, the meaning is
    // not. A rate scaled at write time would be wrong by the quantity twice.
    expect((await createdLineFor("1")).productionRate).toBe(62.5);
    expect((await createdLineFor("600")).productionRate).toBe(62.5);
  });

  it("puts BOTH figures on the line, leaving the choice to the reader", async () => {
    const data = await createdLineFor("600");
    expect(data.laborHours).toBe(8);
    expect(data.productionRate).toBe(62.5);
  });

  it("means the flat hours win: 8, not the 9.6 the rate would give", async () => {
    const data = await createdLineFor("600");
    // Asserted here as well as in the test above, so this one cannot pass
    // vacuously: with no rate on the line, `estimatedHours` returns 8 for the
    // trivial reason rather than because the flat hours BEAT something. Found
    // by mutation — dropping the copy left this test green while four others
    // went red.
    expect(data.productionRate).toBe(62.5);
    const hours = estimatedHours({
      quantity: 600,
      laborHours: data.laborHours as number,
      productionRate: data.productionRate as number,
    });
    expect(hours).toBe(8);
    // 600 / 62.5 = 9.6. Asserted by value so the losing branch is visible
    // here: a reader can see exactly which number the entry did not produce.
    expect(hours).not.toBe(9.6);
  });

  it("uses the rate when the entry carries no flat hours", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findFirst.mockResolvedValue({
      ...entry,
      defaultLaborHours: null,
    });
    fake.prisma.jobLineItem.create.mockResolvedValue({ id: "li-1" });

    await addCatalogLine("co-1", { jobId: "job-1", catalogEntryId: "cat-1", quantity: "600" });
    const call = fake.prisma.jobLineItem.create.mock.calls.at(-1) as [
      { data: Record<string, unknown> },
    ];
    expect(call[0].data.laborHours).toBeNull();
    expect(call[0].data.productionRate).toBe(62.5);
    expect(
      estimatedHours({ quantity: 600, laborHours: null, productionRate: 62.5 }),
    ).toBe(9.6);
  });

  it("leaves the rate null when the entry has none, rather than inventing a zero", async () => {
    fake.prisma.job.findFirst.mockResolvedValue({ id: "job-1", status: "ESTIMATE" });
    fake.prisma.lineItemCatalogEntry.findFirst.mockResolvedValue({
      ...entry,
      productionRate: null,
    });
    fake.prisma.jobLineItem.create.mockResolvedValue({ id: "li-1" });

    await addCatalogLine("co-1", { jobId: "job-1", catalogEntryId: "cat-1", quantity: "600" });
    const call = fake.prisma.jobLineItem.create.mock.calls.at(-1) as [
      { data: Record<string, unknown> },
    ];
    expect(call[0].data.productionRate).toBeNull();
    // A zero rate is worse than none: `hoursFromRate` guards `<= 0` and returns
    // null, so a stored zero reads as "no rate" anyway while looking like one
    // somebody entered.
    expect(call[0].data.productionRate).not.toBe(0);
  });
});
