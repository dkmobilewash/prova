import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `phaseCodeIdFromForm` is the ownership check on the phase-code select,
 * and what is asserted here is the WHERE CLAUSE rather than the return
 * value.
 *
 * The id reaches this function from a `<select>` in a browser, so it is a
 * claim and not a fact. Without the company scope a caller could post any
 * company's phase code id and have it stored on their own line item, where
 * it would read back as a code they do not have and land in a budget report
 * grouped by it. Reading the argument sent to the database is what pins
 * that; a test that seeded two companies and checked the wrong one came
 * back empty would pass equally against a post-query
 * `if (phase.companyId !== companyId)`, which is the same protection with
 * one more place to forget it.
 *
 * `craftClassificationIdFromForm` sits directly above it in shared.ts, does
 * the same job for the craft on the same two forms, and has no test at all.
 * This is the first of the pair to get one.
 */

const findFirst = vi.fn();
vi.mock("@prova/db", () => ({
  prisma: { phaseCode: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

const { phaseCodeIdFromForm } = await import("./shared");

const COMPANY = "co_1";
const PHASE = "phase_1";

function form(value?: string): FormData {
  const data = new FormData();
  if (value !== undefined) data.set("phaseCodeId", value);
  return data;
}

beforeEach(() => {
  findFirst.mockReset();
  findFirst.mockResolvedValue({ id: PHASE });
});

describe("phaseCodeIdFromForm", () => {
  it("SCOPES THE LOOKUP TO THE CALLER'S COMPANY", async () => {
    await phaseCodeIdFromForm(form(PHASE), COMPANY);
    const where = findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: PHASE, companyId: COMPANY });
    // Spelled out so a partial match cannot pass: losing either half is a
    // different bug and both must fail loudly.
    expect(where.companyId).toBe(COMPANY);
    expect(where.id).toBe(PHASE);
  });

  it("returns the id when the phase code is this company's", async () => {
    await expect(phaseCodeIdFromForm(form(PHASE), COMPANY)).resolves.toBe(PHASE);
  });

  it("REFUSES another company's phase code rather than storing it", async () => {
    // What a scoped query returns when it matches nothing. Storing it would
    // put a code this company does not have onto their own line item.
    findFirst.mockResolvedValue(null);
    await expect(phaseCodeIdFromForm(form(PHASE), COMPANY)).rejects.toThrow(/not found/i);
  });

  it("treats no selection as uncoded, and does not go to the database for it", async () => {
    // "Not coded to a phase" posts an empty string. Uncoded is a real and
    // common state, not a missing answer, so it must not error — and it
    // must not cost a query either.
    for (const value of ["", "   ", undefined]) {
      await expect(phaseCodeIdFromForm(form(value), COMPANY)).resolves.toBeNull();
    }
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("accepts a RETIRED code, deliberately", async () => {
    // Retired codes are not OFFERED by the picker, but a line already coded
    // to one must survive being edited for any other reason. A retired code
    // is evidence of how work on an invoiced job was coded, and dropping it
    // on save would rewrite that quietly. So this layer does not filter on
    // isActive at all — and this test is what stops someone "tidying" it in.
    findFirst.mockResolvedValue({ id: PHASE });
    await expect(phaseCodeIdFromForm(form(PHASE), COMPANY)).resolves.toBe(PHASE);
    expect(findFirst.mock.calls[0][0].where).not.toHaveProperty("isActive");
  });
});
