import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bid recap's writes, pinned where a person cannot click them.
 *
 *   1. Applying the recap writes the BID into the line prices — computed on
 *      the server from the job's own lines and its own stored rates, never
 *      from anything the request said.
 *   2. Applying twice is IDEMPOTENT. Until #512 it COMPOUNDED — the second run
 *      read the marked-up `unitPrice` back as the direct cost — and this line
 *      described that as "a real hazard, pinned here, and the screen says so".
 *      The bid is built from `budgetedUnitCost` now and applying writes
 *      `unitPrice`, so the input is no longer the output of the last run. The
 *      hazard is gone rather than guarded, and the screen's warning changed with
 *      it.
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
      // #512: `budgetedUnitCost` is the figure the recap marks up; `unitPrice` is
      // what applying WRITES. Both are set here at the numbers this file's totals
      // were always derived from, so every hand-worked figure below is unchanged
      // — the arithmetic was never wrong, only the column it read.
      { id: "board", jobId: "job_1", quantity: "1000", budgetedUnitCost: "2", unitPrice: "2", costCategory: "MATERIAL", isDeleted: false },
      { id: "hang", jobId: "job_1", quantity: "100", budgetedUnitCost: "10", unitPrice: "10", costCategory: "LABOR", isDeleted: false },
      { id: "theirs", jobId: "job_other", quantity: "1", budgetedUnitCost: "5", unitPrice: "5", costCategory: null, isDeleted: false },
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

  /**
   * THIS TEST USED TO ASSERT THE OPPOSITE, AND #512 IS WHY IT CHANGED.
   *
   * It was called "COMPOUNDS if applied twice — the reason the screen warns
   * before the second press", and it was correct: applying marked up each
   * line's `unitPrice`, and the next apply read `unitPrice` back as the direct
   * cost and marked up the already-marked-up figure. Nothing prevented it —
   * `applyBidRecap` never reads `appliedAt`, so the only brake was a sentence on
   * screen asking the estimator not to press again.
   *
   * Applying is IDEMPOTENT now, and not by adding a guard: the cost base is
   * `budgetedUnitCost`, and applying writes `unitPrice`. The input to the
   * calculation is no longer the output of the last one, so pressing twice
   * cannot compound. Measured, not argued — this asserted `toBeGreaterThan` and
   * came back 2.66 against 2.66.
   *
   * That is a real safety improvement nobody asked for and it is worth naming as
   * a consequence rather than a feature, because the screen's warning about the
   * second press became a false statement the moment it was true and had to be
   * rewritten (`BidRecapPanel.tsx`).
   */
  it("is IDEMPOTENT if applied twice — the cost base does not move when prices do", async () => {
    const { saveBidRecap, applyBidRecap } = await actions();
    await saveBidRecap("job_1", form(RATES));
    await applyBidRecap("job_1");
    const first = priceOf("board");
    const secondResult = await applyBidRecap("job_1");
    expect(secondResult.ok).toBe(true);
    expect(priceOf("board")).toBe(first);
    // And the recorded total is the same event, not a bigger one.
    expect(priceOf("hang")).toBe(13.32);
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

/**
 * setLineBudgetedCost — the way out of #512's warning.
 *
 * A line with no cost is reported and marked up at nothing, and on a job built
 * through the bid wizard that is every line. The warning named the problem and
 * left the fix elsewhere on the page; this is the box beside the cost type.
 *
 * What these pin is mostly what it must NOT do: not touch the forecast, not
 * reach another job's line, not turn a mistyped figure into a thrown digest, and
 * not refuse a blank.
 */
describe("setting one line's budgeted cost from the recap", () => {
  const costOf = (id: string) => {
    const row = db.jobLineItem.find((line) => line.id === id) as Record<string, unknown> | undefined;
    return row?.budgetedUnitCost ?? null;
  };
  const forecastOf = (id: string) => {
    const row = db.jobLineItem.find((line) => line.id === id) as Record<string, unknown> | undefined;
    return row?.currentEstimatedUnitCost ?? null;
  };

  it("writes the cost the estimator typed", async () => {
    const { setLineBudgetedCost } = await actions();
    const result = await setLineBudgetedCost("job_1", "board", "1.90");
    expect(result).toEqual({ ok: true });
    expect(costOf("board")).toBe("1.9");
  });

  it("takes a figure with a thousands comma, like every other box in the app", async () => {
    const { setLineBudgetedCost } = await actions();
    expect((await setLineBudgetedCost("job_1", "board", "1,250.50")).ok).toBe(true);
    expect(costOf("board")).toBe("1250.5");
  });

  it("clears the cost on a blank, which puts the line back into the warning", async () => {
    // "I do not know what this costs" has to stay expressible, or the only way
    // out of a wrong number is a worse one.
    const { setLineBudgetedCost } = await actions();
    expect((await setLineBudgetedCost("job_1", "board", "")).ok).toBe(true);
    expect(costOf("board")).toBeNull();
  });

  it("does NOT touch the PM's forecast", async () => {
    // `currentEstimatedUnitCost` diverges from the budget on purpose once a job
    // runs. This screen is about the bid, and re-deriving the forecast from it
    // would overwrite a number somebody re-estimated deliberately.
    const { setLineBudgetedCost } = await actions();
    const before = forecastOf("board");
    await setLineBudgetedCost("job_1", "board", "7.77");
    expect(forecastOf("board")).toBe(before);
  });

  it("returns a readable refusal for a figure it cannot read, rather than throwing one", async () => {
    // Thrown Server Action messages are redacted in production, so this would
    // reach the estimator as a dead box. `runAction` is what makes it a sentence.
    const { setLineBudgetedCost } = await actions();
    const result = await setLineBudgetedCost("job_1", "board", "about two dollars");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("Budgeted cost");
    expect(costOf("board")).toBe("2");
  });

  it("refuses a negative cost", async () => {
    const { setLineBudgetedCost } = await actions();
    expect((await setLineBudgetedCost("job_1", "board", "-5")).ok).toBe(false);
  });

  it("cannot reach a line on another company's job", async () => {
    const { setLineBudgetedCost } = await actions();
    const result = await setLineBudgetedCost("job_1", "theirs", "9.99");
    expect(result.ok).toBe(false);
    expect(costOf("theirs")).toBe("5");
  });

  it("refuses once the job is no longer at estimate stage", async () => {
    const { setLineBudgetedCost } = await actions();
    const result = await setLineBudgetedCost("job_done", "board", "1.90");
    expect(result.ok).toBe(false);
  });
});

/**
 * setLineCostCategory refuses an unrecognised cost type instead of clearing it.
 *
 * WHAT #524 FLAGGED, AND WHAT WAS ACTUALLY WRONG. The flag was "not wrapped in
 * `runAction`, so a Prisma failure reaches production as a redacted digest".
 * False: `runAction` converts an `InputError` and RETHROWS everything else, so
 * wrapping buys nothing against a pool timeout — and a Prisma failure IS a
 * digest from every action in this codebase, deliberately, because CLAUDE.md's
 * rule is that `throw` is for genuine bugs and a connection timeout is one.
 *
 * Found by writing the test for the claim and watching it go red, after the
 * claim had been repeated in two PR bodies without anyone reading `runAction`.
 *
 * The real defect was next door: an unrecognised category was silently coerced
 * to `null`, identically to the deliberate "no cost type". So a typo or a
 * tampered value CLEARED a line's cost type and returned success — and an
 * uncategorised line is never marked up, so that line quietly dropped out of
 * every markup in the bid.
 */
describe("setting a line's cost type", () => {
  const categoryOf = (id: string) => db.jobLineItem.find((l) => l.id === id)!.costCategory;

  it("sets a real category", async () => {
    const { setLineCostCategory } = await actions();
    expect((await setLineCostCategory("job_1", "board", "SUBCONTRACTOR")).ok).toBe(true);
    expect(categoryOf("board")).toBe("SUBCONTRACTOR");
  });

  it("clears it on an empty string — the select's own 'No cost type'", async () => {
    const { setLineCostCategory } = await actions();
    expect((await setLineCostCategory("job_1", "board", "")).ok).toBe(true);
    expect(categoryOf("board")).toBeNull();
  });

  it("REFUSES a misspelling rather than clearing the line's cost type", async () => {
    // The defect. "MATERAIL" used to land as null with `{ ok: true }`, and the
    // line then earned no markup at all.
    const { setLineCostCategory } = await actions();
    const result = await setLineCostCategory("job_1", "board", "MATERAIL");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("MATERAIL");
    expect(categoryOf("board")).toBe("MATERIAL");
  });

  it("returns the stale-tab refusal rather than rejecting", async () => {
    const { setLineCostCategory } = await actions();
    const result = await setLineCostCategory("job_1", "gone", "MATERIAL");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/no longer on the estimate/);
  });
});
