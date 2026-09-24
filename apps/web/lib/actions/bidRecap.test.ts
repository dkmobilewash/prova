import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bid recap's writes, pinned where a person cannot click them.
 *
 *   1. Applying the recap writes the BID into the line prices — computed on
 *      the server from the job's own lines and its own stored rates, never
 *      from anything the request said.
 *   2. Applying twice COMPOUNDS, because the second run marks up prices that
 *      already carry the markup. That is a real hazard, so it is pinned here
 *      and the screen says so before the button is pressed.
 *   3. After award the recap is locked — the contract is the price now.
 *   4. A rate outside 0-100 comes back as a sentence, not a throw: the
 *      0.10-meaning-ten-percent scar.
 *   5. Everything is scoped by company in the where, and capabilities are
 *      refused before anything is read.
 */

type Row = Record<string, unknown> & { id: string };
let db: Record<string, Row[]>;
let reads = 0;
let seq = 0;

const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const matches = (row: Row, where: Record<string, unknown> = {}): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const cond = value as Record<string, unknown>;
      if ("in" in cond) return (cond.in as unknown[]).includes(row[key]);
      if ("not" in cond) return row[key] !== cond.not;
    }
    return row[key] === value;
  });

function model(name: string) {
  const rows = () => db[name];
  return {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      reads += 1;
      return rows().find((r) => matches(r, where)) ?? null;
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      reads += 1;
      return rows().find((r) => matches(r, where)) ?? null;
    },
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      reads += 1;
      return rows().filter((r) => matches(r, where));
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows().find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows().filter((r) => matches(r, where));
      for (const row of hit) Object.assign(row, data);
      return { count: hit.length };
    },
    upsert: async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const existing = rows().find((r) => matches(r, where));
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { ...create, id: `${name}_${++seq}` } as Row;
      rows().push(row);
      return row;
    },
  };
}

vi.mock("@prova/db", () => {
  const client: Record<string, unknown> = {};
  for (const name of ["job", "jobLineItem", "jobBidRecap", "companyBidDefaults"]) {
    client[name] = new Proxy({}, { get: (_t, prop) => (model(name) as Record<string, unknown>)[prop as string] });
  }
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);
  return { prisma: client };
});

const actions = () => import("./bidRecap");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const priceOf = (id: string) => Number(db.jobLineItem.find((l) => l.id === id)!.unitPrice);

beforeEach(() => {
  seq = 0;
  reads = 0;
  context.role = "OWNER";
  context.jobFunction = null;
  db = {
    job: [
      { id: "job_1", companyId: "co_1", status: "ESTIMATE" },
      { id: "job_done", companyId: "co_1", status: "CONTRACTED" },
      { id: "job_other", companyId: "co_2", status: "ESTIMATE" },
    ],
    jobLineItem: [
      { id: "board", jobId: "job_1", quantity: "1000", unitPrice: "2", costCategory: "MATERIAL", isDeleted: false },
      { id: "hang", jobId: "job_1", quantity: "100", unitPrice: "10", costCategory: "LABOR", isDeleted: false },
      { id: "theirs", jobId: "job_other", quantity: "1", unitPrice: "5", costCategory: null, isDeleted: false },
    ],
    jobBidRecap: [],
    companyBidDefaults: [],
  };
});

describe("saving the rates", () => {
  it("stores them on the job, bounded 0-100", async () => {
    const { saveBidRecap } = await actions();
    expect(await saveBidRecap("job_1", form({ materialMarkupPercent: "10", overheadPercent: "8" }))).toEqual({ ok: true });
    expect(db.jobBidRecap[0]).toMatchObject({ jobId: "job_1", companyId: "co_1", materialMarkupPercent: "10", overheadPercent: "8" });
  });

  it("refuses a rate that is not a percentage, in a sentence, and stores nothing", async () => {
    const { saveBidRecap } = await actions();
    const result = await saveBidRecap("job_1", form({ overheadPercent: "120" }));
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/Overhead/);
    expect(db.jobBidRecap).toHaveLength(0);
  });

  it("locks once the job is contracted", async () => {
    const { saveBidRecap } = await actions();
    const result = await saveBidRecap("job_done", form({ overheadPercent: "8" }));
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/change order/);
  });
});

describe("applying the recap to the line prices", () => {
  const RATES = { materialMarkupPercent: "10", laborMarkupPercent: "5", materialTaxPercent: "8", overheadPercent: "10", profitPercent: "5", bondPercent: "1" };

  it("writes the bid across the lines, pro-rata, and records what it wrote", async () => {
    const { saveBidRecap, applyBidRecap } = await actions();
    await saveBidRecap("job_1", form(RATES));

    const result = await applyBidRecap("job_1");
    expect(result.ok).toBe(true);
    // The worked example from bid-recap.test.ts: 3000 direct -> 3996.60 bid.
    expect((result as { value: { bidTotal: number } }).value.bidTotal).toBe(3996.6);
    // 2.6644 and 13.322 per unit, stored to the cent.
    expect(priceOf("board")).toBe(2.66);
    expect(priceOf("hang")).toBe(13.32);
    expect(db.jobBidRecap[0].appliedAt).toBeInstanceOf(Date);
    expect(db.jobBidRecap[0].appliedTotal).toBe("3992.00");
  });

  it("COMPOUNDS if applied twice — the reason the screen warns before the second press", async () => {
    const { saveBidRecap, applyBidRecap } = await actions();
    await saveBidRecap("job_1", form(RATES));
    await applyBidRecap("job_1");
    const first = priceOf("board");
    await applyBidRecap("job_1");
    expect(priceOf("board")).toBeGreaterThan(first);
  });

  it("refuses when no rates are set yet", async () => {
    const { applyBidRecap } = await actions();
    const result = await applyBidRecap("job_1");
    expect(result).toEqual({ ok: false, error: "Set the markup rates first — there is nothing to apply yet." });
  });

  it("refuses when the rates add nothing, rather than rewriting every price with the same number", async () => {
    const { saveBidRecap, applyBidRecap } = await actions();
    await saveBidRecap("job_1", form({ overheadPercent: "0" }));
    const result = await applyBidRecap("job_1");
    expect(result.ok).toBe(false);
    expect(priceOf("board")).toBe(2);
  });

  it("is refused after award, with the prices left alone", async () => {
    const { applyBidRecap } = await actions();
    db.jobBidRecap.push({ id: "r_done", jobId: "job_done", companyId: "co_1", overheadPercent: "10" });
    const result = await applyBidRecap("job_done");
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/change order/);
  });
});

describe("cost type on a line", () => {
  it("sets it, and clears it back to uncoded", async () => {
    const { setLineCostCategory } = await actions();
    expect(await setLineCostCategory("job_1", "board", "SUBCONTRACTOR")).toEqual({ ok: true });
    expect(db.jobLineItem[0].costCategory).toBe("SUBCONTRACTOR");
    await setLineCostCategory("job_1", "board", "");
    expect(db.jobLineItem[0].costCategory).toBeNull();
  });

  it("refuses a line that is not on this job", async () => {
    const { setLineCostCategory } = await actions();
    expect(await setLineCostCategory("job_1", "theirs", "MATERIAL")).toMatchObject({ ok: false });
    expect(db.jobLineItem[2].costCategory).toBeNull();
  });
});

describe("company scoping and capabilities", () => {
  it("cannot touch another company's job", async () => {
    const { saveBidRecap, applyBidRecap } = await actions();
    expect(await saveBidRecap("job_other", form({ overheadPercent: "8" }))).toEqual({ ok: false, error: "That job isn't on your account any more." });
    expect(await applyBidRecap("job_other")).toMatchObject({ ok: false });
  });

  it("refuses a job function without VIEW_JOB_COSTS before reading anything", async () => {
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const { saveBidRecap, applyBidRecap, setLineCostCategory } = await actions();
    expect(await saveBidRecap("job_1", form({ overheadPercent: "8" }))).toMatchObject({ ok: false });
    expect(await applyBidRecap("job_1")).toMatchObject({ ok: false });
    expect(await setLineCostCategory("job_1", "board", "MATERIAL")).toMatchObject({ ok: false });
    expect(reads).toBe(0);
  });

  it("refuses the company defaults to anyone without the capability their page withholds", async () => {
    // MANAGE_COMPLIANCE, the gate on /settings — not MANAGE_ESTIMATING, and
    // not owner-only: action-capability-guards.test.ts executed both and showed
    // the estimator being answered and the office manager locked out.
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    const { saveCompanyBidDefaults } = await actions();
    expect(await saveCompanyBidDefaults(form({ overheadPercent: "8" }))).toMatchObject({ ok: false });
    expect(db.companyBidDefaults).toHaveLength(0);
  });

  it("lets the office manager who can open Settings save them", async () => {
    context.role = "MEMBER";
    context.jobFunction = "PAYROLL_COMPLIANCE";
    const { saveCompanyBidDefaults } = await actions();
    expect(await saveCompanyBidDefaults(form({ overheadPercent: "8" }))).toEqual({ ok: true });
    expect(db.companyBidDefaults).toHaveLength(1);
  });

  it("saves the company defaults for the owner too", async () => {
    const { saveCompanyBidDefaults } = await actions();
    expect(await saveCompanyBidDefaults(form({ overheadPercent: "8", profitPercent: "6" }))).toEqual({ ok: true });
    expect(db.companyBidDefaults[0]).toMatchObject({ companyId: "co_1", overheadPercent: "8", profitPercent: "6" });
  });
});
